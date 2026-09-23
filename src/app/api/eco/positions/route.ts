import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ecoEnabled } from "@/lib/eco/client";
import { liveTrips } from "@/lib/live";

export const dynamic = "force-dynamic";

/**
 * Yo'ldagi reyslarning oxirgi joylashuvi — xarita shu yerdan o'qiydi.
 *
 * Manba ikkita: Insof ECO (pudratchi haydovchilar) va ERP'ning o'z izi (zavod haydovchilari).
 * `lib/live.ts` ikkalasini qo'shadi va ruxsatni qo'llaydi. ECO o'chiq bo'lsa ham sahifa
 * ishlaydi — zavod haydovchilari baribir ko'rinadi.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // `?orderRef=` — zayavka kartochkasi faqat o'sha zayavkaning reyslarini so'raydi
  const orderRef = new URL(req.url).searchParams.get("orderRef");
  const { trips, error } = await liveTrips(s, orderRef);
  return NextResponse.json({ trips, error, enabled: ecoEnabled() || trips.length > 0 });
}
