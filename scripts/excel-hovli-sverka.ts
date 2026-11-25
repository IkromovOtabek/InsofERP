/**
 * «ISHLAB CHIQARISH.xlsx» (brigada × mahsulot × kun: Ishlab ch. / Chiqim / Qoldiq) → Sklad → Hovli (brigada omborlari) tenglashtirish.
 * Foydalanuvchi talabi (2026-11-24): tizimdagi tayyor mahsulot hovlisi Excel bilan bir xil bo'lsin.
 *
 *   npx tsx scripts/excel-hovli-sverka.ts --file "/tmp/ISHLAB CHIQARISH.xlsx"
 *       faqat hisobot (ulanish read-only): nima yozilishi, qaysi mahsulot ochilishi, ogohlantirishlar
 *   npx tsx scripts/excel-hovli-sverka.ts --file … --yes --expect <yoziladigan harakatlar soni>
 *       yozish (oldin pg_dump!). --expect — hisobotdagi son: orada baza o'zgargan bo'lsa to'xtaydi
 *
 * Serverda: cd /var/www/insof-erp/current && ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx /tmp/excel-hovli-sverka.ts …
 *
 * Qanday tenglashtiriladi (faqat farq yoziladi — qayta ishga tushirilsa hech narsa qo'shilmaydi):
 *   · Excel bo'limi («Jami <ism> Brigadr» qatorigacha) → brigada (BRIGADES); oxirgi bo'lim (plita/opora/FBS…) → LAST_SECTION_BRIGADE.
 *   · Boshlang'ich qoldiq (1-kun qoldig'i − 1-kun ishlab ch. + 1-kun chiqim) ↔ tizimda oy boshigacha + 1-kundagi qo'lda
 *     kiritilgan (ADJUSTMENT) qoldiq. Farq → ADJUSTMENT (refType "Manual") oy boshidan oldingi kun sanasi bilan — oy aylanmasiga aralashmaydi.
 *   · Har kun: Ishlab ch. ↔ tizimdagi kirimlar (PRODUCTION_OUTPUT, qo'lda qo'shish, ko'chirish) netto; farq → PRODUCTION_OUTPUT
 *     (brigada bilan; manfiy — storno). Chiqim ↔ SHIPMENT/ISSUE/WRITE_OFF netto; farq → SHIPMENT (refType "ExcelSverka").
 *   · Topshiriqdan umumiy hovliga tushgan mahsulot (brigadasiz) shu kuni Excelda qaysi brigada chiqargan bo'lsa — o'sha
 *     brigadaga ko'chiriladi (OWNER_TRANSFER); Excelda yo'q ortig'i storno qilinadi.
 *   · «Brak» qatorlari o'tkazib yuboriladi (brak — alohida hujjat). Excelda yo'q mahsulot katalogga ochiladi (faqat --yes da).
 *   · Hammasi bitta tranzaksiyada, sklad qulfi ostida; oxirida qayta hisoblanadi — farq qolsa hammasi bekor (rollback).
 *     AuditLog: bitta «StockMove» yozuvi (ro'yxat bilan) + ochilgan mahsulotlar.
 */
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Prisma } from "@/generated/prisma";
import type * as DbMod from "@/lib/db";
import type * as AuditMod from "@/lib/audit";
import type * as LockMod from "@/lib/stock-lock";
import type * as NameMod from "@/lib/product-name";
import type * as NameDbMod from "@/lib/product-name-db";
import type * as NumMod from "@/lib/numbering";
import type * as EnvMod from "./env";

type Tx = Prisma.TransactionClient;

const ROOT = process.env.INSOF_ROOT || process.cwd();
const TZ_MS = 5 * 3_600_000; // Asia/Tashkent
const EPS = 0.0005;
const REF = "ExcelSverka";
const NOTE = "Excel sverka (ISHLAB CHIQARISH.xlsx)";

/** Excel bo'limi (brigadir ismi) → tizimdagi brigada nomi. 1-noyabr qoldiqlari bo'yicha aniqlangan (2026-11-24 sverka). */
const BRIGADES: Record<string, string> = { ilxom: "1-Brigada", ilhom: "1-Brigada", shuhrat: "2-Brigada", sardor: "3-Brigada", ismoil: "4-Brigada" };
/** Oxirgi bo'lim («Jami … Brigadr» qatorisiz: 2 LM plita, bardyor, lotok, kolso, krishka, opora, FBS) — 5-Brigada (Otabek, 2026-11-25). */
const LAST_SECTION_BRIGADE = "5-Brigada";
/** Excel nomi → katalogdagi nom (yozilishi farq qiladi, bir mahsulot). */
const ALIASES: Record<string, string> = {
  "Koltso 1(90)": "Kolso 1(90)",
  "Koltso 1(60)": "Kolso 1(60)",
  "Dnisha 1": "Dnishka 1",
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

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0);
/** Excel sana seriyasi → "YYYY-MM-DD" */
const serialDay = (s: number) => new Date(Math.round((s - 25569) * 86_400_000)).toISOString().slice(0, 10);
const tashDay = (d: Date) => new Date(d.getTime() + TZ_MS).toISOString().slice(0, 10);
/** Toshkent kuni + soat → UTC Date */
const at = (day: string, hh: number) => new Date(`${day}T${String(hh).padStart(2, "0")}:00:00+05:00`);

// ───────────────────────── Excel ─────────────────────────

type XRow = { section: string; brigade: string | null; name: string; open: number; prod: number[]; out: number[]; close: number };
type XData = { days: string[]; rows: XRow[]; skipped: string[]; warnings: string[] };

function readExcel(file: string): XData {
  const X = createRequire(join(ROOT, "package.json"))("xlsx") as typeof import("xlsx");
  const wb = X.readFile(file);
  const grid = X.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: "" });
  const head = grid[0] ?? [];
  const days: string[] = [];
  for (let c = 2; typeof head[c] === "number"; c += 3) days.push(serialDay(head[c] as number));
  if (!days.length) fail("Excel sarlavhasida sanalar topilmadi (1-qator, C ustundan har 3 ustunda)");
  for (let i = 1; i < days.length; i++) if (days[i] !== tashAdd(days[i - 1]!, 1)) fail(`Excel sanalari ketma-ket emas: ${days[i - 1]} → ${days[i]}`);

  // Bo'limlar: «Jami <ism> Brigadr» qatori o'zidan oldingi qatorlarni yopadi; oxirgisidan keyingisi — umumiy hovli
  const body: { i: number; name: string }[] = [];
  const sections: { title: string; brigade: string | null; rows: { i: number; name: string }[] }[] = [];
  for (let i = 2; i < grid.length; i++) {
    const name = String(grid[i]?.[1] ?? "").trim();
    const m = /^jami\s+(\S+)/i.exec(name);
    if (m) {
      const key = m[1]!.toLowerCase();
      const b = BRIGADES[key];
      if (!b) fail(`«${name}» — bu brigadir uchun tizim brigadasi berilmagan (BRIGADES)`);
      sections.push({ title: m[1]!, brigade: b, rows: body.splice(0) });
      continue;
    }
    if (/^qoldiq$/i.test(name)) break;
    if (name) body.push({ i, name });
  }
  sections.push({ title: LAST_SECTION_BRIGADE, brigade: LAST_SECTION_BRIGADE, rows: body.splice(0) });

  const rows: XRow[] = [], skipped: string[] = [], warnings: string[] = [];
  for (const s of sections) {
    const merged = new Map<string, XRow>();
    for (const { i, name } of s.rows) {
      const r = grid[i]!;
      const prod = days.map((_, d) => num(r[2 + 3 * d]));
      const out = days.map((_, d) => num(r[3 + 3 * d]));
      const q = days.map((_, d) => num(r[4 + 3 * d]));
      const open = r3(q[0]! - prod[0]! + out[0]!);
      const close = q[days.length - 1]!;
      // Ichki tekshiruv: har kun qoldiq = kecha + ishlab ch. − chiqim
      let run = open;
      for (let d = 0; d < days.length; d++) {
        run = r3(run + prod[d]! - out[d]!);
        if (Math.abs(run - q[d]!) > EPS) { warnings.push(`${s.title} · ${name} · ${days[d]}: Excelda qoldiq ${q[d]}, hisob bo'yicha ${run}`); run = q[d]!; }
      }
      if (/brak/i.test(name)) {
        if (open || prod.some(Boolean) || out.some(Boolean)) skipped.push(`${s.title} · ${name} (qoldiq ${close})`);
        continue;
      }
      if (!open && !prod.some(Boolean) && !out.some(Boolean)) continue;
      const k = name.toLowerCase();
      const prev = merged.get(k);
      if (prev) {
        warnings.push(`${s.title} · ${name}: Excelda ikki qator — qo'shildi`);
        prev.open += open; prev.close += close;
        prod.forEach((v, d) => { prev.prod[d]! += v; prev.out[d]! += out[d]!; });
      } else merged.set(k, { section: s.title, brigade: s.brigade, name, open, prod, out, close });
    }
    rows.push(...merged.values());
  }
  return { days, rows, skipped, warnings };
}

function tashAdd(day: string, n: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// ───────────────────────── Reja ─────────────────────────

type NewMove = {
  type: "ADJUSTMENT" | "PRODUCTION_OUTPUT" | "SHIPMENT" | "OWNER_TRANSFER";
  date: Date; productId: string; owner: string | null; qty: number; refType: string; note: string;
  /** hisobot uchun */ what: string;
};
type Plan = {
  warehouseId: string; warehouseName: string;
  moves: NewMove[];
  missing: { name: string; section: string }[];
  matchedVia: string[];
  diffs: string[];
};

type Ctx = { products: { id: string; name: string; aliases: string[]; unit: string; isActive: boolean }[]; brigadeId: Map<string, string>; brigadeName: Map<string, string> };

async function loadCtx(tx: Tx): Promise<Ctx> {
  const [products, brigades] = await Promise.all([
    tx.product.findMany({ select: { id: true, name: true, aliases: true, unit: true, isActive: true } }),
    tx.brigade.findMany({ select: { id: true, name: true } }),
  ]);
  return { products, brigadeId: new Map(brigades.map((b) => [b.name, b.id])), brigadeName: new Map(brigades.map((b) => [b.id, b.name])) };
}

async function buildPlan(tx: Tx, x: XData, ctx: Ctx, N: typeof NameMod): Promise<Plan> {
  const from = at(x.days[0]!, 0);
  const to = at(tashAdd(x.days[x.days.length - 1]!, 1), 0);
  const dayIdx = new Map(x.days.map((d, i) => [d, i]));

  // Mahsulot: nom/alias kaliti bo'yicha (faol ustun), dona
  const resolve = (name: string): string | null => {
    const key = N.productNameKey(ALIASES[name] ?? name);
    const hits = ctx.products.filter((p) => p.unit !== "m3" && N.productMatchesKey(p, key));
    return (hits.find((p) => p.isActive) ?? hits[0])?.id ?? null;
  };
  const missing: Plan["missing"] = [];
  const matchedVia: string[] = [];
  const xl = new Map<string, XRow & { productId: string; owner: string | null }>();
  for (const r of x.rows) {
    const owner = r.brigade ? ctx.brigadeId.get(r.brigade) ?? fail(`Tizimda «${r.brigade}» brigadasi yo'q`) : null;
    const pid = resolve(r.name);
    if (!pid) { missing.push({ name: r.name, section: r.section }); continue; }
    const p = ctx.products.find((q) => q.id === pid)!;
    if (p.name !== r.name) matchedVia.push(`«${r.name}» → «${p.name}»`);
    const k = `${owner ?? ""}|${pid}`;
    const prev = xl.get(k);
    if (prev) { prev.open += r.open; r.prod.forEach((v, d) => { prev.prod[d]! += v; prev.out[d]! += r.out[d]!; }); }
    else xl.set(k, { ...r, prod: [...r.prod], out: [...r.out], productId: pid, owner });
  }
  const excelProducts = new Set([...xl.values()].map((r) => r.productId));
  const ourOwners = new Set<string | null>([null, ...[...new Set([...Object.values(BRIGADES), LAST_SECTION_BRIGADE])].map((b) => ctx.brigadeId.get(b)!)]);

  // Ombor: shu mahsulotlar harakati eng ko'p bo'lgan sklad (bo'lmasa — asosiy)
  const whs = await tx.stockMove.groupBy({ by: ["warehouseId"], where: { productId: { in: [...excelProducts] } }, _count: { _all: true } });
  whs.sort((a, b) => b._count._all - a._count._all);
  const wh = whs[0] ? await tx.warehouse.findUnique({ where: { id: whs[0].warehouseId }, select: { id: true, name: true } })
    : await tx.warehouse.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } });
  if (!wh) fail("Sklad topilmadi");
  if (whs.length > 1) console.warn(`Ogohlantirish: mahsulot harakatlari ${whs.length} skladda — «${wh.name}» tanlandi`);

  // Tizim holati: boshlang'ich (oy boshigacha + 1-kundagi qo'lda qoldiq), har kun kirim (P) va chiqim (C) netto
  const before = await tx.stockMove.groupBy({ by: ["productId", "ownerBrigadeId"], where: { productId: { in: [...excelProducts] }, warehouseId: wh.id, date: { lt: from } }, _sum: { qty: true } });
  const moves = await tx.stockMove.findMany({
    where: { productId: { in: [...excelProducts] }, warehouseId: wh.id, date: { gte: from, lt: to } },
    select: { date: true, type: true, productId: true, ownerBrigadeId: true, qty: true },
  });
  const sysOpen = new Map<string, number>();
  const sysP = new Map<string, number[]>(), sysC = new Map<string, number[]>();
  const arr = (m: Map<string, number[]>, k: string) => { let a = m.get(k); if (!a) { a = x.days.map(() => 0); m.set(k, a); } return a; };
  for (const b of before) {
    const k = `${b.ownerBrigadeId ?? ""}|${b.productId}`;
    sysOpen.set(k, r3((sysOpen.get(k) ?? 0) + Number(b._sum.qty ?? 0)));
  }
  const OUT_TYPES = new Set(["SHIPMENT", "ISSUE", "WRITE_OFF"]);
  for (const m of moves) {
    const k = `${m.ownerBrigadeId ?? ""}|${m.productId}`;
    const day = tashDay(m.date);
    const d = dayIdx.get(day)!;
    const q = Number(m.qty);
    if (d === 0 && m.type === "ADJUSTMENT") sysOpen.set(k, r3((sysOpen.get(k) ?? 0) + q));
    else if (OUT_TYPES.has(m.type)) arr(sysC, k)[d] = r3(arr(sysC, k)[d]! - q);
    else arr(sysP, k)[d] = r3(arr(sysP, k)[d]! + q);
  }

  const name = (pid: string) => ctx.products.find((p) => p.id === pid)!.name;
  const ownerName = (o: string | null) => (o ? ctx.brigadeName.get(o) ?? "Brigada" : "Umumiy hovli");
  const out: NewMove[] = [];
  const keys = new Set<string>([...xl.keys()]);
  for (const k of [...sysOpen.keys(), ...sysP.keys(), ...sysC.keys()]) {
    const [o, pid] = k.split("|");
    if (ourOwners.has(o || null) && excelProducts.has(pid!)) keys.add(k);
  }
  const xP = (k: string, d: number) => xl.get(k)?.prod[d] ?? 0;

  // 1) Umumiy hovliga topshiriqdan tushgan ortiqcha → shu kuni Excelda chiqargan brigadaga ko'chirish
  for (const k of keys) {
    const [o, pid] = k.split("|");
    if (o) continue;
    const sp = sysP.get(k);
    if (!sp) continue;
    for (let d = 0; d < x.days.length; d++) {
      let surplus = r3(sp[d]! - xP(k, d));
      if (surplus <= EPS) continue;
      for (const bk of keys) {
        const [bo, bpid] = bk.split("|");
        if (!bo || bpid !== pid || surplus <= EPS) continue;
        const need = r3(xP(bk, d) - (sysP.get(bk)?.[d] ?? 0));
        if (need <= EPS) continue;
        const q = Math.min(need, surplus);
        const date = at(x.days[d]!, 18);
        const note = `${NOTE}: Excelda ${ownerName(bo)} chiqargan`;
        out.push({ type: "OWNER_TRANSFER", date, productId: pid!, owner: null, qty: -q, refType: REF, note, what: `ko'chirish ${x.days[d]} ${name(pid!)}: Umumiy hovli → ${ownerName(bo)} ${q}` });
        out.push({ type: "OWNER_TRANSFER", date, productId: pid!, owner: bo, qty: q, refType: REF, note, what: "" });
        sp[d] = r3(sp[d]! - q);
        arr(sysP, bk)[d] = r3(arr(sysP, bk)[d]! + q);
        surplus = r3(surplus - q);
      }
    }
  }

  // 2) Boshlang'ich qoldiq, 3) kunlik ishlab ch. va chiqim farqi
  const diffs: string[] = [];
  for (const k of keys) {
    const [o, pid] = k.split("|");
    const owner = o || null;
    const e = xl.get(k);
    const dOpen = r3((e?.open ?? 0) - (sysOpen.get(k) ?? 0));
    if (Math.abs(dOpen) > EPS) {
      out.push({ type: "ADJUSTMENT", date: at(tashAdd(x.days[0]!, -1), 12), productId: pid!, owner, qty: dOpen, refType: "Manual", note: `${NOTE}: boshlang'ich qoldiq`, what: `boshl. qoldiq ${ownerName(owner)} · ${name(pid!)} ${dOpen > 0 ? "+" : ""}${dOpen}` });
    }
    for (let d = 0; d < x.days.length; d++) {
      const dp = r3((e?.prod[d] ?? 0) - (sysP.get(k)?.[d] ?? 0));
      if (Math.abs(dp) > EPS) {
        out.push({ type: "PRODUCTION_OUTPUT", date: at(x.days[d]!, 12), productId: pid!, owner, qty: dp, refType: REF, note: `${NOTE}: ishlab chiqarish${dp < 0 ? " (storno — Excelda yo'q)" : ""}`, what: `ishlab ch. ${x.days[d]} ${ownerName(owner)} · ${name(pid!)} ${dp > 0 ? "+" : ""}${dp}` });
      }
      const dc = r3((e?.out[d] ?? 0) - (sysC.get(k)?.[d] ?? 0));
      if (Math.abs(dc) > EPS) {
        out.push({ type: "SHIPMENT", date: at(x.days[d]!, 17), productId: pid!, owner, qty: -dc, refType: REF, note: `${NOTE}: chiqim`, what: `chiqim ${x.days[d]} ${ownerName(owner)} · ${name(pid!)} ${dc}` });
      }
    }
    // Oxirgi qoldiq tekshiruvi (reja bo'yicha)
    const sysClose = r3((sysOpen.get(k) ?? 0) + (sysP.get(k) ?? []).reduce((a, b) => a + b, 0) - (sysC.get(k) ?? []).reduce((a, b) => a + b, 0));
    const eClose = e ? r3(e.open + e.prod.reduce((a, b) => a + b, 0) - e.out.reduce((a, b) => a + b, 0)) : 0;
    if (Math.abs(sysClose - eClose) > EPS) diffs.push(`${ownerName(owner)} · ${name(pid!)}: tizim ${sysClose} → Excel ${eClose}`);
  }
  return { warehouseId: wh.id, warehouseName: wh.name, moves: out, missing, matchedVia, diffs };
}

function report(x: XData, p: Plan) {
  console.log(`\nExcel: ${x.days[0]} … ${x.days[x.days.length - 1]} (${x.days.length} kun), ${x.rows.length} qator; sklad «${p.warehouseName}»`);
  if (x.skipped.length) console.log(`\nO'tkazib yuborildi (brak qatorlari):\n  ${x.skipped.join("\n  ")}`);
  if (x.warnings.length) console.log(`\nExcel ichidagi nomuvofiqlik (${x.warnings.length}):\n  ${x.warnings.slice(0, 40).join("\n  ")}`);
  if (p.matchedVia.length) console.log(`\nBoshqa nom bilan topildi:\n  ${[...new Set(p.matchedVia)].join("\n  ")}`);
  if (p.missing.length) console.log(`\nKatalogda yo'q — --yes da ochiladi (${p.missing.length}):\n  ${p.missing.map((m) => `${m.name} [${m.section}]`).join("\n  ")}`);
  const byType = new Map<string, { n: number; plus: number; minus: number }>();
  for (const m of p.moves) {
    const t = byType.get(m.type) ?? { n: 0, plus: 0, minus: 0 };
    t.n++; if (m.qty > 0) t.plus = r3(t.plus + m.qty); else t.minus = r3(t.minus - m.qty);
    byType.set(m.type, t);
  }
  console.log(`\nYoziladigan harakatlar: ${p.moves.length}`);
  for (const [t, v] of byType) console.log(`  ${t.padEnd(18)} ${String(v.n).padStart(4)} ta   +${v.plus}  −${v.minus}`);
  const storno = p.moves.filter((m) => m.type === "PRODUCTION_OUTPUT" && m.qty < 0);
  if (storno.length) console.log(`\nIshlab chiqarish stornosi (tizimda bor, Excelda yo'q):\n  ${storno.map((m) => m.what).join("\n  ")}`);
  const tr = p.moves.filter((m) => m.what.startsWith("ko'chirish"));
  if (tr.length) console.log(`\nUmumiy hovlidan brigadaga ko'chirish:\n  ${tr.map((m) => m.what).join("\n  ")}`);
  const op = p.moves.filter((m) => m.type === "ADJUSTMENT");
  if (op.length) console.log(`\nBoshlang'ich qoldiq tuzatishi (${op.length}):\n  ${op.map((m) => m.what).join("\n  ")}`);
  console.log(`\nOxirgi qoldig'i o'zgaradigan qatorlar: ${p.diffs.length}`);
  if (flag("batafsil")) console.log(`  ${p.diffs.join("\n  ")}\n\nBarcha harakatlar:\n  ${p.moves.filter((m) => m.what).map((m) => m.what).join("\n  ")}`);
}

// ───────────────────────── main ─────────────────────────

async function main() {
  const file = opt("file") ?? fail(`--file "<ISHLAB CHIQARISH.xlsx yo'li>" bering`);
  const yes = flag("yes");
  const { loadEnv } = (await import(join(ROOT, "scripts/env"))) as typeof EnvMod;
  loadEnv();
  if (!yes && process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    u.searchParams.set("options", "-c default_transaction_read_only=on");
    process.env.DATABASE_URL = u.toString();
  }
  const { db } = (await import(join(ROOT, "src/lib/db"))) as typeof DbMod;
  const { audit, auditMany } = (await import(join(ROOT, "src/lib/audit"))) as typeof AuditMod;
  const { lockStock } = (await import(join(ROOT, "src/lib/stock-lock"))) as typeof LockMod;
  const N = (await import(join(ROOT, "src/lib/product-name"))) as typeof NameMod;
  const ND = (await import(join(ROOT, "src/lib/product-name-db"))) as typeof NameDbMod;
  const { nextCatalogCode } = (await import(join(ROOT, "src/lib/numbering"))) as typeof NumMod;
  const x = readExcel(file);

  try {
    if (!yes) {
      const p = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return buildPlan(tx, x, await loadCtx(tx), N);
      }, { timeout: 300_000, maxWait: 30_000 });
      report(x, p);
      console.log(`\nHech narsa yozilmadi (faqat o'qildi). Yozish (oldin pg_dump!):\n  --file "${file}" --yes --expect ${p.moves.length}${p.missing.length ? ` (+${p.missing.length} mahsulot ochiladi; ularning harakatlari ham qo'shiladi)` : ""}\n`);
      return;
    }

    const expect = Number(opt("expect"));
    if (!Number.isInteger(expect) || expect < 0) fail("--yes bilan --expect <hisobotdagi harakatlar soni> ham bering");
    const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!director) fail("Faol direktor topilmadi — yozuvlar va AuditLog uchun kerak");

    const res = await db.$transaction(async (tx) => {
      await lockStock(tx);
      let ctx = await loadCtx(tx);
      const first = await buildPlan(tx, x, ctx, N);
      if (first.moves.length !== expect) throw new Error(`Harakatlar soni ${first.moves.length}, --expect ${expect} — baza o'zgargan. Hisobotni qayta ishga tushiring`);
      // Katalogda yo'q mahsulotlar
      const created: { id: string; code: string; name: string }[] = [];
      for (const nm of [...new Set(first.missing.map((m) => m.name))]) {
        const name = N.normalizeProductName(nm);
        await ND.lockProductName(tx, name);
        const groupId = await ND.resolveProductGroup(tx, { name }, director.id);
        const p = await tx.product.create({ data: { code: await nextCatalogCode(tx), name, unit: "dona", groupId, note: `${NOTE} orqali ochildi`, ...(name !== nm ? { aliases: [nm] } : {}) } });
        created.push({ id: p.id, code: p.code, name: p.name });
      }
      if (created.length) { await auditMany(tx, director.id, "CREATE", "Product", created.map((p) => ({ id: p.id, after: { ...p, via: REF } }))); ctx = await loadCtx(tx); }
      const plan = await buildPlan(tx, x, ctx, N);
      if (plan.missing.length) throw new Error(`Mahsulot ochilgandan keyin ham topilmadi: ${plan.missing.map((m) => m.name).join(", ")}`);
      const stamp = `excel-hovli-sverka ${new Date().toISOString()}`;
      await tx.stockMove.createMany({
        data: plan.moves.map((m) => ({
          type: m.type, date: m.date, warehouseId: plan.warehouseId, productId: m.productId, ownerBrigadeId: m.owner,
          brigadeId: m.type === "PRODUCTION_OUTPUT" ? m.owner : null, qty: m.qty, refType: m.refType, refId: stamp, note: m.note, createdById: director.id,
        })),
      });
      // Tekshiruv: qayta hisob — farq qolmasligi kerak
      const check = await buildPlan(tx, x, ctx, N);
      if (check.moves.length) throw new Error(`Yozilgandan keyin ham ${check.moves.length} ta farq qoldi — bekor qilindi:\n  ${check.moves.slice(0, 10).map((m) => m.what || m.type).join("\n  ")}`);
      await audit(tx, director.id, "CREATE", "StockMove", stamp, undefined, {
        via: REF, file, warehouse: plan.warehouseName, count: plan.moves.length, createdProducts: created.map((p) => p.name),
        moves: plan.moves.map((m) => ({ t: m.type, d: m.date, p: m.productId, o: m.owner, q: m.qty })),
      });
      return { plan, created, stamp };
    }, { timeout: 600_000, maxWait: 30_000 });
    report(x, res.plan);
    console.log(`\nYozildi: ${res.plan.moves.length} harakat (refId «${res.stamp}»), ochilgan mahsulot: ${res.created.length ? res.created.map((p) => p.name).join(", ") : "yo'q"}. Tekshiruv: farq qolmadi.\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
