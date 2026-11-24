// QA (B) — reyssiz sotuv → sklad (`lib/realization-stock.ts`, Sarvar rejasi 2-bosqich): Realizatsiya reestrining qo'lda qatori
// dona mahsulotni skladdan chiqaradi; tahrir — farq bilan, o'chirish — teskari yozuv bilan; qoldiq yetmasa saqlanadi +
// ogohlantirish + direktorga xabar; sana chegarasidan oldingi va katalogsiz qator skladga tegmaydi; beton (avto sarf o'chiq) — tegmaydi.
// Ishga tushirish: npx tsx scripts/qa/b-realization-stock.mts
import { as, check, summary, fd, q, q1, n1, token } from "./b-client.mjs";

const RA = "(app)/sales/realizatsiya/actions";
const dir = await as("direktor"), logist = await as("logistika");
const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const yest = new Date(now.getTime() - 86_400_000);
const yesterday = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`;
const tag = Date.now() % 1_000_000;

// ── Sozlama: shu kundan reyssiz sotuv skladdan chiqadi ──
let r = await dir.action("(app)/settings/actions#saveSaleStockSettings", [undefined, fd({ realizationStockFrom: today })], "/settings");
check(r.ok && !!q1(`select "realizationStockFrom" from "CompanySettings" where id='main'`), "Sozlamalar: reyssiz sotuv sklad sanasi saqlandi", r.error);
check(q1(`select "realizationAutoConsume"::text from "CompanySettings" where id='main'`) === "false", "beton avto sarfi sukut bo'yicha o'chiq");
r = await logist.action("(app)/settings/actions#saveSaleStockSettings", [undefined, fd({ realizationStockFrom: today })], "/settings");
check(!r.ok, "logistika sozlamani o'zgartira olmaydi");

// ── Dona mahsulot (katalogda) va skladda 5 dona ──
const wh = q1(`select id from "Warehouse" where "isActive" order by "isDefault" desc, id limit 1`)!;
const user = q1(`select id from "User" where login='test.sklad'`)!;
const group = q1(`select id from "ProductGroup" where "parentId" is null limit 1`);
const pid = `qa_rz_${tag}`, pname = `QA RZ plita ${tag}`;
q(`insert into "Product"(id, code, name, unit, price, "isActive", "groupId", aliases) values ('${pid}', 'QARZ${tag}', '${pname}', 'dona', 500000, true, ${group ? `'${group}'` : "null"}, '{}')`);
q(`insert into "StockMove"(id, type, "warehouseId", "productId", qty, "createdById", note) values ('qa_rz_mv_${tag}', 'ADJUSTMENT', '${wh}', '${pid}', 5, '${user}', 'QA boshlang''ich')`);
const bal = () => n1(`select coalesce(sum(qty),0) from "StockMove" where "productId"='${pid}'`);
const out = (id: string) => n1(`select coalesce(sum(qty),0) from "StockMove" where "refType"='RealizationEntry' and "refId"='${id}' and "productId"='${pid}'`);
check(bal() === 5, "boshlang'ich qoldiq 5 dona", bal());

// ── Qo'lda qator: 3 dona → skladdan −3 ──
const cust = `QA RZ Xaridor ${tag}`;
r = await logist.action(`${RA}#createRealizationAction`, [undefined, fd({ clientToken: token(), date: today, payGroup: "CASH", customerName: cust, productName: pname, unit: "dona", qty: "3", price: "500000" })], "/sales/realizatsiya");
const eid = q1(`select id from "RealizationEntry" where "customerName"='${cust}' order by "createdAt" desc limit 1`)!;
check(r.ok && !!eid && out(eid) === -3 && bal() === 2, "qo'lda qator 3 dona — skladdan chiqdi (qoldiq 2)", r.error ?? { out: eid && out(eid), bal: bal() });
check(!/Skladda yetmadi/.test(r.text), "qoldiq yetganda ogohlantirish yo'q");
check(q1(`select type from "StockMove" where "refType"='RealizationEntry' and "refId"='${eid}' limit 1`) === "SHIPMENT", "yozuv turi — SHIPMENT (jo'natish)");

// ── Tahrir: 3 → 4 (farq −1), 4 → 7 (yetmaydi — saqlanadi, ogohlantirish, direktorga xabar) ──
r = await logist.action(`${RA}#saveRealizationCellAction`, [`m:${eid}`, "qty", "4"], "/sales/realizatsiya");
check(r.ok && out(eid) === -4 && bal() === 1, "miqdor 4 — farq qo'shimcha chiqim bilan (qoldiq 1)", r.error ?? { out: out(eid), bal: bal() });
const notesBefore = n1(`select count(*) from "Notification" where type='STOCK_SHORT_SALE'`);
r = await logist.action(`${RA}#saveRealizationCellAction`, [`m:${eid}`, "qty", "7"], "/sales/realizatsiya");
check(r.ok && /Skladda yetmadi/.test(r.text) && out(eid) === -7 && bal() === -2, "miqdor 7 — qoldiq yetmasa ham saqlandi, ogohlantirish, sklad minusda", r.error ?? { out: out(eid), bal: bal(), text: r.text.slice(0, 200) });
// Bildirishnoma `after()` bilan — javobdan keyin yoziladi
let notes = notesBefore;
for (let i = 0; i < 20 && notes === notesBefore; i++) { await new Promise((res) => setTimeout(res, 250)); notes = n1(`select count(*) from "Notification" where type='STOCK_SHORT_SALE'`); }
check(notes > notesBefore, "direktorga «skladda yo'q mahsulot sotildi» xabari ketdi", { notesBefore, notes });
r = await logist.action(`${RA}#saveRealizationCellAction`, [`m:${eid}`, "qty", "2"], "/sales/realizatsiya");
check(r.ok && out(eid) === -2 && bal() === 3, "miqdor 2 — ortiqcha chiqim omborga qaytdi (qoldiq 3)", r.error ?? { out: out(eid), bal: bal() });
check(n1(`select count(*) from "StockMove" where "refType"='RealizationEntry' and "refId"='${eid}'`) >= 4, "sklad jurnali o'zgarmaydi — har tuzatish alohida yozuv");

// ── Mahsulot betonga almashsa — dona chiqimi to'liq qaytadi, beton (avto sarf o'chiq) skladga tegmaydi ──
const m3 = q(`select id, name from "Product" where unit='m3' and "isActive" limit 1`)[0];
if (m3) {
  r = await logist.action(`${RA}#saveRealizationCellAction`, [`m:${eid}`, "productName", m3[1]], "/sales/realizatsiya");
  const m3out = n1(`select coalesce(sum(qty),0) from "StockMove" where "refType"='RealizationEntry' and "refId"='${eid}' and "productId"='${m3[0]}'`);
  check(r.ok && out(eid) === 0 && bal() === 5 && m3out === 0, "beton qatoriga almashdi — dona chiqimi qaytdi, beton skladga tegmadi", r.error ?? { out: out(eid), bal: bal(), m3out });
  r = await logist.action(`${RA}#saveRealizationCellAction`, [`m:${eid}`, "productName", pname], "/sales/realizatsiya");
  check(r.ok && out(eid) === -2 && bal() === 3, "qayta dona mahsulot — yana chiqdi", r.error ?? { out: out(eid), bal: bal() });
}

// ── O'chirish — teskari yozuv, qoldiq tiklanadi ──
r = await logist.action(`${RA}#deleteRealizationAction`, [eid, "QA tekshiruv"]);
check(r.ok && out(eid) === 0 && bal() === 5 && !q1(`select id from "RealizationEntry" where id='${eid}'`), "qator o'chirildi — sklad chiqimi teskari yozuv bilan qaytdi (qoldiq 5)", r.error ?? { out: out(eid), bal: bal() });

// ── Sana chegarasidan oldingi va katalogsiz qator — skladga tegmaydi ──
const cust2 = `QA RZ Eski ${tag}`;
r = await logist.action(`${RA}#createRealizationAction`, [undefined, fd({ clientToken: token(), date: yesterday, payGroup: "CASH", customerName: cust2, productName: pname, unit: "dona", qty: "1", price: "1" })], "/sales/realizatsiya");
const old = q1(`select id from "RealizationEntry" where "customerName"='${cust2}' limit 1`);
check(r.ok && !!old && n1(`select count(*) from "StockMove" where "refType"='RealizationEntry' and "refId"='${old}'`) === 0, "chegaradan oldingi sana — skladga yozilmadi", r.error);
const cust3 = `QA RZ Katalogsiz ${tag}`;
r = await logist.action(`${RA}#createRealizationAction`, [undefined, fd({ clientToken: token(), date: today, payGroup: "CASH", customerName: cust3, productName: `QA yo'q mahsulot ${tag}`, unit: "dona", qty: "1", price: "1" })], "/sales/realizatsiya");
const loose = q1(`select id from "RealizationEntry" where "customerName"='${cust3}' limit 1`);
check(r.ok && !!loose && n1(`select count(*) from "StockMove" where "refType"='RealizationEntry' and "refId"='${loose}'`) === 0, "katalogga bog'lanmagan qator — skladga yozilmadi", r.error);

// ── Excel import ham chiqaradi ──
const cust4 = `QA RZ Import ${tag}`;
const rows = [{ date: today, payGroup: "Naqd", customerName: cust4, productName: pname, unit: "dona", qty: "2", price: "500000" }];
r = await logist.action(`${RA}#importRealizationAction`, [undefined, fd({ rows: JSON.stringify(rows), valueMaps: "{}" })], "/sales/realizatsiya/import");
const imp = q1(`select id from "RealizationEntry" where "customerName"='${cust4}' limit 1`);
check(!!imp && out(imp) === -2 && bal() === 3, "Excel importidagi qator ham skladdan chiqdi", r.error ?? { imp, bal: bal() });
if (imp) await logist.action(`${RA}#deleteRealizationAction`, [imp, "QA"]);

// ── Tayyor mahsulot sanog'i (sanoq akti): hisobda 5, sanaldi 2 → −3 ──
const sklad = await as("sklad");
const SA = "(app)/stock/adjust-actions";
const book = bal();
let page = await sklad.get("/stock/inventarizatsiya/tayyor");
check(page.status === 200 && page.text.includes(pname), "«Tayyor mahsulot sanog'i» sahifasi ochildi, mahsulot ro'yxatda", page.status);
r = await sklad.action(`${SA}#saveProductInventory`, [undefined, fd({ warehouseId: wh, reason: "", rows: JSON.stringify([{ productId: pid, book, actual: 2 }]) })], "/stock/inventarizatsiya/tayyor");
check(!r.ok && /sabab/i.test(r.error ?? ""), "sanoq sababsiz rad etildi", r.error);
r = await sklad.action(`${SA}#saveProductInventory`, [undefined, fd({ warehouseId: wh, reason: "QA oy oxiri sanog'i", rows: JSON.stringify([{ productId: pid, book: book + 1, actual: 2 }]) })], "/stock/inventarizatsiya/tayyor");
check(!r.ok && /o'zgardi/.test(r.error ?? ""), "eskirgan hisob qoldig'i bilan sanoq rad etildi", r.error);
r = await sklad.action(`${SA}#saveProductInventory`, [undefined, fd({ warehouseId: wh, reason: "QA oy oxiri sanog'i", rows: JSON.stringify([{ productId: pid, book, actual: 2 }]) })], "/stock/inventarizatsiya/tayyor");
check(r.ok && bal() === 2 && n1(`select count(*) from "StockMove" where "refType"='ProductInventory' and "productId"='${pid}'`) >= 1, `sanoq akti: hisobda ${book}, sanaldi 2 — qoldiq 2`, r.error ?? bal());
page = await logist.get("/stock/inventarizatsiya/tayyor");
check(page.status !== 200 || !page.text.includes(pname), "logistika sanoq sahifasini ocha olmaydi", page.status);

// Keyingi testlarga ta'sir qilmasin — sozlama o'chiriladi
r = await dir.action("(app)/settings/actions#saveSaleStockSettings", [undefined, fd({ realizationStockFrom: "" })], "/settings");
check(r.ok && !q1(`select "realizationStockFrom" from "CompanySettings" where id='main'`), "sozlama bo'shatildi — o'chiq");
summary("b-realization-stock");
