import { driverLedger, type LedgerTotals } from "@/lib/driver-ledger";
import { DELIVERY_LOGI_SINCE } from "@/lib/logistics-finance";

/**
 * Logistika hisobi — to'rt raqam, hammasi Hisob varag'i ustunlaridan (foydalanuvchi qarori, 2026-11-28):
 *
 *   Tushum  = Dostavka + Usluga prixod + Obyekt ustunlari (jurnaldagi «Transport xizmati» / «Boshqa kirim» — Usluga'da);
 *   Xarajat = Yoqilg'i puli + Ta'mir + Zapchast + Vulkanizator + Boshqa + Kassa / jurnal ustunlari. Kassadagi «Transport»
 *             chiqimi, Logistika moliya chiqimi va dispetcher omboridan yoqilg'i ham varaq qatorida (`lib/driver-ledger.ts`);
 *   Oylik   = Haydovchi haqi ustuni;
 *   Qoldiq  = Tushum − Xarajat − Oylik = «Foyda» ustunining jami.
 *
 * Yoqilg'i normasi (km × norma) xarajat emas — faqat nazorat ustuni.
 */

export type BalGroup = "Yoqilg'i" | "Ta'mir" | "Zapchast" | "Vulkanizator" | "Boshqa" | "Kassa / jurnal";
export const BAL_GROUPS: BalGroup[] = ["Yoqilg'i", "Ta'mir", "Zapchast", "Vulkanizator", "Boshqa", "Kassa / jurnal"];

export type LogiBalance = {
  from: Date; to: Date;
  tushum: number; tushumParts: { dostavka: number; usluga: number; obyekt: number };
  xarajat: number; xarajatByGroup: Record<BalGroup, number>;
  oylik: number; qoldiq: number;
  ledger: LedgerTotals;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Varaq jamidan to'rt raqam (bazasiz). */
export function balanceOf(t: LedgerTotals): Omit<LogiBalance, "from" | "to"> {
  const xarajatByGroup: Record<BalGroup, number> = {
    "Yoqilg'i": r2(t.fuelCost), "Ta'mir": r2(t.repair), Zapchast: r2(t.parts), Vulkanizator: r2(t.vulc), Boshqa: r2(t.other), "Kassa / jurnal": r2(t.extCost),
  };
  const tushum = r2(t.revenue), xarajat = r2(t.fuelCost + t.repair + t.parts + t.vulc + t.other + t.extCost), oylik = r2(t.pay);
  return {
    tushum, tushumParts: { dostavka: r2(t.revBank + t.revCash + t.revDebt), usluga: r2(t.svcBank + t.svcCash), obyekt: r2(t.revOther) },
    xarajat, xarajatByGroup, oylik, qoldiq: r2(tushum - xarajat - oylik), ledger: t,
  };
}

/** `ledger` — shu davr uchun allaqachon hisoblangan Hisob varag'i (sahifada qayta hisoblanmasin). */
export async function logiBalance(from: Date, to: Date, ledger?: { total: LedgerTotals }): Promise<LogiBalance> {
  const t = (ledger ?? (await driverLedger(from, to))).total;
  return { from, to, ...balanceOf(t) };
}

/** Boshidan (logistika alohida hisobi boshlangan kun — `DELIVERY_LOGI_SINCE`) hozirgacha qoldiq: logistika boshlig'i chiqimi shundan. */
export async function logiQoldiqNow(): Promise<{ qoldiq: number; since: Date }> {
  const now = new Date();
  const b = await logiBalance(DELIVERY_LOGI_SINCE, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  return { qoldiq: b.qoldiq, since: DELIVERY_LOGI_SINCE };
}
