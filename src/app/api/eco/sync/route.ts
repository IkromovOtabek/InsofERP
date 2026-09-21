import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ecoEnabled, ecoUrl } from "@/lib/eco/client";
import { syncAllToEco } from "@/lib/eco/master";

export const dynamic = "force-dynamic";

/** Faqat direktor: spravochnik sinxroni butun bazaga ta'sir qiladi. */
async function director() {
  const s = await getSession();
  if (!s) return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  if (s.role !== "DIRECTOR") return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };
  return { error: null };
}

/**
 * ERP spravochniklarini ECO'ga yuboradi (mijoz, marka, xomashyo, zayavka, schyot, to'lov).
 * Buyruq qatoridan: `npm run eco:sync`.
 */
export async function POST(req: Request) {
  const guard = await director();
  if (guard.error) return guard.error;
  if (!ecoEnabled()) return NextResponse.json({ error: "ECO ulanmagan" }, { status: 503 });
  const days = Number(new URL(req.url).searchParams.get("days") ?? 90);
  return NextResponse.json(await syncAllToEco({ sinceDays: Number.isFinite(days) && days > 0 ? days : 36500 }));
}

export async function GET() {
  const guard = await director();
  if (guard.error) return guard.error;
  return NextResponse.json({ enabled: ecoEnabled(), url: ecoEnabled() ? ecoUrl() : null });
}
