const authService = require("../services/authService");

function apiResponse(res, success, data = null, message = "", status = 200) {
  res.status(status).json({ success, data, message });
}

function otpTelegramData(result) {
  const data = {};
  if (result.telegramDeepLink) data.telegramDeepLink = result.telegramDeepLink;
  if (result.devCode != null) data.code = result.devCode;
  return Object.keys(data).length ? data : null;
}

async function login(req, res) {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return apiResponse(res, false, null, "Telefon va parol kiritilishi shart", 400);
    }
    const result = await authService.login(phone, password);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 401);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("login", err);
    apiResponse(res, false, null, "Kirish amalga oshmadi", 500);
  }
}

async function registerOwner(req, res) {
  try {
    const result = await authService.registerOwner(req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("registerOwner", err);
    apiResponse(res, false, null, "Registration failed", 500);
  }
}

async function sendOwnerCode(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) {
      return apiResponse(res, false, null, "phone is required", 400);
    }
    const result = await authService.sendOwnerVerificationCode(phone);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, otpTelegramData(result), result.message);
  } catch (err) {
    console.error("sendOwnerCode", err);
    apiResponse(res, false, null, "Failed to send code", 500);
  }
}

async function verifyOwnerCode(req, res) {
  try {
    const { phone, code } = req.body;
    if (!phone || code === undefined) {
      return apiResponse(res, false, null, "phone and code are required", 400);
    }
    const result = await authService.verifyOwnerCode(phone, code);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, null, result.message);
  } catch (err) {
    console.error("verifyOwnerCode", err);
    apiResponse(res, false, null, "Verification failed", 500);
  }
}

async function sendResetCode(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) {
      return apiResponse(res, false, null, "phone is required", 400);
    }
    const result = await authService.sendPasswordResetCode(phone);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, otpTelegramData(result), result.message);
  } catch (err) {
    console.error("sendResetCode", err);
    apiResponse(res, false, null, "Failed to send code", 500);
  }
}

async function verifyResetCode(req, res) {
  try {
    const { phone, code } = req.body;
    if (!phone || code === undefined) {
      return apiResponse(res, false, null, "phone and code are required", 400);
    }
    const result = await authService.verifyPasswordResetCode(phone, code);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, null, result.message);
  } catch (err) {
    console.error("verifyResetCode", err);
    apiResponse(res, false, null, "Verification failed", 500);
  }
}

async function setNewPassword(req, res) {
  try {
    const { phone, code, newPassword } = req.body;
    if (!phone || code === undefined || !newPassword) {
      return apiResponse(res, false, null, "phone, code and newPassword are required", 400);
    }
    if (newPassword.length < 8) {
      return apiResponse(res, false, null, "Parol kamida 8 ta belgidan iborat bo'lishi kerak", 400);
    }
    const result = await authService.setNewPassword(phone, code, newPassword);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, null, result.message);
  } catch (err) {
    console.error("setNewPassword", err);
    apiResponse(res, false, null, "Password update failed", 500);
  }
}

async function sendChangePasswordCode(req, res) {
  try {
    const { currentPassword } = req.body;
    if (!currentPassword) {
      return apiResponse(res, false, null, "currentPassword kerak", 400);
    }
    const result = await authService.sendChangePasswordCode(req.userId, currentPassword);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, otpTelegramData(result), result.message);
  } catch (err) {
    console.error("sendChangePasswordCode", err);
    apiResponse(res, false, null, "Failed to send code", 500);
  }
}

async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword, code } = req.body;
    if (!currentPassword || !newPassword || code === undefined) {
      return apiResponse(res, false, null, "currentPassword, newPassword va code kerak", 400);
    }
    const result = await authService.changePasswordWithOtp(req.userId, currentPassword, newPassword, code);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, null, result.message);
  } catch (err) {
    console.error("changePassword", err);
    apiResponse(res, false, null, "Password update failed", 500);
  }
}

async function sendPhoneChangeCode(req, res) {
  try {
    const { newPhone } = req.body;
    if (!newPhone) {
      return apiResponse(res, false, null, "newPhone kerak", 400);
    }
    const result = await authService.sendPhoneChangeCode(req.userId, newPhone);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, otpTelegramData(result), result.message);
  } catch (err) {
    console.error("sendPhoneChangeCode", err);
    apiResponse(res, false, null, "Failed to send code", 500);
  }
}

async function confirmPhoneChange(req, res) {
  try {
    const { newPhone, code } = req.body;
    if (!newPhone || code === undefined) {
      return apiResponse(res, false, null, "newPhone va code kerak", 400);
    }
    const result = await authService.confirmPhoneChange(req.userId, newPhone, code);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data || null, result.message);
  } catch (err) {
    console.error("confirmPhoneChange", err);
    apiResponse(res, false, null, "Update failed", 500);
  }
}

async function refreshToken(req, res) {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return apiResponse(res, false, null, "refreshToken kerak", 400);
    }
    const result = await authService.refreshTokens(refreshToken);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 401);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("refreshToken", err);
    apiResponse(res, false, null, "Token yangilanmadi", 500);
  }
}

async function logoutRefresh(req, res) {
  try {
    const { refreshToken } = req.body || {};
    const result = await authService.logoutRefreshSession(refreshToken);
    apiResponse(res, true, null, result.message || "Logout qilindi");
  } catch (err) {
    console.error("logoutRefresh", err);
    apiResponse(res, false, null, "Logout xatosi", 500);
  }
}

module.exports = {
  login,
  registerOwner,
  sendOwnerCode,
  verifyOwnerCode,
  sendResetCode,
  verifyResetCode,
  setNewPassword,
  sendChangePasswordCode,
  changePassword,
  sendPhoneChangeCode,
  confirmPhoneChange,
  refreshToken,
  logoutRefresh,
};
