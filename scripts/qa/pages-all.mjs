// QA (yakuniy regressiya): src/app/(app) dagi BARCHA sahifalarni 14 rolning har biri bilan ochadi — 500 / xato chegarasi
// bo'lmasligi kerak (403/404/redirect — ruxsatsiz, normal). Sahifalar ro'yxati fayl tizimidan o'qiladi (yangi sahifa
// avtomatik qo'shiladi); dinamik segmentlar ([id] …) bazadagi haqiqiy id bilan, topilmasa — yo'q id bilan (404 kutiladi).
// Direktor uchun yo'q id bilan ham ochiladi (noto'g'ri id → 500 emas, 404 bo'lishi kerak).
//   QA_DB=postgresql://…/insof_test_x QA_BASE=http://localhost:3210 QA_LOG=server.log node scripts/qa/pages-all.mjs
import fs from "node:fs";
import path from "node:path";
import { Client, check, summary, q1, BASE } from "./b-client.mjs";

const ROOT = path.resolve("src/app/(app)");
function walk(dir, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) { if (e.name === "page.tsx" || e.name === "page.ts") out.push(rel || "/"); continue; }
    if (e.name.startsWith("_")) continue;
    // (guruh) papkalari URL'ga kirmaydi
    const seg = /^\(.*\)$/.test(e.name) ? "" : "/" + e.name;
    out.push(...walk(path.join(dir, e.name), rel + seg));
  }
  return out;
}

// Dinamik segment → haqiqiy id (sahifa yo'li bo'yicha)
const one = (sql) => { try { return q1(sql); } catch { return null; } };
const IDS = {
  "/customers/[id]": one(`select id from "Customer" order by "createdAt" desc limit 1`),
  "/payments/mijoz/[id]": one(`select id from "Customer" order by "createdAt" desc limit 1`),
  "/suppliers/[id]": one(`select id from "Supplier" order by "createdAt" desc limit 1`),
  "/dashboard/hisobot/[id]": one(`select id from "ProductionReport" order by "createdAt" desc limit 1`),
  "/employees/[id]": one(`select id from "Employee" order by "createdAt" desc limit 1`),
  "/logistika/haydovchilar/[id]": one(`select "driverId" from "Trip" where "driverId" is not null limit 1`) ?? one(`select id from "Employee" limit 1`),
  "/logistika/obyektlar/[id]": one(`select id from "Site" limit 1`),
  "/logistika/transport/[id]": one(`select id from "Vehicle" limit 1`),
  "/orders/[id]": one(`select id from "Order" order by "createdAt" desc limit 1`),
  "/production/[id]": one(`select id from "ProductionBatch" order by "createdAt" desc limit 1`),
  "/receipts/[id]": one(`select id from "GoodsReceipt" order by "createdAt" desc limit 1`),
  "/recipes/[productId]": one(`select "productId" from "Recipe" limit 1`),
  "/stock/products/[productId]": one(`select id from "Product" limit 1`),
  "/taminot/[id]": one(`select id from "SupplyRequest" order by "createdAt" desc limit 1`),
  "/trips/[id]": one(`select id from "Trip" order by "createdAt" desc limit 1`),
  "[slug]": "ariza",
};
const FAKE = "qa0000000000000000000000";
function fill(p, fake) {
  let out = "";
  for (const seg of p.split("/").slice(1)) {
    out += "/";
    if (!/^\[.*\]$/.test(seg)) { out += seg; continue; }
    const key = out + seg;
    out += seg === "[slug]" ? IDS["[slug]"] : fake ? FAKE : (IDS[key] ?? FAKE);
  }
  return out;
}

const raw = walk(ROOT).sort();
const pages = raw.map((p) => fill(p, false));
const fakePages = raw.filter((p) => p.includes("[")).map((p) => fill(p, true));
console.log(`${pages.length} sahifa (${fakePages.length} dinamik)`);

const ROLES = (process.env.QA_ROLES ?? "direktor,sotuv,ishlab,prorab,logistika,sklad,snab,buh,finance,kadr,kassa,haydovchi,brigadir,mexanik").split(",");
const logFile = process.env.QA_LOG;
const logStart = logFile && fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;

function bad(r) {
  if (r.status >= 500) return `${r.status}`;
  if (r.status === 200 && /"digest"/.test(r.text) && /NEXT_HTTP_ERROR|Error:/.test(r.text)) return "200 + digest";
  return null;
}

let ipN = 0;
for (const role of ROLES) {
  // Har rol o'z IP'si bilan — login-guard cheklovi rollar orasida aralashmasin
  const c = new Client({ "x-forwarded-for": `10.88.0.${++ipN}` });
  await c.login(`test.${role}`);
  const errs = []; let ok = 0, denied = 0;
  for (const p of [...pages, ...(role === "direktor" ? fakePages : [])]) {
    const r = await c.get(p);
    const b = bad(r);
    if (b) errs.push(`${p} → ${b}`);
    else if (r.status === 200) ok++;
    else denied++;
  }
  check(errs.length === 0, `${role}: ${ok} ochildi, ${denied} ruxsatsiz/redirect/404`, errs.join("; "));
}
{
  // Sessiyasiz — hammasi login'ga yo'naltiriladi, 500 yo'q
  const c = new Client({ "x-forwarded-for": "10.88.1.1" });
  const errs = [];
  for (const p of pages) { const r = await c.get(p); if (bad(r) || r.status === 200) errs.push(`${p} → ${r.status}`); }
  check(errs.length === 0, `sessiyasiz: ${pages.length} sahifa yopiq`, errs.join("; "));
}
console.log(`  (server: ${BASE})`);
if (logFile) {
  const tail = fs.readFileSync(logFile, "utf8").slice(logStart);
  const errs = tail.split("\n").filter((l) => /⨯|Error:|TypeError|PrismaClient|digest/.test(l));
  check(errs.length === 0, "server log'ida yangi xato yo'q", errs.slice(0, 10).join("\n"));
}
summary("pages-all");
