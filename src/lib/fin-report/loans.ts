import { db } from "@/lib/db";
import type { LoanKind } from "@/generated/prisma";

/**
 * Kredit va qarzlar qoldig'i. Qoldiq = boshlang'ich qoldiq (openingDate holatida) + shu sanadan keyingi
 * kassadagi ASOSIY QARZ harakatlari (`loanPart = PRINCIPAL`). Foiz qoldiqni o'zgartirmaydi (u PNL xarajati).
 *   BANK / BORROWED (bizning qarzimiz): kirim (+), chiqim (−)
 *   LENT (biz bergan qarz — aktiv):       chiqim (+), kirim (−)
 */
export const LOAN_KIND_LABEL: Record<LoanKind, string> = { BANK: "Bank krediti", BORROWED: "Olingan qarz", LENT: "Berilgan qarz" };

export type LoanBalance = {
  id: string; kind: LoanKind; name: string; counterparty: string; opening: number; openingDate: Date; rate: number | null;
  closedAt: Date | null; note: string | null; principalIn: number; principalOut: number; interestPaid: number; balance: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Barcha faol kreditlar qoldig'i `asOf` paytgacha (date < asOf; berilmasa — hozir). */
export async function loanBalances(asOf?: Date): Promise<LoanBalance[]> {
  const [loans, moves] = await Promise.all([
    db.loan.findMany({ where: { cancelledAt: null }, orderBy: [{ kind: "asc" }, { openingDate: "asc" }] }),
    db.cashTransaction.findMany({
      where: { loanId: { not: null }, cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, ...(asOf ? { date: { lt: asOf } } : {}) },
      select: { loanId: true, type: true, amount: true, loanPart: true, date: true },
    }),
  ]);
  return loans
    .filter((l) => !asOf || l.openingDate < asOf)
    .map((l) => {
      let inn = 0, out = 0, interest = 0;
      for (const m of moves) {
        if (m.loanId !== l.id || m.date < l.openingDate) continue;
        const a = Number(m.amount);
        if (m.loanPart === "INTEREST") { if (m.type === "EXPENSE") interest += a; continue; }
        if (m.type === "INCOME") inn += a; else out += a;
      }
      const opening = Number(l.openingBalance);
      const balance = l.kind === "LENT" ? opening + out - inn : opening + inn - out;
      return {
        id: l.id, kind: l.kind, name: l.name, counterparty: l.counterparty, opening, openingDate: l.openingDate, rate: l.rate === null ? null : Number(l.rate),
        closedAt: l.closedAt, note: l.note, principalIn: r2(inn), principalOut: r2(out), interestPaid: r2(interest), balance: r2(balance),
      };
    });
}
