/**
 * Webhook'ni o'rnatadi / o'chiradi / holatini ko'rsatadi.
 *   npm run bot:webhook -- https://erp.domen.uz   # o'rnatish
 *   npm run bot:webhook -- delete                 # o'chirish (polling uchun)
 *   npm run bot:webhook                           # holat
 */
import { loadEnv } from "./env";
loadEnv();

import { getMe, setWebhook, deleteWebhook, getWebhookInfo, setMyCommands } from "../src/lib/telegram/api";
import { BOT_COMMANDS } from "../src/lib/telegram/bot";

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN) { console.error("TELEGRAM_BOT_TOKEN yo'q (.env)"); process.exit(1); }
  const arg = process.argv[2];

  if (!arg) {
    const info = await getWebhookInfo();
    console.log(`Bot: @${(await getMe()).username}`);
    console.log(`Webhook: ${info.url || "o'rnatilmagan (polling rejimi)"}`);
    console.log(`Navbatdagi update: ${info.pending_update_count}`);
    if (info.last_error_message) console.log(`Oxirgi xato: ${info.last_error_message}`);
    return;
  }

  if (arg === "delete") { await deleteWebhook(); console.log("Webhook o'chirildi."); return; }

  const base = arg.replace(/\/+$/, "");
  if (!base.startsWith("https://")) { console.error("Telegram faqat HTTPS manzilni qabul qiladi."); process.exit(1); }
  const url = `${base}/api/telegram/webhook`;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) console.warn("Ogohlantirish: TELEGRAM_WEBHOOK_SECRET yo'q — endpoint himoyalanmagan bo'ladi.");

  await setWebhook(url, secret);
  await setMyCommands(BOT_COMMANDS);
  console.log(`Webhook o'rnatildi: ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
