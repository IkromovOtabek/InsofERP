import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma";

/**
 * Bo'lim lavozimlari — rolli, egasi login oladi va faqat o'z bo'limini ko'radi.
 * Ishchi lavozimlar bu yerda emas: ular bazada (`WorkPosition`) va Otdel kadr sahifasida boshqariladi.
 */
export const POSITIONS: { label: string; role: Role }[] = [
  { label: "Sotuv", role: "SALES" },
  { label: "Ishlab chiqarish", role: "PRODUCTION" },
  { label: "Ish boshqaruvchi", role: "SUPERVISOR" },
  { label: "Logistika", role: "LOGISTICS" },
  { label: "Buxgalteriya", role: "ACCOUNTING" },
  { label: "Otdel kadr", role: "HR" },
  // Snabjeniye Sklad bilan bitta bo'lim: kirim, yetkazuvchilar va qoldiq — hammasi Sklad qo'lida
  { label: "Sklad", role: "WAREHOUSE" },
  { label: "Kassa / bank", role: "CASHIER" },
  { label: "Direktor", role: "DIRECTOR" },
];

/** Ro'yxatdan chiqarilgan, lekin bazada xodimi qolgan bo'lishi mumkin bo'lgan eski nomlar. */
const LEGACY: Record<string, Role> = { finance: "FINANCE", snabjeniye: "PROCUREMENT" };

export const roleForPosition = (position: string): Role | null => {
  const key = position.trim().toLowerCase();
  return POSITIONS.find((p) => p.label.toLowerCase() === key)?.role ?? LEGACY[key] ?? null;
};


/**
 * Lavozimlarning yagona ro'yxati — hamma sahifa (Boshqaruv → Xodimlar, Otdel kadr,
 * filtrlar, formalar) shu bittasidan oladi, shuning uchun ro'yxat hamma joyda bir xil.
 *
 * `departments` — tizimga kiradigan bo'lim lavozimlari (login beradi),
 * `work` — Otdel kadr yuritadigan ishchi lavozimlar (`WorkPosition`),
 * `drivers` — haydovchi ilovasiga chiqadiganlar,
 * `strays` — xodimlarda yozilgan, lekin ro'yxatga tushmagan lavozimlar (masalan Excel importdan
 *   qolgan eski yozuv): ular ham tanlovda ko'rinadi, aks holda o'sha xodimlar filtrda topilmaydi.
 */
export async function positionCatalog(): Promise<{
  departments: { label: string; role: Role }[];
  work: string[];
  drivers: string[];
  strays: string[];
}> {
  const [work, used] = await Promise.all([
    db.workPosition.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true, isDriver: true } }),
    db.employee.groupBy({ by: ["position"] }),
  ]);
  const known = new Set<string>([
    ...POSITIONS.map((p) => p.label.trim().toLowerCase()),
    ...work.map((w) => w.name.trim().toLowerCase()),
  ]);
  const strays = used
    .map((u) => u.position.trim())
    .filter((n) => n && !known.has(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const drivers = work.filter((w) => w.isDriver).map((w) => w.name);
  return {
    departments: POSITIONS,
    work: work.map((w) => w.name),
    drivers: drivers.length ? drivers : ["Haydovchi"],
    strays: [...new Set(strays)],
  };
}

/** Otdel kadr yuritadigan ishchi lavozimlar (login bermaydi). */
export const workPositions = (opts?: { all?: boolean }) =>
  db.workPosition.findMany({
    where: opts?.all ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

/**
 * Haydovchi ilovasiga (Insof ECO) chiqadigan lavozim nomlari — Otdel kadr belgilaydi
 * (`WorkPosition.isDriver`). Ro'yxat bo'sh bo'lsa eski xulq: faqat "Haydovchi".
 */
export async function driverPositionNames(): Promise<string[]> {
  const rows = await db.workPosition.findMany({ where: { isDriver: true, isActive: true }, select: { name: true } });
  return rows.length ? rows.map((r) => r.name) : ["Haydovchi"];
}

export async function isDriverPosition(position: string): Promise<boolean> {
  const key = position.trim().toLowerCase();
  return (await driverPositionNames()).some((n) => n.toLowerCase() === key);
}
