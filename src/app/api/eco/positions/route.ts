import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { eco, ecoEnabled, EcoError } from "@/lib/eco/client";
import { visibleTrips } from "@/lib/eco/visibility";

export const dynamic = "force-dynamic";

/**
 * Yo'ldagi reyslarning oxirgi joylashuvi — "Reyslar / nakladnoy" sahifasidagi xarita shu yerdan o'qiydi.
 * ECO o'chiq yoki yetib bormasa sahifa buzilmaydi: bo'sh ro'yxat va sabab qaytadi.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!ecoEnabled()) return NextResponse.json({ trips: [], error: null, enabled: false });
  // `?orderRef=` — zayavka kartochkasi faqat o'sha zayavkaning reyslarini so'raydi
  const orderRef = new URL(req.url).searchParams.get("orderRef");
  try {
    const all = await visibleTrips(s, await eco.positions());
    const trips = orderRef ? all.filter((t) => t.orderRef === orderRef) : all;
    return NextResponse.json({ trips, error: null, enabled: true });
  } catch (e) {
    const msg = e instanceof EcoError ? `${e.message} [${e.code}]` : String((e as Error)?.message ?? e);
    return NextResponse.json({ trips: [], error: msg, enabled: true });
  }
}
