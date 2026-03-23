const prisma = require("../prisma");
const toNum = (v) => (v != null ? parseFloat(String(v)) : 0) || 0;

/**
 * Barcha o'zgarishlar: savdolar, xarajatlar, qarz/to'lovlar, yetkazuvchi to'lovlari — bitta ro'yxatda sana bo'yicha
 * Query: limit? (default 100)
 */
async function getActivityFeed(shopId, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);

  const [sales, expenses, debtHistory, supplierHistory] = await Promise.all([
    prisma.sale.findMany({
      where: { shopId },
      orderBy: { saleDate: "desc" },
      take: limit,
    }),
    prisma.expense.findMany({
      where: { shopId },
      orderBy: { expenseDate: "desc" },
      take: limit,
    }),
    prisma.debtHistory.findMany({
      where: { debt: { shopId } },
      include: { debt: { include: { debtor: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.supplierDebtHistory.findMany({
      where: { supplierDebt: { shopId } },
      include: { supplierDebt: { include: { supplier: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  const items = [];

  sales.forEach((s) => {
    const total = toNum(s.cashAmount) + toNum(s.cardAmount) + toNum(s.bankAmount);
    items.push({
      type: "sale",
      id: s.id,
      date: s.saleDate.toISOString(),
      createdAt: s.createdAt.toISOString(),
      summa: total,
      label: "Savdo qo'shildi",
      comment: s.comment,
    });
  });

  expenses.forEach((e) => {
    items.push({
      type: "expense",
      id: e.id,
      date: e.expenseDate.toISOString(),
      createdAt: e.createdAt.toISOString(),
      summa: toNum(e.amount),
      label: "Xarajat qo'shildi",
      category: e.category,
      description: e.description,
    });
  });

  debtHistory.forEach((r) => {
    const payload = r.payload || {};
    let summa = 0;
    let label = "Qarz yozildi";
    if (r.action === "PAYMENT") {
      label = "Mijoz to'lovi";
      summa = payload.payment != null ? Number(payload.payment) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    } else if (r.action === "UPDATED") {
      summa = payload.added != null ? Number(payload.added) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    } else {
      summa = Number(r.newAmount) || 0;
    }
    const debtorName = r.debt && r.debt.debtor ? (r.debt.debtor.name || r.debt.debtor.phone || "—") : "—";
    items.push({
      type: "debt",
      id: r.id,
      date: r.createdAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      summa: Math.abs(summa),
      label,
      debtorName,
      isPayment: r.action === "PAYMENT",
    });
  });

  supplierHistory.forEach((r) => {
    const payload = r.payload || {};
    let summa = 0;
    let label = "Yetkazuvchiga qarz";
    if (r.action === "PAYMENT") {
      label = "Yetkazuvchiga to'lov";
      summa = payload.payment != null ? Number(payload.payment) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    } else if (r.action === "UPDATED") {
      summa = payload.added != null ? Number(payload.added) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    } else {
      summa = Number(r.newAmount) || 0;
    }
    const supplierName = r.supplierDebt && r.supplierDebt.supplier ? r.supplierDebt.supplier.name : "—";
    items.push({
      type: "supplier_debt",
      id: r.id,
      date: r.createdAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      summa: Math.abs(summa),
      label,
      supplierName,
      isPayment: r.action === "PAYMENT",
    });
  });

  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const list = items.slice(0, limit);

  return { success: true, data: { items: list }, message: "OK" };
}

module.exports = { getActivityFeed };
