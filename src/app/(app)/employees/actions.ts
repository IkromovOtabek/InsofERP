"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession, hashPassword, revokeSessions } from "@/lib/auth";
import { passwordProblem } from "@/lib/password-policy";
import { audit } from "@/lib/audit";
import { POSITIONS, roleForPosition, isDriverPosition } from "@/lib/positions";
import { isBrigadeLeader } from "@/lib/brigades";
import type { Role } from "@/generated/prisma";
import { pushEmployeeSilently, pushVehicleSilently } from "@/lib/eco/people";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { num } from "@/lib/excel";
import { sendSms, smsNote } from "@/lib/sms";
import { publicOrigin } from "@/lib/public-url";
import type { Prisma } from "@/generated/prisma";

const zDate = z.string().trim().optional().transform((v) => (v ? new Date(v) : null));

/** Login berishda tanlanadigan bo'limlar: bo'lim lavozimlari + haydovchi va brigadir ilovasi. */
const LOGIN_ROLES: Role[] = [...POSITIONS.map((p) => p.role), "DRIVER", "BRIGADIER"];

const schema = z.object({
  // Ro'yxatdan tanlangan mavjud xodim — yangi karta ochilmaydi, shu kartaga login beriladi
  employeeId: zOpt,
  // Ishchi lavozimda login qaysi bo'lim huquqi bilan ochilishi (bo'lim lavozimida kerak emas)
  role: zOpt,
  fullName: zStr("F.I.O. kerak"),
  position: zStr("Lavozim kerak"),
  phone: zOpt,
  hiredAt: zDate,
  birthDate: zDate,
  note: zOpt,
  login: zOpt,
  password: zOpt,
  // Haydovchi tanlanganda ochiladigan maydonlar (boshqa lavozimda formada yo'q)
  plate: zOpt,
  vehicleType: zOpt,
  capacityM3: zOpt,
  licenseNo: zOpt,
  licenseCategory: zOpt,
  licenseExpiry: zDate,
});

type DriverInput = {
  plate: string | null; vehicleType: string | null; capacityM3: string | null;
  licenseNo: string | null; licenseCategory: string | null; licenseExpiry: Date | null;
};

const normPlate = (v: string) => v.toUpperCase().replace(/\s+/g, "");

/**
 * Haydovchi texnikasi: davlat raqami bo'yicha mavjudi topiladi, bo'lmasa yangisi ochiladi.
 * Texnika alohida sahifada emas — mashina shu yerda ro'yxatga tushadi.
 */
async function driverVehicleId(tx: Prisma.TransactionClient, userId: string, d: DriverInput): Promise<string | null | undefined> {
  if (!d.plate) return null; // raqam tozalangan bo'lsa biriktirish uziladi
  const plate = normPlate(d.plate);
  const type = (["MIXER", "PUMP", "TRUCK"].includes(d.vehicleType ?? "") ? d.vehicleType : "MIXER") as "MIXER" | "PUMP" | "TRUCK";
  const capacityM3 = d.capacityM3 && Number(d.capacityM3) > 0 ? Number(d.capacityM3) : null;

  const cur = await tx.vehicle.findUnique({ where: { plate } });
  if (!cur) {
    const v = await tx.vehicle.create({ data: { plate, type, capacityM3 } });
    await audit(tx, userId, "CREATE", "Vehicle", v.id, undefined, v);
    return v.id;
  }
  // Mavjud texnikaning turi/sig'imi tuzatilgan bo'lsa yangilanadi, nofaoli qayta yoqiladi
  if (cur.type !== type || String(cur.capacityM3 ?? "") !== String(capacityM3 ?? "") || !cur.isActive) {
    const v = await tx.vehicle.update({ where: { id: cur.id }, data: { type, capacityM3, isActive: true } });
    await audit(tx, userId, "UPDATE", "Vehicle", v.id, cur, v);
  }
  return cur.id;
}

/** Formadagi haydovchi maydonlari → Employee ustunlari (texnika ham ochiladi). */
async function driverData(tx: Prisma.TransactionClient, userId: string, d: DriverInput) {
  return {
    vehicleId: await driverVehicleId(tx, userId, d),
    licenseNo: d.licenseNo, licenseCategory: d.licenseCategory, licenseExpiry: d.licenseExpiry,
  };
}

/** Bo'sh — `null`; raqam bo'lmasa ham `null` (qiymat o'chadi, saqlash to'xtamaydi). */
const zMoney = z.string().trim().optional().transform((v) => {
  if (!v) return null;
  const n = num(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
});

/** Karta tahriri — tezkor formada yo'q, otdel kadr to'ldiradigan qo'shimcha maydonlar. */
const cardSchema = schema.omit({ login: true, password: true }).extend({
  driverFields: zOpt, // "1" — kartada texnika bo'limi ochiq edi, maydonlari saqlansin
  tabelNo: zOpt,
  subdivision: zOpt,
  tariffRate: zMoney,
  firedAt: zDate,
  passportSeries: zOpt,
  pinfl: zOpt,
  passportIssuedBy: zOpt,
  passportIssuedAt: zDate,
  address: zOpt,
  education: zOpt,
  maritalStatus: zOpt,
});

/**
 * Kirish ma'lumotlarini xodimga SMS bilan yuborish (login berildi / parol almashdi).
 * Parolni ERP hech qayerda ochiq saqlamaydi, shuning uchun uni faqat SHU paytda —
 * kadr kiritgan zahoti — yuborish mumkin. `SmsLog` ga maskalangan holda tushadi.
 */
async function loginSms(template: "login_granted" | "password_changed", phone: string | null, login: string, password: string) {
  const { origin } = await publicOrigin();
  return template === "login_granted"
    ? sendSms("login_granted", phone, { login, password, url: `${origin}/login` })
    : sendSms("password_changed", phone, { login, password });
}

/**
 * Login yaratadi (tranzaksiya ichida). Rol: bo'lim lavozimi bo'lsa o'sha bo'limning roli,
 * haydovchi lavozimi bo'lsa DRIVER — haydovchi ilovada faqat o'z reyslarini ko'radi.
 */
async function createLoginFor(tx: Prisma.TransactionClient, fullName: string, role: Role | null, login: string, password: string) {
  if (!role) throw new Error("Bu lavozim uchun tizim roli yo'q");
  if (login.length < 3) throw new Error("Login kamida 3 belgi");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  return tx.user.create({ data: { login: login.toLowerCase(), fullName, role, passwordHash: await hashPassword(password) } });
}

export async function createEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["HR", "LOGISTICS"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const deptRole = roleForPosition(d.position);
  const driver = await isDriverPosition(d.position);
  const hasCreds = !!(d.login && d.password);
  // Ishchi lavozimda kadr qaysi bo'lim huquqini tanlagan bo'lsa — login shu rol bilan ochiladi
  const chosen = (LOGIN_ROLES as string[]).includes(d.role ?? "") ? (d.role as Role) : null;
  // Ro'yxatdan tanlangan xodim allaqachon brigadir bo'lsa — bo'lim tanlanmasa ham BRIGADIER
  const leader = d.employeeId ? await isBrigadeLeader(d.employeeId) : false;
  // Bo'lim lavozimi — login majburiy; haydovchi, brigadir va tanlangan bo'lim — ixtiyoriy (login yozilsa ochiladi)
  const role: Role | null = deptRole ?? (hasCreds ? (chosen ?? (driver ? "DRIVER" : leader ? "BRIGADIER" : null)) : null);
  if (deptRole && !hasCreds) return { error: `"${d.position}" lavozimi tizimga kiradi — login va parol kiriting` };
  if (chosen && !hasCreds) return { error: "Login va parol kiriting yoki bo'limni «login kerak emas» qilib qo'ying" };
  if (role && !["HR", "DIRECTOR"].includes(s.role)) return { error: "Tizimga kiradigan xodimni faqat Otdel kadr yoki direktor qo'sha oladi" };

  // Ro'yxatdan tanlangan xodim: dublikat karta ochilmaydi — login beriladi, lavozim/telefon yangilanadi
  if (d.employeeId) {
    const cur = await db.employee.findUnique({ where: { id: d.employeeId } });
    if (!cur) return { error: "Tanlangan xodim topilmadi" };
    if (cur.userId) return { error: `${cur.fullName} — bu xodimda login bor` };
    if (!role && (d.login || d.password)) return { error: `"${d.position}" lavozimi tizimga kirmaydi — login uchun bo'limni tanlang` };
    let attachedVehicleId: string | null = null;
    try {
      await db.$transaction(async (tx) => {
        const user = role && d.login && d.password ? await createLoginFor(tx, d.fullName, role, d.login, d.password) : null;
        // Texnika faqat raqam yozilgan bo'lsa yangilanadi — bo'sh forma mavjud biriktirishni uzmasin
        const extra = driver && d.plate ? await driverData(tx, s.userId, d) : {};
        const e = await tx.employee.update({
          where: { id: cur.id },
          data: {
            fullName: d.fullName, position: d.position, isActive: true,
            ...(d.phone ? { phone: d.phone } : {}),
            ...(d.hiredAt ? { hiredAt: d.hiredAt } : {}),
            ...(d.birthDate ? { birthDate: d.birthDate } : {}),
            ...(d.note ? { note: d.note } : {}),
            ...(user ? { userId: user.id } : {}),
            ...extra,
          },
        });
        attachedVehicleId = e.vehicleId;
        await audit(tx, s.userId, "UPDATE", "Employee", e.id, cur, { ...e, login: user?.login, role, via: "xodimlar-formasi" });
      });
    } catch (e) {
      const m = String(e);
      if (m.includes("Unique constraint")) return { error: "Bu login band" };
      if (e instanceof Error && !m.includes("prisma")) return { error: e.message };
      throw e;
    }
    if (driver) pushEmployeeSilently(cur.id);
    if (attachedVehicleId) pushVehicleSilently(attachedVehicleId);
    revalidatePath("/employees"); revalidatePath("/otdel-kadr"); revalidatePath("/settings"); revalidatePath("/drivers"); revalidatePath("/trips");
    if (!role || !d.login) return { ok: true, note: `${d.fullName} — lavozimi «${d.position}» qilib belgilandi.` };
    return { ok: true, note: smsNote(await loginSms("login_granted", d.phone ?? cur.phone, d.login, d.password!)) };
  }

  if (driver && !d.plate) return { error: "Haydovchi uchun mashina davlat raqamini kiriting — reys shu texnika bilan ochiladi" };

  let createdId: string | null = null;
  let vehicleId: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      const user = role ? await createLoginFor(tx, d.fullName, role, d.login!, d.password!) : null;
      // Haydovchi bo'lsa texnikasi ham shu yerda ochiladi/biriktiriladi
      const extra = driver ? await driverData(tx, s.userId, d) : {};
      const e = await tx.employee.create({ data: { fullName: d.fullName, position: d.position, phone: d.phone, hiredAt: d.hiredAt, birthDate: d.birthDate, note: d.note, userId: user?.id, ...extra } });
      createdId = e.id;
      vehicleId = e.vehicleId;
      await audit(tx, s.userId, "CREATE", "Employee", e.id, undefined, { ...e, login: user?.login, role });
    });
  } catch (e) {
    const m = String(e);
    if (m.includes("Unique constraint")) return { error: "Bu login band" };
    if (e instanceof Error && !m.includes("prisma")) return { error: e.message };
    throw e;
  }
  // Haydovchi — haydovchi ilovasida ham paydo bo'lsin (ECO o'chiq bo'lsa jim o'tadi)
  if (createdId && driver) pushEmployeeSilently(createdId);
  if (vehicleId) pushVehicleSilently(vehicleId);
  revalidatePath("/employees"); revalidatePath("/settings"); revalidatePath("/drivers"); revalidatePath("/trips");

  // Tizimga kiradigan xodim bo'lsa — login va parol SMS bilan. Ketmasa ham xodim yaratilgan:
  // natija `note` da qaytadi, kadr parolni o'zi aytishi kerakligini ko'radi.
  if (!role) return { ok: true };
  return { ok: true, note: smsNote(await loginSms("login_granted", d.phone, d.login!, d.password!)) };
}

/**
 * Mavjud xodimga login berish.
 * Bo'lim (rol) formada tanlanadi — shuning uchun ishchi lavozimdagi xodim ham
 * (masalan "Skladchi") kerakli bo'lim bilan tizimga kira oladi; kadr lavozimi o'zgarmaydi.
 * Tanlanmagan bo'lsa rol lavozimdan olinadi (bo'lim lavozimi yoki haydovchi).
 */
export async function grantLogin(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["HR"]);
  const login = String(fd.get("login") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const wanted = String(fd.get("role") ?? "").trim();
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (e.userId) return { error: "Bu xodimda login bor" };
  if (!e.isActive) return { error: `${e.fullName} nofaol — avval "Yoqish" tugmasi bilan ro'yxatga qaytaring` };
  const chosen = (LOGIN_ROLES as string[]).includes(wanted) ? (wanted as Role) : null;
  const role: Role | null = chosen
    ?? roleForPosition(e.position)
    ?? ((await isDriverPosition(e.position)) ? "DRIVER" : (await isBrigadeLeader(employeeId)) ? "BRIGADIER" : null);
  if (!role) return { error: `"${e.position}" lavozimi tizimga kirmaydi — qaysi bo'lim uchun login kerakligini tanlang` };
  try {
    await db.$transaction(async (tx) => {
      const u = await createLoginFor(tx, e.fullName, role, login, password);
      await tx.employee.update({ where: { id: employeeId }, data: { userId: u.id } });
      await audit(tx, s.userId, "UPDATE", "Employee", employeeId, undefined, { login: u.login, role: u.role });
    });
  } catch (err) {
    const m = String(err);
    if (m.includes("Unique constraint")) return { error: "Bu login band" };
    if (err instanceof Error && !m.includes("prisma")) return { error: err.message };
    throw err;
  }
  revalidatePath("/employees"); revalidatePath("/settings");
  return { ok: true, note: smsNote(await loginSms("login_granted", e.phone, login, password)) };
}

/** Xodimni o'chirish/yoqish — bog'langan login ham birga bloklanadi/ochiladi. */
export async function toggleEmployee(id: string) {
  const s = await requireSession(["HR"]);
  const cur = await db.employee.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id }, data: { isActive: !cur.isActive } });
    if (cur.userId) await tx.user.update({ where: { id: cur.userId }, data: { isActive: !cur.isActive } });
    await audit(tx, s.userId, "UPDATE", "Employee", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  });
  // O'chirilgan haydovchi ilovaga ham kira olmasin; qayta yoqilsa a'zoligi tiklanadi
  if (await isDriverPosition(cur.position)) pushEmployeeSilently(id);
  revalidatePath("/employees"); revalidatePath("/settings"); revalidatePath("/drivers");
}

/* ───────── Ishdan bo'shatish ───────── */

const dismissSchema = z.object({
  firedAt: zStr("Bo'shatilgan sana kerak").transform((v) => new Date(v)),
  // Tayyor sabab tanlanadi; "Boshqa sabab" bo'lsa matn maydoni ochiladi va shu ustun turadi
  reason: zOpt,
  reasonText: zOpt,
});

function dismissPaths() {
  revalidatePath("/employees"); revalidatePath("/otdel-kadr"); revalidatePath("/settings");
  revalidatePath("/drivers"); revalidatePath("/trips");
}

/**
 * Xodimni ishdan bo'shatish: sana va sabab kartaga yoziladi, xodim nofaol bo'ladi,
 * logini bloklanadi va biriktirilgan texnikasi bo'shaydi (boshqa haydovchiga beriladi).
 * Reyslar tarixi va hujjatlari joyida qoladi — karta o'chmaydi.
 */
export async function dismissEmployee(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["HR"]);
  const r = parseForm(dismissSchema, fd);
  if ("error" in r) return { error: r.error };
  const firedAt = r.data.firedAt;
  if (Number.isNaN(firedAt.getTime())) return { error: "Bo'shatilgan sana noto'g'ri" };
  const reason = r.data.reasonText ?? r.data.reason;
  if (!reason) return { error: "Bo'shatish sababini tanlang yoki yozing" };

  const before = await db.employee.findUniqueOrThrow({ where: { id } });
  if (before.userId === s.userId) return { error: "O'zingizni ishdan bo'shata olmaysiz" };
  if (before.firedAt) return { error: "Bu xodim allaqachon ishdan bo'shatilgan" };
  // Yo'ldagi reys egasiz qolmasin: avval reys yakunlanadi yoki bekor qilinadi
  const open = await db.trip.findMany({ where: { driverId: id, status: { in: ["PLANNED", "LOADED", "ON_ROAD"] } }, select: { deliveryNoteNo: true } });
  if (open.length) return { error: `Haydovchida ochiq reys bor: ${open.map((t) => t.deliveryNoteNo).join(", ")} — avval yakunlang yoki bekor qiling` };
  if (before.hiredAt && firedAt < before.hiredAt) return { error: "Bo'shatilgan sana ishga kirgan sanadan oldin bo'lishi mumkin emas" };

  const after = await db.$transaction(async (tx) => {
    const e = await tx.employee.update({
      where: { id },
      data: { firedAt, firedReason: reason, isActive: false, vehicleId: null },
    });
    if (before.userId) await tx.user.update({ where: { id: before.userId }, data: { isActive: false } });
    await audit(tx, s.userId, "UPDATE", "Employee", id, before, e);
    return e;
  });

  // Haydovchi bo'lsa ilovaga ham kira olmasin; texnikasi bo'shagani ECO'da ham ko'rinsin
  if (await isDriverPosition(before.position)) pushEmployeeSilently(id);
  if (before.vehicleId) pushVehicleSilently(before.vehicleId);
  dismissPaths();
  return { ok: true, note: `${after.fullName} ishdan bo'shatildi — ${reason}` };
}

/** Bo'shatishni bekor qilish: sana va sabab tozalanadi, xodim va logini qaytadi. */
export async function restoreEmployee(id: string): Promise<ActionState> {
  const s = await requireSession(["HR"]);
  const before = await db.employee.findUniqueOrThrow({ where: { id } });
  if (!before.firedAt) return { error: "Bu xodim ishdan bo'shatilmagan" };
  await db.$transaction(async (tx) => {
    const e = await tx.employee.update({ where: { id }, data: { firedAt: null, firedReason: null, isActive: true } });
    if (before.userId) await tx.user.update({ where: { id: before.userId }, data: { isActive: true } });
    await audit(tx, s.userId, "UPDATE", "Employee", id, before, e);
  });
  if (await isDriverPosition(before.position)) pushEmployeeSilently(id);
  dismissPaths();
  // Texnika qaytarilmaydi — bo'shagan mikser boshqa haydovchiga berilgan bo'lishi mumkin
  return { ok: true, note: "Xodim ishga qaytarildi — texnikasini kartadan qayta biriktiring" };
}

/** Xodim kartasi: otdel kadr F.I.O., lavozim, telefon va sanalarni tuzatadi. */
export async function updateEmployee(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["HR"]);
  const r = parseForm(cardSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const before = await db.employee.findUniqueOrThrow({ where: { id } });

  // Lavozim o'zgarishi rolni o'zgartirmaydi: login berilgan xodimning roli o'z joyida qoladi
  const newRole = roleForPosition(d.position);
  if (before.userId && newRole !== roleForPosition(before.position)) {
    return { error: "Login berilgan xodimning bo'limini o'zgartirib bo'lmaydi — eski loginni bloklab, yangi karta oching" };
  }
  if (!before.userId && newRole) {
    return { error: `"${d.position}" tizimga kiradigan bo'lim — bu yerdan emas, "Login berish" orqali tayinlanadi` };
  }

  // Texnika/guvohnoma maydonlari kartada ochiq bo'lsa (haydovchi lavozimi yoki "Texnika biriktirish"
  // bosilgan) saqlanadi; bo'lim yopiq bo'lsa mavjud biriktirish tegilmaydi
  const driver = await isDriverPosition(d.position);
  const vehicleSent = driver || d.driverFields === "1";
  // Ishdan bo'shagan sana qo'yilsa xodim nofaol bo'ladi, tozalansa — qaytadi (Excel importdagi qoida bilan bir xil)
  const isActive = d.firedAt ? false : before.firedAt ? true : before.isActive;
  const after = await db.$transaction(async (tx) => {
    const extra = vehicleSent ? await driverData(tx, s.userId, d) : {};
    const e = await tx.employee.update({
      where: { id },
      data: {
        fullName: d.fullName, position: d.position, phone: d.phone, hiredAt: d.hiredAt, birthDate: d.birthDate, note: d.note,
        tabelNo: d.tabelNo, subdivision: d.subdivision, tariffRate: d.tariffRate, firedAt: d.firedAt, isActive,
        passportSeries: d.passportSeries, pinfl: d.pinfl, passportIssuedBy: d.passportIssuedBy, passportIssuedAt: d.passportIssuedAt,
        address: d.address, education: d.education, maritalStatus: d.maritalStatus,
        ...extra,
      },
    });
    if (before.userId && before.fullName !== d.fullName) await tx.user.update({ where: { id: before.userId }, data: { fullName: d.fullName } });
    if (before.userId && before.isActive !== isActive) await tx.user.update({ where: { id: before.userId }, data: { isActive } });
    await audit(tx, s.userId, "UPDATE", "Employee", id, before, e);
    return e;
  });

  // Haydovchi bo'lsa ECO kartasi ham yangilansin (telefon — yagona kalit)
  if (driver || (await isDriverPosition(before.position))) pushEmployeeSilently(id);
  if (after.vehicleId && after.vehicleId !== before.vehicleId) pushVehicleSilently(after.vehicleId);
  revalidatePath("/employees"); revalidatePath("/otdel-kadr"); revalidatePath("/drivers"); revalidatePath("/trips");
  return { ok: true };
}

/* ───────── Login boshqaruvi (otdel kadr) ───────── */

/** Xodim kartasidagi loginni topadi va o'z akkauntiga tegishni taqiqlaydi. */
async function loginTarget(employeeId: string, sessionUserId: string) {
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, include: { user: true } });
  if (!e.user) return { error: "Bu xodimda login yo'q" as const };
  if (e.user.id === sessionUserId) return { error: "O'z loginingizni bu yerdan o'zgartirib bo'lmaydi" as const };
  return { employee: e, user: e.user };
}

/** Login nomini almashtirish. */
export async function changeLogin(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["HR"]);
  const t = await loginTarget(employeeId, s.userId);
  if ("error" in t) return { error: t.error };
  const login = String(fd.get("login") ?? "").trim().toLowerCase();
  if (login.length < 3) return { error: "Login kamida 3 belgi" };
  if (login === t.user.login) return { ok: true };
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: t.user.id }, data: { login } });
      await audit(tx, s.userId, "UPDATE", "User", t.user.id, { login: t.user.login }, { login });
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu login band" };
    throw e;
  }
  revalidatePath(`/employees/${employeeId}`); revalidatePath("/employees"); revalidatePath("/settings");
}

/** Parolni almashtirish — eski parol so'ralmaydi, otdel kadr yangisini beradi. */
export async function resetEmployeePassword(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["HR"]);
  const t = await loginTarget(employeeId, s.userId);
  if ("error" in t) return { error: t.error };
  const password = String(fd.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: t.user.id }, data: { passwordHash: await hashPassword(password) } });
    await revokeSessions(tx, t.user.id); // xodimning eski veb/mobil sessiyalari tugaydi
    await audit(tx, s.userId, "UPDATE", "User", t.user.id, undefined, { passwordReset: true });
  });
  revalidatePath(`/employees/${employeeId}`); revalidatePath("/settings");
  return { ok: true, note: smsNote(await loginSms("password_changed", t.employee.phone, t.user.login, password)) };
}

/**
 * Tizimga kirishni bloklash / ochish. Xodimning o'zi faol qoladi —
 * ishdan bo'shatish uchun xodim qatoridagi "O'chirish" ishlatiladi.
 */
export async function toggleEmployeeLogin(employeeId: string) {
  const s = await requireSession(["HR"]);
  const t = await loginTarget(employeeId, s.userId);
  if ("error" in t) throw new Error(t.error); // UI bunday holatda tugmani ko'rsatmaydi
  // Ishdan bo'shatilgan xodimning logini shu yerdan ochilmaydi — avval xodimning o'zi yoqiladi
  if (!t.employee.isActive) throw new Error("Xodim nofaol — avval uni \"Yoqish\" tugmasi bilan faollashtiring");
  const isActive = !t.user.isActive;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: t.user.id }, data: { isActive } });
    await audit(tx, s.userId, "UPDATE", "User", t.user.id, { isActive: t.user.isActive }, { isActive });
  });
  revalidatePath(`/employees/${employeeId}`); revalidatePath("/employees"); revalidatePath("/settings");
}
