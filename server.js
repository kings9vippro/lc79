import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import * as http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const VALID_KEY = "anhkhoi_xabc2102";
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

const API_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

if (!existsSync(DATA_DIR)) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function normalizeOutcome(val) {
  if (!val) return "";
  const s = String(val)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (s === "t" || s === "tai") return "tai";
  if (s === "x" || s === "xiu") return "xiu";
  return s;
}

function loadStore() {
  try {
    if (existsSync(STORE_FILE)) {
      const data = JSON.parse(readFileSync(STORE_FILE, "utf8"));
      return {
        hu: { activePred: data.hu?.activePred || null, outcomes: data.hu?.outcomes || [], history: data.hu?.history || [] },
        md5: { activePred: data.md5?.activePred || null, outcomes: data.md5?.outcomes || [], history: data.md5?.history || [] }
      };
    }
  } catch {}
  return { hu: { activePred: null, outcomes: [], history: [] }, md5: { activePred: null, outcomes: [], history: [] } };
}

function saveStore(s) {
  try { writeFileSync(STORE_FILE, JSON.stringify(s, null, 2)); } catch {}
}
const store = loadStore();

class AdaptiveQuantEngine {
  constructor() {
    this.weights = { markov: 3.0, pattern: 4.5, reversion: 2.8, freq: 2.5 };
    this.learningRate = 0.25;
  }

  updateWeights(votes, actualOutcome) {
    const act = normalizeOutcome(actualOutcome);
    for (const [key, vote] of Object.entries(votes)) {
      if (!vote) continue;
      if (vote === act) {
        this.weights[key] = Math.min(8.0, this.weights[key] + this.learningRate);
      } else {
        this.weights[key] = Math.max(0.8, this.weights[key] - this.learningRate);
      }
    }
  }

  predict(history, tracker) {
    if (!history || history.length < 5) {
      return { pred: "tai", conf: 76, src: "Đồng bộ chu kỳ dữ liệu thực" };
    }

    const tx = history.map(h => normalizeOutcome(h.tx || h.result));
    const totals = history.map(h => Number(h.total));
    const dice = history.map(h => h.dice);
    const len = tx.length;
    const last = tx[len - 1];

    let scoreT = 0, scoreX = 0;
    const votesT = [];
    const votesX = [];
    const componentVotes = { markov: null, pattern: null, reversion: null, freq: null };

    let streak = 1;
    for (let i = len - 2; i >= 0; i--) {
      if (tx[i] === last) streak++; else break;
    }

    if (streak >= 3 && streak <= 5) {
      const add = this.weights.pattern * 1.1;
      if (last === "tai") { scoreT += add; votesT.push(`Bám đà bệt Tài (${streak} tay)`); componentVotes.pattern = "tai"; }
      else { scoreX += add; votesX.push(`Bám đà bệt Xỉu (${streak} tay)`); componentVotes.pattern = "xiu"; }
    } else if (streak >= 6 && streak <= 8) {
      const add = this.weights.pattern * 1.35;
      if (last === "tai") { scoreT += add; votesT.push(`Đu nhịp bệt sâu Tài (${streak} tay)`); componentVotes.pattern = "tai"; }
      else { scoreX += add; votesX.push(`Đu nhịp bệt sâu Xỉu (${streak} tay)`); componentVotes.pattern = "xiu"; }
    } else if (streak >= 9) {
      const add = this.weights.pattern * 1.55;
      if (last === "tai") { scoreX += add; votesX.push(`Bẻ nhịp bệt bão hòa (${streak} tay)`); componentVotes.pattern = "xiu"; }
      else { scoreT += add; votesT.push(`Bẻ nhịp bệt bão hòa (${streak} tay)`); componentVotes.pattern = "tai"; }
    } else if (streak === 1 && len >= 4) {
      const last4 = tx.slice(-4);
      if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
        const add = this.weights.pattern * 1.05;
        const nextTarget = last === "tai" ? "xiu" : "tai";
        if (nextTarget === "tai") { scoreT += add; votesT.push("Duy trì nhịp Ping-Pong 1-1"); }
        else { scoreX += add; votesX.push("Duy trì nhịp Ping-Pong 1-1"); }
        componentVotes.pattern = nextTarget;
      }
    } else if (streak === 2 && len >= 4) {
      const last4 = tx.slice(-4);
      if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
        const add = this.weights.pattern * 0.95;
        const nextTarget = last === "tai" ? "xiu" : "tai";
        if (nextTarget === "tai") { scoreT += add; votesT.push("Nhịp song hành 2-2"); }
        else { scoreX += add; votesX.push("Nhịp song hành 2-2"); }
        componentVotes.pattern = nextTarget;
      }
    }

    if (len >= 12) {
      const order = len >= 20 ? 3 : 2;
      const key = tx.slice(-order).join("");
      let countT = 1, countX = 1;
      for (let i = 0; i < len - order; i++) {
        const seg = tx.slice(i, i + order).join("");
        if (seg === key) {
          if (tx[i + order] === "tai") countT++;
          else if (tx[i + order] === "xiu") countX++;
        }
      }
      if (countT !== countX) {
        const probT = countT / (countT + countX);
        const add = this.weights.markov * Math.abs(probT - 0.5) * 2.4;
        if (probT > 0.5) {
          scoreT += add;
          votesT.push(`Chuyển trạng thái Markov bậc ${order} (${Math.round(probT * 100)}%)`);
          componentVotes.markov = "tai";
        } else {
          scoreX += add;
          votesX.push(`Chuyển trạng thái Markov bậc ${order} (${Math.round((1 - probT) * 100)}%)`);
          componentVotes.markov = "xiu";
        }
      }
    }

    const recentTotals = totals.slice(-7);
    const avgScore = recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length;
    if (avgScore >= 11.6) {
      const add = this.weights.reversion * ((avgScore - 10.5) / 2.0);
      scoreX += add;
      votesX.push(`Hồi quy điểm số cao (${avgScore.toFixed(1)})`);
      componentVotes.reversion = "xiu";
    } else if (avgScore <= 9.4) {
      const add = this.weights.reversion * ((10.5 - avgScore) / 2.0);
      scoreT += add;
      votesT.push(`Hồi quy điểm số thấp (${avgScore.toFixed(1)})`);
      componentVotes.reversion = "tai";
    }

    const lastD = dice[len - 1];
    if (Array.isArray(lastD) && lastD.length === 3 && lastD[0] === lastD[1] && lastD[1] === lastD[2]) {
      const add = this.weights.reversion * 1.3;
      if (last === "tai") { scoreX += add; votesX.push(`Đảo xung lượng sau Bão ${lastD[0]}`); }
      else { scoreT += add; votesT.push(`Đảo xung lượng sau Bão ${lastD[0]}`); }
    }

    const recent20 = tx.slice(-20);
    const cntT = recent20.filter(v => v === "tai").length;
    const cntX = recent20.length - cntT;
    if (cntT >= 13) {
      const add = this.weights.freq * 1.15;
      scoreX += add;
      votesX.push(`Cân bằng lệch vị Tài (${cntT}/20)`);
      componentVotes.freq = "xiu";
    } else if (cntX >= 13) {
      const add = this.weights.freq * 1.15;
      scoreT += add;
      votesT.push(`Cân bằng lệch vị Xỉu (${cntX}/20)`);
      componentVotes.freq = "tai";
    }

    let pred, conf, src;
    if (scoreT > scoreX) {
      pred = "tai";
      src = votesT[0] || "Động lượng xu hướng Tài";
      const ratio = scoreT / (scoreT + scoreX + 0.001);
      conf = Math.min(96, Math.max(72, Math.round(70 + ratio * 28)));
    } else if (scoreX > scoreT) {
      pred = "xiu";
      src = votesX[0] || "Động lượng xu hướng Xỉu";
      const ratio = scoreX / (scoreT + scoreX + 0.001);
      conf = Math.min(96, Math.max(72, Math.round(70 + ratio * 28)));
    } else {
      pred = cntT >= cntX ? "xiu" : "tai";
      src = "Phân bổ đối xứng trung hòa";
      conf = 75;
    }

    let finalReverse = false;
    if (tracker && tracker.reverse) {
      pred = pred === "tai" ? "xiu" : "tai";
      src = `Đảo nhịp phòng vệ (${src})`;
      conf = Math.max(70, conf - 4);
      finalReverse = true;
    }

    return { pred, conf, src, reverse: finalReverse, componentVotes };
  }
}

class StrictHedgeTracker {
  constructor(game) {
    this.game = game;
    this.outcomes = (store[game]?.outcomes || []).map(o => ({
      ...o,
      pred: normalizeOutcome(o.pred),
      actual: normalizeOutcome(o.actual),
      ok: normalizeOutcome(o.pred) === normalizeOutcome(o.actual)
    }));
    this.streakOk = 0;
    this.streakNg = 0;
    this.reverse = false;
    this.recomputeStreaks();
  }

  recomputeStreaks() {
    this.streakOk = 0;
    this.streakNg = 0;
    for (let i = this.outcomes.length - 1; i >= 0; i--) {
      if (this.outcomes[i].ok) {
        if (this.streakNg === 0) this.streakOk++; else break;
      } else {
        if (this.streakOk === 0) this.streakNg++; else break;
      }
    }
    this.reverse = this.streakNg >= 2;
  }

  record(session, rawPred, rawActual, src) {
    const pred = normalizeOutcome(rawPred);
    const actual = normalizeOutcome(rawActual);
    const ok = pred === actual;

    this.outcomes.push({ session: Number(session), pred, actual, ok, src, ts: Date.now() });
    if (this.outcomes.length > 200) this.outcomes = this.outcomes.slice(-150);
    store[this.game].outcomes = this.outcomes;
    saveStore(store);

    if (ok) {
      this.streakOk++;
      this.streakNg = 0;
      if (this.reverse && this.streakOk >= 2) this.reverse = false;
    } else {
      this.streakNg++;
      this.streakOk = 0;
      if (this.streakNg >= 2) this.reverse = true;
    }
  }

  get30Stats() {
    const last30 = this.outcomes.slice(-30);
    const winCount = last30.filter(o => o.ok).length;
    const lossCount = last30.length - winCount;
    const acc = last30.length > 0 ? Math.round((winCount / last30.length) * 100) : 0;

    let maxWinStreak = 0, curWin = 0;
    for (const item of last30) {
      if (item.ok) {
        curWin++;
        if (curWin > maxWinStreak) maxWinStreak = curWin;
      } else {
        curWin = 0;
      }
    }

    return {
      acc30: `${acc}%`,
      accNum: acc,
      winCount,
      lossCount,
      total30: last30.length,
      maxWinStreak,
      streakOk: this.streakOk,
      streakNg: this.streakNg,
      reverse: this.reverse,
      outcomes: [...last30].reverse()
    };
  }
}

class SessionCoordinator {
  constructor(game, url, parse) {
    this.game = game;
    this.url = url;
    this.parse = parse;
    this.history = (store[game]?.history || []).map(h => ({
      ...h,
      result: normalizeOutcome(h.result),
      tx: normalizeOutcome(h.tx || h.result) === "tai" ? "T" : "X"
    }));
    this.tracker = new StrictHedgeTracker(game);
    this.engine = new AdaptiveQuantEngine();
    this.activePred = store[game]?.activePred || null;
    this.isFetching = false;
    this.timer = null;
  }

  ensureActivePrediction() {
    if (this.history.length === 0) return;
    const lastSession = Number(this.history.at(-1)?.session || 0);
    const targetSession = lastSession + 1;

    if (!this.activePred || this.activePred.session !== targetSession) {
      const p = this.engine.predict(this.history, this.tracker);
      this.activePred = {
        session: targetSession,
        pred: p.pred,
        conf: p.conf,
        src: p.src,
        reverse: p.reverse,
        componentVotes: p.componentVotes,
        ts: Date.now()
      };
      store[this.game].activePred = this.activePred;
      saveStore(store);
    }
  }

  async pull() {
    if (this.isFetching) return;
    this.isFetching = true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);
      const res = await fetch(this.url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      });
      clearTimeout(timeoutId);
      if (!res.ok) return;

      const list = this.parse(await res.json());
      if (!list || list.length === 0) return;

      list.sort((a, b) => a.session - b.session);
      const lastSession = Number(this.history.at(-1)?.session || 0);

      if (this.history.length === 0) {
        this.history = list.slice(-100);
        store[this.game].history = this.history;
        saveStore(store);
        this.ensureActivePrediction();
        return;
      }

      const newSessions = list.filter(r => r.session > lastSession);
      if (newSessions.length > 0) {
        for (const rec of newSessions) {
          if (this.activePred && rec.session === this.activePred.session) {
            if (this.activePred.componentVotes) {
              this.engine.updateWeights(this.activePred.componentVotes, rec.result);
            }
            this.tracker.record(rec.session, this.activePred.pred, rec.result, this.activePred.src);
            this.activePred = null;
          }
          this.history.push(rec);
        }

        if (this.history.length > 300) {
          this.history = this.history.slice(-150);
        }
        store[this.game].history = this.history;
        saveStore(store);

        const nextTarget = Number(this.history.at(-1).session) + 1;
        const p = this.engine.predict(this.history, this.tracker);
        this.activePred = {
          session: nextTarget,
          pred: p.pred,
          conf: p.conf,
          src: p.src,
          reverse: p.reverse,
          componentVotes: p.componentVotes,
          ts: Date.now()
        };
        store[this.game].activePred = this.activePred;
        saveStore(store);
      }
    } catch (e) {
    } finally {
      this.isFetching = false;
    }
  }

  start(intervalMs = 3500) {
    this.pull();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.pull(), intervalMs);
  }

  last() {
    return this.history.at(-1) || null;
  }

  getPrediction() {
    this.ensureActivePrediction();
    return this.activePred;
  }
}

function parseStream(data) {
  let list = Array.isArray(data) ? data : (data?.data || data?.list || []);
  if (!Array.isArray(list)) return [];
  return list.map(i => {
    const session = Number(i.session || i.id || i.phien || i.Phien || 0);
    let dice = i.dices || i.dice || i.xucxac || [1, 1, 1];
    if (typeof dice === "string") dice = dice.split(/[,-]/).map(Number);
    const total = Number(i.total || i.point || i.diem || (dice[0] + dice[1] + dice[2]));
    const outcome = total >= 11 ? "tai" : "xiu";
    return {
      session,
      dice,
      total,
      result: outcome,
      tx: outcome === "tai" ? "T" : "X"
    };
  }).filter(i => i.session > 0).sort((a, b) => a.session - b.session);
}

const hu = new SessionCoordinator("hu", API_HU, parseStream);
const md5 = new SessionCoordinator("md5", API_MD5, parseStream);

function checkKey(q) {
  if (!q?.key || q.key.trim() !== VALID_KEY) {
    return {
      ok: false,
      error: "MẬT KHẨU BẢN QUYỀN KHÔNG CHÍNH XÁC HOẶC HẾT HẠN TRUY CẬP.",
      author: "Phạm Anh Khôi",
      telegram: "@anhkhoi_xabc"
    };
  }
  return { ok: true };
}

function buildPayload() {
  const formatGame = (core) => {
    const l = core.last();
    const p = core.getPrediction();
    const st30 = core.tracker.get30Stats();
    return {
      last: l ? { session: l.session, dice: l.dice, total: l.total, result: l.result } : null,
      prediction: p ? { session: p.session, pred: p.pred, conf: p.conf, src: p.src, reverse: p.reverse } : null,
      acc30: st30.acc30,
      accNum: st30.accNum,
      winCount: st30.winCount,
      lossCount: st30.lossCount,
      total30: st30.total30,
      maxWinStreak: st30.maxWinStreak,
      streakOk: st30.streakOk,
      streakNg: st30.streakNg,
      reverse: st30.reverse,
      outcomes: st30.outcomes,
      history: core.history.slice(-30).reverse().map(h => ({ s: h.session, d: h.dice, t: h.total, r: h.result, tx: h.tx }))
    };
  };

  return {
    hu: formatGame(hu),
    md5: formatGame(md5),
    serverTime: Date.now(),
    author: "Phạm Anh Khôi",
    telegram: "@anhkhoi_xabc",
    version: "4.2.0-PRO",
    status: "active"
  };
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/health" || pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", author: "Phạm Anh Khôi", time: Date.now() }));
    return;
  }

  if (pathname === "/api/dashboard") {
    const key = parsedUrl.searchParams.get("key");
    const ck = checkKey({ key });
    if (!ck.ok) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: ck.error, author: ck.author, telegram: ck.telegram }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(buildPayload()));
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    const htmlPath = path.join(__dirname, "index.html");
    if (existsSync(htmlPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(htmlPath, "utf8"));
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 Not Found");
});

hu.start(3500);
md5.start(3500);

server.listen(PORT, HOST, () => {
  console.log(`[QUANTUM SUITE] Hệ thống vận hành tại cổng ${PORT}`);
});
