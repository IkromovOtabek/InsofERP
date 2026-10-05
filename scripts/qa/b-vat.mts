// QA (B) — kirim QQS'i (NDS 12%): QQS to'lovchisi va to'lovchi bo'lmagan yetkazuvchi, to'lanadigan summa (qarz,
// to'lov qoldig'i), o'rtacha tannarx (korxona QQS to'lovchisi — QQS'siz, aks holda QQS bilan), Kirim QQS reyestri,
// storno, Excel import (narx QQS'siz / "Narxlar QQS bilan" belgisi / "Narx QQS bilan" va "Summa QQS bilan" ustunlari).
// Ishga tushirish: DATABASE_URL=… QA_DB=… QA_BASE=… npx tsx scripts/qa/b-vat.mts (b-all.sh ichida ham)
import { as, check, summary, fd, q, q1, n1, idFrom, token } from "./b-client.mjs";

process.env.DATABASE_URL ??= process.env.QA_DB ?? "postgresql://otabek@localhost:5432/insof_test_b";
const { avgUnitCosts } = await import("../../src/lib/stock");
const { supplierLedger, unpaidReceipts, receiptPayState } = await import("../../src/lib/receipt-payables");
const { inputVatReport } = await import("../../src/lib/receipt-vat");
const { db } = await import("../../src/lib/db");

const RA = "(app)/receipts/actions";
const SET = "(app)/settings/actions";
const wh = q1(`select id from "Warehouse" where "isDefault" limit 1`)!;
const bank = q1(`select id from "CashAccount" where type='BANK' and "isActive" limit 1`)!;
const today = new Date().toISOString().slice(0, 10); // b-receipts bilan bir xil (kirim sanasi — UTC yarim tun = Toshkent 05:00)
const tag = Date.now() % 1_000_000;
const sklad = await as("sklad"), dir = await as("direktor"), buh = await as("buh");
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;
const ps = (id: string) => receiptPayState(db, id);

const setCompanyVat = async (v: "1" | "0") => dir.action(`${SET}#saveVatPayer`, [undefined, fd({ vatPayer: v })], "/settings");
let r = await setCompanyVat("1");
check(r.ok && q1(`select "vatPayer" from "CompanySettings" where id='main'`) === "t", "korxona: QQS to'lovchisi", r.error);
r = await sklad.action(`${SET}#saveVatPayer`, [undefined, fd({ vatPayer: "0" })], "/settings");
check(!r.ok && q1(`select "vatPayer" from "CompanySettings" where id='main'`) === "t", "sklad QQS sozlamasini o'zgartira olmaydi");

try {
  // ── 1) Yetkazuvchilar: QQS to'lovchisi (12%) va to'lovchi emas (0%) ──
  const s12n = `QA QQS MChJ ${tag}`, s0n = `QA QQS'siz YaTT ${tag}`;
  r = await sklad.action("(app)/suppliers/actions#createSupplier", [undefined, fd({ name: s12n, vatPayer: "1" })], "/suppliers");
  check(r.ok, "QQS to'lovchisi yetkazuvchi qo'shildi", r.error);
  r = await sklad.action("(app)/suppliers/actions#createSupplier", [undefined, fd({ name: s0n, vatPayer: "0" })], "/suppliers");
  check(r.ok, "QQS to'lovchisi bo'lmagan yetkazuvchi qo'shildi", r.error);
  const s12 = q1(`select id from "Supplier" where name='${s12n}'`)!, s0 = q1(`select id from "Supplier" where name='${s0n.replace("'", "''")}'`)!;
  check(q1(`select "vatPayer" from "Supplier" where id='${s12}'`) === "t" && q1(`select "vatPayer" from "Supplier" where id='${s0}'`) === "f", "Supplier.vatPayer yozildi (t / f)");

  // ── 2) Excel import — narx QQS'siz (standart): 100 kg × 1 000 + 12% ──
  const matA = `QA QQS xomashyo A ${tag}`;
  const imp = (sup: string, rows: object[], extra: Record<string, string> = {}) =>
    sklad.action(`${RA}#importReceiptFromExcel`, [undefined, fd({ clientToken: token(), supplierId: sup, warehouseId: wh, date: today, rows: JSON.stringify(rows), createMissing: "on", ...extra })], "/receipts/import");
  r = await imp(s12, [{ material: matA, unit: "kg", qty: 100, price: "1 000" }]);
  const rA = idFrom(r.redirect)!;
  check(!!rA, "Excel kirim (narx QQS'siz) yozildi", r.error);
  const line = (id: string) => q(`select price, "vatRate", "vatAmount" from "GoodsReceiptItem" where "receiptId"='${id}'`)[0]?.map(Number) ?? [];
  let [p, rate, vat] = line(rA);
  check(p === 1000 && rate === 12 && vat === 12000, "qator: narx 1 000 (QQS'siz), stavka 12%, QQS 12 000", { p, rate, vat });
  const mA = q1(`select id from "Material" where name='${matA}'`)!;
  check(n1(`select "unitCost" from "StockMove" where "refId"='${rA}'`) === 1000, "sklad tannarxi QQS'siz (korxona QQS to'lovchisi): 1 000");
  const st = await ps(rA);
  check(st?.total === 112000 && st.left === 112000, "to'lanadigan summa QQS bilan: 112 000", st);
  check((await unpaidReceipts()).some((x) => x.id === rA && x.total === 112000), "To'lanmagan kirimlarda 112 000 (QQS bilan)");

  // ── 3) Excel import — narx QQS bilan: belgi, "Narx QQS bilan" ustuni, "Summa QQS bilan" ustuni ──
  r = await imp(s12, [{ material: matA, unit: "kg", qty: 100, price: "1 120" }], { pricesWithVat: "on" });
  const rB = idFrom(r.redirect)!;
  [p, rate, vat] = line(rB);
  check(!!rB && p === 1000 && vat === 12000 && (await ps(rB))?.total === 112000, "«Narxlar QQS bilan»: 1 120 → narx 1 000 + QQS 12 000, jami 112 000", { p, vat, e: r.error });
  r = await imp(s12, [{ material: matA, unit: "kg", qty: 50, priceVat: "1120" }]);
  const rC = idFrom(r.redirect)!;
  [p, rate, vat] = line(rC);
  check(!!rC && p === 1000 && vat === 6000, "«Narx QQS bilan» ustuni: 50 × 1 120 → narx 1 000, QQS 6 000", { p, vat, e: r.error });
  r = await imp(s12, [{ material: matA, unit: "kg", qty: 10, sumVat: "11 200" }]);
  const rD = idFrom(r.redirect)!;
  [p, rate, vat] = line(rD);
  check(!!rD && p === 1000 && vat === 1200 && (await ps(rD))?.total === 11200, "«Summa QQS bilan» ustuni: 11 200 / 10 → narx 1 000, QQS 1 200", { p, vat, e: r.error });
  // Yaxlitlash: 3 × 1 000 (QQS bilan) → jami aynan 3 000 bo'lsin (tiyin yo'qolmasin)
  r = await imp(s12, [{ material: matA, unit: "kg", qty: 3, priceVat: "1000" }]);
  const rE = idFrom(r.redirect)!;
  check(!!rE && (await ps(rE))?.total === 3000, "QQS bilan narxdan ajratish: jami fayldagi summaga tiyinigacha teng (3 000)", await ps(rE));

  // ── 4) QQS to'lovchisi bo'lmagan yetkazuvchi: QQS 0 (formadan 12 kelsa ham) ──
  r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ clientToken: token(), supplierId: s0, warehouseId: wh, date: today, "materialId[]": [mA], "qty[]": [100], "price[]": [1500], "vatRate[]": [12] })], "/receipts/new");
  const rF = idFrom(r.redirect)!;
  [p, rate, vat] = line(rF);
  check(!!rF && p === 1500 && rate === 0 && vat === 0 && (await ps(rF))?.total === 150000, "QQS'siz yetkazuvchi: stavka 0, jami 150 000", { p, rate, vat, e: r.error });
  r = await sklad.action(`${RA}#importReceiptFromExcel`, [undefined, fd({ supplierId: s0, warehouseId: wh, date: today, rows: JSON.stringify([{ material: matA, unit: "kg", qty: 1, price: 1120 }]), pricesWithVat: "on" })], "/receipts/import");
  const rF2 = idFrom(r.redirect)!;
  check(!!rF2 && line(rF2)[0] === 1120 && line(rF2)[2] === 0, "QQS'siz yetkazuvchida «QQS bilan» narx ham o'zgarmaydi (ichida QQS yo'q)", line(rF2));

  // ── 5) Qo'lda kirim: QQS to'lovchisida qator bo'yicha 12% / 0% (QQS'dan ozod), noto'g'ri stavka rad ──
  r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ clientToken: token(), supplierId: s12, warehouseId: wh, date: today, "materialId[]": [mA, mA], "qty[]": [10, 10], "price[]": [2000, 2000], "vatRate[]": [12, 0] })], "/receipts/new");
  const rG = idFrom(r.redirect)!;
  const g = q(`select "vatRate", "vatAmount" from "GoodsReceiptItem" where "receiptId"='${rG}' order by "vatRate"`).map((x) => x.map(Number));
  check(!!rG && g[0]?.[0] === 0 && g[0]?.[1] === 0 && g[1]?.[0] === 12 && g[1]?.[1] === 2400 && (await ps(rG))?.total === 42400, "qator stavkalari 0% va 12%: jami 20 000 + 2 400", { g, e: r.error });
  r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ supplierId: s12, warehouseId: wh, date: today, "materialId[]": [mA], "qty[]": [1], "price[]": [1], "vatRate[]": [15] })], "/receipts/new");
  check(/QQS/.test(r.error ?? ""), "15% stavka rad etildi", r.error);
  // Stavka berilmasa — yetkazuvchidan (eski formalar/mobil)
  r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ clientToken: token(), supplierId: s12, warehouseId: wh, date: today, "materialId[]": [mA], "qty[]": [5], "price[]": [1000] })], "/receipts/new");
  const rH = idFrom(r.redirect)!;
  check(!!rH && line(rH)[1] === 12 && line(rH)[2] === 600, "stavka berilmasa yetkazuvchidan: 12%", line(rH));

  // ── 6) O'rtacha tannarx — QQS'siz (korxona QQS to'lovchisi) ──
  const exp = n1(`select sum(qty*"unitCost")/sum(qty) from "StockMove" where "materialId"='${mA}' and type='RECEIPT'`);
  const base = n1(`select sum(gi.qty*gi.price)/sum(gi.qty) from "GoodsReceiptItem" gi join "GoodsReceipt" g on g.id=gi."receiptId" where gi."materialId"='${mA}' and g."cancelledAt" is null`);
  const avgA = (await avgUnitCosts([mA])).get(mA)!;
  check(near(avgA, exp) && near(avgA, base), `o'rtacha tannarx QQS'siz narxlardan: ${avgA.toFixed(2)}`, { avgA, exp, base });

  // ── 7) Yetkazuvchi qarzi va to'lov — QQS bilan ──
  const led = await supplierLedger(s12);
  // rA + rB + rC + rD + rE + rG + rH (hammasi QQS bilan)
  const expDebt = 112000 + 112000 + 56000 + 11200 + 3000 + 42400 + 5600;
  check(near(led.debt, expDebt) && near(led.received, expDebt), `yetkazuvchi qarzi QQS bilan: ${led.debt} = ${expDebt}`, led);
  check(near((await supplierLedger(s0)).debt, 150000 + 1120), "QQS'siz yetkazuvchi qarzi: 151 120");
  r = await buh.action("(app)/cashflow/actions#payReceipt", [rA, undefined, fd({ cashAccountId: bank })], "/cashflow");
  const paid = n1(`select coalesce(sum(amount),0) from "CashTransaction" where "refId"='${rA}' and type='EXPENSE'`);
  check(!r.error && paid === 112000 && (await ps(rA))?.left === 0, "moliya kirimni to'ladi: chiqim 112 000 (QQS bilan), qoldiq 0", { e: r.error, paid });
  check(near((await supplierLedger(s12)).debt, expDebt - 112000), "to'lovdan keyin qarz 112 000 ga kamaydi");

  // ── 8) Kirim QQS reyestri ──
  const from = new Date(`${today}T00:00:00+05:00`), to = new Date(from.getTime() + 86_400_000);
  let rep = await inputVatReport(from, to);
  let r12 = rep.suppliers.find((x) => x.key === s12);
  const r0 = rep.suppliers.find((x) => x.key === s0);
  const vat12 = 12000 + 12000 + 6000 + 1200 + n1(`select "vatAmount" from "GoodsReceiptItem" where "receiptId"='${rE}'`) + 2400 + 600;
  check(!!r12 && near(r12.vat, vat12) && near(r12.total, expDebt) && r12.docs === 7, `reyestr: QQS to'lovchisi — QQS ${r12?.vat}, jami ${r12?.total}`, r12);
  check(!!r0 && r0.vat === 0 && near(r0.base, 151120), "reyestr: QQS'siz yetkazuvchi — QQS 0", r0);
  check(rep.months.some((m) => m.key === today.slice(0, 7)) && near(rep.totals.total, rep.totals.base + rep.totals.vat), "reyestr: oy kesimi va jami = QQS'siz + QQS");
  let page = await dir.get(`/kirim-qqs?from=${today}&to=${today}`);
  check(page.status === 200 && page.text.includes(s12n), "/kirim-qqs — direktor ko'radi", page.status);
  page = await buh.get("/kirim-qqs");
  check(page.status === 200, "/kirim-qqs — buxgalteriya ko'radi", page.status);
  page = await sklad.get("/kirim-qqs");
  check(page.status !== 200 || !page.text.includes("Kirim QQS reyestri"), "/kirim-qqs — sklad uchun yopiq", page.status);

  // ── 9) Storno — aynan shu summalar (QQS bilan) qaytadi ──
  const debtBefore = (await supplierLedger(s12)).debt;
  r = await dir.action(`${RA}#stornoReceipt`, [rB, "QA: QQS storno"], `/receipts/${rB}`);
  check(r.ok, "QQS li kirim storno qilindi", r.error);
  check(near(debtBefore - (await supplierLedger(s12)).debt, 112000), "storno: qarz 112 000 (QQS bilan) ga kamaydi");
  check(n1(`select "unitCost" from "StockMove" where "refId"='${rB}' and qty<0`) === 1000, "teskari harakat o'sha tannarx bilan (1 000)");
  const aud = q1(`select after::text from "AuditLog" where entity='GoodsReceipt' and "entityId"='${rB}' and action='STATUS_CHANGE' order by "createdAt" desc limit 1`) ?? "";
  check(/"vat": ?12000/.test(aud) && /"total": ?112000/.test(aud), "storno auditida QQS va jami", aud.slice(0, 200));
  rep = await inputVatReport(from, to);
  r12 = rep.suppliers.find((x) => x.key === s12);
  check(!!r12 && near(r12.vat, vat12 - 12000) && r12.docs === 6, "storno qilingan kirim reyestrdan chiqdi (QQS −12 000)", r12);
  const withoutB = n1(`select sum(qty*"unitCost")/sum(qty) from "StockMove" where "materialId"='${mA}' and type='RECEIPT' and "refId"<>'${rB}'`);
  check(near((await avgUnitCosts([mA])).get(mA)!, withoutB), "storno o'rtacha tannarxdan aynan chiqdi", { withoutB });
  r = await dir.action(`${RA}#stornoReceipt`, [rF, "QA: QQS'siz storno"], `/receipts/${rF}`);
  check(r.ok && near((await supplierLedger(s0)).debt, 1120), "QQS'siz kirim stornosi: qarz 150 000 ga kamaydi", r.error);

  // ── 10) Korxona QQS to'lovchisi emas — tannarx QQS bilan ──
  r = await setCompanyVat("0");
  check(r.ok && q1(`select "vatPayer" from "CompanySettings" where id='main'`) === "f", "korxona: QQS to'lovchisi emas", r.error);
  const matB = `QA QQS xomashyo B ${tag}`;
  r = await imp(s12, [{ material: matB, unit: "kg", qty: 10, price: 1000 }]);
  const rI = idFrom(r.redirect)!;
  const mB = q1(`select id from "Material" where name='${matB}'`)!;
  check(!!rI && n1(`select "unitCost" from "StockMove" where "refId"='${rI}'`) === 1120, "tannarx QQS bilan: 1 000 + 12% = 1 120", r.error);
  check(near((await avgUnitCosts([mB])).get(mB)!, 1120), "o'rtacha tannarx QQS bilan: 1 120");
  check((await ps(rI))?.total === 11200, "to'lanadigan summa o'zgarmaydi: 11 200");
  r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ clientToken: token(), supplierId: s0, warehouseId: wh, date: today, "materialId[]": [mB], "qty[]": [10], "price[]": [1000] })], "/receipts/new");
  const rJ = idFrom(r.redirect)!;
  check(!!rJ && n1(`select "unitCost" from "StockMove" where "refId"='${rJ}'`) === 1000, "QQS'siz yetkazuvchidan — tannarx 1 000 (QQS yo'q)", r.error);
  check(near((await avgUnitCosts([mB])).get(mB)!, 1060), "o'rtacha (1 120 + 1 000) / 2 = 1 060");

  // ── 11) Yetkazuvchi kartasida QQS belgisini o'zgartirish ──
  r = await sklad.action("(app)/suppliers/actions#updateSupplier", [s12, undefined, fd({ name: s12n, vatPayer: "0" })], `/suppliers/${s12}`);
  check(r.ok && q1(`select "vatPayer" from "Supplier" where id='${s12}'`) === "f", "yetkazuvchi QQS to'lovchisi emas deb belgilandi", r.error);
  r = await sklad.action("(app)/suppliers/actions#updateSupplier", [s12, undefined, fd({ name: s12n })], `/suppliers/${s12}`);
  check(r.ok && q1(`select "vatPayer" from "Supplier" where id='${s12}'`) === "f", "vatPayer berilmasa o'zgarmaydi", r.error);
  page = await dir.get(`/receipts/${rA}`);
  check(page.status === 200 && /QQS/.test(page.text) && page.text.includes("112"), "kirim sahifasida QQS'siz / QQS / jami", page.status);
} finally {
  // Boshqa skriptlar uchun standart holat
  await setCompanyVat("1");
}

await db.$disconnect();
summary("b-vat");
process.exit();
