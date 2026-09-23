import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { routeDistance } from "@/lib/geo";

export const dynamic = "force-dynamic";

/**
 * Zavoddan berilgan nuqtagacha masofa — forma nuqta tanlangan zahoti ko'rsatishi uchun.
 * Zavod nuqtasi Sozlamalarda belgilanmagan bo'lsa `null` qaytadi va forma shuni aytadi.
 */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "BAD_POINT" }, { status: 400 });

  const c = await db.companySettings.findUnique({ where: { id: "main" }, select: { lat: true, lng: true } });
  if (c?.lat == null || c?.lng == null) return NextResponse.json({ distance: null, reason: "PLANT_UNSET" });

  return NextResponse.json({ distance: await routeDistance({ lat: c.lat, lng: c.lng }, { lat, lng }) });
}
