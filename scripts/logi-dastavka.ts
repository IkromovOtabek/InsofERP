/**
 * Zayavka dastavkasi → logistika hisobi: shu o'zgarishdan oldin yetkazilgan reyslar uchun bir martalik to'ldirish.
 * Qoida `lib/logistics-finance.ts` → `syncOrderDeliveryTx` (reys ulushi, `DELIVERY_LOGI_SINCE` dan boshlab). Idempotent —
 * qayta ishga tushirilsa faqat farqi yoziladi.
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/logi-dastavka.ts          (faqat ro'yxat)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/logi-dastavka.ts --yes    (yozish)
 *
 * Har yozuv AuditLog'ga tushadi (muallif — birinchi faol direktor). Oldin pg_dump zaxira oling.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { db } = await import("@/lib/db");
  const { DELIVERY_LOGI_SINCE, DELIVERY_REF, syncOrderDeliveryTx } = await import("@/lib/logistics-finance");
  const { dbLabel } = await import("./demo-guard");
  const { money, date } = await import("@/lib/format");
  const confirmed = process.argv.includes("--yes");

  const orders = await db.order.findMany({
    where: { needsDelivery: true, deliveryFee: { gt: 0 }, trips: { some: { status: "DELIVERED", deliveredAt: { gte: DELIVERY_LOGI_SINCE } } } },
    select: { id: true, orderNo: true, deliveryFee: true },
    orderBy: { orderNo: "asc" },
  });
  const before = await db.logisticsTx.aggregate({ where: { refType: DELIVERY_REF, cancelledAt: null }, _sum: { amount: true }, _count: true });
  console.log(`Baza: ${dbLabel()} · ${date(DELIVERY_LOGI_SINCE)} dan yetkazilgan, dastavkali zayavkalar: ${orders.length}`);
  console.log(`Hozir logistika hisobida dastavka: ${before._count} yozuv, ${money(Number(before._sum.amount ?? 0))}`);
  for (const o of orders) console.log(`  ${o.orderNo} · dastavka ${money(Number(o.deliveryFee))}`);
  if (!confirmed) { console.log("\nYozilmadi. Yozish uchun --yes qo'shing."); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi");
  for (const o of orders) await db.$transaction((tx) => syncOrderDeliveryTx(tx, o.id, director.id));
  const after = await db.logisticsTx.aggregate({ where: { refType: DELIVERY_REF, cancelledAt: null }, _sum: { amount: true }, _count: true });
  console.log(`\nTayyor: ${after._count} yozuv, ${money(Number(after._sum.amount ?? 0))}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
