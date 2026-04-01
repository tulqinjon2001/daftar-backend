const prisma = require("../prisma");
const balanceService = require("./balanceService");

const toNum = (v) => (v != null ? parseFloat(String(v)) : 0) || 0;

/**
 * Qarz yozish: mijoz (debtorId) uchun qarz summasi qo'shish.
 * Body: debtorId (client userId), amount (number), dueDate (optional), description (optional)
 */
async function writeDebt(ownerId, shopId, body) {
  const { debtorId, amount: addAmount, dueDate, description } = body;
  const amountNum = Number(addAmount);
  if (!debtorId || !amountNum || amountNum <= 0) {
    return { success: false, message: "debtorId and positive amount required" };
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      const debt = await tx.debt.findFirst({ where: { shopId, debtorId } });
      if (!debt) throw new Error("Client debt not found");

      const oldAmount = toNum(debt.amount);
      const newAmount = oldAmount + amountNum;
      const paidAmount = toNum(debt.paidAmount);
      const balanceAfter = newAmount - paidAmount;

      await tx.debt.update({
        where: { id: debt.id },
        data: {
          amount: newAmount,
          ...(dueDate && { dueDate: new Date(dueDate) }),
          ...(description != null && { description: String(description) }),
        },
      });

      await tx.debtHistory.create({
        data: {
          debtId: debt.id,
          action: "UPDATED",
          oldAmount,
          newAmount,
          payload: { added: amountNum, note: description, balanceAfter },
          performedBy: ownerId,
        },
      });
      return { debtId: debt.id, balance: balanceAfter };
    });
    return { success: true, data: { debt: String(out.balance), debtId: out.debtId }, message: "Debt updated" };
  } catch (e) {
    return { success: false, message: e.message || "Debt update failed" };
  }
}

/**
 * To'lov qilish: paidAmount ga qo'shish, status yangilash.
 * Body: debtorId, amount (to'lov summasi), note (optional), paymentMethod (optional: CASH|CARD|BANK)
 * Agar paymentMethod berilsa — do'kon balansiga (naxt/karta/bank) shu summa qo'shiladi.
 */
async function payDebt(ownerId, shopId, body) {
  const { debtorId, amount: payAmount, note, paymentMethod } = body;
  const amountNum = Number(payAmount);
  if (!debtorId || !amountNum || amountNum <= 0) {
    return { success: false, message: "debtorId and positive amount required" };
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      const debt = await tx.debt.findFirst({ where: { shopId, debtorId } });
      if (!debt) throw new Error("Client debt not found");

      if (paymentMethod) {
        const balanceResult = await balanceService.addToBalance(shopId, paymentMethod, amountNum, tx);
        if (!balanceResult.success) throw new Error(balanceResult.message || "Balance update failed");
      }

      const oldPaid = toNum(debt.paidAmount);
      const totalAmount = toNum(debt.amount);
      const newPaid = oldPaid + amountNum;
      const newStatus = newPaid >= totalAmount ? "PAID" : "PARTIAL";
      const balanceAfter = totalAmount - newPaid;

      await tx.debt.update({
        where: { id: debt.id },
        data: { paidAmount: newPaid, status: newStatus },
      });

      const methodNormalized = paymentMethod ? balanceService.validatePaymentMethod(paymentMethod) : null;
      await tx.debtHistory.create({
        data: {
          debtId: debt.id,
          action: "PAYMENT",
          oldAmount: oldPaid,
          newAmount: newPaid,
          payload: { payment: amountNum, note: note || null, balanceAfter },
          paymentMethod: methodNormalized,
          performedBy: ownerId,
        },
      });
      return { debtId: debt.id, balance: balanceAfter };
    });
    return { success: true, data: { debt: String(out.balance), debtId: out.debtId }, message: "Payment recorded" };
  } catch (e) {
    return { success: false, message: e.message || "Payment failed" };
  }
}

/**
 * Mijoz qarz tarixi: sana, amal (Qarz/To'lov), summa, amaldan keyingi qoldiq.
 * Query: debtorId
 */
async function getDebtHistory(shopId, debtorId) {
  if (!debtorId) {
    return { success: false, message: "debtorId required" };
  }
  const debt = await prisma.debt.findFirst({
    where: { shopId, debtorId },
  });
  if (!debt) {
    return { success: true, data: { history: [] }, message: "OK" };
  }
  const records = await prisma.debtHistory.findMany({
    where: { debtId: debt.id },
    orderBy: { createdAt: "desc" },
  });
  // Agar Debt mavjud lekin tarix bo'sh bo'lsa (eski mijoz), joriy qoldiqni bitta qator sifatida ko'rsatamiz
  if (records.length === 0) {
    const amount = toNum(debt.amount);
    const paid = toNum(debt.paidAmount);
    const balance = amount - paid;
    if (balance !== 0 || amount > 0) {
      const createdAt = debt.createdAt ? debt.createdAt.toISOString() : new Date().toISOString();
      return {
        success: true,
        data: {
          history: [
            {
              date: createdAt.slice(0, 10),
              createdAt,
              action: "Qarz",
              summa: Math.abs(balance),
              isPayment: false,
              qoldiq: balance,
            },
          ],
        },
        message: "OK",
      };
    }
  }
  const history = records.map((r) => {
    const payload = r.payload || {};
    const balanceAfter = payload.balanceAfter != null ? Number(payload.balanceAfter) : null;
    let actionLabel = "Qarz";
    let summa = 0;
    if (r.action === "CREATED") {
      summa = Number(r.newAmount) || 0;
    } else if (r.action === "UPDATED") {
      summa = payload.added != null ? Number(payload.added) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    } else if (r.action === "PAYMENT") {
      actionLabel = "To'lov";
      summa = payload.payment != null ? Number(payload.payment) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    }
    return {
      date: r.createdAt.toISOString().slice(0, 10),
      createdAt: r.createdAt.toISOString(),
      action: actionLabel,
      summa: Math.abs(summa),
      isPayment: r.action === "PAYMENT",
      qoldiq: balanceAfter != null ? balanceAfter : (r.newAmount != null ? Number(r.newAmount) : null),
    };
  });
  return { success: true, data: { history }, message: "OK" };
}

/**
 * Barcha mijozlar qarz/to'lov tarixi (hisobot uchun)
 */
async function getAllDebtHistory(shopId) {
  const records = await prisma.debtHistory.findMany({
    where: { debt: { shopId } },
    include: { debt: { include: { debtor: true } } },
    orderBy: { createdAt: "desc" },
  });

  const history = records.map((r) => {
    const payload = r.payload || {};
    const balanceAfter = payload.balanceAfter != null ? Number(payload.balanceAfter) : null;
    let actionLabel = "Qarz";
    let summa = 0;
    if (r.action === "CREATED") {
      summa = Number(r.newAmount) || 0;
    } else if (r.action === "UPDATED") {
      summa = payload.added != null ? Number(payload.added) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    } else if (r.action === "PAYMENT") {
      actionLabel = "To'lov";
      summa = payload.payment != null ? Number(payload.payment) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    }
    const debtorName = r.debt && r.debt.debtor ? (r.debt.debtor.name || r.debt.debtor.phone || "—") : "—";
    return {
      id: r.id,
      date: r.createdAt.toISOString().slice(0, 10),
      createdAt: r.createdAt.toISOString(),
      action: actionLabel,
      summa: Math.abs(summa),
      isPayment: r.action === "PAYMENT",
      qoldiq: balanceAfter,
      debtorId: r.debt ? r.debt.debtorId : null,
      debtorName,
    };
  });

  return { success: true, data: { history }, message: "OK" };
}

async function getMyDebtSummary(userId) {
  if (!userId) return { success: false, message: "userId required" };
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true, role: true, name: true },
  });
  if (!me) return { success: false, message: "User not found" };

  const digits = String(me.phone || "").replace(/\D/g, "");
  const p9 = digits.slice(-9);
  const p998 = digits.startsWith("998") ? digits : p9 ? `998${p9}` : "";
  const debtorPhoneOr = [];
  if (p9) debtorPhoneOr.push({ debtor: { phone: p9 } });
  if (p998) debtorPhoneOr.push({ debtor: { phone: p998 } });

  const debts = await prisma.debt.findMany({
    where: {
      OR: [{ debtorId: userId }, ...debtorPhoneOr],
    },
    include: {
      shop: { select: { id: true, name: true } },
      debtor: { select: { id: true, phone: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const debtIds = debts.map((d) => d.id);
  const historyRows = debtIds.length
    ? await prisma.debtHistory.findMany({
        where: { debtId: { in: debtIds } },
        include: { debt: { include: { shop: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const debtsByShopMap = new Map();
  let totalBorrowed = 0;
  let totalPaid = 0;
  let totalCurrentDebt = 0;

  for (const d of debts) {
    const amount = toNum(d.amount);
    const paid = toNum(d.paidAmount);
    const current = amount - paid;
    totalBorrowed += amount;
    totalPaid += paid;
    totalCurrentDebt += current;

    const key = d.shop?.id || "unknown";
    const prev = debtsByShopMap.get(key) || {
      shopId: d.shop?.id || "",
      shopName: d.shop?.name || "Do'kon",
      totalBorrowed: 0,
      totalPaid: 0,
      currentDebt: 0,
      debtsCount: 0,
    };
    prev.totalBorrowed += amount;
    prev.totalPaid += paid;
    prev.currentDebt += current;
    prev.debtsCount += 1;
    debtsByShopMap.set(key, prev);
  }

  const history = historyRows.map((r) => {
    const payload = r.payload || {};
    const isPayment = r.action === "PAYMENT";
    let amount = 0;
    if (r.action === "CREATED") amount = Number(r.newAmount) || 0;
    else if (r.action === "UPDATED") amount = payload.added != null ? Number(payload.added) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    else if (isPayment) amount = payload.payment != null ? Number(payload.payment) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      date: r.createdAt.toISOString().slice(0, 10),
      action: isPayment ? "To'lov" : "Qarz",
      amount: Math.abs(amount),
      qoldiq: payload.balanceAfter != null ? Number(payload.balanceAfter) : null,
      shopId: r.debt?.shop?.id || "",
      shopName: r.debt?.shop?.name || "Do'kon",
    };
  });

  return {
    success: true,
    data: {
      user: { id: me.id, name: me.name, role: me.role },
      summary: {
        totalBorrowed,
        totalPaid,
        totalCurrentDebt,
        shopsCount: debtsByShopMap.size,
      },
      shops: Array.from(debtsByShopMap.values()),
      history,
    },
    message: "OK",
  };
}

module.exports = { writeDebt, payDebt, getDebtHistory, getAllDebtHistory, getMyDebtSummary };
