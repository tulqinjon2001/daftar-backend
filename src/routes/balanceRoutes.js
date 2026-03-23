const express = require("express");
const router = express.Router();
const { authMiddleware, requireOwner } = require("../middleware/auth");
const balanceController = require("../controllers/balanceController");

router.use(authMiddleware);
router.use(requireOwner);

router.get("/", balanceController.getBalance);
router.post("/sale", balanceController.addSale);
router.get("/sales", balanceController.listSales);
router.patch("/sales/:id", balanceController.updateSale);

module.exports = router;
