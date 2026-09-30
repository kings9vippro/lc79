// server.js - HELIX ENGINE V7 2026 | 4 TẦNG ĐỊNH LƯỢNG + THÍCH NGHI
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
const MAX_OUTCOMES = 30;

const API_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

if (!existsSync(DATA_DIR)) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

const avg = a => a?.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const std = a => {
  if (!a || a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(avg(a.map(n => (n - m) ** 2)));
};
const entropy = a => {
  if (!a?.length) return 0;
  const f = {};
  for (const v of a) f[v] = (f[v] || 0) + 1;
  let e = 0, n = a.length;
  for (const k in f) {
    const p = f[k] / n;
    e -= p * Math.log2(p);
  }
  return e;
};
const streakLen = tx => {
  if (!tx?.length) return 0;
  let s = 1;
  for (let i = tx.length - 2; i >= 0; i--) {
    if (tx[i] === tx[tx.length - 1]) s++;
    else break;
  }
  return s;
};

function loadStore() {
  try {
    if (existsSync(STORE_FILE)) {
      const d = JSON.parse(readFileSync(STORE_FILE, "utf8"));
      return {
        hu: { activePred: d.hu?.activePred || null, outcomes: (d.hu?.outcomes || []).slice(-MAX_OUTCOMES) },
        md5: { activePred: d.md5?.activePred || null, outcomes: (d.md5?.outcomes || []).slice(-MAX_OUTCOMES) }
      };
    }
  } catch {}
  return { hu: { activePred: null, outcomes: [] }, md5: { activePred: null, outcomes: [] } };
}

function saveStore(s) {
  try { writeFileSync(STORE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

const store = loadStore();

// === TẦNG 1: CƠ BẢN (HÌNH THÁI CẦU) ===
class BasicPatterns {
  get(tx) {
    if (!tx || tx.length < 4) return null;
    const last = tx[tx.length - 1];
    const s = streakLen(tx);

    if (s >= 8) return { pred: last === "T" ? "xỉu" : "tài", conf: 90, src: `Bẻ bệt sâu ${s}` };
    if (s >= 6) return { pred: last === "T" ? "xỉu" : "tài", conf: 86, src: `Bẻ bệt bão ${s}` };
    if (s >= 3 && s < 6) return { pred: last === "T" ? "tài" : "xỉu", conf: 82 + (s - 3) * 2, src: `Theo đà ${s}` };

    const last6 = tx.slice(-6);
    if (last6.length === 6 && last6.every((v, i) => i === 0 || v !== last6[i - 1])) {
      return { pred: last === "T" ? "xỉu" : "tài", conf: 87, src: "Cầu đảo 1-1" };
    }

    const last4 = tx.slice(-4);
    if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
      return { pred: last4[3] === "T" ? "xỉu" : "tài", conf: 83, src: "Cầu đôi 2-2" };
    }

    const seq6 = tx.slice(-6).join("");
    if (seq6 === "TTTXXT" || seq6 === "XXXTTX") return { pred: last === "T" ? "tài" : "xỉu", conf: 85, src: "Lùi 3-2-1" };
    if (seq6 === "TXXTTT" || seq6 === "XTTXXX") return { pred: last === "T" ? "xỉu" : "tài", conf: 85, src: "Tiến 1-2-3" };

    const last5 = tx.slice(-5).join("");
    if (last5 === "TTXTT" || last5 === "XXTXX") return { pred: last === "T" ? "xỉu" : "tài", conf: 82, src: "Kẹp 2-1-2" };

    const last4s = tx.slice(-4).join("");
    if (last4s === "TTTX" || last4s === "XXXT") return { pred: last === "T" ? "xỉu" : "tài", conf: 81, src: "Nhịp 3-1" };
    if (last4s === "TXXX" || last4s === "XTTT") return { pred: last === "T" ? "tài" : "xỉu", conf: 81, src: "Nhịp 1-3" };

    return null;
  }
}

// === TẦNG 2: NÂNG CAO (MARKOV + CHU KỲ + Z-SCORE) ===
class AdvancedPatterns {
  get(tx, totals) {
    if (!tx || tx.length < 12) return null;

    if (tx.length >= 18) {
      const state3 = tx.slice(-3).join("");
      const trans = { T: 0, X: 0 };
      for (let i = 0; i < tx.length - 3; i++) {
        if (tx[i] + tx[i + 1] + tx[i + 2] === state3) {
          const next = tx[i + 3];
          if (next === "T") trans.T++;
          else if (next === "X") trans.X++;
        }
      }
      const sum = trans.T + trans.X;
      if (sum >= 3) {
        const pT = (trans.T + 1) / (sum + 2);
        if (pT >= 0.67) return { pred: "tài", conf: Math.round(76 + pT * 18), src: "Markov K3" };
        if (pT <= 0.33) return { pred: "xỉu", conf: Math.round(76 + (1 - pT) * 18), src: "Markov K3" };
      }
    }

    let bestC = 0, bestS = 0;
    for (let c = 2; c <= 9; c++) {
      let match = 0, cnt = 0;
      for (let i = c; i < tx.length; i++) {
        if (tx[i] === tx[i - c]) match++;
        cnt++;
      }
      const sc = cnt ? match / cnt : 0;
      if (sc > bestS && sc > 0.68) { bestS = sc; bestC = c; }
    }
    if (bestC && bestS >= 0.72) {
      const v = tx[tx.length - bestC];
      return { pred: v === "T" ? "tài" : "xỉu", conf: Math.min(93, Math.round(80 + bestS * 15)), src: `Chu kỳ ${bestC}` };
    }

    if (totals && totals.length >= 12) {
      const win = totals.slice(-6);
      const m = avg(win);
      const s = std(win) || 1.2;
      const z = (m - 10.5) / s;
      if (z >= 1.55) return { pred: "xỉu", conf: 87, src: "Z-Score đỉnh" };
      if (z <= -1.55) return { pred: "tài", conf: 87, src: "Z-Score đáy" };
    }
    return null;
  }
}

// === TẦNG 3: HIỆN ĐẠI (ENTROPY + KMP + MẶT XÚC XẮC + ĐỘNG LƯỢNG) ===
class ModernPatterns {
  get(history) {
    if (!history || history.length < 12) return null;
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    const dice = history.map(h => h.dice);

    const e16 = entropy(tx.slice(-16));
    if (e16 < 0.30) {
      const last = tx[tx.length - 1];
      return { pred: last === "T" ? "xỉu" : "tài", conf: 92, src: "Entropy bão hòa" };
    }

    const seq = tx.map(v => (v === "T" ? 1 : 0));
    const maxLen = Math.min(10, Math.floor(seq.length / 3));
    for (let len = maxLen; len >= 4; len--) {
      const target = seq.slice(-len);
      let hits = 0, nxt = null;
      for (let i = 0; i <= seq.length - len - 1; i++) {
        let ok = true;
        for (let j = 0; j < len; j++) if (seq[i + j] !== target[j]) { ok = false; break; }
        if (ok) {
          hits++;
          if (nxt === null && i + len < seq.length) nxt = seq[i + len];
        }
      }
      if (nxt !== null && hits >= 2) {
        return { pred: nxt === 1 ? "tài" : "xỉu", conf: Math.min(95, 80 + len * 2 + hits), src: `KMP ${len}` };
      }
    }

    const recent = dice.slice(-5);
    let low = 0, high = 0;
    for (const d of recent) for (const v of d) {
      if (v <= 2) low++;
      if (v >= 5) high++;
    }
    if (low >= 9) return { pred: "tài", conf: 88, src: "Tụ mặt nhỏ" };
    if (high >= 9) return { pred: "xỉu", conf: 88, src: "Tụ mặt lớn" };

    let mom = 0;
    for (let i = 1; i < Math.min(8, totals.length); i++) {
      const d = totals[totals.length - i] - totals[totals.length - i - 1];
      if (d >= 3) mom++;
      else if (d <= -3) mom--;
    }
    if (Math.abs(mom) >= 4) return { pred: mom > 0 ? "xỉu" : "tài", conf: 84 + Math.abs(mom), src: "Động lượng" };
    return null;
  }
}

// === TẦNG 4: THÍCH NGHI / HỌC (TRỌNG SỐ ĐỘNG + BỘ NHỚ KẾT QUẢ) ===
class AdaptiveLearner {
  constructor(tracker) {
    this.tracker = tracker;
  }
  get(tx, history) {
    if (!tx || tx.length < 15 || this.tracker.outcomes.length < 8) return null;
    const recent = this.tracker.outcomes.slice(-15);
    const srcAcc = {};
    for (const o of recent) {
      const k = o.src || "khác";
      if (!srcAcc[k]) srcAcc[k] = { ok: 0, total: 0 };
      srcAcc[k].total++;
      if (o.ok) srcAcc[k].ok++;
    }
    let bestSrc = null, bestRate = 0;
    for (const [k, v] of Object.entries(srcAcc)) {
      if (v.total >= 3) {
        const r = v.ok / v.total;
        if (r > bestRate) { bestRate = r; bestSrc = k; }
      }
    }
    if (!bestSrc || bestRate < 0.55) return null;

    const last = tx[tx.length - 1];
    const s = streakLen(tx);
    if (bestSrc.includes("bệt") || bestSrc.includes("đà")) {
      if (s >= 3) return { pred: last === "T" ? "tài" : "xỉu", conf: Math.round(75 + bestRate * 20), src: `Học theo ${bestSrc}` };
    }
    if (bestSrc.includes("đảo") || bestSrc.includes("1-1")) {
      return { pred: last === "T" ? "xỉu" : "tài", conf: Math.round(76 + bestRate * 18), src: `Học đảo ${bestSrc}` };
    }
    if (bestSrc.includes("Markov") || bestSrc.includes("chu kỳ") || bestSrc.includes("KMP")) {
      const prev = this.tracker.outcomes.at(-1);
      if (prev) return { pred: prev.pred, conf: Math.round(74 + bestRate * 20), src: `Học lặp ${bestSrc}` };
    }
    return null;
  }
}

class CheatGuard {
  constructor() { this.prob = 0; }
  check(history) {
    if (!history || history.length < 15) { this.prob = 0; return "binh_thuong"; }
    const tx = history.map(h => h.tx);
    const totals = history.map(h => h.total);
    let score = 0;
    const s = streakLen(tx);
    if (s >= 9) score += 0.42;
    else if (s >= 7) score += 0.22;
    const e = entropy(tx.slice(-16));
    if (e < 0.28) score += 0.32;
    const extreme = totals.slice(-8).filter(t => t >= 16 || t <= 5).length;
    if (extreme >= 3) score += 0.28;
    const last10 = tx.slice(-10).join("");
    if (["TXTXTXTXTX", "XTXTXTXTXT", "TTTTTTTTTT", "XXXXXXXXXX"].some(p => last10.includes(p))) score += 0.32;
    this.prob = Math.min(0.97, score);
    if (score >= 0.55) return "dao_chieu";
    if (score >= 0.32) return "canh_bao";
    return "binh_thuong";
  }
}

class Tracker {
  constructor(game) {
    this.game = game;
    this.outcomes = store[game]?.outcomes || [];
    this.streakOk = 0;
    this.streakNg = 0;
    this.reverse = false;
    this.wBasic = 0.28;
    this.wAdv = 0.28;
    this.wModern = 0.26;
    this.wAdapt = 0.18;
  }

  record(session, pred, actual, src) {
    const ok = pred === actual;
    this.outcomes.push({ session, pred, actual, ok, src, ts: Date.now() });
    if (this.outcomes.length > MAX_OUTCOMES) this.outcomes = this.outcomes.slice(-MAX_OUTCOMES);
    store[this.game].outcomes = this.outcomes;
    saveStore(store);

    if (ok) {
      this.streakOk++;
      this.streakNg = 0;
      if (this.reverse && this.streakOk >= 2) this.reverse = false;
      this.adjustWeights(src, 0.025);
    } else {
      this.streakNg++;
      this.streakOk = 0;
      if (this.streakNg >= 2 && !this.reverse) this.reverse = true;
      this.adjustWeights(src, -0.035);
    }
  }

  adjustWeights(src, delta) {
    const s = (src || "").toLowerCase();
    if (s.includes("bệt") || s.includes("1-1") || s.includes("2-2") || s.includes("tiến") || s.includes("lùi") || s.includes("kẹp") || s.includes("nhịp") || s.includes("đà")) {
      this.wBasic = Math.max(0.12, Math.min(0.55, this.wBasic + delta));
    } else if (s.includes("markov") || s.includes("chu kỳ") || s.includes("z-score")) {
      this.wAdv = Math.max(0.12, Math.min(0.55, this.wAdv + delta));
    } else if (s.includes("entropy") || s.includes("kmp") || s.includes("mặt") || s.includes("động lượng")) {
      this.wModern = Math.max(0.12, Math.min(0.55, this.wModern + delta));
    } else {
      this.wAdapt = Math.max(0.10, Math.min(0.45, this.wAdapt + delta));
    }
    const sum = this.wBasic + this.wAdv + this.wModern + this.wAdapt;
    this.wBasic /= sum; this.wAdv /= sum; this.wModern /= sum; this.wAdapt /= sum;
  }

  applyRev(p) { return this.reverse ? (p === "tài" ? "xỉu" : "tài") : p; }

  recentAcc(n = 20) {
    const r = this.outcomes.slice(-n);
    if (!r.length) return 0.5;
    return r.filter(o => o.ok).length / r.length;
  }

  adjustConf(base) {
    let c = base;
    const acc = this.recentAcc(20);
    if (acc >= 0.75) c += 5;
    else if (acc >= 0.60) c += 2;
    else if (acc < 0.40) c -= 5;
    if (this.streakOk >= 3) c += 3;
    if (this.reverse) c -= 2;
    return Math.min(96, Math.max(65, Math.round(c)));
  }

  status() {
    return {
      reverse: this.reverse,
      streakOk: this.streakOk,
      streakNg: this.streakNg,
      acc20: Math.round(this.recentAcc(20) * 100) + "%",
      lastOutcomes: this.outcomes.slice(-MAX_OUTCOMES).reverse()
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
    this.modern = new ModernPatterns();
    this.guard = new CheatGuard();
    this.tracker = new Tracker(game);
    this.adapt = new AdaptiveLearner(this.tracker);
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
      if (!list?.length) return;

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
    if (this.activePred && this.activePred.session === nextSession) return this.activePred;

    const tx = this.history.map(h => h.tx);
    const totals = this.history.map(h => h.total);
    const advice = this.guard.check(this.history);
    const cands = [];

    const b = this.basic.get(tx);
    if (b) cands.push({ ...b, w: this.tracker.wBasic });
    const a = this.adv.get(tx, totals);
    if (a) cands.push({ ...a, w: this.tracker.wAdv });
    const m = this.modern.get(this.history);
    if (m) cands.push({ ...m, w: this.tracker.wModern });
    const ad = this.adapt.get(tx, this.history);
    if (ad) cands.push({ ...ad, w: this.tracker.wAdapt });

    let pred, conf, src;
    if (!cands.length) {
      const last = tx[tx.length - 1];
      pred = last === "T" ? "xỉu" : "tài";
      conf = 68;
      src = "Cân bằng";
    } else {
      const score = { "tài": 0, "xỉu": 0 };
      const best = { "tài": null, "xỉu": null };
      for (const c of cands) {
        score[c.pred] += c.conf * c.w;
        if (!best[c.pred] || c.conf > best[c.pred].conf) best[c.pred] = c;
      }
      if (score["tài"] >= score["xỉu"]) {
        pred = "tài"; conf = best["tài"].conf; src = best["tài"].src;
      } else {
        pred = "xỉu"; conf = best["xỉu"].conf; src = best["xỉu"].src;
      }
      const consensus = cands.filter(c => c.pred === pred).length;
      if (consensus >= 2) conf = Math.min(95, conf + 4);
    }

    if (advice === "dao_chieu") {
      pred = pred === "tài" ? "xỉu" : "tài";
      conf = Math.min(95, conf + 3);
    } else if (advice === "canh_bao") {
      conf = Math.max(65, conf - 4);
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

const hu = new Engine("hu", API_HU, parseStream);
const md5 = new Engine("md5", API_MD5, parseStream);

function checkKey(q) {
  const k = q?.key;
  if (!k) return { ok: false, error: "THIẾU MÃ BẢN QUYỀN", contact: "Telegram: @anhkhoi_xabc" };
  if (k !== VALID_KEY) return { ok: false, error: "MÃ KHÔNG HỢP LỆ", contact: "Telegram: @anhkhoi_xabc" };
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
    console.log(`[HELIX-V7] :${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();
