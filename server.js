import fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ENCODED_KEY = "ZG9jcmFja2hpaGk=";
const VALID_KEY = Buffer.from(ENCODED_KEY, "base64").toString("utf8");
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

const API_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ---------- UTIL ----------
function avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function std(a) {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(avg(a.map(n => (n - m) ** 2)));
}
function entropy(arr) {
  if (!arr.length) return 0;
  const f = {};
  for (const v of arr) f[v] = (f[v] || 0) + 1;
  let e = 0, n = arr.length;
  for (const k in f) { const p = f[k] / n; e -= p * Math.log2(p); }
  return e;
}
function streakLen(tx) {
  if (!tx.length) return 0;
  let s = 1;
  for (let i = tx.length - 2; i >= 0; i--) {
    if (tx[i] === tx[tx.length - 1]) s++;
    else break;
  }
  return s;
}

// ---------- PERSISTENCE ----------
function loadStore() {
  try {
    if (existsSync(STORE_FILE)) return JSON.parse(readFileSync(STORE_FILE, "utf8"));
  } catch {}
  return { hu: { preds: [], outcomes: [] }, md5: { preds: [], outcomes: [] } };
}
function saveStore(store) {
  try { writeFileSync(STORE_FILE, JSON.stringify(store)); } catch {}
}
let store = loadStore();

// ---------- PATTERN ENGINES ----------
class BasicPatterns {
  // Cầu bệt, 1-1, 2-1, 3-1, 2-2
  get(tx) {
    if (tx.length < 4) return null;
    const last = tx[tx.length - 1];
    const s = streakLen(tx);

    if (s >= 6) return { pred: last === "T" ? "xỉu" : "tài", conf: 86 + Math.min(8, s), src: "bet-" + s };
    if (s === 5) return { pred: last === "T" ? "xỉu" : "tài", conf: 84, src: "bet-5" };
    if (s === 4) return { pred: last === "T" ? "xỉu" : "tài", conf: 80, src: "bet-4" };

    // 1-1
    const last6 = tx.slice(-6);
    if (last6.length === 6 && last6.every((v, i) => i === 0 || v !== last6[i - 1])) {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 82, src: "1-1" };
    }

    // 2-1 / 1-2
    const last4 = tx.slice(-4);
    if (last4.join("") === "TTXT" || last4.join("") === "XXTX") {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 78, src: "2-1" };
    }
    if (last4.join("") === "TXXT" || last4.join("") === "XTTX") {
      return { pred: last === "T" ? "tài" : "xỉu", conf: 78, src: "1-2" };
    }

    // 2-2
    if (tx.length >= 4) {
      const a = tx.slice(-4);
      if (a[0] === a[1] && a[2] === a[3] && a[0] !== a[2]) {
        return { pred: a[2] === "T" ? "xỉu" : "tài", conf: 76, src: "2-2" };
      }
    }

    // 3-1
    if (tx.length >= 4) {
      const a = tx.slice(-4);
      if (a[0] === a[1] && a[1] === a[2] && a[2] !== a[3]) {
        return { pred: a[3] === "T" ? "tài" : "xỉu", conf: 80, src: "3-1" };
      }
    }
    return null;
  }
}

class AdvancedPatterns {
  // Chu kỳ, double streak, dynamic catch, frequency
  get(tx, totals) {
    if (tx.length < 8) return null;

    // Double streak
    if (tx.length >= 8) {
      const f4 = tx.slice(-8, -4), l4 = tx.slice(-4);
      if (new Set(f4).size === 1 && new Set(l4).size === 1 && f4[0] !== l4[0]) {
        return { pred: l4[0] === "T" ? "xỉu" : "tài", conf: 88, src: "dbl-streak" };
      }
    }

    // Cycle detection
    let bestC = 0, bestS = 0;
    for (let c = 2; c <= 8; c++) {
      let m = 0, n = 0;
      for (let i = c; i < tx.length; i++) {
        if (tx[i] === tx[i - c]) m++;
        n++;
      }
      const s = n ? m / n : 0;
      if (s > bestS && s > 0.68) { bestS = s; bestC = c; }
    }
    if (bestC && bestS > 0.72) {
      const p = tx[tx.length - bestC];
      return { pred: p === "T" ? "tài" : "xỉu", conf: 82 + Math.round(bestS * 10), src: "cycle-" + bestC };
    }

    // Frequency bias
    if (tx.length >= 30) {
      const r = tx.slice(-30);
      const tC = r.filter(v => v === "T").length;
      const ratio = Math.max(tC, 30 - tC) / 30;
      if (ratio >= 0.63) {
        return { pred: tC > 15 ? "xỉu" : "tài", conf: 76 + Math.round((ratio - 0.6) * 50), src: "freq" };
      }
    }

    // Total mean trend
    if (totals.length >= 12) {
      const short = avg(totals.slice(-5));
      const long = avg(totals.slice(-12));
      if (short > 12.2 && std(totals.slice(-5)) < 2.2) return { pred: "xỉu", conf: 84, src: "trend-high" };
      if (short < 8.8 && std(totals.slice(-5)) < 2.2) return { pred: "tài", conf: 84, src: "trend-low" };
      if (short - long > 1.8) return { pred: "xỉu", conf: 78, src: "trend-up" };
      if (long - short > 1.8) return { pred: "tài", conf: 78, src: "trend-down" };
    }
    return null;
  }
}

class ElitePatterns {
  // Rối, entropy thấp/cao, pattern dài, momentum, dice detail
  get(history) {
    if (history.length < 12) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const dice = history.map(h => h.dice);

    // Low entropy = lặp mạnh
    const e20 = entropy(tx.slice(-20));
    if (e20 < 0.35) {
      const last = tx[tx.length - 1];
      return { pred: last === "T" ? "xỉu" : "tài", conf: 90, src: "low-ent" };
    }

    // High entropy = rối → theo mean gần nhất
    if (e20 > 0.95 && tx.length >= 25) {
      const tC = tx.slice(-25).filter(v => v === "T").length;
      return { pred: tC > 12 ? "xỉu" : "tài", conf: 74, src: "chaos" };
    }

    // Long pattern match
    const seq = tx.map(v => (v === "T" ? 1 : 0));
    for (let len = Math.min(10, Math.floor(seq.length / 3)); len >= 4; len--) {
      const cur = seq.slice(-len);
      let hits = 0, next = null;
      for (let i = 0; i <= seq.length - len - 1; i++) {
        let ok = true;
        for (let j = 0; j < len; j++) if (seq[i + j] !== cur[j]) { ok = false; break; }
        if (ok) {
          hits++;
          if (next === null && i + len < seq.length) next = seq[i + len];
        }
      }
      if (next !== null && hits >= 2) {
        return { pred: next === 1 ? "tài" : "xỉu", conf: Math.min(94, 78 + len * 1.5 + hits), src: "pat-" + len };
      }
    }

    // Momentum totals
    let mom = 0;
    for (let i = 1; i < Math.min(10, totals.length); i++) {
      const d = totals[totals.length - i] - totals[totals.length - i - 1];
      if (d > 2) mom++;
      else if (d < -2) mom--;
    }
    if (Math.abs(mom) >= 4) {
      return { pred: mom > 0 ? "xỉu" : "tài", conf: 82 + Math.abs(mom), src: "momentum" };
    }

    // Dice extreme
    const recentD = dice.slice(-6);
    let hi = 0, lo = 0;
    for (const d of recentD) {
      const s = d[0] + d[1] + d[2];
      if (s >= 15) hi++;
      if (s <= 6) lo++;
    }
    if (hi >= 4) return { pred: "xỉu", conf: 86, src: "dice-hi" };
    if (lo >= 4) return { pred: "tài", conf: 86, src: "dice-lo" };

    return null;
  }
}

class CheatGuard {
  constructor() {
    this.prob = 0;
  }
  check(history) {
    if (history.length < 15) { this.prob = 0; return "normal"; }
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    let score = 0;

    const s = streakLen(tx);
    if (s >= 9) score += 0.4;
    else if (s >= 7) score += 0.25;

    const e = entropy(tx.slice(-18));
    if (e < 0.3) score += 0.3;

    const ext = totals.slice(-8).filter(t => t >= 16 || t <= 5).length;
    if (ext >= 3) score += 0.25;

    const last10 = tx.slice(-10).join("");
    if (["TXTXTXTXTX", "XTXTXTXTXT", "TTTTTTTTTT", "XXXXXXXXXX"].some(p => last10.includes(p))) score += 0.35;

    this.prob = Math.min(0.95, score);
    if (score >= 0.55) return "reverse";
    if (score >= 0.35) return "caution";
    return "normal";
  }
}

class Tracker {
  constructor(game) {
    this.game = game;
    this.preds = store[game]?.preds || [];
    this.outcomes = store[game]?.outcomes || [];
    this.streakOk = 0;
    this.streakNg = 0;
    this.reverse = false;
    this.wBasic = 0.35;
    this.wAdv = 0.35;
    this.wElite = 0.30;
  }

  record(session, pred, actual, src) {
    const ok = pred === actual;
    this.outcomes.push({ session, pred, actual, ok, src, ts: Date.now() });
    if (this.outcomes.length > 300) this.outcomes = this.outcomes.slice(-250);
    store[this.game].outcomes = this.outcomes;
    saveStore(store);

    if (ok) {
      this.streakOk++;
      this.streakNg = 0;
      if (this.reverse && this.streakOk >= 2) this.reverse = false;
      if (src.startsWith("bet") || src.startsWith("1-") || src.startsWith("2-") || src.startsWith("3-")) this.wBasic = Math.min(0.5, this.wBasic + 0.02);
      else if (src.startsWith("cycle") || src.startsWith("freq") || src.startsWith("trend") || src.startsWith("dbl")) this.wAdv = Math.min(0.5, this.wAdv + 0.02);
      else this.wElite = Math.min(0.5, this.wElite + 0.02);
    } else {
      this.streakNg++;
      this.streakOk = 0;
      if (this.streakNg >= 2 && !this.reverse) this.reverse = true;
      if (src.startsWith("bet") || src.startsWith("1-") || src.startsWith("2-") || src.startsWith("3-")) this.wBasic = Math.max(0.2, this.wBasic - 0.03);
      else if (src.startsWith("cycle") || src.startsWith("freq") || src.startsWith("trend") || src.startsWith("dbl")) this.wAdv = Math.max(0.2, this.wAdv - 0.03);
      else this.wElite = Math.max(0.2, this.wElite - 0.03);
    }
    this.normalize();
  }

  normalize() {
    const t = this.wBasic + this.wAdv + this.wElite;
    this.wBasic /= t; this.wAdv /= t; this.wElite /= t;
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
    if (acc > 0.7) c += 6;
    else if (acc > 0.6) c += 3;
    else if (acc < 0.4) c -= 5;
    if (this.streakOk >= 3) c += 4;
    if (this.reverse) c -= 2;
    return Math.min(97, Math.max(68, Math.round(c)));
  }

  status() {
    return {
      reverse: this.reverse,
      streakOk: this.streakOk,
      streakNg: this.streakNg,
      acc20: Math.round(this.recentAcc(20) * 100) + "%",
      weights: {
        basic: Math.round(this.wBasic * 100) + "%",
        advanced: Math.round(this.wAdv * 100) + "%",
        elite: Math.round(this.wElite * 100) + "%"
      },
      lastOutcomes: this.outcomes.slice(-15).reverse()
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
    this.pendingPred = null; // { session, pred, conf, src }
    this.timer = null;
  }

  async pull() {
    try {
      const res = await fetch(this.url);
      const data = await res.json();
      const list = this.parse(data);
      if (!list.length) return;

      // unique by session
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
        console.log(`[${this.game}] loaded ${this.history.length}`);
        return;
      }

      const news = list.filter(r => r.session > this.curId && !this.history.some(h => h.session === r.session));
      for (const rec of news) {
        // resolve pending prediction
        if (this.pendingPred && rec.session === this.pendingPred.session) {
          const actual = rec.tx === "T" ? "tài" : "xỉu";
          this.tracker.record(rec.session, this.pendingPred.pred, actual, this.pendingPred.src);
          const ok = this.pendingPred.pred === actual;
          console.log(`[${this.game}] #${rec.session} ${ok ? "OK" : "NG"} ${this.pendingPred.pred}→${actual}`);
          this.pendingPred = null;
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
        console.log(`[${this.game}] +${news.length}`);
      }
    } catch (e) {
      console.error(`[${this.game}]`, e.message);
    }
  }

  start(ms = 5000) {
    this.pull();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.pull(), ms);
  }

  predict() {
    if (this.history.length < 10) return null;
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
      src = "fallback";
    } else {
      // group by prediction
      const score = { tài: 0, xỉu: 0 };
      const best = { tài: null, xỉu: null };
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
      // boost if agree
      const agree = cands.filter(c => c.pred === pred).length;
      if (agree >= 2) conf = Math.min(96, conf + 4);
    }

    if (advice === "reverse") {
      pred = pred === "tài" ? "xỉu" : "tài";
      conf = Math.min(96, conf + 3);
    } else if (advice === "caution") {
      conf = Math.max(68, conf - 4);
    }

    pred = this.tracker.applyRev(pred);
    conf = this.tracker.adjustConf(conf);

    const nextSession = (this.history.at(-1)?.session || 0) + 1;
    this.pendingPred = { session: nextSession, pred, conf, src };
    // keep pending in store for reload survival
    store[this.game].preds = (store[this.game].preds || []).filter(p => p.session >= nextSession - 5);
    store[this.game].preds.push({ ...this.pendingPred, ts: Date.now() });
    if (store[this.game].preds.length > 50) store[this.game].preds = store[this.game].preds.slice(-40);
    saveStore(store);

    return { prediction: pred, confidence: conf, src, reverse: this.tracker.reverse, cheat: advice !== "normal", nextSession };
  }

  last() { return this.history.at(-1); }

  stats() {
    return {
      game: this.game,
      len: this.history.length,
      tracker: this.tracker.status(),
      guard: { prob: Math.round(this.guard.prob * 100) + "%", advice: this.guard.check(this.history) },
      pending: this.pendingPred
    };
  }
}

function parseHu(data) {
  if (!data?.list) return [];
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
function parseMd5(data) {
  if (!data?.list) return [];
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

const hu = new Engine("hu", API_HU, parseHu);
const md5 = new Engine("md5", API_MD5, parseMd5);

// restore pending on boot
for (const g of ["hu", "md5"]) {
  const eng = g === "hu" ? hu : md5;
  const lasts = (store[g].preds || []).slice(-3);
  if (lasts.length) eng.pendingPred = lasts.at(-1);
}

function checkKey(q) {
  const k = q.key;
  if (!k) return { ok: false, error: "CHƯA NHẬP KEY", contact: "IB Telegram @anhkhoi_xabc" };
  if (k !== VALID_KEY) return { ok: false, error: "KEY SAI", contact: "IB Telegram @anhkhoi_xabc" };
  return { ok: true };
}

const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });
await app.register(fastifyStatic, {
  root: path.join(__dirname, "public"),
  prefix: "/"
});

app.get("/api/taixiu/lc79", async (req, reply) => {
  const ck = checkKey(req.query);
  if (!ck.ok) return reply.status(401).send({ error: ck.error, contact: ck.contact });
  const last = hu.last();
  if (!last || hu.history.length < 10) return reply.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
  const p = hu.predict();
  if (!p) return reply.status(503).send({ error: "Đang phân tích HŨ..." });
  return {
    Id: "@anhkhoi_xabc",
    Phien_truoc: last.session,
    Xucxac: `${last.dice[0]} - ${last.dice[1]} - ${last.dice[2]}`,
    Ketqua: last.result.toLowerCase(),
    Phien_nay: p.nextSession,
    Dudoan: p.prediction,
    Dotincay: p.confidence + "%"
  };
});

app.get("/api/taixiumd5/lc79", async (req, reply) => {
  const ck = checkKey(req.query);
  if (!ck.ok) return reply.status(401).send({ error: ck.error, contact: ck.contact });
  const last = md5.last();
  if (!last || md5.history.length < 10) return reply.status(503).send({ error: "Đang tải dữ liệu MD5..." });
  const p = md5.predict();
  if (!p) return reply.status(503).send({ error: "Đang phân tích MD5..." });
  return {
    Id: "@anhkhoi_xabc",
    Phien_truoc: last.session,
    Xucxac: `${last.dice[0]} - ${last.dice[1]} - ${last.dice[2]}`,
    Ketqua: last.result.toLowerCase(),
    Phien_nay: p.nextSession,
    Dudoan: p.prediction,
    Dotincay: p.confidence + "%"
  };
});

app.get("/check-key", async (req) => {
  const k = req.query.key;
  if (!k) return { status: "error", message: "CHƯA NHẬP KEY", contact: "IB Telegram @anhkhoi_xabc" };
  if (k === VALID_KEY) return { status: "success", message: "KEY HỢP LỆ" };
  return { status: "error", message: "KEY SAI", contact: "IB Telegram @anhkhoi_xabc" };
});

app.get("/api/taixiu/lc79/history", async (req, reply) => {
  const ck = checkKey(req.query);
  if (!ck.ok) return reply.status(401).send({ error: ck.error });
  return [...hu.history].sort((a, b) => b.session - a.session).slice(0, 40).map(i => ({
    session: i.session, dice: i.dice, total: i.total, result: i.result.toLowerCase()
  }));
});

app.get("/api/taixiumd5/lc79/history", async (req, reply) => {
  const ck = checkKey(req.query);
  if (!ck.ok) return reply.status(401).send({ error: ck.error });
  return [...md5.history].sort((a, b) => b.session - a.session).slice(0, 40).map(i => ({
    session: i.session, dice: i.dice, total: i.total, result: i.result.toLowerCase()
  }));
});

app.get("/api/stats", async (req, reply) => {
  const ck = checkKey(req.query);
  if (!ck.ok) return reply.status(401).send({ error: ck.error });
  return { hu: hu.stats(), md5: md5.stats() };
});

app.get("/api/dashboard", async (req, reply) => {
  const ck = checkKey(req.query);
  if (!ck.ok) return reply.status(401).send({ error: ck.error, contact: ck.contact });

  const build = (eng) => {
    const last = eng.last();
    const p = eng.history.length >= 10 ? eng.predict() : null;
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
      reverse: st.reverse,
      weights: st.weights,
      outcomes: st.lastOutcomes,
      history: eng.history.slice(-25).reverse().map(h => ({
        s: h.session, d: h.dice, t: h.total, r: h.result.toLowerCase(), tx: h.tx
      }))
    };
  };

  return { hu: build(hu), md5: build(md5), ts: Date.now() };
});

app.get("/", async (_, reply) => {
  return reply.sendFile("index.html");
});

const start = async () => {
  hu.start(5000);
  md5.start(5000);
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`Server :${PORT}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
};
start();
