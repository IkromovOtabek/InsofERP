/**
 * QA (C) — Sarvar rejasi 3-bosqich (2026-11-24): Tahlil taqqoslash davri (`comparisonWindow`/`parseRange`), «Biznes
 * salomatligi» bali (`lib/bi/health.ts`: pul uzilishi, sof foyda, qarz yuki, debitorka ulushi) va «Ma'lumot sog'ligi»
 * tekshiruvlari (`lib/data-health.ts`) fixture ma'lumotda. Server kerak emas; Telegram'ga murojaat yo'q.
 *
 *   DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_c npx tsx scripts/qa/c-health.ts
 */
import { check, section, done } from "./c-lib";
import { db } from "@/lib/db";
import { comparisonWindow, parseRange, hasPrevData } from "@/lib/bi/core";
import { healthScore, HEALTH_CAP, type HealthInput } from "@/lib/bi/health";
import { runDataHealth, saveDataHealthRun, problemsOf, healthText } from "@/lib/data-health";
import { dataHealthTick } from "@/lib/data-health-watch";
import { tashkentDay } from "@/lib/nazorat/checks";

process.env.TELEGRAM_BOT_TOKEN = ""; // haqiqiy botga hech narsa ketmasin

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

async function main() {
  const tag = Date.now() % 1_000_000;

  section("1. Taqqoslash davri");
  {
    // 01.11–23.11 (to = 24.11) ↔ 01.10–23.10 (prevTo = 24.10)
    const w = comparisonWindow("month", d(2026, 11, 1), d(2026, 11, 24));
    check("oy: 01.11–23.11 ↔ 01.10–23.10", iso(w.prevFrom) === "2026-10-01" && iso(w.prevTo) === "2026-10-24", { from: iso(w.prevFrom), to: iso(w.prevTo) });
    const w2 = comparisonWindow("month", d(2026, 12, 1), d(2027, 1, 1)); // 01.12–31.12
    check("oy oxiri: 01.12–31.12 ↔ 01.11–30.11 (kesiladi)", iso(w2.prevFrom) === "2026-11-01" && iso(w2.prevTo) === "2026-12-01", { from: iso(w2.prevFrom), to: iso(w2.prevTo) });
    const w3 = comparisonWindow("month", d(2027, 3, 1), d(2027, 3, 31)); // 01.03–30.03 ↔ fevral (28 kun)
    check("mart 30 kun ↔ fevral butun (01.02–28.02)", iso(w3.prevFrom) === "2027-02-01" && iso(w3.prevTo) === "2027-03-01", { from: iso(w3.prevFrom), to: iso(w3.prevTo) });
    const w4 = comparisonWindow("year", d(2026, 1, 1), d(2026, 11, 24));
    check("yil: 01.01–23.11.2026 ↔ 01.01–23.11.2025", iso(w4.prevFrom) === "2025-01-01" && iso(w4.prevTo) === "2025-11-24", { from: iso(w4.prevFrom), to: iso(w4.prevTo) });
    const w5 = comparisonWindow("year", d(2028, 1, 1), d(2028, 3, 1)); // 29.02.2028 gacha ↔ 28.02.2027 gacha
    check("kabisa yil: 29.02 → o'tgan yil 28.02", iso(w5.prevTo) === "2027-03-01", iso(w5.prevTo));
    const w6 = comparisonWindow("day", d(2026, 11, 24), d(2026, 11, 25));
    check("kun: kecha", iso(w6.prevFrom) === "2026-11-23" && iso(w6.prevTo) === "2026-11-24");
    const w7 = comparisonWindow("custom", d(2026, 11, 10), d(2026, 11, 20));
    check("erkin oraliq: oldingi teng oraliq", iso(w7.prevFrom) === "2026-10-31" && iso(w7.prevTo) === "2026-11-10");
    const r = parseRange({}, new Date(2026, 10, 23, 15, 0));
    check("parseRange (oy, 23.11) — taqqoslash 01.10 — 23.10", r.prevLabel === "01.10.2026 — 23.10.2026", r.prevLabel);
    check("ishga tushish 31.10 → oktabr taqqoslashi «ma'lumot yo'q»", !hasPrevData(r, d(2026, 10, 31)) && hasPrevData(r, d(2026, 9, 1)) && hasPrevData(r, null));
  }

  section("2. Biznes salomatligi");
  {
    const base: HealthInput = {
      customers: 100, receivable: 1_000, overdueDebt: 0,
      materials: { total: 10, ok: 10, atRisk: 0 }, revenue: 1_000, margin: 30, prevRevenue: 1_000,
      orders: { inRange: 10, blocked: 0, overdue: 0 }, monthRevenue: 1_000, prevMonthRevenue: 1_000,
      finance: { gap: null, horizonDays: 30, net: 200, income: 1_000, loans: 0, suppliers: 500 },
    };
    const good = healthScore(base);
    check("hamma yaxshi — Sog'lom", good.label === "Sog'lom" && (good.health ?? 0) >= 75 && good.components.length === 8, good);
    const gap = healthScore({ ...base, finance: { ...base.finance!, gap: { date: d(2026, 11, 28), balance: -5_000 } } });
    check("pul uzilishi kutilsa — Sog'lom emas, ball ≤ 74", gap.label !== "Sog'lom" && (gap.health ?? 0) <= HEALTH_CAP && !!gap.capped, gap);
    check("pul oqimi komponenti 0/20", gap.components.find((c) => c.label === "Pul oqimi")?.score === 0);
    const loss = healthScore({ ...base, finance: { ...base.finance!, net: -5_000 } });
    check("oy zarar bilan — Sog'lom emas", loss.label !== "Sog'lom" && loss.components.find((c) => c.label === "Sof foyda")?.score === 0, loss);
    // Sarvar misoli: 7,2 mlrd debitorka, muddati o'tgani ko'p — endi 20/20 emas
    const debt = healthScore({ ...base, receivable: 7_200, overdueDebt: 4_000, monthRevenue: 3_500, prevMonthRevenue: 3_500 });
    check("debitorka: muddati o'tgan ulushi 55% → 0/20", debt.components.find((c) => c.label === "Debitorka nazorati")?.score === 0, debt.components[0]);
    const heavy = healthScore({ ...base, monthRevenue: 3_500, prevMonthRevenue: 3_500, finance: { ...base.finance!, loans: 26_800, suppliers: 0 } });
    check("qarz yuki 7,7 oylik sotuv → 0/20", heavy.components.find((c) => c.label === "Qarz yuki")?.score === 0, heavy.components.find((c) => c.label === "Qarz yuki"));
    const sarvar = healthScore({ ...base, receivable: 7_200, overdueDebt: 4_000, monthRevenue: 3_500, prevMonthRevenue: 3_500,
      finance: { gap: { date: d(2026, 11, 28), balance: -1_000 }, horizonDays: 30, net: -5_070, income: 3_660, loans: 26_800, suppliers: 0 } });
    check("Sarvar holati (PNL −5 mlrd, qarz 26,8 mlrd, uzilish 28.11) — «Xavfli» yoki «E'tibor talab», «Sog'lom» emas", sarvar.label !== "Sog'lom", { h: sarvar.health, l: sarvar.label });
    const empty = healthScore({ ...base, customers: 0, materials: { total: 0, ok: 0, atRisk: 0 }, revenue: 0, prevRevenue: 0, orders: { inRange: 0, blocked: 0, overdue: 0 }, finance: null });
    check("bo'sh baza — ball hisoblanmaydi", empty.health === null, empty);
  }

  section("3. Ma'lumot sog'ligi — fixture");
  const user = await db.user.create({ data: { login: `qa.health.${tag}`, passwordHash: "x", fullName: "QA Sog'liq", role: "DIRECTOR" } });
  const U = user.id;
  const wh = await db.warehouse.findFirst({ where: { isDefault: true } }) ?? await db.warehouse.create({ data: { name: `QA sklad ${tag}`, isDefault: true } });
  const prod = await db.product.create({ data: { code: `QAH${tag}`, name: `QA plita ${tag}`, unit: "dona", price: 0 } });
  const before = await runDataHealth();
  const now = new Date();
  // Sotuv 999 999 dona, ishlab chiqarilmagan — eng katta farq bo'lib birinchi qatorda chiqsin
  await db.realizationEntry.create({ data: { date: now, payGroup: "CASH", customerName: `QA mijoz ${tag}`, productId: prod.id, productName: prod.name, groupName: "", unit: "dona", qty: 999_999, price: 0, createdById: U } });
  await db.stockMove.create({ data: { type: "PRODUCTION_OUTPUT", warehouseId: wh.id, productId: prod.id, qty: 5, createdById: U, date: now } });
  const cust = await db.customer.create({ data: { name: `QA ochiq mijoz ${tag}` } });
  await db.order.create({ data: { orderNo: `QA-H-${tag}`, customerId: cust.id, status: "CONFIRMED", date: new Date(now.getTime() - 9 * 86_400_000), deliveryDate: now, deliveryAddress: "QA", createdById: U } });
  const acc = await db.cashAccount.create({ data: { name: `QA kassa ${tag}`, type: "CASH" } });
  await db.cashTransaction.create({ data: { type: "EXPENSE", date: now, cashAccountId: acc.id, amount: 70_000, category: "QA", createdById: U } });
  const after = await runDataHealth();
  const by = (k: string) => after.find((c) => c.key === k)!;
  check("8 ta tekshiruv", after.length === 8, after.map((c) => c.key));
  const soldRow = by("sold_gt_supply").rows.find((r) => r.label === prod.name);
  check("sotilgan > ishlab chiqarilgan: fixture mahsulot topildi (shoshilinch)", by("sold_gt_supply").status === "crit" && !!soldRow, by("sold_gt_supply").rows.slice(0, 3));
  check("qatorda oy boshi + kirim ko'rinadi (5 ta kirim)", (soldRow?.detail ?? "").includes("kirim 5"), soldRow);
  check("narxsiz sotuv topildi", by("unpriced_uncosted").status === "crit" && by("unpriced_uncosted").rows.some((r) => r.label.includes(prod.name)), by("unpriced_uncosted").value);
  check("katalog: papkasiz, narxsiz, retseptsiz mahsulot — shoshilinch", by("catalog").status === "crit" && by("catalog").rows.some((r) => r.label === prod.name && r.detail === "papkasiz, narx 0, retseptsiz"), by("catalog").rows.slice(0, 3));
  check("7 kundan ortiq ochiq zayavka +1", by("open_orders").count === (before.find((c) => c.key === "open_orders")?.count ?? 0) + 1);
  check("kassa: manfiy qoldiq — shoshilinch", by("cash_reconcile").status === "crit" && by("cash_reconcile").rows.some((r) => r.label === acc.name && r.detail.includes("manfiy")), by("cash_reconcile").rows.filter((r) => r.label === acc.name));
  await db.cashTransaction.create({ data: { type: "INCOME", date: new Date(now.getTime() + 40 * 86_400_000), cashAccountId: acc.id, amount: 100_000, category: "QA", createdById: U } });
  const fut = await runDataHealth();
  check("kassa: kelajak sanali yozuv — tenglik buzilgani ko'rinadi", fut.find((c) => c.key === "cash_reconcile")!.rows.some((r) => r.label === acc.name && r.detail.includes("kelajak")), fut.find((c) => c.key === "cash_reconcile")!.rows.filter((r) => r.label === acc.name));
  check("muammolar soni", problemsOf(after) >= 4);
  check("Telegram matni faqat muammolar bilan", healthText(after, now, "http://x/bi-tahlil/sogliq").includes("Ma'lumot sog'ligi") && !healthText(after, now, "x").includes("Joyida"));

  section("4. Saqlash va tungi yugurish");
  await db.dataHealthRun.deleteMany({ where: { day: tashkentDay(now) } });
  const manual = await saveDataHealthRun({ manual: true });
  check("qo'lda yugurish yozildi", !!manual && (await db.dataHealthRun.findUnique({ where: { id: manual!.id } }))?.manual === true);
  const night = new Date(tashkentDay(now).getTime() + 3 * 3_600_000); // Toshkent 03:00
  const early = new Date(tashkentDay(now).getTime() + 1 * 3_600_000); // Toshkent 01:00
  check("01:00 da yugurmaydi", (await dataHealthTick(early)) === null);
  const t1 = await dataHealthTick(night);
  const t2 = await dataHealthTick(night);
  check("03:00 da bir marta yuguradi, ikkinchisi — yo'q", !!t1 && t2 === null, { t1, t2 });
  check("bot yo'q — Telegram yuborilmadi", t1?.notified === 0);

  // Tozalash (test bazasi; boshqa testlarga xalaqit bermasin)
  await db.dataHealthRun.deleteMany({ where: { OR: [{ id: manual?.id }, { day: tashkentDay(now) }] } });
  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
