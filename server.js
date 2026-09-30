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

// ĐÃ KHÔI PHỤC API MD5 GỐC
const API_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

if (!existsSync(DATA_DIR)) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

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
  for (const k in f) { const p = f[k] / n; e -= p * Math.log2(p); }
  return e;
};
const streakLen = tx => {
  if (!tx || !tx.length) return 0;
  let s = 1;
  for (let i = tx.length - 2; i >= 0; i--) {
    if (tx[i] === tx[tx.length - 1]) s++; else break;
  }
  return s;
};

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

// --- TẦNG 1: THUẬT TOÁN ĐU SÓNG THỰC CHIẾN (Big Data Insights) ---
class MasterPatternEngine {
  get(tx) {
    if (!tx || tx.length < 4) return null;
    const last = tx[tx.length - 1];
    const s = streakLen(tx);

    // KINH NGHIỆM TỪ 3K PHIÊN: Đu bệt bất chấp, chỉ bẻ khi siêu bệt (>= 11)
    if (s >= 3 && s <= 10) {
      return { pred: last === "T" ? "tài" : "xỉu", conf: 88 + Math.min(8, s), src: `Đu sóng bệt siêu cấp (${s} tay)` };
    }
    if (s > 10) {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 95, src: `Phá vỡ bệt tĩnh (${s} tay)` };
    }

    // Ping-pong 1-1 (Mẫu xuất hiện nhiều nhất)
    const last6 = tx.slice(-6);
    if (last6.length === 6 && last6.every((v, i) => i === 0 || v !== last6[i - 1])) {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 91, src: "Duy trì đảo 1-1" };
    }

    // Đối xứng 2-2
    const last4 = tx.slice(-4);
    if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
      return { pred: last4[3] === "T" ? "xỉu" : "tài", conf: 89, src: "Chu kỳ song hành 2-2" };
    }

    // Cầu bậc thang & Kẹp
    const seq6 = tx.slice(-6).join("");
    if (seq6 === "TTTXXT" || seq6 === "XXXTTX") return { pred: last === "T" ? "tài" : "xỉu", conf: 89, src: "Hãm đà gãy 3-2-1" };
    if (seq6 === "TXXTTT" || seq6 === "XTTXXX") return { pred: last === "T" ? "xỉu" : "tài", conf: 89, src: "Bám đà tiến 1-2-3" };
    
    const last5 = tx.slice(-5).join("");
    if (last5 === "TTXTT" || last5 === "XXTXX") return { pred: last === "T" ? "xỉu" : "tài", conf: 87, src: "Thoát cầu kẹp 2-1-2" };

    return null;
  }
}

// --- TẦNG 2: MARKOV K4 SÂU & GAUSS CỰC ĐOAN ---
class MasterStatisticalEngine {
  get(tx, totals) {
    if (!tx || tx.length < 12) return null;

    // Markov bậc 4 (Mẫu lịch sử siêu sâu)
    if (tx.length >= 20) {
      const state4 = tx.slice(-4).join("");
      const counts = { T: 0, X: 0 };
      for (let i = 0; i < tx.length - 4; i++) {
        if (tx[i] + tx[i+1] + tx[i+2] + tx[i+3] === state4) counts[tx[i+4]]++;
      }
      const sum = counts.T + counts.X;
      if (sum >= 3) {
        const probT = (counts.T + 1) / (sum + 2);
        if (probT >= 0.65) return { pred: "tài", conf: Math.round(82 + probT * 15), src: "Markov K4 Tuyệt đối" };
        if (probT <= 0.35) return { pred: "xỉu", conf: Math.round(82 + (1 - probT) * 15), src: "Markov K4 Tuyệt đối" };
      }
    }

    // Autocorrelation Lag 2-12
    let bestC = 0, bestS = 0;
    for (let c = 2; c <= 12; c++) {
      let match = 0, count = 0;
      for (let i = c; i < tx.length; i++) {
        if (tx[i] === tx[i - c]) match++; count++;
      }
      const score = count ? match / count : 0;
      if (score > bestS && score > 0.68) { bestS = score; bestC = c; }
    }
    if (bestC && bestS >= 0.72) {
      return { pred: tx[tx.length - bestC] === "T" ? "tài" : "xỉu", conf: Math.min(96, Math.round(84 + bestS * 14)), src: `Tần số cộng hưởng L${bestC}` };
    }

    // Hồi quy Gauss biên độ cao (2.5 Sigma)
    if (totals && totals.length >= 15) {
      const recentWindow = totals.slice(-7);
      const m = avg(recentWindow);
      const zScore = (m - 10.5) / 2.96;
      if (zScore >= 2.0) return { pred: "xỉu", conf: 92, src: "Hút điểm chuẩn Gauss (Max)" };
      if (zScore <= -2.0) return { pred: "tài", conf: 92, src: "Đẩy điểm chuẩn Gauss (Min)" };
    }

    return null;
  }
}

// --- TẦNG 3: ĐỘNG LƯỢNG MẶT XÚC XẮC & KMP TỐI ƯU ---
class MasterQuantEngine {
  get(history) {
    if (!history || history.length < 15) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const dice = history.map(h => h.dice);

    const e20 = entropy(tx.slice(-20));
    if (e20 < 0.25) return { pred: tx[tx.length - 1] === "T" ? "xỉu" : "tài", conf: 96, src: "Điểm vỡ Entropy" };

    const seq = tx.map(v => (v === "T" ? 1 : 0));
    const maxPatLen = Math.min(12, Math.floor(seq.length / 3));
    for (let len = maxPatLen; len >= 4; len--) {
      const target = seq.slice(-len);
      let hits = 0, nxt = null;
      for (let i = 0; i <= seq.length - len - 1; i++) {
        let match = true;
        for (let j = 0; j < len; j++) if (seq[i + j] !== target[j]) { match = false; break; }
        if (match) { hits++; if (nxt === null && i + len < seq.length) nxt = seq[i + len]; }
      }
      if (nxt !== null && hits >= 3) {
        return { pred: nxt === 1 ? "tài" : "xỉu", conf: Math.min(98, 86 + len * 2 + hits), src: `Bản đồ khối KMP (${len})` };
      }
    }

    const recentDice = dice.slice(-6);
    let lowFaces = 0, highFaces = 0;
    for (const d of recentDice) {
      for (const val of d) {
        if (val <= 2) lowFaces++;
        if (val >= 5) highFaces++;
      }
    }
    if (lowFaces >= 10) return { pred: "tài", conf: 92, src: "Nén bề mặt xúc xắc (1-2)" };
    if (highFaces >= 10) return { pred: "xỉu", conf: 92, src: "Nén bề mặt xúc xắc (5-6)" };

    return null;
  }
}

// BỘ ĐỆM BẢO VỆ CHUỖI THUA & ĐẢO CHIỀU TỰ ĐỘNG
class HedgeTracker {
  constructor(game) {
    this.game = game;
    this.outcomes = store[game]?.outcomes || [];
    this.streakOk = 0;
    this.streakNg = 0;
    this.reverse = false;
    this.weights = { p: 0.38, s: 0.32, q: 0.30 };
  }

  record(session, pred, actual, src) {
    const ok = pred === actual;
    this.outcomes.push({ session, pred, actual, ok, src, ts: Date.now() });
    if (this.outcomes.length > 250) this.outcomes = this.outcomes.slice(-200);
    store[this.game].outcomes = this.outcomes;
    saveStore(store);

    if (ok) {
      this.streakOk++; this.streakNg = 0;
      if (this.reverse && this.streakOk >= 2) this.reverse = false;
      this.updateW(src, 0.03);
    } else {
      this.streakNg++; this.streakOk = 0;
      // QUAN TRỌNG: Thua 2 tay là lập tức đảo ngược logic để rà đúng nhịp nhà cái
      if (this.streakNg >= 2 && !this.reverse) this.reverse = true;
      this.updateW(src, -0.04);
    }
  }

  updateW(src, delta) {
    let cat = "q";
    if (src.includes("bệt") || src.includes("đảo") || src.includes("đôi") || src.includes("tiến") || src.includes("nhịp")) cat = "p";
    else if (src.includes("Markov") || src.includes("sóng") || src.includes("Gauss")) cat = "s";

    this.weights[cat] = Math.max(0.15, Math.min(0.7, this.weights[cat] + delta));
    const sum = this.weights.p + this.weights.s + this.weights.q;
    this.weights.p /= sum; this.weights.s /= sum; this.weights.q /= sum;
  }

  applyRev(p) { return this.reverse ? (p === "tài" ? "xỉu" : "tài") : p; }
  recentAcc(n = 30) {
    const r = this.outcomes.slice(-n);
    return r.length ? r.filter(o => o.ok).length / r.length : 0.5;
  }
  adjustConf(base) {
    let c = base;
    const acc = this.recentAcc(30);
    if (acc >= 0.70) c += 5; else if (acc < 0.40) c -= 7;
    if (this.streakOk >= 3) c += 4;
    if (this.reverse) c -= 3;
    return Math.min(99, Math.max(72, Math.round(c)));
  }
  status() {
    return {
      reverse: this.reverse,
      acc30: Math.round(this.recentAcc(30) * 100) + "%",
      lastOutcomes: this.outcomes.slice(-30).reverse()
    };
  }
}

class HelixCore {
  constructor(game, url, parse) {
    this.game = game; this.url = url; this.parse = parse;
    this.history = []; this.sessionIds = new Set(); this.curId = null;
    this.pE = new MasterPatternEngine(); this.sE = new MasterStatisticalEngine(); this.qE = new MasterQuantEngine();
    this.tracker = new HedgeTracker(game);
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
      
      const list = this.parse(await res.json());
      if (!list || !list.length) return;

      const fresh = list.filter(r => !this.sessionIds.has(r.session));
      if (!fresh.length && this.history.length) return;

      if (!this.curId) {
        this.history = list.filter(r => this.sessionIds.has(r.session));
        this.curId = this.history.at(-1)?.session || null;
        this.generatePrediction(); return;
      }

      const news = list.filter(r => r.session > this.curId && !this.history.some(h => h.session === r.session));
      for (const rec of news) {
        if (this.activePred && rec.session === this.activePred.session) {
          this.tracker.record(rec.session, this.activePred.pred, rec.tx === "T" ? "tài" : "xỉu", this.activePred.src);
          this.activePred = null; store[this.game].activePred = null; saveStore(store);
        }
        this.history.push(rec); this.sessionIds.add(rec.session);
      }
      if (this.history.length > 500) {
        this.history = this.history.slice(-400); this.sessionIds = new Set(this.history.map(h => h.session));
      }
      if (news.length) { this.curId = this.history.at(-1).session; this.generatePrediction(); }
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
    if (this.activePred && this.activePred.session === nextSession) return this.activePred;

    const tx = this.history.map(h => h.tx);
    const totals = this.history.map(h => h.total);
    const cands = [];

    const p = this.pE.get(tx); if (p) cands.push({ ...p, w: this.tracker.weights.p });
    const s = this.sE.get(tx, totals); if (s) cands.push({ ...s, w: this.tracker.weights.s });
    const q = this.qE.get(this.history); if (q) cands.push({ ...q, w: this.tracker.weights.q });

    let pred, conf, src;
    if (!cands.length) {
      pred = tx[tx.length - 1] === "T" ? "tài" : "xỉu"; conf = 76; src = "Động lượng xu hướng mờ";
    } else {
      const score = { "tài": 0, "xỉu": 0 };
      const best = { "tài": null, "xỉu": null };
      for (const c of cands) {
        score[c.pred] += c.conf * c.w;
        if (!best[c.pred] || c.conf > best[c.pred].conf) best[c.pred] = c;
      }
      pred = score["tài"] >= score["xỉu"] ? "tài" : "xỉu";
      conf = best[pred].conf; src = best[pred].src;
      if (cands.filter(c => c.pred === pred).length >= 2) conf = Math.min(99, conf + 5);
    }

    pred = this.tracker.applyRev(pred);
    conf = this.tracker.adjustConf(conf);

    this.activePred = { session: nextSession, pred, conf, src, reverse: this.tracker.reverse, ts: Date.now() };
    store[this.game].activePred = this.activePred; saveStore(store);
    return this.activePred;
  }

  getPrediction() {
    if (!this.activePred || this.activePred.session !== (this.history.at(-1)?.session || 0) + 1) return this.generatePrediction();
    return this.activePred;
  }
  last() { return this.history.at(-1); }
}

function parseStream(data) {
  let list = Array.isArray(data) ? data : (data?.data || data?.list || []);
  if (!Array.isArray(list)) return [];
  return list.map(i => {
    const session = Number(i.session || i.id || i.phien || i.Phien || 0);
    let dice = i.dices || i.dice || i.xucxac || [1, 1, 1];
    if (typeof dice === "string") dice = dice.split(/[,-]/).map(Number);
    const total = Number(i.total || i.point || i.diem || (dice[0] + dice[1] + dice[2]));
    return { session, dice, total, result: total >= 11 ? "tai" : "xiu", tx: total >= 11 ? "T" : "X" };
  }).filter(i => i.session > 0).sort((a, b) => a.session - b.session);
}

const hu = new HelixCore("hu", API_HU, parseStream);
const md5 = new HelixCore("md5", API_MD5, parseStream);

function checkKey(q) {
  return q?.key === VALID_KEY 
    ? { ok: true } 
    : { ok: false, error: !q?.key ? "VUI LÒNG NHẬP MÃ BẢN QUYỀN" : "MÃ KHÓA BẢN QUYỀN KHÔNG ĐÚNG", contact: "Telegram: @anhkhoi_xabc" };
}

async function bootstrap() {
  const app = fastify({ logger: false });
  await app.register(cors, { origin: "*" });
  await app.register(fastifyStatic, { root: existsSync(path.join(__dirname, "public")) ? path.join(__dirname, "public") : __dirname, prefix: "/", index: "index.html" });

  app.get("/api/dashboard", async (req, reply) => {
    const ck = checkKey(req.query);
    if (!ck.ok) return reply.status(401).send({ error: ck.error, contact: ck.contact });

    const build = (eng) => {
      const l = eng.last();
      const p = eng.history.length >= 8 ? eng.getPrediction() : null;
      const st = eng.tracker.status();
      return {
        last: l ? { session: l.session, dice: l.dice, total: l.total, result: l.result } : null,
        prediction: p ? { session: p.session, pred: p.pred, conf: p.conf, src: p.src, reverse: p.reverse } : null,
        acc30: st.acc30, outcomes: st.lastOutcomes, reverse: st.reverse,
        history: eng.history.slice(-30).reverse().map(h => ({ s: h.session, d: h.dice, t: h.total, r: h.result, tx: h.tx }))
      };
    };
    return { hu: build(hu), md5: build(md5), ts: Date.now() };
  });

  hu.start(4000); md5.start(4000);

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`[HELIX-VIP-18] Khởi động thành công trên cổng :${PORT}`);
  } catch (err) {
    console.error(err); process.exit(1);
  }
}
bootstrap();
