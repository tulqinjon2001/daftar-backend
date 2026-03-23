const verificationService = require("../services/verificationService");
const { sendTelegramMessage } = require("../services/telegramService");

function parseStartPayload(text) {
  if (!text || typeof text !== "string") return undefined;
  const m = text.trim().match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?/);
  if (!m) return undefined;
  return m[1] || null;
}

const START_WELCOME_UZ =
  "Salom! Men <b>Qarz Daftar</b> (@qarzdaftarsms_bot) xizmat botiman.\n\n" +
  "<b>Nima qilaman:</b>\n" +
  "• Ro'yxatdan o'tish, parolni tiklash va profilda parol/telefon o'zgartirish uchun <b>tasdiqlash kodlarini</b> shu chatga yuboraman.\n" +
  "• Kodlar <b>Telegram orqali</b> keladi (oddiy operator SMS emas).\n\n" +
  "<b>Qanday kod olasiz:</b>\n" +
  "Sayt yoki ilovada «Kodni yuborish»ni bosing — kod Telegram orqali shu chatga avtomatik keladi (telefon raqamingizni bir marta ulagan bo'lsangiz).\n\n" +
  "Ixtiyoriy: pastdagi tugma orqali <b>telefon raqamingizni ulashing</b> — kelajakda kodlar avtomatik yuborilishi uchun.";

const CONTACT_THANKS_UZ =
  "Rahmat! Telefon raqamingiz qabul qilindi.\n\n" +
  "Endi tasdiqlash kodlari shu chatga avtomatik yuboriladi.";

const contactKeyboard = {
  keyboard: [[{ text: "📱 Telefon raqamini ulashish", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

const removeKeyboard = { remove_keyboard: true };

function webhookDebugAllowed() {
  if (process.env.TELEGRAM_WEBHOOK_DEBUG === "1") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}

async function webhookInfo(_req, res) {
  if (!webhookDebugAllowed()) {
    return res.status(404).json({ success: false, message: "Not found" });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(400).json({
      success: false,
      message: "TELEGRAM_BOT_TOKEN .env da yo'q",
      hint: "Bot javob bermasa: odatda webhook HTTPS URL ga o'rnatilmagan yoki xato (localhost ishlamaydi).",
    });
  }
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/getWebhookInfo`
    );
    const data = await r.json().catch(() => ({}));
    if (!data.ok) {
      return res.status(502).json({ success: false, message: data.description || "getWebhookInfo xato" });
    }
    const w = data.result || {};
    return res.json({
      success: true,
      url: w.url || null,
      pending_update_count: w.pending_update_count ?? 0,
      last_error_message: w.last_error_message || null,
      last_error_date: w.last_error_date || null,
      hint:
        !w.url || w.url === ""
          ? "Webhook URL bo'sh — Telegram serveringizga hech narsa yubormaydi. setWebhook qiling (HTTPS, ochiq domen yoki ngrok)."
          : w.last_error_message
            ? "Oxirgi xato — URL yoki SSL muammosi. Quyidagi xabarni o'qing."
            : "Webhook o'rnatilgan ko'rinadi. /start bosilganda server logida [telegram webhook] qatorlari paydo bo'lishi kerak.",
    });
  } catch (e) {
    console.error("[telegram webhook-info]", e);
    return res.status(500).json({ success: false, message: String(e?.message || e) });
  }
}

async function processTelegramUpdate(body, source = "webhook") {
  if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
    if (source === "webhook") {
      console.warn(
        "[telegram webhook] BO'SH body — so'rov Telegramdan kelgan bo'lsa, express.json() / routing tekshiring"
      );
    }
    return;
  }

  const msg = body.message;
  if (!msg) {
    if (body.update_id != null) {
      console.log("[telegram %s] update_id=%s (message yo'q)", source, body.update_id);
    }
    return;
  }

  if (body.update_id != null && msg.text) {
    const text = String(msg.text);
    const payload = parseStartPayload(text);
    const payloadDisp =
      payload === null
        ? "(no payload)"
        : typeof payload === "string"
          ? `${payload.slice(0, 12)}${payload.length > 12 ? "…" : ""}`
          : "(unparsed)";
    console.log(
      "[telegram %s] update_id=%s chat=%s text=%s payload=%s",
      source,
      body.update_id,
      msg.chat?.id,
      text.slice(0, 80),
      payloadDisp
    );
  }

  if (msg.contact) {
    const fromId = msg.from?.id;
    const cUid = msg.contact.user_id;
    if (fromId != null && cUid != null && Number(fromId) !== Number(cUid)) {
      await sendTelegramMessage(
        msg.chat.id,
        "Iltimos, faqat o'z raqamingizni pastdagi <b>Telefon raqamini ulashish</b> tugmasi orqali yuboring.",
        { parse_mode: "HTML", reply_markup: contactKeyboard }
      );
      return;
    }

    const phoneNumber = msg.contact.phone_number;
    if (phoneNumber) {
      await verificationService.setTelegramChatForPhone(phoneNumber, msg.chat.id);
    }

    await sendTelegramMessage(msg.chat.id, CONTACT_THANKS_UZ, {
      reply_markup: removeKeyboard,
    });
    return;
  }

  if (msg.text) {
    const payload = parseStartPayload(msg.text);
    if (payload !== undefined) {
      if (payload) {
        await verificationService.processTelegramStart(msg.chat.id, payload);
      } else {
        const didFallback =
          typeof verificationService.tryProcessTelegramStartFallback === "function"
            ? await verificationService.tryProcessTelegramStartFallback(msg.chat.id)
            : false;
        if (!didFallback) {
          await sendTelegramMessage(msg.chat.id, START_WELCOME_UZ, {
            parse_mode: "HTML",
            reply_markup: contactKeyboard,
          });
        }
      }
    }
  }
}

async function webhook(req, res) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const got = req.get("X-Telegram-Bot-Api-Secret-Token");
    if (got !== secret) {
      console.warn("[telegram webhook] X-Telegram-Bot-Api-Secret-Token mos kelmaydi yoki yo‘q (.env va BotFather dagi secret bir xil bo‘lsin)");
      return res.sendStatus(401);
    }
  }

  try {
    await processTelegramUpdate(req.body, "webhook");
  } catch (e) {
    console.error("[telegram webhook]", e);
  }
  return res.sendStatus(200);
}

module.exports = { webhook, webhookInfo, processTelegramUpdate };
