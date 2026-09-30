import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hit } from "@/lib/rate-limit";
import { routeDistance } from "@/lib/geo";

export const dynamic = "force-dynamic";

/**
 * Zavoddan berilgan nuqtagacha masofa — forma nuqta tanlangan zahoti ko'rsatishi uchun.
 * Zavod nuqtasi Sozlamalarda belgilanmagan bo'lsa `null` qaytadi va forma shuni aytadi.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Pullik tashqi xizmat (2GIS/OSRM) proksisi: haydovchi/brigadir vebda buni ishlatmaydi, qolganlarga daqiqalik chegara
  if (s.role === "DRIVER" || s.role === "BRIGADIER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!hit(`geo:distance:${s.userId}`, 30, 60_000)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const p = new URL(req.url).searchParams;
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "BAD_POINT" }, { status: 400 });

  const c = await db.companySettings.findUnique({ where: { id: "main" }, select: { lat: true, lng: true } });
  if (c?.lat == null || c?.lng == null) return NextResponse.json({ distance: null, reason: "PLANT_UNSET" });

  return NextResponse.json({ distance: await routeDistance({ lat: c.lat, lng: c.lng }, { lat, lng }) });
}
