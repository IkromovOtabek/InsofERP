// QA (B) — ta'minot zanjiri: snab so'rovi → narx → direktor (limitdan katta) → sotuv tasdig'i → moliya → qisman qabul → sklad
import { as, check, summary, fd, q, q1, n1, idFrom } from "./b-client.mjs";

const SA = "lib/supply-actions";
const wh = q1(`select id from "Warehouse" where "isDefault" limit 1`);
const bank = q1(`select id from "CashAccount" where type='BANK' and "isActive" limit 1`);
const cem = q(`select id, unit from "Material" where code='CEM'`)[0];
const sand = q(`select id, unit from "Material" where code='SAND'`)[0];
const sup = q1(`select id from "Supplier" where "isActive" order by name limit 1`);
const limit = n1(`select "supplyDirectorLimit" from "CompanySettings" limit 1`);
const bal = (mid, w = wh) => n1(`select coalesce(sum(qty),0) from "StockMove" where "materialId"='${mid}' and "warehouseId"='${w}'`);

const snab = await as("snab"), dir = await as("direktor"), sotuv = await as("sotuv"), fin = await as("finance"), sklad = await as("sklad");
const newMat = `Armatura QA ${Date.now() % 100000}`;

// 1) So'rov (snab)
const rows = [
  { materialId: cem[0], name: "Sement M400", unit: "t", qty: 20 },
  { materialId: sand[0], name: "Qum", unit: "kg", qty: 30000 },
  { materialId: null, name: newMat, unit: "t", qty: 2 },
];
let r = await snab.action(`${SA}#createRequest`, [undefined, fd({ warehouseId: wh, rows: JSON.stringify(rows), department: "Sklad", priority: "HIGH", note: "QA" })], "/stock/supply/new");
const sid = idFrom(r.redirect);
check(!!sid && !r.error, "snab so'rov yaratdi", r.error ?? r.text.slice(0, 200));
const items = q(`select id, name, unit, qty from "SupplyRequestItem" where "requestId"='${sid}' order by "sortOrder"`);
check(items.length === 3 && items[0][2] === "t", "3 qator, sement birligi t saqlandi", items);

// Noto'g'ri birlik (sement kg ↔ l emas)
r = await snab.action(`${SA}#createRequest`, [undefined, fd({ warehouseId: wh, rows: JSON.stringify([{ materialId: cem[0], name: "Sement", unit: "l", qty: 5 }]) })], "/stock/supply/new");
check(!!r.error && /birligi/.test(r.error), "noto'g'ri birlik rad etildi", r.error);

// 2) Narx (snab): 20 t × 1 200 000 + 30000 kg × 100 + 2 t × 9 000 000 + dostavka 6 000 000 = 51 000 000 (≥ limit)
const price = fd({ supplierId: sup, deliveryKind: "Yetkazuvchi yetkazadi", deliveryCost: "6 000 000" });
const prices = [1_200_000, 100, 9_000_000];
items.forEach(([id, , , qty], i) => { price.append(`price_${id}`, String(prices[i])); price.append(`qty_${id}`, qty); });
r = await snab.action(`${SA}#setPrices`, [sid, undefined, price], `/taminot/${sid}`);
check(r.ok, "snab narx qo'ydi", r.error);
check(q1(`select status from "SupplyRequest" where id='${sid}'`) === "PRICED", "holat PRICED");
const total = 20 * 1_200_000 + 30000 * 100 + 2 * 9_000_000 + 6_000_000;
check(limit > 0 && total >= limit, `jami ${total} ≥ limit ${limit}`);

// 3) Sotuv direktorsiz tasdiqlay olmaydi
r = await sotuv.action(`${SA}#approve`, [sid, undefined, fd({})], `/taminot/${sid}`);
check(!!r.error && /direktor/.test(r.error), "limitdan katta — sotuv direktorsiz tasdiqlay olmaydi", r.error);
// snab direktor tasdig'ini bera olmaydi
r = await snab.action(`${SA}#directorApprove`, [sid, undefined, fd({})], `/taminot/${sid}`);
check(!r.ok, "snab direktor tasdig'ini bera olmaydi", r.text.slice(0, 120));
r = await dir.action(`${SA}#directorApprove`, [sid, undefined, fd({ note: "ok" })], `/taminot/${sid}`);
check(r.ok, "direktor tasdiqladi", r.error);
r = await sotuv.action(`${SA}#approve`, [sid, undefined, fd({})], `/taminot/${sid}`);
check(r.ok, "sotuv tasdiqladi", r.error);
// Ikki marta tasdiq — rad
r = await sotuv.action(`${SA}#approve`, [sid, undefined, fd({})], `/taminot/${sid}`);
check(!!r.error, "qayta tasdiq rad etildi", r.text.slice(0, 120));

// 4) Moliya — sklad pul ajrata olmaydi
r = await sklad.action(`${SA}#fund`, [sid, undefined, fd({ cashAccountId: bank })], `/taminot/${sid}`);
check(!r.ok, "sklad pul ajrata olmaydi");
r = await fin.action(`${SA}#fund`, [sid, undefined, fd({ cashAccountId: bank })], `/taminot/${sid}`);
check(r.ok, "moliya pul ajratdi", r.error);
const ctx = q(`select "cashTxId" from "SupplyRequest" where id='${sid}'`)[0][0];
check(n1(`select amount from "CashTransaction" where id='${ctx}'`) === total, "chiqim = reja summasi", n1(`select amount from "CashTransaction" where id='${ctx}'`));
r = await fin.action(`${SA}#fund`, [sid, undefined, fd({ cashAccountId: bank })], `/taminot/${sid}`);
check(!r.ok, "ikkinchi pul ajratish rad etildi");

// 5) Qisman qabul (snab): sement 18 t keldi, qum to'liq, armatura 2 t; narx o'zgarmagan
const cem0 = bal(cem[0]), sand0 = bal(sand[0]);
const recv = fd({ mode: "receive", supplierId: sup, deliveryFactCost: "6000000" });
const factQ = [18, 30000, 2];
items.forEach(([id], i) => { recv.append(`factQty_${id}`, String(factQ[i])); recv.append(`factPrice_${id}`, String(prices[i])); });
r = await snab.action(`${SA}#checkIn`, [sid, undefined, recv], `/taminot/${sid}`);
check(r.ok, "snab qisman qabul qildi", r.error);
const sreq = q(`select status, "receiptId" from "SupplyRequest" where id='${sid}'`)[0];
check(sreq[0] === "RECEIVED" && !!sreq[1], "holat RECEIVED, kirim hujjati bor", sreq);
check(Math.abs(bal(cem[0]) - cem0 - 18000) < 0.01, "sement +18 000 kg (t → kg o'girildi)", bal(cem[0]) - cem0);
check(Math.abs(bal(sand[0]) - sand0 - 30000) < 0.01, "qum +30 000 kg", bal(sand[0]) - sand0);
const cemCost = n1(`select "unitCost" from "StockMove" where "refId"='${sreq[1]}' and "materialId"='${cem[0]}'`);
check(Math.abs(cemCost - 1200) < 0.01, "sement tannarxi 1 200 so'm/kg", cemCost);
const newMatRow = q(`select id, unit from "Material" where name='${newMat}'`)[0];
check(!!newMatRow, "yangi xomashyo ochildi", newMatRow);
const factTotal = 18 * 1_200_000 + 30000 * 100 + 2 * 9_000_000 + 6_000_000;
check(n1(`select amount from "CashTransaction" where id='${ctx}'`) === factTotal, "chiqim fakt summaga tuzatildi", n1(`select amount from "CashTransaction" where id='${ctx}'`));
// Ta'minot kiritgan kirimni storno qilib bo'lmaydi (pul zanjirda)
r = await dir.action("(app)/receipts/actions#stornoReceipt", [sreq[1], "QA test storno"], `/receipts/${sreq[1]}`);
check(!!r.error && /ta'minot/.test(r.error), "ta'minot kirimi storno rad etildi", r.error);

// 6) Narx o'zgargan qabul — qayta tasdiqqa qaytadi
r = await snab.action(`${SA}#createRequest`, [undefined, fd({ warehouseId: wh, rows: JSON.stringify([{ materialId: sand[0], name: "Qum", unit: "kg", qty: 1000 }]) })], "/stock/supply/new");
const sid2 = idFrom(r.redirect);
const it2 = q1(`select id from "SupplyRequestItem" where "requestId"='${sid2}'`);
await snab.action(`${SA}#setPrices`, [sid2, undefined, fd({ supplierId: sup, [`price_${it2}`]: 100, [`qty_${it2}`]: 1000 })], `/taminot/${sid2}`);
await sotuv.action(`${SA}#approve`, [sid2, undefined, fd({})], `/taminot/${sid2}`);
await fin.action(`${SA}#fund`, [sid2, undefined, fd({ cashAccountId: bank })], `/taminot/${sid2}`);
r = await snab.action(`${SA}#checkIn`, [sid2, undefined, fd({ mode: "receive", [`factQty_${it2}`]: 1000, [`factPrice_${it2}`]: 130 })], `/taminot/${sid2}`);
check(r.ok && q1(`select status from "SupplyRequest" where id='${sid2}'`) === "PRICED", "narx o'zgardi → PRICED (qayta tasdiq)", r.error ?? r.text.slice(0, 150));
// Rad etish: sklad pul bosqichidagini bekor qila olmaydi (chiqim bor)
r = await sklad.action(`${SA}#reject`, [sid2, undefined, fd({ reason: "QA" })], `/taminot/${sid2}`);
check(!!r.error, "sklad chiqimi bor zayavkani bekor qila olmaydi", r.text.slice(0, 150));
r = await fin.action(`${SA}#reject`, [sid2, undefined, fd({ reason: "QA bekor" })], `/taminot/${sid2}`);
check(r.ok, "moliya bekor qildi", r.error);
const ct2 = q1(`select "cashTxId" from "SupplyRequest" where id='${sid2}'`);
// Pul ajratilgan zayavka bekor qilinsa chiqim o'chirilmaydi — "qaytarilishi kerak" belgisi bilan qoladi (lib/supply.ts qoidasi)
check(!!ct2 && /qaytarilishi kerak/.test(q1(`select note from "CashTransaction" where id='${ct2}'`) ?? ""), "bekor qilinganda chiqim 'yetkazuvchidan qaytarilishi kerak' belgisi bilan qoldi");

// 6b) Jadvalni tahrirlash: hamma qatorni 0 qilib bo'lmaydi (ilgari qatorlar o'chib, keyin xato chiqardi)
r = await snab.action(`${SA}#createRequest`, [undefined, fd({ warehouseId: wh, rows: JSON.stringify([{ materialId: sand[0], name: "Qum", unit: "kg", qty: 500 }]) })], "/stock/supply/new");
const sid3 = idFrom(r.redirect);
const it3 = q1(`select id from "SupplyRequestItem" where "requestId"='${sid3}'`);
r = await snab.action(`${SA}#editItems`, [sid3, undefined, fd({ [`qty_${it3}`]: 0 })], `/taminot/${sid3}`);
check(!!r.error && n1(`select count(*) from "SupplyRequestItem" where "requestId"='${sid3}'`) === 1, "hamma qatorni 0 qilish rad etildi, qator joyida", r.error);
r = await snab.action(`${SA}#setPrices`, [sid3, undefined, fd({ supplierId: "yoq-yetkazuvchi", [`price_${it3}`]: 100, [`qty_${it3}`]: 500 })], `/taminot/${sid3}`);
check(/Yetkazuvchi topilmadi/.test(r.error ?? ""), "mavjud bo'lmagan yetkazuvchi — aniq xato", r.error);

// 7) Sahifalar
for (const [c, p] of [[snab, `/taminot/${sid}`], [dir, `/taminot/${sid}`], [fin, `/taminot/${sid2}`], [snab, "/snabjeniye/hisobot"], [sklad, `/receipts/${sreq[1]}`]]) {
  const g = await c.get(p); check(g.status === 200, `${p} → ${g.status}`);
}
summary("b-supply");
