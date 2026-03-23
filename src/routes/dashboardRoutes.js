const express = require("express");
const { authMiddleware, requireOwner } = require("../middleware/auth");
const dashboardController = require("../controllers/dashboardController");

const router = express.Router();
router.use(authMiddleware);
router.use(requireOwner);

router.get("/stats", dashboardController.getStats);

module.exports = router;
