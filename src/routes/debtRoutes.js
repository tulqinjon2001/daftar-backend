const express = require("express");
const { authMiddleware, requireOwner } = require("../middleware/auth");
const debtController = require("../controllers/debtController");

const router = express.Router();
router.use(authMiddleware);
router.use(requireOwner);

router.get("/history/all", debtController.getAllDebtHistory);
router.get("/history", debtController.getDebtHistory);
router.post("/write", debtController.writeDebt);
router.post("/pay", debtController.payDebt);

module.exports = router;
