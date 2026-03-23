const prisma = require("../prisma");
const balanceService = require("./balanceService");
const toNum = (v) => (v != null ? parseFloat(String(v)) : 0) || 0;

function formatPhoneForDisplay(phone) {
  if (!phone || typeof phone !== "string") return "";
  const d = phone.replace(/\D/g, "").trim();
  if (d.length < 9) return phone;
  const rest = d.slice(-9);
  return "+998 " + rest.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, "$1 $2 $3 $4");
}

/**
 * Ta'minotchi yaratish. Body: name, phone (ixtiyoriy)
 */
async function createSupplier(ownerId, shopId, body) {
  const { name, phone } = body;
  const trimmedName = (name || "").trim();
  const phoneDigits = (phone || "").replace(/\D/g, "").trim().slice(-9);
  const phoneVal = phoneDigits.length === 9 ? phoneDigits : null;
  if (!trimmedName) {
    return { success: false, message: "Name required" };
  }

  const supplier = await prisma.supplier.create({
    data: {
      shopId,
      name: trimmedName,
      ...(phoneVal && { phone: phoneVal }),
    },
  });

  const debt = await prisma.supplierDebt.create({
    data: {
      supplierId: supplier.id,
      shopId,
      amount: 0,
      paidAmount: 0,
      status: "ACTIVE",
    },
  });

  await prisma.supplierDebtHistory.create({
    data: {
      supplierDebtId: debt.id,
      action: "CREATED",
      newAmount: 0,
      payload: {},
      performedBy: ownerId,
    },
  });

  const balance = toNum(debt.amount) - toNum(debt.paidAmount);
  const dateStr = supplier.createdAt ? supplier.createdAt.toISOString().slice(0, 10) : "";
  const formattedDate = dateStr ? dateStr.split("-").reverse().join(".") : "";

  const displayPhone = supplier.phone ? formatPhoneForDisplay(supplier.phone) : "";
  return {
    success: true,
    data: {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        phone: displayPhone,
        debt: String(balance),
        dueDate: "",
        dateInfo: formattedDate,
        debtId: debt.id,
      },
    },
    message: "Supplier created",
  };
}

/**
 * Do'kon uchun barcha ta'minotchilarni qaytarish
 */
async function listSuppliers(shopId) {
  const suppliers = await prisma.supplier.findMany({
    where: { shopId },
    include: { debt: true },
    orderBy: { updatedAt: "desc" },
  });

  const list = suppliers.map((s) => {
    const debt = s.debt;
    const amount = debt ? toNum(debt.amount) : 0;
    const paid = debt ? toNum(debt.paidAmount) : 0;
    const balance = amount - paid;
    const updated = s.updatedAt || s.createdAt;
    const dateStr = updated ? updated.toISOString().slice(0, 10) : "";
    const formattedDate = dateStr ? dateStr.split("-").reverse().join(".") : "";

    const displayPhone = s.phone ? formatPhoneForDisplay(s.phone) : "";
    return {
      id: s.id,
      name: s.name,
      phone: displayPhone,
      debt: String(balance),
      dueDate: debt && debt.dueDate ? debt.dueDate.toISOString().slice(0, 10) : "",
      dateInfo: formattedDate,
      debtId: debt ? debt.id : null,
    };
  });

  return { success: true, data: { suppliers: list }, message: "OK" };
}

/**
 * Ta'minotchiga qarz yozish. Body: supplierId, amount, dueDate?, description?
 */
async function writeSupplierDebt(ownerId, shopId, body) {
  const { supplierId, amount: addAmount, dueDate, description } = body;
  const amountNum = Number(addAmount);
  if (!supplierId || !amountNum || amountNum <= 0) {
    return { success: false, message: "supplierId and positive amount required" };
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, shopId },
        include: { debt: true },
      });
      if (!supplier || !supplier.debt) throw new Error("Supplier or debt not found");

      const debt = supplier.debt;
      const oldAmount = toNum(debt.amount);
      const newAmount = oldAmount + amountNum;
      const paidAmount = toNum(debt.paidAmount);
      const balanceAfter = newAmount - paidAmount;

      await tx.supplierDebt.update({
        where: { id: debt.id },
        data: {
          amount: newAmount,
          ...(dueDate && { dueDate: new Date(dueDate) }),
          ...(description != null && { description: String(description) }),
        },
      });

      await tx.supplierDebtHistory.create({
        data: {
          supplierDebtId: debt.id,
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
 * Ta'minotchiga to'lov. Body: supplierId, amount, note?, paymentMethod? (CASH|CARD|BANK)
 * Agar paymentMethod berilsa — do'kon balansidan (naxt/karta/bank) shu summa ayiriladi.
 */
async function paySupplierDebt(ownerId, shopId, body) {
  const { supplierId, amount: payAmount, note, paymentMethod } = body;
  const amountNum = Number(payAmount);
  if (!supplierId || !amountNum || amountNum <= 0) {
    return { success: false, message: "supplierId and positive amount required" };
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, shopId },
        include: { debt: true },
      });
      if (!supplier || !supplier.debt) throw new Error("Supplier or debt not found");

      if (paymentMethod) {
        const balanceResult = await balanceService.deductFromBalance(shopId, paymentMethod, amountNum, tx);
        if (!balanceResult.success) throw new Error(balanceResult.message || "Balans yetarli emas");
      }

      const debt = supplier.debt;
      const oldPaid = toNum(debt.paidAmount);
      const totalAmount = toNum(debt.amount);
      const newPaid = oldPaid + amountNum;
      const newStatus = newPaid >= totalAmount ? "PAID" : "PARTIAL";
      const balanceAfter = totalAmount - newPaid;

      await tx.supplierDebt.update({
        where: { id: debt.id },
        data: { paidAmount: newPaid, status: newStatus },
      });

      const methodNormalized = paymentMethod ? balanceService.validatePaymentMethod(paymentMethod) : null;
      await tx.supplierDebtHistory.create({
        data: {
          supplierDebtId: debt.id,
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
 * Ta'minotchi qarz/to'lov tarixi. Query: supplierId
 */
async function getSupplierDebtHistory(shopId, supplierId) {
  if (!supplierId) {
    return { success: false, message: "supplierId required" };
  }
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, shopId },
    include: { debt: true },
  });
  if (!supplier || !supplier.debt) {
    return { success: true, data: { history: [] }, message: "OK" };
  }

  const records = await prisma.supplierDebtHistory.findMany({
    where: { supplierDebtId: supplier.debt.id },
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
    return {
      date: r.createdAt.toISOString().slice(0, 10),
      createdAt: r.createdAt.toISOString(),
      action: actionLabel,
      summa: Math.abs(summa),
      isPayment: r.action === "PAYMENT",
      qoldiq: balanceAfter,
    };
  });

  return { success: true, data: { history }, message: "OK" };
}

/**
 * Barcha yetkazuvchilar qarz/to'lov tarixi (hisobot uchun)
 */
async function getAllSupplierDebtHistory(shopId) {
  const records = await prisma.supplierDebtHistory.findMany({
    where: { supplierDebt: { shopId } },
    include: { supplierDebt: { include: { supplier: true } } },
    orderBy: { createdAt: "desc" },
  });

  const history = records.map((r) => {
    const payload = r.payload || {};
    const balanceAfter = payload.balanceAfter != null ? Number(payload.balanceAfter) : null;
    let actionLabel = "Qarz (tovar olindi)";
    let summa = 0;
    if (r.action === "CREATED") {
      summa = Number(r.newAmount) || 0;
    } else if (r.action === "UPDATED") {
      summa = payload.added != null ? Number(payload.added) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    } else if (r.action === "PAYMENT") {
      actionLabel = "To'lov";
      summa = payload.payment != null ? Number(payload.payment) : (Number(r.newAmount) || 0) - (Number(r.oldAmount) || 0);
    }
    const supplierName = r.supplierDebt && r.supplierDebt.supplier ? r.supplierDebt.supplier.name : "—";
    return {
      id: r.id,
      date: r.createdAt.toISOString().slice(0, 10),
      createdAt: r.createdAt.toISOString(),
      action: actionLabel,
      summa: Math.abs(summa),
      isPayment: r.action === "PAYMENT",
      qoldiq: balanceAfter,
      supplierId: r.supplierDebt ? r.supplierDebt.supplierId : null,
      supplierName,
    };
  });

  return { success: true, data: { history }, message: "OK" };
}

module.exports = {
  createSupplier,
  listSuppliers,
  writeSupplierDebt,
  paySupplierDebt,
  getSupplierDebtHistory,
  getAllSupplierDebtHistory,
};
