import { db } from "@/lib/db";
import { monthTitle } from "@/lib/davomat";
import { breakdownOf } from "./payroll";
import { groupOf } from "./tabel";
import { PAYROLL_KIND_LABEL } from "./labels";

/**
 * Vedomost Excel'dagi C2026 ko'rinishida: bo'limlar (AUP, vaqtbay, brigadalar, shofyorlar…) va ustunlar
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

/** Qoidaning (avtomatik ushlanma) ustuni. */
const RULE_COL = (rule: string): SheetColKey => (rule === "Brigada braki" ? "brak" : rule === "Qarz (nasiya)" ? "loan" : rule === "Ijro varaqasi" || rule === "Aliment" ? "aliment" : rule === "O'tgan oydan qarz" ? "other" : "fine");
const CAT_COL: Record<string, SheetColKey> = { ALIMENT: "aliment", LOAN: "loan", SALARY_DEBT: "salaryDebt", FUND: "fund", FINE: "fine" };

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
  const groups = new Map<string, SheetGroup & { order: number }>();
  const order = (k: string) => (k.startsWith("p:SALARY") ? 0 : k.startsWith("s:") ? 1 : k.startsWith("p:") ? 2 : k.startsWith("t:") ? 3 : k.startsWith("b:") ? 4 : 5);
  for (const l of run.lines) {
    const b = breakdownOf(l.breakdown);
    const v = zero();
    v.gross = Number(l.gross); v.tax = Number(l.incomeTax); v.hand = v.gross - v.tax;
    for (const h of b?.rules ?? []) if (h.kind === "PENALTY") v[RULE_COL(h.rule)] += h.amount;
    for (const m of b?.manual ?? []) if (m.kind === "PENALTY") v[(m.category && CAT_COL[m.category]) || "fine"] += m.amount;
    v.advance = Number(l.advanceDeducted);
    v.net = Number(l.net);
    v.card = Number(l.cardAmount);
    v.cash = Math.max(0, v.net - v.card);
    const g = groupOf(l.employee);
    const cur = groups.get(g.key) ?? { label: g.label, rows: [], total: zero(), order: order(g.key) };
    cur.rows.push({ lineId: l.id, employeeId: l.employeeId, fullName: l.employee.fullName, position: l.employee.position, paid: !!l.paidAt, v });
    add(cur.total, v);
    groups.set(g.key, cur);
  }
  const list = [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const total = zero();
  for (const g of list) add(total, g.total);
  return {
    run: { id: run.id, docNo: run.docNo, month: run.month, kind: run.kind, status: run.status, title: `${run.docNo} · ${monthTitle(run.month)} · ${PAYROLL_KIND_LABEL[run.kind]}` },
    groups: list.map((g) => ({ label: g.label, rows: g.rows, total: g.total })), total,
  };
}
export type RunSheet = NonNullable<Awaited<ReturnType<typeof runSheet>>>;
