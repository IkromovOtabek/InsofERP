import { db } from "@/lib/db";
import { employeeMonth, staffDay } from "@/lib/attendance-report";
import { driverMonth, driversMonth } from "@/lib/driver-pay";
import { productionStaff } from "@/lib/production-staff";
import type { MobileUser } from "./auth";
import { faceKioskAccess } from "./face-kiosk";
import { ListError, moduleClosed } from "./list";

/**
 * Mobil "Davomat" jadvali va "Haydovchilar: reyslar va davomat" — ish haqi asosi.
 *   · GET /api/mobile/attendance/day?date=YYYY-MM-DD      — barcha xodimlar, bir kun;
 *   · GET /api/mobile/attendance/employee?id=&month=      — bitta xodim, oy;
 *   · GET /api/mobile/driver-trips?month=                 — barcha haydovchilar, oy;
 *   · GET /api/mobile/driver-trips?id=<employeeId|me>&month= — bitta haydovchi, kunlar.
 * Davomat jadvali — FAQAT KO'RISH, har bir xodimga ochiq (bosh sahifadagi «Davomat» → Jadval): kim keldi, ketdi,
 * soat, kechikish. Belgilash bu yerda yo'q — u skaner (`face-kiosk.ts`, sex boshlig'iga faqat sex) va sex davomatida.
 * Ustunlar ko'rish darajasiga qarab (`viewLevel`):
 *   · "full" — direktor, otdel kadr: hamma ustun (manba — kim belgilagani, izoh, telefon);
 *   · "sex"  — ishlab chiqarish, ish boshqaruvchi: sex xodimlarida "full", qolganlarda "public";
 *   · "public" — boshqa xodimlar: ism, lavozim/bo'lim, holat, keldi/ketdi, soat, kechikish; manba, izoh va telefon yashiriladi.
 * Haydovchilar — direktor, otdel kadr, logistika; haydovchi faqat o'zinikini.
 * Direktor xodimga modulni ("employees" / "trips") yopgan bo'lsa — ochilmaydi.
 */

/** To'liq ustunli jadval (manba, izoh, telefon) — hamma xodim bo'yicha. */
export const ATTENDANCE_FULL_ROLES = ["DIRECTOR", "HR"] as const;

export const DRIVER_PAY_ROLES = ["DIRECTOR", "HR", "LOGISTICS"] as const;

const deny = (): never => { throw new ListError("FORBIDDEN", "Bu bo'lim sizning lavozimingiz uchun ochilmagan", 403); };

/** Jadvalni ko'ra oladimi — har bir xodim, direktor "Xodimlar" modulini yopmagan bo'lsa. */
export function canViewAttendanceTable(user: Pick<MobileUser, "role" | "perms">) {
  return !moduleClosed(user, "employees");
}

/** Sex boshliqlari (ishlab chiqarish, ish boshqaruvchi) — sex tarkibi (`productionStaff()`, skanerning `faceScope === "sex"` qoidasi). */
async function sexMembers(): Promise<Set<string>> {
  return new Set((await productionStaff()).members.map((m) => m.id));
}

/** Xodim bo'yicha to'liq ustunlarni ko'radimi: `true` — hammada, `Set` — faqat shu xodimlarda, `false` — hech kimda. */
async function fullFor(user: MobileUser): Promise<true | Set<string> | false> {
  if ((ATTENDANCE_FULL_ROLES as readonly string[]).includes(user.role)) return true;
  if (user.role === "PRODUCTION" || user.role === "SUPERVISOR") return sexMembers();
  return false;
}
const isFull = (full: true | Set<string> | false, id: string) => full === true || (full !== false && full.has(id));

/**
 * Bosh sahifa: «Davomat» tugmasi (hamma xodimga). Ilovaning yangi versiyasi shuni o'qiydi; eski versiya `faceAttendance` ni
 * o'qiydi (u faqat skanerga ruxsati borlarga beriladi — eski ilova Davomat ekranida `GET /api/mobile/face` ni chaqiradi).
 *   · canScan / canEnroll — Skaner va Yuzlar tablari (`faceKioskAccess`);
 *   · canViewTable — Jadval (faqat ko'rish);
 *   · linked — login xodim kartasiga bog'langanmi ("Men" tabi: o'z Keldim/Ketdim; bo'lmasa — otdel kadrga murojaat).
 */
export type AttendanceAccess = { canScan: boolean; canEnroll: boolean; canViewTable: boolean; linked: boolean };
export function attendanceAccess(user: MobileUser, linked: boolean): AttendanceAccess {
  const face = faceKioskAccess(user);
  return { canScan: !!face, canEnroll: !!face?.canEnroll, canViewTable: canViewAttendanceTable(user), linked };
}

export async function mobileStaffDay(user: MobileUser, date: string | null) {
  if (!canViewAttendanceTable(user)) deny();
  const [day, full] = await Promise.all([staffDay(date), fullFor(user)]);
  if (full === true) return day;
  // Faqat ko'rish: kim belgilagani (manba) va izoh (kasallik sababi va h.k.) — faqat mas'ullarga
  return { ...day, rows: day.rows.map((r) => (isFull(full, r.id) ? r : { ...r, source: null, note: null })) };
}

export async function mobileEmployeeMonth(user: MobileUser, id: string | null, month: string | null) {
  if (!canViewAttendanceTable(user)) deny();
  if (!id) throw new ListError("BAD_REQUEST", "Xodim tanlanmagan", 400);
  const [r, full] = await Promise.all([employeeMonth(id, month), fullFor(user)]);
  if (!r) throw new ListError("NOT_FOUND", "Xodim topilmadi", 404);
  if (isFull(full, id)) return r;
  return { ...r, employee: { ...r.employee, phone: null }, days: r.days.map((d) => ({ ...d, source: null, note: null })) };
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
