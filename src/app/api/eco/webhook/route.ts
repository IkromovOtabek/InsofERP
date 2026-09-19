import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { revalidatePath } from "next/cache";
import { applyEcoStatus } from "@/lib/eco/sync";
import { ECO_STATUSES, type EcoStatus } from "@/lib/eco/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Insof ECO → ERP webhook: haydovchi ilovada holatni o'zgartirdi.
 * Himoya: `X-Eco-Signature: sha256=HMAC_SHA256(ECO_WEBHOOK_SECRET, "<X-Eco-Timestamp>.<body>")`,
 * 5 daqiqadan eski so'rov rad etiladi (replay). Login'dan ozod (middleware'da /api/eco ochiq).
 * Xatoda 5xx qaytariladi — ECO 3 marta qayta uradi; baribir yetib bormasa reys sahifasidagi "ECO'dan yangilash" bor.
 */
export async function POST(req: Request) {
  const secret = process.env.ECO_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "ECO_WEBHOOK_SECRET sozlanmagan" }, { status: 503 });

  const body = await req.text();
  const ts = req.headers.get("x-eco-timestamp") ?? "";
  const sig = (req.headers.get("x-eco-signature") ?? "").replace(/^sha256=/, "");
  if (!ts || !sig || Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return NextResponse.json({ error: "STALE_OR_UNSIGNED" }, { status: 401 });
  const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return NextResponse.json({ error: "BAD_SIGNATURE" }, { status: 401 });

  let p: { event?: string; externalRef?: string; deliveryId?: string; to?: string; byIntegration?: boolean; note?: string | null; acceptedM3?: number | null; driver?: { fullName: string | null; phone: string } | null };
  try { p = JSON.parse(body); } catch { return NextResponse.json({ error: "BAD_JSON" }, { status: 400 }); }
  if (p.event !== "delivery.status_changed" || !p.externalRef || !p.deliveryId || !p.to || !ECO_STATUSES.includes(p.to as EcoStatus)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const r = await applyEcoStatus({ externalRef: p.externalRef, deliveryId: p.deliveryId, to: p.to as EcoStatus, byIntegration: !!p.byIntegration, note: p.note ?? null, acceptedM3: p.acceptedM3 ?? null, driver: p.driver ?? null });
    if (r.trip) { revalidatePath(`/trips/${r.trip}`); revalidatePath("/trips"); revalidatePath("/drivers"); revalidatePath("/stock"); revalidatePath("/dashboard"); }
    return NextResponse.json({ ok: true, applied: r.applied });
  } catch (e) {
    console.error("[eco][webhook]", e);
    return NextResponse.json({ error: "APPLY_FAILED" }, { status: 500 });
  }
}

/** Tirikligini tekshirish. */
export function GET() {
  return NextResponse.json({ ok: true, configured: !!process.env.ECO_WEBHOOK_SECRET });
}
