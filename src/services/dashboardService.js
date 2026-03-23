const prisma = require("../prisma");

/** Prisma Decimal va oddiy sonlarni raqamga o'giradi. */
function toNum(v) {
  if (v == null || v === undefined) return 0;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v.toNumber === "function") return Number(v.toNumber());
  if (typeof v.valueOf === "function") return Number(v.valueOf());
  const s = String(v).replace(/\s/g, "");
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Do'kon uchun dashboard statistikasi: qarzlar balansi, olingan to'lovlar, eng faol mijoz.
 */
async function getDashboardStats(shopId) {
  if (!shopId) {
    return { success: false, message: "shopId required" };
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);

  const debts = await prisma.debt.findMany({
    where: { shopId },
    include: {
      debtor: { select: { id: true, name: true } },
      history: { select: { action: true, payload: true, createdAt: true } },
    },
  });

  let totalDebtBalance = 0;
  let totalReceivedFromDebts = 0;
  let todayReceivedFromDebts = 0;
  let clientTotalOlingan = 0;   // jami berilgan qarz (mijozlar olgan)
  let clientTotalTolangan = 0;  // jami to'langan qarz
  const debtorStats = {}; // debtorId -> { count, totalPayments, name }

  for (const d of debts) {
    const amount = toNum(d.amount);
    const paid = toNum(d.paidAmount);
    const balance = amount - paid;
    if (balance > 0) totalDebtBalance += balance;
    clientTotalOlingan += amount;
    clientTotalTolangan += paid;

    if (!debtorStats[d.debtorId]) {
      debtorStats[d.debtorId] = {
        id: d.debtorId,
        name: d.debtor.name || "",
        initials: (d.debtor.name || "MJ")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0])
          .join("")
          .toUpperCase() || "MJ",
        transactionCount: 0,
        totalPayments: 0,
      };
    }

    for (const h of d.history) {
      if (h.action === "PAYMENT") {
        const payment = toNum((h.payload && h.payload.payment) || 0);
        totalReceivedFromDebts += payment;
        const createdAt = h.createdAt ? new Date(h.createdAt) : null;
        if (createdAt && createdAt >= todayStart && createdAt < todayEnd) {
          todayReceivedFromDebts += payment;
        }
        debtorStats[d.debtorId].totalPayments += payment;
      }
      debtorStats[d.debtorId].transactionCount += 1;
    }
  }

  const debtorsList = Object.values(debtorStats).filter((s) => s.transactionCount > 0);
  debtorsList.sort((a, b) => b.transactionCount - a.transactionCount);
  const mostActiveClient = debtorsList.length > 0 ? debtorsList[0] : null;

  // Savdo qo'shish orqali kiritilgan summalar (Sale jadvalidan)
  const sales = await prisma.sale.findMany({
    where: { shopId },
    select: { cashAmount: true, cardAmount: true, bankAmount: true, saleDate: true },
  });
  let totalSalesAdded = 0;
  let todaySalesAdded = 0;
  for (const s of sales) {
    const sum = toNum(s.cashAmount) + toNum(s.cardAmount) + toNum(s.bankAmount);
    totalSalesAdded += sum;
    const saleDate = s.saleDate ? new Date(s.saleDate) : null;
    if (saleDate && saleDate >= todayStart && saleDate < todayEnd) {
      todaySalesAdded += sum;
    }
  }
  const totalReceived = totalReceivedFromDebts + totalSalesAdded;
  const todayTotal = todayReceivedFromDebts + todaySalesAdded;

  // Yetkazuvchilar bo'yicha: jami tovar olindi, jami to'landi, joriy qarz
  const supplierDebts = await prisma.supplierDebt.findMany({
    where: { shopId },
    select: { amount: true, paidAmount: true },
  });
  let supplierTotalGoodsTaken = 0;
  let supplierTotalPaid = 0;
  for (const sd of supplierDebts) {
    supplierTotalGoodsTaken += toNum(sd.amount);
    supplierTotalPaid += toNum(sd.paidAmount);
  }
  const supplierCurrentDebt = supplierTotalGoodsTaken - supplierTotalPaid;

  return {
    success: true,
    data: {
      totalDebtBalance,
      totalReceived, // mijoz to'lovlari + Savdo qo'shish summalari
      totalPaid: totalReceivedFromDebts, // faqat mijozlardan olingan to'lovlar (qarzlar bo'limi uchun)
      todayTotal, // bugun qo'shilgan (savdo + mijoz to'lovlari)
      mostActiveClient: mostActiveClient
        ? {
            id: mostActiveClient.id,
            name: mostActiveClient.name,
            initials: mostActiveClient.initials,
            transactionCount: mostActiveClient.transactionCount,
            totalPayments: mostActiveClient.totalPayments,
          }
        : null,
      clientDebtStats: {
        totalOlingan: clientTotalOlingan,
        totalTolangan: clientTotalTolangan,
        currentDebt: totalDebtBalance,
      },
      supplierDebtStats: {
        totalGoodsTaken: supplierTotalGoodsTaken,
        totalPaid: supplierTotalPaid,
        currentDebt: supplierCurrentDebt,
      },
    },
    message: "OK",
  };
}

module.exports = { getDashboardStats };
