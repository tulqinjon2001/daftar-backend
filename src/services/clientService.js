const prisma = require("../prisma");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("crypto").randomUUID
  ? { v4: () => require("crypto").randomUUID() }
  : { v4: () => Math.random().toString(36).slice(2) };

const toNum = (v) => (v != null ? parseFloat(String(v)) : 0) || 0;

/**
 * Mijoz (Customer user) va uning qarzi (Debt) yaratish.
 * Body: name, phone, initialDebt (optional, number), dueDate (optional, ISO date string)
 * Mijozlar tizimga login qilmaydi — shuning uchun bcrypt ishlatilmaydi.
 */
async function createClient(ownerId, shopId, body) {
  const { name, phone, initialDebt = 0, dueDate } = body;
  const normalizedPhone = (phone || "").replace(/\D/g, "").trim().slice(-9);
  if (!normalizedPhone || !name || !name.trim()) {
    return { success: false, message: "Name and phone required" };
  }

  // Shu do'konda bir xil telefon bilan mijoz oldin qo'shilgan bo'lsa, qayta qo'shmaymiz.
  const existingInShop = await prisma.debt.findFirst({
    where: {
      shopId,
      debtor: { phone: normalizedPhone },
    },
    select: { id: true },
  });
  if (existingInShop) {
    return { success: false, message: "Bu raqam allaqachon qo'shilgan" };
  }

  const email = `client_${normalizedPhone}_${Date.now()}@qarzdaftar.local`;
  // Mijozlar login qilmasa ham, password maydonida hash saqlash xavfsiz.
  const fakePassword = `no-auth::${require("crypto").randomUUID()}`;
  const hashedPassword = await bcrypt.hash(fakePassword, 12);

  const customer = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name: name.trim(),
      phone: normalizedPhone,
      role: "Customer",
    },
  });

  const amount = Number(initialDebt) || 0;
  const dueDateVal = dueDate ? new Date(dueDate) : null;

  const debt = await prisma.debt.create({
    data: {
      shopId,
      creditorId: ownerId,
      debtorId: customer.id,
      amount,
      paidAmount: 0,
      dueDate: dueDateVal,
      description: null,
    },
  });

  await prisma.debtHistory.create({
    data: {
      debtId: debt.id,
      action: "CREATED",
      newAmount: amount,
      newStatus: "ACTIVE",
      payload: { balanceAfter: amount },
      performedBy: ownerId,
    },
  });

  const balance = toNum(debt.amount) - toNum(debt.paidAmount);
  return {
    success: true,
    data: {
      client: {
        id: customer.id,
        name: customer.name,
        phone: "+998 " + normalizedPhone.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, "$1 $2 $3 $4"),
        debtId: debt.id,
        debt: String(balance),
        dueDate: dueDateVal ? dueDateVal.toISOString().slice(0, 10) : "",
      },
    },
    message: "Client created",
  };
}

/**
 * Do'kon uchun barcha mijozlarni (debtor) va ularning qarz balansini qaytarish.
 */
async function listClients(shopId) {
  const debts = await prisma.debt.findMany({
    where: { shopId },
    include: {
      debtor: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const clients = debts.map((d) => {
    const amount = toNum(d.amount);
    const paid = toNum(d.paidAmount);
    const balance = amount - paid;
    const name = d.debtor.name || "";
    const initials =
      name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase() || "MJ";
    const phone = d.debtor.phone
      ? "+998 " + d.debtor.phone.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, "$1 $2 $3 $4")
      : "";
    return {
      id: d.debtor.id,
      name,
      phone,
      debt: String(balance),
      dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : "",
      initials,
      debtId: d.id,
    };
  });

  return { success: true, data: { clients }, message: "OK" };
}

module.exports = { createClient, listClients };
