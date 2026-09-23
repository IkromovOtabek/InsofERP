import { z } from "zod";
import { db } from "@/lib/db";
import type { MobileUser } from "./auth";
import { driverEmployeeId, ListError } from "./list";

/**
 * Haydovchi ilovasidan kelayotgan GPS nuqtalari.
 *
 * Ilova nuqtalarni lokal buferga yig'adi va to'p-to'p yuboradi (aloqa uzilsa yo'qolmasin),
 * shuning uchun bu yerga bir necha o'nlab nuqta birdan keladi va ular ORQADAGI vaqt bilan
 * bo'lishi mumkin — `at` qurilmadagi vaqt, `createdAt` esa serverga yetib kelgan payt.
 */

const Point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(300).optional(),
  heading: z.number().min(0).max(360).optional(),
  at: z.string().min(1),
});
const Batch = z.object({
  tripId: z.string().min(1),
  points: z.array(Point).min(1).max(200),
});

export type TrackResult = { ok: true; accepted: number };

/** Kuzatuv boshlangan va tugaydigan holatlar. PLANNED — hali yuklanmagan, CANCELLED — reys yo'q. */
const TRACKABLE = ["LOADED", "ON_ROAD", "DELIVERED"];

/**
 * Nuqtalarni qabul qilish.
 *
 * `DELIVERED` ham ro'yxatda: ilova kuzatuvni "Yetkazdim" bosilgandan KEYIN to'xtatadi va
 * qolgan buferni o'shanda yuboradi — aks holda yo'lning oxirgi qismi yo'qolardi.
 */
export async function recordTrack(user: MobileUser, body: unknown): Promise<TrackResult> {
  const p = Batch.safeParse(body);
  if (!p.success) throw new ListError("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri", 400);
  const { tripId, points } = p.data;

  const trip = await db.trip.findUnique({ where: { id: tripId }, select: { driverId: true, status: true } });
  if (!trip) throw new ListError("NOT_FOUND", "Reys topilmadi", 404);
  // Haydovchi faqat o'z reysining izini yubora oladi (`lib/mobile/actions.ts` dagi qoida bilan bir xil)
  if (user.role === "DRIVER" && trip.driverId !== (await driverEmployeeId(user.id))) {
    throw new ListError("FORBIDDEN", "Bu reys sizga biriktirilmagan", 403);
  }
  if (!TRACKABLE.includes(trip.status)) return { ok: true, accepted: 0 }; // kech kelgan nuqta — xato emas, shunchaki kerak emas

  const rows = points.map((x) => {
    const at = new Date(x.at);
    return { tripId, lat: x.lat, lng: x.lng, speedKmh: x.speedKmh, heading: x.heading, at: isNaN(at.getTime()) ? new Date() : at };
  });
  await db.tripPosition.createMany({ data: rows });
  return { ok: true, accepted: rows.length };
}
