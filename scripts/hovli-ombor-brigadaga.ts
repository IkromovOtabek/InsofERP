/**
 * Umumiy hovlidagi tayyor mahsulotni brigada omboriga biriktirish — Excel'dagi qatorlar bo'yicha (bir martalik tuzatish).
 * Otabek, 2026-11-25: «ISHLAB CHIQARISH.xlsx» 230–253-qatorlari (2 LM plita, bardyor, lotok, kolso, krishka, dnishka,
 * opora, FBS) 5-Brigadaga tegishli — 2026-11-24 sverkasida (`excel-hovli-sverka.ts`) umumiy hovliga yozilgan edi.
 *
 *   npx tsx scripts/hovli-ombor-brigadaga.ts --file "<xlsx>" --qatorlar 230-253 --brigada "5-Brigada"
 *       faqat hisobot (ulanish read-only): qaysi mahsulot, nechta yozuv, qancha qoldiq o'tadi
 *   … --yes --expect <yozuvlar soni>
 *       yozish (oldin pg_dump!) — bitta tranzaksiyada, sklad qulfi ostida
 *
 * Nima qiladi: shu mahsulotlarning asosiy skladdagi egasiz (umumiy hovli, `ownerBrigadeId = null`) BARCHA harakatlari
 * shu brigadaga o'tkaziladi (`ownerBrigadeId`; ishlab chiqarish yozuvida bo'sh `brigadeId` ham). Miqdor, sana, tur
 * o'zgarmaydi — sklad jami o'zgarmaydi, umumiy hovlida shu mahsulotlar 0 bo'ladi, brigada ustunida noyabr
 * kirim/chiqimi Excel'dagidek ko'rinadi. Ko'chirish (OWNER_TRANSFER) yozuvlari tegilmaydi (juftligi buzilmasin).
 * Har o'zgargan yozuv AuditLog'ga (UPDATE, StockMove) avvalgi egasi bilan yoziladi — qaytarish shu yerdan.
 */
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Prisma } from "@/generated/prisma";
import type * as DbMod from "@/lib/db";
import type * as AuditMod from "@/lib/audit";
import type * as LockMod from "@/lib/stock-lock";
import type * as NameMod from "@/lib/product-name";
import type * as EnvMod from "./env";

const ROOT = process.env.INSOF_ROOT || process.cwd();
/** Excel nomi → katalogdagi nom (`excel-hovli-sverka.ts` bilan bir xil) */
const ALIASES: Record<string, string> = { "Koltso 1(90)": "Kolso 1(90)", "Koltso 1(60)": "Kolso 1(60)", "Dnisha 1": "Dnishka 1" };

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
function opt(n: string): string | null {
  const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return null;
  const a = argv[i]!;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : (argv[i + 1] ?? null);
}
function fail(msg: string): never { console.error(`\n${msg}\n`); process.exit(1); }
const r3 = (n: number) => Math.round(n * 1000) / 1000;

async function main() {
  const file = opt("file") ?? fail(`--file "<xlsx yo'li>" bering`);
  const range = /^(\d+)-(\d+)$/.exec(opt("qatorlar") ?? "") ?? fail("--qatorlar 230-253 ko'rinishida bering (Excel qator raqamlari)");
  const brigadeName = opt("brigada") ?? fail(`--brigada "5-Brigada" bering`);
  const yes = flag("yes");
  const [from, to] = [Number(range[1]), Number(range[2])];
  if (!(from >= 1 && to >= from && to - from < 200)) fail("Qatorlar oralig'i noto'g'ri");

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
  const N = (await import(join(ROOT, "src/lib/product-name"))) as typeof NameMod;

  // Excel qatorlaridagi mahsulot nomlari (B ustun; «brak» qatorlari — alohida hujjat, o'tkaziladi)
  const X = createRequire(join(ROOT, "package.json"))("xlsx") as typeof import("xlsx");
  const wb = X.readFile(file);
  const grid = X.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: "" });
  const names: string[] = [];
  for (let r = from; r <= to; r++) {
    const n = String(grid[r - 1]?.[1] ?? "").trim();
    if (n && !/brak/i.test(n) && !/^jami|^qoldiq$/i.test(n)) names.push(n);
  }
  if (!names.length) fail("Bu qatorlarda mahsulot topilmadi");

  try {
    const collect = async (tx: Prisma.TransactionClient) => {
      const [products, brigade, wh] = await Promise.all([
        tx.product.findMany({ where: { unit: { not: "m3" } }, select: { id: true, name: true, aliases: true, isActive: true } }),
        tx.brigade.findFirst({ where: { name: brigadeName }, select: { id: true, name: true } }),
        tx.warehouse.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
      ]);
      if (!brigade) fail(`Tizimda «${brigadeName}» brigadasi yo'q`);
      if (!wh) fail("Sklad topilmadi");
      const missing: string[] = [];
      const ids = new Map<string, string>();
      for (const n of names) {
        const key = N.productNameKey(ALIASES[n] ?? n);
        const hits = products.filter((p) => N.productMatchesKey(p, key));
        const p = hits.find((x) => x.isActive) ?? hits[0];
        if (p) ids.set(p.id, p.name); else missing.push(n);
      }
      const moves = await tx.stockMove.findMany({
        where: { productId: { in: [...ids.keys()] }, warehouseId: wh.id, ownerBrigadeId: null, type: { not: "OWNER_TRANSFER" } },
        select: { id: true, productId: true, type: true, qty: true, date: true, brigadeId: true },
      });
      const transfers = await tx.stockMove.count({ where: { productId: { in: [...ids.keys()] }, warehouseId: wh.id, ownerBrigadeId: null, type: "OWNER_TRANSFER" } });
      return { brigade, wh, ids, missing, moves, transfers };
    };
    const report = (d: Awaited<ReturnType<typeof collect>>) => {
      console.log(`\nExcel ${from}–${to}-qatorlar: ${names.length} mahsulot → «${d.brigade.name}», sklad «${d.wh.name}»`);
      if (d.missing.length) console.log(`Katalogda topilmadi (o'tkazib yuboriladi): ${d.missing.join(", ")}`);
      const by = new Map<string, { n: number; bal: number }>();
      for (const m of d.moves) { const x = by.get(m.productId!) ?? { n: 0, bal: 0 }; x.n++; x.bal = r3(x.bal + Number(m.qty)); by.set(m.productId!, x); }
      for (const [pid, name] of d.ids) { const x = by.get(pid); console.log(`  ${name.padEnd(22)} ${String(x?.n ?? 0).padStart(3)} yozuv   umumiy hovli qoldig'i ${x?.bal ?? 0} → ${d.brigade.name}`); }
      console.log(`Jami: ${d.moves.length} yozuv, ${r3(d.moves.reduce((a, m) => a + Number(m.qty), 0))} dona o'tadi.`);
      if (d.transfers) console.log(`Ogohlantirish: umumiy hovlida shu mahsulotlarning ${d.transfers} ta ko'chirish yozuvi bor — tegilmaydi.`);
    };

    if (!yes) {
      const d = await db.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return collect(tx); }, { timeout: 120_000 });
      report(d);
      console.log(`\nHech narsa yozilmadi (faqat o'qildi). Yozish (oldin pg_dump!):\n  --file "${file}" --qatorlar ${from}-${to} --brigada "${brigadeName}" --yes --expect ${d.moves.length}\n`);
      return;
    }
    const expect = Number(opt("expect"));
    if (!Number.isInteger(expect) || expect < 0) fail("--yes bilan --expect <hisobotdagi yozuvlar soni> ham bering");
    const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!director) fail("Faol direktor topilmadi — AuditLog uchun kerak");
    const d = await db.$transaction(async (tx) => {
      await lockStock(tx);
      const d = await collect(tx);
      if (d.moves.length !== expect) throw new Error(`Yozuvlar soni ${d.moves.length}, --expect ${expect} — baza o'zgargan. Hisobotni qayta ishga tushiring`);
      const ids = d.moves.map((m) => m.id);
      await tx.stockMove.updateMany({ where: { id: { in: ids }, ownerBrigadeId: null }, data: { ownerBrigadeId: d.brigade.id } });
      await tx.stockMove.updateMany({ where: { id: { in: ids }, type: "PRODUCTION_OUTPUT", brigadeId: null }, data: { brigadeId: d.brigade.id } });
      await auditMany(tx, director.id, "UPDATE", "StockMove", d.moves.map((m) => ({
        id: m.id, before: { ownerBrigadeId: null, brigadeId: m.brigadeId },
        after: { ownerBrigadeId: d.brigade.id, brigadeId: m.type === "PRODUCTION_OUTPUT" && !m.brigadeId ? d.brigade.id : m.brigadeId, via: "hovli-ombor-brigadaga", excelRows: `${from}-${to}` },
      })));
      const left = await tx.stockMove.count({ where: { id: { in: ids }, ownerBrigadeId: null } });
      if (left) throw new Error(`${left} ta yozuv o'tmadi — bekor qilindi`);
      return d;
    }, { timeout: 300_000, maxWait: 30_000 });
    report(d);
    console.log(`\nYozildi: ${d.moves.length} yozuv «${d.brigade.name}» omboriga o'tdi.\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
