const clientService = require("../services/clientService");

function apiResponse(res, success, data = null, message = "", status = 200) {
  res.status(status).json({ success, data, message });
}

/**
 * POST /api/v1/clients — mijoz yaratish (Customer + Debt)
 * Body: name, phone, initialDebt?, dueDate?
 */
async function createClient(req, res) {
  try {
    const result = await clientService.createClient(req.userId, req.shopId, req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("createClient", err);
    apiResponse(res, false, null, "Client create failed", 500);
  }
}

/**
 * GET /api/v1/clients — do'kon mijozlari ro'yxati
 */
async function listClients(req, res) {
  try {
    const result = await clientService.listClients(req.shopId);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("listClients", err);
    apiResponse(res, false, null, "List failed", 500);
  }
}

module.exports = { createClient, listClients };
