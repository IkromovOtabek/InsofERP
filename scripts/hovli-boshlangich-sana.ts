/**
 * Hovli: oy boshida qo'lda kiritilgan boshlang'ich qoldiq → o'tgan oyning oxirgi kuni (bir martalik tuzatish).
 * Otabek, 2026-11-25: «qoldiqni har doim oyning oxiri 30 yoki 31-sanasidan olsin». 1-noyabrda «Tayyor mahsulot qo'shish»
 * bilan kiritilgan oktabr qoldig'i noyabr kirimi bo'lib ko'rinardi (Hovli «Jami» kirimi Excel «Ishlab ch.» dan 495 ga ko'p).
 *
 *   npx tsx scripts/hovli-boshlangich-sana.ts --oy 2026-11            faqat hisobot (read-only)
 *   npx tsx scripts/hovli-boshlangich-sana.ts --oy 2026-11 --yes --expect <soni>   yozish (oldin pg_dump!)
 *
 * Qaysi yozuvlar: dona mahsulotning qo'lda qo'shilgan (ADJUSTMENT, refType "Manual", qty > 0) harakati, sanasi oyning
 * 1-kuni (Toshkent vaqti). Sanasi o'tgan oyning oxirgi kuni 12:00 ga o'zgaradi — miqdor, ombor, egasi o'zgarmaydi,
 * qoldiq o'zgarmaydi; faqat oy aylanmasida kirim emas, boshlang'ich qoldiq bo'lib ko'rinadi. Har yozuv AuditLog'ga
 * (UPDATE StockMove, avvalgi sana bilan). O'tgan oy sklad bo'yicha yopilgan bo'lsa — trigger rad etadi, hammasi bekor.
 */
import { join } from "node:path";
import type * as DbMod from "@/lib/db";
import type * as AuditMod from "@/lib/audit";
import type * as LockMod from "@/lib/stock-lock";
import type * as EnvMod from "./env";

const ROOT = process.env.INSOF_ROOT || process.cwd();
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
function opt(n: string): string | null {
  const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return null;
  const a = argv[i]!;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : (argv[i + 1] ?? null);
}
function fail(msg: string): never { console.error(`\n${msg}\n`); process.exit(1); }

async function main() {
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
  const { auditMany } = (await import(join(ROOT, "src/lib/audit"))) as typeof AuditMod;
  const { lockStock } = (await import(join(ROOT, "src/lib/stock-lock"))) as typeof LockMod;

  const [y, m] = month.split("-").map(Number);
  const first = new Date(`${month}-01T00:00:00+05:00`);
  const second = new Date(`${month}-02T00:00:00+05:00`);
  const prevLast = new Date(Date.UTC(y!, m! - 1, 0)).toISOString().slice(0, 10); // o'tgan oyning oxirgi kuni
  const target = new Date(`${prevLast}T12:00:00+05:00`);
  const where = { type: "ADJUSTMENT" as const, refType: "Manual", qty: { gt: 0 }, productId: { not: null }, product: { unit: { not: "m3" } }, date: { gte: first, lt: second } };

  try {
    const prevMonth = prevLast.slice(0, 7);
    const closed = await db.periodClose.findUnique({ where: { section_month: { section: "sklad", month: prevMonth } }, select: { closedAt: true } });
    if (closed) fail(`${prevMonth} sklad bo'yicha yopilgan — avval oyni oching (Moliya → Oy yopish)`);
    const rows = await db.stockMove.findMany({ where, select: { id: true, date: true, qty: true, ownerBrigadeId: true, product: { select: { name: true } }, ownerBrigade: { select: { name: true } } }, orderBy: { date: "asc" } });
    const total = rows.reduce((a, r) => a + Number(r.qty), 0);
    const by = new Map<string, { n: number; q: number }>();
    for (const r of rows) { const k = r.ownerBrigade?.name ?? "Umumiy hovli"; const x = by.get(k) ?? { n: 0, q: 0 }; x.n++; x.q += Number(r.qty); by.set(k, x); }
    console.log(`\n${month}-01 dagi qo'lda boshlang'ich qoldiq → ${prevLast} 12:00: ${rows.length} yozuv, ${total} dona`);
    for (const [k, x] of by) console.log(`  ${k}: ${x.n} yozuv, ${x.q} dona`);
    if (!yes) { console.log(`\nHech narsa yozilmadi. Yozish (oldin pg_dump!): --oy ${month} --yes --expect ${rows.length}\n`); return; }

    const expect = Number(opt("expect"));
    if (!Number.isInteger(expect) || expect !== rows.length) fail(`--expect ${rows.length} bering (hisobotdagi son)`);
    const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!director) fail("Faol direktor topilmadi");
    await db.$transaction(async (tx) => {
      await lockStock(tx);
      const now = await tx.stockMove.findMany({ where, select: { id: true, date: true } });
      if (now.length !== expect) throw new Error(`Yozuvlar soni ${now.length}, --expect ${expect} — baza o'zgargan`);
      const ids = now.map((r) => r.id);
      await tx.stockMove.updateMany({ where: { id: { in: ids } }, data: { date: target } });
      await auditMany(tx, director.id, "UPDATE", "StockMove", now.map((r) => ({ id: r.id, before: { date: r.date }, after: { date: target, via: "hovli-boshlangich-sana" } })));
    }, { timeout: 120_000, maxWait: 30_000 });
    console.log(`\nYozildi: ${rows.length} yozuv sanasi ${prevLast} ga o'tdi.\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
