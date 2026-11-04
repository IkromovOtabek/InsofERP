// QA (B) — Jo'natmalar: mexanik (avto zapchastni o'zi olib keladi) ham snabjenets kabi jo'natma jo'natadi,
// sklad qabul qiladi — kirim bo'lib tushadi. Mexanik skladga o'zi kirim qila olmaydi va qabul qilmaydi;
// jo'natuvchilar faqat o'z jo'natmalarini ko'radi.
//   QA_DB=postgresql://…/insof_test_b QA_BASE=http://localhost:3202 node scripts/qa/b-shipments.mjs
import { as, check, fd, idFrom, q1, n1, summary } from "./b-client.mjs";

const mex = await as("mexanik"), snab = await as("snab"), sklad = await as("sklad");
const sup = q1(`select id from "Supplier" where "isActive" order by "createdAt" limit 1`);
const wh = q1(`select id from "Warehouse" where "isActive" order by "isDefault" desc, "name" limit 1`);
const mat = q1(`select id from "Material" where "isActive" order by "createdAt" limit 1`);
const today = q1(`select to_char(now(), 'YYYY-MM-DD')`);
check(!!(sup && wh && mat), "spravochnik: yetkazuvchi, sklad, xomashyo bor", { sup, wh, mat });

const SAVE = "(app)/jonatma/actions#saveShipmentAction";
const ACCEPT = "(app)/jonatma/actions#acceptShipmentAction";
// Ruxsat rad etildi (requireAction) — oddiy forma xatosi bu hisobga kirmaydi
const denied = (r) => r.forbidden || /ruxsat/i.test(r.error ?? "");
const ship = (c, intent, qty) => c.action(SAVE, [undefined, fd({
  supplierId: sup, warehouseId: wh, date: today, waybillNo: `QA-${Date.now()}`, carrier: "QA", intent,
  items: JSON.stringify([{ materialId: mat, qty, price: 1000 }]),
})], "/jonatma/new");

// ── 1. Sahifalar: Jo'natmalar ochiq, Kirim yopiq ──
{
  const list = await mex.get("/jonatma");
  check(list.status === 200 && list.text.includes("Mening jo") && list.text.includes("Yangi jo"), "mexanik: /jonatma — «Mening jo'natmalarim» va «Yangi jo'natma»", { s: list.status, l: list.location });
  const nw = await mex.get("/jonatma/new");
  check(nw.status === 200, "mexanik: /jonatma/new ochiladi", { s: nw.status, l: nw.location });
  for (const p of ["/receipts", "/stock/prixod"]) {
    const r = await mex.get(p);
    check(r.status !== 200, `mexanik: ${p} yopiq`, { s: r.status, l: r.location });
  }
}

// ── 2. Mexanik jo'natadi, sklad qabul qiladi ──
const mexRes = await ship(mex, "send", 2);
const mexId = idFrom(mexRes.redirect);
check(!!mexId && !mexRes.error, "mexanik: jo'natma saqlandi va jo'natildi", { r: mexRes.redirect, e: mexRes.error });
const mexUser = q1(`select id from "User" where login = 'test.mexanik'`);
check(q1(`select status::text from "SupplyShipment" where id = '${mexId}'`) === "SENT", "jo'natma holati SENT");
check(q1(`select "createdById" from "SupplyShipment" where id = '${mexId}'`) === mexUser, "jo'natma egasi — mexanik");

// ── 3. Ko'rinish: jo'natuvchilar faqat o'zinikini, sklad hammasini ──
const snabRes = await ship(snab, "draft", 1);
const snabId = idFrom(snabRes.redirect);
check(!!snabId && !snabRes.error, "snabjenets: qoralama saqlandi", { r: snabRes.redirect, e: snabRes.error });
const snabDoc = q1(`select "docNo" from "SupplyShipment" where id = '${snabId}'`);
const mexDoc = q1(`select "docNo" from "SupplyShipment" where id = '${mexId}'`);
check((await mex.get(`/jonatma/${snabId}`)).status !== 200, "mexanik snabjenets jo'natmasini ochmaydi");
check(!(await mex.get("/jonatma?tab=all")).text.includes(snabDoc), "mexanik ro'yxatida snabjenetsniki yo'q");
check((await snab.get(`/jonatma/${mexId}`)).status !== 200, "snabjenets mexanik jo'natmasini ochmaydi");
check((await mex.get(`/jonatma/${mexId}`)).status === 200, "mexanik o'z jo'natmasini ochadi");
const skladView = await sklad.get(`/jonatma/${mexId}`);
check(skladView.status === 200 && skladView.text.includes(mexDoc), "sklad mexanik jo'natmasini ko'radi");

// ── 4. Qabul — faqat sklad; kirim mexanik nomidan (olib kelgan) yoziladi ──
const item = q1(`select id from "SupplyShipmentItem" where "shipmentId" = '${mexId}'`);
const accForm = () => fd({ id: mexId, item, [`qty_${item}`]: 2 });
const mexAcc = await mex.action(ACCEPT, [undefined, accForm()], `/jonatma/${mexId}`);
check(denied(mexAcc), "mexanik o'z jo'natmasini qabul qila olmaydi", { e: mexAcc.error, s: mexAcc.status });
const before = n1(`select count(*) from "GoodsReceipt"`);
const acc = await sklad.action(ACCEPT, [undefined, accForm()], `/jonatma/${mexId}`);
check(acc.ok && !acc.error, "sklad qabul qildi", { e: acc.error, t: acc.text.slice(0, 200) });
check(n1(`select count(*) from "GoodsReceipt"`) === before + 1, "skladga bitta kirim tushdi");
check(q1(`select "buyerId" from "GoodsReceipt" order by "createdAt" desc limit 1`) === mexUser, "kirimda «Kim olib keldi» — mexanik");
check(q1(`select status::text from "SupplyShipment" where id = '${mexId}'`) === "DONE", "jo'natma yakunlandi (DONE)");

// ── 5. Mexanik skladga to'g'ridan-to'g'ri kirim qila olmaydi ──
const rec = await mex.action("(app)/receipts/actions#createReceipt", [undefined, fd({ supplierId: sup, warehouseId: wh, date: today })], "/jonatma");
check(denied(rec), "mexanik: kirim (createReceipt) rad etildi", { e: rec.error, s: rec.status });

summary("b-shipments");
