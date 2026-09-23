import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchPlaces } from "@/lib/geo";

export const dynamic = "force-dynamic";

/** Manzil bo'yicha takliflar — zayavka formasi yozayotganda so'raydi. Kalit serverda qoladi. */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ places: await searchPlaces(q) });
}
