import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { revalidatePath } from "next/cache";
import { applyEcoStatus } from "@/lib/eco/sync";
import { applyEcoDriver, applyEcoVehicle } from "@/lib/eco/people";
import { ECO_STATUSES, type EcoStatus } from "@/lib/eco/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Insof ECO → ERP webhook. Uchta hodisa:
 *   delivery.status_changed — haydovchi ilovada reys holatini o'zgartirdi;
 *   driver.changed — haydovchi ilovada ro'yxatdan o'tdi / tasdiqlandi / ismini o'zgartirdi (ERP xodimi avtomatik yaratiladi);
 *   vehicle.changed — Tadbirkor ilovada mashina qo'shdi/o'zgartirdi.
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

  let p: EcoPayload;
  try { p = JSON.parse(body); } catch { return NextResponse.json({ error: "BAD_JSON" }, { status: 400 }); }

  try {
    if (p.event === "delivery.status_changed") return await onDelivery(p);
    if (p.event === "driver.changed") return await onDriver(p);
    if (p.event === "vehicle.changed") return await onVehicle(p);
    return NextResponse.json({ ok: true, ignored: true });
  } catch (e) {
    console.error("[eco][webhook]", p.event, e);
    return NextResponse.json({ error: "APPLY_FAILED" }, { status: 500 });
  }
}

type EcoPayload = {
  event?: string; byIntegration?: boolean;
  // delivery.status_changed
  externalRef?: string; deliveryId?: string; to?: string; note?: string | null; acceptedM3?: number | null;
  driver?: { fullName: string | null; phone: string } | null;
  // driver.changed
  userId?: string; fullName?: string | null; phone?: string; isActive?: boolean; reason?: string;
  // vehicle.changed
  vehicleId?: string; plateNumber?: string; capacityM3?: number; type?: string;
};

const DRIVER_REASONS = ["registered", "invited", "approved", "removed", "profile"] as const;

async function onDelivery(p: EcoPayload) {
  if (!p.externalRef || !p.deliveryId || !p.to || !ECO_STATUSES.includes(p.to as EcoStatus)) return NextResponse.json({ ok: true, ignored: true });
  const r = await applyEcoStatus({ externalRef: p.externalRef, deliveryId: p.deliveryId, to: p.to as EcoStatus, byIntegration: !!p.byIntegration, note: p.note ?? null, acceptedM3: p.acceptedM3 ?? null, driver: p.driver ?? null });
  if (r.trip) { revalidatePath(`/trips/${r.trip}`); revalidatePath("/trips"); revalidatePath("/drivers"); revalidatePath("/stock"); revalidatePath("/dashboard"); }
  return NextResponse.json({ ok: true, applied: r.applied });
}

/** Ilovada hisob ochildi/tasdiqlandi → ERP'da xodim kartasi (yo'q bo'lsa yaratiladi). */
async function onDriver(p: EcoPayload) {
  if (!p.userId || !p.phone || typeof p.isActive !== "boolean" || !DRIVER_REASONS.includes(p.reason as (typeof DRIVER_REASONS)[number])) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const r = await applyEcoDriver({
    userId: p.userId, fullName: p.fullName ?? null, phone: p.phone, isActive: p.isActive,
    reason: p.reason as (typeof DRIVER_REASONS)[number], byIntegration: !!p.byIntegration,
  });
  if (r.applied) { revalidatePath("/drivers"); revalidatePath("/employees"); }
  return NextResponse.json({ ok: true, applied: r.applied, created: !!r.created });
}

/** Ilovada mashina qo'shildi → ERP texnika ro'yxati. */
async function onVehicle(p: EcoPayload) {
  if (!p.vehicleId || !p.plateNumber || typeof p.isActive !== "boolean") return NextResponse.json({ ok: true, ignored: true });
  const r = await applyEcoVehicle({
    vehicleId: p.vehicleId, plateNumber: p.plateNumber, capacityM3: Number(p.capacityM3 ?? 0), type: p.type ?? "MIXER",
    isActive: p.isActive, byIntegration: !!p.byIntegration,
  });
  if (r.applied) revalidatePath("/drivers");
  return NextResponse.json({ ok: true, applied: r.applied, created: !!r.created });
}

/** Tirikligini tekshirish. */
export function GET() {
  return NextResponse.json({ ok: true, configured: !!process.env.ECO_WEBHOOK_SECRET });
}
