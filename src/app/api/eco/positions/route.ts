import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { eco, ecoEnabled, EcoError } from "@/lib/eco/client";

export const dynamic = "force-dynamic";

/**
 * Yo'ldagi reyslarning oxirgi joylashuvi — "Reyslar / nakladnoy" sahifasidagi xarita shu yerdan o'qiydi.
 * ECO o'chiq yoki yetib bormasa sahifa buzilmaydi: bo'sh ro'yxat va sabab qaytadi.
 */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!ecoEnabled()) return NextResponse.json({ trips: [], error: null, enabled: false });
  try {
    return NextResponse.json({ trips: await eco.positions(), error: null, enabled: true });
  } catch (e) {
    const msg = e instanceof EcoError ? `${e.message} [${e.code}]` : String((e as Error)?.message ?? e);
    return NextResponse.json({ trips: [], error: msg, enabled: true });
  }
}
