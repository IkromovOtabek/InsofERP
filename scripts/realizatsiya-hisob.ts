/**
 * Realizatsiyadagi qo'lda (reyssiz) qatorlar → Hisob varag'i: shu o'zgarishdan (2026-11-26) oldin yozilgan qatorlar uchun
 * bir martalik to'ldirish. Qoida `lib/logistics-entry.ts` → `syncRealizationLedgerTx`. Idempotent — qayta ishga tushirilsa
 * faqat yangisi yoziladi. `DELIVERY_LOGI_SINCE` (01.11.2026) dan beri.
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/realizatsiya-hisob.ts          (faqat ro'yxat)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/realizatsiya-hisob.ts --yes    (yozish)
 *
 * Har yozuv AuditLog'ga tushadi (muallif — birinchi faol direktor). Dastavka logistika kassasiga kirim bo'ladi. Oldin pg_dump.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { db } = await import("@/lib/db");
  const { DELIVERY_LOGI_SINCE } = await import("@/lib/logistics-finance");
  const { syncRealizationLedgerTx } = await import("@/lib/logistics-entry");
  const { dbLabel } = await import("./demo-guard");
  const { money, date } = await import("@/lib/format");
  const confirmed = process.argv.includes("--yes");

  const linked = new Set((await db.logisticsEntry.findMany({ where: { realizationEntryId: { not: null } }, select: { realizationEntryId: true } })).map((e) => e.realizationEntryId!));
  const rows = (await db.realizationEntry.findMany({
    where: { cancelledAt: null, date: { gte: DELIVERY_LOGI_SINCE } }, orderBy: { date: "asc" },
    select: { id: true, date: true, customerName: true, vehicle: true, delivery: true, ttn: true },
  })).filter((r) => !linked.has(r.id));
  const key = (v: string | null) => (v ?? "").replace(/[\s-]/g, "").toUpperCase();
  const plates = new Map((await db.vehicle.findMany({ where: { isActive: true }, select: { id: true, plate: true } })).map((v) => [key(v.plate), v.id]));
  const matched = rows.filter((r) => r.vehicle && plates.has(key(r.vehicle)));
  const fee = rows.reduce((a, r) => a + Number(r.delivery), 0);

  // Ehtimoliy takror: shu kun, shu mashinada Hisob varag'ida allaqachon qo'lda qator yoki yetkazilgan reys bor
  let twins = 0;
  for (const r of matched) {
    const vid = plates.get(key(r.vehicle))!, d0 = new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate()), d1 = new Date(d0.getTime() + 86_400_000);
    const n = await db.logisticsEntry.count({ where: { vehicleId: vid, cancelledAt: null, realizationEntryId: null, date: { gte: d0, lt: d1 } } })
      + await db.trip.count({ where: { vehicleId: vid, status: "DELIVERED", deliveredAt: { gte: d0, lt: d1 } } });
    if (n) twins++;
  }

  console.log(`Baza: ${dbLabel()} · ${date(DELIVERY_LOGI_SINCE)} dan Realizatsiya qo'lda qatorlari (Hisob varag'iga hali tushmagan): ${rows.length}`);
  console.log(`  mashinasi ro'yxatdagiga mos: ${matched.length}, mashinasiz («Mashina yo'q» varag'iga): ${rows.length - matched.length}`);
  console.log(`  dastavka jami (logistika kassasiga kirim bo'ladi): ${money(fee)}`);
  console.log(`  ehtimoliy takror (shu kun, shu mashinada boshqa qator/reys bor): ${twins} — Hisob varag'ida «Takror?» belgisi bilan chiqadi`);
  if (!confirmed) { console.log("\nYozilmadi. Yozish uchun --yes qo'shing."); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi");
  for (const r of rows) await db.$transaction((tx) => syncRealizationLedgerTx(tx, r.id, director.id));
  const after = await db.logisticsEntry.count({ where: { realizationEntryId: { not: null }, cancelledAt: null } });
  console.log(`\nTayyor: Hisob varag'ida Realizatsiyadan ${after} qator`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
