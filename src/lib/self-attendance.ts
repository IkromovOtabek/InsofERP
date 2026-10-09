import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { haversineMeters } from "@/lib/geo";
import { hit } from "@/lib/rate-limit";
import { notifyAfter, notifyUsers } from "@/lib/notify";
import { getCompany } from "@/lib/company";
import { DEFAULT_SHIFT, MAX_SHIFT_MINUTES, dayUtc, hoursText, isoDay, markOf, monthDays, monthTitle, shiftDay, shiftMonth, toMinutes, today, validMonth, workedMinutes } from "@/lib/davomat";
import { lockEmployeeAttendance, nowHHMM, productionStaff } from "@/lib/production-staff";
import { knownPoint } from "@/lib/mobile/geofence";
import { type FaceInput, faceInput, faceVerifyAvailable, saveFacePhoto, verifyFaceRequest } from "@/lib/face-verify";
import { MAX_FACE_PHOTO_CHARS } from "@/lib/face-id-const";
import { removeEmployeeFile } from "@/lib/uploads";
import { ListError } from "@/lib/mobile/list";
import type { MobileUser } from "@/lib/mobile/auth";
import type { AttendanceStatus } from "@/generated/prisma";
import { notifyLateAfter } from "@/lib/attendance-late";

/**
 * Xodimning o'zi telefonidan davomat belgilashi — "Keldim" / "Ketdim" (mobil bosh sahifa kartasi).
 *
 * Oqim (ilovada): yangi GPS nuqta → ilova ichidagi yuz skaneri (old kamera, avtomatik kadr) →
 * `POST /api/mobile/attendance/self`. Server bu yerda hammasini qaytadan tekshiradi — ilovaga ishonilmaydi:
 *   · login xodim kartasiga bog'langanmi (`Employee.userId`);
 *   · nuqta zavod nuqtasidan (`CompanySettings.lat/lng`) `attendanceRadiusM` ichidami — nuqta sozlanmagan
 *     bo'lsa rad etiladi (jim qabul qilinmaydi);
 *   · GPS aniqligi, telefon soati, soxta joylashuv (Android mock) belgisi;
 *   · takror bosish — bir kun/bir tur uchun bitta yozuv (idempotent: ikkinchi bosish mavjud natijani qaytaradi);
 *     parallel ikki so'rov xodim bo'yicha qulf (`lockEmployeeAttendance`) ostida ketma-ket — faqat bittasi yozadi,
 *     ikkinchisining kadri diskda qolmaydi;
 *   · qayta yuborish: bir martalik challenge (`nonce`, `lib/face-replay.ts`; `MOBILE_FACE_NONCE_REQUIRED=true` da majburiy)
 *     va kadr xeshi (aynan o'sha kadr ikkinchi marta — rad);
 *   · jonlilik: challenge topshirig'i (bosh burish / ko'z yumish) va 3 kadr (`frames`, `lib/face-liveness.ts`;
 *     `MOBILE_FACE_LIVENESS_REQUIRED=true` da majburiy, aks holda eski bitta kadr ham qabul qilinadi);
 *   · so'rovlar soni cheklangan;
 *   · kadr xodimning profil surati bilan solishtiriladi (`lib/face-verify.ts`, rahbar skaneri bilan bir xil qoida) —
 *     mos kelsa kadr dalil sifatida saqlanadi (`facePhoto` / `checkOutPhoto`) va ishonch foizi yoziladi.
 *     Arzon tekshiruvlar (geofence, takror) AI chaqiruvidan OLDIN — keraksiz so'rov ketmasin.
 * Yozuv HR tabeli va sex davomatidagi aynan o'sha `Attendance` (employeeId + date) — alohida jadval yo'q.
 *
 * Qurilma id ham saqlanadi: xodim boshqa telefondan belgilasa `newDevice` bilan rahbarlarga aytiladi.
 */

export const SELF_SOURCE = "SELF_FACE";
/** Eski yozuvlar (1.0.3 gacha sinov: telefon Face ID / barmoq izi) — "o'zi belgilagan" deb hisoblanadi. */
export const SELF_SOURCE_LEGACY = "SELF_BIOMETRIC";
export const SELF_SOURCES = [SELF_SOURCE, SELF_SOURCE_LEGACY];
/** GPS aniqligi bundan yomon bo'lsa nuqtaga ishonilmaydi. */
export const MAX_ACCURACY_M = 150;
/** Telefon soati server soatidan shuncha farq qilsa — so'rov eskirgan yoki soat noto'g'ri. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

// ───────────────────────── Xodim va ish joyi ─────────────────────────

/** Login → xodim kartasi (`Employee.userId`, unique). Bo'shatilgan / nofaol xodim — yo'q. */
export async function linkedEmployee(userId: string) {
  return db.employee.findFirst({
    where: { userId, isActive: true, firedAt: null },
    select: { id: true, fullName: true, position: true, workSchedule: true, brigadeId: true, brigade: { select: { leader: { select: { userId: true } } } } },
  });
}
type LinkedEmployee = NonNullable<Awaited<ReturnType<typeof linkedEmployee>>>;

/** Ish joyi: zavod nuqtasi (Sozlamalar → "Zavod joyi") va radius (Sozlamalar → "Davomat radiusi"). */
export async function workplace() {
  const c = await getCompany();
  const point = knownPoint(c.lat, c.lng);
  const radiusM = Math.max(50, Math.min(5000, c.attendanceRadiusM || 300));
  return point ? { ...point, radiusM } : null;
}

const HHMM_RE = /([01]?\d|2[0-3])[:.]([0-5]\d)/g;
/**
 * Smena vaqti: xodim kartasidagi "Ish grafigi" ("08:00–20:00, 2/2") dagi birinchi va ikkinchi soat,
 * bo'lmasa zavod standarti (`DEFAULT_SHIFT`, "Hammasi keldi" tugmasi ham shuni qo'yadi).
 */
export function shiftOf(workSchedule: string | null | undefined): { start: string; end: string } {
  const m = [...(workSchedule ?? "").matchAll(HHMM_RE)].map((x) => `${x[1]!.padStart(2, "0")}:${x[2]}`);
  return { start: m[0] ?? DEFAULT_SHIFT.checkIn, end: m[1] ?? DEFAULT_SHIFT.checkOut };
}

/** Kechikish (daqiqa) — smena boshidan keyin kelgan bo'lsa; 8 soatdan ortiq farq — boshqa smena, hisoblanmaydi. */
export function lateBy(checkIn: string | null | undefined, start: string): number | null {
  const a = toMinutes(checkIn), s = toMinutes(start);
  if (a === null || s === null) return null;
  const d = a - s;
  return d > 0 && d < 8 * 60 ? d : null;
}

/** Erta ketish (daqiqa) — smena tugashidan oldin ketgan bo'lsa. */
export function earlyBy(checkOut: string | null | undefined, end: string): number | null {
  const a = toMinutes(checkOut), e = toMinutes(end);
  if (a === null || e === null) return null;
  const d = e - a;
  return d > 0 && d < 8 * 60 ? d : null;
}

/** "Karimov Aziz Bahodirovich" → "Aziz K." (familiya birinchi yoziladi). */
export function shortName(fullName: string) {
  const p = fullName.trim().split(/\s+/);
  return p.length >= 2 ? `${p[1]} ${p[0]![0]}.` : fullName.trim();
}

// ───────────────────────── Bugungi holat ─────────────────────────

export type SelfAttendance = {
  /** Login xodim kartasiga bog'langanmi. false — karta ko'rsatilmaydi (yoki "HR'ga murojaat qiling"). */
  linked: boolean;
  date: string;
  /** none — bugun belgi yo'q; in — keldi (ketmagan); out — ketdi; other — kasal/ta'til/dam/kelmadi. */
  state: "none" | "in" | "out" | "other";
  /** Kartadagi asosiy matn: "Bugun: kelmadingiz", "Keldingiz 08:12", "Ketdingiz 18:05". */
  label: string;
  /** Qo'shimcha: "12 daq kechikdingiz", "8,5 soat ishladingiz", "Kasal". */
  hint: string | null;
  checkIn: string | null;
  checkOut: string | null;
  lateMin: number | null;
  /** Tugma: "in" — Keldim, "out" — Ketdim, null — bugun boshqa amal yo'q. */
  next: "in" | "out" | null;
  shift: { start: string; end: string };
  /** Ish joyi sozlanmagan bo'lsa null — ilova tugmani bosishdan oldin ogohlantiradi. */
  workplace: { lat: number; lng: number; radiusM: number } | null;
};

type Row = { date: Date; status: AttendanceStatus; checkIn: string | null; checkOut: string | null };

/** Ochiq (ketilmagan) yozuv: bugungi, bo'lmasa kechagi tungi smena (16 soatdan oshmagan). */
export async function openRecord(employeeId: string, iso: string) {
  const [t, y] = await Promise.all([
    db.attendance.findUnique({ where: { employeeId_date: { employeeId, date: dayUtc(iso) } } }),
    db.attendance.findUnique({ where: { employeeId_date: { employeeId, date: dayUtc(shiftDay(iso, -1)) } } }),
  ]);
  return { today: t, yesterday: y };
}

/** Kecha kelgan, hali ketmagan va hozir 16 soatdan oshmagan — tungi smena: "Ketdim" kechagi yozuvga tushadi. */
export function nightOpen(y: Row | null, now: string) {
  if (!y || y.status !== "PRESENT" || !y.checkIn || y.checkOut) return false;
  const w = workedMinutes(y.checkIn, now);
  const a = toMinutes(y.checkIn), b = toMinutes(now);
  return w !== null && a !== null && b !== null && b < a && w <= MAX_SHIFT_MINUTES;
}

function statusOf(e: LinkedEmployee, iso: string, t: Row | null, y: Row | null, wp: SelfAttendance["workplace"]): SelfAttendance {
  const shift = shiftOf(e.workSchedule);
  const base = { linked: true, date: iso, shift, workplace: wp };
  if (!t && nightOpen(y, nowHHMM())) {
    return { ...base, state: "in", label: `Keldingiz ${y!.checkIn} (kecha)`, hint: "Tungi smena — ketishda «Ketdim» ni bosing", checkIn: y!.checkIn, checkOut: null, lateMin: null, next: "out" };
  }
  if (!t) return { ...base, state: "none", label: "Bugun: kelmadingiz", hint: `Smena ${shift.start} da boshlanadi`, checkIn: null, checkOut: null, lateMin: null, next: "in" };
  if (t.status !== "PRESENT") {
    // Kelmadi deb belgilangan bo'lsa ham xodim kelib "Keldim" bosa oladi — joyida ekani tekshiriladi
    const mk = markOf(t.status);
    return { ...base, state: "other", label: `Bugun: ${mk.label.toLowerCase()}`, hint: t.status === "ABSENT" ? "Ishdasiz? «Keldim» ni bosing" : null, checkIn: null, checkOut: null, lateMin: null, next: t.status === "ABSENT" ? "in" : null };
  }
  const late = lateBy(t.checkIn, shift.start);
  if (t.checkOut) {
    const w = workedMinutes(t.checkIn, t.checkOut);
    return { ...base, state: "out", label: `Ketdingiz ${t.checkOut}`, hint: `Keldingiz ${t.checkIn ?? "—"}${w !== null ? ` · ${hoursText(w)}` : ""}`, checkIn: t.checkIn, checkOut: t.checkOut, lateMin: late, next: null };
  }
  return { ...base, state: "in", label: `Keldingiz ${t.checkIn ?? ""}`.trim(), hint: late ? `${late} daq kechikdingiz` : "O'z vaqtida", checkIn: t.checkIn, checkOut: null, lateMin: late, next: "out" };
}

/** Bosh sahifa kartasi uchun. Login xodimga bog'lanmagan bo'lsa null (karta chiqmaydi). */
export async function selfAttendance(user: Pick<MobileUser, "id">): Promise<SelfAttendance | null> {
  const e = await linkedEmployee(user.id);
  if (!e) return null;
  const iso = today();
  const [{ today: t, yesterday: y }, wp] = await Promise.all([openRecord(e.id, iso), workplace()]);
  return statusOf(e, iso, t, y, wp);
}

// ───────────────────────── Belgilash ─────────────────────────

const Body = z.object({
  kind: z.enum(["in", "out"]),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  /** Yuz skaneri kadri: `data:image/jpeg;base64,...` — Face ID namunasi (yo'q bo'lsa profil surati) bilan solishtiriladi. */
  photo: z.string({ message: "Yuzingizni skaner qiling" }).min(100, "Yuzingizni skaner qiling").max(MAX_FACE_PHOTO_CHARS, "Kadr juda katta — qayta skaner qiling").optional(),
  /**
   * Jonlilik ketma-ketligi (yangi ilova): 3 kadr data-URL — [0] topshiriqdan oldin, [1]–[2] topshiriq paytida
   * (`lib/face-liveness.ts`). Kelsa `photo` o'rniga shu tekshiriladi; hajm chegaralari `faceInput` da.
   */
  frames: z.array(z.string({ message: "Kadr o'qilmadi — qayta skaner qiling" })).max(10, "Kadrlar soni noto'g'ri").optional(),
  /** Bir martalik challenge (`GET /api/mobile/attendance/challenge`). Eski ilovada yo'q. */
  nonce: z.string().max(100).optional(),
  deviceId: z.string().trim().min(8, "Qurilma aniqlanmadi").max(128),
  /** Ilova bosilgan vaqt (ISO). Server o'z soatini yozadi, bu faqat eskirgan/qayta yuborilgan so'rovni ushlash uchun. */
  at: z.string().trim().max(40).refine((v) => Number.isFinite(Date.parse(v)), "Vaqt noto'g'ri"),
  /** Android "soxta joylashuv" (mock) belgisi. */
  mocked: z.boolean().optional(),
});

export type SelfMarkResult = { ok: true; already: boolean; message: string; attendance: SelfAttendance };

const fail = (code: string, message: string, status = 400): never => { throw new ListError(code, message, status); };
const meters = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

export async function markSelfAttendance(user: MobileUser, raw: unknown): Promise<SelfMarkResult> {
  // Cheklov: daqiqasiga 6, soatiga 30 — tugmani qayta-qayta bosish va skript bilan urinishga qarshi
  if (!hit(`att-self:m:${user.id}`, 6, 60_000) || !hit(`att-self:h:${user.id}`, 30, 3_600_000)) {
    fail("RATE_LIMITED", "Juda ko'p urinish. Bir daqiqadan keyin qayta urinib ko'ring", 429);
  }
  // 1.0.3 sinov build'i (telefon Face ID, kadrsiz) — endi qabul qilinmaydi
  const r0 = (raw ?? {}) as { biometric?: unknown; photo?: unknown; frames?: unknown };
  if (r0.biometric === true && !r0.photo && !r0.frames) fail("APP_OUTDATED", "Ilovani yangilang — davomat endi ilova ichidagi yuz skaneri orqali belgilanadi", 400);
  const p = Body.safeParse(raw);
  if (!p.success) fail("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri");
  const b = p.data!;
  const fi = faceInput(b);
  if ("error" in fi) fail("BAD_REQUEST", fi.missing ? "Yuzingizni skaner qiling" : fi.error);
  const input = (fi as { input: FaceInput }).input;

  const e = await linkedEmployee(user.id);
  if (!e) fail("NOT_LINKED", "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling", 403);
  const emp = e!;
  // Yuz tekshiruvi: ERP'da Face ID ro'yxatga olingan bo'lsa — shu namuna, bo'lmasa AI kaliti bilan profil surati
  if (!(await faceVerifyAvailable(emp.id))) {
    fail("FACE_DISABLED", "Yuzingiz Face ID'da ro'yxatga olinmagan — otdel kadrga ayting: ERP → Davomat bo'limida ro'yxatga olsin", 409);
  }

  if (Math.abs(Date.now() - Date.parse(b.at)) > MAX_CLOCK_SKEW_MS) {
    fail("CLOCK_SKEW", "Telefon soati noto'g'ri yoki so'rov eskirgan — soatni avtomatik qilib qayta urining");
  }
  if (b.mocked) fail("MOCK_LOCATION", "Soxta joylashuv (mock GPS) yoqilgan — o'chirib qayta urining", 403);

  const wp = await workplace();
  if (!wp) fail("NO_WORKPLACE", "Ish joyi koordinatasi sozlanmagan — administratorga murojaat qiling", 409);
  const place = wp!;
  if (b.accuracy != null && b.accuracy > MAX_ACCURACY_M) {
    fail("POOR_ACCURACY", `GPS aniqligi past (±${Math.round(b.accuracy)} m). Ochiq joyga chiqib qayta urining`);
  }
  const distance = haversineMeters(b.lat, b.lng, place.lat, place.lng);
  if (!Number.isFinite(distance)) fail("BAD_REQUEST", "Joylashuv noto'g'ri");
  if (distance > place.radiusM) {
    fail("OUT_OF_RANGE", `Siz ish joyidan ${meters(distance)} uzoqdasiz (ruxsat: ${place.radiusM} m). Ish joyiga kelib qayta urining`, 403);
  }

  const iso = today();
  const now = nowHHMM();
  const { today: t, yesterday: y } = await openRecord(emp.id, iso);

  // Qurilma: xodim avval boshqa telefondan belgilagan bo'lsa — "yangi qurilma" (rahbarga aytiladi)
  const prior = await db.attendance.findMany({
    where: { employeeId: emp.id, source: { in: SELF_SOURCES }, OR: [{ checkInDeviceId: { not: null } }, { checkOutDeviceId: { not: null } }] },
    orderBy: { date: "desc" }, take: 30, select: { checkInDeviceId: true, checkOutDeviceId: true },
  });
  const known = prior.some((r) => r.checkInDeviceId === b.deviceId || r.checkOutDeviceId === b.deviceId);
  const newDevice = prior.length > 0 && !known;
  const shift = shiftOf(emp.workSchedule);
  const geo = (k: "In" | "Out") => ({
    [`check${k}Lat`]: b.lat, [`check${k}Lng`]: b.lng, [`check${k}Accuracy`]: b.accuracy ?? null,
    [`check${k}Distance`]: Math.round(distance), [`check${k}DeviceId`]: b.deviceId,
  });
  /**
   * Yuz: avval bir martalik challenge (yuborilgan bo'lsa), keyin kadr ERP'dagi Face ID namunasi bilan (yo'q bo'lsa —
   * profil surati bilan) solishtiriladi (`lib/face-verify.ts`); mos kelsa kadr metadata'siz (EXIF/GPS) qayta kodlanib
   * dalil sifatida saqlanadi (rahbar skaneri kabi). Mos kelmasa hech narsa yozilmaydi — faqat auditda urinish qoladi.
   * Jonlilik ketma-ketligi (`frames`) bo'lsa — topshiriq ham tekshiriladi, saqlanadigan kadr — birinchisi
   * (`verifyFaceRequest`); bajarilmagan topshiriq o'lchovlari auditga yoziladi (chegarani moslash uchun).
   */
  const face = async () => {
    const v = await verifyFaceRequest(emp.id, "Sizning", input, b.nonce, { userId: user.id });
    if (!v.ok) {
      if (v.mismatch || v.code === "LIVENESS_FAILED") {
        await audit(db, user.id, "UPDATE", "Attendance", emp.id, undefined, { xodim: emp.fullName, ozi: true, yuz: v.mismatch ? "tasdiqlanmadi" : "jonlilik o'tmadi", ishonch: v.confidence, sabab: v.reason });
      }
      fail(v.code, v.error, v.status);
    }
    const ok = v as Extract<typeof v, { ok: true }>;
    const saved = await saveFacePhoto(emp.id, ok.photo);
    if ("error" in saved) fail("FACE_ERROR", saved.error, 500);
    return { stored: (saved as { stored: string }).stored, confidence: ok.confidence, liveness: ok.liveness };
  };
  /** Qulf ostidagi yozuv yiqilsa yoki yozilmasa — saqlangan kadr diskda yetim qolmasin. */
  const dropOnFail = <T,>(stored: string, p: Promise<T>) => p.catch(async (err) => { await removeEmployeeFile(stored); throw err; });
  const auditMeta = { usul: "yuz", masofa: Math.round(distance), aniqlik: b.accuracy ?? null, qurilma: b.deviceId, yangiQurilma: newDevice };

  let text: string;
  if (b.kind === "in") {
    if (t?.status === "PRESENT" && t.checkIn) {
      const s = statusOf(emp, iso, t, y, place);
      return { ok: true, already: true, message: `Bugun allaqachon ${t.checkIn} da kelgansiz`, attendance: s };
    }
    if (t && t.status !== "PRESENT" && t.status !== "ABSENT") {
      fail("MARKED_OTHER", `Bugun «${markOf(t.status).label}» deb belgilangan — o'zgartirish uchun otdel kadrga ayting`, 409);
    }
    const f = await face();
    const late = lateBy(now, shift.start);
    const data = {
      status: "PRESENT" as const, checkIn: now, checkOut: null, markedById: user.id, source: SELF_SOURCE, lateMinutes: late, newDevice, ...geo("In"),
      facePhoto: f.stored, faceVerifiedAt: new Date(), faceConfidence: f.confidence,
    };
    const date = dayUtc(iso);
    // Parallel ikkinchi "Keldim" shu qulfda kutadi va birinchisining yozuvini ko'radi — yozmaydi
    const cur = await dropOnFail(f.stored, db.$transaction(async (tx) => {
      await lockEmployeeAttendance(tx, emp.id);
      const c = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date } }, select: { status: true, checkIn: true } });
      if (c && (c.status === "PRESENT" ? !!c.checkIn : c.status !== "ABSENT")) return c;
      const a = await tx.attendance.upsert({ where: { employeeId_date: { employeeId: emp.id, date } }, create: { employeeId: emp.id, date, ...data }, update: data });
      await audit(tx, user.id, "UPDATE", "Attendance", a.id, c ? { status: c.status, checkIn: c.checkIn } : undefined, { xodim: emp.fullName, keldi: now, ozi: true, ishonch: f.confidence, jonlilik: f.liveness, ...auditMeta });
      return null;
    }));
    if (cur) {
      await removeEmployeeFile(f.stored);
      if (cur.status !== "PRESENT") fail("MARKED_OTHER", `Bugun «${markOf(cur.status).label}» deb belgilangan — o'zgartirish uchun otdel kadrga ayting`, 409);
      const fresh = await openRecord(emp.id, iso);
      return { ok: true, already: true, message: `Bugun allaqachon ${cur.checkIn} da kelgansiz`, attendance: statusOf(emp, iso, fresh.today, fresh.yesterday, place) };
    }
    // Kechikkan bo'lsa — HR va direktorga alohida xabar (xodim/kun bo'yicha bir marta)
    notifyLateAfter(user.id, { employeeId: emp.id, checkIn: now, lateMinutes: late, iso });
    text = `${shortName(emp.fullName)} ${now} da keldi${late ? ` (${late} daq kechikdi)` : ""}${newDevice ? " · yangi telefondan" : ""}`;
  } else {
    // Ketish: bugungi ochiq yozuv, bo'lmasa kechagi tungi smena
    const rec = t?.status === "PRESENT" && t.checkIn ? t : !t && nightOpen(y, now) ? y : null;
    if (!rec) {
      if (t?.status === "PRESENT" && !t.checkIn) fail("NO_CHECKIN", "Kelgan vaqtingiz yozilmagan — sex boshlig'iga ayting");
      fail("NO_CHECKIN", "Avval «Keldim» ni bosing — bugun kelganingiz belgilanmagan", 409);
    }
    const r = rec!;
    if (r.checkOut) {
      const s = statusOf(emp, iso, t, y, place);
      return { ok: true, already: true, message: `Bugun allaqachon ${r.checkOut} da ketgansiz`, attendance: s };
    }
    const w = workedMinutes(r.checkIn, now);
    if (w !== null && w > MAX_SHIFT_MINUTES) fail("SHIFT_TOO_LONG", `Smena ${MAX_SHIFT_MINUTES / 60} soatdan uzun bo'lib qoldi — ketish vaqtini sex boshlig'i qo'yadi`, 409);
    const f = await face();
    const data = { checkOut: now, ...geo("Out"), checkOutPhoto: f.stored, checkOutFaceConfidence: f.confidence, ...(newDevice ? { newDevice: true } : {}) };
    const doneAt = await dropOnFail(f.stored, db.$transaction(async (tx) => {
      await lockEmployeeAttendance(tx, emp.id);
      const c = await tx.attendance.findUnique({ where: { id: r.id }, select: { checkOut: true } });
      if (c?.checkOut) return c.checkOut;
      await tx.attendance.update({ where: { id: r.id }, data });
      await audit(tx, user.id, "UPDATE", "Attendance", r.id, { checkOut: null }, { xodim: emp.fullName, ketdi: now, ozi: true, ishonch: f.confidence, jonlilik: f.liveness, ...auditMeta });
      return null;
    }));
    if (doneAt) {
      await removeEmployeeFile(f.stored);
      const fresh = await openRecord(emp.id, iso);
      return { ok: true, already: true, message: `Bugun allaqachon ${doneAt} da ketgansiz`, attendance: statusOf(emp, iso, fresh.today, fresh.yesterday, place) };
    }
    const early = earlyBy(now, shift.end);
    text = `${shortName(emp.fullName)} ${now} da ketdi${w !== null ? ` (${hoursText(w)}${early ? `, ${early} daq erta` : ""})` : ""}${newDevice ? " · yangi telefondan" : ""}`;
  }

  notifyAfter(() => notifyStaff(user.id, emp, text));
  const fresh = await openRecord(emp.id, iso);
  const s = statusOf(emp, iso, fresh.today, fresh.yesterday, place);
  return { ok: true, already: false, message: b.kind === "in" ? `Qabul qilindi: keldingiz ${now}` : `Qabul qilindi: ketdingiz ${now}`, attendance: s };
}

/**
 * Kelish/ketish vaqti tegishli rahbarlarga: brigadiri, ishlab chiqarish boshlig'i va ish boshqaruvchi (sex xodimi
 * bo'lsa), otdel kadr. Xodimning o'ziga yuborilmaydi. Ovozsiz kanal — ma'lumot uchun.
 */
async function notifyStaff(selfUserId: string, e: LinkedEmployee, body: string) {
  const inSex = (await productionStaff()).members.some((m) => m.id === e.id);
  const [prodUsers, hrUsers] = await Promise.all([
    inSex ? db.user.findMany({ where: { role: { in: ["PRODUCTION", "SUPERVISOR"] }, isActive: true }, select: { id: true } }) : Promise.resolve([]),
    db.user.findMany({ where: { role: "HR", isActive: true }, select: { id: true } }),
  ]);
  const not = (id: string | null | undefined) => !!id && id !== selfUserId;
  const sexIds = [e.brigade?.leader?.userId, ...prodUsers.map((u) => u.id)].filter(not);
  const hrIds = hrUsers.map((u) => u.id).filter((id) => not(id) && !sexIds.includes(id));
  const n = { type: "ATTENDANCE_SELF", title: "Davomat", body, channel: "oddiy" as const };
  // Sex rahbarlari xodimning sex kartochkasini ochadi; otdel kadr — xodim kartasini
  await Promise.all([
    sexIds.length ? notifyUsers(sexIds, { ...n, link: { key: "sex-emp", id: e.id } }) : null,
    hrIds.length ? notifyUsers(hrIds, { ...n, link: { key: "employees", id: e.id } }) : null,
  ]);
}

// ───────────────────────── Mening davomatim (oy) ─────────────────────────

export type MyAttendanceDay = {
  date: string; day: number; weekday: string; weekend: boolean;
  status: AttendanceStatus | null; mark: string | null;
  checkIn: string | null; checkOut: string | null;
  minutes: number | null; lateMin: number | null; self: boolean;
};
export type MyAttendanceMonth = {
  month: string; title: string; prev: string; next: string | null;
  employee: { fullName: string; position: string };
  shift: { start: string; end: string };
  totals: { present: number; absent: number; sick: number; leave: number; dayoff: number; minutes: number; lateDays: number; lateMinutes: number };
  days: MyAttendanceDay[];
};

const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];

/** Xodimning o'z oylik davomati — faqat O'ZINIKI (id so'ralmaydi, login bo'yicha). */
export async function myAttendanceMonth(user: Pick<MobileUser, "id">, rawMonth?: string | null): Promise<{ today: SelfAttendance; month: MyAttendanceMonth }> {
  const e = await linkedEmployee(user.id);
  if (!e) fail("NOT_LINKED", "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling", 403);
  const emp = e!;
  const cur = today().slice(0, 7);
  const month = validMonth(rawMonth ?? undefined) && rawMonth! <= cur ? rawMonth! : cur;
  const days = monthDays(month);
  const rows = await db.attendance.findMany({
    where: { employeeId: emp.id, date: { gte: dayUtc(days[0]!.iso), lte: dayUtc(days[days.length - 1]!.iso) } },
    select: { date: true, status: true, checkIn: true, checkOut: true, source: true },
  });
  const by = new Map(rows.map((r) => [isoDay(r.date), r]));
  const shift = shiftOf(emp.workSchedule);
  const iso = today();
  const out: MyAttendanceDay[] = days.filter((d) => d.iso <= iso).reverse().map((d) => {
    const r = by.get(d.iso);
    const present = r?.status === "PRESENT";
    return {
      date: d.iso, day: d.day, weekday: WD[dayUtc(d.iso).getUTCDay()]!, weekend: d.weekend,
      status: r?.status ?? null, mark: r ? markOf(r.status).label : null,
      checkIn: present ? r!.checkIn : null, checkOut: present ? r!.checkOut : null,
      minutes: present ? workedMinutes(r!.checkIn, r!.checkOut) : null,
      lateMin: present ? lateBy(r!.checkIn, shift.start) : null,
      self: !!r?.source && SELF_SOURCES.includes(r.source),
    };
  });
  const cnt = (s: AttendanceStatus) => out.filter((d) => d.status === s).length;
  const late = out.filter((d) => d.lateMin);
  const { today: t, yesterday: y } = await openRecord(emp.id, iso);
  return {
    today: statusOf(emp, iso, t, y, await workplace()),
    month: {
      month, title: monthTitle(month), prev: shiftMonth(month, -1), next: month < cur ? shiftMonth(month, 1) : null,
      employee: { fullName: emp.fullName, position: emp.position }, shift,
      totals: {
        present: cnt("PRESENT"), absent: cnt("ABSENT"), sick: cnt("SICK"), leave: cnt("LEAVE"), dayoff: cnt("DAYOFF"),
        minutes: out.reduce((s, d) => s + (d.minutes ?? 0), 0),
        lateDays: late.length, lateMinutes: late.reduce((s, d) => s + (d.lateMin ?? 0), 0),
      },
      days: out,
    },
  };
}
