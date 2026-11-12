/**
 * Ro'yxatlar (spravochniklar)dagi kirill yozuvli nomlarni lotinga o'tkazish — bir martalik tozalash.
 * Tayyor mahsulot, xomashyo, mijoz, obyekt, yetkazuvchi, brigada, transport, xodim, kassa hisoblari va h.k.
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/royxatlar-lotinga.ts          (faqat ro'yxat)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/royxatlar-lotinga.ts --yes    (yozish)
 *   ... --faqat=Product,Material   — faqat shu jadvallar
 *
 * Qoida `toLatin` (lib/translit.ts); birlik ustuni `normalizeUnit` bilan kanonik kodga keltiriladi (шт → dona, м3 → m3).
 * Hujjatlar (zayavka, reys, kassa izohlari) tegilmaydi — faqat ro'yxat yozuvlarining nomi.
 * Har o'zgarish AuditLog'ga UPDATE bo'lib yoziladi. Shu nom boshqa yozuvda allaqachon bo'lsa — ogohlantirish
 * (unique ustunda o'tkazib yuboriladi, qo'lda birlashtiriladi). Oldin pg_dump zaxira oling.
 */
import { loadEnv } from "./env";
loadEnv();

/** [jadval, ustunlar] — faqat ro'yxat (spravochnik) jadvallari */
const TARGETS: [string, string[]][] = [
  ["Product", ["name", "unit"]],
  ["ProductGroup", ["name"]],
  ["Material", ["name", "unit"]],
  ["MaterialGroup", ["name"]],
  ["Customer", ["name", "address"]],
  ["Site", ["name", "address"]],
  ["SiteBlock", ["name"]],
  ["Supplier", ["name", "address"]],
  ["Brigade", ["name"]],
  ["Warehouse", ["name"]],
  ["Vehicle", ["brand", "model"]],
  ["Employee", ["fullName", "position", "address"]],
  ["User", ["fullName"]],
  ["StockRecipient", ["name"]],
  ["CashAccount", ["name"]],
  ["CashCategory", ["name"]],
  ["WorkPosition", ["name"]],
  ["Project", ["name"]],
  ["RentShop", ["name", "address"]],
  ["LogisticsAccount", ["name"]],
  ["FixedAsset", ["name"]],
  ["ShiftTemplate", ["name"]],
];

const CYR_RE = "[А-Яа-яЁёЎўҚқҒғҲҳІі]";
const q = (id: string) => `"${id.replace(/"/g, "")}"`;

type Change = { table: string; col: string; id: string; from: string; to: string; dup: boolean };

async function main() {
  const { db } = await import("@/lib/db");
  const { toLatin } = await import("@/lib/translit");
  const { normalizeUnit } = await import("@/lib/unit");
  const { audit } = await import("@/lib/audit");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");
  const only = process.argv.find((a) => a.startsWith("--faqat="))?.slice(8).split(",").map((s) => s.trim()).filter(Boolean);

  const cols = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`,
  );
  const has = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));

  const changes: Change[] = [];
  for (const [table, list] of TARGETS) {
    if (only && !only.includes(table)) continue;
    if (!has.has(`${table}.id`)) continue;
    for (const col of list) {
      if (!has.has(`${table}.${col}`)) continue;
      const rows = await db.$queryRawUnsafe<{ id: string; v: string }[]>(
        `SELECT id, ${q(col)} AS v FROM ${q(table)} WHERE ${q(col)} ~ '${CYR_RE}' ORDER BY ${q(col)}`,
      );
      if (!rows.length) continue;
      // Shu nom boshqa yozuvda bormi (katta-kichik harfsiz) — birlashtirish kerak bo'lishi mumkin
      const all = await db.$queryRawUnsafe<{ v: string }[]>(`SELECT lower(${q(col)}) AS v FROM ${q(table)} WHERE ${q(col)} IS NOT NULL`);
      const existing = new Set(all.map((r) => r.v));
      for (const r of rows) {
        const to = col === "unit" ? (normalizeUnit(r.v) ?? toLatin(r.v)) : toLatin(r.v);
        if (to === r.v) continue;
        changes.push({ table, col, id: r.id, from: r.v, to, dup: col !== "address" && existing.has(to.toLowerCase()) });
      }
    }
  }

  console.log(`\nBaza: ${dbLabel()}\nKirill yozuvli qiymat: ${changes.length} ta\n`);
  let cur = "";
  for (const c of changes) {
    const key = `${c.table}.${c.col}`;
    if (key !== cur) { cur = key; console.log(`\n${key} (${changes.filter((x) => `${x.table}.${x.col}` === key).length})`); }
    console.log(`  ${c.from}  →  ${c.to}${c.dup ? "   ⚠ shu nom allaqachon bor" : ""}`);
  }
  const dups = changes.filter((c) => c.dup).length;
  if (dups) console.log(`\n⚠ ${dups} ta qiymat lotindagi mavjud yozuv bilan bir xil bo'ladi — ikki nusxani keyin qo'lda birlashtiring.`);
  if (!confirmed) { console.log("\nFaqat ro'yxat. Yozish uchun: --yes\n"); return; }
  if (!changes.length) return;

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — audit kimga yozilishini bilmaymiz");

  let ok = 0;
  const skipped: string[] = [];
  for (const c of changes) {
    const touch = has.has(`${c.table}.updatedAt`) ? `, ${q("updatedAt")} = now()` : "";
    try {
      const n = await db.$transaction(async (tx) => {
        // Shartli: o'qilgandan keyin kimdir o'zgartirgan bo'lsa — tegilmaydi
        const n = await tx.$executeRawUnsafe(
          `UPDATE ${q(c.table)} SET ${q(c.col)} = $1${touch} WHERE id = $2 AND ${q(c.col)} = $3`, c.to, c.id, c.from,
        );
        if (n) await audit(tx, director.id, "UPDATE", c.table, c.id, { [c.col]: c.from }, { [c.col]: c.to });
        return n;
      });
      if (n) ok++; else skipped.push(`${c.table}.${c.col}: «${c.from}» — o'zgargan`);
    } catch (e) {
      const msg = e instanceof Error && /23505|unique/i.test(e.message) ? "shu nom band (unique)" : e instanceof Error ? e.message.split("\n")[0] : String(e);
      skipped.push(`${c.table}.${c.col}: «${c.from}» — ${msg}`);
    }
  }
  console.log(`\nLotinga o'tkazildi: ${ok} ta`);
  if (skipped.length) console.log(`O'tkazib yuborildi (${skipped.length}):\n  ${skipped.join("\n  ")}`);
  console.log("ECO ilovasiga yangi nomlar uchun: npm run eco:sync\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
