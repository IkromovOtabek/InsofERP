import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canSeeTrack } from "@/lib/eco/visibility";
import { trackByRef } from "@/lib/live";

export const dynamic = "force-dynamic";

/**
 * Bitta reysning GPS izi — xaritadagi yo'l chizig'i va "necha km yurdi" shu yerdan.
 * Zavod haydovchisining izi ERP bazasida, pudratchiniki ECO'da — `lib/live.ts` hal qiladi.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { ref } = await params;
  if (!(await canSeeTrack(s, ref))) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json(await trackByRef(ref));
}
