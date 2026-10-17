import { NextResponse } from "next/server";
import { findPublicOffer, recordOfferView } from "@/lib/offers";

/**
 * Mijoz QR sahifasini ochdi — «ko'rildi» hisobi. Sahifa renderida emas, brauzerdan bir marta
 * (sessiya ichida) chaqiriladi: server action va dev qayta renderlari sonni oshirib yubormasin.
 * Login yo'q — taklif raqami + kalit tekshiriladi; noto'g'ri bo'lsa jim 204.
 */
export async function POST(req: Request) {
  let body: { no?: unknown; k?: unknown } = {};
  try { body = await req.json(); } catch { /* bo'sh tana */ }
  if (typeof body.no !== "string" || typeof body.k !== "string" || body.no.length > 32) return new NextResponse(null, { status: 204 });
  const o = await findPublicOffer(body.no, body.k);
  if (o) await recordOfferView(o.id);
  return new NextResponse(null, { status: 204 });
}
