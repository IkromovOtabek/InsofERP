import { db } from "@/lib/db";
import { employeeMonth, staffDay } from "@/lib/attendance-report";
import { driverMonth, driversMonth } from "@/lib/driver-pay";
import type { MobileUser } from "./auth";
import { faceKioskAccess } from "./face-kiosk";
import { ListError, moduleClosed } from "./list";

/**
 * Mobil "Davomat" jadvali va "Haydovchilar: reyslar va davomat" — ish haqi asosi.
 *   · GET /api/mobile/attendance/day?date=YYYY-MM-DD      — barcha xodimlar, bir kun;
 *   · GET /api/mobile/attendance/employee?id=&month=      — bitta xodim, oy (`id=me` — o'zi);
 *   · GET /api/mobile/driver-trips?month=                 — barcha haydovchilar, oy;
 *   · GET /api/mobile/driver-trips?id=<employeeId|me>&month= — bitta haydovchi, kunlar.
 * Xodimlar davomati (umumiy jadval, boshqa xodimning oyi) — FAQAT direktor va otdel kadr (`ATTENDANCE_FULL_ROLES`),
 * barcha ustunlar bilan (manba — kim belgilagani, izoh, telefon, hududdan tashqaridagi nuqta). Qolgan xodimlar ilovada
 * faqat O'Z davomatini ko'radi: bosh sahifadagi "Keldim / Ketdim" kartasi va "Men" tabi (`/attendance/self`,
 * `lib/self-attendance.ts`); `/attendance/employee?id=me` ham o'zinikini qaytaradi, boshqa id — 403.
 * Belgilash bu yerda yo'q — u skaner (`face-kiosk.ts`, sex boshlig'iga faqat sex) va sex davomatida (`sex.ts`).
 * Haydovchilar — direktor, otdel kadr, logistika; haydovchi faqat o'zinikini.
 * Direktor xodimga modulni ("employees" / "trips") yopgan bo'lsa — ochilmaydi.
 */

/** Umumiy davomat jadvali (hamma xodim bo'yicha, to'liq ustunlar). */
export const ATTENDANCE_FULL_ROLES = ["DIRECTOR", "HR"] as const;

export const DRIVER_PAY_ROLES = ["DIRECTOR", "HR", "LOGISTICS"] as const;

const deny = (): never => { throw new ListError("FORBIDDEN", "Bu bo'lim sizning lavozimingiz uchun ochilmagan", 403); };

/** Umumiy jadvalni ko'ra oladimi — faqat otdel kadr va direktor (direktor "Xodimlar / kadr" modulini yopmagan bo'lsa). */
export function canViewAttendanceTable(user: Pick<MobileUser, "role" | "perms">) {
  return (ATTENDANCE_FULL_ROLES as readonly string[]).includes(user.role) && !moduleClosed(user, "employees");
}

/**
 * Bosh sahifa: «Davomat» tugmasi (hamma xodimga). Ilovaning yangi versiyasi shuni o'qiydi; eski versiya `faceAttendance` ni
 * o'qiydi (u faqat skanerga ruxsati borlarga beriladi — eski ilova Davomat ekranida `GET /api/mobile/face` ni chaqiradi).
 *   · canScan / canEnroll — Skaner va Yuzlar tablari (`faceKioskAccess`);
 *   · canViewTable — Jadval (hamma xodim) — faqat otdel kadr va direktor; qolganlarda ilova faqat "Men" tabini ko'rsatadi;
 *   · linked — login xodim kartasiga bog'langanmi ("Men" tabi: o'z Keldim/Ketdim; bo'lmasa — otdel kadrga murojaat).
 */
export type AttendanceAccess = { canScan: boolean; canEnroll: boolean; canViewTable: boolean; linked: boolean };
export function attendanceAccess(user: MobileUser, linked: boolean): AttendanceAccess {
  const face = faceKioskAccess(user);
  return { canScan: !!face, canEnroll: !!face?.canEnroll, canViewTable: canViewAttendanceTable(user), linked };
}

/** Login egasining xodim kartasi — bo'lmasa 403 (NOT_LINKED). */
async function myEmployeeId(user: Pick<MobileUser, "id">): Promise<string> {
  const me = await db.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (!me) throw new ListError("NOT_LINKED", "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling", 403);
  return me.id;
}

export async function mobileStaffDay(user: MobileUser, date: string | null) {
  if (!canViewAttendanceTable(user)) deny();
  return staffDay(date);
}

export async function mobileEmployeeMonth(user: MobileUser, id: string | null, month: string | null) {
  if (!id) throw new ListError("BAD_REQUEST", "Xodim tanlanmagan", 400);
  let employeeId = id;
  if (!canViewAttendanceTable(user)) {
    // Oddiy xodim — faqat o'zining oylik varag'i (to'liq ustunlar bilan: o'z belgisi, o'z izohi)
    const me = await myEmployeeId(user);
    if (id !== "me" && id !== me) deny();
    employeeId = me;
  } else if (id === "me") {
    employeeId = await myEmployeeId(user);
  }
  const r = await employeeMonth(employeeId, month);
  if (!r) throw new ListError("NOT_FOUND", "Xodim topilmadi", 404);
  return r;
}

export async function mobileDriverTrips(user: MobileUser, id: string | null, month: string | null) {
  const boss = (DRIVER_PAY_ROLES as readonly string[]).includes(user.role) && (user.role === "HR" ? !moduleClosed(user, "employees") : !moduleClosed(user, "trips"));
  if (!id) {
    if (!boss) deny();
    return driversMonth(month);
  }
  let employeeId = id;
  if (id === "me" || !boss) {
    // Haydovchi (yoki boshqa xodim) — faqat o'zining reyslari
    const me = await db.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
    if (!me) throw new ListError("NOT_LINKED", "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling", 403);
    if (id !== "me" && id !== me.id) deny();
    employeeId = me.id;
  }
  const r = await driverMonth(employeeId, month);
  if (!r) throw new ListError("NOT_FOUND", "Haydovchi topilmadi", 404);
  return r;
}
