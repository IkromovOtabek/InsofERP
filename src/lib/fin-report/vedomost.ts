import { db } from "@/lib/db";
import { monthBounds } from "./sklad";
import type { MonthKey } from "./period";

/**
 * «Insof 2026» → «Oy uchun hisoblangan ish haqi (vedomost bo'yicha)» — Tahlil → Moliya.
 * Manba — oyning yakuniy (FINAL) ish haqi hisob-kitobi (`PayrollRun` + `PayrollLine`, Ish haqi bo'limi), bekor qilinganlarsiz.
 * Guruh: brigada a'zosi — «Brigada (brigadir)»; haydovchi — «Shofyorlar»; bo'linma yozilgan — o'sha bo'linma;
 * qolganlar — «AUP (ma'muriy xodimlar)». Brigada uchun oyda bajarilgan mahsulot (`TaskProgress`) va 1 donaga ish haqi.
 */

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
export const AUP = "AUP (ma'muriy xodimlar)";
export const DRIVERS = "Shofyorlar";
const DRIVER_RE = /haydovchi|shofyor|shafyor|driver/i;

export type VedomostRow = {
  group: string; kind: "Ma'muriy" | "Ishlab chiqarish" | "Kunbay";
  people: number; gross: number; tax: number; hand: number; deductions: number; advance: number; toPay: number; paid: number;
  units: number | null; perUnit: number | null;
};
export type Vedomost = {
  month: MonthKey;
  run: { id: string; docNo: string; status: string } | null;
  advanceRuns: number;
  rows: VedomostRow[];
  total: Omit<VedomostRow, "group" | "kind" | "perUnit">;
};

export async function vedomost(month: MonthKey): Promise<Vedomost> {
  const { from, to } = monthBounds(month);
  const [runs, progress] = await Promise.all([
    db.payrollRun.findMany({ where: { month, cancelledAt: null, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true, docNo: true, kind: true, status: true } }),
    db.taskProgress.groupBy({ by: ["taskId"], where: { date: { gte: from, lt: to } }, _sum: { qty: true } }),
  ]);
  const run = runs.find((r) => r.kind === "FINAL") ?? null;
  const advanceRuns = runs.filter((r) => r.kind === "ADVANCE").length;
  const empty = { people: 0, gross: 0, tax: 0, hand: 0, deductions: 0, advance: 0, toPay: 0, paid: 0, units: null };
  if (!run) return { month, run: null, advanceRuns, rows: [], total: empty };

  const [lines, tasks] = await Promise.all([
    db.payrollLine.findMany({
      where: { runId: run.id },
      select: {
        payType: true, gross: true, incomeTax: true, penalty: true, advanceDeducted: true, net: true, paid: true,
        employee: { select: { position: true, subdivision: true, brigadeId: true, brigade: { select: { name: true, leader: { select: { fullName: true } } } } } },
      },
    }),
    progress.length ? db.brigadeTask.findMany({ where: { id: { in: progress.map((p) => p.taskId) } }, select: { id: true, brigadeId: true } }) : [],
  ]);
  const unitsByBrigade = new Map<string, number>();
  const brigOf = new Map(tasks.map((t) => [t.id, t.brigadeId]));
  for (const p of progress) { const b = brigOf.get(p.taskId); if (b) unitsByBrigade.set(b, (unitsByBrigade.get(b) ?? 0) + Number(p._sum.qty ?? 0)); }

  const rows = new Map<string, VedomostRow & { brigadeId: string | null }>();
  for (const l of lines) {
    const e = l.employee;
    const leader = e.brigade?.leader?.fullName?.split(/\s+/)[0];
    const group = e.brigade ? `${e.brigade.name}${leader ? ` (${leader})` : ""}` : DRIVER_RE.test(e.position) ? DRIVERS : e.subdivision?.trim() || AUP;
    const kind: VedomostRow["kind"] = group === AUP ? "Ma'muriy" : l.payType === "DAILY" && e.brigade ? "Kunbay" : "Ishlab chiqarish";
    const r = rows.get(group) ?? { group, kind, brigadeId: e.brigadeId, people: 0, gross: 0, tax: 0, hand: 0, deductions: 0, advance: 0, toPay: 0, paid: 0, units: null, perUnit: null };
    const gross = Number(l.gross), tax = Number(l.incomeTax);
    r.people++; r.gross += gross; r.tax += tax; r.hand += gross - tax;
    r.deductions += Number(l.penalty); r.advance += Number(l.advanceDeducted);
    r.toPay += Math.max(0, Number(l.net) - Number(l.paid)); r.paid += Number(l.paid);
    rows.set(group, r);
  }
  const order = (r: VedomostRow) => (r.group === AUP ? 0 : r.group === DRIVERS ? 3 : r.kind === "Kunbay" ? 2 : 1);
  const list: VedomostRow[] = [...rows.values()].map(({ brigadeId, ...r }) => {
    const units = brigadeId ? unitsByBrigade.get(brigadeId) ?? null : null;
    return { ...r, gross: r2(r.gross), tax: r2(r.tax), hand: r2(r.hand), deductions: r2(r.deductions), advance: r2(r.advance), toPay: r2(r.toPay), paid: r2(r.paid), units, perUnit: units ? r2(r.gross / units) : null };
  }).sort((a, b) => order(a) - order(b) || a.group.localeCompare(b.group, "uz", { numeric: true }));
  const s = (f: (r: VedomostRow) => number) => r2(list.reduce((a, r) => a + f(r), 0));
  const units = list.some((r) => r.units != null) ? s((r) => r.units ?? 0) : null;
  return {
    month, run: { id: run.id, docNo: run.docNo, status: run.status }, advanceRuns, rows: list,
    total: { people: s((r) => r.people), gross: s((r) => r.gross), tax: s((r) => r.tax), hand: s((r) => r.hand), deductions: s((r) => r.deductions), advance: s((r) => r.advance), toPay: s((r) => r.toPay), paid: s((r) => r.paid), units },
  };
}
