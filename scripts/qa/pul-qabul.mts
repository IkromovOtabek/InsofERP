// «Pul qabul qilish» — zayavka bosh to'lovi so'rovi (`lib/payment-requests.ts`): naqd → kassa xodimi, perechisleniye → buxgalter.
// Tekshiradi: so'rov ochilishi, rol ↔ usul ↔ hisob turi, qisman/to'liq qabul, ortiqcha summa, takror qabul, storno, eski Kassa formasi
// orqali to'lov (sinxron), schyotga tushish, zayavka bekor, filtrlar (ochiq / muddati o'tgan), hisob qoldig'i, Kirim-Chiqim va mijoz balansi.
// Ishga tushirish: DATABASE_URL=postgresql://…/insof_test_x npx tsx scripts/qa/pul-qabul.mts
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { check, summary } from "./client.mjs";
import "./db.mjs"; // test bazasi himoyasi (nomi insof_test… bo'lmasa to'xtaydi)

const url = process.env.DATABASE_URL ?? "";
if (!/\/insof_test[^/]*$/.test(url.split("?")[0]) || /insof_test_golden/.test(url)) { console.error("DATABASE_URL test bazasi emas"); process.exit(2); }

const { db } = await import("../../src/lib/db");
const { createOrder, orderCancel, orderConfirm } = await import("../../src/lib/orders");
const { addPayment, prepayShortError, reversePayment, accountBalances } = await import("../../src/lib/payments");
const { receivePaymentRequest, payReqCounts, methodsFor, listPaymentRequests } = await import("../../src/lib/payment-requests");
const { createInvoice } = await import("../../src/lib/invoices");
const { customerBalance } = await import("../../src/lib/receivables");

const user = (login: string) => db.user.findFirstOrThrow({ where: { login } });
const [sotuv, buh, kassir, direktor] = await Promise.all([user("test.sotuv"), user("test.buh"), user("test.kassa"), user("test.direktor")]);
const S = (u: { id: string; role: never | string }) => ({ userId: u.id, role: u.role as "CASHIER", perms: null });
const prod = await db.product.findFirstOrThrow({ where: { code: "M200" } });
const kassa = await db.cashAccount.findFirstOrThrow({ where: { type: "CASH", isActive: true }, orderBy: { name: "asc" } });
const bank = (await db.cashAccount.findFirst({ where: { type: "BANK", isActive: true }, orderBy: { name: "asc" } }))
  ?? (await db.cashAccount.create({ data: { name: `QA bank ${Date.now().toString(36)}`, type: "BANK" } }));
const T = Date.now().toString(36);
const tomorrow = new Date(Date.now() + 86400000);
const base = { deliveryDate: tomorrow, deliveryAddress: `QA pul ${T}`, items: [{ productId: prod.id, qtyM3: 4, price: 500000 }] }; // 2 000 000
const req = (orderId: string) => db.paymentRequest.findUniqueOrThrow({ where: { orderId } });
const bal = async (id: string) => (await accountBalances(db, [id])).get(id) ?? 0;

check("Q0 rollar: kassir → naqd, buxgalter → bank, direktor → ikkalasi",
  methodsFor(S(kassir)).join() === "CASH" && methodsFor({ userId: buh.id, role: "ACCOUNTING", perms: null }).join() === "BANK" && methodsFor({ userId: direktor.id, role: "DIRECTOR", perms: null }).join() === "CASH,BANK");

// ── Naqd ──
const o = await createOrder({ ...base, newCustomer: { name: `QA Naqd ${T}` }, payMethod: "CASH", prepay: { amount: 1000000 } }, sotuv.id);
let r = await req(o.id);
check("Q1 naqd bosh to'lov — so'rov ochildi (CASH, PENDING, 1 000 000, muddat = yetkazish)", r.method === "CASH" && r.status === "PENDING" && Number(r.amount) === 1000000 && r.dueDate.getTime() === tomorrow.getTime() && /^PS-\d{4}-\d{5}$/.test(r.docNo), r);
check("Q1b zayavkada usul saqlandi", (await db.order.findUniqueOrThrow({ where: { id: o.id } })).payMethod === "CASH");
await orderConfirm(o.id, sotuv.id);

let x = await receivePaymentRequest({ requestId: r.id, cashAccountId: kassa.id, amount: 100000, date: new Date() }, { userId: buh.id, role: "ACCOUNTING", perms: null });
check("Q2 buxgalter naqd so'rovni qabul qila olmaydi", /Kassa xodimi/.test(x.error ?? ""), x);
x = await receivePaymentRequest({ requestId: r.id, cashAccountId: bank.id, amount: 100000, date: new Date() }, S(kassir));
check("Q3 naqd pul bank hisobiga qabul qilinmaydi", /faqat kassa/.test(x.error ?? ""), x);

const kassa0 = await bal(kassa.id);
x = await receivePaymentRequest({ requestId: r.id, cashAccountId: kassa.id, amount: 600000, date: new Date() }, S(kassir));
r = await req(o.id);
check("Q4 qisman 600 000 — PARTIAL, tushgan 600 000", !x.error && r.status === "PARTIAL" && Number(r.received) === 600000, x);
check("Q5 kassa qoldig'i +600 000", Math.abs((await bal(kassa.id)) - kassa0 - 600000) < 0.01);
const p1 = await db.payment.findFirstOrThrow({ where: { orderId: o.id }, orderBy: { createdAt: "asc" } });
check("Q6 to'lov zayavka avansi bo'lib yozildi (izohda PS raqami, kim qabul qildi)", p1.cashAccountId === kassa.id && (p1.note ?? "").includes(r.docNo) && p1.createdById === kassir.id, p1);
x = await receivePaymentRequest({ requestId: r.id, cashAccountId: kassa.id, amount: 500000, date: new Date() }, S(kassir));
check("Q7 qolgandan ko'p (500 000 > 400 000) — rad", /Qolgan bosh to'lov 400 000/.test(x.error ?? ""), x);
x = await receivePaymentRequest({ requestId: r.id, cashAccountId: kassa.id, amount: 400000, date: new Date() }, S(kassir));
r = await req(o.id);
check("Q8 qolgani — RECEIVED, closedAt bor", x.status === "RECEIVED" && r.status === "RECEIVED" && !!r.closedAt && Number(r.received) === 1000000, x);
check("Q9 reys darvozasi ochildi", (await prepayShortError(db, o.id)) === null);
x = await receivePaymentRequest({ requestId: r.id, cashAccountId: kassa.id, amount: 1000, date: new Date() }, S(kassir));
check("Q10 yopilgan so'rov qayta qabul qilinmaydi", /allaqachon/.test(x.error ?? ""), x);
await reversePayment(p1.id, "QA storno", buh.id);
r = await req(o.id);
check("Q11 storno — so'rov yana PARTIAL (400 000), closedAt bo'sh", r.status === "PARTIAL" && Number(r.received) === 400000 && r.closedAt === null, r);
const cb = await customerBalance(o.customerId);
check("Q12 mijoz balansi: avans 400 000 (schyotsiz to'lov — manfiy qoldiq)", Math.abs(cb.balance + 400000) < 0.01, cb);

// Eski yo'l (Kassa/bank → To'lovlar, so'rovsiz) ham so'rovni yopadi
await addPayment({ customerId: o.customerId, orderId: o.id, cashAccountId: kassa.id, amount: 600000, date: new Date() }, kassir.id);
r = await req(o.id);
check("Q13 Kassa formasidan zayavkaga to'lov — so'rov RECEIVED (sinxron)", r.status === "RECEIVED" && Number(r.received) === 1000000, r);

// ── Perechisleniye ──
const ob = await createOrder({ ...base, newCustomer: { name: `QA Bank ${T}` }, payMethod: "BANK", prepay: { amount: 2000000 } }, sotuv.id);
let rb = await req(ob.id);
check("Q14 perechisleniye — so'rov BANK", rb.method === "BANK" && rb.status === "PENDING");
x = await receivePaymentRequest({ requestId: rb.id, cashAccountId: bank.id, amount: 2000000, date: new Date() }, S(kassir));
check("Q15 kassir bank so'rovini qabul qila olmaydi", /Buxgalter/.test(x.error ?? ""), x);
const bank0 = await bal(bank.id);
x = await receivePaymentRequest({ requestId: rb.id, cashAccountId: bank.id, amount: 2000000, date: new Date(), docRef: "777" }, { userId: buh.id, role: "ACCOUNTING", perms: null });
rb = await req(ob.id);
const pb = await db.payment.findFirstOrThrow({ where: { orderId: ob.id } });
check("Q16 buxgalter tasdiqladi — RECEIVED, bank +2 000 000, izohda topshiriqnoma", rb.status === "RECEIVED" && Math.abs((await bal(bank.id)) - bank0 - 2000000) < 0.01 && /topshiriqnoma № 777/.test(pb.note ?? ""), x);

// ── Schyot yozilgandan keyin qabul — pul schyotga tushadi ──
const oi = await createOrder({ ...base, newCustomer: { name: `QA Schyot ${T}` }, payMethod: "CASH", prepay: { amount: 500000 } }, sotuv.id);
// Yangi mijozning standart limiti zayavkani BLOCKED qilmasin — schyot faqat tasdiqlanganga yoziladi
await db.customer.update({ where: { id: oi.customerId }, data: { creditLimit: 100_000_000 } });
await orderConfirm(oi.id, sotuv.id);
const inv = await createInvoice({ orderId: oi.id, amount: 2000000, date: new Date() }, buh.id);
check("Q17a schyot yozildi", !!inv.id, inv);
const ri = await req(oi.id);
x = await receivePaymentRequest({ requestId: ri.id, cashAccountId: kassa.id, amount: 500000, date: new Date() }, S(kassir));
const pi = await db.payment.findFirst({ where: { invoice: { orderId: oi.id } } });
const invRow = await db.invoice.findUniqueOrThrow({ where: { id: inv.id! } });
check("Q17 schyotli zayavka — to'lov schyotga, schyot PARTIAL, so'rov RECEIVED", !x.error && pi?.invoiceId === inv.id && invRow.status === "PARTIAL" && (await req(oi.id)).status === "RECEIVED", x);

// ── Qarzga + bosh to'lov, bosh to'lovsiz, bekor qilish, filtrlar ──
const oc = await createOrder({ ...base, newCustomer: { name: `QA Kredit ${T}` }, onCredit: true, payMethod: "BANK", prepay: { amount: 300000 } }, sotuv.id);
check("Q18 qarzga zayavka bosh to'lov bilan — so'rov BANK", (await req(oc.id)).method === "BANK");
const on = await createOrder({ ...base, newCustomer: { name: `QA Bosh0 ${T}` }, payMethod: "CASH" }, sotuv.id);
check("Q19 bosh to'lovsiz — so'rov yo'q", (await db.paymentRequest.findUnique({ where: { orderId: on.id } })) === null);
const od = await createOrder({ ...base, newCustomer: { name: `QA Muddat ${T}` }, prepay: { amount: 700000 } }, sotuv.id);
check("Q20 usul berilmasa — CASH (agent, import, eski ilova)", (await req(od.id)).method === "CASH");
await db.paymentRequest.update({ where: { orderId: od.id }, data: { dueDate: new Date(Date.now() - 3 * 86400000) } });
const counts = await payReqCounts(["CASH"]);
const overdue = await listPaymentRequests("overdue", ["CASH"]);
check("Q21 «Muddati o'tgan» filtri: muddati 3 kun oldin bo'lgan ochiq so'rov chiqadi", overdue.some((q) => q.order.id === od.id && q.overdue) && counts.overdue >= 1, counts);
const done = await listPaymentRequests("done", ["CASH"]);
check("Q22 «Tugallanganlar»da yopilgan naqd so'rov bor, bank so'rovi kassirga ko'rinmaydi", done.some((q) => q.order.id === o.id) && !done.some((q) => q.order.id === ob.id));
await orderCancel(od.id, sotuv.id);
check("Q23 zayavka bekor — so'rov CANCELLED", (await req(od.id)).status === "CANCELLED");
x = await receivePaymentRequest({ requestId: (await req(od.id)).id, cashAccountId: kassa.id, amount: 1000, date: new Date() }, S(kassir));
check("Q24 bekor so'rovga pul qabul qilinmaydi", /bekor/.test(x.error ?? ""), x);
const hist = await listPaymentRequests("history", ["CASH"]);
check("Q25 «Tarix»da bekor va qabul qilinganlar", hist.some((q) => q.order.id === od.id) && hist.some((q) => q.order.id === o.id));

await db.$disconnect();
summary("pul-qabul:");
