import { db } from "@/lib/db";
import { monthTitle } from "@/lib/davomat";
import { STAFF_CASH_RULE, breakdownOf } from "./payroll";
import { groupOf, groupOrder } from "./tabel";
import { PAYROLL_KIND_LABEL } from "./labels";

/**
 * Vedomost Excel'dagi C2026 ko'rinishida: bo'limlar (yaratilgan komanda va brigadalar, biriktirilmaganlar) va ustunlar
 *   hisoblandi · 12% · qo'lga · brak · aliment/ijro · qarz · oylikdan qarz · to'y puli · jarima · boshqa · avans · qoldiq · plastik · naqd.
 * Ushlanmalar qatorning `breakdown` idan turi bo'yicha ajratiladi (qo'lda yozuvlar `category`, qoidalar nomi bo'yicha).
 * Sahifa, Excel eksporti va chop etiladigan ro'yxatlar shu bitta joydan oladi.
 */

export const SHEET_COLS = [
  { key: "gross", label: "Hisoblandi", excel: "Начислено" },
  { key: "tax", label: "Soliq 12%", excel: "Подоход 12%" },
  { key: "hand", label: "Qo'lga", excel: "На руки" },
  { key: "brak", label: "Brak", excel: "Брак плита" },
  { key: "aliment", label: "Aliment / ijro", excel: "Алимент/удержание" },
  { key: "loan", label: "Qarz to'lovi", excel: "Ойма-ой карз" },
  { key: "salaryDebt", label: "Oylikdan qarz", excel: "Ойлик хисобидан карз" },
  { key: "fund", label: "To'y puli", excel: "Туй пули" },
  { key: "fine", label: "Jarima", excel: "Штраф" },
  { key: "other", label: "Boshqa", excel: "Бошка" },
  { key: "advance", label: "Avans", excel: "Аванс" },
  { key: "net", label: "Qoldiq", excel: "Остаток" },
  { key: "card", label: "Plastik", excel: "Зарплата пластик" },
  { key: "cash", label: "Naqd", excel: "Зарплата наличка" },
] as const;
export type SheetColKey = (typeof SHEET_COLS)[number]["key"];
export type SheetRow = { lineId: string; employeeId: string; fullName: string; position: string; paid: boolean; v: Record<SheetColKey, number> };
export type SheetGroup = { label: string; rows: SheetRow[]; total: Record<SheetColKey, number> };

const zero = (): Record<SheetColKey, number> => Object.fromEntries(SHEET_COLS.map((c) => [c.key, 0])) as Record<SheetColKey, number>;
const add = (a: Record<SheetColKey, number>, b: Record<SheetColKey, number>) => { for (const c of SHEET_COLS) a[c.key] += b[c.key]; };

/** Ushlanma ustunlari (C2026 G–K va boshqalar) — vedomost, xodimning «oyligim» kartasi va «Mening hisobim» bir xil ajratadi. */
export const DEDUCTION_KEYS = ["brak", "aliment", "loan", "salaryDebt", "fund", "fine", "other"] as const;
export type DeductionKey = (typeof DEDUCTION_KEYS)[number];
export const sheetColLabel = (k: SheetColKey) => SHEET_COLS.find((c) => c.key === k)!.label;

/** Qoidaning (avtomatik ushlanma) ustuni. */
const RULE_COL = (rule: string): DeductionKey => (rule === "Brigada braki" ? "brak" : rule === "Qarz (nasiya)" ? "loan" : rule === "Ijro varaqasi" || rule === "Aliment" ? "aliment" : rule === STAFF_CASH_RULE ? "salaryDebt" : rule === "O'tgan oydan qarz" ? "other" : "fine");
const CAT_COL: Record<string, DeductionKey> = { ALIMENT: "aliment", LOAN: "loan", SALARY_DEBT: "salaryDebt", FUND: "fund", FINE: "fine" };
/** Qo'lda yozilgan ushlanma (`PayAdjustment.category`) ustuni; turi yo'q (eski jarima) — «Jarima». */
export const manualCol = (category: string | null | undefined): DeductionKey => (category && CAT_COL[category]) || "fine";
export const ruleCol = RULE_COL;

/** Qoida nomi xodimga: kassadan berilgan pul — «Oylikdan qarz», nasiya ulushi — «Qarz to'lovi» (C2026 ustunlari bo'yicha). */
export function deductionRuleTitle(rule: string): string {
  if (rule === STAFF_CASH_RULE) return `${sheetColLabel("salaryDebt")} — kassadan berilgan`;
  if (rule === "Qarz (nasiya)") return `${sheetColLabel("loan")} — nasiya`;
  return rule;
}

/** Vedomost qatoridagi ushlanmalar turi bo'yicha (qoidalar nomi, qo'lda yozuvlar `category` bo'yicha). */
export function lineDeductions(breakdown: unknown): Record<DeductionKey, number> {
  const b = breakdownOf(breakdown);
  const v = Object.fromEntries(DEDUCTION_KEYS.map((k) => [k, 0])) as Record<DeductionKey, number>;
  for (const h of b?.rules ?? []) if (h.kind === "PENALTY") v[RULE_COL(h.rule)] += h.amount;
  for (const m of b?.manual ?? []) if (m.kind === "PENALTY") v[manualCol(m.category)] += m.amount;
  return v;
}

/** Vedomost qatori (bazadagi `PayrollLine` yoki hisoblangan `CalcLine`) — C2026 qatoriga aylantirish uchun. */
export type SheetSrcLine = {
  id: string; employeeId: string; gross: unknown; incomeTax: unknown; breakdown: unknown; advanceDeducted: unknown; net: unknown; cardAmount: unknown; paidAt?: Date | null;
  employee: { fullName: string; position: string; brigadeId: string | null; teamId: string | null; brigade: { name: string } | null; team: { name: string } | null };
};

/** Qatorlar → bo'limlar (komanda / brigada / biriktirilmagan) va C2026 ustunlari. Sahifa, Excel va ERP kitobi shu yerdan. */
export function sheetGroups(lines: SheetSrcLine[]) {
  const groups = new Map<string, SheetGroup & { order: number }>();
  for (const l of lines) {
    const v = zero();
    v.gross = Number(l.gross); v.tax = Number(l.incomeTax); v.hand = v.gross - v.tax;
    Object.assign(v, lineDeductions(l.breakdown));
    v.advance = Number(l.advanceDeducted);
    v.net = Number(l.net);
    v.card = Number(l.cardAmount);
    v.cash = Math.max(0, v.net - v.card);
    const g = groupOf(l.employee);
    const cur = groups.get(g.key) ?? { label: g.label, rows: [], total: zero(), order: groupOrder(g.key) };
    cur.rows.push({ lineId: l.id, employeeId: l.employeeId, fullName: l.employee.fullName, position: l.employee.position, paid: !!l.paidAt, v });
    add(cur.total, v);
    groups.set(g.key, cur);
  }
  const list = [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const total = zero();
  for (const g of list) add(total, g.total);
  return { groups: list.map((g) => ({ label: g.label, rows: g.rows, total: g.total })), total };
}

export async function runSheet(runId: string) {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: {
      lines: {
        include: { employee: { select: { id: true, fullName: true, position: true, payType: true, subdivision: true, brigadeId: true, teamId: true, brigade: { select: { name: true } }, team: { select: { name: true } } } } },
        orderBy: { employee: { fullName: "asc" } },
      },
    },
  });
  if (!run) return null;
  return {
    run: { id: run.id, docNo: run.docNo, month: run.month, kind: run.kind, status: run.status, title: `${run.docNo} · ${monthTitle(run.month)} · ${PAYROLL_KIND_LABEL[run.kind]}` },
    ...sheetGroups(run.lines),
  };
}
export type RunSheet = NonNullable<Awaited<ReturnType<typeof runSheet>>>;
