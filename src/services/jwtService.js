const jwt = require("jsonwebtoken");

const ACCESS_EXPIRES = "15m";
const REFRESH_EXPIRES = "7d";
const IS_PROD = process.env.NODE_ENV === "production";
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  if (IS_PROD) {
    throw new Error("JWT_ACCESS_SECRET va JWT_REFRESH_SECRET production uchun majburiy");
  }
}

function signAccess(payload) {
  const secret = ACCESS_SECRET || "dev-access-secret-change-me";
  return jwt.sign(payload, secret, { expiresIn: ACCESS_EXPIRES });
}

function signRefresh(payload) {
  const secret = REFRESH_SECRET || "dev-refresh-secret-change-me";
  return jwt.sign(payload, secret, { expiresIn: REFRESH_EXPIRES });
}

function verifyToken(token) {
  const secret = ACCESS_SECRET || "dev-access-secret-change-me";
  return jwt.verify(token, secret);
}

function verifyRefreshToken(token) {
  const secret = REFRESH_SECRET || "dev-refresh-secret-change-me";
  return jwt.verify(token, secret);
}

module.exports = { signAccess, signRefresh, verifyToken, verifyRefreshToken };
