import fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const VALID_KEY = "anhkhoi_xabc2102";
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

const API_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

if (!existsSync(DATA_DIR)) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

// --- CÁC HÀM TÍNH TOÁN ĐỊNH LƯỢNG CHUẨN ---
const avg = arr => (arr && arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
const std = arr => {
  if (!arr || arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map(n => (n - m) ** 2)));
};

const entropy = arr => {
  if (!arr || !arr.length) return 0;
  const f = {};
  for (let i = 0; i < arr.length; i++) f[arr[i]] = (f[arr[i]] || 0) + 1;
  let e = 0, n = arr.length;
  for (const k in f) {
    const p = f[k] / n;
    e -= p * Math.log2(p);
  }
  return e;
};

const streakLen = tx => {
  if (!tx || !tx.length) return 0;
  let s = 1;
  for (let i = tx.length - 2; i >= 0; i--) {
    if (tx[i] === tx[tx.length - 1]) s++;
    else break;
  }
  return s;
};

// --- BẢO TOÀN DỮ LIỆU ĐỒNG BỘ ---
function loadStore() {
  try {
    if (existsSync(STORE_FILE)) {
      const data = JSON.parse(readFileSync(STORE_FILE, "utf8"));
      return {
        hu: { activePred: data.hu?.activePred || null, outcomes: data.hu?.outcomes || [] },
        md5: { activePred: data.md5?.activePred || null, outcomes: data.md5?.outcomes || [] }
      };
    }
  } catch {}
  return { hu: { activePred: null, outcomes: [] }, md5: { activePred: null, outcomes: [] } };
}

function saveStore(s) {
  try { writeFileSync(STORE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

const store = loadStore();

// --- TẦNG 1: THUẬT TOÁN HÌNH THÁI DÒNG TIỀN ---
class PatternEngine {
  get(tx) {
    if (!tx || tx.length < 4) return null;
    const last = tx[tx.length - 1];
    const s = streakLen(tx);

    // Bệt sâu & bão hòa
    if (s >= 8) return { pred: last === "T" ? "xỉu" : "tài", conf: 93, src: `Bẻ bệt sâu (${s} tay)` };
    if (s >= 6) return { pred: last === "T" ? "xỉu" : "tài", conf: 89, src: `Bẻ bệt bão hòa (${s} tay)` };
    if (s >= 3 && s < 6) return { pred: last === "T" ? "tài" : "xỉu", conf: 85 + (s - 3) * 2, src: `Đu sóng bệt (${s} tay)` };

    // Cầu đảo 1-1
    const last6 = tx.slice(-6);
    if (last6.length === 6 && last6.every((v, i) => i === 0 || v !== last6[i - 1])) {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 89, src: "Bắt nhịp đảo 1-1" };
    }

    // Cầu đôi 2-2
    const last4 = tx.slice(-4);
    if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
      return { pred: last4[3] === "T" ? "xỉu" : "tài", conf: 86, src: "Cầu song hành 2-2" };
    }

    // Cầu 3-2-1 & 1-2-3
    const seq6 = tx.slice(-6).join("");
    if (seq6 === "TTTXXT" || seq6 === "XXXTTX") return { pred: last === "T" ? "tài" : "xỉu", conf: 88, src: "Cầu gãy 3-2-1" };
    if (seq6 === "TXXTTT" || seq6 === "XTTXXX") return { pred: last === "T" ? "xỉu" : "tài", conf: 88, src: "Cầu tiến 1-2-3" };

    // Cầu kẹp 2-1-2
    const last5 = tx.slice(-5).join("");
    if (last5 === "TTXTT" || last5 === "XXTXX") return { pred: last === "T" ? "xỉu" : "tài", conf: 85, src: "Cầu kẹp 2-1-2" };

    // Nhịp 3-1 & 1-3
    const last4Seq = tx.slice(-4).join("");
    if (last4Seq === "TTTX" || last4Seq === "XXXT") return { pred: last === "T" ? "xỉu" : "tài", conf: 84, src: "Cầu nhịp 3-1" };
    if (last4Seq === "TXXX" || last4Seq === "XTTT") return { pred: last === "T" ? "tài" : "xỉu", conf: 84, src: "Cầu nhịp 1-3" };

    return null;
  }
}

// --- TẦNG 2: THUẬT TOÁN XÁC SUẤT MARKOV K3 & ĐỈNH ĐÁY GAUSS ---
class StatisticalEngine {
  get(tx, totals) {
    if (!tx || tx.length < 10) return null;

    // 1. Markov bậc 3 có trọng số Dirichlet
    if (tx.length >= 16) {
      const state3 = tx.slice(-3).join("");
      const counts = { T: 0, X: 0 };
      for (let i = 0; i < tx.length - 3; i++) {
        if (tx[i] + tx[i + 1] + tx[i + 2] === state3) {
          counts[tx[i + 3]]++;
        }
      }
      const sum = counts.T + counts.X;
      if (sum >= 3) {
        const probT = (counts.T + 1) / (sum + 2);
        if (probT >= 0.67) return { pred: "tài", conf: Math.round(79 + probT * 16), src: "Markov K3 xác suất cao" };
        if (probT <= 0.33) return { pred: "xỉu", conf: Math.round(79 + (1 - probT) * 16), src: "Markov K3 xác suất cao" };
      }
    }

    // 2. Quét bước sóng chu kỳ Lag 2-10
    let bestC = 0, bestS = 0;
    for (let c = 2; c <= 10; c++) {
      let match = 0, count = 0;
      for (let i = c; i < tx.length; i++) {
        if (tx[i] === tx[i - c]) match++;
        count++;
      }
      const score = count ? match / count : 0;
      if (score > bestS && score > 0.68) {
        bestS = score;
        bestC = c;
      }
    }
    if (bestC && bestS >= 0.72) {
      const target = tx[tx.length - bestC];
      return {
        pred: target === "T" ? "tài" : "xỉu",
        conf: Math.min(95, Math.round(82 + bestS * 14)),
        src: `Chu kỳ bước sóng ${bestC}`
      };
    }

    // 3. Chuẩn hóa phân phối Gauss cho 3 xúc xắc (Mean=10.5, Std=2.96)
    if (totals && totals.length >= 12) {
      const recentWindow = totals.slice(-6);
      const m = avg(recentWindow);
      const zScore = (m - 10.5) / 2.96;
      if (zScore >= 1.70) return { pred: "xỉu", conf: 90, src: "Đỉnh điểm chuẩn Gauss" };
      if (zScore <= -1.70) return { pred: "tài", conf: 90, src: "Đáy điểm chuẩn Gauss" };
    }

    return null;
  }
}

// --- TẦNG 3: ENTROPY, KMP & TỔ HỢP MẶT XÍ NGẦU VIP ---
class EliteQuantEngine {
  get(history) {
    if (!history || history.length < 12) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const dice = history.map(h => h.dice);

    // 1. Phân tích Shannon Entropy
    const e16 = entropy(tx.slice(-16));
    if (e16 < 0.28) {
      const last = tx[tx.length - 1];
      return { pred: last === "T" ? "xỉu" : "tài", conf: 94, src: "Bão hòa Entropy" };
    }

    // 2. Đối sánh chuỗi KMP sâu
    const seq = tx.map(v => (v === "T" ? 1 : 0));
    const maxPatLen = Math.min(10, Math.floor(seq.length / 3));
    for (let len = maxPatLen; len >= 4; len--) {
      const target = seq.slice(-len);
      let hits = 0, nxt = null;
      for (let i = 0; i <= seq.length - len - 1; i++) {
        let match = true;
        for (let j = 0; j < len; j++) {
          if (seq[i + j] !== target[j]) { match = false; break; }
        }
        if (match) {
          hits++;
          if (nxt === null && i + len < seq.length) nxt = seq[i + len];
        }
      }
      if (nxt !== null && hits >= 2) {
        return {
          pred: nxt === 1 ? "tài" : "xỉu",
          conf: Math.min(97, 83 + len * 2 + hits),
          src: `Trùng khớp lịch sử (${len} nhịp)`
        };
      }
    }

    // 3. Tụ lực bề mặt xúc xắc
    const recentDice = dice.slice(-5);
    let lowFaces = 0, highFaces = 0;
    for (const d of recentDice) {
      for (const val of d) {
        if (val <= 2) lowFaces++;
        if (val >= 5) highFaces++;
      }
    }
    if (lowFaces >= 9) return { pred: "tài", conf: 91, src: "Tụ lực mặt nhỏ (1-2)" };
    if (highFaces >= 9) return { pred: "xỉu", conf: 91, src: "Tụ lực mặt lớn (5-6)" };

    // 4. Động lượng xung lực điểm số
    let mom = 0;
    for (let i = 1; i < Math.min(8, totals.length); i++) {
      const delta = totals[totals.length - i] - totals[totals.length - i - 1];
      if (delta >= 3) mom++;
      else if (delta <= -3) mom--;
    }
    if (Math.abs(mom) >= 4) {
      return { pred: mom > 0 ? "xỉu" : "tài", conf: 86 + Math.abs(mom), src: "Động lượng điểm số" };
    }

    return null;
  }
}

// --- BỘ LỌC BẪY CẦU & BÃO SỐ ---
class RiskGuard {
  constructor() {
    this.prob = 0;
  }
  check(history) {
    if (!history || history.length < 15) { this.prob = 0; return "binh_thuong"; }
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    let score = 0;

    const s = streakLen(tx);
    if (s >= 9) score += 0.45;
    else if (s >= 7) score += 0.25;

    const e = entropy(tx.slice(-16));
    if (e < 0.28) score += 0.35;

    const extremeCount = totals.slice(-8).filter(t => t >= 16 || t <= 5).length;
    if (extremeCount >= 3) score += 0.30;

    const last10 = tx.slice(-10).join("");
    if (["TXTXTXTXTX", "XTXTXTXTXT", "TTTTTTTTTT", "XXXXXXXXXX"].some(p => last10.includes(p))) score += 0.35;

    this.prob = Math.min(0.98, score);
    if (score >= 0.58) return "dao_chieu";
    if (score >= 0.35) return "canh_bao";
    return "binh_thuong";
  }
}

class AdaptiveTracker {
  constructor(game) {
    this.game = game;
    this.outcomes = store[game]?.outcomes || [];
    this.streakOk = 0;
    this.streakNg = 0;
    this.reverse = false;
    this.wPattern = 0.34;
    this.wStat = 0.36;
    this.wQuant = 0.30;
  }

  record(session, pred, actual, src) {
    const ok = pred === actual;
    this.outcomes.push({ session, pred, actual, ok, src, ts: Date.now() });
    if (this.outcomes.length > 250) this.outcomes = this.outcomes.slice(-200);
    store[this.game].outcomes = this.outcomes;
    saveStore(store);

    if (ok) {
      this.streakOk++;
      this.streakNg = 0;
      if (this.reverse && this.streakOk >= 2) this.reverse = false;
      this.adjustWeights(src, 0.02);
    } else {
      this.streakNg++;
      this.streakOk = 0;
      if (this.streakNg >= 2 && !this.reverse) this.reverse = true;
      this.adjustWeights(src, -0.03);
    }
  }

  adjustWeights(src, delta) {
    const s = src || "";
    if (s.includes("bệt") || s.includes("1-1") || s.includes("2-2") || s.includes("tiến") || s.includes("gãy") || s.includes("nhịp")) {
      this.wPattern = Math.max(0.15, Math.min(0.6, this.wPattern + delta));
    } else if (s.includes("Markov") || s.includes("sóng") || s.includes("Gauss")) {
      this.wStat = Math.max(0.15, Math.min(0.6, this.wStat + delta));
    } else {
      this.wQuant = Math.max(0.15, Math.min(0.6, this.wQuant + delta));
    }
    const sum = this.wPattern + this.wStat + this.wQuant;
    this.wPattern /= sum; this.wStat /= sum; this.wQuant /= sum;
  }

  applyRev(p) {
    return this.reverse ? (p === "tài" ? "xỉu" : "tài") : p;
  }

  recentAcc(n = 20) {
    const r = this.outcomes.slice(-n);
    if (!r.length) return 0.5;
    return r.filter(o => o.ok).length / r.length;
  }

  adjustConf(base) {
    let c = base;
    const acc = this.recentAcc(20);
    if (acc >= 0.75) c += 6;
    else if (acc >= 0.60) c += 3;
    else if (acc < 0.40) c -= 6;
    if (this.streakOk >= 3) c += 4;
    if (this.reverse) c -= 2;
    return Math.min(98, Math.max(68, Math.round(c)));
  }

  status() {
    return {
      reverse: this.reverse,
      streakOk: this.streakOk,
      streakNg: this.streakNg,
      acc20: Math.round(this.recentAcc(20) * 100) + "%",
      lastOutcomes: this.outcomes.slice(-20).reverse()
    };
  }
}

// --- ENGINE ĐIỀU HÀNH HELIX TRUNG TÂM ---
class HelixEngine {
  constructor(game, url, parse) {
    this.game = game;
    this.url = url;
    this.parse = parse;
    this.history = [];
    this.sessionIds = new Set();
    this.curId = null;
    this.patterns = new PatternEngine();
    this.stat = new StatisticalEngine();
    this.quant = new EliteQuantEngine();
    this.guard = new RiskGuard();
    this.tracker = new AdaptiveTracker(game);
    this.activePred = store[game]?.activePred || null;
    this.timer = null;
  }

  async pull() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(this.url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) return;
      const data = await res.json();
      const list = this.parse(data);
      if (!list || !list.length) return;

      const fresh = [];
      for (const r of list) {
        if (!this.sessionIds.has(r.session)) {
          this.sessionIds.add(r.session);
          fresh.push(r);
        }
      }
      if (!fresh.length && this.history.length) return;

      if (!this.curId) {
        this.history = list.filter(r => this.sessionIds.has(r.session));
        this.curId = this.history.at(-1)?.session || null;
        this.generatePrediction();
        return;
      }

      const news = list.filter(r => r.session > this.curId && !this.history.some(h => h.session === r.session));
      for (const rec of news) {
        if (this.activePred && rec.session === this.activePred.session) {
          const actual = rec.tx === "T" ? "tài" : "xỉu";
          this.tracker.record(rec.session, this.activePred.pred, actual, this.activePred.src);
          this.activePred = null;
          store[this.game].activePred = null;
          saveStore(store);
        }
        this.history.push(rec);
        this.sessionIds.add(rec.session);
      }
      if (this.history.length > 500) {
        this.history = this.history.slice(-400);
        this.sessionIds = new Set(this.history.map(h => h.session));
      }
      if (news.length) {
        this.curId = this.history.at(-1).session;
        this.generatePrediction();
      }
    } catch {}
  }

  start(ms = 4000) {
    this.pull();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.pull(), ms);
  }

  generatePrediction() {
    if (this.history.length < 8) return null;
    const nextSession = (this.history.at(-1)?.session || 0) + 1;

    // Giữ nguyên phiên hiện tại nếu đã tạo
    if (this.activePred && this.activePred.session === nextSession) {
      return this.activePred;
    }

    const tx = this.history.map(h => h.tx);
    const totals = this.history.map(h => h.total);
    const advice = this.guard.check(this.history);
    const cands = [];

    const p = this.patterns.get(tx);
    if (p) cands.push({ ...p, w: this.tracker.wPattern });
    const s = this.stat.get(tx, totals);
    if (s) cands.push({ ...s, w: this.tracker.wStat });
    const q = this.quant.get(this.history);
    if (q) cands.push({ ...q, w: this.tracker.wQuant });

    let pred, conf, src;
    if (!cands.length) {
      const last = tx[tx.length - 1];
      pred = last === "T" ? "xỉu" : "tài";
      conf = 72;
      src = "Cân bằng động lượng";
    } else {
      const score = { "tài": 0, "xỉu": 0 };
      const best = { "tài": null, "xỉu": null };
      for (const c of cands) {
        score[c.pred] += c.conf * c.w;
        if (!best[c.pred] || c.conf > best[c.pred].conf) best[c.pred] = c;
      }
      if (score["tài"] >= score["xỉu"]) {
        pred = "tài";
        conf = best["tài"].conf;
        src = best["tài"].src;
      } else {
        pred = "xỉu";
        conf = best["xỉu"].conf;
        src = best["xỉu"].src;
      }
      const consensus = cands.filter(c => c.pred === pred).length;
      if (consensus >= 2) conf = Math.min(97, conf + 5);
    }

    if (advice === "dao_chieu") {
      pred = pred === "tài" ? "xỉu" : "tài";
      conf = Math.min(97, conf + 4);
    } else if (advice === "canh_bao") {
      conf = Math.max(68, conf - 5);
    }

    pred = this.tracker.applyRev(pred);
    conf = this.tracker.adjustConf(conf);

    this.activePred = {
      session: nextSession,
      pred,
      conf,
      src,
      reverse: this.tracker.reverse,
      cheat: advice !== "binh_thuong",
      ts: Date.now()
    };

    store[this.game].activePred = this.activePred;
    saveStore(store);
    return this.activePred;
  }

  getPrediction() {
    if (!this.activePred || this.activePred.session !== (this.history.at(-1)?.session || 0) + 1) {
      return this.generatePrediction();
    }
    return this.activePred;
  }

  last() { return this.history.at(-1); }
}

function parseStream(data) {
  if (!data || !data.list) return [];
  return data.list
    .map(i => ({
      session: i.id,
      dice: i.dices,
      total: i.point,
      result: i.resultTruyenThong,
      tx: i.point >= 11 ? "T" : "X"
    }))
    .sort((a, b) => a.session - b.session);
}

const hu = new HelixEngine("hu", API_HU, parseStream);
const md5 = new HelixEngine("md5", API_MD5, parseStream);

function checkKey(q) {
  const k = q?.key;
  if (!k) return { ok: false, error: "VUI LÒNG NHẬP MÃ BẢN QUYỀN", contact: "Telegram: @anhkhoi_xabc" };
  if (k !== VALID_KEY) return { ok: false, error: "MÃ KHÓA BẢN QUYỀN KHÔNG ĐÚNG", contact: "Telegram: @anhkhoi_xabc" };
  return { ok: true };
}

async function bootstrap() {
  const app = fastify({ logger: false });
  await app.register(cors, { origin: "*" });

  const rootStaticDir = existsSync(path.join(__dirname, "public"))
    ? path.join(__dirname, "public")
    : __dirname;

  await app.register(fastifyStatic, {
    root: rootStaticDir,
    prefix: "/",
    index: "index.html"
  });

  app.get("/api/dashboard", async (req, reply) => {
    const ck = checkKey(req.query);
    if (!ck.ok) return reply.status(401).send({ error: ck.error, contact: ck.contact });

    const build = (eng) => {
      const last = eng.last();
      const p = eng.history.length >= 8 ? eng.getPrediction() : null;
      const st = eng.tracker.status();
      return {
        last: last ? {
          session: last.session,
          dice: last.dice,
          total: last.total,
          result: last.result.toLowerCase()
        } : null,
        prediction: p ? {
          session: p.session,
          pred: p.pred,
          conf: p.conf,
          src: p.src,
          reverse: p.reverse,
          cheat: p.cheat
        } : null,
        acc20: st.acc20,
        streakOk: st.streakOk,
        streakNg: st.streakNg,
        outcomes: st.lastOutcomes,
        history: eng.history.slice(-30).reverse().map(h => ({
          s: h.session, d: h.dice, t: h.total, r: h.result.toLowerCase(), tx: h.tx
        }))
      };
    };

    return { hu: build(hu), md5: build(md5), ts: Date.now() };
  });

  hu.start(4000);
  md5.start(4000);

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`[HELIX-VIP] Khởi động thành công trên cổng :${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
