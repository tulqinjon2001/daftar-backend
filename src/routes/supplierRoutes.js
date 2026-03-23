const express = require("express");
const { authMiddleware, requireOwner } = require("../middleware/auth");
const supplierController = require("../controllers/supplierController");

const router = express.Router();
router.use(authMiddleware);
router.use(requireOwner);

router.post("/", supplierController.createSupplier);
router.get("/", supplierController.listSuppliers);
router.post("/debt/write", supplierController.writeSupplierDebt);
router.post("/debt/pay", supplierController.paySupplierDebt);
router.get("/debt/history/all", supplierController.getAllSupplierDebtHistory);
router.get("/debt/history", supplierController.getSupplierDebtHistory);

module.exports = router;
