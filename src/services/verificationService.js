const crypto = require("crypto");
const prisma = require("../prisma");
const { sendTelegramMessage, getBotUsername } = require("./telegramService");

const TTL_MS = 5 * 60 * 1000;
const DELIVERY_TTL_MS = 5 * 60 * 1000;
const OTP_BOT_NOTE = " (@qarzdaftarsms_bot — oddiy SMS emas)";
const TG_REMOVE_KB = { remove_keyboard: true };
let otpTablesReady = false;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizePhone(phone) {
  const d = (phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("998")) return d;
  if (d.length >= 9) return `998${d.slice(-9)}`;
  return d;
}

function otpScope(kind, phoneNorm, userId, newPhoneNorm) {
  if (kind === "owner" || kind === "reset") return `${kind}:${phoneNorm}`;
  if (kind === "cpassword") return `${kind}:${userId}`;
  return `${kind}:${userId}:${newPhoneNorm}`;
}

function devCodeAllowed() {
  const v = process.env.ALLOW_OTP_DEV_CODE;
  if (process.env.NODE_ENV === "production") return false;
  return v === "1" || v === "true";
}

function telegramConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && getBotUsername());
}

function isValidOtpPhoneNorm(normalized) {
  return !!normalized && normalized.startsWith("998") && normalized.length >= 12;
}

function buildOtpMessage(kind, code) {
  const label = {
    owner: "ro'yxatdan o'tish",
    reset: "parolni tiklash",
    cpassword: "parolni almashtirish",
    cphone: "yangi telefon raqamini tasdiqlash",
  }[kind];
  return `Qarz Daftar — ${label} kodi: ${code}${OTP_BOT_NOTE}`;
}

async function ensureOtpTables() {
  if (otpTablesReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id TEXT PRIMARY KEY,
      scope TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL,
      phone_norm TEXT NULL,
      user_id TEXT NULL,
      new_phone_norm TEXT NULL,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS otp_delivery_tokens (
      token TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      phone_norm TEXT NULL,
      user_id TEXT NULL,
      new_phone_norm TEXT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS otp_verified_grants (
      id TEXT PRIMARY KEY,
      scope TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  otpTablesReady = true;
}

async function upsertVerifiedGrant(scope, expiresAtMs) {
  await ensureOtpTables();
  const id = crypto.randomUUID();
  const expiresAtIso = new Date(expiresAtMs).toISOString();
  await prisma.$executeRaw`
    INSERT INTO otp_verified_grants (id, scope, expires_at, created_at)
    VALUES (${id}, ${scope}, ${expiresAtIso}::timestamptz, NOW())
    ON CONFLICT (scope)
    DO UPDATE SET expires_at = EXCLUDED.expires_at
  `;
}

async function consumeVerifiedGrant(scope) {
  await ensureOtpTables();
  const rows = await prisma.$queryRaw`
    SELECT expires_at
    FROM otp_verified_grants
    WHERE scope = ${scope}
    LIMIT 1
  `;
  const row = Array.isArray(rows) ? rows[0] : null;
  await prisma.$executeRaw`DELETE FROM otp_verified_grants WHERE scope = ${scope}`;
  if (!row?.expires_at) return false;
  return Date.now() <= new Date(row.expires_at).getTime();
}

async function upsertOtpCode(kind, code, expiresAtMs, phoneNorm, userId, newPhoneNorm) {
  await ensureOtpTables();
  const scope = otpScope(kind, phoneNorm, userId, newPhoneNorm);
  const id = crypto.randomUUID();
  const expiresAtIso = new Date(expiresAtMs).toISOString();
  await prisma.$executeRaw`
    INSERT INTO otp_codes (id, scope, kind, phone_norm, user_id, new_phone_norm, code, expires_at, created_at, updated_at)
    VALUES (${id}, ${scope}, ${kind}, ${phoneNorm || null}, ${userId || null}, ${newPhoneNorm || null}, ${String(code)}, ${expiresAtIso}::timestamptz, NOW(), NOW())
    ON CONFLICT (scope)
    DO UPDATE SET
      kind = EXCLUDED.kind,
      phone_norm = EXCLUDED.phone_norm,
      user_id = EXCLUDED.user_id,
      new_phone_norm = EXCLUDED.new_phone_norm,
      code = EXCLUDED.code,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
  `;
  return scope;
}

async function getOtpCode(kind, phoneNorm, userId, newPhoneNorm) {
  await ensureOtpTables();
  const scope = otpScope(kind, phoneNorm, userId, newPhoneNorm);
  const rows = await prisma.$queryRaw`
    SELECT code, expires_at
    FROM otp_codes
    WHERE scope = ${scope}
    LIMIT 1
  `;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.code || !row?.expires_at) return null;
  return { code: String(row.code), expiresAt: new Date(row.expires_at).getTime(), scope };
}

async function deleteOtpCode(kind, phoneNorm, userId, newPhoneNorm) {
  await ensureOtpTables();
  const scope = otpScope(kind, phoneNorm, userId, newPhoneNorm);
  await prisma.$executeRaw`DELETE FROM otp_codes WHERE scope = ${scope}`;
}

async function createTelegramDelivery(kind, phoneNorm, userId, newPhoneNorm) {
  if (!telegramConfigured()) return null;
  await ensureOtpTables();
  const scope = otpScope(kind, phoneNorm, userId, newPhoneNorm);
  await prisma.$executeRaw`DELETE FROM otp_delivery_tokens WHERE scope = ${scope}`;
  const token = { owner: "r", reset: "p", cpassword: "c", cphone: "n" }[kind] + crypto.randomBytes(16).toString("hex");
  const expiresAtIso = new Date(Date.now() + DELIVERY_TTL_MS).toISOString();
  await prisma.$executeRaw`
    INSERT INTO otp_delivery_tokens (token, scope, kind, phone_norm, user_id, new_phone_norm, expires_at, created_at)
    VALUES (${token}, ${scope}, ${kind}, ${phoneNorm || null}, ${userId || null}, ${newPhoneNorm || null}, ${expiresAtIso}::timestamptz, NOW())
  `;
  const bot = getBotUsername();
  const deepLink = `https://t.me/${bot}?start=${token}`;
  return { token, deepLink, scope };
}

async function getDeliveryByToken(token) {
  await ensureOtpTables();
  const rows = await prisma.$queryRaw`
    SELECT token, scope, kind, phone_norm, user_id, new_phone_norm, expires_at
    FROM otp_delivery_tokens
    WHERE token = ${token}
    LIMIT 1
  `;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.token) return null;
  return {
    token: String(row.token),
    scope: String(row.scope),
    kind: String(row.kind),
    phoneNorm: row.phone_norm ? String(row.phone_norm) : undefined,
    userId: row.user_id ? String(row.user_id) : undefined,
    newPhoneNorm: row.new_phone_norm ? String(row.new_phone_norm) : undefined,
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

async function deleteDeliveryByToken(token) {
  await ensureOtpTables();
  await prisma.$executeRaw`DELETE FROM otp_delivery_tokens WHERE token = ${token}`;
}

function wrapTelegramOut(deepLink, code, { autoSent = false } = {}) {
  const out = {
    success: true,
    message: autoSent ? "Telegram orqali kod yuborildi" : "Telegram orqali kod oling",
    telegramDeepLink: deepLink,
  };
  if (devCodeAllowed()) out.devCode = code;
  return out;
}

async function sendTelegramText(chatId, text) {
  let sent = await sendTelegramMessage(chatId, text, { reply_markup: TG_REMOVE_KB });
  if (!sent?.ok) sent = await sendTelegramMessage(chatId, text);
  return sent;
}

async function getChatIdByPhoneNorm(phoneNorm) {
  try {
    if (!isValidOtpPhoneNorm(phoneNorm)) return null;
    const rows = await prisma.$queryRaw`
      SELECT chat_id
      FROM telegram_chat_links
      WHERE phone = ${phoneNorm}
      LIMIT 1
    `;
    const row = Array.isArray(rows) ? rows[0] : null;
    return row?.chat_id ? String(row.chat_id) : null;
  } catch (e) {
    console.error("[telegram chat-map] o'qish xato:", e);
    return null;
  }
}

async function getExpectedChatIdForEntry(entry) {
  if (!entry) return null;
  if (entry.kind === "owner" || entry.kind === "reset") return getChatIdByPhoneNorm(entry.phoneNorm);
  if (entry.kind === "cphone") return getChatIdByPhoneNorm(entry.newPhoneNorm);
  if (entry.kind === "cpassword") {
    const user = await prisma.user.findUnique({ where: { id: entry.userId } });
    const phoneNorm = normalizePhone(user?.phone);
    if (!isValidOtpPhoneNorm(phoneNorm)) return null;
    return getChatIdByPhoneNorm(phoneNorm);
  }
  return null;
}

async function tryAutoSendByPhoneNorm(phoneNorm, text) {
  const chatId = await getChatIdByPhoneNorm(phoneNorm);
  if (!chatId) return false;
  const sent = await sendTelegramText(chatId, text);
  return !!sent?.ok;
}

async function tryAutoSendByUserId(userId, text) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const phoneNorm = normalizePhone(user?.phone);
  if (!isValidOtpPhoneNorm(phoneNorm)) return false;
  return tryAutoSendByPhoneNorm(phoneNorm, text);
}

async function setTelegramChatForPhone(phone, chatId) {
  const normalized = normalizePhone(phone || "");
  if (!isValidOtpPhoneNorm(normalized)) return false;
  try {
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO telegram_chat_links (id, phone, chat_id, created_at, updated_at)
      VALUES (${id}, ${normalized}, ${String(chatId)}, NOW(), NOW())
      ON CONFLICT (phone)
      DO UPDATE SET chat_id = EXCLUDED.chat_id, updated_at = NOW()
    `;
    return true;
  } catch (e) {
    console.error("[telegram chat-map] yozish xato:", e);
    return false;
  }
}

async function moveTelegramChatPhone(fromPhone, toPhone) {
  const fromNorm = normalizePhone(fromPhone || "");
  const toNorm = normalizePhone(toPhone || "");
  if (!isValidOtpPhoneNorm(fromNorm) || !isValidOtpPhoneNorm(toNorm)) return false;
  try {
    const existingToRows = await prisma.$queryRaw`
      SELECT phone
      FROM telegram_chat_links
      WHERE phone = ${toNorm}
      LIMIT 1
    `;
    const hasExistingTo = Array.isArray(existingToRows) && !!existingToRows[0]?.phone;
    if (hasExistingTo) {
      await prisma.$executeRaw`DELETE FROM telegram_chat_links WHERE phone = ${fromNorm}`;
      return true;
    }

    const rows = await prisma.$queryRaw`
      SELECT chat_id
      FROM telegram_chat_links
      WHERE phone = ${fromNorm}
      LIMIT 1
    `;
    const from = Array.isArray(rows) ? rows[0] : null;
    if (!from?.chat_id) return false;
    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO telegram_chat_links (id, phone, chat_id, created_at, updated_at)
      VALUES (${id}, ${toNorm}, ${String(from.chat_id)}, NOW(), NOW())
      ON CONFLICT (phone)
      DO UPDATE SET chat_id = EXCLUDED.chat_id, updated_at = NOW()
    `;
    if (fromNorm !== toNorm) {
      await prisma.$executeRaw`DELETE FROM telegram_chat_links WHERE phone = ${fromNorm}`;
    }
    return true;
  } catch (e) {
    console.error("[telegram chat-map] ko'chirish xato:", e);
    return false;
  }
}

async function processTelegramStart(chatId, payload) {
  if (!payload || typeof payload !== "string" || payload.length < 3) return;
  const entry = await getDeliveryByToken(payload);
  if (!entry || Date.now() > entry.expiresAt) {
    await deleteDeliveryByToken(payload);
    await sendTelegramText(chatId, "Havola muddati tugagan yoki noto'g'ri. Sayt yoki ilovadan qayta kod so'rang.");
    return;
  }

  const expectedChatId = await getExpectedChatIdForEntry(entry);
  if (expectedChatId && String(expectedChatId) !== String(chatId)) {
    await sendTelegramText(chatId, "Bu tasdiqlash kodi boshqa raqam/chat uchun. Iltimos, o'zingizning raqamingizni ulab qayta urinib ko'ring.");
    return;
  }

  const otp = await getOtpCode(entry.kind, entry.phoneNorm, entry.userId, entry.newPhoneNorm);
  const text = otp ? buildOtpMessage(entry.kind, otp.code) : null;
  if (!otp || Date.now() > otp.expiresAt || !text) {
    await deleteDeliveryByToken(payload);
    await sendTelegramText(chatId, "Kod muddati tugagan. Saytdan qayta urinib ko'ring.");
    return;
  }

  const sent = await sendTelegramText(chatId, text);
  if (sent?.ok) await deleteDeliveryByToken(payload);
}

async function tryProcessTelegramStartFallback(_chatId) {
  if (process.env.TELEGRAM_USE_POLLING !== "1") return false;
  if (process.env.TELEGRAM_ALLOW_START_FALLBACK !== "1") return false;
  return false;
}

async function sendPhoneOtp(phone, kind) {
  const normalized = normalizePhone(phone);
  if (!isValidOtpPhoneNorm(normalized)) return { success: false, message: "Invalid phone" };
  if (!telegramConfigured()) {
    return { success: false, message: "Telegram OTP sozlanmagan. TELEGRAM_BOT_TOKEN va TELEGRAM_BOT_USERNAME (.env) ni qo'ying." };
  }
  const code = generateCode();
  const expiresAt = Date.now() + TTL_MS;
  await upsertOtpCode(kind, code, expiresAt, normalized, undefined, undefined);
  const delivery = await createTelegramDelivery(kind, normalized, undefined, undefined);
  const text = buildOtpMessage(kind, code);
  if (await tryAutoSendByPhoneNorm(normalized, text)) return wrapTelegramOut(delivery?.deepLink, code, { autoSent: true });
  return wrapTelegramOut(delivery.deepLink, code, { autoSent: false });
}

async function sendCode(phone) {
  return sendPhoneOtp(phone, "owner");
}

async function verifyCode(phone, code) {
  const normalized = normalizePhone(phone);
  const stored = await getOtpCode("owner", normalized);
  if (!stored) return { success: false, message: "Code not found or expired" };
  if (Date.now() > stored.expiresAt) {
    await deleteOtpCode("owner", normalized);
    return { success: false, message: "Code expired" };
  }
  if (stored.code !== String(code)) return { success: false, message: "Invalid code" };
  await deleteOtpCode("owner", normalized);
  await upsertVerifiedGrant(`owner:${normalized}`, Date.now() + TTL_MS);
  return { success: true };
}

async function sendResetCode(phone) {
  return sendPhoneOtp(phone, "reset");
}

async function verifyResetCode(phone, code) {
  const normalized = normalizePhone(phone);
  const stored = await getOtpCode("reset", normalized);
  if (!stored) return { success: false, message: "Code not found or expired" };
  if (Date.now() > stored.expiresAt) {
    await deleteOtpCode("reset", normalized);
    return { success: false, message: "Code expired" };
  }
  if (stored.code !== String(code)) return { success: false, message: "Invalid code" };
  return { success: true };
}

async function consumeResetCode(phone, code) {
  const normalized = normalizePhone(phone);
  const stored = await getOtpCode("reset", normalized);
  if (!stored || stored.code !== String(code) || Date.now() > stored.expiresAt) {
    await deleteOtpCode("reset", normalized);
    return false;
  }
  await deleteOtpCode("reset", normalized);
  return true;
}

async function sendProfilePasswordChangeCode(userId) {
  if (!userId) return { success: false, message: "User required" };
  if (!telegramConfigured()) {
    return { success: false, message: "Telegram OTP sozlanmagan. TELEGRAM_BOT_TOKEN va TELEGRAM_BOT_USERNAME (.env) ni qo'ying." };
  }
  const code = generateCode();
  const expiresAt = Date.now() + TTL_MS;
  await upsertOtpCode("cpassword", code, expiresAt, undefined, userId, undefined);
  const delivery = await createTelegramDelivery("cpassword", undefined, userId, undefined);
  const text = buildOtpMessage("cpassword", code);
  if (await tryAutoSendByUserId(userId, text)) return wrapTelegramOut(delivery?.deepLink, code, { autoSent: true });
  return wrapTelegramOut(delivery.deepLink, code, { autoSent: false });
}

async function consumeProfilePasswordCode(userId, code) {
  const stored = await getOtpCode("cpassword", undefined, userId, undefined);
  if (!stored || stored.code !== String(code) || Date.now() > stored.expiresAt) {
    await deleteOtpCode("cpassword", undefined, userId, undefined);
    return false;
  }
  await deleteOtpCode("cpassword", undefined, userId, undefined);
  return true;
}

async function sendProfilePhoneChangeCode(userId, newPhoneNorm) {
  if (!userId || !newPhoneNorm) return { success: false, message: "Invalid" };
  if (!isValidOtpPhoneNorm(newPhoneNorm)) return { success: false, message: "Invalid phone" };
  if (!telegramConfigured()) {
    return { success: false, message: "Telegram OTP sozlanmagan. TELEGRAM_BOT_TOKEN va TELEGRAM_BOT_USERNAME (.env) ni qo'ying." };
  }
  const code = generateCode();
  const expiresAt = Date.now() + TTL_MS;
  await upsertOtpCode("cphone", code, expiresAt, undefined, userId, newPhoneNorm);
  const delivery = await createTelegramDelivery("cphone", undefined, userId, newPhoneNorm);
  const text = buildOtpMessage("cphone", code);
  if (await tryAutoSendByPhoneNorm(newPhoneNorm, text)) return wrapTelegramOut(delivery?.deepLink, code, { autoSent: true });
  return wrapTelegramOut(delivery.deepLink, code, { autoSent: false });
}

async function consumeProfilePhoneCode(userId, newPhoneNorm, code) {
  const stored = await getOtpCode("cphone", undefined, userId, newPhoneNorm);
  if (!stored || stored.code !== String(code) || Date.now() > stored.expiresAt) {
    await deleteOtpCode("cphone", undefined, userId, newPhoneNorm);
    return false;
  }
  await deleteOtpCode("cphone", undefined, userId, newPhoneNorm);
  return true;
}

async function consumeOwnerVerificationGrant(phone) {
  const normalized = normalizePhone(phone || "");
  if (!isValidOtpPhoneNorm(normalized)) return false;
  return consumeVerifiedGrant(`owner:${normalized}`);
}

module.exports = {
  sendCode,
  verifyCode,
  sendResetCode,
  verifyResetCode,
  consumeResetCode,
  sendProfilePasswordChangeCode,
  consumeProfilePasswordCode,
  sendProfilePhoneChangeCode,
  consumeProfilePhoneCode,
  consumeOwnerVerificationGrant,
  normalizePhone,
  setTelegramChatForPhone,
  moveTelegramChatPhone,
  processTelegramStart,
  tryProcessTelegramStartFallback,
  TTL_MS,
};
