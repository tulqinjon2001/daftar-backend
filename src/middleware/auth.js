const { verifyToken } = require("../services/jwtService");
const prisma = require("../prisma");

/**
 * JWT tekshiradi, req.userId va (Owner bo'lsa) req.shopId ni o'rnatadi.
 * Authorization: Bearer <accessToken> kerak.
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, data: null, message: "Token required" });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = verifyToken(token);
    req.userId = decoded.userId;
    if (!req.userId) {
      return res.status(401).json({ success: false, data: null, message: "Invalid token" });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    });
    if (!user) {
      return res.status(401).json({ success: false, data: null, message: "User not found" });
    }
    if (user.role === "Owner") {
      const shop = await prisma.shop.findFirst({
        where: { ownerId: req.userId },
        select: { id: true },
      });
      req.shopId = shop?.id || null;
    } else {
      req.shopId = null;
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, data: null, message: "Invalid or expired token" });
  }
}

/** Faqat Owner uchun ruxsat (shopId bo'lishi kerak) */
function requireOwner(req, res, next) {
  if (!req.shopId) {
    return res.status(403).json({ success: false, data: null, message: "Owner access required" });
  }
  next();
}

module.exports = { authMiddleware, requireOwner };
