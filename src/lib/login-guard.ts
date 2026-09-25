import { headers } from "next/headers";

/**
 * Login'ni qo'pol kuch (brute-force) hujumidan himoya — veb va mobil login uchun umumiy.
 *
 * Ikki kalit bo'yicha hisob yuritiladi:
 *  · login bo'yicha — bitta hisobga ketma-ket 5 xato → 15 daqiqa qulf (parolni taxmin qilish);
 *  · IP bo'yicha — 15 daqiqada 30 xato → qulf (ko'p loginni birdan sinash).
 * Har muvaffaqiyatsiz urinishda javob ataylab kechiktiriladi.
 *
 * Hisob xotirada (ERP bitta PM2 jarayonida ishlaydi); restart'da tozalanadi — bu maqbul,
 * chunki qulf maqsadi minutiga yuzlab urinishni to'xtatish, abadiy bloklash emas.
 * Qulflangan hisob ham baza tekshiruvidan oldin rad etiladi — parol haqida hech narsa bilinmaydi.
 */

const WINDOW_MS = 15 * 60_000;
const LOGIN_MAX = 5;
const IP_MAX = 30;
const LOCK_MS = 15 * 60_000;
export const FAIL_DELAY_MS = 500;

type Bucket = { fails: number[]; lockedUntil: number };
const buckets = new Map<string, Bucket>();

function bucket(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) { b = { fails: [], lockedUntil: 0 }; buckets.set(key, b); }
  return b;
}

function prune(b: Bucket, now: number) {
  b.fails = b.fails.filter((t) => now - t < WINDOW_MS);
}

/** Xotira o'sib ketmasin: eski bo'sh bucket'lar vaqti-vaqti bilan olib tashlanadi. */
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    prune(b, now);
    if (b.fails.length === 0 && b.lockedUntil <= now) buckets.delete(k);
  }
}

export type GuardResult = { ok: true } | { ok: false; retryAfterSec: number };

/** Urinishdan OLDIN: qulflangan bo'lsa necha soniyadan keyin mumkinligi qaytadi. */
export function checkLogin(login: string, ip: string): GuardResult {
  const now = Date.now();
  sweep(now);
  const until = Math.max(bucket(`l:${login.toLowerCase()}`).lockedUntil, bucket(`ip:${ip}`).lockedUntil);
  if (until > now) return { ok: false, retryAfterSec: Math.ceil((until - now) / 1000) };
  return { ok: true };
}

/** Parol noto'g'ri bo'lganda. Chegaraga yetsa qulf qo'yiladi. */
export function recordFailure(login: string, ip: string) {
  const now = Date.now();
  for (const [key, max] of [[`l:${login.toLowerCase()}`, LOGIN_MAX], [`ip:${ip}`, IP_MAX]] as const) {
    const b = bucket(key);
    prune(b, now);
    b.fails.push(now);
    if (b.fails.length >= max) {
      b.lockedUntil = now + LOCK_MS;
      b.fails = [];
      console.warn(`[login-guard] qulf: ${key} (${LOCK_MS / 60_000} daqiqa)`);
    }
  }
}

/** To'g'ri kirishda login bo'yicha hisob tozalanadi (IP hisobi qoladi). */
export function recordSuccess(login: string) {
  buckets.delete(`l:${login.toLowerCase()}`);
}

export const failDelay = () => new Promise((r) => setTimeout(r, FAIL_DELAY_MS));

/** Mijoz IP manzili — nginx/PM2 orqasida `x-forwarded-for` dagi birinchi manzil. */
export function ipFromHeaders(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return h.get("x-real-ip") ?? "unknown";
}

/** Server action ichida (so'rov obyekti yo'q). */
export async function clientIp(): Promise<string> {
  return ipFromHeaders(await headers());
}

export const lockedMessage = (sec: number) =>
  `Juda ko'p noto'g'ri urinish. ${Math.max(1, Math.ceil(sec / 60))} daqiqadan keyin qayta urinib ko'ring.`;
