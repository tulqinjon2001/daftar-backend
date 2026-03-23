const balanceService = require("../services/balanceService");
const prisma = require("../prisma");

function apiResponse(res, success, data = null, message = "", status = 200) {
  res.status(status).json({ success, data, message });
}

async function getBalance(req, res) {
  try {
    const result = await balanceService.getBalance(req.shopId);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("getBalance", err);
    apiResponse(res, false, null, "Failed to get balance", 500);
  }
}

function toNum(v) {
  return v != null ? (parseFloat(String(v)) || 0) : 0;
}

async function addSale(req, res) {
  try {
    const { cashAmount, cardAmount, bankAmount, saleDateTime, comment } = req.body || {};
    const cash = toNum(cashAmount);
    const card = toNum(cardAmount);
    const bank = toNum(bankAmount);
    if (cash === 0 && card === 0 && bank === 0) {
      return apiResponse(res, false, null, "Kamida bitta summa kiritilishi kerak", 400);
    }

    const saleDate = saleDateTime ? new Date(saleDateTime) : new Date();
    if (isNaN(saleDate.getTime())) {
      return apiResponse(res, false, null, "Sana va vaqt noto'g'ri", 400);
    }

    await prisma.$transaction(async (tx) => {
      const result = await balanceService.addSaleToBalance(
        req.shopId,
        { cashAmount: cash, cardAmount: card, bankAmount: bank },
        tx
      );
      if (!result.success) throw new Error(result.message || "Balansga qo'shilmadi");

      await tx.sale.create({
        data: {
          shopId: req.shopId,
          cashAmount: cash,
          cardAmount: card,
          bankAmount: bank,
          saleDate,
          comment: comment && String(comment).trim() ? String(comment).trim() : null,
        },
      });
    });

    apiResponse(res, true, null, "OK");
  } catch (err) {
    console.error("addSale", err);
    apiResponse(res, false, null, "Failed to add sale", 500);
  }
}

async function listSales(req, res) {
  try {
    const result = await balanceService.listSales(req.shopId, req.query);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, result.data, result.message);
  } catch (err) {
    console.error("listSales", err);
    apiResponse(res, false, null, "List sales failed", 500);
  }
}

async function updateSale(req, res) {
  try {
    const { id } = req.params;
    const result = await balanceService.updateSale(req.shopId, id, req.body);
    if (!result.success) {
      return apiResponse(res, false, null, result.message, 400);
    }
    apiResponse(res, true, null, result.message);
  } catch (err) {
    console.error("updateSale", err);
    apiResponse(res, false, null, "Update sale failed", 500);
  }
}

module.exports = { getBalance, addSale, listSales, updateSale };
