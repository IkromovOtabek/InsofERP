// QA (B): sklad / ishlab chiqarish / logistika / ta'minot / kadr sahifalari har bir rol uchun 500 bermasligi.
// Server log'ida xato izlarini alohida tekshiring (QA_LOG=... berilsa — skript o'zi qaraydi).
import fs from "node:fs";
import { as, check, summary, q1 } from "./b-client.mjs";

const SUPPLY_TABS = ["", "new", "priced", "approved", "funded", "received", "rejected", "all"];
const ids = {
  receipt: q1(`select id from "GoodsReceipt" order by "createdAt" desc limit 1`),
  batch: q1(`select id from "ProductionBatch" order by "createdAt" desc limit 1`),
  recipeProduct: q1(`select "productId" from "Recipe" where "isActive" limit 1`),
  product: q1(`select id from "Product" limit 1`),
  supply: q1(`select id from "SupplyRequest" order by "createdAt" desc limit 1`),
  trip: q1(`select id from "Trip" order by "createdAt" desc limit 1`),
  noteNo: q1(`select "deliveryNoteNo" || '?k=' || coalesce("verifyToken",'') from "Trip" order by "createdAt" desc limit 1`),
  employee: q1(`select id from "Employee" order by "createdAt" desc limit 1`),
  driverEmp: q1(`select "driverId" from "Trip" limit 1`),
  site: q1(`select id from "Site" limit 1`),
  vehicle: q1(`select id from "Vehicle" limit 1`),
};

const pages = [
  "/stock", "/stock?tab=balance", "/stock?tab=capacity", "/stock?tab=brigades", "/stock?tab=moves",
  "/stock/inventarizatsiya", "/stock/spisanie", "/stock/materials/new", "/stock/products/new", "/stock/supply/new",
  ids.product && `/stock/products/${ids.product}`,
  "/receipts", "/receipts/new", "/receipts/import", ids.receipt && `/receipts/${ids.receipt}`,
  ...SUPPLY_TABS.map((t) => `/snabjeniye${t ? "?tab=" + t : ""}`), "/snabjeniye/hisobot",
  ...SUPPLY_TABS.map((t) => `/taminot${t ? "?tab=" + t : ""}`), ids.supply && `/taminot/${ids.supply}`,
  "/production", "/production?f=all", "/production?f=done", "/production/new", ids.batch && `/production/${ids.batch}`,
  "/recipes", "/recipes/import", ids.recipeProduct && `/recipes/${ids.recipeProduct}`,
  "/tasks", "/brigades", "/trips", "/trips/new", ids.trip && `/trips/${ids.trip}`, ids.trip && `/trips/${ids.trip}/print`,
  "/drivers", "/mening-reyslarim", "/mening-topshiriqlarim",
  "/logistika/analitika", "/logistika/buyurtmalar", "/logistika/haydovchilar", ids.driverEmp && `/logistika/haydovchilar/${ids.driverEmp}`,
  "/logistika/hisobotlar", "/logistika/kalendar", "/logistika/monitoring", "/logistika/nakladnoylar", "/logistika/obyektlar",
  ids.site && `/logistika/obyektlar/${ids.site}`, "/logistika/obyektlar/new", "/logistika/sozlamalar", "/logistika/transport",
  ids.vehicle && `/logistika/transport/${ids.vehicle}`, "/logistika/transport/new", "/logistika/xarajatlar", "/logistika/yetkazish", "/logistika/yoqilgi",
  "/employees", "/employees?tab=xodimlar", ids.employee && `/employees/${ids.employee}`, ids.employee && `/employees/${ids.employee}/varaqa`,
  ids.employee && `/employees/${ids.employee}/hujjat/chop/ariza`, ids.employee && `/employees/${ids.employee}/hujjat/chop/toplam`,
  "/otdel-kadr", "/otdel-kadr?tab=xodimlar", "/otdel-kadr?tab=bolimlar", "/otdel-kadr?tab=davomat", "/otdel-kadr?tab=lavozimlar", "/otdel-kadr?tab=taqvim",
  "/otdel-kadr/import", "/otdel-kadr/yangi",
].filter(Boolean);

const roles = (process.env.QA_ROLES ?? "direktor,sklad,snab,ishlab,prorab,brigadir,logistika,haydovchi,mexanik,kadr").split(",");
const logFile = process.env.QA_LOG;
const logStart = logFile && fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;

for (const role of roles) {
  const c = await as(role);
  const bad = [];
  let okCount = 0, denied = 0;
  for (const p of pages) {
    const r = await c.get(p);
    if (r.status >= 500 || /Application error|Internal Server Error/.test(r.text) && r.status !== 200) bad.push(`${p} → ${r.status}`);
    else if (r.status === 200 && /"digest"/.test(r.text) && /NEXT_HTTP_ERROR|Error:/.test(r.text)) bad.push(`${p} → 200 + digest`);
    else if (r.status === 307 || r.status === 404 || r.status === 403) denied++;
    else okCount++;
  }
  check(bad.length === 0, `${role}: ${okCount} sahifa ochildi, ${denied} ruxsatsiz/redirect`, bad.join("; "));
}
// Ochiq tekshiruv sahifasi (sessiyasiz)
if (ids.noteNo) {
  const r = await fetch(`${process.env.QA_BASE ?? "http://localhost:3202"}/verify/${ids.noteNo}`);
  check(r.status === 200, `/verify/<noteNo> ochiq sahifa: ${r.status}`);
}
if (logFile) {
  const tail = fs.readFileSync(logFile, "utf8").slice(logStart);
  const errs = tail.split("\n").filter((l) => /⨯|Error:|TypeError|PrismaClient|digest/.test(l));
  check(errs.length === 0, "server log'ida yangi xato yo'q", errs.slice(0, 8).join("\n"));
}
summary("b-pages");
