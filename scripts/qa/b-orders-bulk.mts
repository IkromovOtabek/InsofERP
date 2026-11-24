// QA (B) — 7 kundan ortiq ochiq zayavkalar (Sarvar rejasi 2-bosqich): Zayavkalar → «7 kundan ortiq ochiq» ko'rinishi va
// ommaviy amal (`orders/bulk-actions.ts`): sabab majburiy, ruxsat «orders → cancel», o'tmaydiganlari sababi bilan qaytadi.
// Ishga tushirish: npx tsx scripts/qa/b-orders-bulk.mts
import { as, check, summary, fd, q, q1 } from "./b-client.mjs";

const BA = "(app)/orders/bulk-actions";
const sotuv = await as("sotuv"), sklad = await as("sklad"), dir = await as("direktor");

// Bekor qilsa bo'ladigan eski zayavka: reys, zames, brigada qaydi, schyot yo'q
const free = q(`select o.id, o."orderNo" from "Order" o where o.kind='SALE' and o.status in ('CONFIRMED','DRAFT')
  and not exists (select 1 from "Trip" t where t."orderId"=o.id) and not exists (select 1 from "ProductionBatch" b where b."orderId"=o.id)
  and not exists (select 1 from "Invoice" i where i."orderId"=o.id) and not exists (select 1 from "TaskProgress" p join "BrigadeTask" k on k.id=p."taskId" where k."orderId"=o.id)
  order by o."createdAt" limit 1`)[0];
// Bekor qilib bo'lmaydigan eski zayavka: reysi bor
const busy = q(`select o.id, o."orderNo" from "Order" o where o.kind='SALE' and o.status in ('CONFIRMED','IN_PRODUCTION')
  and exists (select 1 from "Trip" t where t."orderId"=o.id and t.status <> 'CANCELLED') order by o."createdAt" limit 1`)[0];
if (!free) { check(false, "bekor qilsa bo'ladigan zayavka topilmadi (test bazasi)"); summary("b-orders-bulk"); process.exit(); }
const ids = [free[0], ...(busy ? [busy[0]] : [])];
q(`update "Order" set date = now() - interval '10 days' where id in (${ids.map((x) => `'${x}'`).join(",")})`);

let page = await dir.get("/orders");
check(page.status === 200 && /kundan ortiq ochiq/.test(page.text), "Zayavkalar sahifasida «7 kundan ortiq ochiq» filtri");
page = await sotuv.get("/orders?ochiq=1");
check(page.status === 200 && page.text.includes(free[1]) && /Bekor qilish/.test(page.text) && page.text.includes('name="ids"'), "ochiq ko'rinish: eski zayavka va ommaviy amal tugmalari");

let r = await sotuv.action(`${BA}#bulkCloseOrders`, [undefined, fd({ mode: "cancel", reason: "", ids })], "/orders?ochiq=1");
check(!r.ok && /Sababni/.test(r.error ?? ""), "sababsiz rad etildi", r.error);
r = await sklad.action(`${BA}#bulkCloseOrders`, [undefined, fd({ mode: "cancel", reason: "QA sanoq", ids })], "/orders?ochiq=1");
check(!r.ok, "sklad ommaviy bekor qila olmaydi");
r = await sotuv.action(`${BA}#bulkCloseOrders`, [undefined, fd({ mode: "cancel", reason: "QA: takror kiritilgan", ids })], "/orders?ochiq=1");
check(r.ok && !q1(`select id from "Order" where id='${free[0]}'`), "bo'sh eski zayavka bekor qilindi (bazadan o'chdi)", r.error);
if (busy) {
  check(!!q1(`select id from "Order" where id='${busy[0]}'`) && /o'zgarmadi/.test(r.text) && r.text.includes(busy[1]), "reysi bor zayavka bekor qilinmadi — sababi bilan qaytdi", r.text.slice(0, 300));
  r = await sotuv.action(`${BA}#bulkCloseOrders`, [undefined, fd({ mode: "auto", reason: "QA avtomatik", ids: [busy[0]] })], "/orders?ochiq=1");
  const st = q1(`select status from "Order" where id='${busy[0]}'`);
  check(r.ok ? ["DELIVERED", "CLOSED"].includes(st ?? "") : !!r.error, "avtomatik rejim: reysi bor zayavka yetkazilganicha yopiladi yoki sababi bilan rad etiladi", r.error ?? st);
}
summary("b-orders-bulk");
