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
import { releaseRealizationForTrip, syncRealizationSale } from "@/lib/realization-stock";
import { tripLoaded, revertTripLoad, setTripTtn } from "@/lib/trips";

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

  section("5. Reestr qatori avval, keyin shu TTN bilan reys — sklad ikki marta chiqmaydi");
  const settings = await db.companySettings.findUnique({ where: { id: "main" }, select: { realizationStockFrom: true } });
  const yesterday = new Date(today.getTime() - 86_400_000);
  await db.companySettings.update({ where: { id: "main" }, data: { realizationStockFrom: yesterday } });
  try {
    const grp = await db.productGroup.findFirst({ where: { parentId: null }, select: { id: true } });
    const pk = await db.product.create({ data: { code: `QKT${tag}`, name: `QA KPI plita TTN ${tag}`, unit: "dona", price: 500_000, groupId: grp?.id ?? null } });
    await mv({ date: yesterday, type: "ADJUSTMENT", productId: pk.id, qty: 5 });
    const bal = async () => Number((await db.stockMove.aggregate({ where: { productId: pk.id }, _sum: { qty: true } }))._sum.qty ?? 0);
    const ttn = `QA-${tag}`;
    const entry = await db.realizationEntry.create({ data: { date: today, payGroup: "CASH", customerName: cust.name, productId: pk.id, productName: pk.name, groupName: "", unit: "dona", qty: 2, price: 500_000, ttn, createdById: U } });
    await db.$transaction((tx) => syncRealizationSale(tx, entry.id, entry, U));
    check("reestr qatori skladdan chiqardi: 5 − 2 = 3", near(await bal(), 3, 0.001), await bal());
    const veh = await db.vehicle.findFirst({ select: { id: true } });
    const drv = await db.employee.findFirst({ select: { id: true } });
    const ord = await db.order.create({ data: { orderNo: `QA-KT-${tag}`, customerId: cust.id, deliveryDate: today, deliveryAddress: "QA", status: "IN_PRODUCTION", createdById: U, items: { create: [{ productId: pk.id, qtyM3: 2, price: 500_000 }] } } });
    if (veh && drv) {
      const trip = await db.trip.create({ data: { deliveryNoteNo: `QA-KT-${tag}`, orderId: ord.id, vehicleId: veh.id, driverId: drv.id, qtyM3: 2, status: "LOADED", loadedAt: new Date(), ttn } });
      await mv({ date: new Date(), type: "SHIPMENT", productId: pk.id, qty: -2, refType: "Trip", refId: trip.id }); // reysning o'z jo'natmasi
      check("reys ham chiqardi — vaqtincha ikki marta: 5 − 2 − 2 = 1", near(await bal(), 1, 0.001), await bal());
      const n = await db.$transaction((tx) => releaseRealizationForTrip(tx, trip.id, U));
      check("reys yuklanganda reestr qatorining chiqimi qaytdi: qoldiq 3", n === 1 && near(await bal(), 3, 0.001), { n, bal: await bal() });
      const n2 = await db.$transaction((tx) => releaseRealizationForTrip(tx, trip.id, U));
      check("qayta chaqirilsa hech narsa o'zgarmaydi", n2 === 0 && near(await bal(), 3, 0.001), { n2, bal: await bal() });
    } else check("test bazasida mashina va xodim bor", false);

    section("6. Haqiqiy «Yukladim»: reestr qatori qoldiqni 0 ga tushirgan bo'lsa ham shu TTN'li reys yuklanadi");
    const pk2 = await db.product.create({ data: { code: `QKU${tag}`, name: `QA KPI plita yuklash ${tag}`, unit: "dona", price: 500_000, groupId: grp?.id ?? null } });
    await mv({ date: yesterday, type: "ADJUSTMENT", productId: pk2.id, qty: 2 });
    const bal2 = async () => Number((await db.stockMove.aggregate({ where: { productId: pk2.id }, _sum: { qty: true } }))._sum.qty ?? 0);
    const ttn2 = `7${tag}`; // ttnKey faqat raqam qismini oladi — 5-bo'limdagi TTN bilan to'qnashmasin
    const e2 = await db.realizationEntry.create({ data: { date: today, payGroup: "CASH", customerName: cust.name, productId: pk2.id, productName: pk2.name, groupName: "", unit: "dona", qty: 2, price: 500_000, ttn: ttn2, createdById: U } });
    await db.$transaction((tx) => syncRealizationSale(tx, e2.id, e2, U));
    check("reestr qatori 2 dona chiqardi — qoldiq 0", near(await bal2(), 0, 0.001), await bal2());
    const veh2 = await db.vehicle.create({ data: { plate: `QA${tag}TR`, type: "TRUCK" }, select: { id: true } });
    const drv2 = await db.employee.findFirst({ select: { id: true } });
    if (veh2 && drv2) {
      const ord2 = await db.order.create({ data: { orderNo: `QA-KU-${tag}`, customerId: cust.id, deliveryDate: today, deliveryAddress: "QA", status: "IN_PRODUCTION", onCredit: true, createdById: U, items: { create: [{ productId: pk2.id, qtyM3: 2, price: 500_000 }] } } });
      const tr2 = await db.trip.create({ data: { deliveryNoteNo: `QA-KU-9${tag}`, orderId: ord2.id, vehicleId: veh2.id, driverId: drv2.id, qtyM3: 2, status: "PLANNED", ttn: ttn2 } });
      const lr = await tripLoaded(tr2.id, U);
      check("reys yuklandi (qator chiqimi qaytib, reys chiqardi) — qoldiq 0, ikki marta emas", lr.changed && !lr.error && near(await bal2(), 0, 0.001), { lr, bal: await bal2() });
      const rv = await revertTripLoad(tr2.id, U, "QA sinov");
      const rzOut = Number((await db.stockMove.aggregate({ where: { refType: "RealizationEntry", refId: e2.id }, _sum: { qty: true } }))._sum.qty ?? 0);
      check("yuklash bekor qilindi — reestr qatori skladdan qayta chiqdi (qoldiq 0, qator −2)", rv.changed && near(await bal2(), 0, 0.001) && near(rzOut, -2, 0.001), { rv, bal: await bal2(), rzOut });
      const lr2 = await tripLoaded(tr2.id, U);
      check("qayta yuklandi — qoldiq 0", lr2.changed && near(await bal2(), 0, 0.001), { lr2, bal: await bal2() });
      const st = await setTripTtn(tr2.id, `8${tag}`, U);
      check("reys TTN'i almashdi — eski TTN'li qator skladdan qayta chiqdi (qoldiq −2)", "ok" in st && near(await bal2(), -2, 0.001), { st, bal: await bal2() });

      section("7. TTN raqami bir xil, mahsulot boshqa — qator reysga bog'lanmaydi");
      const pk3 = await db.product.create({ data: { code: `QKV${tag}`, name: `QA KPI kolso TTN ${tag}`, unit: "dona", price: 300_000, groupId: grp?.id ?? null } });
      await mv({ date: yesterday, type: "ADJUSTMENT", productId: pk3.id, qty: 3 });
      const bal3 = async () => Number((await db.stockMove.aggregate({ where: { productId: pk3.id }, _sum: { qty: true } }))._sum.qty ?? 0);
      const e3 = await db.realizationEntry.create({ data: { date: today, payGroup: "CASH", customerName: cust.name, productId: pk3.id, productName: pk3.name, groupName: "", unit: "dona", qty: 2, price: 300_000, ttn: `N-2026-8${tag}`, createdById: U } });
      await db.$transaction((tx) => syncRealizationSale(tx, e3.id, e3, U));
      check("boshqa mahsulotli reysning TTN'i — qator o'zi skladdan chiqardi (qoldiq 1)", near(await bal3(), 1, 0.001), await bal3());
      const n3 = await db.$transaction((tx) => releaseRealizationForTrip(tx, tr2.id, U));
      check("reys boshqa mahsulotli qatorning chiqimini qaytarmaydi", n3 === 0 && near(await bal3(), 1, 0.001), { n3, bal: await bal3() });
    } else check("test bazasida dona tashiydigan mashina va xodim bor", false);
  } finally {
    await db.companySettings.update({ where: { id: "main" }, data: { realizationStockFrom: settings?.realizationStockFrom ?? null } });
  }

  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
