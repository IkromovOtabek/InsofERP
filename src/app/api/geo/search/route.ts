import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hit } from "@/lib/rate-limit";
import { searchPlaces } from "@/lib/geo";

export const dynamic = "force-dynamic";

/** Manzil bo'yicha takliflar — zayavka formasi yozayotganda so'raydi. Kalit serverda qoladi. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Pullik tashqi xizmat (Yandex/2GIS) proksisi: haydovchi/brigadir vebda buni ishlatmaydi, qolganlarga daqiqalik chegara
  if (s.role === "DRIVER" || s.role === "BRIGADIER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!hit(`geo:search:${s.userId}`, 60, 60_000)) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ places: await searchPlaces(q) });
}
