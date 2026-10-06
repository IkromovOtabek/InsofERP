"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { dayUtc, isAttendanceStatus, shiftProblem, toMinutes, validDay, workedMinutes } from "@/lib/davomat";
import { lateBy, shiftOf } from "@/lib/attendance-time";
import { notifyLateAfter, type LateEvent } from "@/lib/attendance-late";
import type { ActionState } from "@/lib/action";
import type { AttendanceStatus } from "@/generated/prisma";

/** Davomatni faqat otdel kadr (va direktor) yuritadi. */
// Rol (HR) + direktor bergan "employees" moduli ruxsati (yo'q/ko'rish — yozolmaydi)
const hr = () => requireAction("employees", "edit", ["HR"]);

type Row = { employeeId: string; status: AttendanceStatus | null; checkIn: string | null; checkOut: string | null; note: string | null; ver: string };

const clean = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

/**
 * Kunlik tabel bitta forma bilan yuboriladi: har xodimga `st:`, `in:`, `out:`, `nt:` maydonlari.
 * `emp[]` da faqat sahifada O'ZGARTIRILGAN xodimlar keladi (klient boshlang'ich qiymat bilan solishtiradi) —
 * qolganlariga tegilmaydi, aks holda shu kuni sex/brigadir mobil ilovada qo'ygan belgi eski holat bilan
 * ustidan yozilardi yoki o'chib ketardi. `ver:` — sahifa ochilgandagi yozuvning `updatedAt` (yo'q bo'lsa bo'sh).
 */
function readRows(fd: FormData): { rows: Row[] } | { error: string } {
  const ids = [...new Set(fd.getAll("emp[]").map(String))];
  const rows: Row[] = [];
  for (const employeeId of ids) {
    const raw = clean(fd.get(`st:${employeeId}`));
    if (raw && !isAttendanceStatus(raw)) return { error: "Noma'lum davomat belgisi" };
    const status = (raw ?? null) as AttendanceStatus | null;
    // Soat faqat ishga chiqqan kunda saqlanadi — qolgan belgilarda kerak emas
    const checkIn = status === "PRESENT" ? clean(fd.get(`in:${employeeId}`)) : null;
    const checkOut = status === "PRESENT" ? clean(fd.get(`out:${employeeId}`)) : null;
    // "Keldi" — kelgan vaqti har doim yoziladi (ish haqi soatdan hisoblanadi)
    if (status === "PRESENT" && !checkIn) return { error: "«Keldi» uchun kelgan vaqtini kiriting" };
    if (checkIn && toMinutes(checkIn) === null) return { error: "Kelgan vaqt noto'g'ri — SS:DD ko'rinishida yozing" };
    if (checkOut && toMinutes(checkOut) === null) return { error: "Ketgan vaqt noto'g'ri — SS:DD ko'rinishida yozing" };
    const tooLong = shiftProblem(checkIn, checkOut);
    if (tooLong) return { error: tooLong };
    rows.push({ employeeId, status, checkIn, checkOut, note: clean(fd.get(`nt:${employeeId}`)), ver: String(fd.get(`ver:${employeeId}`) ?? "") });
  }
  return { rows };
}

type Snap = { status: AttendanceStatus; checkIn: string | null; checkOut: string | null; note: string | null } | null;
const snap = (a: { status: AttendanceStatus; checkIn: string | null; checkOut: string | null; note: string | null } | null | undefined): Snap =>
  a ? { status: a.status, checkIn: a.checkIn, checkOut: a.checkOut, note: a.note } : null;

/**
 * Kunlik davomatni saqlaydi — faqat o'zgartirilgan qatorlar:
 *  - belgisi aniq "— belgilanmagan" qilingan xodimning yozuvi o'chadi (tabelda bo'sh katak);
 *  - qolganlari `employeeId + date` bo'yicha yoziladi;
 *  - sahifa ochilgandan keyin boshqa joyda (mobil sex/brigadir, boshqa kadr) o'zgargan yozuv ustidan
 *    yozilmaydi — o'tkazib yuboriladi va xabarda aytiladi (sahifa yangilanib, yangi qiymat ko'rinadi).
 * Auditda har xodim bo'yicha oldin/keyin.
 */
export async function saveAttendance(iso: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const day = validDay(iso);
  if (!day) return { error: "Sana noto'g'ri" };
  // Kelajak kuniga davomat qo'yilmaydi (server vaqti — Asia/Tashkent, `instrumentation.ts`)
  if (day > new Date().toLocaleDateString("sv-SE")) return { error: "Kelajak kuniga davomat belgilab bo'lmaydi" };
  const r = readRows(fd);
  if ("error" in r) return { error: r.error };
  if (!r.rows.length) return { ok: true, note: "O'zgarish yo'q — hech narsa saqlanmadi" };

  const date = dayUtc(day);
  // Xodim mavjud bo'lsin (eskirgan id FK xatosi — 500 berardi) va o'sha kuni hali ishdan bo'shamagan bo'lsin
  const emps = await db.employee.findMany({ where: { id: { in: r.rows.map((x) => x.employeeId) } }, select: { id: true, fullName: true, firedAt: true, workSchedule: true } });
  const schedOf = new Map(emps.map((e) => [e.id, e.workSchedule]));
  const lateEvents: LateEvent[] = [];
  if (emps.length !== r.rows.length) return { error: "Ro'yxatdagi xodim topilmadi — sahifani yangilang" };
  const fired = emps.filter((e) => e.firedAt && e.firedAt.toLocaleDateString("sv-SE") < day && r.rows.some((x) => x.employeeId === e.id && x.status));
  if (fired.length) return { error: `Ishdan bo'shagan xodimga davomat qo'yilmaydi: ${fired.map((e) => e.fullName).join(", ")}` };
  const res = await db.$transaction(async (tx) => {
    const cur = await tx.attendance.findMany({ where: { date, employeeId: { in: r.rows.map((x) => x.employeeId) } } });
    const byEmp = new Map(cur.map((a) => [a.employeeId, a]));
    const names = new Map((await tx.employee.findMany({ where: { id: { in: r.rows.map((x) => x.employeeId) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    const skipped: string[] = [];
    const changes: { xodim: string; oldin: Snap; keyin: Snap }[] = [];
    let marked = 0, cleared = 0, hours = 0;
    for (const x of r.rows) {
      const a = byEmp.get(x.employeeId);
      // Versiya mos emas: sahifa ochilgandan keyin yozuv paydo bo'lgan, o'zgargan yoki o'chirilgan
      if ((a?.updatedAt.toISOString() ?? "") !== x.ver) { skipped.push(names.get(x.employeeId) ?? "?"); continue; }
      if (!x.status) {
        if (!a) continue;
        await tx.attendance.delete({ where: { id: a.id } });
        changes.push({ xodim: names.get(x.employeeId) ?? x.employeeId, oldin: snap(a), keyin: null });
        cleared++;
        continue;
      }
      // Kechikish xodim smenasi bo'yicha saqlanadi (sex va o'zi belgilagandagi qoida)
      const lateMinutes = x.status === "PRESENT" ? lateBy(x.checkIn, shiftOf(schedOf.get(x.employeeId)).start) : null;
      const data = { status: x.status, checkIn: x.checkIn, checkOut: x.checkOut, note: x.note, markedById: s.userId, lateMinutes };
      if (lateMinutes && x.checkIn !== a?.checkIn) lateEvents.push({ employeeId: x.employeeId, checkIn: x.checkIn, lateMinutes, iso: day });
      await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: x.employeeId, date } },
        create: { employeeId: x.employeeId, date, ...data },
        update: data,
      });
      changes.push({ xodim: names.get(x.employeeId) ?? x.employeeId, oldin: snap(a), keyin: snap(data) });
      marked++;
      hours += workedMinutes(x.checkIn, x.checkOut) ?? 0;
    }
    if (changes.length || skipped.length) {
      await audit(tx, s.userId, "UPDATE", "Attendance", day, undefined, { belgilandi: marked, tozalandi: cleared, otkazildi: skipped, ozgarishlar: changes });
    }
    return { marked, cleared, skipped, hours };
  });

  notifyLateAfter(s.userId, lateEvents);
  revalidatePath("/otdel-kadr");
  const parts = [
    res.marked ? `${res.marked} ta xodim belgilandi` : null,
    res.hours ? `jami ${(res.hours / 60).toFixed(1).replace(".0", "")} soat` : null,
    res.cleared ? `${res.cleared} ta katak tozalandi` : null,
    res.skipped.length ? `${res.skipped.length} tasi o'tkazib yuborildi — sahifa ochilgandan keyin boshqa joyda o'zgartirilgan: ${res.skipped.join(", ")}. Yangi qiymatni tekshirib, kerak bo'lsa qayta saqlang` : null,
  ].filter(Boolean);
  return { ok: true, note: parts.length ? parts.join(" · ") : "O'zgarish yo'q" };
}
