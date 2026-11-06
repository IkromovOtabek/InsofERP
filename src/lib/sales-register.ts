import { db } from "./db";
import { audit } from "./audit";
import { cashOutflowError } from "./payments";

/**
 * Realizatsiya jurnali — avval Excel'dan yuklangan kunlik jo'natma jadvali (Kassa/bank → «Realizatsiya jurnali» tabi).
 * Yangi import yo'q (Kassa/bank'dagi Excel import endi Kassa jurnaliga yozadi, `lib/cash-import.ts`); bu yerda
 * jadvaldagi «Деньги» nomi va yuklangan partiyani qaytarish qoladi.
 */

/**
 * "Деньги" ustuni → pul qaysi hisobga tushadi:
 * н-к (наличка) — naqd kassa, п-р (перечисление) — bank hisobi. Tanib bo'lmasa null.
 */
export function payKind(v: string): "CASH" | "BANK" | null {
  // Bo'shliq, nuqta va o'zbekcha tutuq belgilarining barcha ko'rinishi (' ‘ ’ ʻ ʼ `) olib tashlanadi; "п/р" = "п-р"
  const s = v.toLowerCase().replace(/[\s.,'"‘’ʻʼ`]/g, "").replace(/\//g, "-");
  if (!s) return null;
  if (/^(н-?к|нал|naqd|nk|nal)/.test(s)) return "CASH";
  if (/^(п-?р|перечисл|безнал|б-?н|pr|otkazma|otkazish|pulotkaz|perechisl|bank|plastik|karta|terminal|click|payme|uzcard|humo)/.test(s)) return "BANK";
  return null;
}

/** Kassa/bank sahifasida ko'rsatiladigan nom. */
export const payKindLabel = (v: string | null) => {
  const k = payKind(v ?? "");
  return k === "CASH" ? "naqd" : k === "BANK" ? "o'tkazma" : v || "—";
};

class RegisterError extends Error {}

/** Import partiyasini butunlay qaytarish: qatorlar va ular yozgan kassa kirimlari o'chadi. */
export async function deleteRegisterBatch(batch: string, userId: string): Promise<{ rows: number; payments: number; error?: string }> {
  return db.$transaction(async (tx) => {
    const rows = await tx.salesRegister.findMany({ where: { batch }, select: { id: true, paymentId: true } });
    if (!rows.length) return { rows: 0, payments: 0 };
    await tx.salesRegister.deleteMany({ where: { batch } });
    const payIds = rows.map((r) => r.paymentId).filter((x): x is string => !!x);
    if (payIds.length) {
      // Partiya yozgan kassa kirimlari o'chadi — har hisob bo'yicha naqd kassa minusga tushmasin
      const byAcc = await tx.payment.groupBy({ by: ["cashAccountId"], where: { id: { in: payIds } }, _sum: { amount: true } });
      for (const a of byAcc) {
        const cashErr = await cashOutflowError(tx, a.cashAccountId, Number(a._sum.amount ?? 0));
        if (cashErr) throw new RegisterError(`Partiya qaytarilsa kassa minusga tushadi. ${cashErr}`);
      }
      await tx.payment.deleteMany({ where: { id: { in: payIds } } });
    }
    await audit(tx, userId, "DELETE", "SalesRegister", batch, { rows: rows.length, payments: payIds.length }, undefined);
    return { rows: rows.length, payments: payIds.length };
  }).catch((e: Error) => { if (e instanceof RegisterError) return { rows: 0, payments: 0, error: e.message }; throw e; });
}
