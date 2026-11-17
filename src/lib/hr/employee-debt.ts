import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";

/**
 * Xodim qarzi (nasiya) — Kirim-Chiqimda «Hodimlar bilan hisob-kitob» chiqimi «Oylikdan nasiya» bilan yozilganda ochiladi
 * (`lib/cash-entry.ts`). Jadval qat'iy: `startMonth` dan `months` oy, har oy teng ulush (minglikka yaxlitlangan), oxirgi oy —
 * qoldiq. Oy yakuni vedomostida (`lib/hr/payroll.ts` → `calculate`) jarima qatori «Qarz (nasiya)» bo'lib ushlanadi;
 * maosh yetmasa — vedomostdagi «O'tgan oydan qarz» qoidasi keyingi oyga o'tkazadi. Bekor qilingan qarz ushlanmaydi.
 */

const monthIndex = (ym: string) => { const [y, m] = ym.split("-").map(Number); return y! * 12 + (m! - 1); };
export const addMonths = (ym: string, n: number) => { const i = monthIndex(ym) + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; };

/** Oylik ulush: minglikka yaxlitlangan teng bo'lak, oxirgisi — qolgan summa. */
export function installment(amount: number, months: number, n: number): number {
  const part = Math.round(amount / months / 1000) * 1000 || Math.round(amount / months);
  return n < months ? part : Math.round(amount - part * (months - 1));
}

/** Shu oyda ushlanadigan ulush (1-asosli tartib raqami bilan) yoki null — oy jadvaldan tashqarida. */
export function dueIn(d: { amount: unknown; months: number; startMonth: string }, month: string): { n: number; amount: number } | null {
  const i = monthIndex(month) - monthIndex(d.startMonth);
  if (i < 0 || i >= d.months) return null;
  return { n: i + 1, amount: installment(Number(d.amount), d.months, i + 1) };
}

export type DebtDue = { id: string; employeeId: string; n: number; of: number; amount: number; total: number; note: string | null };

/**
 * Oy yakuni vedomosti uchun: shu oyda AVTOMATIK ushlanadigan nasiya ulushlari — faqat kassadan berilgan nasiya
 * (`cashTxId`). Qo'lda / Excel'dan kiritilgan qoldiq (kassasiz) faqat Ushlanmalar jadvalidagi «Qarz to'lovi» bilan
 * ushlanadi (u yerda jadval ulushi taklif bo'lib turadi) — Excel'dagidek har oy summasi yoziladi.
 */
export async function debtsDue(month: string, employeeIds: string[]): Promise<DebtDue[]> {
  if (!employeeIds.length) return [];
  const list = await db.employeeDebt.findMany({
    where: { employeeId: { in: employeeIds }, cancelledAt: null, startMonth: { lte: month }, cashTxId: { not: null } },
    select: { id: true, employeeId: true, amount: true, months: true, startMonth: true, note: true },
  });
  return list.flatMap((d) => {
    const due = dueIn(d, month);
    return due ? [{ id: d.id, employeeId: d.employeeId, n: due.n, of: d.months, amount: due.amount, total: Number(d.amount), note: d.note }] : [];
  });
}

/**
 * Qarzlar ro'yxati (Ish haqi → Xodim qarzlari): ushlangan — jadvaldagi oylardan oy yakuni vedomosti tasdiqlangan
 * (yoki to'langan) oylar ulushi; qolgan — summa − ushlangan.
 */
export async function listDebts() {
  const debts = await db.employeeDebt.findMany({
    orderBy: [{ cancelledAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 500,
    include: { employee: { select: { id: true, fullName: true, position: true } }, cashTx: { select: { date: true, cashAccount: { select: { name: true } } } } },
  });
  // Ushlangani — tasdiqlangan oy yakuni vedomostlaridagi taqsimot (qo'lda yozilgan qarz to'lovi ham), eski vedomostda — jadval ulushi
  const lines = await closedLines([...new Set(debts.map((d) => d.employeeId))]);
  return debts.map((d) => {
    const amount = Number(d.amount);
    const held = debtHeld(d, lines);
    const heldN = lines.filter((l) => l.employeeId === d.employeeId && ((allocOf(l.breakdown, "debts") ?? []).some((x) => x.id === d.id && Number(x.amount) > 0) || (!allocOf(l.breakdown, "debts") && dueIn(d, l.month)))).length;
    return {
      id: d.id, employee: d.employee, amount, months: d.months, startMonth: d.startMonth, endMonth: addMonths(d.startMonth, d.months - 1),
      monthly: installment(amount, d.months, 1), held: d.cancelledAt ? 0 : held, heldN, left: d.cancelledAt ? 0 : Math.max(0, amount - held),
      note: d.note, date: d.cashTx?.date ?? d.createdAt, account: d.cashTx?.cashAccount.name ?? null,
      cancelledAt: d.cancelledAt, cancelReason: d.cancelReason,
    };
  });
}

// ───────────────────────── Ushlangani (vedomost taqsimoti) ─────────────────────────

const num = (v: unknown) => Number(v ?? 0);

export type HeldLine = { employeeId: string; month: string; breakdown: Prisma.JsonValue };
export type Alloc = { id: string; amount: number }[];
export const allocOf = (b: Prisma.JsonValue, key: "debts" | "withholds"): Alloc | undefined => {
  const v = b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>)[key] : undefined;
  return Array.isArray(v) ? (v as Alloc) : undefined;
};

/** Tasdiqlangan (yoki to'langan) oy yakuni vedomosti qatorlari — daftardagi «ushlangan» shulardan. */
export async function closedLines(employeeIds: string[], beforeMonth?: string): Promise<HeldLine[]> {
  if (!employeeIds.length) return [];
  const rows = await db.payrollLine.findMany({
    where: { employeeId: { in: employeeIds }, run: { kind: "FINAL", status: { in: ["APPROVED", "PAID"] }, ...(beforeMonth ? { month: { lt: beforeMonth } } : {}) } },
    select: { employeeId: true, breakdown: true, run: { select: { month: true } } },
  });
  return rows.map((r) => ({ employeeId: r.employeeId, month: r.run.month, breakdown: r.breakdown }));
}

/**
 * Nasiya qarzining ushlangani: vedomostda taqsimot (`breakdown.debts`) bo'lsa — o'sha summa; eski vedomostlarda
 * (taqsimotsiz) — jadvaldagi oy ulushi (avvalgi qoida).
 */
export function debtHeld(d: { id: string; employeeId: string; amount: unknown; months: number; startMonth: string }, lines: HeldLine[]) {
  let held = 0;
  for (const l of lines) {
    if (l.employeeId !== d.employeeId) continue;
    const a = allocOf(l.breakdown, "debts");
    if (a) held += a.filter((x) => x.id === d.id).reduce((s, x) => s + num(x.amount), 0);
    else { const due = dueIn({ amount: d.amount, months: d.months, startMonth: d.startMonth }, l.month); if (due) held += due.amount; }
  }
  return held;
}


