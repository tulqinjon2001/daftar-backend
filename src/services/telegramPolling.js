/**
 * Mahalliy sinov: Telegram webhook o'rniga long polling (localhostda /start ishlaydi).
 * Productionda odatda webhook ishlating — TELEGRAM_USE_POLLING=1 ni o'chiring.
 */

async function startTelegramPolling() {
  if (process.env.TELEGRAM_USE_POLLING !== "1") return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const { getBotUsername } = require("./telegramService");
  if (!token || !getBotUsername()) {
    console.warn("[telegram polling] TELEGRAM_BOT_TOKEN yoki TELEGRAM_BOT_USERNAME yo'q");
    return;
  }

  const { processTelegramUpdate } = require("../controllers/telegramWebhookController");

  try {
    // drop_pending_updates: true bo'lsa, foydalanuvchi /start bosgan payt yangilanishlari ham o'chib ketishi mumkin.
    const r = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/deleteWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drop_pending_updates: false }),
      }
    );
    const j = await r.json().catch(() => ({}));
    if (!j.ok) {
      console.warn("[telegram polling] deleteWebhook xato:", j.description || j);
    }
    const infoR = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/getWebhookInfo`
    );
    const info = await infoR.json().catch(() => ({}));
    const url = info?.result?.url;
    if (url) {
      console.warn("[telegram polling] Webhook URL hali ham o'rnatilgan:", url, "— getUpdates bo'sh qaytishi mumkin. deleteWebhook ni tekshiring.");
    }
  } catch (e) {
    console.error("[telegram polling] deleteWebhook", e);
  }

  let offset = 0;

  async function poll() {
    try {
      const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset,
          timeout: 50,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!data.ok) {
        if (data.error_code === 409) {
          console.error(
            "[telegram polling] 409 Conflict — bir token bilan faqat bitta getUpdates/webhook. Boshqa terminal/serverni to'xtating."
          );
        }
        console.error("[telegram polling] getUpdates:", data.description || data);
        await new Promise((res) => setTimeout(res, 3000));
        poll();
        return;
      }
      for (const upd of data.result || []) {
        offset = upd.update_id + 1;
        try {
          await processTelegramUpdate(upd, "polling");
        } catch (e) {
          console.error("[telegram polling] process update", e);
        }
      }
    } catch (e) {
      console.error("[telegram polling]", e);
      await new Promise((res) => setTimeout(res, 3000));
    }
    poll();
  }

  console.log(
    "[telegram polling] getUpdates yoqildi — qayta ishga tushgandan keyin OTP uchun saytdan kodni qayta so'rang."
  );
  poll();
}

module.exports = { startTelegramPolling };
