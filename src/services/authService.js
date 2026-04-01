const bcrypt = require("bcrypt");
const crypto = require("crypto");
const prisma = require("../prisma");
const {
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
  normalizePhone: normPhone,
  moveTelegramChatPhone,
} = require("./verificationService");
const { signAccess, signRefresh, verifyRefreshToken } = require("./jwtService");

const BCRYPT_ROUNDS = 12;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let refreshSessionsReady = false;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function ensureRefreshSessionsTable() {
  if (refreshSessionsReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS refresh_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NULL,
      replaced_by TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_id ON refresh_sessions (user_id)`);
  refreshSessionsReady = true;
}

async function createRefreshSession(userId) {
  await ensureRefreshSessionsTable();
  const sid = crypto.randomUUID();
  const refreshToken = signRefresh({ userId, sid });
  const tokenHash = hashToken(refreshToken);
  const expiresAtIso = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
  await prisma.$executeRaw`
    INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, created_at, updated_at)
    VALUES (${sid}, ${userId}, ${tokenHash}, ${expiresAtIso}::timestamptz, NOW(), NOW())
  `;
  return refreshToken;
}

async function issueAuthTokens(userId, role) {
  const accessToken = signAccess({ userId, role });
  const refreshToken = await createRefreshSession(userId);
  return { accessToken, refreshToken };
}

/**
 * Owner uchun tasdiqlash kodi yuborish (1-qadamdan keyin)
 */
async function sendOwnerVerificationCode(phone) {
  return sendCode(phone);
}

/**
 * Kodni tekshirish
 */
async function verifyOwnerCode(phone, code) {
  return verifyCode(phone, code);
}

/**
 * Parol tiklash: kod yuborish
 */
async function sendPasswordResetCode(phone) {
  return sendResetCode(phone);
}

/**
 * Parol tiklash: kodni tekshirish
 */
async function verifyPasswordResetCode(phone, code) {
  return verifyResetCode(phone, code);
}

/**
 * Parol tiklash: yangi parol o'rnatish (kod tekshiriladi, keyin parol yangilanadi)
 */
/**
 * Kirgan foydalanuvchi: parol almashtirish uchun Telegram OTP yuborish
 */
async function sendChangePasswordCode(userId, currentPassword) {
  if (!currentPassword) {
    return { success: false, message: "Joriy parol kerak" };
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { success: false, message: "Foydalanuvchi topilmadi" };
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) return { success: false, message: "Joriy parol noto'g'ri" };
  return sendProfilePasswordChangeCode(userId);
}

/**
 * Kirgan foydalanuvchi: joriy parol + OTP + yangi parol
 */
async function changePasswordWithOtp(userId, currentPassword, newPassword, otpCode) {
  if (!newPassword || String(newPassword).length < 8) {
    return { success: false, message: "Yangi parol kamida 8 belgi bo'lishi kerak" };
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { success: false, message: "Foydalanuvchi topilmadi" };
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) return { success: false, message: "Joriy parol noto'g'ri" };
  if (!(await consumeProfilePasswordCode(userId, otpCode))) {
    return { success: false, message: "Kod noto'g'ri yoki muddati o'tgan" };
  }
  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });
  return { success: true, message: "Parol yangilandi" };
}

function userPhoneNorm(user) {
  const d = (user.phone || "").replace(/\D/g, "");
  if (!d) return "";
  const with998 = d.startsWith("998") ? d : `998${d.slice(-9)}`;
  return normPhone(with998);
}

/**
 * Yangi telefon uchun OTP (Telegram). Oldin raqam band emasligini tekshiramiz.
 */
async function sendPhoneChangeCode(userId, newPhone) {
  const newNorm = normPhone(newPhone);
  if (!newNorm.startsWith("998") || newNorm.length < 12) {
    return { success: false, message: "Telefon noto'g'ri" };
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { success: false, message: "Foydalanuvchi topilmadi" };
  const curNorm = userPhoneNorm(user);
  if (curNorm && curNorm === newNorm) {
    return { success: false, message: "Yangi raqam joridan farq qilishi kerak" };
  }
  const taken = await prisma.user.findFirst({
    where: {
      id: { not: userId },
      OR: [{ phone: newNorm }, { phone: newNorm.slice(-9) }],
    },
  });
  if (taken) return { success: false, message: "Bu raqam boshqa akkauntda band" };
  return sendProfilePhoneChangeCode(userId, newNorm);
}

/**
 * OTP tasdiqlangach telefonni yangilash
 */
async function confirmPhoneChange(userId, newPhone, otpCode) {
  const newNorm = normPhone(newPhone);
  if (!(await consumeProfilePhoneCode(userId, newNorm, otpCode))) {
    return { success: false, message: "Kod noto'g'ri yoki muddati o'tgan" };
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { success: false, message: "Foydalanuvchi topilmadi" };
  const curNorm = userPhoneNorm(user);
  if (curNorm === newNorm) {
    return { success: false, message: "Raqam o'zgarmagan" };
  }
  const taken = await prisma.user.findFirst({
    where: {
      id: { not: userId },
      OR: [{ phone: newNorm }, { phone: newNorm.slice(-9) }],
    },
  });
  if (taken) return { success: false, message: "Bu raqam boshqa akkauntda band" };

  const data = { phone: newNorm };
  if (user.role === "Owner" && /^owner_\d+@qarzdaftar\.local$/i.test(user.email || "")) {
    data.email = `owner_${newNorm}@qarzdaftar.local`;
    const emailBusy = await prisma.user.findFirst({
      where: { email: data.email, NOT: { id: userId } },
    });
    if (emailBusy) return { success: false, message: "Bu telefon uchun email band" };
  }
  await prisma.user.update({ where: { id: userId }, data });

  // Telefon o'zgargan bo'lsa, ulangan chatni ham yangi telefonga ko'chiramiz.
  // Bu bilan keyingi OTP'lar avtomatik shu chatga kelishda davom etadi.
  try {
    await moveTelegramChatPhone(curNorm, newNorm);
  } catch (_) {}

  return {
    success: true,
    message: "Telefon yangilandi",
    data: { phone: newNorm.slice(-9) },
  };
}

async function setNewPassword(phone, code, newPassword) {
  const normalizedPhone = normPhone(phone);
  if (!(await consumeResetCode(normalizedPhone, code))) {
    return { success: false, message: "Kod noto'g'ri yoki muddati o'tgan" };
  }
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ phone: normalizedPhone }, { phone: normalizedPhone.slice(-9) }],
    },
  });
  if (!user) {
    return { success: false, message: "Foydalanuvchi topilmadi" };
  }
  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });
  return { success: true, message: "Parol yangilandi" };
}

/**
 * Login: telefon va parol orqali kirish. Ro'yxatdan o'tganligini tekshiradi.
 * Body: phone, password
 */
async function login(phone, password) {
  const normalized = (phone || "").replace(/\D/g, "").trim();
  const normalized9 = normalized.slice(-9);
  if (!normalized9) {
    return { success: false, message: "Telefon raqamini kiriting" };
  }
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ phone: normalized9 }, { phone: normalized }],
    },
  });
  if (!user) {
    return { success: false, message: "Bunday telefon ro'yxatdan o'tmagan" };
  }
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return { success: false, message: "Parol noto'g'ri" };
  }
  let shop = null;
  if (user.role === "Owner") {
    shop = await prisma.shop.findFirst({
      where: { ownerId: user.id },
    });
  }
  const tokens = await issueAuthTokens(user.id, user.role);
  return {
    success: true,
    data: {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
      shop: shop
        ? {
            id: shop.id,
            name: shop.name,
            address: shop.address,
            openAt: shop.openAt,
            closeAt: shop.closeAt,
          }
        : null,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
    message: "Kirish muvaffaqiyatli",
  };
}

/**
 * Owner ro'yxatdan o'tkazish: User (Owner) + Shop yaratish.
 * full_name, phone, password, shop_name, address, open_at, close_at
 * Parol BCrypt 12 rounds. Email unique bo'lgani uchun phone asosida yaratamiz.
 */
async function registerOwner(data) {
  const {
    full_name,
    phone,
    password,
    shop_name,
    address,
    open_at,
    close_at,
  } = data;

  const normalizedPhone = phone.replace(/\D/g, "").trim();
  const verified = await consumeOwnerVerificationGrant(normalizedPhone);
  if (!verified) {
    return { success: false, message: "Avval OTP kodni tasdiqlang" };
  }
  const email = `owner_${normalizedPhone}@qarzdaftar.local`;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone: normalizedPhone }] },
  });
  if (existing) {
    return { success: false, message: "Phone or account already registered" };
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name: full_name,
      phone: normalizedPhone,
      role: "Owner",
    },
  });

  const shop = await prisma.shop.create({
    data: {
      name: shop_name,
      address,
      openAt: open_at,
      closeAt: close_at,
      ownerId: user.id,
    },
  });
  const tokens = await issueAuthTokens(user.id, user.role);

  return {
    success: true,
    data: {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
      shop: {
        id: shop.id,
        name: shop.name,
        address: shop.address,
        openAt: shop.openAt,
        closeAt: shop.closeAt,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
    message: "Owner registered successfully",
  };
}

/**
 * Oddiy xaridor ro'yxatdan o'tishi (shop yaratmaydi).
 * full_name, phone, password
 */
async function registerCustomer(data) {
  const { full_name, phone, password } = data;
  const normalizedPhone = String(phone || "").replace(/\D/g, "").trim();
  const verified = await consumeOwnerVerificationGrant(normalizedPhone);
  if (!verified) {
    return { success: false, message: "Avval OTP kodni tasdiqlang" };
  }
  if (!full_name || !String(full_name).trim()) {
    return { success: false, message: "Ism kerak" };
  }
  if (!password || String(password).length < 8) {
    return { success: false, message: "Parol kamida 8 belgi bo'lishi kerak" };
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ phone: normalizedPhone }, { phone: normalizedPhone.slice(-9) }],
    },
  });
  if (existing) {
    return { success: false, message: "Phone or account already registered" };
  }

  const email = `customer_${normalizedPhone}_${Date.now()}@qarzdaftar.local`;
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name: String(full_name).trim(),
      phone: normalizedPhone,
      role: "Customer",
    },
  });
  const tokens = await issueAuthTokens(user.id, user.role);
  return {
    success: true,
    data: {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
      shop: null,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
    message: "Customer registered successfully",
  };
}

async function refreshTokens(refreshToken) {
  if (!refreshToken) return { success: false, message: "refreshToken kerak" };
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    return { success: false, message: "Refresh token yaroqsiz" };
  }

  const userId = decoded?.userId;
  const sid = decoded?.sid;
  if (!userId || !sid) return { success: false, message: "Refresh token yaroqsiz" };
  await ensureRefreshSessionsTable();

  const rows = await prisma.$queryRaw`
    SELECT id, user_id, token_hash, expires_at, revoked_at
    FROM refresh_sessions
    WHERE id = ${sid} AND user_id = ${userId}
    LIMIT 1
  `;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { success: false, message: "Refresh session topilmadi" };
  if (row.revoked_at) return { success: false, message: "Refresh token bekor qilingan" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { success: false, message: "Refresh token muddati o'tgan" };
  if (String(row.token_hash) !== hashToken(refreshToken)) return { success: false, message: "Refresh token mos emas" };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) return { success: false, message: "Foydalanuvchi topilmadi" };

  const nextRefresh = await createRefreshSession(user.id);
  const decodedNext = verifyRefreshToken(nextRefresh);
  const nextSid = decodedNext?.sid;

  await prisma.$executeRaw`
    UPDATE refresh_sessions
    SET revoked_at = NOW(), replaced_by = ${nextSid || null}, updated_at = NOW()
    WHERE id = ${sid}
  `;

  return {
    success: true,
    data: {
      accessToken: signAccess({ userId: user.id, role: user.role }),
      refreshToken: nextRefresh,
    },
    message: "Tokenlar yangilandi",
  };
}

async function logoutRefreshSession(refreshToken) {
  if (!refreshToken) return { success: false, message: "refreshToken kerak" };
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    return { success: true, message: "Logout qilindi" };
  }
  const userId = decoded?.userId;
  const sid = decoded?.sid;
  if (!userId || !sid) return { success: true, message: "Logout qilindi" };

  await ensureRefreshSessionsTable();
  const rows = await prisma.$queryRaw`
    SELECT token_hash
    FROM refresh_sessions
    WHERE id = ${sid} AND user_id = ${userId}
    LIMIT 1
  `;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { success: true, message: "Logout qilindi" };
  if (String(row.token_hash) !== hashToken(refreshToken)) return { success: true, message: "Logout qilindi" };

  await prisma.$executeRaw`
    UPDATE refresh_sessions
    SET revoked_at = NOW(), updated_at = NOW()
    WHERE id = ${sid}
  `;
  return { success: true, message: "Logout qilindi" };
}

module.exports = {
  login,
  sendOwnerVerificationCode,
  verifyOwnerCode,
  registerOwner,
  registerCustomer,
  sendPasswordResetCode,
  verifyPasswordResetCode,
  setNewPassword,
  sendChangePasswordCode,
  changePasswordWithOtp,
  sendPhoneChangeCode,
  confirmPhoneChange,
  refreshTokens,
  logoutRefreshSession,
};
