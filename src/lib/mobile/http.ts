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
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
  "cache-control": "no-store",
};

export const jsonOk = <T>(data: T) => NextResponse.json(data, { headers: CORS });
export const jsonErr = (code: string, message: string, status: number) => NextResponse.json({ code, message }, { status, headers: CORS });

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Har bir route shu orqali: xatolar bir xil shaklda (`{code, message}`) qaytadi. */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return jsonOk(await fn());
  } catch (e) {
    if (e instanceof MobileAuthError) return jsonErr(e.code, e.message, e.status);
    if (e instanceof ListError) return jsonErr(e.code, e.message, e.status);
    console.error("[mobile-api]", e);
    return jsonErr("INTERNAL", "Server xatosi", 500);
  }
}
