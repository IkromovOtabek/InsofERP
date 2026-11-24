/**
 * QA (C) — ko'rsatkichlar bitta ta'rifda (Sarvar rejasi 1.2) va mahsulot nomi qoidalari (1.1). Server kerak emas,
 * faqat lokal insof_test… bazasi (c-lib tekshiradi). Namunaviy ma'lumot bo'sh oyda (2000-yillar boshidan birinchi bo'sh oy)
 * va qo'lda hisoblangan raqamlar bilan solishtiriladi:
 *  · «10 ta plita sotildi, 1,12 QQS → daromad shuncha»: PNL daromadi = sotuv QQS'siz (boshqa tushum kirmaydi);
 *  · Yalpi foyda: PNL = Tahlil (`grossOf`) — retseptsiz mahsulotga taxminiy tannarx;
 *  · «Aniqlanmagan» manba daromad/ishlab chiqarishga emas, «Manbasi aniqlanmagan» qatoriga tushadi;
 *  · Xomashyo kunlik sarfi «Chiqim»ni ham oladi, Sklad holati va Tahlil zonasi bitta chegarada, zapchast baholanmaydi;
 *  · Bugun → Pul qoldiqlari: har hisob qatori o'zi tekshiriladi;
 *  · nom kaliti (kirill/lotin, «3,5»/«3.5»), papka taxmini, eski nom — boshqa nom.
 *
 *   DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_c npx tsx scripts/qa/c-kpi.ts
 */
import { check, section, done } from "./c-lib";
import { db } from "@/lib/db";
import { resetCategoryCache } from "@/lib/fin-report/categories";
import { pnlReport } from "@/lib/fin-report/pnl";
import { type MonthKey, addMonths, monthStart, monthEnd } from "@/lib/fin-report/period";
import { loadRevenue, grossOf, marginOf } from "@/lib/bi/core";
import { companyVatPayer } from "@/lib/receipt-vat";
import { materialUsage, stockRisk } from "@/lib/material-usage";
import { stockStatus } from "@/lib/production-report";
import { materialOverview, atRiskMaterials } from "@/lib/bi/stock";
import { boshqaruvPaneli } from "@/lib/fin-report/panel";
import { aliasesAfterRename, guessProductGroup, normalizeProductName, productNameKey } from "@/lib/product-name";

const near = (a: number | null | undefined, b: number, eps = 1) => a != null && Math.abs(a - b) <= eps;

async function main() {
  const tag = Date.now() % 1_000_000;
  resetCategoryCache();
  const user = await db.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("test bazasida foydalanuvchi yo'q");
  const U = user.id;
  const vatPayer = await companyVatPayer();

  // Bo'sh oy: sotuv va kassa harakati yo'q
  let month: MonthKey = "2004-01";
  for (let i = 0; i < 120; i++, month = addMonths(month, 1)) {
    const p = await pnlReport([month], "accrual");
    if (!p.parts.sales[0] && !p.parts.otherIncome[0] && !p.parts.prod[0] && !p.parts.unknown[0]) break;
  }
  const at = (day: number) => new Date(monthStart(month).getTime() + (day - 1) * 86_400_000 + 12 * 3_600_000);

  section(`1. Daromad va yalpi foyda (${month}, QQS to'lovchi: ${vatPayer ? "ha" : "yo'q"})`);
  const wh = await db.warehouse.findFirst({ select: { id: true } }) ?? await db.warehouse.create({ data: { name: `QA sklad ${tag}` } });
  const sem = await db.material.create({ data: { code: `QKS${tag}`, name: `QA KPI sement ${tag}`, unit: "kg" } });
  await db.stockMove.create({ data: { warehouseId: wh.id, createdById: U, date: at(1), type: "RECEIPT", materialId: sem.id, qty: 100_000, unitCost: 1_000 } });
  const beton = await db.product.create({ data: { code: `QKB${tag}`, name: `QA KPI beton ${tag}`, unit: "m3", price: 600_000 } });
  const plita = await db.product.create({ data: { code: `QKP${tag}`, name: `QA KPI plita ${tag}`, unit: "m3", price: 1_000_000 } }); // retseptsiz — taxminiy tannarx
  await db.recipe.create({ data: { productId: beton.id, items: { create: [{ materialId: sem.id, qtyPerM3: 300 }] } } }); // 300 kg × 1 000 = 300 000 / m³
  const cust = await db.customer.create({ data: { name: `QA KPI mijoz ${tag}` } });
  // 10 m³ beton × 1 120 000 (QQS bilan) va 10 ta «plita» × 1 120 000 (QQS bilan, retseptsiz)
  await db.order.create({ data: { orderNo: `QA-K-${tag}`, customerId: cust.id, deliveryDate: at(5), deliveryAddress: "QA", status: "DELIVERED", createdById: U, items: { create: [
    { productId: beton.id, qtyM3: 10, price: 1_120_000, nds: true },
    { productId: plita.id, qtyM3: 10, price: 1_120_000, nds: true },
  ] } } });
  // Boshqa tushum 500 000 (metallolom) va import ochgan «Aniqlanmagan» chiqim 700 000
  const acc = await db.cashAccount.findFirst({ where: { isActive: true }, select: { id: true } });
  const other = await db.cashCategory.create({ data: { name: `QA metallolom ${tag}`, type: "INCOME", pnlLine: "OTHER_INCOME" } });
  const unsorted = await db.cashCategory.create({ data: { name: `QA noma'lum ${tag}`, type: "EXPENSE", pnlLine: "UNSORTED", sort: 500 } });
  resetCategoryCache();
  if (acc) {
    await db.cashTransaction.create({ data: { cashAccountId: acc.id, type: "INCOME", amount: 500_000, date: at(6), category: other.name, createdById: U } });
    await db.cashTransaction.create({ data: { cashAccountId: acc.id, type: "EXPENSE", amount: 700_000, date: at(6), category: unsorted.name, createdById: U } });
  }

  const rows = await loadRevenue(monthStart(month), new Date(monthEnd(month).getTime() + 1));
  const p = (await pnlReport([month], "accrual")).parts;
  const v = (k: keyof typeof p) => p[k][0] ?? 0;
  const netPerUnit = vatPayer ? 1_000_000 : 1_120_000;
  check(`10 m³ beton + 10 plita × 1 120 000 → daromad ${netPerUnit * 20} (QQS'siz)`, near(v("sales"), netPerUnit * 20), v("sales"));
  check("Daromadga boshqa tushum kirmaydi (Daromad ≤ sotuv)", near(v("income"), v("sales")) && v("income") <= v("sales") + 1, { income: v("income"), sales: v("sales") });
  check("Boshqa tushum 500 000 alohida qatorda", !acc || near(v("otherIncome"), 500_000), v("otherIncome"));
  check("Tannarx: beton retsept 3 000 000 + plita taxminiy (beton ulushida)", near(v("cogs"), 3_000_000 + netPerUnit * 10 * (300_000 / netPerUnit), 2), { cogs: v("cogs"), est: v("cogsEst") });
  check("Yalpi foyda: PNL = Tahlil (grossOf) — bitta qoida", near(v("gross"), grossOf(rows), 1), { pnl: v("gross"), tahlil: grossOf(rows) });
  check("Marja: yalpi foyda ÷ QQS'siz tushum", near(marginOf(rows), (v("gross") / v("sales")) * 100, 0.01), marginOf(rows));
  check("«Aniqlanmagan» chiqim — «Manbasi aniqlanmagan» qatorida, ishlab chiqarishda emas", !acc || (near(v("unknown"), 700_000) && near(v("prod"), 0)), { unknown: v("unknown"), prod: v("prod") });
  check("Operatsion foyda = yalpi + boshqa tushum − aniqlanmagan", !acc || near(v("operating"), v("gross") + 500_000 - 700_000, 1), v("operating"));

  section("2. Xomashyo kunlik sarfi va xavf darajasi");
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const xom = await db.material.create({ data: { code: `QKX${tag}`, name: `QA KPI klines ${tag}`, unit: "m3", category: "XOMASHYO" } });
  const zap = await db.material.create({ data: { code: `QKZ${tag}`, name: `QA KPI podshipnik ${tag}`, unit: "dona", category: "ZAVOD_ZAPCHAST" } });
  const mv = (d: object) => db.stockMove.create({ data: { warehouseId: wh.id, createdById: U, ...d } as never });
  await mv({ date: new Date(today.getTime() - 2 * 86_400_000), type: "RECEIPT", materialId: xom.id, qty: 100, unitCost: 300_000 });
  await mv({ date: new Date(today.getTime() - 86_400_000), type: "PRODUCTION_CONSUME", materialId: xom.id, qty: -10 });
  await mv({ date: today, type: "ISSUE", materialId: xom.id, qty: -80 }); // «Chiqim» — ilgari Sklad buni sanamasdi
  await mv({ date: new Date(today.getTime() - 2 * 86_400_000), type: "RECEIPT", materialId: zap.id, qty: 1, unitCost: 50_000 });
  await mv({ date: today, type: "ISSUE", materialId: zap.id, qty: -1 });
  const usage = await materialUsage();
  check("Kunlik sarf «Chiqim»ni ham oladi: (10 + 80) ÷ oyna", near(usage.perDay.get(xom.id), 90 / usage.window, 0.001), { perDay: usage.perDay.get(xom.id), window: usage.window });
  const [sk, ov] = await Promise.all([stockStatus(), materialOverview()]);
  const skX = sk.find((m) => m.id === xom.id), ovX = ov.find((m) => m.id === xom.id);
  check("Sklad va Tahlil kunlik sarfi bir xil", !!skX && !!ovX && near(skX.perDay, ovX.perDay, 0.0001), { sklad: skX?.perDay, tahlil: ovX?.perDay });
  check("Sklad darajasi va Tahlil zonasi mos", !!skX && !!ovX && ({ short: "Kritik", low: "Xavfli", ok: ovX.zone === "Ma'lumot yo'q" ? "Ma'lumot yo'q" : "Yaxshi" } as const)[skX.level] === ovX.zone, { sklad: skX?.level, tahlil: ovX?.zone });
  check("Zapchast xavf soniga kirmaydi", (sk.find((m) => m.id === zap.id)?.level ?? "ok") === "ok" && !atRiskMaterials(ov).some((m) => m.id === zap.id));
  check("stockRisk: 2 kunlik zaxira — «short» (3 kun chegarasi)", stockRisk({ days: 2, balance: 10, minStock: 0, short: false, category: "XOMASHYO" }, { critDays: 3, warnDays: 7 }) === "short");
  check("stockRisk: 5 kunlik zaxira — «low» (7 kun chegarasi)", stockRisk({ days: 5, balance: 10, minStock: 0, short: false, category: "XOMASHYO" }, { critDays: 3, warnDays: 7 }) === "low");

  section("3. Bugun → Pul qoldiqlari: har hisob qatori o'zi tekshiriladi");
  const panel = await boshqaruvPaneli();
  const bad = panel.accounts.filter((a) => Math.abs(a.open + a.inMonth - a.outMonth + a.trInMonth - a.trOutMonth - a.balance) >= 0.01);
  check(`oy boshi + kirim − chiqim ± o'tkazma = qoldiq (${panel.accounts.length} hisob)`, bad.length === 0, bad.map((a) => a.name));

  section("4. Mahsulot nomi qoidalari");
  check("«ПК 59-12-8» = «PK 59-12-8»", productNameKey("ПК 59-12-8") === productNameKey("PK 59-12-8"));
  check("«Beton м 350» = «Beton m 350»", productNameKey("Beton м 350") === productNameKey("Beton m 350"));
  check("vergul → nuqta: «Opora sv 950-2,5» → «Opora sv 950-2.5»", normalizeProductName("  Opora  sv 950-2,5 ") === "Opora sv 950-2.5", normalizeProductName("  Opora  sv 950-2,5 "));
  check("«PK 59-12-8» ≠ «PK 59-10-8»", productNameKey("PK 59-12-8") !== productNameKey("PK 59-10-8"));
  check("papka taxmini: PK → Plita, Beton m 250 → Beton, Kolso 1(90) → Kolso, Opora → Opora", guessProductGroup("PK 59-12-8") === "Plita" && guessProductGroup("Beton m 250") === "Beton" && guessProductGroup("Kolso 1(90)") === "Kolso" && guessProductGroup("Opora sv 950-2.5") === "Opora");
  check("«Beton ustun» betonga tushmaydi", guessProductGroup("Beton ustun 2.5 m") === null);
  check("xomashyo nomi → «Xomashyo sotuvi»", guessProductGroup("Sheben", ["Sheben", "Qum"]) === "Xomashyo sotuvi");
  check("eski nom boshqa nom bo'lib qoladi", JSON.stringify(aliasesAfterRename("PK 59-12-8", [], "PK 59-12-8 A 400")) === JSON.stringify(["PK 59-12-8"]));
  check("bo'shliq tuzatishi alias qo'shmaydi", aliasesAfterRename("PK  59-12-8", [], "PK 59-12-8").length === 0);

  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
