import { loadEnv } from "./env";
loadEnv();

/**
 * Obyekt kartalari (Logistika → Obyektlar) paydo bo'lishidan oldingi zayavkalarni obyektlarga bog'lash.
 * Qayta ishga tushirilsa zarari yo'q: bog'langan zayavkaga tegmaydi, bir xil manzil bitta obyekt bo'ladi.
 *   npx tsx scripts/backfill-sites.ts
 */
async function main() {
  const { db } = await import("@/lib/db");
  const { ensureSite } = await import("@/lib/logistics");
  const orders = await db.order.findMany({
    where: { siteId: null, kind: "SALE", customer: { isInternal: false } },
    select: { id: true, customerId: true, deliveryAddress: true, lat: true, lng: true },
    orderBy: { date: "asc" },
  });
  let linked = 0;
  for (const o of orders) {
    const siteId = await ensureSite(db, o.customerId, o.deliveryAddress, { lat: o.lat, lng: o.lng });
    if (siteId) { await db.order.update({ where: { id: o.id }, data: { siteId } }); linked++; }
  }
  console.log(`Zayavkalar: ${orders.length}, bog'landi: ${linked}, obyektlar jami: ${await db.site.count()}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
