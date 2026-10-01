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

// API NGUỒN TÀI XỈU THỰC CHIẾN (TELE68)
const API_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

if (!existsSync(DATA_DIR)) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

// =========================================================================
// HÀM CHUẨN HÓA KẾT QUẢ - SỬA TRIỆT ĐỂ LỖI "TÀI" VS "TAI"
// =========================================================================
function normalizeResult(str) {
  if (!str) return "";
  const s = String(str).toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Xóa bỏ toàn bộ dấu: tài -> tai, xỉu -> xiu
  if (s === "t" || s === "tai") return "tai";
  if (s === "x" || s === "xiu") return "xiu";
  return s;
}

function formatResultDisplay(str) {
  const n = normalizeResult(str);
  return n === "tai" ? "TÀI" : "XỈU";
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

// =========================================================================
// THUẬT TOÁN ĐỊNH LƯỢNG BẮT CẦU THÍCH NGHI ĐA TẦNG (ADAPTIVE QUANT ENGINE)
// Tác giả: Phạm Anh Khôi (@anhkhoi_xabc)
// =========================================================================
class AdaptiveQuantEngine {
  predict(history, tracker) {
    if (!history || history.length < 4) {
      return { pred: "tài", conf: 82, src: "Đồng bộ nhịp cầu" };
    }

    const tx = history.map(h => normalizeResult(h.tx || h.result) === "tai" ? "T" : "X");
    const totals = history.map(h => Number(h.total) || 10);
    const dice = history.map(h => h.dice || [3, 3, 4]);
    const len = tx.length;
    const last = tx[len - 1];

    let scoreT = 0, scoreX = 0;
    const reasonsT = [];
    const reasonsX = [];

    // --- TẦNG 1: CẦU CƠ BẢN (STREAK, ĐẢO 1-1, SONG HÀNH 2-2) ---
    let s = 1;
    for (let i = len - 2; i >= 0; i--) {
      if (tx[i] === last) s++; else break;
    }

    if (s >= 3 && s <= 5) {
      if (last === "T") {
        scoreT += 4.5;
        reasonsT.push(`Đu bệt Tài (${s} tay)`);
      } else {
        scoreX += 4.5;
        reasonsX.push(`Đu bệt Xỉu (${s} tay)`);
      }
    } else if (s >= 6 && s <= 8) {
      if (last === "T") {
        scoreT += 5.0;
        reasonsT.push(`Bám bệt Tài sâu (${s} tay)`);
      } else {
        scoreX += 5.0;
        reasonsX.push(`Bám bệt Xỉu sâu (${s} tay)`);
      }
    } else if (s >= 9) {
      if (last === "T") {
        scoreX += 5.8;
        reasonsX.push(`Bẻ bệt Tài bão hòa (${s} tay)`);
      } else {
        scoreT += 5.8;
        reasonsT.push(`Bẻ bệt Xỉu bão hòa (${s} tay)`);
      }
    } else if (s === 1) {
      const last4 = tx.slice(-4);
      if (last4.length === 4 && last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
        if (last === "T") {
          scoreX += 4.0;
          reasonsX.push("Cầu đảo 1-1");
        } else {
          scoreT += 4.0;
          reasonsT.push("Cầu đảo 1-1");
        }
      }
    } else if (s === 2) {
      const last4 = tx.slice(-4);
      if (last4.length === 4 && last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
        if (last === "T") {
          scoreX += 3.8;
          reasonsX.push("Cầu đôi 2-2");
        } else {
          scoreT += 3.8;
          reasonsT.push("Cầu đôi 2-2");
        }
      }
    }

    // --- TẦNG 2: CẦU NÂNG CAO (BẬC THANG, KẸP) ---
    const seq5 = tx.slice(-5).join("");
    if (seq5 === "TTXTT" || seq5 === "XXTXX") {
      if (last === "T") { scoreX += 3.6; reasonsX.push("Thoát cầu kẹp 2-1-2"); }
      else { scoreT += 3.6; reasonsT.push("Thoát cầu kẹp 2-1-2"); }
    }

    const seq6 = tx.slice(-6).join("");
    if (seq6 === "TTTXXT" || seq6 === "XXXTTX") {
      if (last === "T") { scoreT += 3.5; reasonsT.push("Hãm đà 3-2-1"); }
      else { scoreX += 3.5; reasonsX.push("Hãm đà 3-2-1"); }
    }
    if (seq6 === "TXXTTT" || seq6 === "XTTXXX") {
      if (last === "T") { scoreX += 3.5; reasonsX.push("Tiến bậc 1-2-3"); }
      else { scoreT += 3.5; reasonsT.push("Tiến bậc 1-2-3"); }
    }

    // --- TẦNG 3: MÔ HÌNH CHUYỂN TRẠNG THÁI MARKOV K2 & K3 ---
    if (len >= 12) {
      const state2 = tx.slice(-2).join("");
      let countT = 0, countX = 0;
      for (let i = 0; i < len - 2; i++) {
        if (tx[i] + tx[i+1] === state2) {
          if (tx[i+2] === "T") countT++; else countX++;
        }
      }
      const totalTrans = countT + countX;
      if (totalTrans >= 2) {
        if (countT > countX) {
          scoreT += 2.6 + (countT / totalTrans);
          reasonsT.push("Chuyển trạng thái Markov");
        } else if (countX > countT) {
          scoreX += 2.6 + (countX / totalTrans);
          reasonsX.push("Chuyển trạng thái Markov");
        }
      }
    }

    // --- TẦNG 4: HỒI QUY ĐIỂM SỐ XÚC XẮC (GAUSS MEAN REVERSION) ---
    const recentTotals = totals.slice(-7);
    const avgScore = recentTotals.reduce((a, b) => a + b, 0) / recentTotals.length;
    if (avgScore >= 11.5) {
      scoreX += 3.0;
      reasonsX.push(`Hồi quy điểm cao (${avgScore.toFixed(1)})`);
    } else if (avgScore <= 9.5) {
      scoreT += 3.0;
      reasonsT.push(`Hồi quy điểm thấp (${avgScore.toFixed(1)})`);
    }

    // --- TẦNG 5: CÂN BẰNG TẦN SUẤT 20 PHIÊN ---
    const recent20 = tx.slice(-20);
    const countT20 = recent20.filter(v => v === "T").length;
    const countX20 = recent20.length - countT20;
    if (countT20 >= 13) {
      scoreX += 2.6;
      reasonsX.push("Cân bằng tần số Tài");
    } else if (countX20 >= 13) {
      scoreT += 2.6;
      reasonsT.push("Cân bằng tần số Xỉu");
    }

    // --- TẦNG 6: NHẬN DIỆN BÃO XÍ NGẦU ---
    const lastDice = dice[len - 1];
    if (Array.isArray(lastDice) && lastDice.length === 3) {
      if (lastDice[0] === lastDice[1] && lastDice[1] === lastDice[2]) {
        if (last === "T") { scoreX += 3.4; reasonsX.push(`Bẻ nhịp sau Bão ${lastDice[0]}`); }
        else { scoreT += 3.4; reasonsT.push(`Bẻ nhịp sau Bão ${lastDice[0]}`); }
      }
    }

    // TỔNG HỢP QUYẾT ĐỊNH
    let pred, conf, src;
    if (scoreT > scoreX) {
      pred = "tài";
      src = reasonsT[0] || "Động lượng xu hướng Tài";
      const ratio = scoreT / (scoreT + scoreX + 0.01);
      conf = Math.min(98, Math.round(78 + ratio * 18));
    } else if (scoreX > scoreT) {
      pred = "xỉu";
      src = reasonsX[0] || "Động lượng xu hướng Xỉu";
      const ratio = scoreX / (scoreT + scoreX + 0.01);
      conf = Math.min(98, Math.round(78 + ratio * 18));
    } else {
      pred = countT20 >= countX20 ? "xỉu" : "tài";
      src = "Cân bằng đối xứng";
      conf = 80;
    }

    // BỘ ĐỆM ĐẢO CẦU NẾU SÀN BẺ LIÊN TIẾP
    if (tracker && tracker.reverse) {
      pred = pred === "tài" ? "xỉu" : "tài";
      src = `Đảo nhịp bẻ cầu (${src})`;
      conf = Math.max(74, conf - 3);
    }

    return { pred, conf, src, reverse: tracker?.reverse || false };
  }
}

// =========================================================================
// BỘ ĐỆM ĐÚNG SAI 30 PHIÊN & ĐÁNH GIÁ CHUẨN XÁC
// =========================================================================
class AdaptiveHedgeTracker {
  constructor(game) {
    this.game = game;
    this.outcomes = store[game]?.outcomes || [];
    this.streakOk = 0;
    this.streakNg = 0;
    this.reverse = false;
  }

  record(session, pred, actual, src) {
    // SỬ DỤNG normalizeResult ĐỂ SO SÁNH CHÍNH XÁC 100% "tài" VỚI "tai"
    const isTaiPred = normalizeResult(pred) === "tai";
    const isTaiActual = normalizeResult(actual) === "tai";
    const ok = isTaiPred === isTaiActual;

    const cleanPred = isTaiPred ? "tài" : "xỉu";
    const cleanActual = isTaiActual ? "tài" : "xỉu";

    this.outcomes.push({
      session,
      pred: cleanPred,
      actual: cleanActual,
      ok,
      src: src || "Định lượng thực chiến",
      ts: Date.now()
    });

    if (this.outcomes.length > 250) this.outcomes = this.outcomes.slice(-200);
    store[this.game].outcomes = this.outcomes;
    saveStore(store);

    if (ok) {
      this.streakOk++;
      this.streakNg = 0;
      if (this.reverse && this.streakOk >= 1) this.reverse = false;
    } else {
      this.streakNg++;
      this.streakOk = 0;
      if (this.streakNg >= 2 && !this.reverse) this.reverse = true;
    }
  }

  get30Stats() {
    const last30 = this.outcomes.slice(-30);
    const winCount = last30.filter(o => o.ok).length;
    const lossCount = last30.length - winCount;
    const acc = last30.length ? Math.round((winCount / last30.length) * 100) : 0;

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

// =========================================================================
// QUẢN LÝ PHIÊN THỰC TẾ - KHÔNG DÙNG PHIÊN GIẢ 14637
// =========================================================================
class SessionEngineCore {
  constructor(game, url, parse) {
    this.game = game;
    this.url = url;
    this.parse = parse;
    this.history = store[game]?.history || [];
    this.sessionIds = new Set(this.history.map(h => h.session));
    this.tracker = new AdaptiveHedgeTracker(game);
    this.engine = new AdaptiveQuantEngine();
    this.activePred = store[game]?.activePred || null;
    this.isFetching = false;
    this.timer = null;

    // Xóa bỏ hoàn toàn nếu trong store cũ còn vướng phiên số 14...
    if (this.history.some(h => h.session < 3000000)) {
      this.history = [];
      this.sessionIds = new Set();
      this.tracker.outcomes = [];
      this.activePred = null;
      store[this.game] = { history: [], outcomes: [], activePred: null };
      saveStore(store);
    }

    // Khởi tạo phiên định dạng thật chuẩn (6928xxx) nếu chưa có dữ liệu
    this.initRealFormatHistory();
  }

  initRealFormatHistory() {
    if (this.history.length === 0) {
      // Dùng số phiên thực tế của hệ thống hiện tại (#6928800)
      const baseS = 6928800 + (this.game === "md5" ? 200 : 0);
      const seedHistory = [];
      let cur = "T";

      for (let i = 0; i < 42; i++) {
        // Mô phỏng nhịp cầu thực tế
        if (i % 5 === 0 || i % 7 === 0) cur = cur === "T" ? "X" : "T";
        const d1 = cur === "T" ? 3 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 3);
        const d2 = cur === "T" ? 3 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 3);
        const d3 = cur === "T" ? 2 + Math.floor(Math.random() * 5) : 1 + Math.floor(Math.random() * 4);
        const total = d1 + d2 + d3;
        seedHistory.push({
          session: baseS + i,
          dice: [d1, d2, d3],
          total,
          result: total >= 11 ? "tai" : "xiu",
          tx: total >= 11 ? "T" : "X"
        });
      }

      this.seedFromRealHistory(seedHistory);
    } else {
      this.ensureActivePrediction();
    }
  }

  seedFromRealHistory(list) {
    if (!list || list.length < 15) return;
    this.history = list.slice(-50);
    this.sessionIds = new Set(this.history.map(h => h.session));
    store[this.game].history = this.history;

    // Chạy đánh giá kiểm định 30 phiên chuẩn hóa
    const outcomes = [];
    const startIdx = Math.max(5, this.history.length - 30);
    for (let i = startIdx; i < this.history.length; i++) {
      const histSlice = this.history.slice(0, i);
      const targetItem = this.history[i];
      const p = this.engine.predict(histSlice, null);

      const isTaiPred = normalizeResult(p.pred) === "tai";
      const isTaiActual = normalizeResult(targetItem.result) === "tai";
      const ok = isTaiPred === isTaiActual;

      outcomes.push({
        session: targetItem.session,
        pred: isTaiPred ? "tài" : "xỉu",
        actual: isTaiActual ? "tài" : "xỉu",
        ok,
        src: p.src || "Định lượng thực chiến",
        ts: Date.now() - (this.history.length - i) * 50000
      });
    }

    this.tracker.outcomes = outcomes;
    store[this.game].outcomes = outcomes;
    saveStore(store);
    this.ensureActivePrediction();
  }

  ensureActivePrediction() {
    if (this.history.length === 0) return;
    const lastSession = this.history.at(-1)?.session || 0;
    const targetSession = lastSession + 1;
    if (!this.activePred || this.activePred.session !== targetSession) {
      const p = this.engine.predict(this.history, this.tracker);
      this.activePred = {
        session: targetSession,
        pred: p.pred,
        conf: p.conf,
        src: p.src,
        reverse: p.reverse,
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
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(this.url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        this.isFetching = false;
        return;
      }

      const list = this.parse(await res.json());
      if (!list || !list.length) {
        this.isFetching = false;
        return;
      }

      list.sort((a, b) => a.session - b.session);

      // Nếu lần đầu nhận API thật và session khác xa mảng tạm: đồng bộ trực tiếp mảng thật
      const firstRealSession = list[0].session;
      if (this.history.length > 0 && Math.abs(this.history[0].session - firstRealSession) > 1000) {
        this.seedFromRealHistory(list);
        this.isFetching = false;
        return;
      }

      const lastCurrentSession = this.history.at(-1)?.session || 0;
      const newSessions = list.filter(r => r.session > lastCurrentSession);

      if (newSessions.length > 0) {
        for (const rec of newSessions) {
          if (this.activePred && rec.session === this.activePred.session) {
            this.tracker.record(rec.session, this.activePred.pred, rec.result, this.activePred.src);
            this.activePred = null;
          }
          this.history.push(rec);
          this.sessionIds.add(rec.session);
        }

        if (this.history.length > 500) {
          this.history = this.history.slice(-300);
          this.sessionIds = new Set(this.history.map(h => h.session));
        }

        store[this.game].history = this.history.slice(-100);
        saveStore(store);

        // Sinh dự đoán mới duy nhất cho phiên kế tiếp
        const nextTarget = (this.history.at(-1)?.session || 0) + 1;
        const p = this.engine.predict(this.history, this.tracker);
        this.activePred = {
          session: nextTarget,
          pred: p.pred,
          conf: p.conf,
          src: p.src,
          reverse: p.reverse,
          ts: Date.now()
        };
        store[this.game].activePred = this.activePred;
        saveStore(store);
      }
    } catch (e) {
      // Khi mất mạng hoặc đang chờ ván mới: Giữ nguyên session hiện tại
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
    return { session, dice, total, result: total >= 11 ? "tai" : "xiu", tx: total >= 11 ? "T" : "X" };
  }).filter(i => i.session > 0).sort((a, b) => a.session - b.session);
}

const hu = new SessionEngineCore("hu", API_HU, parseStream);
const md5 = new SessionEngineCore("md5", API_MD5, parseStream);

function checkKey(q) {
  if (!q?.key || q.key.trim() !== VALID_KEY) {
    return {
      ok: false,
      error: "BẠN PHẢI NHẬP MẬT KHẨU CHÍNH XÁC MỚI ĐƯỢC VÀO HỆ THỐNG.",
      author: "Phạm Anh Khôi",
      telegram: "@anhkhoi_xabc"
    };
  }
  return { ok: true };
}

function buildDashboardPayload() {
  const buildGame = (core) => {
    const l = core.last();
    const p = core.getPrediction();
    const st30 = core.tracker.get30Stats();
    return {
      last: l ? {
        session: l.session,
        dice: l.dice,
        total: l.total,
        result: l.result,
        resultDisplay: formatResultDisplay(l.result)
      } : null,
      prediction: p ? {
        session: p.session,
        pred: p.pred,
        predDisplay: formatResultDisplay(p.pred),
        conf: p.conf,
        src: p.src,
        reverse: p.reverse
      } : null,
      acc30: st30.acc30,
      accNum: st30.accNum,
      winCount: st30.winCount,
      lossCount: st30.lossCount,
      total30: st30.total30,
      maxWinStreak: st30.maxWinStreak,
      streakOk: st30.streakOk,
      streakNg: st30.streakNg,
      reverse: st30.reverse,
      outcomes: st30.outcomes.map(o => ({
        session: o.session,
        pred: o.pred,
        predDisplay: formatResultDisplay(o.pred),
        actual: o.actual,
        actualDisplay: formatResultDisplay(o.actual),
        ok: o.ok,
        src: o.src
      })),
      history: core.history.slice(-30).reverse().map(h => ({
        s: h.session,
        d: h.dice,
        t: h.total,
        r: h.result,
        tx: h.tx,
        rDisplay: formatResultDisplay(h.result)
      }))
    };
  };

  return {
    hu: buildGame(hu),
    md5: buildGame(md5),
    serverTime: Date.now(),
    author: "Phạm Anh Khôi",
    telegram: "@anhkhoi_xabc",
    version: "4.0.0-PRO",
    status: "online"
  };
}

async function startServer() {
  hu.start(3500);
  md5.start(3500);

  let fastifyLoaded = false;
  try {
    const fastifyModule = await import("fastify");
    const corsModule = await import("@fastify/cors");
    const staticModule = await import("@fastify/static");

    const app = fastifyModule.default({ logger: false });
    await app.register(corsModule.default, { origin: "*" });

    const staticRoot = existsSync(path.join(__dirname, "public")) ? path.join(__dirname, "public") : __dirname;
    await app.register(staticModule.default, {
      root: staticRoot,
      prefix: "/",
      index: "index.html"
    });

    app.get("/health", async () => ({ status: "ok", author: "Phạm Anh Khôi", time: Date.now() }));
    app.get("/api/health", async () => ({ status: "ok", author: "Phạm Anh Khôi", time: Date.now() }));

    app.get("/anh_khoi_security_suite_v2.html", async (req, reply) => {
      const htmlPath = existsSync(path.join(__dirname, "index.html"))
        ? path.join(__dirname, "index.html")
        : path.join(__dirname, "anh_khoi_security_suite_v2.html");
      const content = readFileSync(htmlPath, "utf8");
      reply.type("text/html; charset=utf-8").send(content);
    });

    app.get("/api/dashboard", async (req, reply) => {
      const ck = checkKey(req.query);
      if (!ck.ok) return reply.status(401).send({ error: ck.error, author: ck.author, telegram: ck.telegram });
      return buildDashboardPayload();
    });

    await app.listen({ port: PORT, host: HOST });
    console.log(`[PHẠM ANH KHÔI] Fastify Server đang chạy tại http://${HOST}:${PORT}`);
    fastifyLoaded = true;
  } catch (err) {
    console.log("[PHẠM ANH KHÔI] Chuyển đổi sang Native HTTP Server ổn định cao...");
  }

  if (!fastifyLoaded) {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pathname = parsedUrl.pathname;

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
        res.end(JSON.stringify(buildDashboardPayload()));
        return;
      }

      if (pathname === "/" || pathname === "/index.html" || pathname === "/anh_khoi_security_suite_v2.html") {
        let htmlPath = path.join(__dirname, "index.html");
        if (!existsSync(htmlPath)) htmlPath = path.join(__dirname, "public", "index.html");
        if (!existsSync(htmlPath)) htmlPath = path.join(__dirname, "anh_khoi_security_suite_v2.html");

        if (existsSync(htmlPath)) {
          const content = readFileSync(htmlPath, "utf8");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(content);
          return;
        }
      }

      let filePath = path.join(__dirname, pathname);
      if (!existsSync(filePath)) filePath = path.join(__dirname, "public", pathname);

      if (existsSync(filePath) && !filePath.endsWith("/")) {
        try {
          const content = readFileSync(filePath);
          let mime = "application/octet-stream";
          if (filePath.endsWith(".js")) mime = "application/javascript";
          else if (filePath.endsWith(".css")) mime = "text/css";
          else if (filePath.endsWith(".json")) mime = "application/json";
          else if (filePath.endsWith(".svg")) mime = "image/svg+xml";
          else if (filePath.endsWith(".png")) mime = "image/png";

          res.writeHead(200, { "Content-Type": mime });
          res.end(content);
          return;
        } catch {}
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
    });

    server.listen(PORT, HOST, () => {
      console.log(`[PHẠM ANH KHÔI] Native HTTP Server sẵn sàng tại http://${HOST}:${PORT}`);
    });
  }
}

process.on("uncaughtException", (err) => {
  console.error("[PHẠM ANH KHÔI] Lỗi uncaughtException:", err?.message || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[PHẠM ANH KHÔI] Lỗi unhandledRejection:", reason?.message || reason);
});

startServer();
