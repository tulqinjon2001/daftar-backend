const prisma = require("../prisma");

const toNum = (v) => (v != null ? parseFloat(String(v)) : 0) || 0;

const PAYMENT_METHODS = ["CASH", "CARD", "BANK"];
const dbOf = (tx) => tx || prisma;

function validatePaymentMethod(method) {
  const m = (method || "").toUpperCase();
  return PAYMENT_METHODS.includes(m) ? m : "CASH";
}

/**
 * Do'kon balansini olish: naxt, karta, bank, jami
 */
async function getBalance(shopId) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { cashBalance: true, cardBalance: true, bankBalance: true },
  });
  if (!shop) {
    return { success: false, message: "Shop not found" };
  }
  const cash = toNum(shop.cashBalance);
  const card = toNum(shop.cardBalance);
  const bank = toNum(shop.bankBalance);
  const total = cash + card + bank;
  return {
    success: true,
    data: {
      cash: String(cash),
      card: String(card),
      bank: String(bank),
      total: String(total),
    },
    message: "OK",
  };
}

/**
 * Balansga qo'shish (mijoz to'lovi). paymentMethod: CASH | CARD | BANK
 */
async function addToBalance(shopId, paymentMethod, amount, tx) {
  const method = validatePaymentMethod(paymentMethod);
  const num = Number(amount);
  if (!num || num <= 0) return { success: false, message: "Invalid amount" };
  const db = dbOf(tx);
  const data = {};
  if (method === "CASH") data.cashBalance = { increment: num };
  else if (method === "CARD") data.cardBalance = { increment: num };
  else data.bankBalance = { increment: num };
  await db.shop.update({ where: { id: shopId }, data });
  return { success: true };
}

/**
 * Savdo summasi: naqd, karta, bank summalarini balansga qo'shish (bitta yangilashda)
 */
async function addSaleToBalance(shopId, { cashAmount = 0, cardAmount = 0, bankAmount = 0 }, tx) {
  const cash = toNum(cashAmount);
  const card = toNum(cardAmount);
  const bank = toNum(bankAmount);
  if (cash === 0 && card === 0 && bank === 0) {
    return { success: false, message: "Kamida bitta summa kiritilishi kerak" };
  }
  if (cash < 0 || card < 0 || bank < 0) {
    return { success: false, message: "Summa manfiy bo'lmasligi kerak" };
  }

  const db = dbOf(tx);
  await db.shop.update({
    where: { id: shopId },
    data: {
      cashBalance: { increment: cash },
      cardBalance: { increment: card },
      bankBalance: { increment: bank },
    },
  });
  return { success: true };
}

/**
 * Balansdan ayirish (ta'minotchi to'lovi yoki xarajat). paymentMethod: CASH | CARD | BANK
 */
async function deductFromBalance(shopId, paymentMethod, amount, tx) {
  const method = validatePaymentMethod(paymentMethod);
  const num = Number(amount);
  if (!num || num <= 0) return { success: false, message: "Invalid amount" };
  const db = dbOf(tx);
  let updated = null;
  if (method === "CASH") {
    updated = await db.shop.updateMany({
      where: { id: shopId, cashBalance: { gte: num } },
      data: { cashBalance: { decrement: num } },
    });
  } else if (method === "CARD") {
    updated = await db.shop.updateMany({
      where: { id: shopId, cardBalance: { gte: num } },
      data: { cardBalance: { decrement: num } },
    });
  } else {
    updated = await db.shop.updateMany({
      where: { id: shopId, bankBalance: { gte: num } },
      data: { bankBalance: { decrement: num } },
    });
  }
  if (!updated || updated.count === 0) return { success: false, message: "Insufficient balance" };
  return { success: true };
}

/**
 * Savdo summasini balansdan ayirish (tahrirlashda eski summani bekor qilish)
 */
async function subtractSaleFromBalance(shopId, { cashAmount = 0, cardAmount = 0, bankAmount = 0 }, tx) {
  const cash = toNum(cashAmount);
  const card = toNum(cardAmount);
  const bank = toNum(bankAmount);
  if (cash === 0 && card === 0 && bank === 0) return { success: true };

  const db = dbOf(tx);
  const updated = await db.shop.updateMany({
    where: {
      id: shopId,
      cashBalance: { gte: cash },
      cardBalance: { gte: card },
      bankBalance: { gte: bank },
    },
    data: {
      cashBalance: { decrement: cash },
      cardBalance: { decrement: card },
      bankBalance: { decrement: bank },
    },
  });
  if (!updated || updated.count === 0) return { success: false, message: "Balans yetarli emas (savdo tahrirlanmaydi)" };
  return { success: true };
}

/**
 * Savdolar ro'yxati. Query: fromDate?, toDate?
 */
async function listSales(shopId, query = {}) {
  const { fromDate, toDate } = query;
  const where = { shopId };

  if (fromDate || toDate) {
    where.saleDate = {};
    if (fromDate) where.saleDate.gte = new Date(fromDate);
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      where.saleDate.lte = d;
    }
  }

  const sales = await prisma.sale.findMany({
    where,
    orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
  });

  const list = sales.map((s) => ({
    id: s.id,
    cashAmount: String(s.cashAmount),
    cardAmount: String(s.cardAmount),
    bankAmount: String(s.bankAmount),
    saleDate: s.saleDate.toISOString(),
    comment: s.comment,
    createdAt: s.createdAt.toISOString(),
  }));

  return { success: true, data: { sales: list }, message: "OK" };
}

/**
 * Savdoni tahrirlash. Eski summani balansdan ayirib, yangisini qo'shamiz.
 */
async function updateSale(shopId, saleId, body) {
  try {
    const { cashAmount, cardAmount, bankAmount, saleDateTime, comment } = body || {};
    const cash = toNum(cashAmount);
    const card = toNum(cardAmount);
    const bank = toNum(bankAmount);
    if (cash === 0 && card === 0 && bank === 0) return { success: false, message: "Kamida bitta summa kiritilishi kerak" };
    if (cash < 0 || card < 0 || bank < 0) return { success: false, message: "Summa manfiy bo'lmasligi kerak" };

    await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({ where: { id: saleId, shopId } });
      if (!sale) throw new Error("Savdo topilmadi");

      const oldCash = toNum(sale.cashAmount);
      const oldCard = toNum(sale.cardAmount);
      const oldBank = toNum(sale.bankAmount);

      const subResult = await subtractSaleFromBalance(shopId, { cashAmount: oldCash, cardAmount: oldCard, bankAmount: oldBank }, tx);
      if (!subResult.success) throw new Error(subResult.message);
      const addResult = await addSaleToBalance(shopId, { cashAmount: cash, cardAmount: card, bankAmount: bank }, tx);
      if (!addResult.success) throw new Error(addResult.message || "Balans xatosi");

      const saleDate = saleDateTime ? new Date(saleDateTime) : sale.saleDate;
      if (isNaN(saleDate.getTime())) throw new Error("Sana va vaqt noto'g'ri");

      await tx.sale.update({
        where: { id: saleId },
        data: {
          cashAmount: cash,
          cardAmount: card,
          bankAmount: bank,
          saleDate,
          comment: comment != null && String(comment).trim() !== "" ? String(comment).trim() : null,
        },
      });
    });
    return { success: true, message: "OK" };
  } catch (e) {
    return { success: false, message: e.message || "Update sale failed" };
  }
}

module.exports = {
  getBalance,
  addToBalance,
  addSaleToBalance,
  subtractSaleFromBalance,
  deductFromBalance,
  validatePaymentMethod,
  PAYMENT_METHODS,
  listSales,
  updateSale,
};
