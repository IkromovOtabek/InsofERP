/**
 * IT panel yordam lug'ati (src/lib/control/help-content.ts) — server va baza shart emas:
 *   npx tsx scripts/qa/d-help.mts
 *
 * Tekshiradi:
 *  - har ACTION_TYPES amali uchun to'liq yordam bor (nima qiladi, xavfi, vaqti, qachon ishlatish);
 *  - helpForCheckKey agent va xavfsizlik moduli yozadigan HAR kalit uchun maxsus (fallback emas) yordam qaytaradi.
 *    Kalitlar ro'yxati MANBA KODDAN avtomatik yig'iladi (scripts/insof-agent.ts, scripts/agent/*.ts, security/*.ts) —
 *    yangi kalit qo'shilib, yordami yozilmasa test yiqiladi;
 *  - lug'atdagi har yozuvning majburiy maydonlari bo'sh emas, `teskari tirnoq`lar juft;
 *  - panel kodidagi har topic="…" lug'atda bor.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_TYPES, checkKey } from "../../src/lib/control/monitor/contract.ts";
import { DBT_KEYS } from "../../src/lib/control/dbtraffic/contract.ts";
import { infraKey } from "../../src/lib/control/infra/contract.ts";
import { RELEASE_CHECK_KEY } from "../../src/lib/control/devops/contract.ts";
import { CHECK_KEY_EXAMPLES, HELP, HELP_GROUPS, actionHelpId, helpForCheckKey, type HelpTopic } from "../../src/lib/control/help-content.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let ok = 0, fail = 0;
function check(cond: unknown, name: string, info = "") {
  if (cond) ok++;
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ""}`); }
}
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");
const list = (dir: string, re: RegExp): string[] => readdirSync(path.join(REPO, dir)).flatMap((f) => {
  const rel = path.join(dir, f);
  return statSync(path.join(REPO, rel)).isDirectory() ? list(rel, re) : re.test(f) ? [rel] : [];
});
const filled = (s: unknown) => typeof s === "string" && s.trim().length > 0;
const ticksOk = (s: string | undefined) => !s || (s.match(/`/g) ?? []).length % 2 === 0;

/* 1. Amallar */
console.log("1. Har amal (ACTION_TYPES) uchun yordam");
for (const t of ACTION_TYPES) {
  const id = actionHelpId(t);
  const h = id ? HELP[id] : null;
  check(h && h.action && filled(h.action.does) && filled(h.action.risk) && filled(h.action.duration) && filled(h.action.use) && filled(h.what),
    `action:${t} to'liq`, h ? JSON.stringify(h.action ?? null).slice(0, 80) : "yo'q");
}

/* 2. Tekshiruv kalitlari — manba koddan */
console.log("2. helpForCheckKey: agent va xavfsizlik kalitlari");
const PREFIXES = "host|unit|http|db|ssl|backup|journal|agent|security|traffic|release|ai";
const keys = new Set<string>();
const agentFiles = ["scripts/insof-agent.ts", ...list("scripts/agent", /\.ts$/)];
for (const f of agentFiles) {
  const src = read(f);
  // "host:load", `journal:${u}`, 'security:scan' …  (template ichidagi ${…} → namunaviy qiymat)
  for (const m of src.matchAll(new RegExp(`["'\`]((?:${PREFIXES}):(?!\\/)[a-z0-9@:._-]*)(\\$\\{)?`, "g"))) keys.add(m[1] + (m[2] ? "demo" : ""));
  // systemd unit nomlari ro'yxati (unitsToCheck) → unit:<nom>
  for (const m of src.matchAll(/"((?:insof-[a-z-]+|nginx|postgresql@[0-9a-z-]+))"/g)) if (!m[1].endsWith("-")) keys.add(`unit:${m[1]}`);
}
// contract funksiyalari (checkKey.*), baza/trafik, infra va reliz kalitlari
for (const [name, fn] of Object.entries(checkKey)) if (name !== "security") keys.add((fn as (a: string) => string)(name === "unit" ? "insof-erp@demo" : name === "ssl" ? "demo.insof-erp.uz" : "demo"));
for (const v of Object.values(DBT_KEYS)) keys.add(typeof v === "function" ? v("demo.insof-erp.uz") : v);
for (const fn of Object.values(infraKey)) keys.add(fn());
keys.add(RELEASE_CHECK_KEY);
keys.add("unit:insof-agent");
keys.add("ai:0123456789ab"); // aiIncidentKey(...) → ai:<sha1>
// xavfsizlik moduli: finding("nom", …) / unknown("nom", …) / index.ts dagi tekshiruv nomlari
const secNames = new Set<string>(["scan"]);
for (const f of list("src/lib/control/security", /\.ts$/)) {
  const src = read(f);
  for (const m of src.matchAll(/\b(?:finding|unknown)\(\s*"([a-z0-9-]+)"/g)) secNames.add(m[1]);
  if (f.endsWith("index.ts")) for (const m of src.matchAll(/\{\s*name:\s*"([a-z0-9-]+)"/g)) secNames.add(m[1]);
}
for (const n of secNames) keys.add(`security:${n}`);
// bo'sh prefikslar (masalan "http:" yolg'iz) — haqiqiy kalit emas
keys.delete("security:"); // prefiks tekshiruvi (securityKey) — nomlar yuqorida alohida
for (const k of [...keys]) if (/^[a-z]+:$/.test(k) || k === "http:tenant:" || k === "db:tenant:" || k === "traffic:upstream:") { keys.delete(k); keys.add(`${k}demo`); }

check(secNames.size >= 20, "xavfsizlik nomlari topildi", String(secNames.size));
check([...keys].some((k) => k.startsWith("journal:")) && keys.has("host:load") && keys.has("security:ssh-bruteforce") && keys.has("unit:postgresql@14-main"),
  "kalitlar manba koddan yig'ildi", [...keys].slice(0, 8).join(", "));
const prefixesSeen = new Set<string>();
for (const k of [...keys].sort()) {
  const h = helpForCheckKey(k);
  prefixesSeen.add(k.split(":")[0]);
  check(!h.fallback, `maxsus yordam: ${k}`, h.title);
  check(h.check && filled(h.title) && filled(h.what) && (h.steps?.length ?? 0) > 0 && h.steps!.every(filled), `yordam to'liq: ${k}`);
}
for (const p of PREFIXES.split("|")) check(prefixesSeen.has(p), `prefiks qamrab olingan: ${p}`);
check(helpForCheckKey("zzz:noma'lum").fallback === true, "noma'lum kalit → umumiy yordam (fallback)");
check(helpForCheckKey("unit:insof-erp@sharq").title.includes("sharq") && helpForCheckKey("unit:insof-erp@sharq").steps!.some((s) => s.includes("insof-erp@sharq")), "korxona xizmati yordamida slug va buyruq");
for (const k of CHECK_KEY_EXAMPLES) check(!helpForCheckKey(k).fallback, `«Yordam» sahifasi namunasi: ${k}`);
console.log(`   ${keys.size} kalit, ${secNames.size} xavfsizlik nomi`);

/* 3. Lug'at yozuvlari */
console.log("3. Lug'at yozuvlari");
const all: [string, HelpTopic][] = Object.entries(HELP);
for (const [id, t] of all) {
  check(filled(t.title) && filled(t.what), `${id}: sarlavha va «Bu nima?»`);
  check(t.group in HELP_GROUPS, `${id}: guruh`, t.group);
  if (t.group !== "atama") check(filled(t.normal) || (t.steps?.length ?? 0) > 0 || !!t.action || id.startsWith("form:") || id.startsWith("tenant:") || id.startsWith("inc:") || id.startsWith("rel:") || id.startsWith("log:") || id.startsWith("srv:") || id.startsWith("tr:") || id.startsWith("db:") || id.startsWith("sec:") || id.startsWith("jur:") || id.startsWith("act:") || id.startsWith("zx:"),
    `${id}: normal holat / qadamlar / amal`);
  if (t.steps) check(t.steps.every(filled), `${id}: qadamlar bo'sh emas`);
  const texts = [t.title, t.what, t.why, t.normal, ...(t.steps ?? []), t.action?.does, t.action?.risk, t.action?.use, t.action?.avoid, t.action?.duration];
  check(texts.every((s) => ticksOk(s as string | undefined)), `${id}: \`teskari tirnoq\` juft`);
}
check(Object.keys(HELP).filter((k) => k.startsWith("page:")).length >= 15, "har panel sahifasi uchun «Bu sahifa haqida»");
check(all.length >= 120, "mavzular soni", String(all.length));

/* 4. Panel kodidagi topic="…" lug'atda bor */
console.log("4. Panel kodidagi mavzu nomlari");
const panelFiles = [...list("src/app/superadmin", /\.tsx?$/)];
let refs = 0;
for (const f of panelFiles) {
  for (const m of read(f).matchAll(/topic="([^"]+)"/g)) {
    refs++;
    check(Object.prototype.hasOwnProperty.call(HELP, m[1]), `${f}: topic="${m[1]}" lug'atda bor`);
  }
}
check(refs >= 80, "panelda yordam tugmalari", String(refs));
const pages = list("src/app/superadmin/(panel)", /^page\.tsx$/).filter((f) => !f.includes("yordam"));
for (const p of pages) {
  const src = read(p);
  const view = src.match(/from "\.\/view"/) ? read(path.join(path.dirname(p), "view.tsx")) : "";
  check(/PageHelp/.test(src + view), `«Bu sahifa haqida»: ${p}`);
}

console.log(`\n${ok} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
