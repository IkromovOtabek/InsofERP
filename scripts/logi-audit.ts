/**
 * Logistika auditi — FAQAT O'QISH: dublikat yozuvlar va summalar bir-biriga to'g'ri kelishini tekshiradi.
 *
 *   npx tsx scripts/logi-audit.ts [YYYY-MM]                                            (lokal)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/logi-audit.ts 2026-11   (prod, faqat o'qiydi)
 *
 * Tekshiruvlar:
 *  1. Dublikatlar: bitta reysga ikki dastavka yozuvi, bir xil kun/mashina/summa/toifadagi logistika yozuvi, zapravka,
 *     transport xarajati, qo'lda qator (Hisob varag'i) va reys bilan bir kunda bir xil km'li qo'lda qator.
 *  2. Summalar: Hisob varag'i (driverLedger) ↔ Foyda (avtoReport) ↔ logistika hisobidagi dastavka kirimi;
 *     logistika hisobi qoldig'i ↔ jurnal yig'indisi; qator jami = ustunlar yig'indisi.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { db } = await import("@/lib/db");
  const { driverLedger, ledgerTotals } = await import("@/lib/driver-ledger");
  const { avtoReport } = await import("@/lib/fin-report/avto");
  const { DELIVERY_REF, DELIVERY_LOGI_SINCE, LOGI_MIRROR, logiBalances, logiJournal } = await import("@/lib/logistics-finance");
  const { logiBalance } = await import("@/lib/logistics-balance");
  const { money } = await import("@/lib/format");
  const { dbLabel } = await import("./demo-guard");

  const arg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}$/.test(a));
  const now = new Date();
  const [y, m] = arg ? arg.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const from = new Date(y!, m! - 1, 1), to = new Date(y!, m!, 1);
  const out: string[] = [];
  const log = (s = "") => out.push(s);
  let problems = 0;
  const bad = (s: string) => { problems++; log(`  ✗ ${s}`); };
  const ok = (s: string) => log(`  ✓ ${s}`);
  const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

  log(`Baza: ${dbLabel()} · davr ${y}-${String(m).padStart(2, "0")}`);
  log("\n1. DUBLIKATLAR");

  const dupDelivery = await db.$queryRaw<{ refId: string; n: bigint; sum: number }[]>`
    SELECT "refId", COUNT(*) n, SUM(amount)::float sum FROM "LogisticsTx"
    WHERE "refType" = ${DELIVERY_REF} AND "cancelledAt" IS NULL GROUP BY "refId" HAVING COUNT(*) > 1`;
  if (dupDelivery.length) bad(`Bitta reysga bir nechta dastavka kirimi: ${dupDelivery.length} reys, ${dupDelivery.map((d) => `${d.refId}×${d.n}`).slice(0, 10).join(", ")}`);
  else ok("Har reysga bitta dastavka kirimi");

  const dupTx = await db.$queryRaw<{ d: Date; type: string; category: string; amount: number; vehicleId: string | null; n: bigint; docs: string }[]>`
    SELECT date_trunc('day', date) d, type::text, category, amount::float, "vehicleId", COUNT(*) n, string_agg("docNo", ', ') docs FROM "LogisticsTx"
    WHERE "cancelledAt" IS NULL AND date >= ${from} AND date < ${to} AND ("refType" IS NULL OR "refType" <> ${DELIVERY_REF})
    GROUP BY 1, 2, 3, 4, 5 HAVING COUNT(*) > 1`;
  if (dupTx.length) { bad(`Bir kun · toifa · summa · mashina bir xil logistika yozuvlari: ${dupTx.length} guruh`); for (const d of dupTx.slice(0, 15)) log(`      ${d.d.toISOString().slice(0, 10)} ${d.type} ${d.category} ${money(d.amount)} — ${d.docs}`); }
  else ok("Logistika moliya jurnalida takror yozuv yo'q");

  const dupFuel = await db.$queryRaw<{ d: Date; plate: string; liters: number; amount: number; n: bigint }[]>`
    SELECT date_trunc('day', f.date) d, v.plate, f.liters::float, f.amount::float, COUNT(*) n FROM "FuelLog" f JOIN "Vehicle" v ON v.id = f."vehicleId"
    WHERE f."cancelledAt" IS NULL AND f.date >= ${from} AND f.date < ${to} GROUP BY 1, 2, 3, 4 HAVING COUNT(*) > 1`;
  if (dupFuel.length) { bad(`Bir kun · mashina · litr · summa bir xil zapravka: ${dupFuel.length} guruh`); for (const d of dupFuel.slice(0, 15)) log(`      ${d.d.toISOString().slice(0, 10)} ${d.plate} ${d.liters} · ${money(d.amount)} ×${d.n}`); }
  else ok("Zapravkada takror yo'q");

  const dupExp = await db.$queryRaw<{ d: Date; kind: string; amount: number; vid: string | null; n: bigint }[]>`
    SELECT date_trunc('day', date) d, kind::text, amount::float, COALESCE("vehicleId", "tripId") vid, COUNT(*) n FROM "TransportExpense"
    WHERE "cancelledAt" IS NULL AND kind <> 'DRIVER_PAY' AND date >= ${from} AND date < ${to} GROUP BY 1, 2, 3, 4 HAVING COUNT(*) > 1`;
  if (dupExp.length) { bad(`Bir kun · tur · summa · mashina bir xil transport xarajati: ${dupExp.length} guruh`); for (const d of dupExp.slice(0, 15)) log(`      ${d.d.toISOString().slice(0, 10)} ${d.kind} ${money(d.amount)} ×${d.n}`); }
  else ok("Transport xarajatida takror yo'q");

  const dupEntry = await db.$queryRaw<{ d: Date; plate: string; km: number; rev: number; n: bigint; docs: string }[]>`
    SELECT date_trunc('day', e.date) d, v.plate, COALESCE(e.km, 0)::float km, COALESCE(e.revenue, 0)::float rev, COUNT(*) n, string_agg(e."docNo", ', ') docs
    FROM "LogisticsEntry" e JOIN "Vehicle" v ON v.id = e."vehicleId"
    WHERE e."cancelledAt" IS NULL AND e.date >= ${from} AND e.date < ${to}
    GROUP BY 1, 2, 3, 4, e.pickup, e.dropoff, e.cargo HAVING COUNT(*) > 1`;
  if (dupEntry.length) { bad(`Hisob varag'ida bir xil qo'lda qator (kun, mashina, km, summa, yo'nalish): ${dupEntry.length} guruh`); for (const d of dupEntry.slice(0, 15)) log(`      ${d.d.toISOString().slice(0, 10)} ${d.plate} ${d.km} km · ${money(d.rev)} — ${d.docs}`); }
  else ok("Qo'lda qatorlarda takror yo'q");

  // Reys ECO'dan tushgan va o'sha kun, o'sha mashinaga qo'lda qator ham yozilgan (km bir xil) — bitta ish ikki marta bo'lishi mumkin
  const tripEntry = await db.$queryRaw<{ d: Date; plate: string; km: number; trip: string; entry: string }[]>`
    SELECT date_trunc('day', t."deliveredAt") d, v.plate, e.km::float km, t."deliveryNoteNo" trip, e."docNo" entry
    FROM "Trip" t JOIN "LogisticsEntry" e ON e."vehicleId" = t."vehicleId" AND date_trunc('day', e.date) = date_trunc('day', t."deliveredAt")
    JOIN "Vehicle" v ON v.id = t."vehicleId"
    WHERE t.status = 'DELIVERED' AND e."cancelledAt" IS NULL AND t."deliveredAt" >= ${from} AND t."deliveredAt" < ${to}
      AND e.km IS NOT NULL AND t."payKm" IS NOT NULL AND abs(e.km - t."payKm") < 1`;
  if (tripEntry.length) { bad(`Reys va qo'lda qator bir kun, bir mashina, bir xil km (ikki marta yozilgan bo'lishi mumkin): ${tripEntry.length}`); for (const d of tripEntry.slice(0, 15)) log(`      ${d.d.toISOString().slice(0, 10)} ${d.plate} ${d.km} km — reys ${d.trip} · ${d.entry}`); }
  else ok("Reys bilan qo'lda qator ustma-ust tushmagan");

  // To'langan logistika yozuvi faol, lekin uning mashina xarajati bekor — jurnalda pul bor, Hisob varag'ida xarajat yo'q
  const orphan = await db.$queryRaw<{ docNo: string; amount: number; reason: string | null }[]>`
    SELECT l."docNo", l.amount::float, e."cancelReason" reason FROM "LogisticsTx" l JOIN "TransportExpense" e ON e.id = l."transportExpenseId"
    WHERE l."cancelledAt" IS NULL AND e."cancelledAt" IS NOT NULL`;
  if (orphan.length) { bad(`Logistika yozuvi faol, mashina xarajati bekor (varaqda xarajat yo'q): ${orphan.length}`); for (const o of orphan.slice(0, 15)) log(`      ${o.docNo} ${money(o.amount)} — ${o.reason ?? ""}`); }
  else ok("Logistika moliya xarajatlari Hisob varag'ida bor");

  log("\n2. SUMMALAR MOSLIGI");
  const led = await driverLedger(from, to);
  const t = led.total;
  const re = ledgerTotals(led.rows);
  if (near(re.revenue, t.revenue) && near(re.total, t.total)) ok(`Hisob varag'i jami qatorlardan: tushum ${money(t.revenue)}, xarajat ${money(t.total)}, foyda ${money(t.profit)}`);
  else bad("Hisob varag'i jami qatorlar yig'indisiga teng emas");
  const rowBad = led.rows.filter((r) => !near(r.total, r.pay + r.repair + r.parts + r.vulc + r.other + r.fuelCost + r.extCost) || !near(r.revenue, r.revBank + r.revCash + r.revDebt + r.svcBank + r.svcCash + r.revOther) || !near(r.profit, r.revenue - r.total));
  if (rowBad.length) bad(`Qator jami ustunlarga mos emas: ${rowBad.length} (${rowBad.slice(0, 5).map((r) => r.no || r.id).join(", ")})`);
  else ok(`${led.rows.length} qatorda jami = ustunlar yig'indisi`);
  const ids = led.rows.map((r) => r.id);
  if (new Set(ids).size !== ids.length) bad("Hisob varag'ida bir qator ikki marta chiqqan"); else ok("Hisob varag'ida har qator bir marta");

  const av = await avtoReport(from, to);
  const tripRev = led.rows.filter((r) => r.kind === "trip").reduce((s, r) => s + r.revenue, 0);
  log(`  · Foyda tabi (avtoReport): daromad ${money(av.total.revenue)}, xarajat ${money(av.total.total)}, foyda ${money(av.total.profit)}`);
  log(`  · Hisob varag'i: reys dastavkasi ${money(tripRev)}, qo'lda qator kirimi ${money(t.revenue - tripRev)}`);
  if (!near(av.total.revenue, t.revenue, 100)) log(`    (farq ${money(t.revenue - av.total.revenue)} — Foyda tabi qo'lda qator kirimini va boshqa usulni hisobga olishi mumkin, ko'rib chiqing)`);

  // Kirim nusxasi (2026-11-26 gacha) — endi o'chirilgan; faqat yoqiq bo'lsa solishtiriladi
  if (LOGI_MIRROR && to > DELIVERY_LOGI_SINCE) {
    const tripIds = led.rows.filter((r) => r.kind === "trip" && r.at >= DELIVERY_LOGI_SINCE).map((r) => r.id);
    const dl = await db.logisticsTx.findMany({ where: { refType: DELIVERY_REF, cancelledAt: null, date: { gte: from, lt: to } }, select: { refId: true, amount: true } });
    const dlBy = new Map(dl.map((x) => [x.refId!, Number(x.amount)]));
    const ledBy = new Map(led.rows.filter((r) => r.kind === "trip").map((r) => [r.id, r.revenue]));
    const missing = tripIds.filter((id) => (ledBy.get(id) ?? 0) > 0 && !dlBy.has(id));
    const extra = dl.filter((x) => !ledBy.has(x.refId!));
    const diff = tripIds.filter((id) => dlBy.has(id) && !near(dlBy.get(id)!, ledBy.get(id) ?? 0));
    const dlSum = dl.reduce((s, x) => s + Number(x.amount), 0);
    log(`  · Logistika hisobiga tushgan dastavka: ${money(dlSum)} (${dl.length} reys)`);
    if (missing.length) bad(`Hisob varag'ida dastavkasi bor, logistika hisobiga tushmagan reys: ${missing.length} — ${money(missing.reduce((s, id) => s + (ledBy.get(id) ?? 0), 0))} (zayavkada «dastavka kerak» belgisi yo'q yoki sinxron bo'lmagan)`);
    if (extra.length) bad(`Logistika hisobida dastavka bor, varaqda reysi yo'q: ${extra.length} — ${money(extra.reduce((s, x) => s + Number(x.amount), 0))}`);
    if (diff.length) bad(`Dastavka summasi farq qiladi: ${diff.length} reys`);
    if (!missing.length && !extra.length && !diff.length) ok("Dastavka: Hisob varag'i = logistika hisobi");
  }

  const j = await logiJournal(new Date(2000, 0, 1), new Date(2100, 0, 1));
  const bal = await logiBalances();
  const balSum = [...bal.values()].reduce((s, v) => s + v, 0);
  const logiRows = j.rows.filter((r) => r.kind !== "FACTORY");
  const jSum = logiRows.reduce((s, r) => s + (r.type === "INCOME" ? r.amount : -r.amount), 0);
  if (near(balSum, jSum)) ok(`Logistika kassasi qoldig'i ${money(balSum)} = jurnal (kirim − chiqim)`);
  else bad(`Logistika kassasi qoldig'i ${money(balSum)} ≠ jurnal ${money(jSum)}`);

  const b = await logiBalance(from, to);
  log(`  · Logistika hisobi (davr): tushum ${money(b.tushum)} − xarajat ${money(b.xarajat)} − oylik ${money(b.oylik)} = qoldiq ${money(b.qoldiq)}`);
  if (near(b.qoldiq, b.ledger.profit)) ok(`Qoldiq ${money(b.qoldiq)} = Hisob varag'i «Foyda» ustuni jami`);
  else bad(`Qoldiq ${money(b.qoldiq)} ≠ «Foyda» ustuni jami ${money(b.ledger.profit)}`);

  log(`\nNatija: ${problems ? `${problems} ta muammo` : "muammo topilmadi"}`);
  const text = out.join("\n") + "\n";
  process.stdout.write(text, () => process.exit(0));
}

main().catch((e) => { console.error(e); process.exit(1); });
