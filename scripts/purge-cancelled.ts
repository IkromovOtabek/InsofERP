/**
 * Ilgari bekor qilingan zayavka va reyslarni bazadan BUTUNLAY o'chirish (bir martalik tozalash).
 * Endi bekor qilish o'zi o'chiradi (`lib/purge-cancelled.ts`) — bu skript eskilari uchun.
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/purge-cancelled.ts          (faqat hisobot)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/purge-cancelled.ts --yes    (o'chirish)
 *
 * Qoidasi `purgeTripTx` / `purgeOrderTx` bilan bir xil: avans, yoqilg'i, xarajat, storno zames qoladi
 * (faqat havolasi uziladi). Sklad harakati yoki brigada qaydi bor yozuv o'chirilmaydi — hisobotda ko'rsatiladi.
 * Har yozuv o'z tranzaksiyasida; AuditLog'ga DELETE yoziladi. Oldin pg_dump zaxira oling.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { db } = await import("@/lib/db");
  const { purgeCancelledOrder, purgeCancelledTrip } = await import("@/lib/purge-cancelled");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");

  const [trips, orders] = await Promise.all([
    db.trip.findMany({ where: { status: "CANCELLED" }, select: { id: true, deliveryNoteNo: true } }),
    db.order.findMany({ where: { status: "CANCELLED" }, select: { id: true, orderNo: true } }),
  ]);
  console.log(`\nBaza: ${dbLabel()}\nBekor qilingan reys: ${trips.length} ta, zayavka: ${orders.length} ta`);
  if (!confirmed) { console.log("\nFaqat hisobot. O'chirish uchun: --yes\n"); return; }
  if (!trips.length && !orders.length) return;

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — audit kimga yozilishini bilmaymiz");

  const skipped: string[] = [];
  let t = 0, o = 0;
  for (const x of trips) { if (await purgeCancelledTrip(x.id, director.id)) t++; else skipped.push(`reys ${x.deliveryNoteNo}`); }
  for (const x of orders) { if (await purgeCancelledOrder(x.id, director.id)) o++; else skipped.push(`zayavka ${x.orderNo}`); }
  console.log(`\nO'chirildi: ${t} ta reys, ${o} ta zayavka`);
  if (skipped.length) console.log(`O'chirilmadi (sklad harakati, brigada qaydi yoki faol reys bor): ${skipped.join(", ")}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
