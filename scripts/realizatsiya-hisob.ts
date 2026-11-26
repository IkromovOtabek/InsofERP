/**
 * Realizatsiyadagi qo'lda (reyssiz) qatorlar → Hisob varag'i: shu o'zgarishdan (2026-11-26) oldin yozilgan qatorlar uchun
 * bir martalik to'ldirish. Qoida `lib/logistics-entry.ts` → `syncRealizationLedgerTx`. Idempotent — qayta ishga tushirilsa
 * faqat yangisi yoziladi. `DELIVERY_LOGI_SINCE` (01.11.2026) dan beri.
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/realizatsiya-hisob.ts          (faqat ro'yxat)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/realizatsiya-hisob.ts --yes    (yozish — faqat takrorsizlari)
 *   … --yes --hammasi   (takror bo'lishi mumkinlari ham — Hisob varag'ida «Takror?» bilan chiqadi)
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
  // Sukut — faqat takrorsizlari (foydalanuvchi qarori, 2026-11-26); `--hammasi` — takror bo'lishi mumkinlari ham
  const all = process.argv.includes("--hammasi");

  const linked = new Set((await db.logisticsEntry.findMany({ where: { realizationEntryId: { not: null } }, select: { realizationEntryId: true } })).map((e) => e.realizationEntryId!));
  const rows = (await db.realizationEntry.findMany({
    where: { cancelledAt: null, date: { gte: DELIVERY_LOGI_SINCE } }, orderBy: { date: "asc" },
    select: { id: true, date: true, customerName: true, destination: true, vehicle: true, delivery: true },
  })).filter((r) => !linked.has(r.id));
  const key = (v: string | null) => (v ?? "").replace(/[\s-]/g, "").toUpperCase();
  const plates = new Map((await db.vehicle.findMany({ where: { isActive: true }, select: { id: true, plate: true } })).map((v) => [key(v.plate), v.id]));
  const vidOf = (r: (typeof rows)[number]) => (r.vehicle ? plates.get(key(r.vehicle)) ?? null : null);

  /**
   * Ehtimoliy takror — shu ish Hisob varag'ida allaqachon bor:
   *  · mashinasi topilgan qator: shu kun, shu mashinada dispetcher yozgan qator yoki yetkazilgan reys;
   *  · mashinasiz qator: shu kun dispetcher qatorining tushirish joyi/izohida xaridor yoki manzil nomi, yoki shu xaridorning reysi.
   */
  const twin = async (r: (typeof rows)[number]): Promise<boolean> => {
    const d0 = new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate()), d1 = new Date(d0.getTime() + 86_400_000);
    const day = { gte: d0, lt: d1 };
    const vid = vidOf(r);
    if (vid) {
      return (await db.logisticsEntry.count({ where: { vehicleId: vid, cancelledAt: null, realizationEntryId: null, date: day } })) > 0
        || (await db.trip.count({ where: { vehicleId: vid, status: "DELIVERED", deliveredAt: day } })) > 0;
    }
    const names = [r.customerName, r.destination].filter((x): x is string => !!x && x.trim().length >= 3).map((x) => x.trim());
    if (!names.length) return false;
    const text = names.flatMap((n) => [{ dropoff: { contains: n, mode: "insensitive" as const } }, { note: { contains: n, mode: "insensitive" as const } }]);
    return (await db.logisticsEntry.count({ where: { cancelledAt: null, realizationEntryId: null, date: day, OR: text } })) > 0
      || (await db.trip.count({ where: { status: "DELIVERED", deliveredAt: day, order: { customer: { name: { equals: r.customerName, mode: "insensitive" } } } } })) > 0;
  };
  const twins = new Set<string>();
  for (const r of rows) if (await twin(r)) twins.add(r.id);
  const pick = all ? rows : rows.filter((r) => !twins.has(r.id));
  const fee = (xs: typeof rows) => money(xs.reduce((a, r) => a + Number(r.delivery), 0));

  console.log(`Baza: ${dbLabel()} · ${date(DELIVERY_LOGI_SINCE)} dan Realizatsiya qo'lda qatorlari (Hisob varag'iga hali tushmagan): ${rows.length}, dastavka ${fee(rows)}`);
  console.log(`  ehtimoliy takror (shu ish Hisob varag'ida bor bo'lishi mumkin): ${twins.size}, dastavka ${fee(rows.filter((r) => twins.has(r.id)))}`);
  console.log(`  takrorsiz: ${rows.length - twins.size}, dastavka ${fee(rows.filter((r) => !twins.has(r.id)))}`);
  console.log(`    shundan mashinasi topilgan: ${rows.filter((r) => !twins.has(r.id) && vidOf(r)).length}, mashinasiz («Mashina yo'q» varag'iga): ${rows.filter((r) => !twins.has(r.id) && !vidOf(r)).length}`);
  console.log(`\nYoziladi (${all ? "--hammasi: takrorlar ham" : "faqat takrorsizlari"}): ${pick.length} qator, dastavka ${fee(pick)} — logistika kassasiga kirim`);
  if (!confirmed) { console.log("Yozilmadi. Yozish uchun --yes qo'shing."); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi");
  for (const r of pick) await db.$transaction((tx) => syncRealizationLedgerTx(tx, r.id, director.id));
  const after = await db.logisticsEntry.count({ where: { realizationEntryId: { not: null }, cancelledAt: null } });
  console.log(`\nTayyor: Hisob varag'ida Realizatsiyadan ${after} qator`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
