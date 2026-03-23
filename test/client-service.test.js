const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = require("../src/prisma");
const bcrypt = require("bcrypt");
const { createClient, listClients } = require("../src/services/clientService");

function snapshotPrisma() {
  return {
    debt: { ...prisma.debt },
    user: { ...prisma.user },
    debtHistory: { ...prisma.debtHistory },
  };
}

function restorePrisma(snapshot) {
  prisma.debt = snapshot.debt;
  prisma.user = snapshot.user;
  prisma.debtHistory = snapshot.debtHistory;
}

test("createClient blocks duplicate phone inside same shop", async () => {
  const snap = snapshotPrisma();
  const origHash = bcrypt.hash;
  try {
    prisma.debt.findFirst = async () => ({ id: "existing-debt" });
    prisma.user.create = async () => {
      throw new Error("should not create user on duplicate phone");
    };
    bcrypt.hash = async () => "mocked-hash";

    const res = await createClient("owner-1", "shop-1", {
      name: "Ali Valiyev",
      phone: "99 114 09 99",
      initialDebt: 10000,
    });

    assert.equal(res.success, false);
    assert.equal(res.message, "Bu raqam allaqachon qo'shilgan");
  } finally {
    restorePrisma(snap);
    bcrypt.hash = origHash;
  }
});

test("createClient creates customer + debt on valid input", async () => {
  const snap = snapshotPrisma();
  const origHash = bcrypt.hash;
  try {
    prisma.debt.findFirst = async () => null;
    prisma.user.create = async ({ data }) => ({
      id: "cust-1",
      name: data.name,
      phone: data.phone,
    });
    prisma.debt.create = async ({ data }) => ({
      id: "debt-1",
      amount: data.amount,
      paidAmount: 0,
      dueDate: data.dueDate,
    });
    prisma.debtHistory.create = async () => ({ id: "hist-1" });
    bcrypt.hash = async () => "mocked-hash";

    const res = await createClient("owner-1", "shop-1", {
      name: "Ali Valiyev",
      phone: "99 114 09 99",
      initialDebt: 125000,
      dueDate: "2026-12-31",
    });

    assert.equal(res.success, true);
    assert.equal(res.data.client.id, "cust-1");
    assert.equal(res.data.client.phone, "+998 99 114 09 99");
    assert.equal(res.data.client.debt, "125000");
    assert.equal(res.data.client.debtId, "debt-1");
  } finally {
    restorePrisma(snap);
    bcrypt.hash = origHash;
  }
});

test("listClients formats response fields", async () => {
  const snap = snapshotPrisma();
  try {
    prisma.debt.findMany = async () => [
      {
        id: "debt-1",
        amount: "200000",
        paidAmount: "50000",
        dueDate: new Date("2026-01-15"),
        debtor: { id: "cust-1", name: "Ali Valiyev", phone: "991140999" },
      },
    ];

    const res = await listClients("shop-1");
    assert.equal(res.success, true);
    assert.equal(res.data.clients.length, 1);
    assert.equal(res.data.clients[0].phone, "+998 99 114 09 99");
    assert.equal(res.data.clients[0].debt, "150000");
    assert.equal(res.data.clients[0].initials, "AV");
  } finally {
    restorePrisma(snap);
  }
});
