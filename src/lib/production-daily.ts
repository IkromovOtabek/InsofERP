import { db } from "@/lib/db";
import { localRange } from "@/lib/production-day";
import { dayUtc, isoDay } from "@/lib/davomat";

/**
 * Kunlik hisobotning direktor varag'i: brigada × mahsulot papkasi (Plita, Kolso, Stolba…) — necha dona quyildi.
 *
 * Sonlarni ishlab chiqarish xodimi hisobotning o'zida yozadi («Qayd etish» bilan `ProductionReport.data.daily` ga tushadi).
 * Hisobot hali yozilmagan kunda tizim yozuvi (brigada topshirig'i → PRODUCTION_OUTPUT) taklif sifatida ko'rinadi.
 * Sklad qoldig'i bu sonlardan o'zgarmaydi — bu faqat hisobot.
 */
export type DailyMatrix = {
  /** Ustunlar — mahsulotning eng yuqori papkasi; papkasiz mahsulot o'z nomi bilan ("p:<id>"). */
  cols: { id: string; name: string; unit: string }[];
  rows: { id: string | null; name: string; leader: string | null; cells: Record<string, number> }[];
  /** brigada id (brigadasiz — "-") → sabab */
  reasons: Record<string, string>;
  /** Oy plani papka bo'yicha: xodim kiritgan (oyning oldingi hisobotidan o'tadi) yoki direktor plani yig'indisi. */
  plan?: Record<string, { month: number | null; day: number | null }>;
  /** Oy boshidan shu kungacha (shu kun kirmaydi): har kunning oxirgi hisobotidan, hisobot yo'q kun — tizim yozuvidan. */
  before?: Record<string, number>;
  /** true — sonlar xodim tomonidan yozilgan (qayd etilgan). */
  entered?: boolean;
};

export const rowKey = (id: string | null) => id ?? "-";
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
type Saved = { date: Date; data: unknown };
const dailyOf = (r: Saved) => (r.data as { daily?: DailyMatrix }).daily;

export async function dailyMatrix(iso: string): Promise<DailyMatrix> {
  const { from, to, monthFrom } = localRange(iso);
  const [y, m] = iso.split("-").map(Number);
  const [groups, products, brigades, moves, saved, plans] = await Promise.all([
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true, sortOrder: true, isActive: true } }),
    db.product.findMany({ where: { unit: { not: "m3" } }, select: { id: true, name: true, unit: true, groupId: true, isActive: true } }),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leader: { select: { fullName: true } } } }),
    db.stockMove.findMany({
      where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: monthFrom, lt: to }, product: { unit: { not: "m3" } } },
      select: { date: true, qty: true, productId: true, brigadeId: true, ownerBrigadeId: true },
    }),
    // Oyning shu kungacha bo'lgan hisobotlari (shu kun ham) — har kunning oxirgisi kerak
    db.productionReport.findMany({ where: { date: { gte: dayUtc(`${iso.slice(0, 7)}-01`), lte: dayUtc(iso) } }, orderBy: { createdAt: "desc" }, select: { date: true, data: true } }),
    db.productionPlan.findMany({ where: { year: y, month: m }, select: { productId: true, monthQty: true, dayQty: true } }),
  ]);

  // Ustun = eng yuqori papka
  const gById = new Map(groups.map((g) => [g.id, g]));
  const rootOf = (gid: string) => { let g = gById.get(gid); for (let i = 0; g?.parentId && i < 20; i++) g = gById.get(g.parentId) ?? g; return g; };
  const prod = new Map(products.map((p) => [p.id, p]));
  const colOf = (productId: string) => {
    const p = prod.get(productId);
    if (!p) return null;
    const g = p.groupId ? rootOf(p.groupId) : undefined;
    return g ? { id: g.id, name: g.name, unit: p.unit, sort: g.sortOrder } : { id: `p:${p.id}`, name: p.name, unit: p.unit, sort: 1e6 };
  };
  const colMap = new Map<string, { id: string; name: string; unit: string; sort: number }>();
  for (const p of products) {
    if (!p.isActive) continue;
    const c = colOf(p.id);
    if (c && !c.id.startsWith("p:") && gById.get(c.id)?.isActive !== false) colMap.set(c.id, c);
  }

  // Tizim yozuvlari: kun → brigada → ustun
  const sys = new Map<string, Map<string, Record<string, number>>>();
  for (const mv of moves) {
    const c = colOf(mv.productId!);
    if (!c) continue;
    if (!colMap.has(c.id)) colMap.set(c.id, c);
    const day = localIso(mv.date);
    const b = rowKey(mv.brigadeId ?? mv.ownerBrigadeId);
    const byB = sys.get(day) ?? new Map<string, Record<string, number>>();
    const cells = byB.get(b) ?? {};
    cells[c.id] = (cells[c.id] ?? 0) + Number(mv.qty);
    byB.set(b, cells); sys.set(day, byB);
  }

  // Har kunning oxirgi hisoboti
  const lastByDay = new Map<string, DailyMatrix>();
  for (const r of saved) { const k = isoDay(r.date); const dm = dailyOf(r); if (dm && !lastByDay.has(k)) lastByDay.set(k, dm); }
  for (const dm of lastByDay.values()) for (const c of dm.cols) if (!colMap.has(c.id)) colMap.set(c.id, { ...c, sort: 1e6 });
  const cols = [...colMap.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map(({ id, name, unit }) => ({ id, name, unit }));

  // Qatorlar: faol brigadalar (+ brigadasiz yoki nofaol brigada chiqargani)
  const today = lastByDay.get(iso);
  const sysToday = sys.get(iso) ?? new Map();
  const cellsFor = (k: string) => {
    const s = today?.rows.find((r) => rowKey(r.id) === k);
    if (s) return { ...s.cells };
    return { ...(sysToday.get(k) ?? {}) } as Record<string, number>;
  };
  const rows: DailyMatrix["rows"] = brigades.map((b) => ({ id: b.id, name: b.name, leader: b.leader?.fullName ?? null, cells: cellsFor(b.id) }));
  const known = new Set(brigades.map((b) => b.id));
  const other: Record<string, number> = {};
  for (const [k, c] of sysToday) if (!known.has(k)) for (const [col, q] of Object.entries(c as Record<string, number>)) other[col] = (other[col] ?? 0) + q;
  const savedOther = today?.rows.find((r) => r.id === null);
  if (savedOther || Object.values(other).some((q) => q)) rows.push({ id: null, name: "Boshqa / brigadasiz", leader: null, cells: savedOther ? { ...savedOther.cells } : other });

  // Oy boshidan shu kungacha (shu kun kirmaydi)
  const before: Record<string, number> = {};
  const addCells = (c: Record<string, number>) => { for (const [k, q] of Object.entries(c)) before[k] = (before[k] ?? 0) + (Number(q) || 0); };
  for (let d = new Date(monthFrom); d < from; d.setDate(d.getDate() + 1)) {
    const k = localIso(d);
    const rep = lastByDay.get(k);
    if (rep) rep.rows.forEach((r) => addCells(r.cells));
    else sys.get(k)?.forEach((c) => addCells(c));
  }

  // Plan: oyning eng oxirgi kiritilgan plani (shu kun ham), bo'lmasa direktor plani yig'indisi
  const plan: NonNullable<DailyMatrix["plan"]> = {};
  for (const p of plans) {
    const c = colOf(p.productId);
    if (!c) continue;
    const cur = plan[c.id] ?? { month: 0, day: 0 };
    cur.month = (cur.month ?? 0) + Number(p.monthQty);
    cur.day = cur.day !== null && p.dayQty !== null ? cur.day + Number(p.dayQty) : null;
    plan[c.id] = cur;
  }
  const lastPlan = [...lastByDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).find(([, dm]) => dm.plan && Object.keys(dm.plan).length)?.[1].plan;
  if (lastPlan) Object.assign(plan, lastPlan);

  return { cols, rows, reasons: today?.reasons ?? {}, plan, before, entered: !!today?.entered };
}

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 1000) / 1000 : null;
};

/**
 * Forma maydonlari → varaqqa: `cell:<brigada>:<ustun>`, `reason:<brigada>`, `plan:<ustun>:month|day`.
 * Maydon kelmagan katak tegilmaydi (mobil ilova faqat izoh yuboradi — tizim/oldingi qiymat qoladi).
 */
export function applyDailyInput(dm: DailyMatrix, fields: [string, string][]): DailyMatrix | { error: string } {
  const out: DailyMatrix = { ...dm, rows: dm.rows.map((r) => ({ ...r, cells: { ...r.cells } })), reasons: {}, plan: { ...(dm.plan ?? {}) } };
  const cols = new Set(dm.cols.map((c) => c.id));
  let touched = false;
  for (const [k, v] of fields) {
    const [kind, a, b] = k.split(":");
    if (kind === "cell" && cols.has(b)) {
      const row = out.rows.find((r) => rowKey(r.id) === a);
      if (!row) continue;
      const q = v.trim() === "" ? 0 : num(v);
      if (q === null) return { error: `${row.name}: son noto'g'ri — «${v}»` };
      if (q) row.cells[b] = q; else delete row.cells[b];
      touched = true;
    } else if (kind === "reason" && v.trim()) {
      out.reasons[a] = v.trim().slice(0, 300);
    } else if (kind === "plan" && cols.has(a) && (b === "month" || b === "day")) {
      const q = v.trim() === "" ? null : num(v);
      if (v.trim() !== "" && q === null) return { error: `Plan: son noto'g'ri — «${v}»` };
      const cur = out.plan![a] ?? { month: null, day: null };
      out.plan![a] = { ...cur, [b]: q };
    }
  }
  if (!fields.some(([k]) => k.startsWith("reason:"))) out.reasons = dm.reasons;
  out.entered = dm.entered || touched;
  return out;
}
