const express = require("express");
const { authMiddleware, requireOwner } = require("../middleware/auth");
const reportsController = require("../controllers/reportsController");

const router = express.Router();
router.use(authMiddleware);
router.use(requireOwner);

router.get("/activity", reportsController.getActivityFeed);

module.exports = router;
