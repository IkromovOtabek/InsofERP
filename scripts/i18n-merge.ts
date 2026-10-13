/**
 * Tarjima bo'laklarini rus lug'atiga qo'shish va ECO ilovasi nusxasini yangilash.
 *
 *   npx tsx scripts/i18n-merge.ts <bo'laklar papkasi> [--eco ../InsofECO/apps/mobile/src/core/ru.json]
 *
 * Bo'lak — `*.ru.json`: { exact: { "<o'zbekcha>": "<ruscha>" | null }, templates: { "<shablon {0}>": "<ruscha {0}>" | null } }
 * (`scripts/i18n-extract.ts --missing` chiqargan ro'yxatdan tarjima qilinadi). `null` — tarjima kerak emas, tashlanadi.
 * Natija: `src/i18n/ru.json` = { e: {...}, t: [[uz, ru], ...] } (mavjud yozuvlar saqlanadi, yangisi ustidan yoziladi).
 * Tekshiruv: kalit va qiymatdagi {N} o'rinlari bir xil bo'lmasa — yozuv tashlanadi va xabar chiqadi.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const ecoIdx = args.indexOf("--eco");
const ecoOut = ecoIdx >= 0 ? args[ecoIdx + 1] : null;
if (!dir) { console.error("ishlatish: tsx scripts/i18n-merge.ts <papka> [--eco <ECO ru.json>]"); process.exit(1); }

const OUT = path.join(process.cwd(), "src/i18n/ru.json");
type Dict = { e: Record<string, string>; t: [string, string][] };
const cur: Dict = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { e: {}, t: [] };
const tpl = new Map(cur.t);
const ph = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(",");
let added = 0, skipped = 0;

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ru.json")).sort()) {
  const b = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { exact?: Record<string, string | null>; templates?: Record<string, string | null> };
  for (const [k, v] of Object.entries(b.exact ?? {})) {
    if (!v || !v.trim() || v === k) continue;
    cur.e[k] = v; added++;
  }
  for (const [k, v] of Object.entries(b.templates ?? {})) {
    if (!v || !v.trim() || v === k) continue;
    if (ph(k) !== ph(v)) { console.warn(`[o'rin mos emas] ${f}: ${k} → ${v}`); skipped++; continue; }
    tpl.set(k, v); added++;
  }
}

// Barqaror tartib — git diff o'qiladigan bo'lsin
const out: Dict = {
  e: Object.fromEntries(Object.entries(cur.e).sort(([a], [b]) => a.localeCompare(b))),
  t: [...tpl].sort(([a], [b]) => a.localeCompare(b)),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${OUT}: ${Object.keys(out.e).length} matn, ${out.t.length} shablon (qo'shildi/yangilandi ${added}, tashlandi ${skipped})`);
if (ecoOut) { fs.writeFileSync(ecoOut, JSON.stringify(out)); console.log(`ECO nusxasi: ${ecoOut}`); }
