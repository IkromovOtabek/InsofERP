/**
 * GPS davriy tekshiruvini bir marta ishga tushirish (qo'lda yoki cron orqali — odatda shart emas:
 * korxona jarayoni buni o'zi har daqiqada bajaradi, `src/instrumentation.ts`).
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npm run -s gps:watch            — tekshiruv (daqiqasiga bir martadan ko'p emas)
 *   ENV_FILE=... npm run -s gps:watch -- --force --cleanup                          — chegarasiz + 90 kunlik tozalash hozir
 *
 * Bir vaqtda ikkita tekshiruv ishlamaydi (Postgres advisory lock) — jarayon taymeri bilan to'qnashmaydi.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { gpsWatchTick } = await import("@/lib/gps-watch");
  const force = process.argv.includes("--force");
  const cleanup = process.argv.includes("--cleanup") ? true : undefined;
  const r = await gpsWatchTick({ force, cleanup });
  if (!r) console.log("[gps-watch] o'tkazib yuborildi — boshqa jarayon hozirgina tekshirgan yoki ishlayapti");
  else console.log(`[gps-watch] reys: ${r.checked}, ochildi: ${r.opened.length}, yopildi: ${r.closed.length}${r.cleanup ? `, tozalash: ${r.cleanup.summarized} yakun, ${r.cleanup.deleted} nuqta o'chirildi` : ""}`);
  const { db } = await import("@/lib/db");
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
