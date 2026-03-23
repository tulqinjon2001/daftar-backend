const prisma = require("../prisma");
const balanceService = require("./balanceService");

const toNum = (v) => (v != null ? parseFloat(String(v)) : 0) || 0;

/**
 * Xarajat yaratish. Body: amount, category?, description?, expenseDate?, paymentMethod? (CASH|CARD|BANK)
 * Agar paymentMethod berilsa — do'kon balansidan shu summa ayiriladi.
 */
async function createExpense(shopId, body) {
  const { amount, category, description, expenseDate, paymentMethod } = body;
  const amountNum = Number(amount);
  if (!amountNum || amountNum <= 0) {
    return { success: false, message: "Amount must be positive" };
  }

  try {
    const date = expenseDate ? new Date(expenseDate) : new Date();
    const methodNormalized = paymentMethod ? balanceService.validatePaymentMethod(paymentMethod) : null;
    const expense = await prisma.$transaction(async (tx) => {
      if (methodNormalized) {
        const balanceResult = await balanceService.deductFromBalance(shopId, methodNormalized, amountNum, tx);
        if (!balanceResult.success) throw new Error(balanceResult.message || "Balans yetarli emas");
      }
      return tx.expense.create({
        data: {
          shopId,
          amount: amountNum,
          ...(category != null && category !== "" && { category: String(category).trim() }),
          ...(description != null && description !== "" && { description: String(description).trim() }),
          ...(methodNormalized && { paymentMethod: methodNormalized }),
          expenseDate: date,
        },
      });
    });

    return {
      success: true,
      data: {
        expense: {
          id: expense.id,
          amount: String(expense.amount),
          category: expense.category,
          description: expense.description,
          paymentMethod: expense.paymentMethod,
          expenseDate: expense.expenseDate.toISOString().slice(0, 10),
          createdAt: expense.createdAt.toISOString(),
        },
      },
      message: "Expense created",
    };
  } catch (e) {
    return { success: false, message: e.message || "Expense create failed" };
  }
}

/**
 * Do'kon xarajatlarini ro'yxati. Query: fromDate?, toDate?
 */
async function listExpenses(shopId, query = {}) {
  const { fromDate, toDate } = query;
  const where = { shopId };

  if (fromDate || toDate) {
    where.expenseDate = {};
    if (fromDate) where.expenseDate.gte = new Date(fromDate);
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      where.expenseDate.lte = d;
    }
  }

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
  });

  const total = expenses.reduce((sum, e) => sum + toNum(e.amount), 0);
  const list = expenses.map((e) => ({
    id: e.id,
    amount: String(e.amount),
    category: e.category,
    description: e.description,
    paymentMethod: e.paymentMethod || null,
    expenseDate: e.expenseDate.toISOString().slice(0, 10),
    createdAt: e.createdAt.toISOString(),
  }));

  return {
    success: true,
    data: {
      expenses: list,
      total: String(total),
    },
    message: "OK",
  };
}

/**
 * Xarajatni o'chirish. Agar paymentMethod bo'lsa — balansga summa qaytariladi.
 */
async function deleteExpense(shopId, expenseId) {
  try {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id: expenseId, shopId } });
      if (!expense) throw new Error("Expense not found");
      if (expense.paymentMethod) {
        const addResult = await balanceService.addToBalance(shopId, expense.paymentMethod, expense.amount, tx);
        if (!addResult.success) throw new Error(addResult.message || "Balance update failed");
      }
      await tx.expense.delete({ where: { id: expenseId } });
    });
    return { success: true, data: { id: expenseId }, message: "Expense deleted" };
  } catch (e) {
    return { success: false, message: e.message || "Expense delete failed" };
  }
}

/**
 * Xarajatni tahrirlash. Eski summa balansga qaytariladi, yangi summa ayiriladi (paymentMethod bo'lsa).
 */
async function updateExpense(shopId, expenseId, body) {
  try {
    const out = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id: expenseId, shopId } });
      if (!expense) throw new Error("Xarajat topilmadi");

      const { amount, category, description, expenseDate, paymentMethod } = body;
      const amountNum = amount != null ? Number(amount) : toNum(expense.amount);
      if (!amountNum || amountNum <= 0) throw new Error("Summa musbat bo'lishi kerak");

      const oldAmount = toNum(expense.amount);
      const oldMethod = expense.paymentMethod ? balanceService.validatePaymentMethod(expense.paymentMethod) : null;
      const newMethod = paymentMethod ? balanceService.validatePaymentMethod(paymentMethod) : null;

      if (oldMethod) {
        const addResult = await balanceService.addToBalance(shopId, oldMethod, oldAmount, tx);
        if (!addResult.success) throw new Error(addResult.message || "Balance update failed");
      }
      if (newMethod) {
        const deductResult = await balanceService.deductFromBalance(shopId, newMethod, amountNum, tx);
        if (!deductResult.success) throw new Error(deductResult.message || "Balans yetarli emas");
      }

      const date = expenseDate ? new Date(expenseDate) : expense.expenseDate;
      const updates = {
        amount: amountNum,
        expenseDate: date,
        ...(category != null && { category: String(category).trim() || null }),
        ...(description != null && { description: String(description).trim() || null }),
        ...(newMethod && { paymentMethod: newMethod }),
      };
      if (!newMethod) updates.paymentMethod = null;

      await tx.expense.update({ where: { id: expenseId }, data: updates });
      return {
        id: expense.id,
        amountNum,
        category: updates.category ?? expense.category,
        description: updates.description ?? expense.description,
        expenseDate: date,
        createdAt: expense.createdAt,
      };
    });

    return {
      success: true,
      data: {
        expense: {
          id: out.id,
          amount: String(out.amountNum),
          category: out.category,
          description: out.description,
          expenseDate: out.expenseDate.toISOString().slice(0, 10),
          createdAt: out.createdAt.toISOString(),
        },
      },
      message: "Xarajat yangilandi",
    };
  } catch (e) {
    return { success: false, message: e.message || "Expense update failed" };
  }
}

module.exports = {
  createExpense,
  listExpenses,
  deleteExpense,
  updateExpense,
};
