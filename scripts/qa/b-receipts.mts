// QA (B) — kirim: qo'lda (ikki marta yuborish kaliti, tarozi), Excel import (haqiqiy .xlsx, kirill, "1 250,5", yomon qatorlar),
// o'rtacha tannarx, storno (qoldiq/qarz/to'lov), yetkazuvchi qarzi, inventarizatsiya va spisanie.
// Ishga tushirish: DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_b npx tsx scripts/qa/b-receipts.mts
import * as XLSX from "xlsx";
import { as, check, summary, fd, q, q1, n1, idFrom, token } from "./b-client.mjs";
import { headerRowIndex, guessColumn, trimEmptyRows, str, FIELD_SYNONYMS } from "../../src/lib/excel";

process.env.DATABASE_URL ??= "postgresql://otabek@localhost:5432/insof_test_b";
const { avgUnitCosts } = await import("../../src/lib/stock");
const { supplierLedger } = await import("../../src/lib/receipt-payables");

const RA = "(app)/receipts/actions";
const wh = q1(`select id from "Warehouse" where "isDefault" limit 1`)!;
const cem = q1(`select id from "Material" where code='CEM'`)!;
const add = q1(`select id from "Material" where code='ADD'`)!;
const sup = q1(`select id from "Supplier" where "isActive" order by name desc limit 1`)!;
const bal = (mid: string, w = wh) => n1(`select coalesce(sum(qty),0) from "StockMove" where "materialId"='${mid}' and "warehouseId"='${w}'`);
const today = new Date().toISOString().slice(0, 10);
const sklad = await as("sklad"), dir = await as("direktor"), snab = await as("snab");

// ── 1) Qo'lda kirim + ikki marta yuborish ──
const tok = token();
const form = () => fd({ clientToken: tok, supplierId: sup, warehouseId: wh, date: today, "materialId[]": [cem, add], "qty[]": [10000, 50], "price[]": [1000, 25000], waybillNo: "QA-1", vehicle: "01a123bc", gross: "32 500", tare: "12300,5" });
const cem0 = bal(cem);
let r = await sklad.action(`${RA}#createReceipt`, [undefined, form()], "/receipts/new");
const rid = idFrom(r.redirect)!;
check(!!rid, "sklad qo'lda kirim qildi", r.error ?? r.text.slice(0, 200));
r = await sklad.action(`${RA}#createReceipt`, [undefined, form()], "/receipts/new");
check(idFrom(r.redirect) === rid, "ikkinchi yuborish o'sha kirimga qaytdi (dublikat yo'q)", r.redirect);
// Bir vaqtda ikki so'rov
const tok2 = token();
const f2 = () => fd({ clientToken: tok2, supplierId: sup, warehouseId: wh, date: today, "materialId[]": [cem], "qty[]": [1], "price[]": [1000] });
const both = await Promise.all([sklad.action(`${RA}#createReceipt`, [undefined, f2()], "/receipts/new"), sklad.action(`${RA}#createReceipt`, [undefined, f2()], "/receipts/new")]);
check(n1(`select count(*) from "GoodsReceipt" where "clientToken"='${tok2}'`) === 1 && idFrom(both[0].redirect) === idFrom(both[1].redirect), "parallel ikki yuborish — bitta kirim", both.map((b) => b.redirect ?? b.error));
check(Math.abs(bal(cem) - cem0 - 10001) < 0.001, "sement qoldig'i +10 001 kg", bal(cem) - cem0);
const note = q1(`select note from "GoodsReceipt" where id='${rid}'`);
check(/netto 20199\.5 kg/.test(note ?? "") && /01A123BC/.test(note ?? ""), "tarozi va mashina izohga yozildi", note);
r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ supplierId: sup, warehouseId: wh, date: today, "materialId[]": [cem], "qty[]": [1], "price[]": [1], gross: "100", tare: "200" })], "/receipts/new");
check(/Tara/.test(r.error ?? ""), "tara > brutto rad etildi", r.error);
r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ supplierId: sup, warehouseId: wh, date: "2099-01-01", "materialId[]": [cem], "qty[]": [1], "price[]": [1] })], "/receipts/new");
check(/Sana/.test(r.error ?? ""), "kelajak sana rad etildi", r.error);
r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ supplierId: sup, warehouseId: wh, date: today, "materialId[]": [cem], "qty[]": [-5], "price[]": [1] })], "/receipts/new");
check(!!r.error, "manfiy miqdor rad etildi", r.error);
// Sklad pul hisobini tanlasa ham to'lov yozilmaydi (faqat direktor)
const cash = q1(`select id from "CashAccount" where type='BANK' limit 1`)!;
r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ supplierId: sup, warehouseId: wh, date: today, cashAccountId: cash, "materialId[]": [add], "qty[]": [1], "price[]": [100] })], "/receipts/new");
const rNoPay = idFrom(r.redirect)!;
check(n1(`select count(*) from "CashTransaction" where "refId"='${rNoPay}'`) === 0, "sklad kirimida to'lov yozilmadi (moliyaga qoladi)");

// ── 2) O'rtacha tannarx va storno ──
const before = (await avgUnitCosts([cem])).get(cem)!;
const expect = (extra: string) => n1(`select sum(qty*"unitCost")/nullif(sum(qty),0) from "StockMove" where "materialId"='${cem}' and type='RECEIPT' and "unitCost" is not null ${extra}`);
check(Math.abs(before - expect("")) < 0.01, `o'rtacha tannarx miqdorga tortilgan: ${before.toFixed(2)}`, expect(""));
const tok3 = token();
r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ clientToken: tok3, supplierId: sup, warehouseId: wh, date: today, "materialId[]": [cem], "qty[]": [5000], "price[]": [5000] })], "/receipts/new");
const rExp = idFrom(r.redirect)!;
const mid = (await avgUnitCosts([cem])).get(cem)!;
check(mid > before, `qimmat kirimdan keyin o'rtacha oshdi: ${mid.toFixed(2)}`);
const debt0 = (await supplierLedger(sup)).debt;
// storno: sklad qila olmaydi
r = await sklad.action(`${RA}#stornoReceipt`, [rExp, "xato kiritildi"], `/receipts/${rExp}`);
check(!r.ok, "sklad storno qila olmaydi (faqat direktor)");
r = await dir.action(`${RA}#stornoReceipt`, [rExp, "x"], `/receipts/${rExp}`);
check(/sabab/i.test(r.error ?? ""), "storno sababi majburiy", r.error);
const cemB = bal(cem);
r = await dir.action(`${RA}#stornoReceipt`, [rExp, "QA: narx xato"], `/receipts/${rExp}`);
check(r.ok, "direktor kirimni storno qildi", r.error);
check(Math.abs(bal(cem) - (cemB - 5000)) < 0.001, "storno: sement −5000 kg", bal(cem) - cemB);
const after = (await avgUnitCosts([cem])).get(cem)!;
check(Math.abs(after - before) < 0.01, `storno o'rtachani avvalgi holatga qaytardi: ${after.toFixed(2)} = ${before.toFixed(2)}`);
const debt1 = (await supplierLedger(sup)).debt;
// QQS (20261005): yetkazuvchi QQS to'lovchisi — kirim 5000 × 5000 = 25 mln + 12% QQS = 28 mln qarz edi, storno shuncha kamaytiradi
check(Math.abs(debt0 - debt1 - 28_000_000) < 1, `yetkazuvchi qarzi 28 mln (25 mln + QQS 3 mln) ga kamaydi (${debt0} → ${debt1})`);
r = await dir.action(`${RA}#stornoReceipt`, [rExp, "QA: yana"], `/receipts/${rExp}`);
check(/allaqachon/.test(r.error ?? ""), "qayta storno rad etildi", r.error);
let page = await dir.get(`/receipts/${rExp}`);
check(page.status === 200 && /Storno/.test(page.text), "kirim sahifasida Storno belgisi");
page = await dir.get(`/receipts`);
check(page.status === 200, "/receipts ro'yxat");

// Storno — sarflangan xomashyo: qo'shimcha (ADD) kirimi → hammasini hisobdan chiqaramiz → storno rad
const addBal = bal(add);
const tok4 = token();
r = await sklad.action(`${RA}#createReceipt`, [undefined, fd({ clientToken: tok4, supplierId: sup, warehouseId: wh, date: today, "materialId[]": [add], "qty[]": [7], "price[]": [30000] })], "/receipts/new");
const rAdd = idFrom(r.redirect)!;
r = await sklad.action("(app)/stock/adjust-actions#saveWriteOff", [undefined, fd({ warehouseId: wh, kind: "Brak (sifatsiz)", note: "QA", rows: JSON.stringify([{ materialId: add, qty: addBal + 7 }]) })], "/stock/spisanie");
check(r.ok && Math.abs(bal(add)) < 0.001, "spisanie: qo'shimcha qoldig'i 0 ga tushdi", r.error ?? bal(add));
r = await sklad.action("(app)/stock/adjust-actions#saveWriteOff", [undefined, fd({ warehouseId: wh, kind: "Brak (sifatsiz)", note: "QA", rows: JSON.stringify([{ materialId: add, qty: 1 }]) })], "/stock/spisanie");
check(!r.ok, "qoldiqdan ko'p spisanie rad etildi", r.error);
r = await dir.action(`${RA}#stornoReceipt`, [rAdd, "QA: sarflangan"], `/receipts/${rAdd}`);
check(/minusga/.test(r.error ?? ""), "sarflangan kirim storno rad etildi (qoldiq minusga tushadi)", r.error);

// To'langan kirim storno rad etiladi: direktor kirim+to'lov (bank)
const tok5 = token();
r = await dir.action(`${RA}#createReceipt`, [undefined, fd({ clientToken: tok5, supplierId: sup, warehouseId: wh, date: today, cashAccountId: cash, "materialId[]": [cem], "qty[]": [100], "price[]": [1000] })], "/receipts/new");
const rPaid = idFrom(r.redirect)!;
check(n1(`select count(*) from "CashTransaction" where "refId"='${rPaid}'`) === 1, "direktor kirimi to'lov bilan yozildi", r.error);
r = await dir.action(`${RA}#stornoReceipt`, [rPaid, "QA: to'langan"], `/receipts/${rPaid}`);
check(/to'lov/.test(r.error ?? ""), "to'lov bog'langan kirim storno rad etildi", r.error);

// ── 3) Excel import — haqiqiy .xlsx (kirill sarlavha, "1 250,5", yomon qatorlar) ──
const newName = `Elektrod QA ${Date.now() % 100000}`;
const aoa = [
  ["Накладная № 77 от 05.10.2026"],
  [],
  ["№", "Наименование", "Ед. изм", "Кол-во", "Цена", "Сумма", "НДС"],
  [1, "Sement M400", "т", "1 250,5", "1 100 000", "", ""],
  [2, "Qum", "кг", 2000, 90, 180000, 21600],
  [3, newName, "кг", "12,5", "35 000", "", ""],
  [4, "Итого", "", "", "", "", ""],
];
const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Лист1");
const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
// Brauzerdagi `ExcelImport.onFile` + `applyList` bilan bir xil o'qish
const wb2 = XLSX.read(buf, { type: "array", raw: true });
const sheet = trimEmptyRows(XLSX.utils.sheet_to_json<unknown[]>(wb2.Sheets[wb2.SheetNames[0]], { header: 1, defval: "", raw: true }));
const hi = headerRowIndex(sheet);
const hdr = sheet[hi].map((c, i) => str(c) || `Ustun ${i + 1}`);
check(hdr.includes("Наименование"), "sarlavha qatori topildi (tepadagi nom qatori o'tkazildi)", hdr);
const data = sheet.slice(hi + 1).filter((row) => row.some((c) => str(c) !== "")).map((row) => Object.fromEntries(hdr.map((h, i) => [h, row[i] ?? ""])));
const taken = new Set<string>(); const map: Record<string, string> = {};
for (const [key, syn] of [["material", FIELD_SYNONYMS.material], ["unit", FIELD_SYNONYMS.unit], ["qty", FIELD_SYNONYMS.qty], ["price", FIELD_SYNONYMS.price], ["nds", FIELD_SYNONYMS.nds], ["sum", FIELD_SYNONYMS.sum]] as const) {
  const g = guessColumn(hdr, syn, taken); if (g) { map[key] = g; taken.add(g); }
}
check(map.material === "Наименование" && map.qty === "Кол-во" && map.unit === "Ед. изм", "ustunlar kirill sarlavhadan taxmin qilindi", map);
const rows = data.map((d) => Object.fromEntries(Object.entries(map).map(([k, h]) => [k, d[h]])));
// "Итого" qatori — miqdori yo'q: server rad etadi (brauzer uni "muammoli" deb ko'rsatadi)
r = await sklad.action(`${RA}#importReceiptFromExcel`, [undefined, fd({ supplierId: sup, warehouseId: wh, date: today, rows: JSON.stringify(rows), createMissing: "on" })], "/receipts/import");
check(/4-qator.*miqdor/.test(r.error ?? ""), "yomon qator (Итого) aniq xato bilan rad etildi", r.error);
const good = rows.filter((x) => str(x.qty) !== "");
const cemI = bal(cem);
r = await sklad.action(`${RA}#importReceiptFromExcel`, [undefined, fd({ supplierId: sup, warehouseId: wh, date: today, rows: JSON.stringify(good) })], "/receipts/import");
check(/yo'q/.test(r.error ?? "") && r.error!.includes(newName), "yangi xomashyo createMissingsiz rad etildi", r.error);
r = await sklad.action(`${RA}#importReceiptFromExcel`, [undefined, fd({ supplierId: sup, warehouseId: wh, date: today, rows: JSON.stringify(good), createMissing: "on" })], "/receipts/import");
const rImp = idFrom(r.redirect);
check(!!rImp, "Excel kirim yozildi", r.error ?? r.text.slice(0, 200));
check(Math.abs(bal(cem) - cemI - 1_250_500) < 0.01, "1 250,5 t → +1 250 500 kg sement", bal(cem) - cemI);
const cemPrice = n1(`select price from "GoodsReceiptItem" where "receiptId"='${rImp}' and "materialId"='${cem}'`);
check(Math.abs(cemPrice - 1100) < 0.01, "narx t → kg o'girildi: 1 100 so'm/kg", cemPrice);
const nm = q(`select m.unit, gi.qty, gi.price from "GoodsReceiptItem" gi join "Material" m on m.id=gi."materialId" where gi."receiptId"='${rImp}' and m.name='${newName}'`)[0];
check(nm && nm[0] === "kg" && Number(nm[1]) === 12.5 && Number(nm[2]) === 35000, "yangi xomashyo kg, 12,5 × 35 000", nm);
// Narx ustuni yo'q, faqat summa bor — narx summa/miqdordan chiqishi kerak (aks holda tannarx 0)
r = await sklad.action(`${RA}#importReceiptFromExcel`, [undefined, fd({ supplierId: sup, warehouseId: wh, date: today, rows: JSON.stringify([{ material: "Qum", unit: "kg", qty: "1 000", sum: "95 000" }]) })], "/receipts/import");
const rSum = idFrom(r.redirect);
check(!!rSum && Math.abs(n1(`select price from "GoodsReceiptItem" where "receiptId"='${rSum}'`) - 95) < 0.01, "narxsiz qatorda narx = summa / miqdor (95)", r.error ?? n1(`select price from "GoodsReceiptItem" where "receiptId"='${rSum}'`));
// Ikki marta yuborilgan import — bitta kirim (clientToken)
const tok6 = token();
const imp = () => fd({ clientToken: tok6, supplierId: sup, warehouseId: wh, date: today, rows: JSON.stringify([{ material: "Qum", unit: "kg", qty: 10, price: 90 }]) });
const two = await Promise.all([sklad.action(`${RA}#importReceiptFromExcel`, [undefined, imp()], "/receipts/import"), sklad.action(`${RA}#importReceiptFromExcel`, [undefined, imp()], "/receipts/import")]);
check(n1(`select count(*) from "GoodsReceipt" where "clientToken"='${tok6}'`) === 1, "Excel importni ikki marta yuborish — bitta kirim", two.map((x) => x.redirect ?? x.error));

// ── 4) Inventarizatsiya ──
const sand = q1(`select id from "Material" where code='SAND'`)!;
const sb = bal(sand);
r = await sklad.action("(app)/stock/adjust-actions#saveInventory", [undefined, fd({ warehouseId: wh, reason: "QA sanoq", rows: JSON.stringify([{ materialId: sand, book: sb + 5, actual: sb }]) })], "/stock/inventarizatsiya");
check(/o'zgardi/.test(r.error ?? ""), "eskirgan hisob qoldig'i rad etildi", r.error);
r = await sklad.action("(app)/stock/adjust-actions#saveInventory", [undefined, fd({ warehouseId: wh, reason: "QA sanoq", rows: JSON.stringify([{ materialId: sand, book: sb, actual: sb - 123.5 }]) })], "/stock/inventarizatsiya");
check(r.ok && Math.abs(bal(sand) - (sb - 123.5)) < 0.001, "inventarizatsiya: qum −123,5", r.error ?? bal(sand) - sb);
r = await sklad.action("(app)/stock/adjust-actions#saveInventory", [undefined, fd({ warehouseId: wh, reason: "QA", rows: JSON.stringify([{ materialId: sand, book: bal(sand), actual: -1 }]) })], "/stock/inventarizatsiya");
check(!!r.error, "manfiy haqiqiy qoldiq rad etildi", r.error);
r = await snab.action("(app)/stock/adjust-actions#saveInventory", [undefined, fd({ warehouseId: wh, reason: "QA", rows: JSON.stringify([{ materialId: sand, book: bal(sand), actual: 1 }]) })], "/stock/inventarizatsiya");
check(!r.ok, "snab inventarizatsiya qila olmaydi");

summary("b-receipts");
process.exit();
