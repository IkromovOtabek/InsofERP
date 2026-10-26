// QA (B) — ishlab chiqarish: retsept versiyalari, zames (sklad tanlash, yetmaslik, storno), brigada topshirig'i
// (tayinlash, qayd, tugatish → asosiy sklad; sklad yo'q → aniq xato), brak, ikki sklad.
// Ishga tushirish: npx tsx scripts/qa/b-production.mts  (server: QA_BASE, baza: QA_DB)
import { as, check, summary, fd, q, q1, n1, idFrom } from "./b-client.mjs";

const PA = "(app)/production/actions";
const main = q1(`select id from "Warehouse" where "isDefault" limit 1`)!;
const prod = (code: string) => q1(`select id from "Product" where code='${code}'`)!;
const mat = (code: string) => q1(`select id from "Material" where code='${code}'`)!;
const mbal = (m: string, w = main) => n1(`select coalesce(sum(qty),0) from "StockMove" where "materialId"='${m}' and "warehouseId"='${w}'`);
const pbal = (p: string, w?: string) => n1(`select coalesce(sum(qty),0) from "StockMove" where "productId"='${p}' ${w ? `and "warehouseId"='${w}'` : ""}`);
const ishlab = await as("ishlab"), dir = await as("direktor"), sklad = await as("sklad"), logist = await as("logistika"), brig = await as("brigadir");

// Asosiy skladga xomashyo (oldingi skriptlar qoldiqni o'zgartirgan bo'lishi mumkin)
{
  const sup = q1(`select id from "Supplier" where "isActive" limit 1`)!;
  const f = fd({ clientToken: crypto.randomUUID(), supplierId: sup, warehouseId: main, date: new Date().toISOString().slice(0, 10) });
  for (const code of ["CEM", "SAND", "GR520", "WATER", "ADD"]) { f.append("materialId[]", mat(code)); f.append("qty[]", "40000"); f.append("price[]", "100"); }
  const rr = await sklad.action("(app)/receipts/actions#createReceipt", [undefined, f], "/receipts/new");
  check(!!idFrom(rr.redirect), "asosiy skladga xomashyo kirimi", rr.error);
}

// ── 0) Ikkinchi sklad (direktor, Sozlamalar) ──
const whName = `QA sklad ${Date.now() % 100000}`;
let r = await dir.action("(app)/settings/actions#saveWarehouse", [null, undefined, fd({ name: whName, isActive: "on" })], "/settings");
const wh2 = q1(`select id from "Warehouse" where name='${whName}'`)!;
check(r.ok && !!wh2, "ikkinchi sklad ochildi", r.error);
check(q1(`select id from "Warehouse" where "isDefault"`) === main && n1(`select count(*) from "Warehouse" where "isDefault"`) === 1, "asosiy sklad bitta qoldi");

// ── 1) Retsept v2 ──
const M200 = prod("M200");
const v0 = n1(`select max(version) from "Recipe" where "productId"='${M200}'`);
const rf = fd({ note: "QA v2" });
for (const [code, qty] of [["CEM", 330], ["SAND", 740], ["GR520", 1090], ["WATER", 175], ["ADD", 2.6]] as const) { rf.append("kind[]", "material"); rf.append("refId[]", mat(code)); rf.append("qtyPerM3[]", String(qty)); }
r = await ishlab.action("(app)/recipes/actions#createRecipeVersion", [M200, undefined, rf], `/recipes/${M200}`);
check(!!r.redirect && !r.error, "ishlab retsept v2 yaratdi", r.error ?? r.text.slice(0, 200));
const act = q(`select version from "Recipe" where "productId"='${M200}' and "isActive"`);
check(act.length === 1 && Number(act[0][0]) === v0 + 1, `faqat bitta faol versiya: v${act[0]?.[0]}`, act);
// Parallel ikki saqlash — baribir bitta faol
await Promise.all([1, 2].map(() => ishlab.action("(app)/recipes/actions#createRecipeVersion", [M200, undefined, rf], `/recipes/${M200}`)));
check(n1(`select count(*) from "Recipe" where "productId"='${M200}' and "isActive"`) === 1, "parallel saqlashdan keyin ham bitta faol versiya");
// O'z-o'ziga ingredient / tsikl
const bad = fd({}); bad.append("kind[]", "product"); bad.append("refId[]", M200); bad.append("qtyPerM3[]", "1");
r = await ishlab.action("(app)/recipes/actions#createRecipeVersion", [M200, undefined, bad], `/recipes/${M200}`);
check(/o'zining/.test(r.error ?? ""), "o'ziga ingredient rad etildi", r.error);
const dup = fd({}); for (let i = 0; i < 2; i++) { dup.append("kind[]", "material"); dup.append("refId[]", mat("CEM")); dup.append("qtyPerM3[]", "1"); }
r = await ishlab.action("(app)/recipes/actions#createRecipeVersion", [M200, undefined, dup], `/recipes/${M200}`);
check(/ikki marta/.test(r.error ?? ""), "takroriy ingredient rad etildi", r.error);
const recipe = q(`select ri."materialId", ri."qtyPerM3" from "RecipeItem" ri join "Recipe" r on r.id=ri."recipeId" where r."productId"='${M200}' and r."isActive"`);

// ── 2) Zames ──
// Ikkinchi skladda xomashyo yo'q → aniq xato
r = await ishlab.action(`${PA}#createBatch`, [undefined, fd({ productId: M200, warehouseId: wh2, qtyM3: 5, shift: 1 })], "/production/new");
check(/Yetarli emas/.test(r.error ?? "") && /Sement/.test(r.error ?? ""), "bo'sh skladdan zames — aniq 'Yetarli emas' xatosi", r.error);
// Asosiy skladdan 5 m³ (zayavkasiz)
const before = new Map(recipe.map(([m]) => [m, mbal(m)]));
const p0 = pbal(M200, main);
r = await ishlab.action(`${PA}#createBatch`, [undefined, fd({ productId: M200, warehouseId: main, qtyM3: "5", shift: 2, note: "QA" })], "/production/new");
const b1 = idFrom(r.redirect)!;
check(!!b1, "zames yozildi", r.error ?? r.text.slice(0, 200));
const okCons = recipe.every(([m, per]) => Math.abs(before.get(m)! - mbal(m) - Number(per) * 5) < 0.001);
check(okCons, "xomashyo retsept v2 bo'yicha sarflandi", recipe.map(([m, per]) => [before.get(m)! - mbal(m), Number(per) * 5]));
check(Math.abs(pbal(M200, main) - p0 - 5) < 0.001, "M200 +5 m³ asosiy skladda");
check(q1(`select "recipeId" from "ProductionBatch" where id='${b1}'`) === q1(`select id from "Recipe" where "productId"='${M200}' and "isActive"`), "zames faol retseptga bog'landi");
// Juda katta zames — yetmaydi
r = await ishlab.action(`${PA}#createBatch`, [undefined, fd({ productId: M200, warehouseId: main, qtyM3: 9999, shift: 1 })], "/production/new");
check(/Yetarli emas/.test(r.error ?? ""), "9999 m³ — xomashyo yetmaydi", r.error);
// Zayavka hisobiga dona mahsulot zamesi rad
const ordUstun = q1(`select o.id from "Order" o join "OrderItem" i on i."orderId"=o.id join "Product" p on p.id=i."productId" where o.status in ('CONFIRMED','IN_PRODUCTION') and p.unit<>'m3' limit 1`);
if (ordUstun) {
  const pid = q1(`select i."productId" from "OrderItem" i join "Product" p on p.id=i."productId" where i."orderId"='${ordUstun}' and p.unit<>'m3' limit 1`)!;
  r = await ishlab.action(`${PA}#createBatch`, [undefined, fd({ orderId: ordUstun, productId: pid, warehouseId: main, qtyM3: 1, shift: 1 })], "/production/new");
  check(/brigada/.test(r.error ?? ""), "zayavkadagi dona mahsulot zames orqali emas", r.error);
}
// Storno: ishlab qila olmaydi, direktor qiladi
r = await ishlab.action(`${PA}#stornoBatch`, [b1, "QA xato"], `/production/${b1}`);
check(!r.ok, "ishlab storno qila olmaydi (direktor ruxsatisiz)");
r = await dir.action(`${PA}#stornoBatch`, [b1, "QA: xato zames"], `/production/${b1}`);
check(r.ok, "direktor zamesni storno qildi", r.error);
check(recipe.every(([m]) => Math.abs(mbal(m) - before.get(m)!) < 0.001), "storno: xomashyo to'liq qaytdi");
check(Math.abs(pbal(M200, main) - p0) < 0.001, "storno: M200 qoldig'i avvalgidek");
let page = await dir.get(`/production/${b1}`);
check(page.status === 200 && /Bekor qilingan/.test(page.text), "zames sahifasida «Bekor qilingan» belgisi");
page = await dir.get(`/stock/products/${M200}`);
check(page.status === 200, "/stock/products/M200 ochildi");

// Zayavka hisobiga zames + reys yuklash → storno rad
const ord = q(`select o.id, i."qtyM3", p.id from "Order" o join "OrderItem" i on i."orderId"=o.id join "Product" p on p.id=i."productId" where o.status='CONFIRMED' and p.code='M250' and (select count(*) from "OrderItem" x where x."orderId"=o.id)=1 limit 1`)[0];
if (ord) {
  const [oid, oq, pid] = ord;
  r = await ishlab.action(`${PA}#createBatch`, [undefined, fd({ orderId: oid, productId: pid, warehouseId: main, qtyM3: Number(oq) + 1, shift: 1 })], "/production/new");
  check(/qolgani/.test(r.error ?? ""), "zayavka hajmidan ko'p zames rad etildi", r.error);
  r = await ishlab.action(`${PA}#createBatch`, [undefined, fd({ orderId: oid, productId: pid, warehouseId: main, qtyM3: 6, shift: 1 })], "/production/new");
  const b2 = idFrom(r.redirect)!;
  check(!!b2 && q1(`select status from "Order" where id='${oid}'`) === "IN_PRODUCTION", "zayavka zamesi → IN_PRODUCTION", r.error);
  // Yuklash uchun reys: mikser + haydovchi
  const veh = q1(`select id from "Vehicle" where type='MIXER' and status<>'REPAIR' limit 1`) ?? q1(`select id from "Vehicle" where type='MIXER' limit 1`)!;
  const drv = q1(`select e.id from "Employee" e where e."isActive" and e."firedAt" is null and (e.position ilike '%haydovchi%') limit 1`)!;
  r = await logist.action("(app)/trips/actions#createTrip", [undefined, fd({ orderId: oid, vehicleId: veh, driverId: drv, qtyM3: 6 })], "/trips/new");
  const tid = idFrom(r.redirect);
  check(!!tid, "reys ochildi", r.error ?? r.text.slice(0, 200));
  if (tid) {
    r = await ishlab.action("(app)/trips/actions#markLoaded", [tid], `/trips/${tid}`);
    check(r.ok, "reys yuklandi (SHIPMENT)", r.error);
    r = await dir.action(`${PA}#stornoBatch`, [b2, "QA: jo'natilgan"], `/production/${b2}`);
    check(/minusga/.test(r.error ?? ""), "jo'natilgan mahsulot zamesi storno rad etildi", r.error);
  }
}

// ── 2b) Bitta qatorni ikki brigadaga bo'lib berish (miqdor bilan) ──
// 3-bo'lim bazadagi tayinlanmagan qatorni oladi — bu yerda o'z qatorimizni qo'shamiz (10 dona), bir-biriga xalal bermaydi
{
  const split = `qa_split_${Date.now()}`;
  q(`insert into "OrderItem" (id, "orderId", "productId", "qtyM3", price) select '${split}', o.id, p.id, 10, 0 from "Order" o, "Product" p where o.status in ('CONFIRMED','IN_PRODUCTION') and p.unit<>'m3' and p."isActive" order by o."createdAt", p.code limit 1`);
  const row = q(`select "orderId", id, "qtyM3" from "OrderItem" where id='${split}'`)[0];
  const [b1, b2] = q(`select id from "Brigade" where "isActive" order by name limit 2`).map((x) => x[0]);
  if (!row || !b2) console.log("  · bo'lib berish testi o'tkazib yuborildi: mos qator yoki ikkinchi brigada yo'q");
  else {
    const [oid, itemId, total] = row; const half = Math.floor(Number(total) / 2), rest = Number(total) - half;
    const A = "(app)/production/assign-actions#assignBrigades";
    r = await ishlab.action(A, [oid, undefined, fd({ [`brigade_${itemId}`]: b1, [`qty_${itemId}`]: 0 })], "/production");
    check(!r.ok && /0 dan katta/.test(r.error ?? ""), "miqdor 0 — rad etildi", r.error);
    r = await ishlab.action(A, [oid, undefined, fd({ [`brigade_${itemId}`]: b1, [`qty_${itemId}`]: half })], "/production");
    check(r.ok, `1-brigadaga ${half} / ${total}`, r.error);
    r = await ishlab.action(A, [oid, undefined, fd({ [`brigade_${itemId}`]: b2, [`qty_${itemId}`]: rest + 1 })], "/production");
    check(!r.ok && /berilmagan qismi/.test(r.error ?? ""), "qolganidan ko'p — rad etildi", r.error);
    r = await ishlab.action(A, [oid, undefined, fd({ [`brigade_${itemId}`]: b2, [`qty_${itemId}`]: rest })], "/production");
    check(r.ok, `2-brigadaga qolgan ${rest}`, r.error);
    const sum = Number(q1(`select coalesce(sum(qty),0) from "BrigadeTask" where "orderItemId"='${itemId}' and status<>'CANCELLED'`));
    const n = Number(q1(`select count(*) from "BrigadeTask" where "orderItemId"='${itemId}'`));
    check(n === 2 && Math.abs(sum - Number(total)) < 0.001, `qatorda 2 topshiriq, jami ${sum} = ${total}`);
    r = await ishlab.action(A, [oid, undefined, fd({ [`brigade_${itemId}`]: b1 })], "/production");
    check(!r.ok && /allaqachon/.test(r.error ?? ""), "hammasi berilgan qatorga yana tayinlash — rad etildi", r.error);
  }
  // Sinov qatori keyingi testlarga (logistika, schyot) ta'sir qilmasin
  q(`delete from "BrigadeTask" where "orderItemId"='${split}'`);
  q(`delete from "OrderItem" where id='${split}'`);
}

// ── 2c) «Qolganini boshqa o'lchamda bajardim» → O'tkazish: topshiriq va zayavka qatori bo'linadi, narx o'zgarmaydi ──
{
  const sub = `qa_sub_${Date.now()}`;
  q(`insert into "OrderItem" (id, "orderId", "productId", "qtyM3", price) select '${sub}', o.id, p.id, 10, 7000 from "Order" o, "Product" p where o.status in ('CONFIRMED','IN_PRODUCTION') and p.unit='dona' and p."isActive" order by o."createdAt", p.code limit 1`);
  const [oid, pid] = q(`select "orderId", "productId" from "OrderItem" where id='${sub}'`)[0] ?? [];
  const other = q1(`select id from "Product" where unit='dona' and "isActive" and id<>'${pid}' order by code limit 1`);
  const bid = q1(`select id from "Brigade" where "isActive" order by name limit 1`);
  if (!oid || !other || !bid) console.log("  · o'tkazish testi o'tkazib yuborildi: mos zayavka/mahsulot/brigada yo'q");
  else {
    r = await ishlab.action("(app)/production/assign-actions#assignBrigades", [oid, undefined, fd({ [`brigade_${sub}`]: bid })], "/production");
    check(r.ok, "o'tkazish uchun topshiriq ochildi (10)", r.error);
    const tid = q1(`select id from "BrigadeTask" where "orderItemId"='${sub}'`)!;
    const S = "(app)/tasks/actions#substituteTask";
    r = await ishlab.action(S, [tid, undefined, fd({ productId: other, qty: 11 })], "/tasks");
    check(!r.ok && /qolgani/.test(r.error ?? ""), "qolganidan ko'p o'tkazish — rad etildi", r.error);
    r = await ishlab.action(S, [tid, undefined, fd({ productId: pid, qty: 2 })], "/tasks");
    check(!r.ok && /farq qilsin/.test(r.error ?? ""), "o'sha mahsulotning o'ziga — rad etildi", r.error);
    r = await ishlab.action(S, [tid, undefined, fd({ productId: other, qty: 3, reason: "QA" })], "/tasks");
    check(r.ok, "3 dona boshqa o'lchamga o'tkazildi", r.error);
    check(Number(q1(`select qty from "BrigadeTask" where id='${tid}'`)) === 7, "asl topshiriq 10 → 7");
    check(Number(q1(`select "qtyM3" from "OrderItem" where id='${sub}'`)) === 7, "asl zayavka qatori 10 → 7");
    const ni = q(`select i.id, i."qtyM3", i.price, t.qty, t.status from "OrderItem" i join "BrigadeTask" t on t."orderItemId"=i.id where i."orderId"='${oid}' and i."productId"='${other}' and i.id<>'${sub}' order by t."createdAt" desc limit 1`)[0];
    check(!!ni && Number(ni[1]) === 3 && Number(ni[2]) === 7000 && Number(ni[3]) === 3 && ni[4] === "NEW", "yangi qator 3 dona asl narxda (7000), yangi topshiriq 3", ni?.join(" "));
    // Sinov qatorlari keyingi testlarga ta'sir qilmasin
    if (ni) { q(`delete from "BrigadeTask" where "orderItemId"='${ni[0]}'`); q(`delete from "OrderItem" where id='${ni[0]}'`); }
  }
  q(`delete from "BrigadeTask" where "orderItemId"='${sub}'`);
  q(`delete from "OrderItem" where id='${sub}'`);
}

// ── 3) Brigada topshirig'i ──
const ord3 = q(`select o.id, i.id, p.id, i."qtyM3", p.code from "Order" o join "OrderItem" i on i."orderId"=o.id join "Product" p on p.id=i."productId" left join "BrigadeTask" t on t."orderItemId"=i.id where o.status in ('CONFIRMED','IN_PRODUCTION') and p.unit<>'m3' and t.id is null limit 1`)[0];
const brigadeId = q1(`select id from "Brigade" where name like 'Test brigada%'`)!;
if (!ord3) check(false, "dona mahsulotli tayinlanmagan zayavka topilmadi");
else {
  const [oid, itemId, pid, qty, code] = ord3;
  // Soxta brigada — aniq xato (500 emas)
  r = await ishlab.action("(app)/production/assign-actions#assignBrigades", [oid, undefined, fd({ [`brigade_${itemId}`]: "yoq-brigada" })], "/production");
  check(!!r.error && !r.forbidden, "mavjud bo'lmagan brigada — aniq xato", r.error ?? r.text.slice(0, 150));
  r = await ishlab.action("(app)/production/assign-actions#assignBrigades", [oid, undefined, fd({ [`brigade_${itemId}`]: brigadeId })], "/production");
  check(r.ok, `brigadaga tayinlandi (${code} × ${qty})`, r.error);
  const task = q1(`select id from "BrigadeTask" where "orderItemId"='${itemId}'`)!;
  r = await ishlab.action("(app)/production/assign-actions#assignBrigades", [oid, undefined, fd({ [`brigade_${itemId}`]: brigadeId })], "/production");
  check(!r.ok, "ikkinchi tayinlash — qator band", r.error);
  const y0 = pbal(pid, main), y2 = pbal(pid, wh2);
  r = await ishlab.action("(app)/tasks/actions#addProgress", [task, undefined, fd({ qty: Number(qty) + 1 })], "/tasks");
  check(/Qoldiqdan/.test(r.error ?? ""), "topshiriqdan ko'p qayd rad etildi", r.error);
  r = await ishlab.action("(app)/tasks/actions#addProgress", [task, undefined, fd({ qty: 3, note: "QA" })], "/tasks");
  check(r.ok, "qisman bajarildi: 3", r.error);
  check(Math.abs(pbal(pid, main) - y0 - 3) < 0.001 && Math.abs(pbal(pid, wh2) - y2) < 0.001, "tayyor mahsulot ASOSIY skladga tushdi (ikkinchisiga emas)");
  check(q1(`select status from "BrigadeTask" where id='${task}'`) === "IN_PROGRESS", "holat IN_PROGRESS");
  // Brak — bajarilgandan ko'p emas
  r = await ishlab.action("(app)/dashboard/production-actions#addDefect", [undefined, fd({ productId: pid, qty: 1, reason: "Yoriq", brigadeId })], "/dashboard");
  check(r.ok || !r.error, "brak yozildi (1)", r.error);
  // Sklad yo'q → aniq xato: asosiy va ikkinchi skladni vaqtincha yopamiz
  const mainName = q1(`select name from "Warehouse" where id='${main}'`)!;
  await dir.action("(app)/settings/actions#saveWarehouse", [main, undefined, fd({ name: mainName })], "/settings");
  await dir.action("(app)/settings/actions#saveWarehouse", [wh2, undefined, fd({ name: whName })], "/settings");
  check(n1(`select count(*) from "Warehouse" where "isActive"`) === 0, "barcha skladlar vaqtincha yopildi");
  r = await ishlab.action("(app)/tasks/actions#addProgress", [task, undefined, fd({ qty: 1 })], "/tasks");
  check(/Faol sklad yo'q/.test(r.error ?? ""), "sklad yo'q — aniq xato, qayd yozilmadi", r.error);
  check(Number(q1(`select "doneQty" from "BrigadeTask" where id='${task}'`)) === 3, "doneQty o'zgarmadi");
  await dir.action("(app)/settings/actions#saveWarehouse", [main, undefined, fd({ name: mainName, isActive: "on", isDefault: "on" })], "/settings");
  await dir.action("(app)/settings/actions#saveWarehouse", [wh2, undefined, fd({ name: whName, isActive: "on" })], "/settings");
  check(q1(`select id from "Warehouse" where "isDefault" and "isActive"`) === main, "asosiy sklad tiklandi");
  // Tugatish
  const left = Number(qty) - 3;
  r = await ishlab.action("(app)/tasks/actions#addProgress", [task, undefined, fd({ qty: left })], "/tasks");
  check(r.ok && q1(`select status from "BrigadeTask" where id='${task}'`) === "DONE", "topshiriq to'liq bajarildi → DONE", r.error);
  check(Math.abs(pbal(pid, main) - y0 - Number(qty) + 1) < 0.001, "asosiy skladda +qty − brak", pbal(pid, main) - y0);
  r = await ishlab.action("(app)/tasks/actions#addProgress", [task, undefined, fd({ qty: 1 })], "/tasks");
  check(/yopilgan/.test(r.error ?? ""), "yopilgan topshiriqqa qayd rad etildi", r.error);
  // Brigadir o'z sahifasi
  page = await brig.get("/mening-topshiriqlarim");
  check(page.status === 200, "brigadir /mening-topshiriqlarim");
  // Sklad brigadaga xomashyo beradi — ikkinchi skladdan (bo'sh) → aniq xato
  r = await sklad.action("(app)/stock/brigade-actions#distributeToBrigade", [undefined, fd({ warehouseId: wh2, rows: JSON.stringify([{ materialId: mat("CEM"), brigadeId, qty: 10 }]) })], "/stock?tab=brigades");
  check(/yetmaydi/.test(r.error ?? ""), "bo'sh skladdan brigadaga berish rad etildi", r.error);
  const c0 = mbal(mat("CEM"));
  r = await sklad.action("(app)/stock/brigade-actions#distributeToBrigade", [undefined, fd({ warehouseId: main, rows: JSON.stringify([{ materialId: mat("CEM"), brigadeId, qty: 10 }]) })], "/stock?tab=brigades");
  check(r.ok && Math.abs(c0 - mbal(mat("CEM")) - 10) < 0.001, "asosiy skladdan brigadaga 10 kg sement berildi", r.error);
  r = await sklad.action("(app)/stock/brigade-actions#returnToStock", [brigadeId, undefined, fd({ materialId: mat("CEM"), qty: 4, warehouseId: wh2 })], "/stock?tab=brigades");
  check(r.ok && Math.abs(mbal(mat("CEM"), wh2) - 4) < 0.001, "brigadadan ikkinchi skladga 4 kg qaytdi", r.error);
}

// ── 4) Ikki sklad: harakatlar to'g'ri skladda, jami = skladlar yig'indisi ──
const tot = n1(`select coalesce(sum(qty),0) from "StockMove" where "materialId"='${mat("CEM")}'`);
const perWh = q(`select id from "Warehouse"`).reduce((s, [w]) => s + mbal(mat("CEM"), w), 0);
check(Math.abs(tot - perWh) < 0.001, "sement: jami = skladlar bo'yicha yig'indi", [tot, perWh]);
const neg = q(`select w.name, coalesce(m.name,p.name), sum(s.qty) from "StockMove" s join "Warehouse" w on w.id=s."warehouseId" left join "Material" m on m.id=s."materialId" left join "Product" p on p.id=s."productId" group by 1,2 having sum(s.qty) < -0.001`);
check(neg.length === 0, "hech bir skladda minus qoldiq yo'q", neg);
page = await sklad.get("/stock?tab=balance");
check(page.status === 200 && page.text.includes(whName), "Sklad sahifasida ikkinchi sklad ko'rinadi", page.status);

// Brigada: mavjud bo'lmagan brigadir — aniq xato (500 emas)
r = await ishlab.action("(app)/brigades/actions#saveBrigade", [null, undefined, fd({ name: "QA brigada", leaderId: "yoq-xodim" })], "/brigades");
check(/Brigadir topilmadi/.test(r.error ?? ""), "mavjud bo'lmagan brigadir rad etildi", r.error);

summary("b-production");
process.exit();
