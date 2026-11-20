/**
 * Sklad → «Kirim» jurnali (Umumiy eski sklad → Kirim, `/stock/prixod`): bir davrdagi kirim hujjatlarini bazadan BUTUNLAY o'chirish.
 * «Hujjatlar o'chirilmaydi» qoidasidan bir martalik istisno — foydalanuvchi talabi (2026-11-20: 12.11–19.11.2026 kirimlari).
 *
 *   npx tsx scripts/purge-receipts-period.ts --from 2026-11-12 --to 2026-11-19
 *       faqat hisobot: ulanish `default_transaction_read_only=on`, so'rovlar READ ONLY tranzaksiyada — bazaga hech narsa yozilmaydi
 *   npx tsx scripts/purge-receipts-period.ts --from 2026-11-12 --to 2026-11-19 --yes --expect <kirimlar soni> --kassa=uz|ochir
 *       o'chirish (oldin pg_dump!). --expect — hisobotdagi kirimlar soni: orada baza o'zgargan bo'lsa to'xtaydi
 *
 * Serverda skript /tmp da turishi mumkin — kod joriy relizdan olinadi (ish papkasi yoki INSOF_ROOT):
 *   cd /var/www/insof-erp/current && ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx /tmp/purge-receipts-period.ts …
 *
 * Davr — kirim sanasi (GoodsReceipt.date), Toshkent vaqti: --from kuni 00:00 dan --to kunining oxirigacha (Kirim jurnali bilan bir xil).
 * O'chadi (bitta tranzaksiyada, sklad qulfi ostida):
 *   · kirim hujjatlari va qatorlari, bekor qilinganlari ham
 *   · ularning sklad harakatlari (StockMove refType "GoodsReceipt"): kirim, «Kimga» avto chiqim (oluvchi/xodim/brigada), storno qatorlari
 *   · avto chiqim brigadaga bo'lgan bo'lsa — brigada qoldig'i yozuvlari (BrigadeMove)
 *   · kirimga havola qilgan bildirishnomalar (to'lanmagan kirim, avto zapchast keldi)
 *   · kassa to'lovlari (CashTransaction refType "GoodsReceipt"): --kassa=ochir — o'chadi (hisob qoldig'i shuncha oshadi);
 *     --kassa=uz — qoladi, faqat kirimga havolasi uziladi (ta'minotchida shu summa avans bo'lib ko'rinadi)
 * Ta'minotchi qarzi (kreditorka) alohida saqlanmaydi — kirimlardan hisoblanadi, o'zi yo'qoladi.
 * Ta'minot zayavkasi / snabjenets jo'natmasidan kelgan kirim bo'lsa — to'xtaydi; --with-supply bilan havolasi uziladi
 * (zayavka puli hech qachon o'chirilmaydi, faqat uziladi). Spravochniklar (xomashyo, ta'minotchi, oluvchi) qoladi.
 * Har kirim AuditLog'ga (DELETE) to'liq nusxasi bilan yoziladi: qatorlar, sklad/brigada harakatlari, kassa yozuvlari.
 */
import { join } from "node:path";
import type { Prisma } from "@/generated/prisma";
import type * as DbMod from "@/lib/db";
import type * as AuditMod from "@/lib/audit";
import type * as LockMod from "@/lib/stock-lock";
import type * as FormatMod from "@/lib/format";
import type * as EnvMod from "./env";

type Tx = Prisma.TransactionClient;

/** Ilova kodi qayerdan olinadi: serverda skript /tmp da bo'lsa ham — joriy reliz. */
const ROOT = process.env.INSOF_ROOT || process.cwd();
const CHUNK = 5000;
const EPS = 0.0005;
const DAY = 86_400_000;
const TZ_MS = 5 * 3_600_000; // Asia/Tashkent, yozgi vaqt yo'q

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
function opt(name: string): string | null {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return null;
  const a = argv[i]!;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : (argv[i + 1] ?? null);
}

function fail(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

/** "YYYY-MM-DD" → Toshkent kuni boshi (UTC Date). */
function dayStart(s: string | null, what: string): Date {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`--${what} YYYY-MM-DD ko'rinishida berilsin (masalan --${what} 2026-11-12)`);
  const d = new Date(`${s}T00:00:00+05:00`);
  if (Number.isNaN(d.getTime()) || tashDay(d) !== s) fail(`--${what} noto'g'ri sana: ${s}`);
  return d;
}
/** Toshkent bo'yicha kun "YYYY-MM-DD" (jarayon TZ'iga bog'liq emas). */
const tashDay = (d: Date) => new Date(d.getTime() + TZ_MS).toISOString().slice(0, 10);
const ru = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

function dbLabel(url = process.env.DATABASE_URL): string {
  try { const u = new URL(url ?? ""); return `${u.hostname}:${u.port || 5432}${u.pathname}`; } catch { return "(DATABASE_URL o'qilmadi)"; }
}

async function inChunks<T>(ids: string[], f: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await f(ids.slice(i, i + CHUNK))));
  return out;
}
function groupBy<T>(xs: T[], key: (x: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); if (k == null) continue; const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/** O'chiriladigan hamma narsa — hisobot va o'chirish bir xil ro'yxatdan (o'chirishda qulf ostida qayta yig'iladi). */
async function collect(c: Tx, from: Date, to: Date) {
  const receipts = await c.goodsReceipt.findMany({
    where: { date: { gte: from, lt: to } },
    orderBy: [{ date: "asc" }, { docNo: "asc" }],
    include: {
      items: { include: { material: { select: { name: true, unit: true } } } },
      supplier: { select: { name: true } },
      warehouse: { select: { name: true } },
      supply: { select: { id: true, docNo: true, cashTxId: true } },
      shipmentItems: { select: { id: true, shipmentId: true, name: true } },
    },
  });
  const ids = receipts.map((r) => r.id);
  const moves = await inChunks(ids, (part) => c.stockMove.findMany({ where: { refType: "GoodsReceipt", refId: { in: part } } }));
  const brigadeMoves = await inChunks(moves.map((m) => m.id), (part) => c.brigadeMove.findMany({ where: { refType: "StockMove", refId: { in: part } } }));
  const cash = await inChunks(ids, (part) => c.cashTransaction.findMany({ where: { refType: "GoodsReceipt", refId: { in: part } } }));
  // Ta'minot zayavkasi puli (moliya ajratgan, qabulda kirimga bog'langan) — hech qachon o'chirilmaydi
  const supplyCash = new Set((await inChunks(cash.map((t) => t.id), (part) => c.supplyRequest.findMany({ where: { cashTxId: { in: part } }, select: { cashTxId: true } }))).map((s) => s.cashTxId!));
  // Bildirishnoma havolasi {key, id}: to'lanmagan kirim (key "receipts") va avto zapchast (id = kirim) — id cuid, boshqa jadval bilan to'qnashmaydi
  const notifications = ids.length
    ? await c.$queryRaw<{ id: string }[]>`SELECT id FROM "Notification" WHERE link->>'id' = ANY(${ids})`
    : [];
  // Davrdan oldingi sanali, lekin shu davrda bekor qilingan kirimlar — jurnalda shu davrda «Bekor qilish» qatori bo'lib turadi; o'chirilmaydi
  const stornoOutside = await c.goodsReceipt.findMany({ where: { date: { lt: from }, cancelledAt: { gte: from, lt: to } }, select: { docNo: true, date: true, cancelledAt: true } });

  // Qoldiq: o'chiriladigan harakatlar sklad (xomashyo × sklad) va brigada qo'lidagi qoldiqdan chiqib ketadi
  const delStock = new Map<string, number>();
  for (const m of moves) if (m.materialId) delStock.set(`${m.materialId}|${m.warehouseId}`, (delStock.get(`${m.materialId}|${m.warehouseId}`) ?? 0) + Number(m.qty));
  const matIds = [...new Set(moves.map((m) => m.materialId).filter((x): x is string => !!x))];
  const curStock = matIds.length
    ? await c.stockMove.groupBy({ by: ["materialId", "warehouseId"], where: { materialId: { in: matIds } }, _sum: { qty: true } })
    : [];
  const delBrig = new Map<string, number>();
  for (const b of brigadeMoves) delBrig.set(`${b.brigadeId}|${b.materialId}`, (delBrig.get(`${b.brigadeId}|${b.materialId}`) ?? 0) + Number(b.qty));
  const brigIds = [...new Set(brigadeMoves.map((b) => b.brigadeId))];
  const curBrig = brigIds.length
    ? await c.brigadeMove.groupBy({ by: ["brigadeId", "materialId"], where: { brigadeId: { in: brigIds }, materialId: { in: [...new Set(brigadeMoves.map((b) => b.materialId))] } }, _sum: { qty: true } })
    : [];
  const [mats, whs, brigs, accs] = await Promise.all([
    c.material.findMany({ where: { id: { in: [...new Set([...matIds, ...brigadeMoves.map((b) => b.materialId)])] } }, select: { id: true, name: true, unit: true } }),
    c.warehouse.findMany({ select: { id: true, name: true } }),
    c.brigade.findMany({ where: { id: { in: brigIds } }, select: { id: true, name: true } }),
    c.cashAccount.findMany({ where: { id: { in: [...new Set(cash.map((t) => t.cashAccountId))] } }, select: { id: true, name: true } }),
  ]);
  const matName = new Map(mats.map((m) => [m.id, m]));
  const whName = new Map(whs.map((w) => [w.id, w.name]));
  const brigName = new Map(brigs.map((b) => [b.id, b.name]));
  const negStock = curStock.flatMap((g) => {
    const removed = delStock.get(`${g.materialId}|${g.warehouseId}`) ?? 0;
    const before = Number(g._sum.qty ?? 0), after = before - removed;
    if (removed === 0 || after >= -EPS) return [];
    const m = matName.get(g.materialId!);
    return [{ material: m?.name ?? g.materialId!, unit: m?.unit ?? "", warehouse: whName.get(g.warehouseId) ?? g.warehouseId, before, removed, after }];
  });
  const negBrig = curBrig.flatMap((g) => {
    const removed = delBrig.get(`${g.brigadeId}|${g.materialId}`) ?? 0;
    const before = Number(g._sum.qty ?? 0), after = before - removed;
    if (removed === 0 || after >= -EPS) return [];
    const m = matName.get(g.materialId);
    return [{ brigade: brigName.get(g.brigadeId) ?? g.brigadeId, material: m?.name ?? g.materialId, unit: m?.unit ?? "", before, removed, after }];
  });
  return { receipts, moves, brigadeMoves, cash, supplyCash, notifications, stornoOutside, negStock, negBrig, accName: new Map(accs.map((a) => [a.id, a.name])) };
}
type Data = Awaited<ReturnType<typeof collect>>;

/** Qator summasi — Kirim jurnalidagi kabi: QQS'siz = miqdor × narx + dostavka, Jami = + QQS. */
function itemMoney(i: Data["receipts"][number]["items"][number]) {
  const sum = r2(Number(i.qty) * Number(i.price) + Number(i.deliveryCost));
  const vat = r2(Number(i.vatAmount));
  return { sum, vat, total: r2(sum + vat) };
}

function report(d: Data, fmtNum: (v: number, digits?: number) => string, from: Date, toIncl: Date) {
  const so = (v: number) => `${fmtNum(v, 2)} so'm`;
  const q3 = (v: number) => fmtNum(v, 3);
  const active = d.receipts.filter((r) => !r.cancelledAt);
  const cancelled = d.receipts.filter((r) => r.cancelledAt);
  const lines = d.receipts.reduce((a, r) => a + r.items.length, 0);
  const totals = (rs: Data["receipts"]) => rs.flatMap((r) => r.items).reduce((a, i) => { const x = itemMoney(i); return { sum: a.sum + x.sum, vat: a.vat + x.vat, total: a.total + x.total }; }, { sum: 0, vat: 0, total: 0 });
  const tAct = totals(active), tCan = totals(cancelled);

  console.log(`\nBaza: ${dbLabel()}`);
  console.log(`Davr: ${ru(tashDay(from))} — ${ru(tashDay(toIncl))} (kirim sanasi, Toshkent vaqti)\n`);
  console.log(`KIRIM HUJJATLARI: ${d.receipts.length} ta (faol ${active.length}, bekor qilingan ${cancelled.length}), qatorlar ${lines} ta`);
  console.log(`  Faol kirimlar summasi:  QQS'siz ${so(tAct.sum)} · QQS ${so(tAct.vat)} · Jami ${so(tAct.total)}`);
  if (cancelled.length) console.log(`  Bekor qilinganlar:      Jami ${so(tCan.total)} (sklad va jurnalda allaqachon 0 ga teng)`);

  console.log(`\nSanalar bo'yicha (faol / bekor, Jami QQS bilan — faqat faol):`);
  for (const [day, rs] of groupBy(d.receipts, (r) => tashDay(r.date))) {
    const a = rs.filter((r) => !r.cancelledAt);
    console.log(`  ${ru(day)}  ${String(a.length).padStart(4)} / ${String(rs.length - a.length).padEnd(3)} hujjat · ${String(rs.reduce((x, r) => x + r.items.length, 0)).padStart(4)} qator · ${so(totals(a).total)}`);
  }

  console.log(`\nTa'minotchilar bo'yicha (faol kirimlar):`);
  const bySup = [...groupBy(active, (r) => r.supplier.name)].map(([name, rs]) => ({ name, n: rs.length, total: totals(rs).total })).sort((a, b) => b.total - a.total);
  for (const s of bySup) console.log(`  ${s.name.padEnd(40)} ${String(s.n).padStart(4)} hujjat · ${so(s.total)}`);

  console.log(`\nXomashyo bo'yicha jami miqdor (faol kirimlar):`);
  const byMat = new Map<string, { name: string; unit: string; qty: number; total: number }>();
  for (const i of active.flatMap((r) => r.items)) {
    const x = byMat.get(i.materialId) ?? { name: i.material.name, unit: i.material.unit, qty: 0, total: 0 };
    x.qty += Number(i.qty); x.total += itemMoney(i).total;
    byMat.set(i.materialId, x);
  }
  for (const m of [...byMat.values()].sort((a, b) => b.total - a.total)) console.log(`  ${m.name.padEnd(40)} ${q3(m.qty).padStart(14)} ${m.unit.padEnd(6)} · ${so(m.total)}`);

  console.log(`\nBOG'LIQ YOZUVLAR (o'chadi):`);
  const byType = groupBy(d.moves, (m) => `${m.type}${Number(m.qty) < 0 ? " (−)" : " (+)"}`);
  console.log(`  Sklad harakatlari (StockMove)   ${d.moves.length}`);
  for (const [t, ms] of byType) console.log(`    ${t.padEnd(22)} ${ms.length}`);
  console.log(`  Brigada qoldig'i (BrigadeMove)  ${d.brigadeMoves.length}`);
  console.log(`  Bildirishnomalar                ${d.notifications.length}`);
  const autoTo = d.receipts.filter((r) => r.autoIssueToId || r.autoIssueBrigadeId || r.autoIssueEmployeeId).length;
  if (autoTo) console.log(`  «Kimga» avto chiqimli kirimlar  ${autoTo} (chiqimi ham o'chadi)`);

  const liveCash = d.cash.filter((t) => !t.cancelledAt);
  const cashSum = r2(liveCash.reduce((a, t) => a + Number(t.amount), 0));
  console.log(`\nKASSA: kirimlarga bog'langan to'lovlar ${d.cash.length} ta (faol ${liveCash.length} — ${so(cashSum)}, bekor qilingan ${d.cash.length - liveCash.length})`);
  for (const [acc, ts] of groupBy(liveCash, (t) => t.cashAccountId)) console.log(`  ${(d.accName.get(acc) ?? acc).padEnd(30)} ${String(ts.length).padStart(4)} ta · ${so(ts.reduce((a, t) => a + Number(t.amount), 0))}`);
  if (d.supplyCash.size) console.log(`  shundan ta'minot zayavkasi puli: ${d.supplyCash.size} ta — o'chirilmaydi, faqat uziladi`);
  if (d.cash.length) {
    console.log(`  --kassa=ochir: to'lovlar o'chadi — hisob qoldiqlari jami ${so(cashSum)} ga OSHADI`);
    console.log(`  --kassa=uz:    to'lovlar kassada qoladi (qoldiq o'zgarmaydi), kirimga havolasi uziladi — ta'minotchida shu summa avans bo'ladi`);
  }

  const supplyRecs = d.receipts.filter((r) => r.supply);
  const shipRecs = d.receipts.filter((r) => r.shipmentItems.length);
  if (supplyRecs.length || shipRecs.length) {
    console.log(`\nDIQQAT — ta'minot zanjiridan kelgan kirimlar (--with-supply bo'lmasa o'chirish to'xtaydi):`);
    if (supplyRecs.length) console.log(`  Ta'minot zayavkasidan: ${supplyRecs.length} ta (${supplyRecs.map((r) => `${r.docNo}←${r.supply!.docNo}`).slice(0, 10).join(", ")})`);
    if (shipRecs.length) console.log(`  Snabjenets jo'natmasidan: ${shipRecs.length} ta kirim, ${shipRecs.reduce((a, r) => a + r.shipmentItems.length, 0)} qator`);
  }
  if (d.stornoOutside.length) {
    console.log(`\nMA'LUMOT: davrdan OLDINGI ${d.stornoOutside.length} ta kirim shu davrda bekor qilingan (jurnalda «Bekor qilish» qatori) — ular O'CHIRILMAYDI:`);
    for (const r of d.stornoOutside.slice(0, 20)) console.log(`  ${r.docNo} · kirim ${ru(tashDay(r.date))}, bekor ${ru(tashDay(r.cancelledAt!))}`);
  }

  console.log(`\nO'CHIRGANDAN KEYIN MANFIY BO'LADIGAN QOLDIQLAR:`);
  if (!d.negStock.length && !d.negBrig.length) console.log(`  yo'q`);
  for (const n of d.negStock.sort((a, b) => a.after - b.after)) {
    console.log(`  Sklad «${n.warehouse}» · ${n.material}: hozir ${q3(n.before)} − kirim ${q3(n.removed)} = ${q3(n.after)} ${n.unit}${n.before < -EPS ? " (hozir ham manfiy)" : ""}`);
  }
  for (const n of d.negBrig.sort((a, b) => a.after - b.after)) {
    console.log(`  Brigada «${n.brigade}» · ${n.material}: hozir ${q3(n.before)} − ${q3(n.removed)} = ${q3(n.after)} ${n.unit}`);
  }
  console.log(`  (Manfiy = bu kirimdan keyin xomashyo chiqim/zames/brigadaga berish bilan sarflangan; o'sha hujjatlar o'chmaydi.)`);
}

async function main() {
  const yes = flag("yes");
  const from = dayStart(opt("from"), "from");
  const toIncl = dayStart(opt("to"), "to");
  if (toIncl < from) fail("--to --from dan oldin bo'lmasin");
  const to = new Date(toIncl.getTime() + DAY);
  if (to.getTime() - from.getTime() > 62 * DAY) fail("Davr 62 kundan uzun — xato emasmi? Skript bir martalik, qisqa davr uchun");

  const { loadEnv } = (await import(join(ROOT, "scripts/env"))) as typeof EnvMod;
  loadEnv();
  // Hisobot rejimi: ulanishning o'zi faqat o'qiydi (Postgres yozuvni rad etadi)
  if (!yes && process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    u.searchParams.set("options", "-c default_transaction_read_only=on");
    process.env.DATABASE_URL = u.toString();
  }
  const { db } = (await import(join(ROOT, "src/lib/db"))) as typeof DbMod;
  const { auditMany, audit } = (await import(join(ROOT, "src/lib/audit"))) as typeof AuditMod;
  const { lockStock } = (await import(join(ROOT, "src/lib/stock-lock"))) as typeof LockMod;
  const { fmtNum } = (await import(join(ROOT, "src/lib/format"))) as typeof FormatMod;

  try {
    if (!yes) {
      const d = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const [ro] = await tx.$queryRaw<{ transaction_read_only: string }[]>`SHOW transaction_read_only`;
        const [dro] = await tx.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
        if (ro?.transaction_read_only !== "on") throw new Error("Tranzaksiya read-only emas — to'xtatildi");
        console.log(`\nREAD ONLY: transaction_read_only=${ro.transaction_read_only}, default_transaction_read_only=${dro?.default_transaction_read_only}`);
        return collect(tx, from, to);
      }, { timeout: 300_000, maxWait: 30_000 });
      report(d, fmtNum, from, toIncl);
      console.log(`\nHech narsa o'chirilmadi (faqat o'qildi). O'chirish (oldin pg_dump!):`);
      console.log(`  --from ${tashDay(from)} --to ${tashDay(toIncl)} --yes --expect ${d.receipts.length}${d.cash.length ? " --kassa=uz|ochir" : ""}${d.receipts.some((r) => r.supply || r.shipmentItems.length) ? " --with-supply" : ""}\n`);
      return;
    }

    const expect = Number(opt("expect"));
    if (!Number.isInteger(expect) || expect < 0) fail("--yes bilan --expect <kirimlar soni> ham bering (hisobotdagi son)");
    const kassaArg = opt("kassa");
    const withSupply = flag("with-supply");
    const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!director) fail("Faol direktor topilmadi — AuditLog yozuvi uchun kerak");
    const stamp = `purge-kirim ${tashDay(from)}..${tashDay(toIncl)}`;

    const res = await db.$transaction(async (tx) => {
      await lockStock(tx);
      const d = await collect(tx, from, to);
      if (d.receipts.length !== expect) throw new Error(`Kirimlar soni ${d.receipts.length}, --expect ${expect} — baza o'zgargan. Hisobotni qayta ishga tushiring`);
      if (d.cash.length && kassaArg !== "uz" && kassaArg !== "ochir") throw new Error(`${d.cash.length} ta kassa to'lovi bog'langan — --kassa=uz yoki --kassa=ochir ni tanlang`);
      if (d.receipts.some((r) => r.supply || r.shipmentItems.length) && !withSupply) throw new Error("Ta'minot zanjiridan kelgan kirimlar bor — --with-supply bilan");
      const ids = d.receipts.map((r) => r.id);
      // Kirim qulfi (`lib/receipt-payables.ts#lockReceipt`): shu payt to'lov yozilayotgan bo'lsa — navbat
      for (const id of ids) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;

      const cashDel = kassaArg === "ochir" ? d.cash.filter((t) => !d.supplyCash.has(t.id)) : [];
      const delSet = new Set(cashDel.map((t) => t.id));
      const cashUnlink = d.cash.filter((t) => !delSet.has(t.id));
      const movesBy = groupBy(d.moves, (m) => m.refId);
      const bmBy = groupBy(d.brigadeMoves, (b) => b.refId);
      const cashBy = groupBy(d.cash, (t) => t.refId);

      // AuditLog — har kirimning to'liq nusxasi (qaytarish kerak bo'lsa shu yerdan yoki pg_dump'dan)
      await auditMany(tx, director.id, "DELETE", "GoodsReceipt", d.receipts.map((r) => {
        const ms = movesBy.get(r.id) ?? [];
        return {
          id: r.id,
          before: {
            ...r, stockMoves: ms, brigadeMoves: ms.flatMap((m) => bmBy.get(m.id) ?? []),
            cash: (cashBy.get(r.id) ?? []).map((t) => ({ ...t, purge: delSet.has(t.id) ? "o'chirildi" : "uzildi" })),
          },
          after: { purged: stamp, kassa: kassaArg ?? null },
        };
      }));
      if (cashDel.length) {
        await auditMany(tx, director.id, "DELETE", "CashTransaction", cashDel.map((t) => ({ id: t.id, before: t, after: { purged: stamp } })));
        for (let i = 0; i < cashDel.length; i += CHUNK) await tx.cashTransaction.deleteMany({ where: { id: { in: cashDel.slice(i, i + CHUNK).map((t) => t.id) } } });
      }
      if (cashUnlink.length) {
        await auditMany(tx, director.id, "UPDATE", "CashTransaction", cashUnlink.map((t) => ({ id: t.id, before: { refType: t.refType, refId: t.refId }, after: { refType: null, refId: null, purged: stamp } })));
        for (let i = 0; i < cashUnlink.length; i += CHUNK) await tx.cashTransaction.updateMany({ where: { id: { in: cashUnlink.slice(i, i + CHUNK).map((t) => t.id) } }, data: { refType: null, refId: null } });
      }
      let notif = 0, bm = 0, sm = 0;
      const nIds = d.notifications.map((n) => n.id);
      for (let i = 0; i < nIds.length; i += CHUNK) notif += (await tx.notification.deleteMany({ where: { id: { in: nIds.slice(i, i + CHUNK) } } })).count;
      const bmIds = d.brigadeMoves.map((b) => b.id), smIds = d.moves.map((m) => m.id);
      for (let i = 0; i < bmIds.length; i += CHUNK) bm += (await tx.brigadeMove.deleteMany({ where: { id: { in: bmIds.slice(i, i + CHUNK) } } })).count;
      for (let i = 0; i < smIds.length; i += CHUNK) sm += (await tx.stockMove.deleteMany({ where: { id: { in: smIds.slice(i, i + CHUNK) } } })).count;
      const sup = (await tx.supplyRequest.updateMany({ where: { receiptId: { in: ids } }, data: { receiptId: null } })).count;
      const ship = (await tx.supplyShipmentItem.updateMany({ where: { receiptId: { in: ids } }, data: { receiptId: null } })).count;
      let rec = 0;
      for (let i = 0; i < ids.length; i += CHUNK) rec += (await tx.goodsReceipt.deleteMany({ where: { id: { in: ids.slice(i, i + CHUNK) } } })).count; // qatorlari Cascade
      if (rec !== ids.length || sm !== smIds.length || bm !== bmIds.length) throw new Error(`Kutilmagan son: kirim ${rec}/${ids.length}, harakat ${sm}/${smIds.length}, brigada ${bm}/${bmIds.length}`);
      const summary = {
        receipts: rec, items: d.receipts.reduce((a, r) => a + r.items.length, 0), stockMoves: sm, brigadeMoves: bm, notifications: notif,
        cashDeleted: cashDel.length, cashUnlinked: cashUnlink.length, supplyUnlinked: sup, shipmentItemsUnlinked: ship,
        negStock: d.negStock, negBrig: d.negBrig,
      };
      await audit(tx, director.id, "DELETE", "GoodsReceipt", stamp, undefined, summary);
      return summary;
    }, { timeout: 600_000, maxWait: 30_000 });

    console.log(`\nBaza: ${dbLabel()}`);
    console.log(`O'chirildi: kirim ${res.receipts} (qator ${res.items}), sklad harakati ${res.stockMoves}, brigada yozuvi ${res.brigadeMoves}, bildirishnoma ${res.notifications}.`);
    console.log(`Kassa: o'chirildi ${res.cashDeleted}, havolasi uzildi ${res.cashUnlinked}. Ta'minot zayavkasi uzildi ${res.supplyUnlinked}, jo'natma qatori ${res.shipmentItemsUnlinked}.`);
    if (res.negStock.length || res.negBrig.length) console.log(`Manfiy qoldiq qolgan joylar: sklad ${res.negStock.length}, brigada ${res.negBrig.length} (hisobotdagi ro'yxat).`);
    console.log("");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
