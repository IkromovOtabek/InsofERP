import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { money } from "@/lib/format";
import { cashOutflowError } from "@/lib/payments";
import { lockReceipt, receiptPayState } from "@/lib/receipt-payables";

/**
 * Qo'lda kirim/chiqim yozish — yagona joy: veb "Kirim-Chiqim" formasi ham (`cashflow/actions.ts`),
 * mobil ilovadagi kassa ham (`lib/mobile/create.ts`) shu yerdan.
 *
 * Qoidalar:
 *  · hisob bo'yicha navbat (advisory lock) — dublikat va qoldiq tekshiruvi parallel so'rovlarda ham to'g'ri;
 *  · kirim hujjatiga (GoodsReceipt) faqat chiqim bog'lanadi, qisman to'lov mumkin, qolgandan ortig'i — yo'q;
 *  · ta'minot zanjiridan kelgan / storno qilingan kirimga to'lov yozilmaydi;
 *  · naqd kassa minusga tushmaydi, bank — faqat direktor overdraft ruxsat bergan bo'lsa (`cashOutflowError`);
 *  · bir xil yozuv 60 soniya ichida qayta kelsa — ikki marta bosilgan deb rad etiladi.
 */
export type CashEntryInput = {
  type: "INCOME" | "EXPENSE";
  date: Date;
  cashAccountId: string;
  amount: number;
  category: string;
  counterparty?: string | null;
  supplierId?: string | null;
  /** Chiqim qaysi kirim hujjati (yetkazuvchidan olingan mol) uchun. */
  receiptId?: string | null;
  note?: string | null;
};

class CashError extends Error {}

/** Bir xil yozuv shu oraliqda qayta kelsa — ikki marta bosilgan deb hisoblanadi (to'lovlardagi kabi). */
const DUPLICATE_WINDOW_MS = 60_000;

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function createCashEntry(input: CashEntryInput, userId: string): Promise<{ id?: string; error?: string }> {
  const { receiptId, ...d } = { ...input, amount: r2(input.amount) };
  if (!(d.amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  if (receiptId && d.type !== "EXPENSE") return { error: "Kirim hujjatiga faqat chiqim (to'lov) bog'lanadi" };
  const acc = await db.cashAccount.findFirst({ where: { id: d.cashAccountId, isActive: true }, select: { id: true } });
  if (!acc) return { error: "Kassa/hisob topilmadi yoki yopilgan" };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashtx:" + d.cashAccountId}))`;
    // Kirim hujjatiga bog'langan to'lov: kirim qulfi ostida qolgan summa tekshiriladi — "To'lash" tugmasi
    // va qo'lda chiqim bir kirimni ikki marta to'lab yubormasin (qisman to'lov mumkin, ortiqchasi yo'q)
    let link: { refType: string; refId: string; supplierId: string; counterparty: string } | null = null;
    if (receiptId) {
      await lockReceipt(tx, receiptId);
      const st = await receiptPayState(tx, receiptId);
      if (!st) throw new CashError("Kirim hujjati topilmadi");
      if (st.cancelled) throw new CashError(`${st.docNo} storno qilingan — unga to'lov yozilmaydi`);
      if (st.fromSupply) throw new CashError(`${st.docNo} ta'minot zayavkasidan — uning puli ta'minot zanjirida to'langan`);
      if (d.supplierId && d.supplierId !== st.supplierId) throw new CashError(`${st.docNo} boshqa yetkazuvchiniki (${st.supplierName})`);
      if (st.left <= 0.005) throw new CashError(`${st.docNo} to'liq to'langan (${money(st.paid)})`);
      if (d.amount > st.left + 0.005) throw new CashError(`${st.docNo} bo'yicha qolgan to'lov ${money(st.left)} — ${money(d.amount)} ortiqcha`);
      link = { refType: "GoodsReceipt", refId: st.id, supplierId: st.supplierId, counterparty: d.counterparty ?? st.supplierName };
    }
    const dup = await tx.cashTransaction.findFirst({
      where: { type: d.type, cashAccountId: d.cashAccountId, amount: d.amount, category: d.category, createdById: userId, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      select: { id: true },
    });
    if (dup) throw new CashError("Aynan shu yozuv hozirgina saqlandi — ikki marta bosilgan bo'lishi mumkin. Rostdan ikkinchisi bo'lsa, bir daqiqadan keyin qayta kiriting");
    // Naqd kassa minusga tushmasin (bank — overdraft ruxsati bo'lmasa)
    if (d.type === "EXPENSE") {
      const err = await cashOutflowError(tx, d.cashAccountId, d.amount);
      if (err) throw new CashError(err);
    }
    const t = await tx.cashTransaction.create({
      data: {
        type: d.type, date: d.date, cashAccountId: d.cashAccountId, amount: d.amount, category: d.category,
        counterparty: d.counterparty ?? null, supplierId: d.supplierId ?? null, note: d.note ?? null,
        ...(link ?? {}), createdById: userId,
      },
    });
    await audit(tx, userId, "CREATE", "CashTransaction", t.id, undefined, t);
    return { id: t.id };
  }).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
}
