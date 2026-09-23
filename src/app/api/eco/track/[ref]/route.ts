import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { eco, ecoEnabled, EcoError } from "@/lib/eco/client";
import { canSeeTrack } from "@/lib/eco/visibility";

export const dynamic = "force-dynamic";

/**
 * Bitta reysning GPS izi — xaritada yo'l chizig'i va "necha km yurdi" shu yerdan keladi.
 * Xarita faqat reys tanlanganda so'raydi (iz yuzlab nuqtadan iborat bo'lishi mumkin).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!ecoEnabled()) return NextResponse.json({ track: null, error: null });
  const { ref } = await params;
  if (!(await canSeeTrack(s, ref))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  try {
    return NextResponse.json({ track: await eco.track(ref), error: null });
  } catch (e) {
    const msg = e instanceof EcoError ? `${e.message} [${e.code}]` : String((e as Error)?.message ?? e);
    return NextResponse.json({ track: null, error: msg });
  }
}
