import { db } from "@/lib/db";
import { type MonthKey, monthKeyOf, monthDiff } from "./period";

/**
 * Asosiy vositalar amortizatsiyasi — teng ulushda (to'g'ri chiziqli):
 *   oylik = qiymat / xizmat muddati (oy), olingan oydan KEYINGI oydan boshlab;
 *   muddat tugasa yoki vosita hisobdan chiqarilsa (disposedAt oyidan keyin) to'xtaydi.
 * Qoldiq (balans) qiymati = qiymat − shu oy oxirigacha yig'ilgan amortizatsiya.
 */
export type AssetRow = { id: string; name: string; group: string; acquiredAt: Date; cost: number; lifeMonths: number; disposedAt: Date | null; cashTxId: string | null; note: string | null };

export async function activeAssets(): Promise<AssetRow[]> {
  const rows = await db.fixedAsset.findMany({ where: { cancelledAt: null }, orderBy: [{ group: "asc" }, { acquiredAt: "asc" }] });
  return rows.map((a) => ({ id: a.id, name: a.name, group: a.group, acquiredAt: a.acquiredAt, cost: Number(a.cost), lifeMonths: a.lifeMonths, disposedAt: a.disposedAt, cashTxId: a.cashTxId, note: a.note }));
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const monthlyDepreciation = (a: Pick<AssetRow, "cost" | "lifeMonths">) => (a.lifeMonths > 0 ? a.cost / a.lifeMonths : 0);

/** Shu oyga tushadigan amortizatsiya. */
export function depreciationIn(a: AssetRow, month: MonthKey): number {
  const n = monthDiff(monthKeyOf(a.acquiredAt), month); // 1 — olingandan keyingi oy
  if (n < 1 || n > a.lifeMonths) return 0;
  if (a.disposedAt && monthDiff(monthKeyOf(a.disposedAt), month) > 0) return 0;
  return r2(monthlyDepreciation(a));
}

/** Oy OXIRIDAGI holat: yig'ilgan amortizatsiya va qoldiq qiymat (olinmagan yoki chiqarilgan bo'lsa 0). */
export function assetStateAt(a: AssetRow, month: MonthKey): { accumulated: number; net: number } {
  const since = monthDiff(monthKeyOf(a.acquiredAt), month);
  if (since < 0) return { accumulated: 0, net: 0 };
  if (a.disposedAt && monthDiff(monthKeyOf(a.disposedAt), month) >= 0) return { accumulated: 0, net: 0 };
  const months = Math.min(Math.max(0, since), a.lifeMonths);
  const accumulated = r2(Math.min(a.cost, monthlyDepreciation(a) * months));
  return { accumulated, net: r2(a.cost - accumulated) };
}
