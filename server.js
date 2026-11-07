// ============================================================
// ZOMA BINGO — Telegram Mini App Server
// Updated: 2026-10-11 — instant buy/undo toggle + Four Corners
// ============================================================

console.log("🔥 ZOMA BINGO SERVER 2026-10-11");

import express from "express";
import http from "http";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";
import { WebSocketServer } from "ws";
import rateLimit from "express-rate-limit";
import { Bot, InlineKeyboard } from "grammy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || "";
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_TG_ID = String(process.env.ADMIN_TG_ID || "");
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN || BOT_TOKEN;
const SMS_SECRET = process.env.SMS_SECRET || "change-me-please";
const VERIFY_ET_WEBHOOK_SECRET = process.env.VERIFY_ET_WEBHOOK_SECRET || "";
const VERIFY_ET_API_KEY = process.env.VERIFY_ET_API_KEY || "";
const VERIFY_ET_BASE_URL = String(process.env.VERIFY_ET_BASE_URL || "https://verify.et").replace(/\/$/, "");
const AUTO_DEPOSIT_ENABLED = String(process.env.AUTO_DEPOSIT_ENABLED || "false").toLowerCase() === "true";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "zoma-admin-2026";

const CARD_PRICE = Number(process.env.CARD_PRICE || 10);
const HOUSE_CUT = Number(process.env.HOUSE_CUT ?? 0.10);
const TOTAL_CARDS = 500;
const MAX_CARDS_PER_PLAYER = 4;
const MIN_PLAYERS_TO_START = 2;
const LOBBY_COUNTDOWN = Number(process.env.ROUND_COUNTDOWN || 30);
const CALL_INTERVAL_MS = Number(process.env.CALL_INTERVAL_MS || 3500);
const WINNER_POPUP_SECONDS = Number(process.env.WINNER_POPUP_SECONDS || 3);
const WELCOME_BONUS = Number(process.env.WELCOME_BONUS || 100);
const BOT_COUNT = Number(process.env.BOT_COUNT || 100);
const BOT_BALANCE = Number(process.env.BOT_BALANCE || 10000);
const TB_NUMBER = process.env.TB_NUMBER || "0982372677";
const TB_NAME = process.env.TB_NAME || "Zoma Bingo";
const MIN_DEPOSIT = Number(process.env.MIN_DEPOSIT || 10);
const MAX_DEPOSIT = Number(process.env.MAX_DEPOSIT || 50000);
const MIN_DEPOSIT_FOR_WITHDRAWAL = Number(process.env.MIN_DEPOSIT_FOR_WITHDRAWAL || 100);

const REFERRAL_BONUS_INVITER = Number(process.env.REFERRAL_BONUS_INVITER || 20);
const BOT_USERNAME = process.env.BOT_USERNAME || "Biinnngobot";

const TB_RECEIVER_NAME = String(process.env.TB_RECEIVER_NAME || "helen yohaness bitew").trim().toLowerCase();

// ============================================================
// BOT NAMES
// ============================================================

const FIRST_NAMES = [
  "Abebe","Sara","Dawit","Hanna","Yonas","Marta","Bereket","Selam","Kebede","Meron",
  "Tesfaye","Rahel","Girma","Liya","Samuel","Bethel","Nahom","Eden","Mikias","Tsion",
  "Eyob","Feven","Natnael","Beza","Henok","Mimi","Kaleab","Rediet","Biruk","Selamawit",
  "Firaol","Sofia","Dagmawi","Mahlet","Yosef","Ruth","Solomon","Genet","Amanuel","Hiwot",
  "Binyam","Tigist","Ermias","Aster","Biniam","Almaz","Temesgen","Zewditu","Daniel","Kidist",
  "Elias","Helen","Getachew","Meseret","Mulugeta","Saba","Tewodros","Bethlehem","Abraham","Yeshi",
  "Yohannes","Tsehay","Fikru","Alem","Tadesse","Fikirte","Alemayehu","Aynalem","Dereje","Sindu",
  "Bekele","Wubit","Ayele","Emebet","Habtamu","Tizita","Endale","Bezawit","Chala","Mulu",
  "Guta","Eyerusalem","Lemma","Ebisa","Kenenisa","Beamlak","Tolosa","Derartu","Haile","Almitu",
  "Mekonnen","Chaltu","Wondimu","Bontu","Gadisa","Ejigayehu","Obsa","Rukiya","Tariku","Feyisa",
  "Lelisa","Senay","Mosisa","Gemechu","Kuulani","Robel","Nardos","Abdi","Iman","Mustafa","Halima"
];
const LAST_INITIALS = ["A","B","T","M","G","K","H","D","S","Y","W","N","F","R","L","Z","E","C","O","J"];

function pickBotName(i) {
  const first = FIRST_NAMES[i % FIRST_NAMES.length];
  const last = LAST_INITIALS[Math.floor(i / FIRST_NAMES.length) % LAST_INITIALS.length];
  return `${first} ${last}.`;
}

// ============================================================
// TELEGRAM AUTH
// ============================================================

function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate) return null;
    if (Math.floor(Date.now() / 1000) - authDate > 86400) return null;
    params.delete("hash");
    const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const calc = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const a = Buffer.from(calc, "hex"), b = Buffer.from(hash, "hex");
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
    const userRaw = params.get("user");
    if (!userRaw) return null;
    const user = JSON.parse(userRaw);
    user.start_param = params.get("start_param") || null;
    return user;
  } catch { return null; }
}

function extractInitData(req) {
  return req.headers["x-init"] || req.headers["x-telegram-init-data"] || req.body?.initData || req.query?.initData || null;
}

// ============================================================
// TELEGRAM NOTIFY
// ============================================================

async function tgNotify(chatId, text) {
  if (!ADMIN_BOT_TOKEN || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000)
    });
    const j = await res.json();
    if (!j.ok) console.error(`❌ tgNotify failed for ${chatId}:`, j.description);
  } catch (e) { console.error("❌ tgNotify error:", e.message); }
}

// ============================================================
// ENSURE USER + AUTH
// ============================================================

async function ensureUser(tgUser, startParam) {
  const existing = await pool.query(`SELECT telegram_id, balance FROM users WHERE telegram_id = $1`, [tgUser.id]);

  if (existing.rows.length) {
    await pool.query(
      `UPDATE users SET username=$1, first_name=$2, last_name=$3, updated_at=NOW() WHERE telegram_id=$4`,
      [tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, tgUser.id]
    );
    return { isNew: false, balance: Number(existing.rows[0].balance) };
  }

  let referrerId = null;
  if (startParam && startParam.startsWith("ref_")) {
    const candidate = Number(startParam.slice(4));
    if (Number.isInteger(candidate) && candidate > 0 && candidate !== tgUser.id) {
      const r = await pool.query(`SELECT telegram_id FROM users WHERE telegram_id=$1`, [candidate]);
      if (r.rows.length) referrerId = candidate;
    }
  }

  const inserted = await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, last_name, balance, referred_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING balance`,
    [tgUser.id, tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, WELCOME_BONUS, referrerId]
  );

  if (WELCOME_BONUS > 0) {
    await pool.query(
      `INSERT INTO transactions (telegram_id, type, amount, status, note)
       VALUES ($1, 'welcome_bonus', $2, 'completed', 'Welcome bonus')`,
      [tgUser.id, WELCOME_BONUS]
    );
  }

  if (referrerId && REFERRAL_BONUS_INVITER > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET balance=balance+$1, updated_at=NOW() WHERE telegram_id=$2`, [REFERRAL_BONUS_INVITER, referrerId]);
      await client.query(
        `INSERT INTO transactions (telegram_id, type, amount, status, note)
         VALUES ($1, 'referral', $2, 'completed', $3)`,
        [referrerId, REFERRAL_BONUS_INVITER, `Friend joined: ${tgUser.first_name || tgUser.id}`]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("referral credit:", e);
    } finally { client.release(); }

    await tgNotify(referrerId,
      `🎉 <b>Your friend joined!</b>\n\n` +
      `You earned <b>+${REFERRAL_BONUS_INVITER} birr</b> for inviting ` +
      `${tgUser.first_name || "a new player"}.\n\n` +
      `Keep inviting for more bonuses!`
    );
  }

  console.log(`🎁 New user ${tgUser.id}${referrerId ? ` (referred by ${referrerId})` : ""}`);
  return { isNew: true, balance: Number(inserted.rows[0].balance) };
}

async function authMiddleware(req, res, next) {
  try {
    const tgUser = validateInitData(extractInitData(req));
    if (!tgUser) return res.status(401).json({ error: "Invalid Telegram Mini App authentication" });
    req.tgUser = tgUser;
    const { isNew } = await ensureUser(tgUser, tgUser.start_param);
    req.isNewUser = isNew;
    next();
  } catch (err) {
    console.error("auth middleware:", err);
    res.status(500).json({ error: "Auth error" });
  }
}

// ============================================================
// EXPRESS
// ============================================================

const app = express();
app.set("trust proxy", 1);
app.use(express.json({
  limit: "1mb",
  verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

let startupReady = false;

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true, ready: startupReady,
    uptime: Math.floor(process.uptime()),
    game: game?.phase || "starting",
    bots: BOT_COUNT
  });
});

const apiLimiter = rateLimit({ windowMs: 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use("/api", apiLimiter);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// ============================================================
// POSTGRES
// ============================================================

if (!DATABASE_URL) console.error("❌ DATABASE_URL missing");
if (!BOT_TOKEN) console.error("❌ BOT_TOKEN missing");
if (!ADMIN_TG_ID) console.warn("⚠️ ADMIN_TG_ID missing");

const pool = new Pool({
  connectionString: DATABASE_URL || undefined,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
pool.on("error", (err) => console.error("pg pool:", err));

async function initDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE NOT NULL, username TEXT, first_name TEXT, last_name TEXT, balance NUMERIC(18,2) NOT NULL DEFAULT 0, is_bot BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT;`);

  await pool.query(`CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL, type TEXT NOT NULL, amount NUMERIC(18,2) NOT NULL, status TEXT NOT NULL DEFAULT 'pending', tx_id TEXT, phone TEXT, note TEXT, auto BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note TEXT;`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS transactions_tx_id_unique ON transactions (tx_id) WHERE tx_id IS NOT NULL;`);

  await pool.query(`CREATE TABLE IF NOT EXISTS promo_codes (code TEXT PRIMARY KEY, amount NUMERIC(18,2) NOT NULL, max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  await pool.query(`CREATE TABLE IF NOT EXISTS promo_redemptions (id SERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL, code TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(telegram_id, code));`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rounds (id SERIAL PRIMARY KEY, round_number INTEGER NOT NULL, phase TEXT NOT NULL, drawn INTEGER[] NOT NULL DEFAULT '{}', winner_names TEXT[], winner_card INTEGER, prize NUMERIC(18,2) NOT NULL DEFAULT 0, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ended_at TIMESTAMPTZ);`);

  const pc = await pool.query(`SELECT COUNT(*)::int AS n FROM promo_codes`);
  if (pc.rows[0].n === 0) {
    await pool.query(`INSERT INTO promo_codes (code, amount, max_uses) VALUES ('WELCOME20',20,1000),('ZOMA50',50,500),('BINGO100',100,200) ON CONFLICT (code) DO NOTHING;`);
    console.log("🎟️  Seeded default promo codes");
  }
  console.log("✅ Database initialized");
}

// ============================================================
// BOT SEEDING
// ============================================================

const BOT_ID_BASE = 9000000000000;

async function seedBots() {
  const existing = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE is_bot = TRUE`);
  if (existing.rows[0].n >= BOT_COUNT) {
    console.log(`✅ ${existing.rows[0].n} bots already in DB — skipping seed`);
    return;
  }
  console.log(`🤖 Seeding ${BOT_COUNT} bots (bulk insert)…`);
  const values = [], params = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    const b = i * 4;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, TRUE)`);
    params.push(BOT_ID_BASE + i, null, pickBotName(i), BOT_BALANCE);
  }
  await pool.query(`INSERT INTO users (telegram_id, username, first_name, balance, is_bot) VALUES ${values.join(",")} ON CONFLICT (telegram_id) DO UPDATE SET first_name = EXCLUDED.first_name, balance = EXCLUDED.balance, is_bot = TRUE, updated_at = NOW()`, params);
  console.log(`✅ ${BOT_COUNT} named bots ready (each ${BOT_BALANCE} birr)`);
}

// ============================================================
// CARD LOGIC
// ============================================================

function seeded(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cardFor(no) {
  const r = seeded(((no * 2654435761) >>> 0) ^ 0x9e3779b9);
  const cols = [0,1,2,3,4].map((c) => {
    const a = Array.from({ length: 15 }, (_, i) => c * 15 + i + 1);
    for (let i = 14; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, 5);
  });
  const card = [0,1,2,3,4].map((row) => cols.map((c) => c[row]));
  card[2][2] = 0;
  return card;
}

// ============================================================
// GAME STATE
// ============================================================

// Prevent a previous lobby's bot-purchase loop from continuing into a new lobby.
let botLobbyRun = 0;

const game = {
  phase: "lobby", countdown: null, drawn: [], drawnSet: new Set(), prize: 0,
  players: new Map(), cards: new Map(), pendingCards: new Set(), bots: [],
  winner: null, lobbyTimer: null, callTimer: null, endTimer: null, botSetup: false
};

function drawnPrize() { return Math.max(0, Math.floor(game.cards.size * CARD_PRICE * (1 - HOUSE_CUT))); }

function publicState(forTgId) {
  const cardsForUser = [];
  for (const entry of game.cards.values()) {
    if (String(entry.owner) === String(forTgId)) cardsForUser.push({ no: entry.cardNo, card: cardFor(entry.cardNo) });
  }
  const taken = [...new Set([...game.cards.values()].map(e => e.cardNo).concat([...game.pendingCards]))];
  const winnerPayload = game.winner ? { names: game.winner.names, prize: game.winner.prize, card: game.winner.card, you: game.winner.tgId === forTgId } : null;
  return {
    type: "state", phase: game.phase, countdown: game.countdown, drawn: game.drawn,
    prize: drawnPrize(), players: [...game.players.values()].filter(p => !p.isBot).length,
    bots: game.bots.length, taken, max: MAX_CARDS_PER_PLAYER, price: CARD_PRICE,
    cards: cardsForUser, winner: winnerPayload
  };
}

function sendState() {
  for (const ws of wss.clients) {
    if (ws.readyState === 1) { try { ws.send(JSON.stringify(publicState(ws.tgId))); } catch {} }
  }
}

function broadcastWinnerPopup(payload) {
  const msg = JSON.stringify({ type: "winner_popup", ...payload });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) { try { ws.send(msg); } catch {} }
  }
}

// ============================================================
// GAME LOOP
// ============================================================

async function startLobby() {
  clearTimers();
  const runId = ++botLobbyRun;

  game.phase = "lobby";
  game.countdown = null;
  game.drawn = [];
  game.drawnSet = new Set();
  game.cards.clear();
  game.pendingCards.clear();
  game.bots = [];
  game.winner = null;
  game.prize = 0;
  game.botSetup = false;

  sendState();

  // Start the lobby countdown immediately while bots buy cards in batches.
  startCountdown();
  addBots(runId).catch(err => console.error("bot lobby setup:", err));
}

function startCountdown() {
  if (game.phase !== "lobby" || game.botSetup || game.lobbyTimer) return;
  game.countdown = LOBBY_COUNTDOWN;
  sendState();
  game.lobbyTimer = setInterval(() => {
    game.countdown -= 1;
    if (game.countdown <= 0) {
      clearInterval(game.lobbyTimer);
      game.lobbyTimer = null;
      startRound();
      return;
    }
    sendState();
  }, 1000);
}

async function addBots(runId = botLobbyRun) {
  const taken = new Set([...game.cards.values()].map(e => e.cardNo));

  // Three bots each buy one card per batch; batches are one second apart.
  for (let i = 0; i < BOT_COUNT; i += 3) {
    if (runId !== botLobbyRun || game.phase !== "lobby") break;

    const updates = [];
    const batchEnd = Math.min(i + 3, BOT_COUNT);

    for (let botIndex = i; botIndex < batchEnd; botIndex++) {
      if (runId !== botLobbyRun || game.phase !== "lobby") break;

      const botTgId = BOT_ID_BASE + botIndex;
      const botName = pickBotName(botIndex);
      let cardNo = 0;
      let attempts = 0;

      do {
        cardNo = 1 + Math.floor(Math.random() * TOTAL_CARDS);
        attempts++;
      } while (
        (taken.has(cardNo) || game.pendingCards.has(cardNo)) &&
        attempts < 2000
      );

      if (taken.has(cardNo) || game.pendingCards.has(cardNo)) continue;

      taken.add(cardNo);
      game.cards.set(`${botTgId}:${cardNo}`, { cardNo, owner: botTgId });
      game.bots.push({ id: botIndex, tgId: botTgId, names: [botName], cards: [cardNo] });
      updates.push([CARD_PRICE, botTgId]);
      console.log(`🤖 ${botName} bought card #${cardNo}`);
    }

    if (updates.length) {
      try {
        const values = [];
        const params = [];
        updates.forEach(([cost, id], index) => {
          const b = index * 2;
          values.push(`($${b + 1}::numeric, $${b + 2}::bigint)`);
          params.push(cost, id);
        });
        await pool.query(
          `UPDATE users
           SET balance = GREATEST(0, balance - v.cost), updated_at = NOW()
           FROM (VALUES ${values.join(",")}) AS v(cost, id)
           WHERE users.telegram_id = v.id AND users.is_bot = TRUE`,
          params
        );
      } catch (err) {
        