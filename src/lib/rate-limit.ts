import { headers } from "next/headers";
import { ipFromHeaders } from "./login-guard";

/**
 * Oddiy so'rov cheklagichi (jarayon xotirasida, sirpanuvchi oyna).
 *
 * Ommaviy formalar (sayt arizasi, do'kon buyurtmasi, qo'ng'iroq so'rovi) login so'ramaydi va har bir
 * ariza sotuv bo'limiga Telegram + push bo'lib ketadi. Telefon bo'yicha cheklov bor, lekin raqamni
 * almashtirib cheksiz yuborish mumkin edi — shuning uchun IP bo'yicha ham, umumiy oqim bo'yicha ham
 * chegara. Server qayta ishga tushsa hisoblagich nolga tushadi — bu himoya uchun yetarli.
 */
const buckets = new Map<string, number[]>();

export function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (!v.some((t) => now - t < 3_600_000)) buckets.delete(k);
  return true;
}

/** Ommaviy arizalar: bitta IP'dan 10 daqiqada 5 ta, butun sayt bo'yicha daqiqasiga 30 ta. */
export function publicLeadAllowed(ip: string): boolean {
  return hit(`lead:ip:${ip}`, 5, 10 * 60_000) && hit("lead:all", 30, 60_000);
}

export async function publicLeadAllowedFromAction(): Promise<boolean> {
  return publicLeadAllowed(ipFromHeaders(await headers()));
}

export const RATE_LIMITED = "So'rovlar juda ko'p. Birozdan keyin qayta urinib ko'ring yoki telefon qiling.";
