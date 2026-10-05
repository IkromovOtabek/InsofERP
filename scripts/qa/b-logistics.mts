// QA (B) — logistika: zames → reys (tayyorlik), yuklash (SHIPMENT, sklad tanlash), yo'l, yetkazish, muammo, yopish,
// dona mahsulot qaytishi (o'sha skladga), nakladnoy chop etish + /verify QR, yoqilg'i va xarajat, haydovchi sahifasi.
// Ishga tushirish: npx tsx scripts/qa/b-logistics.mts
import { as, check, summary, fd, q, q1, n1, idFrom, token, BASE } from "./b-client.mjs";

const TA = "(app)/trips/actions";
const main = q1(`select id from "Warehouse" where "isDefault" limit 1`)!;
let wh2 = q1(`select id from "Warehouse" where name like 'QA sklad%' and "isActive" limit 1`);
const pbal = (p: string, w: string) => n1(`select coalesce(sum(qty),0) from "StockMove" where "productId"='${p}' and "warehouseId"='${w}'`);
const sklad = await as("sklad"), ishlab = await as("ishlab"), logist = await as("logistika"), dir = await as("direktor"), hay = await as("haydovchi"), mex = await as("mexanik");
const today = new Date().toISOString().slice(0, 10);
const sup = q1(`select id from "Supplier" where "isActive" limit 1`)!;
if (!wh2) {
  const name = `QA sklad L${Date.now() % 100000}`;
  await dir.action("(app)/settings/actions#saveWarehouse", [null, undefined, fd({ name, isActive: "on" })], "/settings");
  wh2 = q1(`select id from "Warehouse" where name='${name}'`)!;
}

// Xomashyo: ikkinchi skladga yetarli kirim (zames shu skladdan bo'ladi)
const mats = q(`select id, code from "Material" where code in ('CEM','SAND','GR520','WATER','ADD')`);
const rf = fd({ clientToken: token(), supplierId: sup, warehouseId: wh2, date: today });
for (const [id] of mats) { rf.append("materialId[]", id); rf.append("qty[]", "50000"); rf.append("price[]", "100"); }
let r = await sklad.action("(app)/receipts/actions#createReceipt", [undefined, rf], "/receipts/new");
check(!!idFrom(r.redirect), "ikkinchi skladga xomashyo kirimi", r.error);

// Beton zayavka: CONFIRMED, bitta M300 qatori, reyssiz
const row = q(`select o.id, o."orderNo", i."qtyM3", p.id from "Order" o join "OrderItem" i on i."orderId"=o.id join "Product" p on p.id=i."productId"
  where o.status='CONFIRMED' and p.code='M300' and (select count(*) from "OrderItem" x where x."orderId"=o.id)=1 and (select count(*) from "Trip" t where t."orderId"=o.id)=0 order by o."orderNo" desc limit 1`)[0];
if (!row) { check(false, "M300 zayavka topilmadi"); summary("b-logistics"); process.exit(); }
const [oid, , , M300] = row;
const mixer = q1(`select id from "Vehicle" where type='MIXER' and status='ACTIVE' and "capacityM3">=8 and ("inspectionUntil" is null or "inspectionUntil">now()) order by "capacityM3" limit 1`)!;
const repair = q1(`select id from "Vehicle" where status='REPAIR' limit 1`);
const pump = q1(`select id from "Vehicle" where type='PUMP' limit 1`);
const truck = q1(`select id from "Vehicle" where type='TRUCK' limit 1`)!;
const driver = q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login='test.haydovchi'`)!;
const notDriver = q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login='test.sklad'`) ?? q1(`select id from "Employee" where position not ilike '%haydovchi%' and "isActive" limit 1`)!;

// Zames yo'q — reys ochilmaydi, beton uchun tushunarli xabar
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: 5 })], "/trips/new");
check(/zames|tayyor/.test(r.error ?? ""), "zamessiz reys rad etildi (aniq xabar)", r.error);
// Zames 8 m³ ikkinchi skladdan (asosiyda M300 yo'q)
const mainM300 = pbal(M300, main);
r = await ishlab.action("(app)/production/actions#createBatch", [undefined, fd({ orderId: oid, productId: M300, warehouseId: wh2, qtyM3: 8, shift: 1 })], "/production/new");
check(!!idFrom(r.redirect), "zames 8 m³ (ikkinchi sklad)", r.error ?? r.text.slice(0, 150));
check(Math.abs(pbal(M300, wh2) - 8) < 0.001 || pbal(M300, wh2) >= 8, "M300 ikkinchi skladda", pbal(M300, wh2));

// Reys ochish: tekshiruvlar
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: 9 })], "/trips/new");
check(!!r.error, "tayyordan (8) ko'p reys rad etildi", r.error);
if (repair) { r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: repair, driverId: driver, qtyM3: 5 })], "/trips/new"); check(/ta'mir/.test(r.error ?? ""), "ta'mirdagi mikser rad etildi", r.error); }
if (pump) { r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: pump, driverId: driver, qtyM3: 5 })], "/trips/new"); check(/Nasos/.test(r.error ?? ""), "nasos rad etildi", r.error); }
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: truck, driverId: driver, qtyM3: 5 })], "/trips/new");
check(/mikser/.test(r.error ?? ""), "beton yuk mashinada rad etildi", r.error);
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: notDriver, qtyM3: 5 })], "/trips/new");
check(/haydovchi/.test(r.error ?? ""), "haydovchi bo'lmagan xodim rad etildi", r.error);
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: 5, plannedAt: "2026-13-45T99:99" })], "/trips/new");
check(!!r.error && !/prisma|Invalid/i.test(r.error), "noto'g'ri reja vaqti — o'zbekcha xato", r.error);
r = await sklad.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: 5 })], "/trips/new");
check(!r.ok && !r.redirect, "sklad reys ocha olmaydi");
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: "6", note: "QA" })], "/trips/new");
const t1 = idFrom(r.redirect)!;
check(!!t1, "logistika reys ochdi (6 m³)", r.error ?? r.text.slice(0, 200));
// ikkinchi reys 2 m³ — keyin bekor
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: 2 })], "/trips/new");
const t2 = idFrom(r.redirect)!;
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: 1 })], "/trips/new");
check(!!r.error, "tayyor hajm tugadi — uchinchi reys rad etildi", r.error);
await logist.action(`${TA}#cancelTrip`, [t2], `/trips/${t2}`);
check(q1(`select status from "Trip" where id='${t2}'`) === "CANCELLED", "ikkinchi reys bekor qilindi");

// Haydovchi sahifasi — o'z reysi ko'rinadi
let page = await hay.get("/mening-reyslarim");
const note1 = q1(`select "deliveryNoteNo" from "Trip" where id='${t1}'`)!;
check(page.status === 200 && page.text.includes(note1), "haydovchi /mening-reyslarim da reysni ko'radi", page.status);

// Yuklash: logistika emas, ishlab chiqarish
r = await logist.action(`${TA}#markLoaded`, [t1], `/trips/${t1}`);
check(!r.ok, "logistika yuklash belgilay olmaydi");
r = await logist.action(`${TA}#markOnRoad`, [t1], `/trips/${t1}`);
check(/yuklangan/.test(r.error ?? ""), "yuklanmagan reys yo'lga chiqmaydi", r.error);
r = await ishlab.action(`${TA}#markLoaded`, [t1], `/trips/${t1}`);
check(r.ok, "ishlab yukladi", r.error);
const ship = q(`select "warehouseId", qty from "StockMove" where "refId"='${t1}' and type='SHIPMENT'`);
check(ship.length === 1 && ship[0][0] === wh2 && Number(ship[0][1]) === -6, "SHIPMENT −6 m³ — qoldig'i bor (ikkinchi) skladdan", ship);
check(Math.abs(pbal(M300, main) - mainM300) < 0.001, "asosiy sklad qoldig'iga tegilmadi");
r = await ishlab.action(`${TA}#markLoaded`, [t1], `/trips/${t1}`);
check(q(`select count(*) from "StockMove" where "refId"='${t1}' and type='SHIPMENT'`)[0][0] === "1", "ikkinchi 'Yuklandi' qayta chiqim yozmadi");
r = await logist.action(`${TA}#cancelTrip`, [t1], `/trips/${t1}`);
check(q1(`select status from "Trip" where id='${t1}'`) === "LOADED", "yuklangan reysni bekor qilib bo'lmaydi");
r = await logist.action(`${TA}#markOnRoad`, [t1], `/trips/${t1}`);
check(r.ok && q1(`select status from "Trip" where id='${t1}'`) === "ON_ROAD", "yo'lga chiqdi", r.error);
r = await logist.action(`${TA}#markDelivered`, [t1, undefined, fd({ receiverName: "" })], `/trips/${t1}`);
check(/qabul/.test(r.error ?? ""), "qabul qiluvchisiz yetkazish rad etildi", r.error);
r = await logist.action(`${TA}#markDelivered`, [t1, undefined, fd({ receiverName: "Prorab Aliyev", acceptedQty: "7", returnedQty: "0" })], `/trips/${t1}`);
check(/oralig/.test(r.error ?? ""), "yuklangandan ko'p qabul rad etildi", r.error);
r = await logist.action(`${TA}#markDelivered`, [t1, undefined, fd({ receiverName: "Prorab Aliyev", acceptedQty: "5,5", returnedQty: "0,5" })], `/trips/${t1}`);
check(r.ok && q1(`select status from "Trip" where id='${t1}'`) === "DELIVERED", "yetkazildi (5,5 qabul, 0,5 qaytdi)", r.error);
check(n1(`select count(*) from "StockMove" where "refId"='${t1}' and type='ADJUSTMENT'`) === 0, "beton qaytgani skladga kirim qilinmadi (chiqindi)");
// Yopish: dispetcher belgilagani uchun ochiq muammo bor
r = await logist.action(`${TA}#closeTrip`, [t1, undefined, fd({})], `/trips/${t1}`);
check(/muammo/.test(r.error ?? ""), "ochiq muammo — yopish rad etildi", r.error);
const issue = q1(`select id from "TripIssue" where "tripId"='${t1}' and "resolvedAt" is null`)!;
r = await logist.action(`${TA}#resolveIssue`, [issue, undefined, fd({ resolution: "Haydovchi telefonda tasdiqladi" })], `/trips/${t1}`);
check(r.ok, "muammo hal qilindi", r.error);
r = await logist.action(`${TA}#closeTrip`, [t1, undefined, fd({ acceptedQty: "5,5", returnedQty: "0,5" })], `/trips/${t1}`);
check(r.ok && !!q1(`select "closedAt" from "Trip" where id='${t1}'`), "reys yopildi", r.error);

// Yoqilg'i va xarajat
r = await logist.action(`${TA}#addTripCost`, [t1, undefined, fd({ what: "FUEL", fuelType: "DIESEL", liters: "60,5", pricePerL: "11 500" })], `/trips/${t1}`);
check(r.ok && n1(`select amount from "FuelLog" where "tripId"='${t1}'`) === Math.round(60.5 * 11500), "reysga yoqilg'i yozildi", r.error);
r = await logist.action(`${TA}#addTripCost`, [t1, undefined, fd({ what: "FUEL", liters: "5000", pricePerL: "11500" })], `/trips/${t1}`);
check(/litr/.test(r.error ?? ""), "5000 litr rad etildi", r.error);
r = await logist.action(`${TA}#addTripCost`, [t1, undefined, fd({ what: "ROAD", amount: "45 000", note: "QA yo'l" })], `/trips/${t1}`);
check(r.ok, "reysga yo'l xarajati", r.error);
r = await logist.action("(app)/logistika/actions#addExpense", [undefined, fd({ kind: "OTHER", amount: "1000", driverId: "yoq-xodim" })], "/logistika/xarajatlar");
check(!!r.error && !r.forbidden, "mavjud bo'lmagan haydovchiga xarajat — aniq xato (500 emas)", r.error);
r = await logist.action("(app)/logistika/actions#addFuel", [undefined, fd({ vehicleId: mixer, driverId: "yoq-xodim", liters: "10", pricePerL: "11000" })], "/logistika/yoqilgi");
check(!!r.error && !r.forbidden, "mavjud bo'lmagan haydovchiga yoqilg'i — aniq xato", r.error);
r = await mex.action("(app)/logistika/actions#addExpense", [undefined, fd({ kind: "REPAIR", amount: "250000", vehicleId: mixer })], `/logistika/transport/${mixer}`);
check(r.ok, "mexanik ta'mir xarajatini yozdi", r.error);
r = await mex.action("(app)/logistika/actions#addExpense", [undefined, fd({ kind: "FINE", amount: "250000", vehicleId: mixer })], `/logistika/transport/${mixer}`);
check(/Mexanik/.test(r.error ?? ""), "mexanik jarima yoza olmaydi", r.error);

// Nakladnoy: chop etish va QR /verify
page = await logist.get(`/trips/${t1}/print`);
check(page.status === 200 && page.text.includes(note1), "nakladnoy chop etish sahifasi", page.status);
const vt = q1(`select "verifyToken" from "Trip" where id='${t1}'`)!;
const anon = async (p: string) => { const res = await fetch(BASE + p, { redirect: "manual" }); return { status: res.status, text: await res.text() }; };
let v = await anon(`/verify/${encodeURIComponent(note1)}?k=${vt}`);
const cust = (q1(`select c.name from "Customer" c join "Order" o on o."customerId"=c.id where o.id='${oid}'`) ?? "").split(/["'&<>]/).sort((a, b) => b.length - a.length)[0].trim();
check(v.status === 200 && v.text.includes(note1) && v.text.includes(cust), "/verify kalit bilan — nakladnoy va mijoz", v.status);
check(page.text.includes(`k=${vt}`), "chop etishdagi QR havolasida kalit bor");
v = await anon(`/verify/${encodeURIComponent(note1)}`);
check(v.status !== 500 && !v.text.includes(cust), "/verify kalitsiz — ma'lumot oshkor qilinmaydi", v.status);
v = await anon(`/verify/${encodeURIComponent(note1)}?k=notogri`);
check(v.status !== 500 && !v.text.includes(cust), "/verify noto'g'ri kalit — ma'lumot yo'q", v.status);
v = await anon(`/verify/N-0000-99999`);
check(v.status !== 500, "/verify mavjud bo'lmagan raqam — 500 emas", v.status);

// Dona mahsulot reysi: tayyor (DONE) topshiriqli zayavka, yuk mashina, qaytgan qism o'sha skladga
const piece = q(`select o.id, p.id, t."doneQty" from "Order" o join "OrderItem" i on i."orderId"=o.id join "Product" p on p.id=i."productId" join "BrigadeTask" t on t."orderItemId"=i.id
  where o.status in ('CONFIRMED','IN_PRODUCTION') and p.unit<>'m3' and t."doneQty" > 0 and (select count(*) from "OrderItem" x where x."orderId"=o.id)=1 limit 1`)[0];
if (piece) {
  const [poid, ppid, done] = piece;
  const shippedQty = Math.min(4, Number(done));
  r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: poid, vehicleId: truck, driverId: driver, qtyM3: shippedQty })], "/trips/new");
  const t3 = idFrom(r.redirect);
  check(!!t3, `dona reys ochildi (${shippedQty})`, r.error);
  if (t3) {
    r = await ishlab.action(`${TA}#markLoaded`, [t3], `/trips/${t3}`);
    check(r.ok, "dona reys yuklandi", r.error);
    const whS = q1(`select "warehouseId" from "StockMove" where "refId"='${t3}' and type='SHIPMENT'`)!;
    const b0 = pbal(ppid, whS);
    r = await logist.action(`${TA}#markDelivered`, [t3, undefined, fd({ receiverName: "QA", returnedQty: "1" })], `/trips/${t3}`);
    check(r.ok && Math.abs(pbal(ppid, whS) - b0 - 1) < 0.001, "qaytgan 1 dona yuklangan skladga kirim qilindi", r.error);
    const iss = q1(`select id from "TripIssue" where "tripId"='${t3}' and "resolvedAt" is null`);
    if (iss) await logist.action(`${TA}#resolveIssue`, [iss, undefined, fd({ resolution: "ok" })], `/trips/${t3}`);
    r = await logist.action(`${TA}#closeTrip`, [t3, undefined, fd({ returnedQty: "0" })], `/trips/${t3}`);
    check(r.ok && Math.abs(pbal(ppid, whS) - b0) < 0.001, "yopishda qaytgan 1 → 0: ortiqcha kirim qaytarildi", r.error ?? pbal(ppid, whS) - b0);
  }
} else console.log("   info: tayyor dona zayavka topilmadi — dona reys o'tkazib yuborildi");

// Logistika sahifalari (logistika, direktor, mexanik, buxgalteriya)
for (const p of ["/trips", `/trips/${t1}`, "/logistika/analitika", "/logistika/hisobotlar", "/logistika/nakladnoylar", "/logistika/yoqilgi", "/logistika/xarajatlar", "/logistika/kalendar", "/logistika/monitoring", "/logistika/yetkazish", "/logistika/buyurtmalar", `/logistika/transport/${mixer}`, `/logistika/haydovchilar/${driver}`]) {
  for (const [name, c] of [["logistika", logist], ["direktor", dir]] as const) {
    const g = await c.get(p);
    check(g.status === 200, `${name} ${p} → ${g.status}`);
  }
}
summary("b-logistics");
process.exit();
