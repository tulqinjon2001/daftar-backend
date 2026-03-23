const express = require("express");
const { webhook, webhookInfo } = require("../controllers/telegramWebhookController");

const router = express.Router();
// Eslatma: app.use(express.json()) allaqachon body ni o'qiydi — bu yerda qayta json() body ni buzishi mumkin.
router.post("/webhook", webhook);
router.get("/webhook-info", webhookInfo);

module.exports = router;
