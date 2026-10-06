import { db } from "@/lib/db";
import { employeeMonth, staffDay } from "@/lib/attendance-report";
import { driverMonth, driversMonth } from "@/lib/driver-pay";
import type { MobileUser } from "./auth";
import { ListError, moduleClosed } from "./list";

/**
 * Mobil "Davomat" jadvali va "Haydovchilar: reyslar va davomat" — ish haqi asosi.
 *   · GET /api/mobile/attendance/day?date=YYYY-MM-DD      — barcha xodimlar, bir kun;
 *   · GET /api/mobile/attendance/employee?id=&month=      — bitta xodim, oy;
 *   · GET /api/mobile/driver-trips?month=                 — barcha haydovchilar, oy;
 *   · GET /api/mobile/driver-trips?id=<employeeId|me>&month= — bitta haydovchi, kunlar.
 * Ko'rish huquqi: davomat — otdel kadr, direktor, ishlab chiqarish, ish boshqaruvchi;
 * haydovchilar — direktor, otdel kadr, logistika; haydovchi faqat o'zinikini.
 * Direktor modulni ("employees" / "trips") yopgan bo'lsa — ochilmaydi.
 */

export const ATTENDANCE_TABLE_ROLES = ["DIRECTOR", "HR", "PRODUCTION", "SUPERVISOR"] as const;
export const DRIVER_PAY_ROLES = ["DIRECTOR", "HR", "LOGISTICS"] as const;

const deny = (): never => { throw new ListError("FORBIDDEN", "Bu bo'lim sizning lavozimingiz uchun ochilmagan", 403); };

function canTable(user: MobileUser) {
  return (ATTENDANCE_TABLE_ROLES as readonly string[]).includes(user.role) && !moduleClosed(user, "employees");
}

export async function mobileStaffDay(user: MobileUser, date: string | null) {
  if (!canTable(user)) deny();
  return staffDay(date);
}

export async function mobileEmployeeMonth(user: MobileUser, id: string | null, month: string | null) {
  if (!canTable(user)) deny();
  if (!id) throw new ListError("BAD_REQUEST", "Xodim tanlanmagan", 400);
  const r = await employeeMonth(id, month);
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
