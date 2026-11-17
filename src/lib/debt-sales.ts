import { cache } from "react";
import { db } from "./db";
import { realizationLog, type LogRow } from "./realization-log";

/**
 * Mijozga sotuv — Realizatsiya reestridagi (Sotuv → «Realizatsiya») BARCHA qatorlar: Naqd, Perechisleniye va Qarz
 * (Otabek, 2026-11-17: «realizatsiyaga yozilgan har sotuv debitorkaga ham yozilsin»; 2026-11-14 da faqat «Qarz» edi).
 * Mijoz debitorkasiga (`lib/receivables.ts`) «Sotib olgan» bo'lib shu qatorlarning «Jami» summasi (QQS va dastavka bilan)
 * qo'shiladi, «To'lagan» — To'lovlar va kassada shu mijozga bog'langan kirim; qoldiq — farqi:
 *  · reysdan qator — dispetcher tuzatishlari (miqdor, narx, dastavka, sana) bilan — reestrdagi raqamning o'zi;
 *  · qo'lda / Excel qator — mijozga bog'langan (yo'q bo'lsa nomi bilan mijozlarga qo'shiladi, `realization-log.ts`);
 *  · zayavkaga schyot yozilgan bo'lsa — sotuv schyotdan (`Invoice`), reys qatorlari ikkinchi marta qo'shilmaydi.
 * Naqd sotuv puli kassada shu mijozga bog'lanmasa — mijoz qarzdor ko'rinadi (to'lov bog'lanmaganini ko'rsatadi).
 * Sana — reestrdagi sana (yuklangan vaqt yoki dispetcher ko'chirgan kun).
 */

export type DebtSale = { key: string; customerId: string; orderId: string | null; date: Date; total: number; row: LogRow };

const EPOCH = new Date(2000, 0, 1);

/** Bitta so'rov (render) ichida bir xil mijozlar ro'yxati uchun reestr bir marta o'qiladi (qarz varag'i ikki sanani so'raydi). */
const loadAll = cache(async (idsKey: string): Promise<DebtSale[]> => {
  const ids = idsKey === "*" ? undefined : idsKey.split(",");
  const until = new Date(); until.setDate(until.getDate() + 1);
  const rows = (await realizationLog(EPOCH, until, { customerIds: ids })).filter((r): r is LogRow & { customerId: string } => !!r.customerId);
  // Schyot yozilgan zayavka — qarz schyotda; reys qatorlari qo'shilmaydi
  const orderIds = [...new Set(rows.flatMap((r) => (r.orderId ? [r.orderId] : [])))];
  const invoiced = orderIds.length
    ? new Set((await db.invoice.findMany({ where: { orderId: { in: orderIds }, status: { not: "CANCELLED" }, isOpening: false }, select: { orderId: true } })).map((i) => i.orderId))
    : new Set<string | null>();
  return rows
    .filter((r) => !r.orderId || !invoiced.has(r.orderId))
    .filter((r) => Math.abs(r.total) >= 0.005)
    .map((r) => ({ key: r.key, customerId: r.customerId, orderId: r.orderId, date: r.date, total: r.total, row: r }));
});

/** `asOf` — shu paytgacha (date < asOf); `ids` — faqat shu mijozlar. */
export async function debtSales(opts: { ids?: string[]; asOf?: Date | null } = {}): Promise<DebtSale[]> {
  if (opts.ids && opts.ids.length === 0) return [];
  const all = await loadAll(opts.ids ? [...new Set(opts.ids)].sort().join(",") : "*");
  return opts.asOf ? all.filter((r) => r.date < opts.asOf!) : all;
}

/** Zayavka bo'yicha reestrdagi sotuv yig'indisi — kredit limitida (`finance.ts`) balansdagi qism ikki marta olinmasin. */
export async function debtSalesByOrder(ids?: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (const s of await debtSales({ ids })) if (s.orderId) m.set(s.orderId, (m.get(s.orderId) ?? 0) + s.total);
  return m;
}
