import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hit } from "@/lib/rate-limit";
import { resolvePlace } from "@/lib/geo";

export const dynamic = "force-dynamic";

/**
 * Tanlangan Yandex taklifining nuqtasi. Takliflar koordinatasiz keladi —
 * Geokoder faqat foydalanuvchi bitta manzilni tanlaganda chaqiriladi.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Pullik tashqi xizmat proksisi — /api/geo/search bilan bir xil qoida
  if (s.role === "DRIVER" || s.role === "BRIGADIER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!hit(`geo:resolve:${s.userId}`, 30, 60_000)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const p = new URL(req.url).searchParams;
  const uri = (p.get("uri") ?? "").slice(0, 2000);
  const text = (p.get("text") ?? "").slice(0, 300);
  if (!uri && !text) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  return NextResponse.json({ point: await resolvePlace(uri, text) });
}
