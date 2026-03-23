const express = require("express");
const router = express.Router();
const { authMiddleware, requireOwner } = require("../middleware/auth");
const expenseController = require("../controllers/expenseController");

router.use(authMiddleware);
router.use(requireOwner);

router.post("/", expenseController.createExpense);
router.get("/", expenseController.listExpenses);
router.patch("/:id", expenseController.updateExpense);
router.delete("/:id", expenseController.deleteExpense);

module.exports = router;
