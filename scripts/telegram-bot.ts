/**
 * Lokal rejim: botni long polling bilan ishga tushiradi (webhook shart emas).
 *   npm run bot
 * Ishlab chiqarishda webhook ishlatiladi — `npm run bot:webhook -- https://domen.uz`.
 */
import { loadEnv } from "./env";
loadEnv();

import { getMe, getUpdates, deleteWebhook, setMyCommands, TelegramError } from "../src/lib/telegram/api";
import { handleUpdate, BOT_COMMANDS } from "../src/lib/telegram/bot";
import { sttProvider } from "../src/lib/telegram/stt";
import { llmProvider, PROVIDER_LABEL } from "../src/lib/ai/llm";

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN yo'q. @BotFather dan token oling va .env ga yozing.");
    process.exit(1);
  }

  const me = await getMe();
  await deleteWebhook(); // polling va webhook birga ishlamaydi
  await setMyCommands(BOT_COMMANDS);

  console.log(`Bot ishga tushdi: @${me.username}`);
  console.log(`Ovoz → matn: ${sttProvider() ?? "sozlanmagan (MOHIR_API_KEY / OPENAI_API_KEY)"}`);
  const llm = llmProvider();
  console.log(`Erkin savollar: ${llm ? PROVIDER_LABEL[llm] : "kalit yo'q — qoida asosidagi javoblar"}`);
  console.log("To'xtatish: Ctrl+C\n");

  let offset = 0;
  let stop = false;
  process.on("SIGINT", () => { stop = true; console.log("\nTo'xtatilmoqda…"); process.exit(0); });

  while (!stop) {
    try {
      const updates = await getUpdates(offset, 30);
      for (const u of updates) {
        offset = u.update_id + 1;
        const from = u.message?.from;
        const kind = u.message?.voice ? "🎙 ovoz" : "💬 matn";
        console.log(`${new Date().toLocaleTimeString()} ${kind} · @${from?.username ?? from?.id ?? "?"}`);
        handleUpdate(u).catch((e) => console.error("[handleUpdate]", e));
      }
    } catch (e) {
      if (e instanceof TelegramError && e.code === 409) {
        console.error("Boshqa nusxa ham polling qilyapti (409). Faqat bitta `npm run bot` ishlasin.");
        process.exit(1);
      }
      console.error("[getUpdates]", e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
