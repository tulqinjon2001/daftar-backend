const expenseService = require("../services/expenseService");

function apiResponse(res, success, data = null, message = "", status = 200) {
  res.status(status).json({ success, data, message });
}

async function createExpense(req, res) {
  try {
    const result = await expenseService.createExpense(req.shopId, req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("createExpense", err);
    apiResponse(res, false, null, "Create expense failed", 500);
  }
}

async function listExpenses(req, res) {
  try {
    const result = await expenseService.listExpenses(req.shopId, req.query);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("listExpenses", err);
    apiResponse(res, false, null, "List failed", 500);
  }
}

async function deleteExpense(req, res) {
  try {
    const { id } = req.params;
    const result = await expenseService.deleteExpense(req.shopId, id);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 404);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("deleteExpense", err);
    apiResponse(res, false, null, "Delete failed", 500);
  }
}

async function updateExpense(req, res) {
  try {
    const { id } = req.params;
    const result = await expenseService.updateExpense(req.shopId, id, req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("updateExpense", err);
    apiResponse(res, false, null, "Update failed", 500);
  }
}

module.exports = {
  createExpense,
  listExpenses,
  deleteExpense,
  updateExpense,
};
