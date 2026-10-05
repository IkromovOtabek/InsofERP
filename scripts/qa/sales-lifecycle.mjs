// Sotuv/moliya to'liq hayot sikli — haqiqiy rollar bilan HTTP orqali (server action'lar):
// mijoz + zayavka (naqd/oldindan, qarzga) → qabul → avans → schyot → kassa to'lovi (qisman, to'liq, ortiqcha urinish)
// → storno → holat va qarzlar tiyinigacha hamma joyda (kartochka, akt sverka, debitorka, dashboard, BI).
// Ishga tushirish: README.md (scripts/qa) ga qarang.
import { Client, fd, check, eq2, summary } from "./client.mjs";
import { q, q1, exec, lit } from "./db.mjs";

const T = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const P = Object.fromEntries(q(`select code, id, price from "Product"`).map((p) => [p.code, p]));
const KASSA = q1(`select id from "CashAccount" where type='CASH' and "isActive" order by name limit 1`).id;
const BANK = q1(`select id from "CashAccount" where type='BANK' and "isActive" order by name limit 1`).id;
const html = (t) => t.replace(/&nbsp;|\u00a0|\u202f/g, " ").replace(/&#x27;|&#39;/g, "'");
/** Sahifada summa bormi: "6 999 999,5" (tiyin bilan) yoki, `exact` bo'lmasa, yaxlitlangan "7 000 000". */
const fmtN = (x, d) => x.toLocaleString("ru-RU", { maximumFractionDigits: d }).replace(/[\u00a0\u202f]/g, " ");
const hasMoney = (text, n, exact = false) => html(text).includes(fmtN(Math.abs(n), 2)) || (!exact && html(text).includes(fmtN(Math.round(Math.abs(n)), 0)));

const sotuv = new Client("sotuv"), kassa = new Client("kassa"), buh = new Client("buh"), dir = new Client("direktor"), sklad = new Client("sklad");
await Promise.all([sotuv.login("test.sotuv"), kassa.login("test.kassa"), buh.login("test.buh"), dir.login("test.direktor"), sklad.login("test.sklad")]);

const orderForm = (o) => fd({
  customerMode: o.customerId ? "existing" : "new", customerId: o.customerId, newName: o.newName, newInn: o.newInn,
  deliveryDate: tomorrow, deliveryAddress: `QA obyekt ${T}`, needsDelivery: "on", payment: o.payment, prepayAmount: o.prepay ?? 0,
  "productId[]": o.items.map((i) => P[i[0]].id), "qtyM3[]": o.items.map((i) => i[1]), "price[]": o.items.map((i) => i[2]), "nds[]": o.items.map(() => "0"),
});
const orderIdFrom = (r) => r.redirect?.match(/\/orders\/([^?;]+)/)?.[1];
const credit = (cid) => q1(`
  select
    coalesce((select sum(amount) from "Invoice" where "customerId"=${lit(cid)} and status<>'CANCELLED'),0)::numeric as invoiced,
    coalesce((select sum(p.amount) from "Payment" p where p."customerId"=${lit(cid)} and not exists (select 1 from "SalesRegister" r where r."paymentId"=p.id)),0)::numeric as paid`);

// ───────── A. Yangi mijoz, to'liq oldindan to'lov (naqd) ─────────
console.log("\nA. Yangi mijoz + to'liq oldindan to'lovli zayavka");
const nameA = `QA Naqd Mijoz ${T}`;
let r = await sotuv.action("orders/actions#createOrder", [undefined, orderForm({ newName: nameA, payment: "prepay", prepay: 6500000, items: [["M300", 10, 650000]] })], "/orders/new");
const oA = orderIdFrom(r);
check("A1 zayavka ochildi (redirect)", !!oA, r.text.slice(0, 300));
const ordA = q1(`select o.*, c."creditLimit", c.id as cid from "Order" o join "Customer" c on c.id=o."customerId" where o.id=${lit(oA)}`);
check("A2 prepayAmount ustunda 6 500 000", eq2(ordA.prepayAmount, 6500000), ordA.prepayAmount);
check("A3 izohga avans qatori yozilmagan", !ordA.note, ordA.note);
check("A4 yangi mijoz limiti 0", eq2(ordA.creditLimit, 0));
r = await sotuv.action("orders/actions#confirmOrder", [oA], `/orders/${oA}`);
check("A5 to'liq oldindan to'lovli zayavka qabul qilindi (BLOCKED emas)", q1(`select status from "Order" where id=${lit(oA)}`).status === "CONFIRMED", r.text.slice(-300));
let page = await sotuv.get(`/orders/${oA}`);
check("A6 zayavka sahifasida kutilayotgan avans", page.status === 200 && html(page.text).includes("Kutilayotgan avans") && hasMoney(page.text, 6500000));
// Avans: qisman, ortiqcha urinish, qolgani
r = await kassa.action("payments/actions#createPayment", [undefined, fd({ customerId: ordA.cid, orderId: oA, cashAccountId: KASSA, amount: 2000000, date: today })], "/payments");
check("A7 avans 2 000 000 qabul qilindi", r.result?.ok === true, r.result);
r = await kassa.action("payments/actions#createPayment", [undefined, fd({ customerId: ordA.cid, orderId: oA, cashAccountId: KASSA, amount: 5000000, date: today })], "/payments");
check("A8 ortiqcha avans (5 mln > qoldiq 4.5 mln) rad etildi", /qoldig'idan ko'p/.test(r.result?.error ?? ""), r.result);
r = await kassa.action("payments/actions#createPayment", [undefined, fd({ customerId: ordA.cid, orderId: oA, cashAccountId: KASSA, amount: 4500000, date: today })], "/payments");
check("A9 qolgan avans 4 500 000 qabul qilindi", r.result?.ok === true, r.result);
r = await kassa.action("payments/actions#createPayment", [undefined, fd({ customerId: ordA.cid, orderId: oA, cashAccountId: KASSA, amount: 4500000, date: today })], "/payments");
check("A10 takror bosish (dublikat yoki qoldiq 0) rad etildi", !!r.result?.error, r.result);
r = await buh.action("invoices/actions#createInvoice", [undefined, fd({ orderId: oA, amount: 6500000, date: today })], "/invoices");
const invA = q1(`select * from "Invoice" where "orderId"=${lit(oA)} and status<>'CANCELLED'`);
check("A11 schyot yozildi va avans bilan to'liq yopildi (PAID)", invA?.status === "PAID", invA);
const cA = credit(ordA.cid);
check("A12 mijoz qarzi 0 (schyot 6.5 mln − to'lov 6.5 mln)", eq2(Number(cA.invoiced) - Number(cA.paid), 0), cA);

// ───────── B. Qarzga zayavka, limit, blok, to'lov/storno ─────────
console.log("\nB. Qarzga zayavka: limit, blok, qisman/to'liq to'lov, ortiqcha urinish, storno");
const nameB = `QA Kredit Mijoz ${T}`;
r = await buh.action("customers/actions#saveCustomer", [null, undefined, fd({ name: nameB, inn: "", creditLimit: 20000000, isActive: "on" })], "/customers/new");
const cB = q1(`select id, "creditLimit" from "Customer" where name=${lit(nameB)}`);
check("B1 buxgalter mijozni 20 mln limit bilan ochdi", cB && eq2(cB.creditLimit, 20000000), r.text.slice(-200));
r = await sotuv.action("orders/actions#createOrder", [undefined, orderForm({ customerId: cB.id, payment: "credit", items: [["M250", 20, 600000]] })], "/orders/new");
const oB1 = orderIdFrom(r);
await sotuv.action("orders/actions#confirmOrder", [oB1], `/orders/${oB1}`);
check("B2 12 mln qarzga zayavka qabul qilindi", q1(`select status from "Order" where id=${lit(oB1)}`).status === "CONFIRMED");
r = await sotuv.action("orders/actions#createOrder", [undefined, orderForm({ customerId: cB.id, payment: "credit", items: [["M250", 25, 600000]] })], "/orders/new");
const oB2 = orderIdFrom(r);
r = await sotuv.action("orders/actions#confirmOrder", [oB2], `/orders/${oB2}`);
check("B3 limitdan oshgan (12+15 > 20 mln) zayavka BLOCKED", q1(`select status from "Order" where id=${lit(oB2)}`).status === "BLOCKED", r.result);
r = await sotuv.action("orders/actions#unblockOrder", [oB2], `/orders/${oB2}`);
check("B4 sotuvchi blokni ocha olmaydi (403, 500 emas)", r.status === 403 && q1(`select status from "Order" where id=${lit(oB2)}`).status === "BLOCKED", `${r.status}`);
r = await dir.action("orders/actions#unblockOrder", [oB2], `/orders/${oB2}`);
check("B5 direktor blokni ochdi", r.result?.ok === true && q1(`select status from "Order" where id=${lit(oB2)}`).status === "CONFIRMED", r.result);
r = await sotuv.action("orders/actions#cancelOrder", [oB2, "QA: mijoz voz kechdi"], `/orders/${oB2}`);
check("B6 ikkinchi zayavka bekor qilindi", r.result?.ok === true, r.result);
r = await buh.action("invoices/actions#createInvoice", [undefined, fd({ orderId: oB1, amount: 12000000, date: today })], "/invoices");
const invB = q1(`select * from "Invoice" where "orderId"=${lit(oB1)} and status<>'CANCELLED'`);
check("B7 schyot 12 000 000 OPEN", invB?.status === "OPEN" && eq2(invB.amount, 12000000), invB);
r = await buh.action("invoices/actions#createInvoice", [undefined, fd({ orderId: oB1, amount: 1000, date: today })], "/invoices");
check("B8 ikkinchi schyot rad etildi", /allaqachon/.test(r.result?.error ?? ""), r.result);
r = await kassa.action("payments/actions#createPayment", [undefined, fd({ customerId: cB.id, invoiceId: invB.id, cashAccountId: BANK, amount: "5000000.50", date: today })], "/payments");
check("B9 qisman to'lov 5 000 000,50 (bank)", r.result?.ok === true, r.result);
check("B10 schyot PARTIAL", q1(`select status from "Invoice" where id=${lit(invB.id)}`).status === "PARTIAL");
let cr = credit(cB.id);
check("B11 qarz 6 999 999,50 (tiyinigacha)", eq2(Number(cr.invoiced) - Number(cr.paid), 6999999.5), cr);
r = await kassa.action("payments/actions#createPayment", [undefined, fd({ customerId: cB.id, invoiceId: invB.id, cashAccountId: KASSA, amount: 8000000, date: today })], "/payments");
check("B12 ortiqcha to'lov (8 mln > 6 999 999,50) rad etildi", /Qoldiqdan ko'p/.test(r.result?.error ?? ""), r.result);
// Logistika reysni yetkazdi (simulyatsiya — reys moduli boshqa test'da): zayavka DELIVERED
exec(`update "Order" set status='DELIVERED' where id=${lit(oB1)}`);
r = await kassa.action("payments/actions#createPayment", [undefined, fd({ customerId: cB.id, invoiceId: invB.id, cashAccountId: KASSA, amount: "6999999.50", date: today })], "/payments");
check("B13 qolgan to'lov qabul qilindi", r.result?.ok === true, r.result);
check("B14 schyot PAID, zayavka CLOSED", q1(`select status from "Invoice" where id=${lit(invB.id)}`).status === "PAID" && q1(`select status from "Order" where id=${lit(oB1)}`).status === "CLOSED");
cr = credit(cB.id);
check("B15 qarz 0", eq2(Number(cr.invoiced) - Number(cr.paid), 0), cr);
const lastPay = q1(`select id from "Payment" where "invoiceId"=${lit(invB.id)} and amount=6999999.50`);
r = await kassa.action("payments/actions#stornoPayment", [lastPay.id, "QA xato"], "/payments");
check("B16 kassir storno qila olmaydi (403)", r.status === 403, `${r.status} ${r.text.slice(0, 120)}`);
r = await buh.action("payments/actions#stornoPayment", [lastPay.id, "QA: xato kiritilgan"], "/payments");
check("B17 buxgalter to'lovni storno qildi", r.result?.ok === true, r.result);
check("B18 schyot PARTIAL, zayavka DELIVERED ga qaytdi", q1(`select status from "Invoice" where id=${lit(invB.id)}`).status === "PARTIAL" && q1(`select status from "Order" where id=${lit(oB1)}`).status === "DELIVERED");
cr = credit(cB.id);
check("B19 qarz yana 6 999 999,50", eq2(Number(cr.invoiced) - Number(cr.paid), 6999999.5), cr);

// Hisobotlarda bir xil raqam
page = await buh.get(`/customers/${cB.id}`);
check("B20 mijoz kartasida qarz 6 999 999,5", page.status === 200 && hasMoney(page.text, 6999999.5), page.status);
page = await buh.get(`/customers/${cB.id}/akt?from=${today}&to=${today}`);
check("B21 akt sverka: yakuniy qoldiq 6 999 999,5 (tiyin bilan)", page.status === 200 && hasMoney(page.text, 6999999.5, true), page.status);
for (const [p, who] of [["/sales", buh], ["/dashboard", dir], ["/bi-tahlil/moliya", dir], ["/bi-tahlil/mijozlar", dir], ["/payments", kassa], ["/invoices", buh], ["/customers", buh], [`/payments/mijoz/${cB.id}`, buh]]) {
  page = await who.get(p);
  check(`B22 ${p} ochiladi (200)`, page.status === 200, `${page.status} ${page.location ?? ""}`);
}

// ───────── C. Qora ro'yxat: faqat oldindan to'lov ─────────
console.log("\nC. Kredit limiti yo'q (qarzdor) mijoz: kredit yopiq, to'liq oldindan to'lov ochiq");
const nameC = `QA Qarzdor ${T}`;
await buh.action("customers/actions#saveCustomer", [null, undefined, fd({ name: nameC, creditLimit: 0, isActive: "on" })], "/customers/new");
const cC = q1(`select id from "Customer" where name=${lit(nameC)}`);
r = await buh.action("settings/boshlangich-qoldiq/actions#createOpeningAction", [undefined, fd({ kind: "CUSTOMER", sign: "1", date: today, entityId: cC.id, amount: "3 000 000" })], "/settings/boshlangich-qoldiq");
check("C1 boshlang'ich qarz 3 mln kiritildi", r.result?.ok === true, r.result);
r = await sotuv.action("orders/actions#createOrder", [undefined, orderForm({ customerId: cC.id, payment: "credit", items: [["M200", 2, 550000]] })], "/orders/new");
check("C2 qarzga zayavka rad: «Kredit limiti yo'q — faqat oldindan to'lov bilan»", !orderIdFrom(r) && /Kredit limiti yo'q — faqat oldindan to'lov bilan/.test(r.result?.error ?? ""), r.result);
r = await sotuv.action("orders/actions#createOrder", [undefined, orderForm({ customerId: cC.id, payment: "prepay", prepay: 500000, items: [["M200", 2, 550000]] })], "/orders/new");
check("C3 qisman avansli naqd zayavka ham rad (qolgani qarz bo'lardi)", !orderIdFrom(r) && /faqat oldindan to'lov/.test(r.result?.error ?? ""), r.result);
r = await sotuv.action("orders/actions#createOrder", [undefined, orderForm({ customerId: cC.id, payment: "prepay", prepay: 1100000, items: [["M200", 2, 550000]] })], "/orders/new");
const oC = orderIdFrom(r);
check("C4 to'liq oldindan to'lovli zayavka ochildi", !!oC, r.result);
r = await sotuv.action("orders/actions#confirmOrder", [oC], `/orders/${oC}`);
check("C5 va qabul qilindi (CONFIRMED, eski qarz bo'lsa ham)", q1(`select status from "Order" where id=${lit(oC)}`).status === "CONFIRMED", r.result);

// ───────── D. Ruxsatsiz chaqiruvlar: 500 emas, 403 ─────────
console.log("\nD. Ruxsatsiz server action chaqiruvlari");
const logist = new Client("logistika"); await logist.login("test.logistika");
r = await logist.action("orders/actions#createOrder", [undefined, orderForm({ newName: "QA ruxsatsiz", payment: "prepay", items: [["M200", 1, 550000]] })], `/orders/${oA}`);
check("D1 logist (zayavkani faqat ko'radi) createOrder → 403 (500 emas)", r.status === 403, `${r.status} ${r.text.slice(0, 150)}`);
check("D2 ruxsatsiz mijoz ochilmadi", !q1(`select id from "Customer" where name='QA ruxsatsiz'`));
r = await sklad.action("receipts/actions#stornoReceipt", ["yoq-id", "QA sabab"], "/receipts/yoq-id");
check("D3 sklad stornoReceipt (faqat direktor) → 403", r.status === 403, `${r.status} ${r.text.slice(0, 120)}`);
r = await buh.action("settings/boshlangich-qoldiq/actions#cancelOpeningAction", ["nonexistent", "sabab"], "/settings/boshlangich-qoldiq");
check("D4 buxgalter qoldiqni bekor qila olmaydi (faqat direktor) → 403", r.status === 403, `${r.status}`);
r = await sotuv.action("orders/actions#confirmOrder", ["yoq-id"], "/orders");
check("D5 mavjud bo'lmagan zayavka — o'zbekcha xato (500 emas)", r.status === 200 && /topilmadi/.test(r.result?.error ?? ""), `${r.status} ${JSON.stringify(r.result)}`);

summary("sales-lifecycle:");
