/**
 * Telegram Bot API — xabar yuborish (OTP, /start javoblari).
 * TELEGRAM_BOT_TOKEN — @BotFather dan.
 */

/**
 * @param {number|string} chatId
 * @param {string} text
 * @param {{ reply_markup?: object, parse_mode?: string }} [options]
 */
async function sendTelegramMessage(chatId, text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[Telegram] TELEGRAM_BOT_TOKEN sozlanmagan");
    return { ok: false, error: "no_token" };
  }
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
  const body = { chat_id: chatId, text };
  if (options.parse_mode) body.parse_mode = options.parse_mode;
  if (options.reply_markup) body.reply_markup = options.reply_markup;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      console.error("[Telegram] sendMessage xato:", data.description || data);
    }
    return { ok: data.ok === true, error: data.description };
  } catch (e) {
    console.error("[Telegram] tarmoq xatosi:", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

function getBotUsername() {
  const u = process.env.TELEGRAM_BOT_USERNAME;
  return u ? u.replace(/^@/, "").trim() : "";
}

module.exports = { sendTelegramMessage, getBotUsername };
