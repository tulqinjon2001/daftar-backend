const express = require("express");
const authController = require("../controllers/authController");
const { validateRegisterOwner, validateShopDetails } = require("../middleware/validateRegisterOwner");
const { authMiddleware } = require("../middleware/auth");
const { createRateLimit } = require("../middleware/rateLimit");

const router = express.Router();
const loginLimiter = createRateLimit({ windowMs: 60 * 1000, max: 10, message: "Login urinishlar soni ko'p. Keyinroq urinib ko'ring" });
const otpSendLimiter = createRateLimit({ windowMs: 60 * 1000, max: 5, message: "OTP yuborish limiti oshdi. Keyinroq urinib ko'ring" });
const otpVerifyLimiter = createRateLimit({ windowMs: 60 * 1000, max: 10, message: "OTP tekshirish limiti oshdi. Keyinroq urinib ko'ring" });
const refreshLimiter = createRateLimit({ windowMs: 60 * 1000, max: 20, message: "Token yangilash limiti oshdi. Keyinroq urinib ko'ring" });

// Login — ro'yxatdan o'tganlik va parol tekshiriladi
router.post("/login", loginLimiter, authController.login);
router.post("/refresh", refreshLimiter, authController.refreshToken);
router.post("/logout-refresh", refreshLimiter, authController.logoutRefresh);

// Tasdiqlash kodi yuborish (1-qadamdan keyin)
router.post("/send-owner-code", otpSendLimiter, authController.sendOwnerCode);

// Kodni tekshirish (2-qadam)
router.post("/verify-owner-code", otpVerifyLimiter, authController.verifyOwnerCode);

// ——— Parol tiklash ———
router.post("/send-reset-code", otpSendLimiter, authController.sendResetCode);
router.post("/verify-reset-code", otpVerifyLimiter, authController.verifyResetCode);
router.post("/set-new-password", otpVerifyLimiter, authController.setNewPassword);

// ——— Kirgan foydalanuvchi: parol / telefon (Telegram OTP) ———
router.post("/send-change-password-code", authMiddleware, otpSendLimiter, authController.sendChangePasswordCode);
router.post("/change-password", authMiddleware, otpVerifyLimiter, authController.changePassword);
router.post("/send-phone-change-code", authMiddleware, otpSendLimiter, authController.sendPhoneChangeCode);
router.post("/confirm-phone-change", authMiddleware, otpVerifyLimiter, authController.confirmPhoneChange);

// Owner to'liq ro'yxatdan o'tish (barcha ma'lumotlar: shaxsiy + do'kon)
router.post(
  "/register-owner",
  validateRegisterOwner,
  validateShopDetails,
  authController.registerOwner
);
router.post("/register-customer", authController.registerCustomer);

module.exports = router;
