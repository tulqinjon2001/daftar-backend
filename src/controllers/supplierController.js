const supplierService = require("../services/supplierService");

function apiResponse(res, success, data = null, message = "", status = 200) {
  res.status(status).json({ success, data, message });
}

async function createSupplier(req, res) {
  try {
    const result = await supplierService.createSupplier(req.userId, req.shopId, req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("createSupplier", err);
    apiResponse(res, false, null, "Supplier create failed", 500);
  }
}

async function listSuppliers(req, res) {
  try {
    const result = await supplierService.listSuppliers(req.shopId);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("listSuppliers", err);
    apiResponse(res, false, null, "List failed", 500);
  }
}

async function writeSupplierDebt(req, res) {
  try {
    const result = await supplierService.writeSupplierDebt(req.userId, req.shopId, req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("writeSupplierDebt", err);
    apiResponse(res, false, null, "Write debt failed", 500);
  }
}

async function paySupplierDebt(req, res) {
  try {
    const result = await supplierService.paySupplierDebt(req.userId, req.shopId, req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("paySupplierDebt", err);
    apiResponse(res, false, null, "Pay debt failed", 500);
  }
}

async function getSupplierDebtHistory(req, res) {
  try {
    const supplierId = req.query.supplierId;
    const result = await supplierService.getSupplierDebtHistory(req.shopId, supplierId);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("getSupplierDebtHistory", err);
    apiResponse(res, false, null, "History failed", 500);
  }
}

async function getAllSupplierDebtHistory(req, res) {
  try {
    const result = await supplierService.getAllSupplierDebtHistory(req.shopId);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("getAllSupplierDebtHistory", err);
    apiResponse(res, false, null, "History failed", 500);
  }
}

module.exports = {
  createSupplier,
  listSuppliers,
  writeSupplierDebt,
  paySupplierDebt,
  getSupplierDebtHistory,
  getAllSupplierDebtHistory,
};
