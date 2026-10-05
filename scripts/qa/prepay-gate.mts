// Bosh to'lov darvozasi (`prepayShortError`) — reys ochish (`createTrip`) va yuklash (`tripLoaded`) shu funksiyadan
// o'tadi. Summa endi `Order.prepayAmount` ustunidan o'qiladi (ilgari izoh matnidan regex bilan).
// Ishga tushirish: DATABASE_URL=postgresql://…/insof_test_x npx tsx scripts/qa/prepay-gate.mts
// @ts-expect-error — .mjs yordamchilari (tipsiz)
import { check, summary } from "./client.mjs";
import "./db.mjs"; // test bazasi himoyasi (nomi insof_test… bo'lmasa to'xtaydi)

const url = process.env.DATABASE_URL ?? "";
if (!/\/insof_test[^/]*$/.test(url.split("?")[0]) || /insof_test_golden/.test(url)) { console.error("DATABASE_URL test bazasi emas"); process.exit(2); }

const { db } = await import("../../src/lib/db");
const { createOrder, orderConfirm } = await import("../../src/lib/orders");
const { addPayment, prepayShortError, reversePayment } = await import("../../src/lib/payments");

const sotuv = await db.user.findFirstOrThrow({ where: { login: "test.sotuv" } });
const buh = await db.user.findFirstOrThrow({ where: { login: "test.buh" } });
const prod = await db.product.findFirstOrThrow({ where: { code: "M200" } });
const kassa = await db.cashAccount.findFirstOrThrow({ where: { type: "CASH", isActive: true }, orderBy: { name: "asc" } });
const T = Date.now().toString(36);
const tomorrow = new Date(Date.now() + 86400000);
const base = { deliveryDate: tomorrow, deliveryAddress: `QA darvoza ${T}`, items: [{ productId: prod.id, qtyM3: 3, price: 550000 }] };

const o = await createOrder({ ...base, newCustomer: { name: `QA Darvoza ${T}` }, prepay: { amount: 1000000 } }, sotuv.id);
const row = await db.order.findUniqueOrThrow({ where: { id: o.id } });
check("P1 prepayAmount = 1 000 000, izoh bo'sh", Number(row.prepayAmount) === 1000000 && row.note === null);
await orderConfirm(o.id, sotuv.id);
let err = await prepayShortError(db, o.id);
check("P2 to'lovsiz — reys ochilmaydi", /bosh to'lov 1 000 000/.test(err ?? ""), err);
const p1 = await addPayment({ customerId: o.customerId, orderId: o.id, cashAccountId: kassa.id, amount: 600000, date: new Date() }, buh.id);
err = await prepayShortError(db, o.id);
check("P3 qisman (600 000) — hali yopiq, qolgan 400 000", /qolgan 400 000/.test(err ?? ""), err);
await addPayment({ customerId: o.customerId, orderId: o.id, cashAccountId: kassa.id, amount: 400000.004, date: new Date() }, buh.id);
check("P4 to'liq — darvoza ochiq", (await prepayShortError(db, o.id)) === null);
const pay = await db.payment.findFirstOrThrow({ where: { orderId: o.id, amount: 400000 } });
check("P5 tiyindan mayda qism yaxlitlandi (400 000,004 → 400 000)", Number(pay.amount) === 400000);
await reversePayment(p1.id!, "QA storno", buh.id);
check("P6 storno — darvoza yana yopiq", /qolgan 600 000/.test((await prepayShortError(db, o.id)) ?? ""));
const credit = await createOrder({ ...base, newCustomer: { name: `QA Darvoza kredit ${T}` }, onCredit: true, prepay: { amount: 500000 } }, sotuv.id);
check("P7 qarzga zayavka — darvoza tekshirmaydi", (await prepayShortError(db, credit.id)) === null);
const none = await createOrder({ ...base, newCustomer: { name: `QA Darvoza 0 ${T}` } }, sotuv.id);
check("P8 bosh to'lovsiz naqd zayavka — prepayAmount null, darvoza ochiq", (await db.order.findUniqueOrThrow({ where: { id: none.id } })).prepayAmount === null && (await prepayShortError(db, none.id)) === null);
// Izohdagi eski matn endi hech narsaga ta'sir qilmaydi
const legacy = await createOrder({ ...base, newCustomer: { name: `QA Darvoza izoh ${T}` }, note: "Kutilayotgan avans: 9 999 999 so'm" }, sotuv.id);
check("P9 izohdagi «Kutilayotgan avans» matni darvozani yopmaydi", (await prepayShortError(db, legacy.id)) === null);

await db.$disconnect();
summary("prepay-gate:");
