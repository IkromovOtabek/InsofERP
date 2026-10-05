// Excel importlari — HAQIQIY .xlsx fayllar bilan: mijozlar, yetkazuvchilar (1000 qator ham), boshlang'ich qoldiqlarning
// 4 turi. Fayl `xlsx` paketi bilan yoziladi, brauzerdagi `ExcelImport` kabi o'qiladi (raw, sarlavha qatori, sinonimlar),
// so'ng server action'ga yuboriladi. Yomon qatorlar: bo'sh nom, manfiy, raqam o'rniga matn, takroriy INN, kirill nomlar,
// "1 250 000,50" kabi raqamlar. Kutilgan natija: xato qator raqami bilan, yaxshi qatorlar yoziladi, yarim yozuv yo'q.
// Ishga tushirish: npx tsx scripts/qa/excel-imports.mts  (README.md ga qarang)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { guessColumn, headerRowIndex, str, trimEmptyRows, type ImportField } from "../../src/lib/excel";
import { PARTY_FIELDS } from "../../src/lib/party-fields";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { Client, fd, check, eq2, summary } from "./client.mjs";
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { q, q1, lit } from "./db.mjs";

const T = Date.now().toString(36).slice(-5);
const today = new Date().toISOString().slice(0, 10);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "insof-qa-xlsx-"));

/** Haqiqiy .xlsx yoziladi va brauzerdagidek qaytadan o'qiladi → server kutadigan `rows` JSON. */
function xlsxRows(name: string, header: string[], data: unknown[][], fields: ImportField[]): Record<string, unknown>[] {
  const file = path.join(DIR, `${name}.xlsx`);
  const ws = XLSX.utils.aoa_to_sheet([["Hisobot: QA test fayli"], header, ...data]); // tepada nom qatori (sarlavha emas)
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Varaq1");
  fs.writeFileSync(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const rb = XLSX.read(fs.readFileSync(file), { type: "buffer", raw: true });
  const aoa = trimEmptyRows(XLSX.utils.sheet_to_json<unknown[]>(rb.Sheets[rb.SheetNames[0]], { header: 1, defval: "", raw: true }));
  const hi = headerRowIndex(aoa);
  const hdr = aoa[hi].map((c, i) => str(c) || `Ustun ${i + 1}`);
  const taken = new Set<string>(); const map: Record<string, string> = {};
  for (const f of fields) { const g = guessColumn(hdr, f.synonyms, taken); if (g) { map[f.key] = g; taken.add(g); } }
  const rows = aoa.slice(hi + 1).filter((r) => r.some((c) => str(c) !== "")).map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i] ?? ""])));
  return rows.map((r) => Object.fromEntries(fields.map((f) => [f.key, map[f.key] ? r[map[f.key]] : ""])));
}
const CUST_FIELDS: ImportField[] = [...PARTY_FIELDS, { key: "creditLimit", label: "Kredit limit", synonyms: ["limit", "лимит", "kredit", "кредит"] }];
const OPEN_FIELDS: Record<string, ImportField[]> = {
  PARTY: [
    { key: "name", label: "Nomi", synonyms: ["mijoz", "yetkazuvchi", "контрагент", "nomi", "наимен", "name"] },
    { key: "inn", label: "INN", synonyms: ["инн", "inn", "стир"] },
    { key: "amount", label: "Summa", synonyms: ["qarz", "долг", "сальдо", "summa", "сумма"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "примеч"] },
  ],
  CASH: [
    { key: "name", label: "Hisob", synonyms: ["hisob", "kassa", "касса", "bank", "nomi"] },
    { key: "amount", label: "Qoldiq", synonyms: ["qoldiq", "остаток", "summa"] },
    { key: "note", label: "Izoh", synonyms: ["izoh"] },
  ],
  STOCK: [
    { key: "name", label: "Mahsulot", synonyms: ["mahsulot", "товар", "kod", "nomi"] },
    { key: "warehouse", label: "Sklad", synonyms: ["sklad", "склад"] },
    { key: "qty", label: "Miqdor", synonyms: ["miqdor", "кол", "qty"] },
    { key: "unitCost", label: "Tannarx", synonyms: ["tannarx", "себестоим", "narx"] },
  ],
};
const count = (sql: string) => Number(q1(`select count(*)::int as n from (${sql}) x`).n);

const buh = new Client("buh"), sotuv = new Client("sotuv"), sklad = new Client("sklad"), dir = new Client("direktor"), fin = new Client("finance");
await Promise.all([buh.login("test.buh"), sotuv.login("test.sotuv"), sklad.login("test.sklad"), dir.login("test.direktor"), fin.login("test.finance")]);
const importCustomers = (c: typeof buh, rows: unknown[], update = false) =>
  c.action("customers/actions#importCustomersFromExcel", [undefined, fd({ rows: JSON.stringify(rows), ...(update ? { updateExisting: "on" } : {}) })], "/customers/import");
const importSuppliers = (rows: unknown[]) =>
  sklad.action("suppliers/actions#importSuppliersFromExcel", [undefined, fd({ rows: JSON.stringify(rows) })], "/suppliers/import");
const importOpen = (kind: string, rows: unknown[], extra: Record<string, string> = {}) =>
  buh.action("settings/boshlangich-qoldiq/actions#importOpeningsAction", [kind, undefined, fd({ rows: JSON.stringify(rows), date: today, ...extra })], "/settings/boshlangich-qoldiq");

// ───────── 1. Mijozlar ─────────
console.log("\n1. Mijozlar importi");
const inn = (n: number) => `3${T.replace(/\D/g, "").padEnd(3, "7").slice(0, 3)}${String(n).padStart(5, "0")}`; // 9 xonali, test bo'yicha noyob
const custHeader = ["Наименование", "ИНН", "Телефон", "Адрес", "Контакт", "Кредит лимит"];
const good = [
  [`ООО «Тест Курилиш» ${T}`, inn(1), "+998 90 111 22 33", "Тошкент", "Иванов И.", "1 250 000,50"],
  [`"QA Lotin MCHJ" ${T}`, inn(2), "", "Chilonzor", "", 5000000],
  [`ООО «Тест Курилиш» ${T}`, inn(1), "", "", "", ""], // fayl ichida takror INN — bitta karta
];
const bad = [
  ["", inn(9), "+998901112299", "", "", ""], // nom yo'q
  [`Manfiy limit ${T}`, inn(3), "", "", "", "-5"],
  [`Matn limit ${T}`, inn(4), "", "", "", "abc"],
  [`Qisqa INN ${T}`, "12345", "", "", "", ""],
];
const before = count(`select id from "Customer"`);
let r = await importCustomers(buh, xlsxRows("mijoz-xato", custHeader, [...good, ...bad], CUST_FIELDS));
const err = r.result?.error ?? "";
check("1.1 yomon fayl rad etildi, xatolar qator raqami bilan", /4 ta qatorda xato/.test(err) && /4-qator: nomi yo'q/.test(err) && /5-qator/.test(err) && /6-qator/.test(err) && /7-qator.*INN/.test(err), err);
check("1.2 hech narsa yozilmadi", count(`select id from "Customer"`) === before);
r = await importCustomers(buh, xlsxRows("mijoz-togri", custHeader, good, CUST_FIELDS));
check("1.3 yaxshi qatorlar yozildi (2 yangi, takror INN birlashdi)", /2 ta yangi mijoz/.test(r.result?.note ?? "") && /takroriy/.test(r.result?.note ?? ""), r.result);
const cyr = q1(`select name, inn, phone, "creditLimit" from "Customer" where inn=${lit(inn(1))}`);
check("1.4 kirill nom va «1 250 000,50» limit to'g'ri saqlandi", cyr?.name === `ООО «Тест Курилиш» ${T}` && eq2(cyr.creditLimit, 1250000.5) && cyr.phone === "+998901112233", cyr);
r = await importCustomers(buh, xlsxRows("mijoz-takror", custHeader, good, CUST_FIELDS));
check("1.5 qayta yuklash — dublikat ochilmadi", /0 ta yangi/.test(r.result?.note ?? "") && count(`select id from "Customer" where inn=${lit(inn(1))}`) === 1, r.result);
r = await importCustomers(sotuv, xlsxRows("mijoz-sotuv", custHeader, [[`Sotuvchi mijozi ${T}`, inn(5), "", "", "", "99000000"]], CUST_FIELDS));
check("1.6 sotuvchi importida limit standart 0 (o'zi limit qo'ya olmaydi)", eq2(q1(`select "creditLimit" from "Customer" where inn=${lit(inn(5))}`)?.creditLimit ?? -1, 0), r.result);
const big = Array.from({ length: 1000 }, (_, i) => [`QA Katta ${T} №${i + 1}`, inn(10000 + i).slice(0, 9), `+99893${String(1000000 + i).slice(-7)}`, `Manzil ${i}`, "", i % 3 ? "10 000 000" : ""]);
let t0 = Date.now();
r = await importCustomers(buh, xlsxRows("mijoz-1000", custHeader, big, CUST_FIELDS));
const ms = Date.now() - t0;
check(`1.7 1000 qatorli fayl ${ms} ms da yozildi`, /1000 ta yangi mijoz/.test(r.result?.note ?? "") && ms < 60000, r.result ?? r.text.slice(0, 200));

// ───────── 2. Yetkazuvchilar ─────────
console.log("\n2. Yetkazuvchilar importi");
const supHeader = ["Поставщик", "ИНН", "Телефон", "Адрес", "Контакт"];
const sBefore = count(`select id from "Supplier"`);
r = await importSuppliers(xlsxRows("yetk-xato", supHeader, [[`ООО «Цемент» ${T}`, inn(20), "", "", ""], ["", inn(21), "+998901234567", "", ""], [`Yomon INN ${T}`, "abc12", "", "", ""]], PARTY_FIELDS));
check("2.1 yomon fayl rad etildi (qator raqami bilan), hech narsa yozilmadi", /2-qator: nomi yo'q/.test(r.result?.error ?? "") && /3-qator/.test(r.result?.error ?? "") && count(`select id from "Supplier"`) === sBefore, r.result);
const bigS = Array.from({ length: 1000 }, (_, i) => [`QA Yetkazuvchi ${T} №${i + 1}`, i % 2 ? inn(30000 + i).slice(0, 9) : "", "", "", ""]);
t0 = Date.now();
r = await importSuppliers(xlsxRows("yetk-1000", supHeader, bigS, PARTY_FIELDS));
check(`2.2 1000 yetkazuvchi ${Date.now() - t0} ms da yozildi`, /1000 ta yangi yetkazuvchi/.test(r.result?.note ?? ""), r.result ?? r.text.slice(0, 200));
r = await importSuppliers(xlsxRows("yetk-1000-takror", supHeader, bigS, PARTY_FIELDS));
check("2.3 qayta yuklash — dublikat yo'q", /0 ta yangi/.test(r.result?.note ?? ""), r.result);

// ───────── 3. Boshlang'ich qoldiqlar importi (4 tur) ─────────
console.log("\n3. Boshlang'ich qoldiqlar importi");
const custName = (n: number) => q1(`select name from "Customer" where inn=${lit(inn(n))}`).name;
const partyHeader = ["Контрагент", "ИНН", "Сумма", "Примечание"];
const obBefore = count(`select id from "OpeningBalance"`);
r = await importOpen("CUSTOMER", xlsxRows("qoldiq-mijoz-xato", partyHeader, [
  [custName(1), inn(1), "1 250 000,50", "1C"],
  ["", "", "100", ""], // nom yo'q
  [custName(2), inn(2), "abc", ""], // matn
  [custName(1), inn(1), "5", ""], // fayl ichida takror
  [`Бозорда йўқ ${T}`, "", "300000", ""], // bazada yo'q, createMissing yo'q
], OPEN_FIELDS.PARTY));
const oe = r.result?.error ?? "";
check("3.1 mijoz qoldig'i: yomon fayl — 4 xato qator raqami bilan, hech narsa yozilmadi", /4 ta qatorda xato/.test(oe) && /2-qator/.test(oe) && /3-qator/.test(oe) && /4-qator/.test(oe) && /5-qator/.test(oe) && count(`select id from "OpeningBalance"`) === obBefore, oe);
r = await importOpen("CUSTOMER", xlsxRows("qoldiq-mijoz", partyHeader, [
  [custName(1), inn(1), "1 250 000,50", "1C"],
  [custName(2), "", "-300 000", "avans"],
  [`Бозорда йўқ ${T}`, "", "300000", ""],
], OPEN_FIELDS.PARTY), { createMissing: "on" });
check("3.2 mijoz qoldig'i: 3 ta yozildi, yangi karta ochildi", /3 ta boshlang'ich qoldiq/.test(r.result?.note ?? "") && /1 ta yangi karta/.test(r.result?.note ?? ""), r.result);
const inv1 = q1(`select i.amount, i.status, i."isOpening" from "OpeningBalance" o join "Invoice" i on i.id=o."invoiceId" join "Customer" c on c.id=o."customerId" where c.inn=${lit(inn(1))} and o."cancelledAt" is null`);
check("3.3 qarz schyoti 1 250 000,50 OPEN; avans PAID", inv1 && eq2(inv1.amount, 1250000.5) && inv1.status === "OPEN" && inv1.isOpening, inv1);
r = await importOpen("CUSTOMER", xlsxRows("qoldiq-mijoz-takror", partyHeader, [[custName(1), inn(1), "999", ""]], OPEN_FIELDS.PARTY));
check("3.4 takror import — o'tkazib yuborildi (ikki marta yozilmadi)", /0 ta boshlang'ich/.test(r.result?.note ?? "") && /oldin kiritilgan/.test(r.result?.note ?? ""), r.result);

const supName = q1(`select name from "Supplier" where name like ${lit(`QA Yetkazuvchi ${T} №1`)}`).name;
r = await importOpen("SUPPLIER", xlsxRows("qoldiq-yetk", partyHeader, [[supName, "", "12 000 000", ""], [`ООО «Янги» ${T}`, "", "-1 500 000,25", ""], ["", "", "0", ""]], OPEN_FIELDS.PARTY), { createMissing: "on" });
check("3.5 yetkazuvchi qoldig'i: bo'sh qator (nom yo'q, 0) — xato", /3-qator/.test(r.result?.error ?? ""), r.result);
r = await importOpen("SUPPLIER", xlsxRows("qoldiq-yetk2", partyHeader, [[supName, "", "12 000 000", ""], [`ООО «Янги» ${T}`, "", "-1 500 000,25", ""]], OPEN_FIELDS.PARTY), { createMissing: "on" });
check("3.6 yetkazuvchi qoldig'i: 2 ta yozildi (manfiy — avansimiz)", /2 ta boshlang'ich/.test(r.result?.note ?? ""), r.result);

const accs = q(`select id, name, type from "CashAccount" where "isActive" and name not like 'QA %' order by name`);
const cashName = accs.find((a: { type: string }) => a.type === "CASH").name, bankName = accs.find((a: { type: string }) => a.type === "BANK").name;
const accIds = accs.map((a: { id: string }) => lit(a.id)).join(",");
const cashOpenBefore = q1(`select count(*)::int n from "OpeningBalance" where kind='CASH' and "cancelledAt" is null and "cashAccountId" in (${accIds})`).n;
if (cashOpenBefore === 0) {
  r = await importOpen("CASH", xlsxRows("qoldiq-kassa-xato", ["Hisob", "Qoldiq", "Izoh"], [[cashName, "5 000 000", ""], [bankName, "-2 000 000", "overdraft"], ["Yo'q hisob", "1", ""]], OPEN_FIELDS.CASH));
  check("3.7 kassa qoldig'i: overdraftsiz bank manfiy va noma'lum hisob — xato, hech narsa yozilmadi", /2-qator.*manfiy/.test(r.result?.error ?? "") && /3-qator/.test(r.result?.error ?? "") && q1(`select count(*)::int n from "OpeningBalance" where kind='CASH' and "cancelledAt" is null and "cashAccountId" in (${accIds})`).n === 0, r.result);
  r = await importOpen("CASH", xlsxRows("qoldiq-kassa", ["Hisob", "Qoldiq", "Izoh"], [[cashName, "5 000 000", "kassa"], [bankName, "20 000 000,75", "bank"]], OPEN_FIELDS.CASH));
  check("3.8 kassa/bank qoldig'i yozildi", /2 ta boshlang'ich/.test(r.result?.note ?? ""), r.result);
} else console.log("  (kassa qoldig'i oldin kiritilgan — 3.7/3.8 o'tkazildi)");

const stockKey = q1(`select count(*)::int n from "OpeningBalance" where kind='STOCK' and "cancelledAt" is null and "productId"=(select id from "Product" where code='USTUN')`).n;
r = await importOpen("STOCK", xlsxRows("qoldiq-sklad-xato", ["Mahsulot", "Sklad", "Miqdor", "Tannarx"], [["USTUN", "", "12,5", "150 000"], ["YOQ-MAHSULOT", "", "1", ""], ["FBS24", "", "-3", ""], ["FBS24", "Yo'q sklad", "3", ""]], OPEN_FIELDS.STOCK), { warehouseId: "main" });
check("3.9 sklad qoldig'i: noma'lum mahsulot, manfiy miqdor, noma'lum sklad — 3 xato", /3 ta qatorda xato/.test(r.result?.error ?? ""), r.result);
if (stockKey === 0) {
  r = await importOpen("STOCK", xlsxRows("qoldiq-sklad", ["Mahsulot", "Sklad", "Miqdor", "Tannarx"], [["USTUN", "Asosiy sklad", "12,5", "150 000"]], OPEN_FIELDS.STOCK), { warehouseId: "main" });
  check("3.10 sklad qoldig'i 12,5 dona yozildi", /1 ta boshlang'ich/.test(r.result?.note ?? ""), r.result);
}
r = await sotuv.action("settings/boshlangich-qoldiq/actions#importOpeningsAction", ["CUSTOMER", undefined, fd({ rows: "[]", date: today })], "/dashboard");
check("3.11 sotuvchi qoldiq import qila olmaydi (403 yoki yo'naltirish, 500 emas)", r.status !== 500, `${r.status}`);

fs.rmSync(DIR, { recursive: true, force: true });
summary("excel-imports:");
