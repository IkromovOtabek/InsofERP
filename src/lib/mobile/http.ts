import { NextResponse } from "next/server";
import { MobileAuthError } from "./auth";
import { ListError } from "./list";

/**
 * Mobil API uchun umumiy javob qobig'i.
 * CORS ochiq: ilova qurilmadan (RN fetch) keladi, brauzer emas — lekin Expo web
 * va lokal sinovda kerak bo'ladi. Ma'lumot baribir Bearer token bilan himoyalangan.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "cache-control": "no-store",
};

export const jsonOk = <T>(data: T) => NextResponse.json(data, { headers: CORS });
/** `extra` — qo'shimcha maydonlar (masalan GPS izida `stop: true`); eski ilova faqat `code`/`message` ni o'qiydi. */
export const jsonErr = (code: string, message: string, status: number, extra?: Record<string, unknown>) =>
  NextResponse.json({ ...extra, code, message }, { status, headers: CORS });

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Har bir route shu orqali: xatolar bir xil shaklda (`{code, message}`) qaytadi. */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return jsonOk(await fn());
  } catch (e) {
    if (e instanceof MobileAuthError) return jsonErr(e.code, e.message, e.status);
    if (e instanceof ListError) return jsonErr(e.code, e.message, e.status, e.extra);
    // Prisma "yozuv topilmadi" (findUniqueOrThrow / update mavjud bo'lmagan id bilan) — mijoz yuborgan
    // noto'g'ri id, server xatosi emas: 404. Aks holda har bir begona/eskirgan id 500 bo'lib jurnalni to'ldirardi.
    if ((e as { code?: unknown })?.code === "P2025") return jsonErr("NOT_FOUND", "Hujjat topilmadi", 404);
    console.error("[mobile-api]", e);
    return jsonErr("INTERNAL", "Server xatosi", 500);
  }
}
