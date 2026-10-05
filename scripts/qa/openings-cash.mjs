// Boshlang'ich qoldiqlar (qo'lda: kiritish, tahrir, bekor — 4 tur, takrordan himoya, yetkazuvchi to'lovi va
// uning stornosi) va kassa/bank: bank hisobi ham minusga tushmaydi (overdraft ruxsati bo'lmasa).
import { Client, fd, check, eq2, summary } from "./client.mjs";
import { q1, lit } from "./db.mjs";

const T = Date.now().toString(36).slice(-6);
const today = new Date().toISOString().slice(0, 10);
const dir = new Client(), buh = new Client(), kassa = new Client(), fin = new Client(), sotuv = new Client();
await Promise.all([dir.login("test.direktor"), buh.login("test.buh"), kassa.login("test.kassa"), fin.login("test.finance"), sotuv.login("test.sotuv")]);
const OB = "settings/boshlangich-qoldiq/actions";
const PAGE = "/settings/boshlangich-qoldiq";
const create = (c, o) => c.action(`${OB}#createOpeningAction`, [undefined, fd({ date: today, sign: "1", ...o })], PAGE);
const update = (c, id, o) => c.action(`${OB}#updateOpeningAction`, [id, undefined, fd({ date: today, sign: "1", ...o })], PAGE);
const cancel = (c, id, why = "QA: xato kiritilgan") => c.action(`${OB}#cancelOpeningAction`, [id, why], PAGE);
const active = (kind, col, id) => q1(`select * from "OpeningBalance" where kind=${lit(kind)} and ${col}=${lit(id)} and "cancelledAt" is null`);
const balance = (accId) => Number(q1(`select
  coalesce((select sum(amount) from "Payment" where "cashAccountId"=${lit(accId)}),0)
  + coalesce((select sum(case when type='EXPENSE' then -amount else amount end) from "CashTransaction" where "cashAccountId"=${lit(accId)}),0) as b`).b);
const cashTx = (o) => dir.action("cashflow/actions#createCashTx", [undefined, fd({ date: today, category: "Boshqa", ...o })], "/cashflow");

// Alohida test hisoblari (boshqa testlarga ta'sir qilmasin)
const saveAcc = (id, o) => dir.action("settings/actions#saveCashAccount", [id, undefined, fd({ isActive: "on", ...o })], "/settings");
await saveAcc(null, { name: `QA Kassa ${T}`, type: "CASH" });
await saveAcc(null, { name: `QA Bank ${T}`, type: "BANK" });
const KASSA = q1(`select id from "CashAccount" where name=${lit(`QA Kassa ${T}`)}`).id;
const BANK = q1(`select id from "CashAccount" where name=${lit(`QA Bank ${T}`)}`).id;

// ───────── CASH ─────────
console.log("\nCASH: boshlang'ich qoldiq + bank minus nazorati");
let r = await create(buh, { kind: "CASH", entityId: KASSA, amount: "1 000 000" });
check("C1 kassa qoldig'i 1 000 000 kiritildi (buxgalter)", r.result?.ok === true && eq2(balance(KASSA), 1000000), r.result);
r = await create(buh, { kind: "CASH", entityId: KASSA, amount: "5" });
check("C2 takror kiritish rad etildi", /allaqachon kiritilgan/.test(r.result?.error ?? ""), r.result);
let ob = active("CASH", `"cashAccountId"`, KASSA);
r = await update(buh, ob.id, { amount: "2 000 000" });
check("C3 buxgalter tahrirlay olmaydi (403)", r.status === 403, `${r.status}`);
r = await update(dir, ob.id, { amount: "2 000 000,50" });
check("C4 direktor tahrirladi → qoldiq 2 000 000,50", r.result?.ok === true && eq2(balance(KASSA), 2000000.5), r.result);
r = await cashTx({ type: "EXPENSE", cashAccountId: KASSA, amount: "1500000" });
check("C5 kassadan 1 500 000 chiqim", r.result?.ok === true, r.result);
r = await update(dir, ob.id, { amount: "100 000" });
check("C6 qoldiqni kamaytirish kassani minusga tushirsa — rad", /yetarli pul yo'q/.test(r.result?.error ?? ""), r.result);
r = await cancel(dir, ob.id);
check("C7 bekor qilish ham minusga tushirsa — rad", /minusga tushadi/.test(r.result?.error ?? ""), r.result);
r = await create(buh, { kind: "CASH", entityId: BANK, sign: "-1", amount: "100" });
check("C8 overdraftsiz bankka manfiy qoldiq — rad", /manfiy bo'lolmaydi/.test(r.result?.error ?? ""), r.result);
r = await cashTx({ type: "EXPENSE", cashAccountId: BANK, amount: "1000" });
check("C9 bo'sh bankdan chiqim — rad (ilgari bank minusga tushardi)", /yetarli pul yo'q/.test(r.result?.error ?? ""), r.result);
r = await saveAcc(BANK, { name: `QA Bank ${T}`, type: "BANK", allowOverdraft: "on" });
check("C10 direktor bankka overdraft ruxsatini berdi", r.result?.ok === true && q1(`select "allowOverdraft" from "CashAccount" where id=${lit(BANK)}`).allowOverdraft === true, r.result);
r = await cashTx({ type: "EXPENSE", cashAccountId: BANK, amount: "1000" });
check("C11 overdraftli bankdan chiqim o'tdi (qoldiq −1 000)", r.result?.ok === true && eq2(balance(BANK), -1000), r.result);
await saveAcc(BANK, { name: `QA Bank ${T}`, type: "BANK" });
r = await cashTx({ type: "INCOME", cashAccountId: BANK, amount: "50000" });
const inc = q1(`select id from "CashTransaction" where "cashAccountId"=${lit(BANK)} and type='INCOME' order by "createdAt" desc limit 1`);
r = await cashTx({ type: "EXPENSE", cashAccountId: BANK, amount: "40000" });
check("C12 overdraft o'chirilgach: kirim 50 000 − chiqim 40 000 o'tdi", r.result?.ok === true && eq2(balance(BANK), 9000), r.result);
r = await dir.action("cashflow/actions#deleteCashTx", [inc.id], "/cashflow");
check("C13 kirimni o'chirish bankni minusga tushirsa — rad", /minusga tushadi/.test(r.result?.error ?? ""), r.result);
r = await saveAcc(KASSA, { name: `QA Kassa ${T}`, type: "CASH", allowOverdraft: "on" });
check("C14 naqd kassaga overdraft belgisi saqlanmaydi", q1(`select "allowOverdraft" from "CashAccount" where id=${lit(KASSA)}`).allowOverdraft === false);

// ───────── CUSTOMER ─────────
console.log("\nCUSTOMER: qarz qoldig'i, to'lov, tahrir, bekor");
await buh.action("customers/actions#saveCustomer", [null, undefined, fd({ name: `QA Qoldiq mijoz ${T}`, creditLimit: 0, isActive: "on" })], "/customers/new");
const cust = q1(`select id from "Customer" where name=${lit(`QA Qoldiq mijoz ${T}`)}`).id;
r = await create(buh, { kind: "CUSTOMER", entityId: cust, amount: "1 000 000" });
ob = active("CUSTOMER", `"customerId"`, cust);
check("C20 mijoz qarzi 1 000 000 → BQ schyot OPEN", r.result?.ok === true && q1(`select status from "Invoice" where id=${lit(ob.invoiceId)}`).status === "OPEN", r.result);
r = await create(dir, { kind: "CUSTOMER", entityId: cust, amount: "1" });
check("C21 takror — rad", /allaqachon/.test(r.result?.error ?? ""), r.result);
r = await kassa.action("payments/actions#createPayment", [undefined, fd({ customerId: cust, invoiceId: ob.invoiceId, cashAccountId: KASSA, amount: "400000", date: today })], "/payments");
check("C22 qoldiq schyotiga 400 000 to'lov → PARTIAL", r.result?.ok === true && q1(`select status from "Invoice" where id=${lit(ob.invoiceId)}`).status === "PARTIAL", r.result);
r = await update(dir, ob.id, { amount: "300 000" });
check("C23 summani to'langandan kam qilish — rad", /kam bo'lolmaydi/.test(r.result?.error ?? ""), r.result);
r = await update(dir, ob.id, { amount: "800 000" });
check("C24 tahrir 800 000 → schyot 800 000 PARTIAL", r.result?.ok === true && eq2(q1(`select amount from "Invoice" where id=${lit(ob.invoiceId)}`).amount, 800000), r.result);
r = await cancel(dir, ob.id);
check("C25 to'lovi bor qoldiqni bekor qilish — rad", /to'lov yozilgan/.test(r.result?.error ?? ""), r.result);
const pay = q1(`select id from "Payment" where "invoiceId"=${lit(ob.invoiceId)}`);
await buh.action("payments/actions#stornoPayment", [pay.id, "QA: noto'g'ri"], "/payments");
r = await cancel(dir, ob.id);
check("C26 to'lov storno qilingach bekor qilindi → schyot CANCELLED", r.result?.ok === true && q1(`select status from "Invoice" where id=${lit(ob.invoiceId)}`).status === "CANCELLED", r.result);
r = await create(buh, { kind: "CUSTOMER", entityId: cust, sign: "-1", amount: "250 000,25" });
const ob2 = active("CUSTOMER", `"customerId"`, cust);
check("C27 bekor qilingandan keyin qayta kiritish (avans −250 000,25) → PAID", r.result?.ok === true && q1(`select status, amount from "Invoice" where id=${lit(ob2.invoiceId)}`).status === "PAID", r.result);

// ───────── SUPPLIER ─────────
console.log("\nSUPPLIER: qarzimiz, to'lov, ortiqcha to'lov, xato to'lov stornosi (direktor)");
const supName = `QA Qoldiq yetkazuvchi ${T}`;
const sk = new Client(); await sk.login("test.sklad");
await sk.action("suppliers/actions#createSupplier", [undefined, fd({ name: supName })], "/suppliers");
let sup = q1(`select id from "Supplier" where name=${lit(supName)}`);
if (!sup) { // createSupplier boshqa nom bilan bo'lsa — import orqali
  await sk.action("suppliers/actions#importSuppliersFromExcel", [undefined, fd({ rows: JSON.stringify([{ name: supName }]) })], "/suppliers/import");
  sup = q1(`select id from "Supplier" where name=${lit(supName)}`);
}
r = await create(buh, { kind: "SUPPLIER", entityId: sup.id, amount: "5 000 000" });
ob = active("SUPPLIER", `"supplierId"`, sup.id);
check("C30 yetkazuvchiga qarz 5 000 000", r.result?.ok === true && !!ob, r.result);
const paySup = (c, amount, acc = KASSA) => c.action(`${OB}#paySupplierOpeningAction`, [ob.id, undefined, fd({ cashAccountId: acc, amount })], PAGE);
r = await paySup(fin, "6000000");
check("C31 ortiqcha to'lov (6 mln > 5 mln) — rad", /Qolgan qarzdan ko'p/.test(r.result?.error ?? ""), r.result);
r = await paySup(fin, "900000", BANK);
check("C32 bankda pul yetmasa (9 000) — rad", /yetarli pul yo'q/.test(r.result?.error ?? ""), r.result);
r = await paySup(fin, "300000");
check("C33 finance 300 000 to'ladi (kassadan)", r.result?.ok === true, r.result);
r = await cancel(dir, ob.id);
check("C34 to'langan qoldiqni bekor qilish — rad", /to'langan/.test(r.result?.error ?? ""), r.result);
const sp = q1(`select id from "CashTransaction" where "refType"='OpeningBalance' and "refId"=${lit(ob.id)}`);
r = await dir.action("cashflow/actions#deleteCashTx", [sp.id], "/cashflow");
check("C35 Kirim-Chiqimdan o'chirib bo'lmaydi (hujjatga bog'langan)", /bog'langan/.test(r.result?.error ?? ""), r.result);
r = await buh.action(`${OB}#reverseSupplierOpeningPaymentAction`, [sp.id, "QA xato to'lov"], PAGE);
check("C36 buxgalter xato to'lovni storno qila olmaydi (403)", r.status === 403, `${r.status}`);
const kBefore = balance(KASSA);
r = await dir.action(`${OB}#reverseSupplierOpeningPaymentAction`, [sp.id, "QA xato to'lov"], PAGE);
check("C37 direktor xato to'lovni storno qildi → pul kassaga qaytdi", r.result?.ok === true && eq2(balance(KASSA) - kBefore, 300000), r.result);
r = await dir.action(`${OB}#reverseSupplierOpeningPaymentAction`, [sp.id, "QA xato to'lov"], PAGE);
check("C38 ikkinchi marta — «topilmadi»", /topilmadi/.test(r.result?.error ?? ""), r.result);
r = await cancel(dir, ob.id);
check("C39 endi qoldiq bekor qilindi", r.result?.ok === true, r.result);

// ───────── STOCK ─────────
console.log("\nSTOCK: tayyor mahsulot qoldig'i");
const prod = q1(`select id from "Product" where code='FBS24'`).id;
const stock = () => Number(q1(`select coalesce(sum(qty),0) q from "StockMove" where "productId"=${lit(prod)} and "warehouseId"='main'`).q);
const prev = q1(`select id from "OpeningBalance" where kind='STOCK' and "productId"=${lit(prod)} and "warehouseId"='main' and "cancelledAt" is null`);
if (prev) await cancel(dir, prev.id);
const s0 = stock();
r = await create(buh, { kind: "STOCK", entityId: prod, warehouseId: "main", qty: "10", unitCost: "250 000" });
ob = q1(`select * from "OpeningBalance" where kind='STOCK' and "productId"=${lit(prod)} and "cancelledAt" is null`);
check("C40 sklad qoldig'i +10 (qiymat 2 500 000)", r.result?.ok === true && eq2(stock() - s0, 10) && eq2(ob.amount, 2500000), r.result);
r = await create(buh, { kind: "STOCK", entityId: prod, warehouseId: "main", qty: "1" });
check("C41 takror — rad", /allaqachon/.test(r.result?.error ?? ""), r.result);
r = await update(dir, ob.id, { qty: "8", unitCost: "240000" });
check("C42 tahrir: 8 dona → sklad +8", r.result?.ok === true && eq2(stock() - s0, 8), r.result);
r = await cancel(dir, ob.id);
check("C43 bekor → sklad qaytdi", r.result?.ok === true && eq2(stock() - s0, 0), r.result);
r = await create(sotuv, { kind: "CASH", entityId: KASSA, amount: "1" });
check("C44 sotuvchi qoldiq kirita olmaydi (403 yoki sahifadan qaytariladi)", [403, 307].includes(r.status), `${r.status}`);

summary("openings-cash:");
