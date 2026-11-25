/**
 * «ISHLAB CHIQARISH.xlsx» kunlik «Ishlab ch.» soni → Ish haqi → Tabel → brigada varag'i (oy qatorlari + kunlik son).
 * Otabek, 2026-11-25: «tabelga brigadalar qilgan ishlarni qo'y», narx — katalogdagi sdelka narxi; narxi yo'q mahsulotga
 * o'xshash mahsulot narxi (RATE_LIKE).
 *
 *   npx tsx scripts/excel-brigada-varaq.ts --file "<xlsx>" --oy 2026-11
 *       faqat hisobot (read-only): har brigada qatorlari, soni, summasi; qo'yiladigan narxlar
 *   … --yes
 *       yozish (oldin pg_dump!): 1) narxi yo'q mahsulotlarga o'xshashining sdelka narxi (Product.pieceRate, AuditLog);
 *       2) har brigadaga oy qatorlari — `saveBrigadeMonth` (mavjud qatorlar saqlanadi, yangisi qo'shiladi);
 *       3) kunlik son — `saveBrigadeOutput` (saytdagi varaq bilan bir xil yo'l, AuditLog «BrigadeSheet»).
 *
 * Excel ustun: varaqdagi qo'lda yozilgan son topshiriqdan (TaskProgress) avtomatik tushgan sonning o'rnini bosadi. Topshiriqdan
 * son tushgan, lekin Excel'da shu kuni yo'q katakka «0» yoziladi — varaq Excel bilan aynan bir xil bo'ladi.
 * Kelajak kuni yozilmaydi. Qayta ishga tushirish xavfsiz (upsert): faqat farq yoziladi. Oy yopilgan bo'lsa — to'xtaydi.
 */
import { join } from "node:path";
import { createRequire } from "node:module";
import type * as DbMod from "@/lib/db";
import type * as AuditMod from "@/lib/audit";
import type * as NameMod from "@/lib/product-name";
import type * as SheetMod from "@/lib/hr/brigade-sheet";
import type * as LockMod from "@/lib/hr/tabel-lock";
import type * as DavMod from "@/lib/davomat";
import type * as EnvMod from "./env";

const ROOT = process.env.INSOF_ROOT || process.cwd();
/** `excel-hovli-sverka.ts` bilan bir xil moslik */
const BRIGADES: Record<string, string> = { ilxom: "1-Brigada", ilhom: "1-Brigada", shuhrat: "2-Brigada", sardor: "3-Brigada", ismoil: "4-Brigada" };
const LAST_SECTION_BRIGADE = "5-Brigada";
const ALIASES: Record<string, string> = { "Koltso 1(90)": "Kolso 1(90)", "Koltso 1(60)": "Kolso 1(60)", "Dnisha 1": "Dnishka 1" };

/**
 * Narxi yo'q mahsulot → sdelka narxi olinadigan o'xshash mahsulot. PK — katalogdagi pog'ona bo'yicha (uzunligi ≤50 — 79 545,
 * 52–63 — 90 909, ≥65 — 102 273), bir xil eni va pog'onadagi qo'shni o'lcham.
 * Lotok, Bardyor, 2 LM — katalogda o'xshashi yo'q: eng yaqini (2 LM — PK pog'onasi, Lotok — Kolso 1, Bardyor — FBS 09).
 */
const RATE_LIKE: Record<string, string> = {
  "PK 34-12-8 A 400": "PK 33-12-8 A 400",
  "PK 37-10-8 A 400": "PK 38-10-8 A 400",
  "PK 37-12-8 A 400": "PK 38-12-8 A 400",
  "PK 40-10-8 A 400": "PK 43-10-8 A 400",
  "PK 40-12-8 A 400": "PK 39-12-8 A 400",
  "PK 42-10-8 A 400": "PK 43-10-8 A 400",
  "PK 47-10-8 A 400": "PK 46-10-8 A 400",
  "PK 53-10-8 A 400": "PK 54-10-8 A 400",
  "PK 56-12-8 A 400": "PK 55-12-8 A 400",
  "PK 60-10-8 A 400": "PK 61-10-8 A 400",
  "PK 66-12-8 A 400": "PK 65-12-8 A 400",
  "Koltso 1.5(90)": "Kolso 1(90)",
  "Koltso 1.5(60)": "Kolso 1(60)",
  "Dnisha 1.5": "Dnishka 1",
  "Opora Sv 110-3.5": "Opora cv 110-3,5",
  "Opora Sv 95-2.0": "Opora sv 950-2,5",
  "Opora Sv 80-2.0": "Opora cv 8-3,5",
  "FBS 09-4-6": "FBS 12-4-6",
  // Katalogda o'xshashi yo'q — eng yaqini (Otabek: «o'zing to'ldir», 2026-11-25); sahifada tahrirlanadi
  "Lotok 5": "Kolso 1(90)",
  "2 LM 57-10.5-15": "PK 57-10-8 A 400",
  "2 LM 44-11.5-15": "PK 44-10-8 A 400",
  "Bardyor 30x18x20": "FBS 09-4-6",
  "Bardyor 10x18x20": "FBS 09-4-6",
};

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
function opt(n: string): string | null {
  const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return null;
  const a = argv[i]!;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : (argv[i + 1] ?? null);
}
function fail(msg: string): never { console.error(`\n${msg}\n`); process.exit(1); }
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0);
const serialDay = (s: number) => new Date(Math.round((s - 25569) * 86_400_000)).toISOString().slice(0, 10);
const money = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ");

/** Excel → brigada → mahsulot nomi → kun (1..31) → son */
function readExcel(file: string, month: string) {
  const X = createRequire(join(ROOT, "package.json"))("xlsx") as typeof import("xlsx");
  const wb = X.readFile(file);
  const grid = X.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: "" });
  const head = grid[0] ?? [];
  const days: string[] = [];
  for (let c = 2; typeof head[c] === "number"; c += 3) days.push(serialDay(head[c] as number));
  if (!days.length || !days.every((d) => d.startsWith(month))) fail(`Excel sanalari ${month} oyiga mos emas (${days[0]} … ${days[days.length - 1]})`);
  const out = new Map<string, Map<string, Map<number, number>>>();
  let body: { i: number; name: string }[] = [];
  const flush = (brigade: string) => {
    const m = out.get(brigade) ?? new Map<string, Map<number, number>>();
    for (const { i, name } of body) {
      if (/brak/i.test(name)) continue;
      days.forEach((d, k) => {
        const q = num(grid[i]![2 + 3 * k]);
        if (!q) return;
        const byDay = m.get(name) ?? new Map<number, number>();
        const day = Number(d.slice(8, 10));
        byDay.set(day, (byDay.get(day) ?? 0) + q);
        m.set(name, byDay);
      });
    }
    out.set(brigade, m);
    body = [];
  };
  for (let i = 2; i < grid.length; i++) {
    const name = String(grid[i]?.[1] ?? "").trim();
    const j = /^jami\s+(\S+)/i.exec(name);
    if (j) { flush(BRIGADES[j[1]!.toLowerCase()] ?? fail(`«${name}» — brigada berilmagan (BRIGADES)`)); continue; }
    if (/^qoldiq$/i.test(name)) break;
    if (name) body.push({ i, name });
  }
  flush(LAST_SECTION_BRIGADE);
  return out;
}

async function main() {
  const file = opt("file") ?? fail(`--file "<xlsx>" bering`);
  const month = opt("oy") ?? fail("--oy 2026-11 bering");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail("--oy YYYY-MM");
  const yes = flag("yes");
  const { loadEnv } = (await import(join(ROOT, "scripts/env"))) as typeof EnvMod;
  loadEnv();
  if (!yes && process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    u.searchParams.set("options", "-c default_transaction_read_only=on");
    process.env.DATABASE_URL = u.toString();
  }
  const { db } = (await import(join(ROOT, "src/lib/db"))) as typeof DbMod;
  const { audit } = (await import(join(ROOT, "src/lib/audit"))) as typeof AuditMod;
  const N = (await import(join(ROOT, "src/lib/product-name"))) as typeof NameMod;
  const SH = (await import(join(ROOT, "src/lib/hr/brigade-sheet"))) as typeof SheetMod;
  const { tabelLock } = (await import(join(ROOT, "src/lib/hr/tabel-lock"))) as typeof LockMod;
  const { today } = (await import(join(ROOT, "src/lib/davomat"))) as typeof DavMod;
  const excel = readExcel(file, month);

  try {
    const lock = await tabelLock(month);
    if (lock) fail(`${month} tabeli yopilgan: ${lock}`);
    const [products, brigades, director] = await Promise.all([
      db.product.findMany({ where: { unit: { not: "m3" } }, select: { id: true, name: true, aliases: true, isActive: true, pieceRate: true } }),
      db.brigade.findMany({ select: { id: true, name: true } }),
      db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    ]);
    if (!director) fail("Faol direktor topilmadi");
    const findProduct = (name: string) => {
      const key = N.productNameKey(ALIASES[name] ?? name);
      const hits = products.filter((p) => N.productMatchesKey(p, key));
      return hits.find((p) => p.isActive) ?? hits[0] ?? null;
    };
    const rateOf = new Map(products.map((p) => [p.id, Number(p.pieceRate ?? 0)]));

    // 1) Narxi yo'q mahsulotlarga o'xshashining narxi
    const rateFix: { id: string; name: string; from: string; rate: number }[] = [];
    for (const [name, like] of Object.entries(RATE_LIKE)) {
      const p = findProduct(name), src = findProduct(like);
      if (!p || !src) { console.log(`Narx: «${name}» yoki «${like}» katalogda topilmadi — o'tkazildi`); continue; }
      const r = Number(src.pieceRate ?? 0);
      if (rateOf.get(p.id)! > 0 || !(r > 0)) continue;
      rateFix.push({ id: p.id, name: p.name, from: src.name, rate: r });
      rateOf.set(p.id, r);
    }

    // 2) Har brigada: qatorlar va kunlik son (Excel ustun, topshiriqdan tushgan Excel'da yo'q kunga «0»)
    const now = today();
    const lastDay = Number(month === now.slice(0, 7) ? now.slice(8, 10) : "31");
    const plan: { brigadeId: string; brigade: string; lines: { name: string; rate: number; productId: string }[]; items: { line: string; day: number; value: string }[]; qty: number; sum: number; zeros: number; noRate: string[] }[] = [];
    const missing: string[] = [];
    for (const [bName, rows] of excel) {
      const b = brigades.find((x) => x.name === bName) ?? fail(`Tizimda «${bName}» brigadasi yo'q`);
      const auto = (await SH.autoBrigadeOutput(month, `${month}-31`, [b.id])).get(b.id) ?? [];
      const sheet = await SH.brigadeSheet(month, b.id);
      const existing = new Map((sheet?.lines ?? []).filter((l) => l.productId).map((l) => [l.productId!, l]));
      const want = new Map<string, { name: string; rate: number; productId: string; byDay: Map<number, number> }>();
      for (const [xName, byDay] of rows) {
        const p = findProduct(xName);
        if (!p) { missing.push(`${bName}: ${xName}`); continue; }
        const line = existing.get(p.id) ?? { name: p.name, rate: rateOf.get(p.id) ?? 0, productId: p.id };
        const w = want.get(p.id) ?? { name: line.name, rate: line.rate || (rateOf.get(p.id) ?? 0), productId: p.id, byDay: new Map() };
        for (const [d, q] of byDay) w.byDay.set(d, (w.byDay.get(d) ?? 0) + q);
        want.set(p.id, w);
      }
      for (const a of auto) if (!want.has(a.productId)) {
        const line = existing.get(a.productId);
        want.set(a.productId, { name: line?.name ?? a.name, rate: line?.rate || (rateOf.get(a.productId) ?? a.rate), productId: a.productId, byDay: new Map() });
      }
      const items: { line: string; day: number; value: string }[] = [];
      let qty = 0, sum = 0, zeros = 0;
      for (const w of want.values()) {
        const autoDays = auto.find((a) => a.productId === w.productId)?.byDay ?? new Map<number, number>();
        const days = new Set([...w.byDay.keys(), ...autoDays.keys()]);
        for (const d of [...days].sort((x, y) => x - y)) {
          if (d > lastDay) continue;
          const q = w.byDay.get(d) ?? 0;
          const cur = sheet?.qty[w.name]?.[d];
          if (cur === q) continue;
          items.push({ line: w.name, day: d, value: String(q) });
          if (!q) zeros++;
        }
        const t = [...w.byDay].filter(([d]) => d <= lastDay).reduce((a, [, q]) => a + q, 0);
        qty += t; sum += t * w.rate;
      }
      const lines = [...want.values()].map(({ name, rate, productId }) => ({ name, rate, productId }));
      plan.push({ brigadeId: b.id, brigade: b.name, lines, items, qty, sum, zeros, noRate: lines.filter((l) => !(l.rate > 0)).map((l) => l.name) });
    }

    // Hisobot
    console.log(`\n${month} brigada varaqlari (Excel: ${file}), ${lastDay}-kungacha:`);
    if (rateFix.length) console.log(`\nSdelka narxi qo'yiladi (${rateFix.length}):\n  ${rateFix.map((r) => `${r.name} = ${money(r.rate)}  («${r.from}» kabi)`).join("\n  ")}`);
    for (const p of plan) {
      console.log(`\n${p.brigade}: ${p.lines.length} qator, ${p.qty} dona, ${money(p.sum)} so'm; yoziladigan katak ${p.items.length}${p.zeros ? ` (shundan ${p.zeros} ta «0» — topshiriqdan tushgan, Excel'da yo'q)` : ""}`);
      if (p.noRate.length) console.log(`  Narxsiz qator (0 so'm): ${p.noRate.join(", ")}`);
    }
    if (missing.length) console.log(`\nKatalogda topilmadi: ${missing.join("; ")}`);
    console.log(`\nJami: ${plan.reduce((a, p) => a + p.qty, 0)} dona, ${money(plan.reduce((a, p) => a + p.sum, 0))} so'm (sdelka fondi, brak va soatlarsiz).`);
    if (!yes) { console.log("\nHech narsa yozilmadi (faqat o'qildi). Yozish: … --yes (oldin pg_dump!)\n"); return; }

    // Yozish
    if (rateFix.length) {
      await db.$transaction(async (tx) => {
        for (const r of rateFix) {
          const n = await tx.product.updateMany({ where: { id: r.id, OR: [{ pieceRate: null }, { pieceRate: 0 }] }, data: { pieceRate: r.rate } });
          if (n.count) await audit(tx, director.id, "UPDATE", "Product", r.id, { pieceRate: null }, { pieceRate: r.rate, via: "excel-brigada-varaq", like: r.from });
        }
      });
    }
    const who = { userId: director.id };
    for (const p of plan) {
      const sheet = await SH.brigadeSheet(month, p.brigadeId);
      const keep = (sheet?.lines ?? []).filter((l) => !p.lines.some((x) => x.productId === l.productId || x.name === l.name));
      const m = await SH.saveBrigadeMonth(who, month, p.brigadeId, { lines: [...keep, ...p.lines], brak: null });
      if ("error" in m && m.error) throw new Error(`${p.brigade}: ${m.error}`);
      for (let i = 0; i < p.items.length; i += 500) {
        const r = await SH.saveBrigadeOutput(who, month, p.brigadeId, p.items.slice(i, i + 500));
        if ("error" in r && r.error) throw new Error(`${p.brigade}: ${r.error}`);
      }
      console.log(`Yozildi: ${p.brigade} — ${p.lines.length} qator, ${p.items.length} katak`);
    }
    console.log("\nTayyor. Qayta ishga tushirsangiz — yoziladigan katak 0 bo'lishi kerak.\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
