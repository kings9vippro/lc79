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

// Nguồn cấp dữ liệu chuẩn
const API_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://lc79-taixiumd5-dulieu.onrender.com/data";

if (!existsSync(DATA_DIR)) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

// --- TIỆN ÍCH TOÁN HỌC & ĐO LƯỜNG ENTROPY ---
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

// --- QUẢN LÝ DỮ LIỆU ĐỒNG BỘ TRÁNH MẤT PHIÊN ---
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

// --- TẦNG 1: THUẬT TOÁN ĐU SÓNG THỰC CHIẾN (MOMENTUM ENGINE) ---
class MomentumPatternEngine {
  get(tx) {
    if (!tx || tx.length < 4) return null;
    const last = tx[tx.length - 1];
    const s = streakLen(tx);

    // Chiến thuật bám bệt: Đu từ tay 3 đến tay 8
    if (s >= 3 && s <= 8) {
      return { pred: last === "T" ? "tài" : "xỉu", conf: 86 + Math.min(10, s * 1.5), src: `Đu sóng bệt (${s} tay)` };
    }
    if (s > 8) {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 92, src: `Đỉnh bệt bão hòa (${s} tay)` };
    }

    // Cầu đảo 1-1 (Ping-pong)
    const last6 = tx.slice(-6);
    if (last6.length === 6 && last6.every((v, i) => i === 0 || v !== last6[i - 1])) {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 90, src: "Bắt nhịp đảo 1-1" };
    }

    // Cầu đôi đối xứng 2-2
    const last4 = tx.slice(-4);
    if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
      return { pred: last4[3] === "T" ? "xỉu" : "tài", conf: 88, src: "Khóa cầu đôi 2-2" };
    }

    // Cầu bậc thang 3-2-1 & 1-2-3
    const seq6 = tx.slice(-6).join("");
    if (seq6 === "TTTXXT" || seq6 === "XXXTTX") return { pred: last === "T" ? "tài" : "xỉu", conf: 88, src: "Cầu gãy 3-2-1" };
    if (seq6 === "TXXTTT" || seq6 === "XTTXXX") return { pred: last === "T" ? "xỉu" : "tài", conf: 88, src: "Cầu tiến 1-2-3" };

    // Cầu kẹp 2-1-2
    const last5 = tx.slice(-5).join("");
    if (last5 === "TTXTT" || last5 === "XXTXX") return { pred: last === "T" ? "xỉu" : "tài", conf: 86, src: "Cầu kẹp 2-1-2" };

    // Nhịp 3-1 & 1-3
    const last4Seq = tx.slice(-4).join("");
    if (last4Seq === "TTTX" || last4Seq === "XXXT") return { pred: last === "T" ? "xỉu" : "tài", conf: 85, src: "Cầu nhịp 3-1" };
    if (last4Seq === "TXXX" || last4Seq === "XTTT") return { pred: last === "T" ? "tài" : "xỉu", conf: 85, src: "Cầu nhịp 1-3" };

    return null;
  }
}

// --- TẦNG 2: MARKOV BẬC 3 & PHÂN PHỐI CHUẨN GAUSS (STATISTICAL GAUSS ENGINE) ---
class DeepStatisticalEngine {
  get(tx, totals) {
    if (!tx || tx.length < 10) return null;

    // 1. Phân tích xác suất Markov bậc 3 có trọng số Dirichlet
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
        if (probT >= 0.65) return { pred: "tài", conf: Math.round(81 + probT * 15), src: "Markov K3 xác suất cao" };
        if (probT <= 0.35) return { pred: "xỉu", conf: Math.round(81 + (1 - probT) * 15), src: "Markov K3 xác suất cao" };
      }
    }

    // 2. Tương quan bước sóng Lag 2-10
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
        conf: Math.min(96, Math.round(83 + bestS * 14)),
        src: `Chu kỳ bước sóng ${bestC}`
      };
    }

    // 3. Chuẩn hóa độ lệch Gaussian Z-Score (Mean = 10.5, Std = 2.96)
    if (totals && totals.length >= 12) {
      const recentWindow = totals.slice(-6);
      const m = avg(recentWindow);
      const zScore = (m - 10.5) / 2.96;
      if (zScore >= 1.68) return { pred: "xỉu", conf: 91, src: "Đỉnh điểm chuẩn Gauss" };
      if (zScore <= -1.68) return { pred: "tài", conf: 91, src: "Đáy điểm chuẩn Gauss" };
    }

    return null;
  }
}

// --- TẦNG 3: ENTROPY, KMP SEARCH & MẶT XÍ NGẦU VIP (QUANT ENGINE) ---
class EliteQuantEngine {
  get(history) {
    if (!history || history.length < 12) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const dice = history.map(h => h.dice);

    // 1. Phân tích bão hòa Entropy
    const e16 = entropy(tx.slice(-16));
    if (e16 < 0.28) {
      const last = tx[tx.length - 1];
      return { pred: last === "T" ? "xỉu" : "tài", conf: 95, src: "Bão hòa Entropy" };
    }

    // 2. KMP Đối sánh lịch sử sâu
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
          conf: Math.min(97, 85 + len * 2 + hits),
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

    // 4. Vector động lượng tổng điểm
    let mom = 0;
    for (let i = 1; i < Math.min(8, totals.length); i++) {
      const delta = totals[totals.length - i] - totals[totals.length - i - 1];
      if (delta >= 3) mom++;
      else if (delta <= -3) mom--;
    }
    if (Math.abs(mom) >= 4) {
      return { pred: mom > 0 ? "xỉu" : "tài", conf: 88 + Math.abs(mom), src: "Động lượng điểm số" };
    }

    return null;
  }
}

// --- TẦNG 4: HỌC MÁY THÍCH NGHI ĐA MÔ HÌNH (HEDGE WEIGHT LEARNING) ---
class AdaptiveMachineLearningTracker {
  constructor(game) {
    this.game = game;
    this.outcomes = store[game]?.outcomes || [];
    this.streakOk = 0;
    this.streakNg = 0;
    this.reverse = false;
    
    // Trọng số học máy động khởi tạo
    this.weights = {
      momentum: 0.36,
      statistical: 0.34,
      quant: 0.30
    };
  }

  record(session, pred, actual, src) {
    const ok = pred === actual;
    this.outcomes.push({ session, pred, actual, ok, src, ts: Date.now() });

    // Giữ bộ đệm vừa đủ, bảo đảm xuất đủ 30 phiên kiểm định
    if (this.outcomes.length > 250) this.outcomes = this.outcomes.slice(-200);
    store[this.game].outcomes = this.outcomes;
    saveStore(store);

    // Cập nhật trọng số theo thuật toán Hedge Multiplicative Update
    const eta = 0.08; // Tốc độ học (learning rate)
    let category = "momentum";
    if (src.includes("Markov") || src.includes("sóng") || src.includes("Gauss")) category = "statistical";
    else if (src.includes("KMP") || src.includes("Entropy") || src.includes("Tụ lực") || src.includes("Động lượng")) category = "quant";

    if (ok) {
      this.streakOk++;
      this.streakNg = 0;
      if (this.reverse && this.streakOk >= 2) this.reverse = false;
      this.weights[category] *= Math.exp(eta);
    } else {
      this.streakNg++;
      this.streakOk = 0;
      // Cắt chuỗi gãy cầu: Thua liên tiếp 2 tay tự động đảo cầu
      if (this.streakNg >= 2 && !this.reverse) this.reverse = true;
      this.weights[category] *= Math.exp(-eta);
    }

    // Chuẩn hóa tổng trọng số về 1.0 (Sum = 1)
    const sumW = this.weights.momentum + this.weights.statistical + this.weights.quant;
    this.weights.momentum /= sumW;
    this.weights.statistical /= sumW;
    this.weights.quant /= sumW;
  }

  applyRev(p) {
    return this.reverse ? (p === "tài" ? "xỉu" : "tài") : p;
  }

  recentAcc(n = 30) {
    const r = this.outcomes.slice(-n);
    if (!r.length) return 0.5;
    return r.filter(o => o.ok).length / r.length;
  }

  adjustConf(base) {
    let c = base;
    const acc = this.recentAcc(30);
    if (acc >= 0.75) c += 6;
    else if (acc >= 0.60) c += 3;
    else if (acc < 0.40) c -= 6;
    if (this.streakOk >= 3) c += 4;
    if (this.reverse) c -= 2;
    return Math.min(98, Math.max(70, Math.round(c)));
  }

  status() {
    return {
      reverse: this.reverse,
      streakOk: this.streakOk,
      streakNg: this.streakNg,
      acc30: Math.round(this.recentAcc(30) * 100) + "%",
      weights: {
        momentum: Math.round(this.weights.momentum * 100) + "%",
        statistical: Math.round(this.weights.statistical * 100) + "%",
        quant: Math.round(this.weights.quant * 100) + "%"
      },
      lastOutcomes: this.outcomes.slice(-30).reverse() // Xuất chuẩn 30 phiên
    };
  }
}

// --- BỘ LỌC CẢNH BÁO BÃI CẦU BÃO SỐ ---
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

// --- ENGINE ĐIỀU PHỐI HELIX TRUNG TÂM ---
class HelixEngine {
  constructor(game, url, parse) {
    this.game = game;
    this.url = url;
    this.parse = parse;
    this.history = [];
    this.sessionIds = new Set();
    this.curId = null;
    this.momentum = new MomentumPatternEngine();
    this.statistical = new DeepStatisticalEngine();
    this.quant = new EliteQuantEngine();
    this.guard = new RiskGuard();
    this.tracker = new AdaptiveMachineLearningTracker(game);
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
      const rawData = await res.json();
      const list = this.parse(rawData);
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

    const p = this.momentum.get(tx);
    if (p) cands.push({ ...p, w: this.tracker.weights.momentum });
    const s = this.statistical.get(tx, totals);
    if (s) cands.push({ ...s, w: this.tracker.weights.statistical });
    const q = this.quant.get(this.history);
    if (q) cands.push({ ...q, w: this.tracker.weights.quant });

    let pred, conf, src;
    if (!cands.length) {
      const last = tx[tx.length - 1];
      pred = last === "T" ? "tài" : "xỉu";
      conf = 75;
      src = "Bám đà chuyển động";
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
      if (consensus >= 2) conf = Math.min(98, conf + 5);
    }

    if (advice === "dao_chieu") {
      pred = pred === "tài" ? "xỉu" : "tài";
      conf = Math.min(98, conf + 4);
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

// Bóc tách dữ liệu tương thích đa nguồn (Hỗ trợ cấu trúc mảng hoặc bọc data/list)
function parseDataFeed(data) {
  let list = Array.isArray(data) ? data : (data?.data || data?.list || []);
  if (!Array.isArray(list)) return [];
  return list.map(i => {
    const session = Number(i.session || i.id || i.phien || i.Phien || 0);
    let dice = i.dices || i.dice || i.xucxac || [1, 1, 1];
    if (typeof dice === "string") dice = dice.split(/[,-]/).map(Number);
    const total = Number(i.total || i.point || i.diem || (dice[0] + dice[1] + dice[2]));
    const tx = (i.tx || (total >= 11 ? "T" : "X")).toUpperCase();
    const result = i.result || (total >= 11 ? "tai" : "xiu");
    return { session, dice, total, result, tx };
  }).filter(i => i.session > 0).sort((a, b) => a.session - b.session);
}

const hu = new HelixEngine("hu", API_HU, parseDataFeed);
const md5 = new HelixEngine("md5", API_MD5, parseDataFeed);

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
        acc30: st.acc30,
        streakOk: st.streakOk,
        streakNg: st.streakNg,
        weights: st.weights,
        outcomes: st.lastOutcomes, // 30 phiên
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
    console.log(`[HELIX-QUANT-18] Khởi động thành công trên cổng :${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
