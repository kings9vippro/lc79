import fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const VALID_KEY = Buffer.from("ZG9jcmFja2hpaGk=", "base64").toString("utf8");
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

const API_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

if (!existsSync(DATA_DIR)) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

// --- TIỆN ÍCH TOÁN HỌC & ENTROPY ---
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

// --- TẦNG 1: THUẬT TOÁN BẮT CẦU CƠ BẢN ---
class BasicPatterns {
  get(tx) {
    if (!tx || tx.length < 4) return null;
    const last = tx[tx.length - 1];
    const s = streakLen(tx);

    if (s >= 7) return { pred: last === "T" ? "xỉu" : "tài", conf: 89, src: `Bẻ bệt (${s} tay)` };
    if (s >= 4 && s < 7) return { pred: last === "T" ? "tài" : "xỉu", conf: 84 + (s - 4) * 2, src: `Đu bệt (${s} tay)` };

    const last6 = tx.slice(-6);
    if (last6.length === 6 && last6.every((v, i) => i === 0 || v !== last6[i - 1])) {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 86, src: "Cầu đảo 1-1" };
    }

    const last4 = tx.slice(-4);
    if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
      return { pred: last4[3] === "T" ? "xỉu" : "tài", conf: 83, src: "Cầu đôi 2-2" };
    }

    const seq6 = tx.slice(-6).join("");
    if (seq6 === "TTTXXT" || seq6 === "XXXTTX") {
      return { pred: last === "T" ? "tài" : "xỉu", conf: 85, src: "Cầu gãy 3-2-1" };
    }
    if (seq6 === "TXXTTT" || seq6 === "XTTXXX") {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 85, src: "Cầu tiến 1-2-3" };
    }

    const last5 = tx.slice(-5).join("");
    if (last5 === "TTXTT" || last5 === "XXTXX") {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 82, src: "Cầu kẹp 2-1-2" };
    }

    const last4Seq = tx.slice(-4).join("");
    if (last4Seq === "TTTX" || last4Seq === "XXXT") {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 81, src: "Cầu nhịp 3-1" };
    }
    if (last4Seq === "TXXX" || last4Seq === "XTTT") {
      return { pred: last === "T" ? "tài" : "xỉu", conf: 81, src: "Cầu nhịp 1-3" };
    }

    return null;
  }
}

// --- TẦNG 2: THUẬT TOÁN NÂNG CAO (MARKOV, CHU KỲ, Z-SCORE) ---
class AdvancedPatterns {
  get(tx, totals) {
    if (!tx || tx.length < 10) return null;

    if (tx.length >= 16) {
      const state2 = tx.slice(-2).join("");
      const trans = { T: 0, X: 0 };
      for (let i = 0; i < tx.length - 2; i++) {
        if (tx[i] + tx[i + 1] === state2) {
          const next = tx[i + 2];
          if (next === "T") trans.T++;
          else if (next === "X") trans.X++;
        }
      }
      const sumT = trans.T + trans.X;
      if (sumT >= 3) {
        const probT = (trans.T + 1) / (sumT + 2); // Laplace smoothing
        if (probT >= 0.65) return { pred: "tài", conf: Math.round(76 + probT * 18), src: "Markov bậc 2" };
        if (probT <= 0.35) return { pred: "xỉu", conf: Math.round(76 + (1 - probT) * 18), src: "Markov bậc 2" };
      }
    }

    let bestC = 0, bestS = 0;
    for (let c = 2; c <= 8; c++) {
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
      const predictedVal = tx[tx.length - bestC];
      return {
        pred: predictedVal === "T" ? "tài" : "xỉu",
        conf: Math.min(94, Math.round(80 + bestS * 15)),
        src: `Chu kỳ lặp ${bestC} tay`
      };
    }

    if (totals && totals.length >= 14) {
      const shortAvg = avg(totals.slice(-5));
      const sStd = std(totals.slice(-5));
      const zScore = (shortAvg - 10.5) / (sStd || 1.0);

      if (zScore > 1.4) return { pred: "xỉu", conf: 86, src: "Hồi quy đỉnh điểm" };
      if (zScore < -1.4) return { pred: "tài", conf: 86, src: "Hồi quy đáy điểm" };
    }

    return null;
  }
}

// --- TẦNG 3: THUẬT TOÁN CAO CẤP (SHANNON ENTROPY, KMP, TỔ HỢP XÚC XẮC) ---
class ElitePatterns {
  get(history) {
    if (!history || history.length < 12) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const dice = history.map(h => h.dice);

    const e16 = entropy(tx.slice(-16));
    if (e16 < 0.30) {
      const last = tx[tx.length - 1];
      return { pred: last === "T" ? "xỉu" : "tài", conf: 93, src: "Bão hòa Entropy" };
    }

    const seq = tx.map(v => (v === "T" ? 1 : 0));
    const maxPatLen = Math.min(9, Math.floor(seq.length / 3));
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
          conf: Math.min(96, 81 + len * 2 + hits),
          src: `Mẫu lịch sử (${len} nhịp)`
        };
      }
    }

    const recentD = dice.slice(-5);
    let lowFaces = 0, highFaces = 0;
    for (const d of recentD) {
      for (const val of d) {
        if (val <= 2) lowFaces++;
        if (val >= 5) highFaces++;
      }
    }
    if (lowFaces >= 9) return { pred: "tài", conf: 88, src: "Tụ lực mặt nhỏ" };
    if (highFaces >= 9) return { pred: "xỉu", conf: 88, src: "Tụ lực mặt lớn" };

    let mom = 0;
    for (let i = 1; i < Math.min(8, totals.length); i++) {
      const delta = totals[totals.length - i] - totals[totals.length - i - 1];
      if (delta >= 3) mom++;
      else if (delta <= -3) mom--;
    }
    if (Math.abs(mom) >= 4) {
      return { pred: mom > 0 ? "xỉu" : "tài", conf: 85 + Math.abs(mom), src: "Động lượng điểm" };
    }

    return null;
  }
}

// --- BỘ LỌC PHÁT HIỆN CẦU BẺ / BẪY BÃO SỐ ---
class CheatGuard {
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

function loadStore() {
  try {
    if (existsSync(STORE_FILE)) return JSON.parse(readFileSync(STORE_FILE, "utf8"));
  } catch {}
  return { hu: { preds: [], outcomes: [] }, md5: { preds: [], outcomes: [] } };
}

function saveStore(s) {
  try { writeFileSync(STORE_FILE, JSON.stringify(s)); } catch {}
}

const store = loadStore();

class Tracker {
  constructor(game) {
    this.game = game;
    this.preds = store[game]?.preds || [];
    this.outcomes = store[game]?.outcomes || [];
    this.streakOk = 0;
    this.streakNg = 0;
    this.reverse = false;
    this.wBasic = 0.34;
    this.wAdv = 0.36;
    this.wElite = 0.30;
  }

  record(session, pred, actual, src) {
    const ok = pred === actual;
    this.outcomes.push({ session, pred, actual, ok, src, ts: Date.now() });
    if (this.outcomes.length > 300) this.outcomes = this.outcomes.slice(-250);
    if (!store[this.game]) store[this.game] = { preds: [], outcomes: [] };
    store[this.game].outcomes = this.outcomes;
    saveStore(store);

    if (ok) {
      this.streakOk++;
      this.streakNg = 0;
      if (this.reverse && this.streakOk >= 2) this.reverse = false;
      this.updateWeights(src, +0.02);
    } else {
      this.streakNg++;
      this.streakOk = 0;
      if (this.streakNg >= 2 && !this.reverse) this.reverse = true;
      this.updateWeights(src, -0.03);
    }
    this.normalize();
  }

  updateWeights(src, delta) {
    const s = src || "";
    if (s.includes("bệt") || s.includes("1-1") || s.includes("2-2") || s.includes("tiến") || s.includes("gãy") || s.includes("nhịp")) {
      this.wBasic = Math.max(0.15, Math.min(0.6, this.wBasic + delta));
    } else if (s.includes("Markov") || s.includes("Chu kỳ") || s.includes("Hồi quy")) {
      this.wAdv = Math.max(0.15, Math.min(0.6, this.wAdv + delta));
    } else {
      this.wElite = Math.max(0.15, Math.min(0.6, this.wElite + delta));
    }
  }

  normalize() {
    const t = this.wBasic + this.wAdv + this.wElite;
    this.wBasic /= t;
    this.wAdv /= t;
    this.wElite /= t;
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
    if (acc >= 0.75) c += 7;
    else if (acc >= 0.60) c += 3;
    else if (acc < 0.40) c -= 6;
    if (this.streakOk >= 3) c += 4;
    if (this.reverse) c -= 2;
    return Math.min(98, Math.max(66, Math.round(c)));
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

class Engine {
  constructor(game, url, parse) {
    this.game = game;
    this.url = url;
    this.parse = parse;
    this.history = [];
    this.sessionIds = new Set();
    this.curId = null;
    this.basic = new BasicPatterns();
    this.adv = new AdvancedPatterns();
    this.elite = new ElitePatterns();
    this.guard = new CheatGuard();
    this.tracker = new Tracker(game);
    this.pendingPred = null;
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
        return;
      }

      const news = list.filter(r => r.session > this.curId && !this.history.some(h => h.session === r.session));
      for (const rec of news) {
        if (this.pendingPred && rec.session === this.pendingPred.session) {
          const actual = rec.tx === "T" ? "tài" : "xỉu";
          this.tracker.record(rec.session, this.pendingPred.pred, actual, this.pendingPred.src);
          this.pendingPred = null;
        }
        this.history.push(rec);
        this.sessionIds.add(rec.session);
      }
      if (this.history.length > 500) {
        this.history = this.history.slice(-400);
        this.sessionIds = new Set(this.history.map(h => h.session));
      }
      if (news.length) this.curId = this.history.at(-1).session;
    } catch {}
  }

  start(ms = 4000) {
    this.pull();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.pull(), ms);
  }

  predict() {
    if (this.history.length < 8) return null;
    const tx = this.history.map(h => h.tx);
    const totals = this.history.map(h => h.total);

    const advice = this.guard.check(this.history);
    const cands = [];

    const b = this.basic.get(tx);
    if (b) cands.push({ ...b, w: this.tracker.wBasic });
    const a = this.adv.get(tx, totals);
    if (a) cands.push({ ...a, w: this.tracker.wAdv });
    const e = this.elite.get(this.history);
    if (e) cands.push({ ...e, w: this.tracker.wElite });

    let pred, conf, src;
    if (!cands.length) {
      const last = tx[tx.length - 1];
      pred = last === "T" ? "xỉu" : "tài";
      conf = 70;
      src = "Đảo cầu ngẫu nhiên";
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
      conf = Math.max(66, conf - 5);
    }

    pred = this.tracker.applyRev(pred);
    conf = this.tracker.adjustConf(conf);

    const nextSession = (this.history.at(-1)?.session || 0) + 1;
    this.pendingPred = { session: nextSession, pred, conf, src };
    if (!store[this.game]) store[this.game] = { preds: [], outcomes: [] };
    store[this.game].preds = (store[this.game].preds || []).filter(p => p.session >= nextSession - 5);
    store[this.game].preds.push({ ...this.pendingPred, ts: Date.now() });
    if (store[this.game].preds.length > 50) store[this.game].preds = store[this.game].preds.slice(-40);
    saveStore(store);

    return {
      prediction: pred,
      confidence: conf,
      src,
      reverse: this.tracker.reverse,
      cheat: advice !== "binh_thuong",
      nextSession
    };
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

const hu = new Engine("hu", API_HU, parseStream);
const md5 = new Engine("md5", API_MD5, parseStream);

for (const g of ["hu", "md5"]) {
  const eng = g === "hu" ? hu : md5;
  const lasts = (store[g]?.preds || []).slice(-3);
  if (lasts.length) eng.pendingPred = lasts.at(-1);
}

function checkKey(q) {
  const k = q?.key;
  if (!k) return { ok: false, error: "VUI LÒNG NHẬP MÃ BẢN QUYỀN", contact: "Liên hệ Telegram: @anhkhoi_xabc" };
  if (k !== VALID_KEY) return { ok: false, error: "MÃ KHÓA BẢN QUYỀN KHÔNG ĐÚNG", contact: "Liên hệ Telegram: @anhkhoi_xabc" };
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

  app.get("/api/taixiu/lc79", async (req, reply) => {
    const ck = checkKey(req.query);
    if (!ck.ok) return reply.status(401).send({ error: ck.error, contact: ck.contact });
    const last = hu.last();
    if (!last || hu.history.length < 8) return reply.status(503).send({ error: "Đang nạp dữ liệu Hũ..." });
    const p = hu.predict();
    return {
      NguoiPhatHanh: "Dev Anh Khôi",
      PhienTruoc: last.session,
      XucXac: `${last.dice[0]} - ${last.dice[1]} - ${last.dice[2]}`,
      KetQua: last.result.toLowerCase(),
      PhienNay: p.nextSession,
      DuDoan: p.prediction,
      DoTinCay: p.confidence + "%"
    };
  });

  app.get("/api/taixiumd5/lc79", async (req, reply) => {
    const ck = checkKey(req.query);
    if (!ck.ok) return reply.status(401).send({ error: ck.error, contact: ck.contact });
    const last = md5.last();
    if (!last || md5.history.length < 8) return reply.status(503).send({ error: "Đang nạp dữ liệu MD5..." });
    const p = md5.predict();
    return {
      NguoiPhatHanh: "Dev Anh Khôi",
      PhienTruoc: last.session,
      XucXac: `${last.dice[0]} - ${last.dice[1]} - ${last.dice[2]}`,
      KetQua: last.result.toLowerCase(),
      PhienNay: p.nextSession,
      DuDoan: p.prediction,
      DoTinCay: p.confidence + "%"
    };
  });

  app.get("/check-key", async (req) => {
    const k = req.query.key;
    if (!k) return { status: "error", message: "CHƯA NHẬP KEY", contact: "Liên hệ Telegram: @anhkhoi_xabc" };
    if (k === VALID_KEY) return { status: "success", message: "KEY HỢP LỆ - XÁC THỰC THÀNH CÔNG" };
    return { status: "error", message: "KEY SAI", contact: "Liên hệ Telegram: @anhkhoi_xabc" };
  });

  app.get("/api/dashboard", async (req, reply) => {
    const ck = checkKey(req.query);
    if (!ck.ok) return reply.status(401).send({ error: ck.error, contact: ck.contact });

    const build = (eng) => {
      const last = eng.last();
      const p = eng.history.length >= 8 ? eng.predict() : null;
      const st = eng.tracker.status();
      return {
        last: last ? {
          session: last.session,
          dice: last.dice,
          total: last.total,
          result: last.result.toLowerCase()
        } : null,
        prediction: p ? {
          session: p.nextSession,
          pred: p.prediction,
          conf: p.confidence,
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
    console.log(`[HELIX-ENGINE] Máy chủ hoạt động trên cổng :${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
