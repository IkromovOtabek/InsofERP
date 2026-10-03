import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { revalidatePath } from "next/cache";
import { applyEcoStatus } from "@/lib/eco/sync";
import { applyEcoDriver, applyEcoVehicle } from "@/lib/eco/people";
import { applyEcoCustomerRegistered } from "@/lib/eco/customers";
import { requestFromEco } from "@/lib/account-deletion";
import { ECO_STATUSES, type EcoStatus } from "@/lib/eco/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Insof ECO → ERP webhook. Uchta hodisa:
 *   delivery.status_changed — haydovchi ilovada reys holatini o'zgartirdi;
 *   driver.changed — haydovchi ilovada ro'yxatdan o'tdi / tasdiqlandi / ismini o'zgartirdi (ERP xodimi avtomatik yaratiladi);
 *   vehicle.changed — Tadbirkor ilovada mashina qo'shdi/o'zgartirdi;
 *   customer.registered — ERP'dan taklif qilingan mijoz ilovada ro'yxatdan o'tdi (sotuvchiga bildirishnoma);
 *   driver.delete_requested — haydovchi ilovada hisobini o'chirishni so'radi (direktorga so'rov, Sozlamalar).
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
  // Raqamsiz ts bo'lsa Number(ts)=NaN va NaN>... = false bo'lib tekshiruvdan o'tib ketardi — aniq rad etamiz
  const tsNum = Number(ts);
  if (!ts || !sig || !Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > 5 * 60_000) return NextResponse.json({ error: "STALE_OR_UNSIGNED" }, { status: 401 });
  const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return NextResponse.json({ error: "BAD_SIGNATURE" }, { status: 401 });

  // Replay: 5 daqiqalik oyna ichida AYNAN shu imzoli so'rovni qayta yuborib bo'lmaydi.
  // Imzo ts+body'ni qamraydi — bir xil imzo = bir xil hodisa. Xatoda (5xx) belgi olib tashlanadi,
  // shunda ECO'ning qonuniy qayta urinishi o'tadi.
  if (!claimSignature(sig, tsNum)) return NextResponse.json({ error: "REPLAY" }, { status: 409 });

  let p: EcoPayload;
  try { p = JSON.parse(body); } catch { return NextResponse.json({ error: "BAD_JSON" }, { status: 400 }); }

  try {
    if (p.event === "delivery.status_changed") return await onDelivery(p);
    if (p.event === "driver.changed") return await onDriver(p);
    if (p.event === "vehicle.changed") return await onVehicle(p);
    if (p.event === "customer.registered") return await onCustomer(p);
    if (p.event === "driver.delete_requested") return await onDeleteRequest(p);
    return NextResponse.json({ ok: true, ignored: true });
  } catch (e) {
    console.error("[eco][webhook]", p.event, e);
    seenSignatures.delete(sig);
    return NextResponse.json({ error: "APPLY_FAILED" }, { status: 500 });
  }
}

/**
 * Ko'rilgan imzolar (xotirada, ERP bitta jarayon). Kalit — imzo, qiymat — ts bilan birga
 * eskirish vaqti; oynadan chiqqan yozuvlar tozalanadi (eski ts baribir STALE bo'lib rad etiladi).
 */
const REPLAY_WINDOW_MS = 5 * 60_000;
const SEEN_MAX = 10_000;
const seenSignatures = new Map<string, number>();

function claimSignature(sig: string, ts: number): boolean {
  const now = Date.now();
  if (seenSignatures.size >= SEEN_MAX / 2) for (const [k, exp] of seenSignatures) if (exp <= now) seenSignatures.delete(k);
  const exp = seenSignatures.get(sig);
  if (exp !== undefined && exp > now) return false;
  // Juda ko'p (hujum) — eng eskilari chiqariladi (Map qo'shilish tartibini saqlaydi → LRU)
  while (seenSignatures.size >= SEEN_MAX) { const first = seenSignatures.keys().next().value; if (first === undefined) break; seenSignatures.delete(first); }
  // ts ± 5 daqiqa qabul qilinadi — shuning uchun belgi ts + 5 daqiqa + zaxira bilan saqlanadi
  seenSignatures.set(sig, Math.max(ts, now) + REPLAY_WINDOW_MS + 60_000);
  return true;
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

/** ERP mijozi ilovada hisob ochdi → sotuvchilarga xabar; mijoz kartasida "Ilova hisobi" yangilanadi. */
async function onCustomer(p: EcoPayload) {
  if (!p.externalRef || !p.phone) return NextResponse.json({ ok: true, ignored: true });
  const r = await applyEcoCustomerRegistered({ externalRef: p.externalRef, phone: p.phone, fullName: p.fullName ?? null });
  return NextResponse.json({ ok: true, applied: r.applied });
}

/** Haydovchi ilovada "Hisobni o'chirish" bosdi → direktorga so'rov; tasdiqlangach ERP ECO'da a'zolikni o'chiradi, ECO anonimlashtiradi. */
async function onDeleteRequest(p: EcoPayload) {
  if (!p.userId || !p.phone) return NextResponse.json({ ok: true, ignored: true });
  const r = await requestFromEco({ userId: p.userId, fullName: p.fullName ?? null, phone: p.phone });
  if (r.applied) revalidatePath("/settings");
  return NextResponse.json({ ok: true, applied: r.applied });
}

/** Tirikligini tekshirish. */
export function GET() {
  return NextResponse.json({ ok: true, configured: !!process.env.ECO_WEBHOOK_SECRET });
}
