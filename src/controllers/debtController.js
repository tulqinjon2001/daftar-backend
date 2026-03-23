const debtService = require("../services/debtService");

function apiResponse(res, success, data = null, message = "", status = 200) {
  res.status(status).json({ success, data, message });
}

/**
 * POST /api/v1/debts/write — qarz yozish
 * Body: debtorId (client userId), amount, dueDate?, description?
 */
async function writeDebt(req, res) {
  try {
    const result = await debtService.writeDebt(req.userId, req.shopId, req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("writeDebt", err);
    apiResponse(res, false, null, "Write debt failed", 500);
  }
}

/**
 * POST /api/v1/debts/pay — to'lov qilish
 * Body: debtorId, amount, note?
 */
async function payDebt(req, res) {
  try {
    const result = await debtService.payDebt(req.userId, req.shopId, req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("payDebt", err);
    apiResponse(res, false, null, "Pay debt failed", 500);
  }
}

/**
 * GET /api/v1/debts/history?debtorId=xxx — mijoz qarz/to'lov tarixi
 */
async function getDebtHistory(req, res) {
  try {
    const debtorId = req.query.debtorId;
    const result = await debtService.getDebtHistory(req.shopId, debtorId);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("getDebtHistory", err);
    apiResponse(res, false, null, "History failed", 500);
  }
}

/**
 * GET /api/v1/debts/history/all — barcha mijozlar qarz/to'lov tarixi
 */
async function getAllDebtHistory(req, res) {
  try {
    const result = await debtService.getAllDebtHistory(req.shopId);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("getAllDebtHistory", err);
    apiResponse(res, false, null, "History failed", 500);
  }
}

module.exports = { writeDebt, payDebt, getDebtHistory, getAllDebtHistory };
