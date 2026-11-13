import { db } from "@/lib/db";
import { type MonthKey, addMonths, monthKeyOf, monthDiff, monthLabel } from "./period";

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

/**
 * Amortizatsiya hisoblana boshlanganmi: olingan oydan keyingi oy keldi — joriy oy PNL va balansida allaqachon bor.
 * Hisobotlar yozuvdan jonli hisoblanadi, shuning uchun bundan keyin qiymat, sana yoki muddat o'zgarsa
 * ko'rilgan / topshirilgan oylar raqami ham o'zgarib ketadi.
 */
export function depreciationStarted(a: Pick<AssetRow, "acquiredAt">, now: Date = new Date()): boolean {
  return monthDiff(monthKeyOf(a.acquiredAt), monthKeyOf(now)) >= 1;
}

/** Qiymat, olingan sana va muddat tahririga to'siq — sababi (forma izohi va server xatosi), bo'lmasa null. */
export function assetValueLock(a: Pick<AssetRow, "acquiredAt" | "disposedAt">, now: Date = new Date()): string | null {
  if (a.disposedAt) return "Vosita hisobdan chiqarilgan — qiymat, sana va muddat o'zgarmaydi (avval chiqarishni bekor qiling)";
  if (depreciationStarted(a, now)) {
    return `Amortizatsiya ${monthLabel(addMonths(monthKeyOf(a.acquiredAt), 1))} dan hisoblanmoqda — qiymat, sana yoki muddat o'zgarsa o'tgan oylar PNL va balansi o'zgarib ketadi. Xato bo'lsa — kartochkani bekor qilib, qaytadan kiriting`;
  }
  return null;
}

/** Kassa chiqimiga bog'langan vosita qiymati — o'sha chiqim summasi; qo'lda o'zgartirilsa kassa bilan kelishmay qoladi. */
export const ASSET_COST_CASH_LOCK = "Kassadagi «Asosiy vosita xaridi» chiqimiga bog'langan — qiymat o'zgarsa kassa bilan kelishmay qoladi. Farq bo'lsa: kartochkani bekor qiling va «Kassada xarid bor» ro'yxatidan qayta oching";
