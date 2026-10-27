/**
 * QA (C) — Tannarx hisobi va mahsulot foydasi (`lib/fin-report/cost.ts`), to'lov kalendarining yangi ustunlari
 * (yangi xom-ashyo, divident, kundalik xarajat belgilari) va «Ta'minotchilar — shu oy» jadvali (`calendar.ts`).
 * Server kerak emas. Faqat lokal insof_test… bazasi (c-lib tekshiradi). Tannarx — o'zimiz uchun bo'sh oyda
 * (2000-yillar boshidan birinchi bo'sh oy) qo'lda hisoblangan raqamlar bilan solishtiriladi.
 *
 *   DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_c npx tsx scripts/qa/c-tannarx.ts
 */
import { check, section, done } from "./c-lib";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { resetCategoryCache } from "@/lib/fin-report/categories";
import { costSheet, productProfit } from "@/lib/fin-report/cost";
import { type MonthKey, addMonths, monthStart } from "@/lib/fin-report/period";
import { cashCalendar, supplierMonth } from "@/lib/fin-report/calendar";

const near = (a: number | null | undefined, b: number, eps = 1) => a != null && Math.abs(a - b) <= eps;

async function main() {
  const tag = Date.now() % 1_000_000;
  resetCategoryCache();
  const user = await db.user.findFirst({ select: { id: true } }) ?? await db.user.create({ data: { login: `qa.tan.${tag}`, passwordHash: "x", fullName: "QA Tannarx", role: "ACCOUNTING" } });
  const U = user.id;

  // Bo'sh oy: kirim, sotuv va kassa harakati yo'q
  let month: MonthKey = "2003-01";
  for (let i = 0; i < 120; i++, month = addMonths(month, 1)) {
    const s = await costSheet(month);
    if (!s.arrivals.length && !s.items.length && !s.overhead.length) break;
  }
  const at = (day: number) => new Date(monthStart(month).getTime() + (day - 1) * 86_400_000 + 12 * 3_600_000);

  section(`1. Ma'lumot (${month})`);
  const wh = await db.warehouse.findFirst({ select: { id: true } }) ?? await db.warehouse.create({ data: { name: `QA sklad ${tag}` } });
  const sem = await db.material.create({ data: { code: `QAS${tag}`, name: `QA Sement M400 ${tag}`, unit: "kg" } });
  const qum = await db.material.create({ data: { code: `QAQ${tag}`, name: `QA Qum ${tag}`, unit: "kg" } });
  const zap = await db.material.create({ data: { code: `QAZ${tag}`, name: `QA podshipnik ${tag}`, unit: "dona" } });
  const beton = await db.product.create({ data: { code: `QAB${tag}`, name: `QA Beton ${tag}`, unit: "m3" } });
  const plita = await db.product.create({ data: { code: `QAP${tag}`, name: `QA Plita ${tag}`, unit: "dona", pieceRate: 50_000 } });
  await db.recipe.create({ data: { productId: beton.id, items: { create: [{ materialId: sem.id, qtyPerM3: 300 }, { materialId: qum.id, qtyPerM3: 800 }] } } });
  // Plita ichida 0,5 m³ beton (retsept yoyiladi) + 10 kg sement
  await db.recipe.create({ data: { productId: plita.id, items: { create: [{ productId: beton.id, qtyPerM3: 0.5 }, { materialId: sem.id, qtyPerM3: 10 }] } } });
  const sup = await db.supplier.create({ data: { name: `QA Sement zavodi ${tag}` } });
  await db.goodsReceipt.create({ data: { docNo: `QA-T-${tag}`, date: at(3), supplierId: sup.id, warehouseId: wh.id, items: { create: [
    { materialId: sem.id, qty: 10_000, price: 1_000, vatRate: 12, vatAmount: 1_200_000 },
    { materialId: qum.id, qty: 30_000, price: 100 },
    { materialId: zap.id, qty: 5, price: 200_000 },
  ] } } });
  const mv = (d: object) => db.stockMove.create({ data: { warehouseId: wh.id, createdById: U, ...d } as never });
  await mv({ date: at(3), type: "RECEIPT", materialId: sem.id, qty: 10_000, unitCost: 1_000 });
  await mv({ date: at(3), type: "RECEIPT", materialId: qum.id, qty: 30_000, unitCost: 100 });
  await mv({ date: at(5), type: "PRODUCTION_CONSUME", materialId: sem.id, qty: -8_000 });
  await mv({ date: at(6), type: "PRODUCTION_OUTPUT", productId: plita.id, qty: 16 });
  await mv({ date: at(7), type: "SHIPMENT", productId: plita.id, qty: -10 });
  const cust = await db.customer.create({ data: { name: `QA mijoz ${tag}` } });
  await db.order.create({ data: { orderNo: `QA-T-${tag}`, customerId: cust.id, deliveryDate: at(8), deliveryAddress: "QA", status: "DELIVERED", createdById: U, deliveryFee: 300_000, items: { create: [
    { productId: beton.id, qtyM3: 20, price: 600_000 },
    { productId: plita.id, qtyM3: 10, price: 400_000 },
  ] } } });
  const cat = await db.cashCategory.create({ data: { name: `QA zavod ${tag}`, type: "EXPENSE", pnlLine: "PRODUCTION", inCost: true } });
  const acc = await db.cashAccount.create({ data: { name: `QA Tannarx ${tag}`, type: "CASH" } });
  await db.cashTransaction.create({ data: { type: "EXPENSE", date: at(10), cashAccountId: acc.id, amount: 680_000, category: cat.name, createdById: U } });
  await db.cashTransaction.create({ data: { type: "EXPENSE", date: at(11), cashAccountId: acc.id, amount: 999_000, category: "Bank xizmati", createdById: U } });
  resetCategoryCache();

  section("2. Tannarx hisobi");
  const s = await costSheet(month);
  const vat = s.vatPayer;
  const semIn = vat ? 10_000_000 : 11_200_000;
  check("kelgan xom-ashyo: sement + qum, ehtiyot qism kirmaydi", near(s.arrivedNet, semIn + 3_000_000) && near(s.arrivedGross, 14_200_000), [s.arrivedNet, s.arrivedGross]);
  const g = (n: string) => s.groups.find((x) => x.group === n);
  check("sement normasi: 20 × 300 kg + 10 × (0,5 × 300 + 10) kg = 7 600 kg", near(g("Sement")?.norm, 7_600 * (semIn / 10_000)), g("Sement"));
  check("qum normasi: 20 × 800 + 10 × 400 = 20 000 kg", near(g("Sheben, klinets, qum")?.norm, 2_000_000), g("Sheben, klinets, qum"));
  check("guruh koeffitsiyenti = kelgan ÷ norma", near(g("Sement")?.coef, Math.round((semIn / (7_600 * semIn / 10_000)) * 1000) / 1000, 0.001) && near(g("Sheben, klinets, qum")?.coef, 1.5, 0.001), [g("Sement")?.coef, g("Sheben, klinets, qum")?.coef]);
  const semPrice = semIn / 10_000;
  check("tayyor mahsulot omborida +6 plita × norma materiali", near(s.finishedIncrease, 6 * (160 * semPrice + 400 * 100)), s.finishedIncrease);
  check("xom-ashyo skladi: 0 dan 2 000 kg sement + 30 000 kg qumga oshdi (manfiy)", near(s.rawStockChange, -(2_000 * semPrice + 3_000_000)), s.rawStockChange);
  check("tannarxga kirgan = kelgan − tayyor ko'paygani ± sklad o'zgarishi", near(s.consumed, s.arrivedNet - s.finishedIncrease + s.rawStockChange), s.consumed);
  check("ishlab chiqarish xarajati — faqat «tannarxga kiradi» kategoriya", near(s.overheadTotal, 680_000) && s.overhead.length === 1, s.overhead);
  check("stavka = xarajat ÷ tannarxga kirgan", near(s.overheadPct, Math.round((680_000 / s.consumed) * 1000) / 10, 0.05), s.overheadPct);
  const it = (id: string) => s.items.find((x) => x.productId === id)!;
  const b = it(beton.id), p = it(plita.id);
  check("beton: tannarx = xom-ashyo + ishlab chiq. xarajati, ish haqi 0", b.wage === 0 && near(b.unitCost, b.material! + b.overhead!), b);
  check("beton: xom-ashyo = norma × guruh koeffitsiyentlari", near(b.material, 300 * semPrice * g("Sement")!.coef! + 80_000 * 1.5, 2), b.material);
  check("plita: brigada ish haqi — mahsulot sdelka narxi", p.wage === 50_000 && near(p.unitCost, p.material! + 50_000 + p.overhead!), p);
  check("ishlab chiq. xarajati = xom-ashyo × stavka", near(p.overhead, (p.material! * s.overheadPct) / 100), p.overhead);
  check("sotuv narxi va foyda (1 birlik)", near(b.price, 600_000) && near(b.profit, 600_000 - b.unitCost!), [b.price, b.profit]);
  check("plita ishlab chiqarildi 16, sotildi 10", p.produced === 16 && p.sold === 10, [p.produced, p.sold]);

  section("3. Mahsulot foydasi va qo'lda sozlama");
  const pf = await productProfit(month);
  check("o'tgan oy — koeffitsiyentlar o'z oyidan", pf.params.source === month && !pf.params.manual.coefs.length, pf.params);
  check("tushum = 20 × 600 000 + 10 × 400 000", near(pf.revenue, 16_000_000), pf.revenue);
  check("tannarx = Σ (1 birlik × sotildi)", near(pf.cost, b.unitCost! * 20 + p.unitCost! * 10, 2), pf.cost);
  check("dostavka tushumi alohida (tushumga kirmaydi)", near(pf.delivery, 300_000), pf.delivery);
  await db.costMonth.create({ data: { id: month, coefs: { Sement: 1 }, overheadPct: 0, updatedById: U } });
  const pf2 = await productProfit(month);
  const b2 = pf2.items.find((x) => x.productId === beton.id)!;
  check("qo'lda: sement koeffitsiyenti 1, stavka 0 — beton = norma bo'yicha", near(b2.unitCost, 300 * semPrice + 120_000, 2) && pf2.params.manual.coefs.includes("Sement") && pf2.params.manual.overheadPct, b2);
  await db.costMonth.delete({ where: { id: month } });

  section("4. To'lov kalendari: yangi ustunlar va ta'minotchilar");
  // Kundalik xarajat qatori bo'lsin: o'z kategoriyamizdan 2 kun oldin
  await db.cashTransaction.create({ data: { type: "EXPENSE", date: new Date(Date.now() - 2 * 86_400_000), cashAccountId: acc.id, amount: 300_000, category: cat.name, createdById: U } });
  const c = await cashCalendar();
  check("har kun: natija = kirimlar − barcha chiqimlar", c.days.every((d) => near(d.net, d.inForecast + d.inPromised - d.outSupplier - d.outMandatory - d.outDaily - d.outMaterials - d.outDividend, 0.05)));
  check("yangi xom-ashyo to'lov muddatigacha 0, keyin kunlik o'rtacha", c.days.every((d, i) => near(d.outMaterials, i >= c.termDays ? c.perDayMaterials : 0, 0.01)), [c.termDays, c.perDayMaterials]);
  check("haqiqiy qoldiq yozilsa — boshlang'ich pul o'sha", (await cashCalendar(new Date(), { start: 123_456 })).start === 123_456);
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { cashDailyFlags: true } });
  const row = c.dailyRows.find((x) => x.category === cat.name);
  check("o'z kategoriyamiz kundalik xarajatlarda (sukut: hisobga olinadi, rejaga bog'liq emas)", !!row && !row.off && !row.scaled && row.perDay > 0, row);
  if (row) {
    await db.companySettings.upsert({ where: { id: "main" }, update: { cashDailyFlags: { [row.category]: { off: true } } }, create: { id: "main", cashDailyFlags: { [row.category]: { off: true } } } });
    const c2 = await cashCalendar();
    const r2 = c2.dailyRows.find((x) => x.category === row.category);
    check("«hisobga olinmasin» — qator kalendarga 0", r2?.off === true && r2.perDay === 0 && near(c2.perDayOut, c.perDayOut - row.perDay, 0.05), [r2, c.perDayOut, c2.perDayOut]);
    await db.companySettings.update({ where: { id: "main" }, data: { cashDailyFlags: before?.cashDailyFlags ?? Prisma.DbNull } });
  }
  const sm = await supplierMonth(c);
  check("ta'minotchilar: hozirgi = oy boshi + kelgan − to'langan", sm.every((r) => near(r.now, r.open + r.arrived - r.paid, 2)), sm.filter((r) => !near(r.now, r.open + r.arrived - r.paid, 2)).slice(0, 3));

  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
