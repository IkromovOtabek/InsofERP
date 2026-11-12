// QA (B) — logistika: zames → reys (tayyorlik), yuklash (SHIPMENT, sklad tanlash, betonga avto zames), yo'l, yetkazish, muammo, yopish,
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
const [oid, , qtyRaw, M300] = row;
const total = Number(qtyRaw);
const mixer = q1(`select id from "Vehicle" where type='MIXER' and status='ACTIVE' and "capacityM3">=8 and ("inspectionUntil" is null or "inspectionUntil">now()) order by "capacityM3" limit 1`)!;
const repair = q1(`select id from "Vehicle" where status='REPAIR' limit 1`);
const pump = q1(`select id from "Vehicle" where type='PUMP' limit 1`);
const truck = q1(`select id from "Vehicle" where type='TRUCK' limit 1`)!;
const driver = q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login='test.haydovchi'`)!;
const notDriver = q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login='test.sklad'`) ?? q1(`select id from "Employee" where position not ilike '%haydovchi%' and "isActive" limit 1`)!;

// Beton ishlab chiqarishga tushmaydi: zames kutilmaydi, reys faqat zayavka hajmidan oshmasin
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: total + 1 })], "/trips/new");
check(/qoldi/.test(r.error ?? "") && !/zames/.test(r.error ?? ""), "zayavka hajmidan ko'p beton reysi rad etildi (zames talab qilinmaydi)", r.error);
// Zames 8 m³ ikkinchi skladdan (asosiyda M300 yo'q)
const mainM300 = pbal(M300, main);
r = await ishlab.action("(app)/production/actions#createBatch", [undefined, fd({ orderId: oid, productId: M300, warehouseId: wh2, qtyM3: 8, shift: 1 })], "/production/new");
check(!!idFrom(r.redirect), "zames 8 m³ (ikkinchi sklad)", r.error ?? r.text.slice(0, 150));
check(Math.abs(pbal(M300, wh2) - 8) < 0.001 || pbal(M300, wh2) >= 8, "M300 ikkinchi skladda", pbal(M300, wh2));

// Reys ochish: tekshiruvlar
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
// TTN raqami reys ochilganda yoziladi («№» belgisi tashlanadi), takrori rad etiladi
const ttn1 = `QA${Date.now() % 1000000}`;
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: "6", note: "QA", ttn: `№ ${ttn1}` })], "/trips/new");
const t1 = idFrom(r.redirect)!;
check(!!t1, "logistika reys ochdi (6 m³)", r.error ?? r.text.slice(0, 200));
check(q1(`select ttn from "Trip" where id='${t1}'`) === ttn1, "reysga TTN yozildi («№» belgisisiz)", q1(`select ttn from "Trip" where id='${t1}'`));
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: 1, ttn: ttn1.toLowerCase() })], "/trips/new");
check(/allaqachon/.test(r.error ?? "") && !r.redirect, "takroriy TTN bilan reys ochilmadi", r.error);
// ikkinchi reys 2 m³ — keyin bekor
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: 2 })], "/trips/new");
const t2 = idFrom(r.redirect)!;
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: Math.round((total - 8 + 1) * 1000) / 1000 })], "/trips/new");
check(!!r.error, "zayavka hajmi tugadi — qoldiqdan ko'p uchinchi reys rad etildi", r.error);
await logist.action(`${TA}#cancelTrip`, [t2], `/trips/${t2}`);
// Bekor qilingan reys bazadan o'chiriladi (`lib/purge-cancelled.ts`), «kim o'chirdi» — AuditLog'da
check(n1(`select count(*) from "Trip" where id='${t2}'`) === 0 && n1(`select count(*) from "AuditLog" where entity='Trip' and "entityId"='${t2}' and action='DELETE'`) === 1, "ikkinchi reys bekor qilindi va o'chirildi");

// Ko'chadan chaqirilgan mashina (o'z parki band): mashina va haydovchi `external` + nofaol — park, kadr va ECO
// ro'yxatlariga kirmaydi, raqam/telefon bo'yicha qayta ishlatiladi; BRU faqat betonda saqlanadi va nakladnoyda chiqadi
r = await logist.action("(app)/logistika/actions#saveBruNames", [undefined, fd({ bruNames: "BRU-1\n BRU-2 \nBRU-1" })], "/logistika/sozlamalar");
check(r.ok && q1(`select array_to_string("bruNames", '|') from "CompanySettings" where id='main'`) === "BRU-1|BRU-2", "BRU ro'yxati saqlandi (takror va bo'shliqsiz)", r.error);
const extNo = Date.now() % 100000;
const extF = (o: Record<string, string | number> = {}) => fd({ orderId: oid, external: "1", extType: "MIXER", extPlate: `01 q ${extNo} xt`, extCapacity: "8", extDriverName: "QA Ko'cha Haydovchi", extDriverPhone: "90 777 66 55", qtyM3: 1, bru: "BRU-2", ...o });
r = await logist.action(`${TA}#createTrip`, [undefined, extF({ extDriverPhone: "12345" })], "/trips/new");
check(/telefon/.test(r.error ?? ""), "ko'chadan mashina: noto'g'ri telefon rad etildi", r.error);
r = await logist.action(`${TA}#createTrip`, [undefined, extF({ extPlate: q1(`select lower(plate) from "Vehicle" where id='${mixer}'`)! })], "/trips/new");
check(/o'z transportimiz/.test(r.error ?? ""), "o'z mashinamiz raqami ko'chadan sifatida rad etildi", r.error);
r = await logist.action(`${TA}#createTrip`, [undefined, extF({ extType: "TRUCK" })], "/trips/new");
check(/mikser/.test(r.error ?? ""), "ko'chadan yuk mashinada beton rad etildi", r.error);
r = await logist.action(`${TA}#createTrip`, [undefined, extF()], "/trips/new");
const tx1 = idFrom(r.redirect)!;
check(!!tx1, "ko'chadan mashina bilan beton reysi ochildi", r.error ?? r.text.slice(0, 200));
const extOf = (t: string) => q(`select v.id, v.plate, v.external, v."isActive", e.id, e.external, e."isActive", e.phone, coalesce(t.bru,'-') from "Trip" t
  join "Vehicle" v on v.id=t."vehicleId" join "Employee" e on e.id=t."driverId" where t.id='${t}'`)[0] ?? [];
const [xv, xplate, vExt, vAct, xe, eExt, eAct, ePhone, xbru] = extOf(tx1);
check(vExt === "t" && vAct === "f" && eExt === "t" && eAct === "f", "ko'chadan mashina va haydovchi external, nofaol", extOf(tx1));
check(xplate === `01Q${extNo}XT` && ePhone === "+998907776655" && xbru === "BRU-2", "raqam, telefon normallashdi; BRU yozildi", extOf(tx1));
// Ikkinchi chaqiruv — boshqacha yozilgan raqam va telefon bilan: o'sha mashina va haydovchi qayta ishlatiladi
r = await logist.action(`${TA}#createTrip`, [undefined, extF({ extPlate: `01Q${extNo}XT`, extDriverPhone: "+998 90 777 66 55", qtyM3: 0.5, bru: "" })], "/trips/new");
const tx2 = idFrom(r.redirect)!;
const again2 = extOf(tx2);
check(!!tx2 && again2[0] === xv && again2[4] === xe && again2[8] === "-", "ko'chadan mashina/haydovchi qayta ishlatildi (dublikat yo'q)", r.error ?? again2);
check(n1(`select count(*) from "Vehicle" where external and plate='01Q${extNo}XT'`) === 1, "ko'chadan mashina bitta yozuv");
let xp = await logist.get(`/trips/${tx1}/print`);
check(xp.status === 200 && xp.text.includes("BRU-2") && xp.text.includes("ko&#x27;chadan chaqirilgan") && xp.text.includes("+998907776655"), "nakladnoyda BRU, «ko'chadan chaqirilgan» va haydovchi telefoni", xp.status);
xp = await logist.get(`/trips/${tx1}`);
check(xp.status === 200 && xp.text.includes("Ko&#x27;chadan chaqirilgan mashina"), "reys kartasida ko'chadan mashina ogohlantirishi", xp.status);
xp = await logist.get("/logistika/transport");
check(xp.status === 200 && !xp.text.includes(`01Q${extNo}XT`), "Transport parkida ko'chadan mashina yo'q", xp.status);
xp = await dir.get("/employees");
check(xp.status === 200 && !xp.text.includes("QA Ko&#x27;cha Haydovchi"), "Xodimlar ro'yxatida ko'chadan haydovchi yo'q", xp.status);
xp = await logist.get("/trips/new");
check(xp.status === 200 && xp.text.includes(`01Q${extNo}XT`) && xp.text.includes("BRU-2"), "Yangi reys: avvalgi ko'chadan mashina va BRU ro'yxati", xp.status);
// Ro'yxatdan olish: mashina va reyslari bazada qoladi (hiddenAt + AuditLog), qayta chaqirilsa o'sha yozuv ro'yxatga qaytadi
r = await logist.action(`${TA}#hideExternalVehicle`, [xv], "/trips/new");
check(r.ok && q1(`select ("hiddenAt" is not null)::text from "Vehicle" where id='${xv}'`) === "true", "ko'chadan mashina ro'yxatdan olindi (hiddenAt)", r.error);
check(n1(`select count(*) from "Trip" where "vehicleId"='${xv}'`) === 2 && n1(`select count(*) from "AuditLog" where entity='Vehicle' and "entityId"='${xv}' and action='UPDATE'`) >= 1, "olingan mashina va reyslari bazada, AuditLog'da");
xp = await logist.get("/trips/new");
check(xp.status === 200 && !xp.text.includes(`01Q${extNo}XT`), "Yangi reys ro'yxatida olingan mashina yo'q", xp.status);
r = await logist.action(`${TA}#hideExternalVehicle`, [mixer], "/trips/new");
check(!!r.error && q1(`select ("hiddenAt" is null)::text from "Vehicle" where id='${mixer}'`) === "true", "o'z mashinamiz ro'yxatdan olinmaydi", r.error);
r = await logist.action(`${TA}#createTrip`, [undefined, extF({ qtyM3: 0.5 })], "/trips/new");
const tx3 = idFrom(r.redirect)!;
check(!!tx3 && extOf(tx3)[0] === xv && q1(`select ("hiddenAt" is null)::text from "Vehicle" where id='${xv}'`) === "true", "qayta chaqirilgan mashina ro'yxatga qaytdi (o'sha yozuv)", r.error ?? extOf(tx3));
for (const t of [tx1, tx2, tx3]) await logist.action(`${TA}#cancelTrip`, [t], `/trips/${t}`);
check(n1(`select count(*) from "Trip" where id in ('${tx1}','${tx2}','${tx3}')`) === 0, "ko'chadan mashina reyslari bekor qilindi (o'chirildi)");

// O'z haydovchisi bor texnikaga boshqa haydovchi: sababsiz rad etiladi, sabab reysda va AuditLog'da qoladi;
// texnikaning o'z haydovchisida sabab so'ralmaydi (yuborilsa ham yozilmaydi)
const mixer2 = q1(`select v.id from "Vehicle" v where v.type='MIXER' and v.status='ACTIVE' and v."isActive" and v.id<>'${mixer}' and ("inspectionUntil" is null or "inspectionUntil">now())
  and ("insuranceUntil" is null or "insuranceUntil">now()) and exists (select 1 from "Employee" e where e."vehicleId"=v.id and e."isActive" and e.id<>'${driver}') limit 1`);
if (mixer2) {
  r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer2, driverId: driver, qtyM3: 0.5 })], "/trips/new");
  check(/sabab/.test(r.error ?? ""), "boshqa texnikaning haydovchisi sababsiz rad etildi", r.error);
  r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer2, driverId: driver, qtyM3: 0.5, driverReason: "Asosiy haydovchi kasal" })], "/trips/new");
  const td1 = idFrom(r.redirect)!;
  check(!!td1 && q1(`select "driverReason" from "Trip" where id='${td1}'`) === "Asosiy haydovchi kasal"
    && q1(`select after->>'driverReason' from "AuditLog" where entity='Trip' and "entityId"='${td1}' and action='CREATE'`) === "Asosiy haydovchi kasal", "boshqa haydovchi sabab bilan: reysda va AuditLog'da", r.error ?? r.text.slice(0, 200));
  xp = await logist.get(`/trips/${td1}`);
  check(xp.status === 200 && xp.text.includes("Boshqa haydovchi sababi") && xp.text.includes("Asosiy haydovchi kasal"), "reys kartasida boshqa haydovchi sababi", xp.status);
  r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: 0.5, driverReason: "keraksiz" })], "/trips/new");
  const td2 = idFrom(r.redirect)!;
  check(!!td2 && q1(`select coalesce("driverReason",'-') from "Trip" where id='${td2}'`) === "-", "o'z haydovchisida sabab yozilmadi", r.error ?? r.text.slice(0, 200));
  for (const t of [td1, td2].filter(Boolean)) await logist.action(`${TA}#cancelTrip`, [t], `/trips/${t}`);
} else check(false, "o'z haydovchisi bor ikkinchi mikser topilmadi (test bazasi)");

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

// Beton yuklashda avto zames: hech bir skladda yetarli M300 yo'q (ikkinchida 2 m³) — asosiy skladda yetmagani
// retsept bo'yicha zames qilinadi va jo'natish o'sha skladdan bo'ladi. Retseptsiz yuklanmaydi.
const qty4 = 3, main4 = pbal(M300, main), need4 = Math.round((qty4 - Math.max(0, main4)) * 1000) / 1000;
r = await logist.action(`${TA}#createTrip`, [undefined, fd({ orderId: oid, vehicleId: mixer, driverId: driver, qtyM3: qty4 })], "/trips/new");
const t4 = idFrom(r.redirect);
const recIds = q(`select id from "Recipe" where "productId"='${M300}' and "isActive"`).map((x) => `'${x[0]}'`).join(",");
if (t4 && recIds && need4 > 0 && pbal(M300, wh2) < qty4) {
  const note4 = q1(`select "deliveryNoteNo" from "Trip" where id='${t4}'`)!;
  const autoBatch = () => q(`select id, "qtyM3", "orderId" from "ProductionBatch" where note like '%${note4}%'`);
  q(`update "Recipe" set "isActive"=false where id in (${recIds})`);
  r = await ishlab.action(`${TA}#markLoaded`, [t4], `/trips/${t4}`);
  q(`update "Recipe" set "isActive"=true where id in (${recIds})`);
  check(/retsept/.test(r.error ?? "") && q1(`select status from "Trip" where id='${t4}'`) === "PLANNED" && autoBatch().length === 0, "retseptsiz beton yuklanmadi (aniq xabar, zames yozilmadi)", r.error);
  r = await ishlab.action(`${TA}#markLoaded`, [t4], `/trips/${t4}`);
  const ab = autoBatch();
  check(r.ok && q1(`select status from "Trip" where id='${t4}'`) === "LOADED", "beton skladda yo'q — baribir yuklandi", r.error);
  check(ab.length === 1 && Math.abs(Number(ab[0][1]) - need4) < 0.001 && ab[0][2] === oid, `avto zames ${need4} m³ zayavka hisobiga yozildi`, ab);
  const bid = ab[0]?.[0] ?? "";
  const items4 = n1(`select count(*) from "RecipeItem" where "recipeId" in (${recIds})`);
  check(n1(`select count(*) from "StockMove" where "refId"='${bid}' and type='PRODUCTION_CONSUME' and "warehouseId"='${main}' and qty < 0`) === items4, "xomashyo retsept bo'yicha asosiy skladdan sarf bo'ldi", items4);
  check(Math.abs(n1(`select sum(qty) from "StockMove" where "refId"='${bid}' and type='PRODUCTION_OUTPUT' and "warehouseId"='${main}'`) - need4) < 0.001, "tayyor beton asosiy skladga kirim bo'ldi");
  const ship4 = q(`select "warehouseId", qty from "StockMove" where "refId"='${t4}' and type='SHIPMENT'`);
  check(ship4.length === 1 && ship4[0][0] === main && Number(ship4[0][1]) === -qty4, "SHIPMENT −3 m³ asosiy skladdan", ship4);
  check(Math.abs(pbal(M300, main) - (main4 + need4 - qty4)) < 0.001, "asosiy skladda beton qoldig'i minusga tushmadi", pbal(M300, main));
  r = await ishlab.action(`${TA}#markLoaded`, [t4], `/trips/${t4}`);
  check(autoBatch().length === 1, "qayta 'Yuklandi' ikkinchi zames yozmadi");
  r = await dir.action("(app)/production/actions#stornoBatch", [bid, "QA: jo'natilgan betonni storno"], "/production");
  check(!!r.error && n1(`select count(*) from "ProductionBatch" where id='${bid}' and "cancelledAt" is null`) === 1, "jo'natilgan beton zamesi storno qilinmaydi", r.error);
  await logist.action(`${TA}#markOnRoad`, [t4], `/trips/${t4}`);
  r = await logist.action(`${TA}#markDelivered`, [t4, undefined, fd({ receiverName: "QA avto zames" })], `/trips/${t4}`);
  check(r.ok, "avto zamesli reys yetkazildi", r.error);
} else check(false, "avto zames sinovi uchun sharoit yo'q (reys ochilmadi, M300 retsepti yo'q yoki skladda M300 yetarli)", r.error ?? [main4, pbal(M300, wh2)]);

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

// Xato yozuvni bekor qilish (o'chirilmaydi): yozuv cancelledAt + sabab bilan qoladi, jami va xizmat muddatiga kirmaydi
const LA = "(app)/logistika/actions";
const fuel1 = q1(`select id from "FuelLog" where "tripId"='${t1}' and "cancelledAt" is null limit 1`)!;
const road1 = q1(`select id from "TransportExpense" where "tripId"='${t1}' and kind='ROAD' and "cancelledAt" is null limit 1`)!;
const tripText = async () => (await logist.get(`/trips/${t1}`)).text;
check((await tripText()).includes("Jami: 740 750 so"), "reys xarajatlari jami: yoqilg'i 695 750 + yo'l 45 000");
r = await logist.action(`${LA}#cancelFuel`, [fuel1, ""], "/logistika/yoqilgi");
check(/sababini yozing/.test(r.error ?? "") && n1(`select count(*) from "FuelLog" where id='${fuel1}' and "cancelledAt" is null`) === 1, "sababsiz zapravkani bekor qilish — rad", r.error);
r = await logist.action(`${LA}#cancelFuel`, [fuel1, "QA: xato litr"], "/logistika/yoqilgi");
check(r.ok && n1(`select count(*) from "FuelLog" where id='${fuel1}' and "cancelledAt" is not null and "cancelReason"='QA: xato litr' and "cancelledById" is not null`) === 1, "zapravka bekor qilindi — yozuv o'chmadi (sabab bilan)", r.error);
check(n1(`select count(*) from "AuditLog" where entity='FuelLog' and "entityId"='${fuel1}' and action='STATUS_CHANGE'`) === 1, "zapravka bekor qilish auditda (STATUS_CHANGE)");
let tt = await tripText();
check(tt.includes("Jami: 45 000 so") && tt.includes("Bekor qilingan"), "bekor qilingan zapravka reys jamiga kirmaydi, ro'yxatda belgisi bilan qoladi");
r = await logist.action(`${LA}#cancelFuel`, [fuel1, "QA: yana"], "/logistika/yoqilgi");
check(/allaqachon bekor qilingan/.test(r.error ?? ""), "ikkinchi marta bekor qilish — «allaqachon»", r.error);
r = await logist.action(`${LA}#cancelExpense`, [road1, "QA: xato xarajat"], "/logistika/xarajatlar");
tt = await tripText();
check(r.ok && n1(`select count(*) from "TransportExpense" where id='${road1}' and "cancelledAt" is not null`) === 1 && !tt.includes("Jami: 45 000 so"), "yo'l xarajati bekor qilindi — jamidan chiqdi, yozuv qoldi", r.error);
// Texnik xizmat: bekor qilingan yozuv «muddati yaqin» ogohlantirishini bermaydi
const svcKind = `QA xizmat ${Date.now() % 100000}`;
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
r = await mex.action(`${LA}#addVehicleService`, [mixer, undefined, fd({ kind: svcKind, date: today, nextDueAt: tomorrow })], `/logistika/transport/${mixer}`);
const svc = q1(`select id from "VehicleService" where kind='${svcKind}'`);
check(r.ok && !!svc && (await mex.get(`/logistika/transport/${mixer}`)).text.includes(`${svcKind}: `), "mexanik xizmat yozdi — muddat ogohlantirishi chiqdi", r.error);
r = await mex.action(`${LA}#cancelVehicleService`, [svc!, "QA: xato yozuv"], `/logistika/transport/${mixer}`);
// Xizmat jurnali — transport kartasining «Karta va texnik xizmat» tabida (sukut tab — «Faoliyat va xarajat»)
const vt0 = (await mex.get(`/logistika/transport/${mixer}?tab=karta`)).text;
check(r.ok && n1(`select count(*) from "VehicleService" where id='${svc}' and "cancelledAt" is not null`) === 1 && !vt0.includes(`${svcKind}: `) && vt0.includes(svcKind), "xizmat yozuvi bekor qilindi — jurnalda qoldi, muddat ogohlantirishi yo'qoldi", r.error);

// Nakladnoy: chop etish va QR /verify
page = await logist.get(`/trips/${t1}/print`);
check(page.status === 200 && page.text.includes(note1), "nakladnoy chop etish sahifasi", page.status);
check(page.text.includes(ttn1) && page.text.includes("Zavod nusxasi") && page.text.includes("Yuk oluvchi nusxasi"), "nakladnoyda TTN va bitta A4 da 2 nusxa", page.status);

// Logistika → Realizatsiya: katakdagi qalamcha — reys TTN, reysdan qatorda xaridordan boshqa ustunlar (faqat reestr), qo'lda qatorda hamma ustun
const RA = "(app)/logistika/realizatsiya/actions";
r = await logist.action(`${RA}#saveRealizationCellAction`, [`t:${t1}`, "ttn", `${ttn1}A`], "/logistika/realizatsiya");
check(r.ok && q1(`select ttn from "Trip" where id='${t1}'`) === `${ttn1}A`, "Realizatsiya katagidan reys TTN tuzatildi", r.error);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`a:${t1}`, "loadPlace", "QA BSU-9"], "/logistika/realizatsiya");
check(r.ok && q1(`select "loadPlace" from "RealizationNote" where key='${t1}'`) === "QA BSU-9", "reysdan qatorda ortilgan joy katakdan yozildi", r.error);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`a:${t1}`, "qty", "99"], "/logistika/realizatsiya");
check(!!r.error && !r.ok, "reys kaliti bilan miqdor yozilmaydi (miqdor — mahsulot qatorida)", r.error);
// Reysdan qatorni tuzatish — faqat reestrda: zayavka qatori, sotuvchisi o'zgarmaydi; bo'shatilsa asl qiymat qaytadi
const it1 = q1(`select i.id from "OrderItem" i join "Trip" t on t."orderId"=i."orderId" where t.id='${t1}' order by i.id limit 1`)!;
const line1 = `${t1}-${it1}`;
const itemQty = q1(`select "qtyM3"::text from "OrderItem" where id='${it1}'`);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`l:${line1}`, "qty", "99"], "/logistika/realizatsiya");
check(r.ok && n1(`select qty from "RealizationLine" where key='${line1}'`) === 99 && q1(`select "qtyM3"::text from "OrderItem" where id='${it1}'`) === itemQty, "reysdan qatorda miqdor reestrda tuzatildi — zayavka qatori o'zgarmadi", r.error);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`a:${t1}`, "seller", "QA Reestr Sotuvchi"], "/logistika/realizatsiya");
let rz = (await logist.get("/logistika/realizatsiya")).text;
check(r.ok && q1(`select seller from "RealizationNote" where key='${t1}'`) === "QA Reestr Sotuvchi" && rz.includes("QA Reestr Sotuvchi") && rz.includes("Zayavkada:"), "reysdan qatorda sotuvchi tuzatildi — jadvalda tuzatilgan belgisi bilan", r.error);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`a:${t1}`, "date", "2099-01-01"], "/logistika/realizatsiya");
check(/kelajak/.test(r.error ?? ""), "reysdan qatorda kelajak sana rad etildi", r.error);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`a:${t1}`, "customerName", "QA boshqa xaridor"], "/logistika/realizatsiya");
check(!r.ok && /tahrirlanmaydi/.test(r.error ?? ""), "reysdan qatorda xaridor tuzatilmaydi (zayavkada)", r.error);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`l:${line1}`, "qty", ""], "/logistika/realizatsiya");
const back1 = await logist.action(`${RA}#saveRealizationCellAction`, [`a:${t1}`, "seller", ""], "/logistika/realizatsiya");
rz = (await logist.get("/logistika/realizatsiya")).text;
check(r.ok && back1.ok && q1(`select coalesce(qty::text, '-') from "RealizationLine" where key='${line1}'`) === "-" && q1(`select coalesce(seller, '-') from "RealizationNote" where key='${t1}'`) === "-" && !rz.includes("QA Reestr Sotuvchi"), "bo'shatilgan katak zayavkadagi qiymatga qaytdi", r.error ?? back1.error);
r = await sklad.action(`${RA}#saveRealizationCellAction`, [`l:${line1}`, "price", "1"], "/logistika/realizatsiya");
check(!r.ok, "sklad reysdan qatorni tuzata olmaydi");
r = await logist.action(`${RA}#createRealizationAction`, [undefined, fd({ clientToken: token(), date: today, payGroup: "CASH", customerName: "QA Katak Xaridor", productName: "QA katak mahsulot", unit: "m3", qty: "3", price: "100000" })], "/logistika/realizatsiya");
const me = q1(`select id from "RealizationEntry" where "customerName"='QA Katak Xaridor' and "cancelledAt" is null order by "createdAt" desc limit 1`)!;
check(r.ok && !!me, "qo'lda qator qo'shildi", r.error);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`m:${me}`, "qty", "4,5"], "/logistika/realizatsiya");
check(r.ok && n1(`select qty from "RealizationEntry" where id='${me}'`) === 4.5 && n1(`select price from "RealizationEntry" where id='${me}'`) === 100000, "qo'lda qator miqdori katakdan tuzatildi, narx joyida", r.error);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`m:${me}`, "date", "2099-01-01"], "/logistika/realizatsiya");
check(/kelajak/.test(r.error ?? ""), "katakdan kelajak sana rad etildi", r.error);
r = await sklad.action(`${RA}#saveRealizationCellAction`, [`m:${me}`, "note", "x"], "/logistika/realizatsiya");
check(!r.ok, "sklad Realizatsiya katagini tahrirlay olmaydi");

// Realizatsiya Excel importi: xato qator importni to'xtatmaydi, ro'yxatda yo'q mahsulot nomi bilan qo'shiladi
const tag = token().slice(0, 6);
const dmy = today.split("-").reverse().join(".");
const impRows = [
  { date: dmy, payGroup: "н-к,", customerName: `QA Imp ${tag}`, productName: `QA Imp shag'al ${tag}`, unit: "кг", qty: "12", price: "90000" },
  { date: dmy, payGroup: "п-р", customerName: `QA Imp ${tag}`, productName: `QA Imp FBS blok ${tag}`, unit: "", qty: "20", price: "450000", note: "x".repeat(400) },
  { date: "32.13.2026", payGroup: "Naqd", customerName: `QA Imp xato ${tag}`, productName: "B25", qty: "5" },
  { date: dmy, payGroup: "абв", customerName: `QA Imp xato ${tag}`, productName: "B25", qty: "5" },
];
const impFd = () => fd({ rows: JSON.stringify(impRows), valueMaps: "{}" });
r = await logist.action(`${RA}#importRealizationAction`, [undefined, impFd()], "/logistika/realizatsiya/import");
const imp = q(`select "productName", unit, "payGroup", length(coalesce(note, '')) from "RealizationEntry" where "customerName"='QA Imp ${tag}' order by unit`);
check(r.ok && !r.redirect && imp.length === 2 && r.text.includes("2 ta qator o'qilmadi"), "importda 2 xato qator o'tkazildi, qolgan 2 tasi qo'shildi", r.error ?? imp.length);
check(imp[0]?.[1] === "dona" && imp[0]?.[2] === "BANK" && imp[0]?.[3] === "300" && imp[1]?.[1] === "m3" && imp[1]?.[2] === "CASH",
  "ro'yxatda yo'q mahsulot: o'lchov nomidan (blok → dona, «кг» → m³), «п-р»/«н-к» to'lov turi, uzun izoh kesildi", JSON.stringify(imp));
const prodSql = `from "Product" where name like 'QA Imp %${tag}'`;
const impProds = q(`select name, unit, price::text, "isActive" ${prodSql} order by name`);
check(impProds.length === 2 && impProds.every((p) => Number(p[2]) === 0 && p[3] === "t") && impProds.find((p) => p[0].includes("FBS"))?.[1] === "dona"
  && n1(`select count(*) from "RealizationEntry" e join "Product" p on p.id=e."productId" where e."customerName"='QA Imp ${tag}'`) === 2
  && n1(`select count(*) from "AuditLog" where entity='Product' and action='CREATE' and "entityId" in (select id ${prodSql})`) === 2,
  "ro'yxatda yo'q mahsulot katalogga qo'shildi (faol, narxi 0, o'lchovi bilan), qatorlar unga bog'landi, AuditLog'da", JSON.stringify(impProds));
r = await logist.action(`${RA}#importRealizationAction`, [undefined, impFd()], "/logistika/realizatsiya/import");
check(r.ok && n1(`select count(*) from "RealizationEntry" where "customerName"='QA Imp ${tag}'`) === 2 && r.text.includes("Yangi qator yo'q")
  && n1(`select count(*) ${prodSql}`) === 2, "o'sha faylni qayta yuklash — yangi qator va yangi mahsulot yo'q, takror yozilmadi", r.error);
r = await logist.action(`${RA}#importRealizationAction`, [undefined, fd({ rows: JSON.stringify(impRows.slice(2)), valueMaps: "{}" })], "/logistika/realizatsiya/import");
check(!r.ok && !!r.error?.includes("Hech bir qator qo'shilmadi"), "faqat xato qatorli fayl — qo'shilmadi deb aytildi", r.error);

const vt =q1(`select "verifyToken" from "Trip" where id='${t1}'`)!;
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

// Transport: smenali haydovchilar (asosiy + smenadosh) va «Dizel + metan» (ikki norma, zapravkada tur tanlanadi)
const shiftPair = q(`select id from "Employee" where "isActive" and position ilike '%haydovchi%' and id<>'${driver}' order by "fullName" limit 2`).map((x) => x[0]);
if (shiftPair.length === 2) {
  const [d1, d2] = shiftPair as [string, string];
  const plate = `QA ${Date.now() % 1000000} DM`;
  r = await logist.action(`${LA}#saveVehicle`, [null, undefined, fd({ plate, type: "MIXER", capacityM3: "10", fuelType: "DIESEL_METHANE", fuelNormL100: "20", idleNormPerHour: "2", gasNormPer100: "45", gasIdlePerHour: "4", driverId: d1, "shiftDriverIds[]": ["", d2, d1] })], "/logistika/transport/new");
  const dm = q1(`select id from "Vehicle" where plate='${plate}'`);
  check((r.ok || !!r.redirect) && !!dm, "«Dizel + metan» transport qo'shildi", r.error);
  if (dm) {
    const row2 = q(`select "fuelType", "gasNormPer100", "gasIdlePerHour", "mainDriverId" from "Vehicle" where id='${dm}'`)[0]!;
    check(row2[0] === "DIESEL_METHANE" && Number(row2[1]) === 45 && Number(row2[2]) === 4 && row2[3] === d1, "ikki norma va asosiy haydovchi saqlandi", row2.join(","));
    check(n1(`select count(*) from "Employee" where "vehicleId"='${dm}'`) === 2, "asosiy + smenadosh biriktirildi (takror yozilmadi)");
    r = await logist.action(`${LA}#addFuel`, [undefined, fd({ vehicleId: dm, liters: "30", pricePerL: "5000" })], "/logistika/yoqilgi");
    check(/dizel va metan/.test(r.error ?? ""), "ikki yoqilg'ili transportda zapravka turi so'raladi", r.error);
    r = await logist.action(`${LA}#addFuel`, [undefined, fd({ vehicleId: dm, fuelType: "METHANE", liters: "30", pricePerL: "5000" })], "/logistika/yoqilgi");
    check(r.ok && q1(`select "fuelType" from "FuelLog" where "vehicleId"='${dm}' order by "createdAt" desc limit 1`) === "METHANE", "metan zapravka yozildi", r.error);
    r = await logist.action(`${LA}#addFuel`, [undefined, fd({ vehicleId: dm, fuelType: "DIESEL_METHANE", liters: "30", pricePerL: "5000" })], "/logistika/yoqilgi");
    check(!r.ok, "zapravkada «Dizel + metan» turi rad etildi", r.error);
    for (const pg of [`/logistika/transport/${dm}`, "/logistika/yoqilgi", "/logistika/tabel", "/trips/new"]) {
      const g = await logist.get(pg);
      check(g.status === 200, `logistika ${pg} → ${g.status}`);
    }
    // Smenadosh olib tashlandi — faqat asosiy qoladi; metan transportga o'tsa metan normalari tozalanadi
    r = await logist.action(`${LA}#saveVehicle`, [dm, undefined, fd({ plate, type: "MIXER", capacityM3: "10", fuelType: "METHANE", gasNormPer100: "45", driverId: d1, "shiftDriverIds[]": [""] })], `/logistika/transport/${dm}`);
    check(r.ok && n1(`select count(*) from "Employee" where "vehicleId"='${dm}'`) === 1 && !q1(`select "gasNormPer100" from "Vehicle" where id='${dm}'`), "smenadosh olib tashlandi, metan normasi tozalandi", r.error);
  }
} else console.log("   info: ikkita qo'shimcha haydovchi topilmadi — smena/dizel+metan tekshiruvi o'tkazib yuborildi");

// Logistika sahifalari (logistika, direktor, mexanik, buxgalteriya)
for (const p of ["/trips", `/trips/${t1}`, "/logistika/analitika", "/logistika/hisobotlar", "/logistika/nakladnoylar", "/logistika/yoqilgi", "/logistika/xarajatlar", "/logistika/kalendar", "/logistika/monitoring", "/logistika/yetkazish", "/logistika/buyurtmalar", `/logistika/transport/${mixer}`, `/logistika/haydovchilar/${driver}`]) {
  for (const [name, c] of [["logistika", logist], ["direktor", dir]] as const) {
    const g = await c.get(p);
    check(g.status === 200, `${name} ${p} → ${g.status}`);
  }
}
summary("b-logistics");
process.exit();
