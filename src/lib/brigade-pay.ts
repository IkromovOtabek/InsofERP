import { db } from "@/lib/db";
import { monthDays } from "@/lib/davomat";

/**
 * Brigada puli — yagona joy: brigadalar sahifasi («Mahsulotlar», «Oylik», «Brak»), ishlab chiqarish bosh sahifasi
 * va vedomost (`lib/hr/payroll.ts` sdelka fondi va brak ushlanmasi) shu yerdan o'qiydi — raqamlar hamma joyda bir xil.
 *
 *   fond   = bajarilgan hajm (`TaskProgress`, bekor qilinmagan topshiriq) × mahsulotning sdelka narxi (`Product.pieceRate`)
 *   brak   = davrdagi brak yozuvlari summasi (`ProductDefect.amount`: yozilganda miqdor × sotuv narxi, ish boshqaruvchi tahrirlaydi)
 *   oylik  = fond − brak (manfiy bo'lsa — brigada qarzi)
 *
 * Davr — mahalliy vaqt bo'yicha [from, to) (oy oxirgi kunining ishi ham kiradi).
 */

const r0 = (n: number) => Math.round(n);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** «YYYY-MM» oyning mahalliy chegaralari: [1-kun 00:00, keyingi oy 1-kun 00:00). */
export function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return { from: new Date(y!, m! - 1, 1), to: new Date(y!, m!, 1) };
}
/** «YYYY-MM-DD» kunning ertasi 00:00 (mahalliy) — davr oxiri (kiritilmaydi). */
export const dayEnd = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y!, m! - 1, d! + 1); };
export const dayStart = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y!, m! - 1, d!); };
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export type PieceUnit = { productId: string; product: string; unit: string; qty: number; rate: number; sum: number };
export type PiecePool = { brigade: string; sum: number; units: PieceUnit[] };

/** Sdelka fondi brigada bo'yicha: bajarilgan hajm × sdelka narxi. */
export async function brigadeOutput(from: Date, to: Date, brigadeIds?: string[]): Promise<Map<string, PiecePool>> {
  const out = new Map<string, PiecePool>();
  if (brigadeIds && !brigadeIds.length) return out;
  const rows = await db.taskProgress.findMany({
    where: { date: { gte: from, lt: to }, task: { status: { not: "CANCELLED" }, ...(brigadeIds ? { brigadeId: { in: brigadeIds } } : {}) } },
    select: { qty: true, task: { select: { brigadeId: true, brigade: { select: { name: true } }, orderItem: { select: { product: { select: { id: true, name: true, unit: true, pieceRate: true } } } } } } },
  });
  for (const r of rows) {
    const b = out.get(r.task.brigadeId) ?? { brigade: r.task.brigade.name, sum: 0, units: [] };
    const p = r.task.orderItem.product;
    const rate = Number(p.pieceRate ?? 0);
    const q = Number(r.qty);
    const u = b.units.find((x) => x.productId === p.id) ?? (b.units[b.units.push({ productId: p.id, product: p.name, unit: p.unit, qty: 0, rate, sum: 0 }) - 1])!;
    u.qty += q; u.sum += q * rate; b.sum += q * rate;
    out.set(r.task.brigadeId, b);
  }
  for (const b of out.values()) { b.sum = r0(b.sum); for (const u of b.units) { u.qty = r3(u.qty); u.sum = r0(u.sum); } }
  return out;
}

/** Davrdagi brak summasi brigada bo'yicha (brigadasiz brak — hech kimdan ushlanmaydi). */
export async function brigadeDefectSums(from: Date, to: Date, brigadeIds?: string[]): Promise<Map<string, { qty: number; sum: number; count: number }>> {
  const g = await db.productDefect.groupBy({
    by: ["brigadeId"],
    where: { date: { gte: from, lt: to }, brigadeId: brigadeIds ? { in: brigadeIds } : { not: null } },
    _sum: { amount: true, qty: true }, _count: true,
  });
  return new Map(g.map((r) => [r.brigadeId!, { qty: Number(r._sum.qty ?? 0), sum: r0(Number(r._sum.amount ?? 0)), count: r._count }]));
}

/** Brigadaning hozirgi ishi: ochiq topshiriqlar mahsulot bo'yicha — berilgan / bajarilgan / qoldiq va qoldiq qiymati. */
export async function brigadeProducts(opts: { activeOnly?: boolean } = {}) {
  const [brigades, tasks] = await Promise.all([
    db.brigade.findMany({ where: opts.activeOnly ? { isActive: true } : {}, orderBy: [{ isActive: "desc" }, { name: "asc" }], select: { id: true, name: true, isActive: true, leader: { select: { fullName: true } } } }),
    db.brigadeTask.findMany({
      where: { status: { in: ["NEW", "IN_PROGRESS"] } },
      select: { brigadeId: true, qty: true, doneQty: true, orderItem: { select: { product: { select: { id: true, code: true, name: true, unit: true, price: true, pieceRate: true } } } } },
    }),
  ]);
  type Row = { productId: string; code: string; name: string; unit: string; rate: number; price: number; given: number; done: number; left: number; wage: number; value: number; tasks: number };
  const by = new Map<string, Map<string, Row>>();
  for (const t of tasks) {
    const p = t.orderItem.product;
    const m = by.get(t.brigadeId) ?? new Map<string, Row>();
    const r = m.get(p.id) ?? { productId: p.id, code: p.code, name: p.name, unit: p.unit, rate: Number(p.pieceRate ?? 0), price: Number(p.price), given: 0, done: 0, left: 0, wage: 0, value: 0, tasks: 0 };
    r.given += Number(t.qty); r.done += Number(t.doneQty); r.tasks++;
    m.set(p.id, r); by.set(t.brigadeId, m);
  }
  return brigades
    .map((b) => {
      const rows = [...(by.get(b.id)?.values() ?? [])].map((r) => {
        const left = Math.max(0, r.given - r.done);
        return { ...r, given: r3(r.given), done: r3(r.done), left: r3(left), wage: r0(left * r.rate), value: r0(left * r.price) };
      }).sort((a, z) => z.value - a.value);
      return {
        id: b.id, name: b.name, isActive: b.isActive, leader: b.leader?.fullName ?? null, rows,
        wage: rows.reduce((s, r) => s + r.wage, 0), value: rows.reduce((s, r) => s + r.value, 0),
        noRate: rows.filter((r) => r.rate <= 0).length,
      };
    })
    .filter((b) => b.isActive || b.rows.length);
}
export type BrigadeProducts = Awaited<ReturnType<typeof brigadeProducts>>;

/** Brigada oyligi (oy bo'yicha): fond, brak, oylik va sdelkadagi a'zolar. */
export async function brigadePayMonth(ym: string) {
  const { from, to } = monthRange(ym);
  const [brigades, pools, defects] = await Promise.all([
    db.brigade.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isActive: true, leader: { select: { fullName: true } }, members: { where: { isActive: true }, select: { id: true, fullName: true, payType: true } } },
    }),
    brigadeOutput(from, to),
    brigadeDefectSums(from, to),
  ]);
  const rows = brigades
    .map((b) => {
      const pool = pools.get(b.id);
      const def = defects.get(b.id);
      const fund = pool?.sum ?? 0, brak = def?.sum ?? 0;
      return {
        id: b.id, name: b.name, isActive: b.isActive, leader: b.leader?.fullName ?? null,
        units: pool?.units ?? [], fund, brak, brakQty: def?.qty ?? 0, brakCount: def?.count ?? 0, net: fund - brak,
        piece: b.members.filter((m) => m.payType === "PIECE").length, members: b.members.length,
        noRate: (pool?.units ?? []).filter((u) => u.rate <= 0).map((u) => u.product),
      };
    })
    .filter((r) => r.isActive || r.fund || r.brak);
  return {
    ym, rows,
    fund: rows.reduce((s, r) => s + r.fund, 0), brak: rows.reduce((s, r) => s + r.brak, 0), net: rows.reduce((s, r) => s + r.net, 0),
  };
}
export type BrigadePayMonth = Awaited<ReturnType<typeof brigadePayMonth>>;

/** Oy braki — har yozuv (tahrirlash uchun) va brigada × kun jadvali (summa va miqdor birlik bo'yicha). */
export async function brigadeDefectsMonth(ym: string, brigadeId?: string | null) {
  const { from, to } = monthRange(ym);
  const list = await db.productDefect.findMany({
    where: { date: { gte: from, lt: to }, ...(brigadeId ? { brigadeId } : {}) },
    orderBy: { date: "desc" },
    select: {
      id: true, date: true, qty: true, amount: true, reason: true, note: true, brigadeId: true,
      product: { select: { code: true, name: true, unit: true, price: true } }, brigade: { select: { name: true } }, createdBy: { select: { fullName: true } },
    },
  });
  const days = monthDays(ym).map((d) => d.iso);
  type Cell = { sum: number; qty: Record<string, number> };
  const grid = new Map<string, { id: string | null; name: string; days: Map<string, Cell>; sum: number; qty: Record<string, number> }>();
  const dayTotal = new Map<string, number>();
  for (const d of list) {
    const key = d.brigadeId ?? "";
    const g = grid.get(key) ?? { id: d.brigadeId, name: d.brigade?.name ?? "Brigadasiz", days: new Map<string, Cell>(), sum: 0, qty: {} };
    const iso = localIso(d.date);
    const c = g.days.get(iso) ?? { sum: 0, qty: {} };
    const a = Number(d.amount), q = Number(d.qty), u = d.product.unit;
    c.sum += a; c.qty[u] = r3((c.qty[u] ?? 0) + q);
    g.sum += a; g.qty[u] = r3((g.qty[u] ?? 0) + q);
    g.days.set(iso, c); grid.set(key, g);
    dayTotal.set(iso, (dayTotal.get(iso) ?? 0) + a);
  }
  return {
    days,
    activeDays: days.filter((d) => dayTotal.has(d)),
    grid: [...grid.values()].sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.name.localeCompare(b.name, "uz")),
    dayTotal,
    total: list.reduce((s, d) => s + Number(d.amount), 0),
    list: list.map((d) => ({ ...d, qty: Number(d.qty), amount: Number(d.amount), price: Number(d.product.price), iso: localIso(d.date) })),
  };
}
export type BrigadeDefectsMonth = Awaited<ReturnType<typeof brigadeDefectsMonth>>;
