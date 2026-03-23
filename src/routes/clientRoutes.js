const express = require("express");
const { authMiddleware, requireOwner } = require("../middleware/auth");
const clientController = require("../controllers/clientController");

const router = express.Router();
router.use(authMiddleware);
router.use(requireOwner);

router.post("/", clientController.createClient);
router.get("/", clientController.listClients);

module.exports = router;
