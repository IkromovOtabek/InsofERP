import { z } from "zod";
import { db } from "@/lib/db";
import { notifyLateAfter } from "@/lib/attendance-late";
import { audit } from "@/lib/audit";
import { hit } from "@/lib/rate-limit";
import { canDo } from "@/lib/permissions";
import { faceImage } from "@/lib/ai/face";
import { removeEmployeeFile, saveEmployeeFile } from "@/lib/uploads";
import { MAX_SHIFT_MINUTES, dayUtc, hoursText, markOf, toMinutes, today, workedMinutes } from "@/lib/davomat";
import { nowHHMM, productionStaff } from "@/lib/production-staff";
import { earlyBy, lateBy, nightOpen, openRecord, shiftOf } from "@/lib/self-attendance";
import {
  AUTO_OUT_AFTER_MIN, ENROLL_MAX_SAMPLES, ENROLL_MIN_SAMPLES, FACE_DIM, SCAN_PROBES, SNAPSHOT_MAX_CHARS,
  type FaceScanFail, type FaceScanResult,
} from "@/lib/face-id-const";
import type { Session } from "@/lib/auth";

/**
 * Davomat — ERP'ning o'z Face ID skaneri (Bosh sahifa → «Davomat»). Telefonning Face ID'si emas:
 * kamera kadridagi yuzni brauzerdagi neyron tarmoq (face-api: yuz topish → 68 nuqta → ResNet-34) 128 sonli
 * vektorga aylantiradi, server esa uni ro'yxatga olingan xodimlar namunalari bilan solishtiradi.
 *
 * Kim ishlatadi — xodimlarga mas'ul lavozimlar:
 *   · otdel kadr va direktor (yoki direktor `employees → edit` bergan) — hamma xodim, yuzni ro'yxatga oladi;
 *   · ishlab chiqarish boshlig'i / ish boshqaruvchi (`production → report`) — faqat sex xodimlari, ro'yxatga olmaydi.
 *
 * Xavfsizlik:
 *   · namunalar (vektorlar) brauzerga hech qachon qaytarilmaydi — solishtirish faqat shu yerda; skaner faqat
 *     "kim ekan" degan javobni oladi, xodim id'sini o'zi tanlay olmaydi;
 *   · bir urinishda bir nechta ketma-ket kadr vektori keladi, o'rtacha masofa olinadi; eng yaqin ikki xodim
 *     bir-biriga juda yaqin bo'lsa ("aniq emas") — hech narsa yozilmaydi;
 *   · jonlilik (ko'z yumib ochish) skanerda tekshiriladi — chop etilgan surat bilan o'tib bo'lmaydi;
 *     yozilgan har bir belgining kadri saqlanadi (otdel kadr keyin ko'radi);
 *   · ro'yxatga olishda yuz boshqa xodim kartasidagi yuzga mos kelsa rad etiladi (bir odam — ikki karta).
 *
 * Yozuv — HR tabeli va sex davomatidagi aynan o'sha `Attendance` (employeeId + date), manba `FACE_ID`.
 */

export const FACE_SOURCE = "FACE_ID";

/**
 * Bir odam deb qabul qilinadigan eng katta o'rtacha masofa (Evklid). face-api vektorlarida bir odamning
 * turli kadrlari odatda 0,3–0,45, boshqa odamlar 0,6 dan yuqori bo'ladi; 0,6 — kutubxona standarti,
 * davomat uchun qattiqroq olingan (begonani "tanib" qo'yishdan ko'ra qayta skaner qildirgan yaxshi).
 */
export const MATCH_MAX_DISTANCE = 0.48;
/** Eng yaqin va ikkinchi xodim orasidagi eng kichik farq — kamroq bo'lsa "aniq emas" (o'xshash odamlar). */
export const MATCH_MIN_MARGIN = 0.06;
/** Ro'yxatga olishda boshqa xodimning yuziga shuncha yaqin bo'lsa — bir odam ikki kartada, rad etiladi. */
export const DUPLICATE_DISTANCE = 0.42;
/** Ro'yxatga olish namunalari o'zaro shundan uzoq bo'lmasin — kadrga boshqa odam kirib qolmagan. */
const ENROLL_SELF_MAX = 0.62;

// ───────────────────────── Ruxsat ─────────────────────────

export type FaceScope = "all" | "sex";

/** Skanerdan kim foydalanadi: "all" — hamma xodim (otdel kadr, direktor), "sex" — sex boshliqlari, null — hech kim. */
export function faceScope(s: Pick<Session, "role" | "perms">): FaceScope | null {
  if (canDo(s, "employees", "edit", ["HR"])) return "all";
  if (canDo(s, "production", "report")) return "sex";
  return null;
}

/** Yuzni ro'yxatga olish / o'chirish — biometrik ma'lumot, faqat otdel kadr darajasi. */
export const canEnrollFaces = (s: Pick<Session, "role" | "perms">) => faceScope(s) === "all";

// ───────────────────────── Vektor ─────────────────────────

const Descriptor = z.array(z.number().finite().min(-2).max(2)).length(FACE_DIM, "Yuz vektori noto'g'ri");
const Snapshot = z.string().max(SNAPSHOT_MAX_CHARS, "Kadr juda katta").regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/, "Kadr JPEG bo'lishi kerak");

export function distance(a: readonly number[], b: readonly number[]) {
  let s = 0;
  for (let i = 0; i < FACE_DIM; i++) { const d = a[i]! - b[i]!; s += d * d; }
  return Math.sqrt(s);
}

/** Masofa → ko'rsatish uchun o'xshashlik foizi (logistik egri: 0,3 ≈ 95%, chegara 0,48 ≈ 70%). */
export const similarity = (d: number) => Math.round(100 / (1 + Math.exp((d - 0.55) * 12)));

type Candidate = { employeeId: string; descriptors: number[][] };

/** Faol (bo'shatilmagan) xodimlarning namunalari, xodim bo'yicha guruhlangan. */
async function candidates(excludeEmployeeId?: string): Promise<Candidate[]> {
  const rows = await db.faceTemplate.findMany({
    where: { employee: { isActive: true, firedAt: null }, ...(excludeEmployeeId ? { employeeId: { not: excludeEmployeeId } } : {}) },
    select: { employeeId: true, descriptor: true },
  });
  const by = new Map<string, number[][]>();
  for (const r of rows) if (r.descriptor.length === FACE_DIM) by.set(r.employeeId, [...(by.get(r.employeeId) ?? []), r.descriptor]);
  return [...by].map(([employeeId, descriptors]) => ({ employeeId, descriptors }));
}

/** Har xodim uchun: har kadr vektoriga eng yaqin namunasi, kadrlar bo'yicha o'rtacha. O'sish tartibida. */
function rank(probes: number[][], list: Candidate[]) {
  return list
    .map((c) => ({
      employeeId: c.employeeId,
      d: probes.reduce((sum, p) => sum + Math.min(...c.descriptors.map((t) => distance(p, t))), 0) / probes.length,
    }))
    .sort((a, b) => a.d - b.d);
}

type Match =
  | { kind: "empty" }
  | { kind: "none"; best: number | null }
  | { kind: "ambiguous"; ids: [string, string]; d: number }
  | { kind: "match"; employeeId: string; d: number; second: number | null };

export async function matchFace(probes: number[][]): Promise<Match> {
  const list = await candidates();
  if (!list.length) return { kind: "empty" };
  const [a, b] = rank(probes, list);
  if (!a || a.d > MATCH_MAX_DISTANCE) return { kind: "none", best: a?.d ?? null };
  if (b && b.d - a.d < MATCH_MIN_MARGIN) return { kind: "ambiguous", ids: [a.employeeId, b.employeeId], d: a.d };
  return { kind: "match", employeeId: a.employeeId, d: a.d, second: b?.d ?? null };
}

/** data-URL → tekshirilgan, qayta kodlangan JPEG fayli (sharp: faqat JPEG/PNG/WEBP, metadata tashlanadi). */
async function snapshotFile(dataUrl: string): Promise<File> {
  const raw = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const img = await faceImage(raw);
  return new File([new Uint8Array(Buffer.from(img.base64, "base64"))], "yuz.jpg", { type: "image/jpeg" });
}

async function saveSnapshot(employeeId: string, dataUrl: string): Promise<string | null> {
  try {
    const saved = await saveEmployeeFile(employeeId, await snapshotFile(dataUrl), { imageOnly: true });
    return saved && !("error" in saved) ? saved.stored : null;
  } catch (e) {
    // Kadr saqlanmasa ham davomat yoziladi — u faqat dalil; sababi server logida
    console.error("[face-id] kadr saqlanmadi:", (e as Error).message);
    return null;
  }
}

// ───────────────────────── Skaner: kim keldi / ketdi ─────────────────────────

const ScanBody = z.object({
  probes: z.array(Descriptor).min(1).max(SCAN_PROBES + 2),
  photo: Snapshot,
  mode: z.enum(["auto", "in", "out"]),
});

const fail = (code: FaceScanFail["code"], error: string, employee?: FaceScanFail["employee"]): FaceScanFail => ({ ok: false, code, error, ...(employee ? { employee } : {}) });

/**
 * Kelgandan beri o'tgan daqiqa. `workedMinutes` teng vaqtni (08:12 → 08:12) tungi smena deb 24 soat hisoblaydi —
 * skaner oldida bir daqiqada qayta turish odatiy, shuning uchun bugungi yozuvda oddiy ayirma; kechagisida — tungi smena.
 */
function sinceCheckIn(checkIn: string | null, now: string, sameDay: boolean): number | null {
  if (!sameDay) return workedMinutes(checkIn, now);
  const a = toMinutes(checkIn), b = toMinutes(now);
  return a === null || b === null ? null : Math.max(0, b - a);
}

export async function scanFace(s: Session, raw: unknown): Promise<FaceScanResult> {
  const scope = faceScope(s);
  if (!scope) return fail("FORBIDDEN", "Davomat skaneri sizning lavozimingiz uchun ochilmagan");
  // Navbatda turgan 30–40 kishi bir daqiqada o'tadi; skript bilan urinishga qarshi chegara
  if (!hit(`face-scan:${s.userId}`, 60, 60_000)) return fail("RATE_LIMITED", "Juda ko'p urinish — bir daqiqadan keyin davom eting");
  const p = ScanBody.safeParse(raw);
  if (!p.success) return fail("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri");
  const { probes, photo, mode } = p.data;

  const m = await matchFace(probes);
  if (m.kind === "empty") return fail("NO_TEMPLATES", "Hali hech kimning yuzi ro'yxatga olinmagan — otdel kadr «Yuzlarni ro'yxatga olish» bo'limida xodimlarni qo'shadi");
  if (m.kind === "none") return fail("NO_MATCH", "Yuz tanilmadi — ro'yxatga olinmagan yoki kadr sifatsiz. Yaqinroq kelib, kameraga to'g'ri qarang");
  if (m.kind === "ambiguous") {
    const names = await db.employee.findMany({ where: { id: { in: m.ids } }, select: { fullName: true } });
    return fail("AMBIGUOUS", `Aniq emas (${names.map((n) => n.fullName).join(" yoki ")}) — yorug'roq joyda qayta urining`);
  }

  const e = await db.employee.findUnique({ where: { id: m.employeeId }, select: { id: true, fullName: true, position: true, workSchedule: true } });
  if (!e) return fail("NO_MATCH", "Yuz tanilmadi — qayta urining");
  const who = { id: e.id, fullName: e.fullName, position: e.position };
  if (scope === "sex" && !(await productionStaff()).members.some((x) => x.id === e.id)) {
    return fail("OUT_OF_SCOPE", `${e.fullName} sex tarkibida emas — uning davomatini otdel kadr belgilaydi`, who);
  }

  const sim = similarity(m.d);
  const iso = today();
  const now = nowHHMM();
  const shift = shiftOf(e.workSchedule);
  const { today: t, yesterday: y } = await openRecord(e.id, iso);
  // Ochiq yozuv: bugun kelgan va ketmagan, bo'lmasa kechagi tungi smena
  const open = t?.status === "PRESENT" && t.checkIn && !t.checkOut ? t : !t && nightOpen(y, now) ? y : null;
  const already = (text: string, hint: string | null, time: string | null): FaceScanResult =>
    ({ ok: true, kind: "already", employee: who, time, text, hint, similarity: sim, attendanceId: (t ?? y)?.id ?? null });

  let kind: "in" | "out";
  if (mode !== "auto") kind = mode;
  else if (open) {
    const since = sinceCheckIn(open.checkIn, now, open === t);
    if (since !== null && since < AUTO_OUT_AFTER_MIN) return already(`Bugun ${open.checkIn} da kelgan`, `«Ketdi» kelgandan ${AUTO_OUT_AFTER_MIN} daqiqa o'tgach belgilanadi`, open.checkIn);
    kind = "out";
  } else if (t?.status === "PRESENT" && t.checkOut) return already(`Bugun ${t.checkIn ?? "—"}–${t.checkOut}`, "Kelish va ketish belgilangan", t.checkOut);
  else kind = "in";

  const meta = { xodim: e.fullName, faceId: true, masofa: Math.round(m.d * 1000) / 1000, oxshashlik: sim, rejim: mode };

  if (kind === "in") {
    if (t?.status === "PRESENT" && t.checkIn) return already(`Bugun ${t.checkIn} da kelgan`, mode === "in" ? "Ketishni belgilash uchun «Ketdi» yoki «Avto» rejimini tanlang" : null, t.checkIn);
    if (t && t.status !== "PRESENT" && t.status !== "ABSENT") {
      return fail("MARKED_OTHER", `${e.fullName}: bugun «${markOf(t.status).label}» deb belgilangan — o'zgartirish otdel kadr tabelida`, who);
    }
    const late = lateBy(now, shift.start);
    const stored = await saveSnapshot(e.id, photo);
    const data = {
      status: "PRESENT" as const, checkIn: now, checkOut: null, markedById: s.userId, source: FACE_SOURCE, lateMinutes: late,
      ...(stored ? { facePhoto: stored, faceVerifiedAt: new Date() } : {}),
    };
    const date = dayUtc(iso);
    const a = await db.$transaction(async (tx) => {
      const a = await tx.attendance.upsert({ where: { employeeId_date: { employeeId: e.id, date } }, create: { employeeId: e.id, date, ...data }, update: data });
      await audit(tx, s.userId, "UPDATE", "Attendance", a.id, t ? { status: t.status, checkIn: t.checkIn } : undefined, { ...meta, keldi: now });
      return a;
    });
    notifyLateAfter(s.userId, { employeeId: e.id, checkIn: now, lateMinutes: late, iso });
    // Kun ichida qayta "Keldi" (avval Kelmadi deb belgilangan) — eski kadr diskda qolmasin
    if (t?.facePhoto && stored && t.facePhoto !== stored) await removeEmployeeFile(t.facePhoto);
    return { ok: true, kind: "in", employee: who, time: now, text: `Keldi ${now}`, hint: late ? `${late} daq kechikdi` : "O'z vaqtida", similarity: sim, attendanceId: a.id };
  }

  // Ketdi
  if (!open) {
    if (t?.status === "PRESENT" && t.checkOut) return already(`Bugun ${t.checkOut} da ketgan`, null, t.checkOut);
    if (t && t.status !== "PRESENT") return fail("MARKED_OTHER", `${e.fullName}: bugun «${markOf(t.status).label}» deb belgilangan`, who);
    return fail("NO_CHECKIN", `${e.fullName}: bugun kelgani belgilanmagan — avval «Keldi» (yoki «Avto») rejimida skaner qiling`, who);
  }
  const w = sinceCheckIn(open.checkIn, now, open === t);
  // Bir daqiqada kelib-ketish: tabelda "08:12–08:12" 24 soat bo'lib hisoblanardi — yozilmaydi
  if (w === 0) return already(`Hozirgina (${open.checkIn}) kelgan`, "Ketishni bir daqiqadan keyin belgilang", open.checkIn);
  if (w !== null && w > MAX_SHIFT_MINUTES) {
    return fail("SHIFT_TOO_LONG", `${e.fullName}: smena ${MAX_SHIFT_MINUTES / 60} soatdan uzun bo'lib qoldi (${open.checkIn} da kelgan) — ketish vaqtini otdel kadr qo'yadi`, who);
  }
  const stored = await saveSnapshot(e.id, photo);
  await db.$transaction(async (tx) => {
    await tx.attendance.update({ where: { id: open.id }, data: { checkOut: now, ...(stored ? { checkOutPhoto: stored } : {}) } });
    await audit(tx, s.userId, "UPDATE", "Attendance", open.id, { checkOut: null }, { ...meta, ketdi: now });
  });
  const early = earlyBy(now, shift.end);
  return {
    ok: true, kind: "out", employee: who, time: now, text: `Ketdi ${now}`,
    hint: [`Keldi ${open.checkIn}`, w === null ? null : w < 60 ? `${w} daq` : hoursText(w), early ? `${early} daq erta` : null].filter(Boolean).join(" · "),
    similarity: sim, attendanceId: open.id,
  };
}

// ───────────────────────── Ro'yxatga olish ─────────────────────────

const EnrollBody = z.object({
  employeeId: z.string().trim().min(1).max(64),
  samples: z.array(z.object({ descriptor: Descriptor, score: z.number().min(0).max(1) }))
    .min(ENROLL_MIN_SAMPLES, `Kamida ${ENROLL_MIN_SAMPLES} ta namuna kerak`).max(ENROLL_MAX_SAMPLES),
  photo: Snapshot,
  consent: z.literal(true, { message: "Xodim roziligini belgilang" }),
});

export type EnrollResult = { ok: true; count: number; note: string } | { ok: false; error: string };

export async function enrollFace(s: Session, raw: unknown): Promise<EnrollResult> {
  if (!canEnrollFaces(s)) return { ok: false, error: "Yuzni ro'yxatga olish — otdel kadr vakolati" };
  if (!hit(`face-enroll:${s.userId}`, 20, 60_000)) return { ok: false, error: "Juda ko'p urinish — bir daqiqa kuting" };
  const p = EnrollBody.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" };
  const { employeeId, samples, photo } = p.data;

  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, isActive: true, firedAt: true } });
  if (!e) return { ok: false, error: "Xodim topilmadi — sahifani yangilang" };
  if (!e.isActive || e.firedAt) return { ok: false, error: `${e.fullName} faol emas — ishdan bo'shagan xodimning yuzi olinmaydi` };

  const vecs = samples.map((x) => x.descriptor);
  for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) {
    if (distance(vecs[i]!, vecs[j]!) > ENROLL_SELF_MAX) return { ok: false, error: "Namunalar bir-biriga mos emas — kadrga boshqa odam kirib qolgan bo'lishi mumkin. Qayta urining (kadrda faqat xodimning o'zi tursin)" };
  }
  const [dup] = rank(vecs, await candidates(e.id));
  if (dup && dup.d < DUPLICATE_DISTANCE) {
    const other = await db.employee.findUnique({ where: { id: dup.employeeId }, select: { fullName: true } });
    return { ok: false, error: `Bu yuz «${other?.fullName ?? "boshqa xodim"}» kartasida allaqachon ro'yxatda. Bir odam ikki kartada bo'lmaydi — avval o'sha xodimning yuzini o'chiring` };
  }

  const stored = await saveSnapshot(e.id, photo);
  const old = await db.$transaction(async (tx) => {
    const old = await tx.faceTemplate.findMany({ where: { employeeId: e.id }, select: { photo: true } });
    await tx.faceTemplate.deleteMany({ where: { employeeId: e.id } });
    await tx.faceTemplate.createMany({
      data: samples.map((x, i) => ({ employeeId: e.id, descriptor: x.descriptor, score: x.score, photo: i === 0 ? stored : null, createdById: s.userId })),
    });
    await tx.employee.update({ where: { id: e.id }, data: { faceConsentAt: new Date() } });
    await audit(tx, s.userId, old.length ? "UPDATE" : "CREATE", "FaceTemplate", e.id, old.length ? { namuna: old.length } : undefined, { xodim: e.fullName, namuna: samples.length, rozilik: true });
    return old;
  });
  await Promise.all(old.map((o) => removeEmployeeFile(o.photo)));
  return { ok: true, count: samples.length, note: `${e.fullName}: yuz ro'yxatga olindi (${samples.length} namuna)` };
}

export async function deleteFace(s: Session, employeeId: string): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  if (!canEnrollFaces(s)) return { ok: false, error: "Yuzni o'chirish — otdel kadr vakolati" };
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true } });
  if (!e) return { ok: false, error: "Xodim topilmadi" };
  const old = await db.$transaction(async (tx) => {
    const old = await tx.faceTemplate.findMany({ where: { employeeId: e.id }, select: { photo: true } });
    if (!old.length) return old;
    await tx.faceTemplate.deleteMany({ where: { employeeId: e.id } });
    await tx.employee.update({ where: { id: e.id }, data: { faceConsentAt: null } });
    await audit(tx, s.userId, "DELETE", "FaceTemplate", e.id, { namuna: old.length }, { xodim: e.fullName });
    return old;
  });
  await Promise.all(old.map((o) => removeEmployeeFile(o.photo)));
  return { ok: true, note: old.length ? `${e.fullName}: yuz ma'lumoti o'chirildi` : "O'chiriladigan yuz ma'lumoti yo'q" };
}

// ───────────────────────── Sahifa ma'lumotlari ─────────────────────────

export type RosterRow = {
  id: string; fullName: string; position: string;
  samples: number; enrolledAt: string | null; templatePhotoId: string | null;
};

/** Faol xodimlar va ularning yuz namunalari soni (ro'yxatga olish jadvali). */
export async function faceRoster(): Promise<RosterRow[]> {
  const [emps, tpl] = await Promise.all([
    db.employee.findMany({ where: { isActive: true, firedAt: null }, orderBy: [{ fullName: "asc" }], select: { id: true, fullName: true, position: true } }),
    db.faceTemplate.findMany({ select: { id: true, employeeId: true, photo: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const by = new Map<string, { n: number; at: Date; photoId: string | null }>();
  for (const t of tpl) {
    const cur = by.get(t.employeeId) ?? { n: 0, at: t.createdAt, photoId: null };
    by.set(t.employeeId, { n: cur.n + 1, at: t.createdAt > cur.at ? t.createdAt : cur.at, photoId: cur.photoId ?? (t.photo ? t.id : null) });
  }
  return emps.map((e) => {
    const f = by.get(e.id);
    return { ...e, samples: f?.n ?? 0, enrolledAt: f ? f.at.toISOString() : null, templatePhotoId: f?.photoId ?? null };
  });
}

export type FaceLogRow = {
  key: string; attendanceId: string; kind: "in" | "out"; time: string;
  employee: { id: string; fullName: string; position: string }; photo: boolean;
};

/** Bugun skaner orqali yozilgan kelish/ketishlar (yangisi tepada). Sex boshlig'iga — faqat sex xodimlari. */
export async function todayFaceLog(scope: FaceScope): Promise<FaceLogRow[]> {
  const rows = await db.attendance.findMany({
    where: { date: dayUtc(today()), OR: [{ source: FACE_SOURCE }, { checkOutPhoto: { not: null } }] },
    select: { id: true, source: true, checkIn: true, checkOut: true, facePhoto: true, checkOutPhoto: true, employee: { select: { id: true, fullName: true, position: true } } },
  });
  const sex = scope === "sex" ? new Set((await productionStaff()).members.map((m) => m.id)) : null;
  const out: FaceLogRow[] = [];
  for (const r of rows) {
    if (sex && !sex.has(r.employee.id)) continue;
    if (r.source === FACE_SOURCE && r.checkIn) out.push({ key: `${r.id}:in`, attendanceId: r.id, kind: "in", time: r.checkIn, employee: r.employee, photo: !!r.facePhoto });
    if (r.checkOutPhoto && r.checkOut) out.push({ key: `${r.id}:out`, attendanceId: r.id, kind: "out", time: r.checkOut, employee: r.employee, photo: true });
  }
  return out.sort((a, b) => b.time.localeCompare(a.time));
}

/**
 * Kadr faylini berishdan oldin: kim ko'ra oladi. Davomat kadri — skaner egasi (sex boshlig'i faqat sex xodiminikini),
 * ro'yxatga olish kadri — faqat otdel kadr darajasi.
 */
export async function facePhotoFor(s: Pick<Session, "role" | "perms">, q: { a?: string | null; k?: string | null; t?: string | null }): Promise<string | null> {
  const scope = faceScope(s);
  if (!scope) return null;
  if (q.t) {
    if (scope !== "all") return null;
    const t = await db.faceTemplate.findUnique({ where: { id: q.t }, select: { photo: true } });
    return t?.photo ?? null;
  }
  if (!q.a) return null;
  const a = await db.attendance.findUnique({ where: { id: q.a }, select: { employeeId: true, facePhoto: true, checkOutPhoto: true } });
  if (!a) return null;
  if (scope === "sex" && !(await productionStaff()).members.some((m) => m.id === a.employeeId)) return null;
  return q.k === "out" ? a.checkOutPhoto : a.facePhoto;
}
