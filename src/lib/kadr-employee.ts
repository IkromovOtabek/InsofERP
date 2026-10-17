import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, revokeSessions, type Perms, type Session } from "@/lib/auth";
import { passwordProblem } from "@/lib/password-policy";
import { audit } from "@/lib/audit";
import { POSITIONS, LOGIN_ROLE_OPTIONS, roleForPosition, isDriverPosition } from "@/lib/positions";
import { isBrigadeLeader } from "@/lib/brigades";
import type { Prisma, Role } from "@/generated/prisma";
import { pushEmployeeSilently, pushVehicleSilently } from "@/lib/eco/people";
import { parseForm, zStr, zOpt } from "@/lib/action";
import { num } from "@/lib/excel";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { duplicateProblem, openTripsProblem, releaseOnDismiss, zPhone, zPinfl } from "@/lib/kadr-validate";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { loginTemplateFor } from "@/lib/perm-template";
import { buildSchedule, normTime, scheduleProblem } from "@/lib/attendance-time";
import { kindFromField, OTHER_DOC_KIND } from "@/lib/kadr";
import { saveEmployeeFile, removeEmployeeFile, photoEntry } from "@/lib/uploads";
import { LOGIN_HINT, LOGIN_RE } from "@/lib/self-account";

/**
 * Xodim kartasi va login boshqaruvi — veb (`/employees`, `/otdel-kadr` server action'lari) va mobil ilova
 * (`lib/mobile/kadr-extra.ts`) uchun bitta qoida. Ruxsat (`requireAction` / `canDo`) chaqiruvchida tekshiriladi,
 * bu yerda — biznes qoidalari (direktor hisobi, o'z logini, bo'lim lavozimi, haydovchi texnikasi...).
 * Kirish — `FormData` (veb formasi bilan aynan bir xil maydonlar); mobil uni ilova maydonlaridan yig'adi.
 */

export type KadrActor = Pick<Session, "userId" | "role">;
export type KadrResult = { error: string } | { ok: true; note?: string; id?: string; same?: boolean };

// Noto'g'ri sana (masalan "31.02.1990" yoki matn) Invalid Date bo'lib Prisma xatosi (500) berardi — forma xatosi bo'lsin
const zDate = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900 || d.getFullYear() > 2100) { ctx.addIssue({ code: "custom", message: `Sana noto'g'ri: «${v}»` }); return z.NEVER; }
  return d;
});

/** Login berishda tanlanadigan bo'limlar: bo'lim lavozimlari + haydovchi va brigadir ilovasi. */
export const LOGIN_ROLES: Role[] = LOGIN_ROLE_OPTIONS.map((o) => o.value);

/**
 * Moliyaviy va kadr loginlari: shu rollar bilan login ochish, rolni shularga o'tkazish yoki shu roldagi
 * xodim parolini tiklash — pul va kadr ma'lumotlariga kirish beradi. Otdel kadr buni bajara oladi
 * (zavodda kundalik ish), lekin direktor darhol xabar oladi va auditda alohida belgilanadi.
 */
const SENSITIVE_ROLES: Role[] = ["ACCOUNTING", "CASHIER", "FINANCE", "HR", "PROCUREMENT"];
const isSensitive = (r: Role | null | undefined) => !!r && SENSITIVE_ROLES.includes(r);

/** Direktorga xabar (faqat direktor o'zi bajarmagan bo'lsa). Javobni kutmaydi. */
function alertDirector(callerRole: Role, callerId: string, employeeId: string, title: string, body: string) {
  if (callerRole === "DIRECTOR") return;
  notifyAfter(async () => {
    const who = await db.user.findUnique({ where: { id: callerId }, select: { fullName: true } });
    await notifyRoles(["DIRECTOR"], {
      type: "SENSITIVE_LOGIN",
      title,
      body: `${body} · bajardi: ${who?.fullName ?? "?"}`,
      link: { key: "employees", id: employeeId },
    });
  });
}

const roleLabel = (r: Role) => LOGIN_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

const schema = z.object({
  // Ro'yxatdan tanlangan mavjud xodim — yangi karta ochilmaydi, shu kartaga login beriladi
  employeeId: zOpt,
  // Ishchi lavozimda login qaysi bo'lim huquqi bilan ochilishi (bo'lim lavozimida kerak emas)
  role: zOpt,
  fullName: zStr("F.I.O. kerak"),
  position: zStr("Lavozim kerak"),
  phone: zPhone,
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
  // Ish haqi turi (`lib/hr/payroll.ts`): forma yubormasa — kartadagisi o'zgarmaydi
  payType: z.enum(["SALARY", "DAILY", "HOURLY", "PIECE"]).optional(),
  firedAt: zDate,
  passportSeries: zOpt,
  pinfl: zPinfl,
  passportIssuedBy: zOpt,
  passportIssuedAt: zDate,
  address: zOpt,
  education: zOpt,
  maritalStatus: zOpt,
  // Ish vaqti (smena): davomatda kechikish va erta ketish shundan hisoblanadi
  workStart: zOpt,
  workEnd: zOpt,
  workNote: zOpt,
});

/**
 * Kirish ma'lumotlari (login berildi / parol almashdi) haqida kadrga eslatma.
 * Parol xodimga avtomatik YUBORILMAYDI: parolni chatga yoki xabarga ochiq yozish xavfsiz emas.
 * Kadr login va parolni xodimga o'zi yetkazadi; telefon raqami to'g'ri
 * bo'lsa xodim kirish sahifasida «Telegram kod» bilan ham kira oladi.
 */
function credentialsNote(kind: "login_granted" | "password_changed", rawPhone: string | null, login: string): string {
  const phone = normalizePhone(rawPhone);
  const how = kind === "login_granted"
    ? `Login «${login}» berildi. Login va parolni xodimga o'zingiz yetkazing.`
    : `«${login}» paroli yangilandi. Yangi parolni xodimga o'zingiz yetkazing.`;
  return phone
    ? `${how} Xodim ${formatPhone(phone)} raqami bilan Telegram orqali kod olib ham kira oladi.`
    : `${how} Kartada to'g'ri telefon raqami yo'q — Telegram kod bilan kirish ishlamaydi.`;
}

const DIRECTOR_ONLY = "Direktor hisobini faqat direktor boshqaradi";
/** IT superadmin hisobi (SSO) korxona ichidan boshqarilmaydi — direktor ham tegmaydi (`nav.ts` Role izohi). */
const SUPERADMIN_ONLY = "IT hisobini korxona ichidan boshqarib bo'lmaydi";
/** SUPERADMIN korxona ichida direktor huquqi bilan ishlaydi. */
const isTop = (r: Role) => r === "DIRECTOR" || r === "SUPERADMIN";

/**
 * Xodimga bog'langan login direktorniki bo'lsa — faqat direktor tegina oladi.
 * Aks holda otdel kadr direktor parolini almashtirib, uning hisobini egallab olishi mumkin edi.
 */
async function directorGuard(userId: string | null, callerRole: Role): Promise<string | null> {
  if (!userId) return null;
  const u = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (u?.role === "SUPERADMIN" && callerRole !== "SUPERADMIN") return SUPERADMIN_ONLY;
  return u?.role === "DIRECTOR" && !isTop(callerRole) ? DIRECTOR_ONLY : null;
}

/**
 * Login yaratadi (tranzaksiya ichida). Rol: bo'lim lavozimi bo'lsa o'sha bo'limning roli,
 * haydovchi lavozimi bo'lsa DRIVER — haydovchi ilovada faqat o'z reyslarini ko'radi.
 */
async function createLoginFor(tx: Prisma.TransactionClient, callerRole: Role, fullName: string, role: Role | null, login: string, password: string, perms?: Perms) {
  if (!role) throw new Error("Bu lavozim uchun tizim roli yo'q");
  if (role === "DIRECTOR" && !isTop(callerRole)) throw new Error(DIRECTOR_ONLY);
  if (!LOGIN_RE.test(login.toLowerCase())) throw new Error(`Login: ${LOGIN_HINT}`);
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  return tx.user.create({ data: { login: login.toLowerCase(), fullName, role, passwordHash: await hashPassword(password), ...(perms ? { perms } : {}) } });
}

/**
 * Lavozimning login shabloni (direktor belgilagan): rol tanlanmagan bo'lsa shablondagi asosiy bo'lim olinadi,
 * ruxsatlar esa login shablondagi bo'lim bilan ochilsa nusxalanadi (keyin direktor Ruxsatlar'da o'zgartira oladi).
 */
const templatePerms = (tpl: { role: Role; perms: Perms | undefined } | null, role: Role | null) =>
  tpl && role === tpl.role ? tpl.perms : undefined;

/** Xodim qo'shish (Xodimlar → tezkor forma): yangi karta yoki ro'yxatdan tanlangan kartaga login. */
export async function createEmployeeCore(s: KadrActor, fd: FormData): Promise<KadrResult> {
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
  // Tizimga kiradigan ishchi lavozim (login shabloni) — bo'lim tanlanmasa shablondagi bo'lim
  const tpl = deptRole ? null : await loginTemplateFor(d.position);
  const role: Role | null = deptRole ?? (hasCreds ? (chosen ?? tpl?.role ?? (driver ? "DRIVER" : leader ? "BRIGADIER" : null)) : null);
  const perms = templatePerms(tpl, role);
  if (deptRole && !hasCreds) return { error: `"${d.position}" lavozimi tizimga kiradi — login va parol kiriting` };
  if (chosen && !hasCreds) return { error: "Login va parol kiriting yoki bo'limni «login kerak emas» qilib qo'ying" };
  if (role && !["HR", "DIRECTOR"].includes(s.role)) return { error: "Tizimga kiradigan xodimni faqat Otdel kadr yoki direktor qo'sha oladi" };
  if (role === "DIRECTOR" && !isTop(s.role)) return { error: DIRECTOR_ONLY };
  const dup = await duplicateProblem(d.employeeId, d.phone);
  if (dup) return { error: dup };

  // Ro'yxatdan tanlangan xodim: dublikat karta ochilmaydi — login beriladi, lavozim/telefon yangilanadi
  if (d.employeeId) {
    const cur = await db.employee.findUnique({ where: { id: d.employeeId } });
    if (!cur) return { error: "Tanlangan xodim topilmadi" };
    if (cur.userId) return { error: `${cur.fullName} — bu xodimda login bor` };
    // Bo'shatilgan xodim bu forma orqali "jim" qaytarilmaydi — firedAt qolib ketadi va audit yo'qoladi
    if (cur.firedAt || !cur.isActive) return { error: `${cur.fullName} bo'shatilgan — avval kartadan «Ishga qaytarish»` };
    // Logistika faqat faol haydovchi kartasini to'ldiradi: boshqa bo'lim xodimini qayta nomlash yoki bo'shatilganni qaytarish — kadr ishi
    if (!["HR", "DIRECTOR"].includes(s.role) && (!driver || !(await isDriverPosition(cur.position)))) {
      return { error: "Bu xodimni faqat Otdel kadr o'zgartira oladi" };
    }
    if (!role && (d.login || d.password)) return { error: `"${d.position}" lavozimi tizimga kirmaydi — login uchun bo'limni tanlang` };
    let attachedVehicleId: string | null = null;
    try {
      await db.$transaction(async (tx) => {
        const user = role && d.login && d.password ? await createLoginFor(tx, s.role, d.fullName, role, d.login, d.password, perms) : null;
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
        await audit(tx, s.userId, "UPDATE", "Employee", e.id, cur, { ...e, login: user?.login, role, via: "xodimlar-formasi", ...(user && perms ? { shablon: d.position } : {}), ...(user && isSensitive(role) ? { sensitiveLogin: true, by: s.role } : {}) });
      });
    } catch (e) {
      const m = String(e);
      if (m.includes("Unique constraint")) return { error: "Bu login band" };
      if (e instanceof Error && !m.includes("prisma")) return { error: e.message };
      throw e;
    }
    if (driver) pushEmployeeSilently(cur.id);
    if (attachedVehicleId) pushVehicleSilently(attachedVehicleId);
    if (role && d.login && isSensitive(role)) alertDirector(s.role, s.userId, cur.id, `Moliyaviy/kadr login berildi — ${roleLabel(role)}`, `${d.fullName} · login «${d.login.toLowerCase()}»`);
    if (!role || !d.login) return { ok: true, id: cur.id, note: `${d.fullName} — lavozimi «${d.position}» qilib belgilandi.` };
    return { ok: true, id: cur.id, note: credentialsNote("login_granted", d.phone ?? cur.phone, d.login.toLowerCase()) };
  }

  if (driver && !d.plate) return { error: "Haydovchi uchun mashina davlat raqamini kiriting — reys shu texnika bilan ochiladi" };

  let createdId: string | null = null;
  let vehicleId: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      const user = role ? await createLoginFor(tx, s.role, d.fullName, role, d.login!, d.password!, perms) : null;
      // Haydovchi bo'lsa texnikasi ham shu yerda ochiladi/biriktiriladi
      const extra = driver ? await driverData(tx, s.userId, d) : {};
      const e = await tx.employee.create({ data: { fullName: d.fullName, position: d.position, phone: d.phone, hiredAt: d.hiredAt, birthDate: d.birthDate, note: d.note, userId: user?.id, ...extra } });
      createdId = e.id;
      vehicleId = e.vehicleId;
      await audit(tx, s.userId, "CREATE", "Employee", e.id, undefined, { ...e, login: user?.login, role, ...(user && perms ? { shablon: d.position } : {}), ...(user && isSensitive(role) ? { sensitiveLogin: true, by: s.role } : {}) });
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
  if (createdId && role && isSensitive(role)) alertDirector(s.role, s.userId, createdId, `Moliyaviy/kadr login yaratildi — ${roleLabel(role)}`, `${d.fullName} (yangi xodim) · login «${d.login!.toLowerCase()}»`);

  // Tizimga kiradigan xodim bo'lsa — kadr login va parolni o'zi yetkazadi (eslatma `note` da).
  if (!role) return { ok: true, id: createdId ?? undefined };
  return { ok: true, id: createdId ?? undefined, note: credentialsNote("login_granted", d.phone, d.login!.toLowerCase()) };
}

/**
 * Mavjud xodimga login berish.
 * Bo'lim (rol) formada tanlanadi — shuning uchun ishchi lavozimdagi xodim ham
 * (masalan "Skladchi") kerakli bo'lim bilan tizimga kira oladi; kadr lavozimi o'zgarmaydi.
 * Tanlanmagan bo'lsa rol lavozimdan olinadi (bo'lim lavozimi yoki haydovchi).
 */
export async function grantLoginCore(s: KadrActor, employeeId: string, fd: FormData): Promise<KadrResult> {
  const login = String(fd.get("login") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  const wanted = String(fd.get("role") ?? "").trim();
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (e.userId) return { error: "Bu xodimda login bor" };
  if (!e.isActive) return { error: `${e.fullName} nofaol — avval "Yoqish" tugmasi bilan ro'yxatga qaytaring` };
  const chosen = (LOGIN_ROLES as string[]).includes(wanted) ? (wanted as Role) : null;
  const tpl = roleForPosition(e.position) ? null : await loginTemplateFor(e.position);
  const role: Role | null = chosen
    ?? roleForPosition(e.position)
    ?? tpl?.role
    ?? ((await isDriverPosition(e.position)) ? "DRIVER" : (await isBrigadeLeader(employeeId)) ? "BRIGADIER" : null);
  const perms = templatePerms(tpl, role);
  if (!role) return { error: `"${e.position}" lavozimi tizimga kirmaydi — qaysi bo'lim uchun login kerakligini tanlang` };
  if (role === "DIRECTOR" && !isTop(s.role)) return { error: DIRECTOR_ONLY };
  try {
    await db.$transaction(async (tx) => {
      const u = await createLoginFor(tx, s.role, e.fullName, role, login, password, perms);
      await tx.employee.update({ where: { id: employeeId }, data: { userId: u.id } });
      await audit(tx, s.userId, "UPDATE", "Employee", employeeId, undefined, { login: u.login, role: u.role, ...(perms ? { shablon: e.position } : {}), ...(isSensitive(role) ? { sensitiveLogin: true, by: s.role } : {}) });
    });
  } catch (err) {
    const m = String(err);
    if (m.includes("Unique constraint")) return { error: "Bu login band" };
    if (err instanceof Error && !m.includes("prisma")) return { error: err.message };
    throw err;
  }
  if (isSensitive(role)) alertDirector(s.role, s.userId, employeeId, `Moliyaviy/kadr login berildi — ${roleLabel(role)}`, `${e.fullName} · login «${login.toLowerCase()}»`);
  return { ok: true, note: credentialsNote("login_granted", e.phone, login.toLowerCase()) };
}

/** Xodimni o'chirish/yoqish — bog'langan login ham birga bloklanadi/ochiladi. */
export async function toggleEmployeeCore(s: KadrActor, id: string): Promise<KadrResult> {
  const cur = await db.employee.findUniqueOrThrow({ where: { id } });
  const denied = await directorGuard(cur.userId, s.role);
  if (denied) return { error: denied };
  if (cur.userId && cur.userId === s.userId) return { error: "O'zingizni o'chira olmaysiz" }; // UI tugmani ko'rsatmaydi
  // Ishdan bo'shatilgan xodim faqat kartadagi "Ishga qaytarish" orqali qaytadi (sana va sabab ham tozalanadi) —
  // aks holda bo'shatilgan holicha logini va ECO kirishi ochilib qolardi
  if (cur.firedAt) return { error: "Bo'shatilgan xodim kartadagi «Ishga qaytarish» tugmasi orqali qaytariladi" };
  try {
    await db.$transaction(async (tx) => {
      const n = await tx.employee.updateMany({ where: { id, isActive: cur.isActive, firedAt: null }, data: { isActive: !cur.isActive } });
      if (n.count === 0) throw new Error("Xodim holati o'zgargan — sahifani yangilang");
      if (cur.userId) await tx.user.update({ where: { id: cur.userId }, data: { isActive: !cur.isActive } });
      await audit(tx, s.userId, "UPDATE", "Employee", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
    });
  } catch (e) {
    if (e instanceof Error && !String(e).includes("prisma")) return { error: e.message };
    throw e;
  }
  // O'chirilgan haydovchi ilovaga ham kira olmasin; qayta yoqilsa a'zoligi tiklanadi
  if (cur.ecoUserId || (await isDriverPosition(cur.position))) pushEmployeeSilently(id);
  return { ok: true, note: cur.isActive ? `${cur.fullName} nofaol qilindi` : `${cur.fullName} faollashtirildi` };
}

/* ───────── Ishdan bo'shatish ───────── */

const dismissSchema = z.object({
  firedAt: zStr("Bo'shatilgan sana kerak").transform((v) => new Date(v)),
  // Tayyor sabab tanlanadi; "Boshqa sabab" bo'lsa matn maydoni ochiladi va shu ustun turadi
  reason: zOpt,
  reasonText: zOpt,
});

/**
 * Xodimni ishdan bo'shatish: sana va sabab kartaga yoziladi, xodim nofaol bo'ladi,
 * logini bloklanadi va biriktirilgan texnikasi bo'shaydi (boshqa haydovchiga beriladi).
 * Reyslar tarixi va hujjatlari joyida qoladi — karta o'chmaydi.
 */
export async function dismissEmployeeCore(s: KadrActor, id: string, fd: FormData): Promise<KadrResult> {
  const r = parseForm(dismissSchema, fd);
  if ("error" in r) return { error: r.error };
  const firedAt = r.data.firedAt;
  if (Number.isNaN(firedAt.getTime())) return { error: "Bo'shatilgan sana noto'g'ri" };
  const reason = r.data.reasonText ?? r.data.reason;
  if (!reason) return { error: "Bo'shatish sababini tanlang yoki yozing" };

  const before = await db.employee.findUniqueOrThrow({ where: { id } });
  if (before.userId === s.userId) return { error: "O'zingizni ishdan bo'shata olmaysiz" };
  const denied = await directorGuard(before.userId, s.role);
  if (denied) return { error: denied };
  if (before.firedAt) return { error: "Bu xodim allaqachon ishdan bo'shatilgan" };
  // Yo'ldagi reys egasiz qolmasin: avval reys yakunlanadi yoki bekor qilinadi
  const trips = await openTripsProblem(id);
  if (trips) return { error: trips };
  if (before.hiredAt && firedAt < before.hiredAt) return { error: "Bo'shatilgan sana ishga kirgan sanadan oldin bo'lishi mumkin emas" };

  const res = await db.$transaction(async (tx) => {
    // Shartli yozuv: parallel bo'shatish yoki shu orada ochilgan reys holatni buzmasin
    const n = await tx.employee.updateMany({ where: { id, firedAt: null }, data: { firedAt, firedReason: reason, isActive: false } });
    if (n.count === 0) return { error: "Bu xodim allaqachon ishdan bo'shatilgan" };
    const late = await openTripsProblem(id, tx);
    if (late) throw new Error(late);
    const freed = await releaseOnDismiss(tx, id);
    if (before.userId) await tx.user.update({ where: { id: before.userId }, data: { isActive: false } });
    const e = await tx.employee.findUniqueOrThrow({ where: { id } });
    await audit(tx, s.userId, "UPDATE", "Employee", id, before, { ...e, ...(freed.brigades.length ? { brigadirlikOlindi: freed.brigades } : {}) });
    return { e, freed };
  }).catch((err: Error) => ({ error: err.message }));
  if ("error" in res) return { error: res.error ?? "Saqlanmadi" };

  // Haydovchi bo'lsa ilovaga ham kira olmasin; texnikasi bo'shagani ECO'da ham ko'rinsin
  pushEmployeeSilently(id);
  if (res.freed.vehicleId) pushVehicleSilently(res.freed.vehicleId);
  const lead = res.freed.brigades.length ? ` · brigadirligi olindi (${res.freed.brigades.join(", ")}) — yangi brigadir tayinlang` : "";
  return { ok: true, note: `${res.e.fullName} ishdan bo'shatildi — ${reason}${lead}` };
}

/** Bo'shatishni bekor qilish: sana va sabab tozalanadi, xodim va logini qaytadi. */
export async function restoreEmployeeCore(s: KadrActor, id: string): Promise<KadrResult> {
  const before = await db.employee.findUniqueOrThrow({ where: { id } });
  if (!before.firedAt) return { error: "Bu xodim ishdan bo'shatilmagan" };
  const denied = await directorGuard(before.userId, s.role);
  if (denied) return { error: denied };
  await db.$transaction(async (tx) => {
    const e = await tx.employee.update({ where: { id }, data: { firedAt: null, firedReason: null, isActive: true } });
    if (before.userId) await tx.user.update({ where: { id: before.userId }, data: { isActive: true } });
    await audit(tx, s.userId, "UPDATE", "Employee", id, before, e);
  });
  if (await isDriverPosition(before.position)) pushEmployeeSilently(id);
  // Texnika qaytarilmaydi — bo'shagan mikser boshqa haydovchiga berilgan bo'lishi mumkin
  return { ok: true, note: "Xodim ishga qaytarildi — texnikasini kartadan qayta biriktiring" };
}

/** Xodim kartasi: otdel kadr F.I.O., lavozim, telefon va sanalarni tuzatadi. */
export async function updateEmployeeCore(s: KadrActor, id: string, fd: FormData): Promise<KadrResult> {
  const r = parseForm(cardSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const before = await db.employee.findUniqueOrThrow({ where: { id } });
  const denied = await directorGuard(before.userId, s.role);
  if (denied) return { error: denied };
  const dup = await duplicateProblem(id, d.phone !== before.phone ? d.phone : null, d.pinfl !== before.pinfl ? d.pinfl : null);
  if (dup) return { error: dup };

  // Lavozim o'zgarishi rolni o'zgartirmaydi: login berilgan xodimning roli o'z joyida qoladi
  const newRole = roleForPosition(d.position);
  if (before.userId && newRole !== roleForPosition(before.position)) {
    return { error: "Login berilgan xodimning bo'limi pastdagi \"Tizimga kirish → Bo'limni almashtirish\" orqali o'zgartiriladi" };
  }
  // Excel importdan bo'lim lavozimi bilan (loginsiz) kelgan karta tahrirlanaversin — faqat lavozimni bo'limga o'zgartirish taqiqlanadi
  if (!before.userId && newRole && d.position !== before.position) {
    return { error: `"${d.position}" tizimga kiradigan bo'lim — bu yerdan emas, "Login berish" orqali tayinlanadi` };
  }

  // Texnika/guvohnoma maydonlari kartada ochiq bo'lsa (haydovchi lavozimi yoki "Texnika biriktirish"
  // bosilgan) saqlanadi; bo'lim yopiq bo'lsa mavjud biriktirish tegilmaydi
  const driver = await isDriverPosition(d.position);
  const vehicleSent = driver || d.driverFields === "1";
  // Ishdan bo'shagan sana qo'yilsa xodim nofaol bo'ladi, tozalansa — qaytadi (Excel importdagi qoida bilan bir xil)
  const isActive = d.firedAt ? false : before.firedAt ? true : before.isActive;
  // Kartada bo'shatish sanasi qo'yilsa — "Ishdan bo'shatish" tugmasidagi qoidalar ham amal qiladi:
  // o'zini bo'shatmaydi, ochiq reysi bor haydovchi bo'shatilmaydi, texnikasi bo'shaydi
  const firing = !!d.firedAt && !before.firedAt;
  if (firing) {
    if (before.userId === s.userId) return { error: "O'zingizni ishdan bo'shata olmaysiz" };
    if (before.hiredAt && d.firedAt! < before.hiredAt) return { error: "Bo'shatilgan sana ishga kirgan sanadan oldin bo'lishi mumkin emas" };
    const trips = await openTripsProblem(id);
    if (trips) return { error: trips };
  }
  // Ish vaqti faqat formada maydoni bo'lsa yoziladi — boshqa chaqiruv mavjud grafikni o'chirib yubormasin
  let workSchedule: string | null | undefined;
  if (fd.has("workStart")) {
    const bad = scheduleProblem(d.workStart, d.workEnd);
    if (bad) return { error: bad };
    workSchedule = buildSchedule(normTime(d.workStart), normTime(d.workEnd), d.workNote);
  }
  const after = await db.$transaction(async (tx) => {
    if (firing) await releaseOnDismiss(tx, id);
    const extra = firing ? { vehicleId: null } : vehicleSent ? await driverData(tx, s.userId, d) : {};
    const e = await tx.employee.update({
      where: { id },
      data: {
        fullName: d.fullName, position: d.position, phone: d.phone, hiredAt: d.hiredAt, birthDate: d.birthDate, note: d.note,
        tabelNo: d.tabelNo, subdivision: d.subdivision, tariffRate: d.tariffRate, firedAt: d.firedAt, isActive,
        ...(d.payType ? { payType: d.payType } : {}),
        ...(!d.firedAt && before.firedAt ? { firedReason: null } : {}),
        passportSeries: d.passportSeries, pinfl: d.pinfl, passportIssuedBy: d.passportIssuedBy, passportIssuedAt: d.passportIssuedAt,
        address: d.address, education: d.education, maritalStatus: d.maritalStatus,
        ...(workSchedule !== undefined ? { workSchedule } : {}),
        ...extra,
      },
    });
    if (before.userId && before.fullName !== d.fullName) await tx.user.update({ where: { id: before.userId }, data: { fullName: d.fullName } });
    if (before.userId && before.isActive !== isActive) await tx.user.update({ where: { id: before.userId }, data: { isActive } });
    await audit(tx, s.userId, "UPDATE", "Employee", id, before, e);
    return e;
  });

  // Haydovchi bo'lsa (yoki ECO'ga ulangan bo'lsa — lavozimi haydovchidan o'zgargan) ECO kartasi ham yangilansin
  if (driver || before.ecoUserId || (await isDriverPosition(before.position))) pushEmployeeSilently(id);
  if (after.vehicleId && after.vehicleId !== before.vehicleId) pushVehicleSilently(after.vehicleId);
  if (firing && before.vehicleId) pushVehicleSilently(before.vehicleId);
  return { ok: true };
}

/* ───────── Login boshqaruvi (otdel kadr) ───────── */

/** Xodim kartasidagi loginni topadi va o'z akkauntiga tegishni taqiqlaydi. */
type LoginTarget = Prisma.EmployeeGetPayload<{ include: { user: true } }>;
async function loginTarget(employeeId: string, session: KadrActor): Promise<{ error: string } | { employee: LoginTarget; user: NonNullable<LoginTarget["user"]> }> {
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, include: { user: true } });
  if (!e.user) return { error: "Bu xodimda login yo'q" };
  // O'z loginiga (rol, parol, login nomi) tegish taqiqlangan — HR o'zini yuqori bo'limga o'tkaza olmaydi
  if (e.user.id === session.userId) return { error: "O'z loginingizni bu yerdan o'zgartirib bo'lmaydi" };
  if (e.user.role === "SUPERADMIN" && session.role !== "SUPERADMIN") return { error: SUPERADMIN_ONLY };
  if (e.user.role === "DIRECTOR" && !isTop(session.role)) return { error: DIRECTOR_ONLY };
  return { employee: e, user: e.user };
}

/** Login nomini almashtirish. `same` — login o'zgarmadi. */
export async function changeLoginCore(s: KadrActor, employeeId: string, fd: FormData): Promise<KadrResult> {
  const t = await loginTarget(employeeId, s);
  if ("error" in t) return { error: t.error };
  const login = String(fd.get("login") ?? "").trim().toLowerCase();
  if (!LOGIN_RE.test(login)) return { error: `Login: ${LOGIN_HINT}` };
  if (login === t.user.login) return { ok: true, same: true };
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: t.user.id }, data: { login } });
      await audit(tx, s.userId, "UPDATE", "User", t.user.id, { login: t.user.login }, { login });
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu login band" };
    throw e;
  }
  return { ok: true, note: `Login «${login}» ga almashtirildi` };
}

/**
 * Login berishda bo'lim (rol) noto'g'ri tanlangan bo'lsa — almashtirish.
 * Kadr lavozimi bo'lim lavozimi bo'lsa (Sotuv, Sklad...) u ham yangi bo'lim nomiga o'tadi;
 * ishchi lavozim (masalan "Skladchi") o'zgarmaydi — faqat qaysi bo'lim huquqi bilan kirishi.
 * Xodimning ochiq sessiyalari (veb va ilova) tugaydi — qayta kirganda yangi bo'limni ko'radi.
 */
export async function changeEmployeeRoleCore(s: KadrActor, employeeId: string, fd: FormData): Promise<KadrResult> {
  const t = await loginTarget(employeeId, s);
  if ("error" in t) return { error: t.error };
  const wanted = String(fd.get("role") ?? "").trim();
  if (!(LOGIN_ROLES as string[]).includes(wanted)) return { error: "Bo'limni tanlang" };
  const role = wanted as Role;
  if (role === t.user.role) return { ok: true, note: "Bo'lim o'zgarmadi" };
  // Direktor huquqini faqat direktor beradi yoki oladi
  if ((role === "DIRECTOR" || t.user.role === "DIRECTOR") && !isTop(s.role)) {
    return { error: "Direktor huquqini faqat direktor bera oladi yoki olib tashlaydi" };
  }
  const dept = POSITIONS.find((p) => p.role === role);
  const oldIsDept = roleForPosition(t.employee.position) !== null;
  const position = dept && oldIsDept ? dept.label : t.employee.position;

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: t.user.id }, data: { role } });
    if (position !== t.employee.position) await tx.employee.update({ where: { id: employeeId }, data: { position } });
    await revokeSessions(tx, t.user.id);
    await audit(tx, s.userId, "UPDATE", "User", t.user.id, { role: t.user.role, position: t.employee.position }, {
      role, position, xodim: t.employee.fullName, login: t.user.login,
      ...(isSensitive(role) || isSensitive(t.user.role) ? { sensitiveLogin: true, by: s.role } : {}),
    });
  });
  if (isSensitive(role)) alertDirector(s.role, s.userId, employeeId, `Bo'lim moliyaviy/kadr huquqiga o'tkazildi — ${roleLabel(role)}`, `${t.employee.fullName} · «${roleLabel(t.user.role)}» → «${roleLabel(role)}» · login «${t.user.login}»`);
  const wasDriver = !!t.employee.ecoUserId || (await isDriverPosition(t.employee.position));
  if (wasDriver || (await isDriverPosition(position))) pushEmployeeSilently(employeeId);
  const label = LOGIN_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
  return { ok: true, note: `Bo'lim «${label}» ga almashtirildi${position !== t.employee.position ? `, lavozim ham «${position}»` : ""}. Xodim tizimga qayta kiradi.` };
}

/** Parolni almashtirish — eski parol so'ralmaydi, otdel kadr yangisini beradi. */
export async function resetEmployeePasswordCore(s: KadrActor, employeeId: string, fd: FormData): Promise<KadrResult> {
  const t = await loginTarget(employeeId, s);
  if ("error" in t) return { error: t.error };
  const password = String(fd.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: t.user.id }, data: { passwordHash: await hashPassword(password) } });
    await revokeSessions(tx, t.user.id); // xodimning eski veb/mobil sessiyalari tugaydi
    await audit(tx, s.userId, "UPDATE", "User", t.user.id, undefined, {
      passwordReset: true, xodim: t.employee.fullName, login: t.user.login, role: t.user.role,
      ...(isSensitive(t.user.role) ? { sensitiveLogin: true, by: s.role } : {}),
    });
  });
  if (isSensitive(t.user.role)) alertDirector(s.role, s.userId, employeeId, `Moliyaviy/kadr login paroli tiklandi — ${roleLabel(t.user.role)}`, `${t.employee.fullName} · login «${t.user.login}»`);
  return { ok: true, note: credentialsNote("password_changed", t.employee.phone, t.user.login) };
}

/**
 * Tizimga kirishni bloklash / ochish. Xodimning o'zi faol qoladi —
 * ishdan bo'shatish uchun xodim qatoridagi "O'chirish" ishlatiladi.
 */
export async function toggleEmployeeLoginCore(s: KadrActor, employeeId: string): Promise<KadrResult> {
  const t = await loginTarget(employeeId, s);
  if ("error" in t) return { error: t.error }; // UI bunday holatda tugmani ko'rsatmaydi
  // Ishdan bo'shatilgan xodimning logini shu yerdan ochilmaydi — avval xodimning o'zi yoqiladi
  if (!t.employee.isActive) return { error: "Xodim nofaol — avval uni \"Yoqish\" tugmasi bilan faollashtiring" };
  const isActive = !t.user.isActive;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: t.user.id }, data: { isActive } });
    await audit(tx, s.userId, "UPDATE", "User", t.user.id, { isActive: t.user.isActive }, { isActive });
  });
  return { ok: true, note: isActive ? "Tizimga kirish ochildi" : "Tizimga kirish bloklandi" };
}

/* ───────── Ish vaqti, surat va hujjat nusxalari (Otdel kadr) ───────── */

const scheduleSchema = z.object({ start: zOpt, end: zOpt, note: zOpt });

/** Bitta xodimning ish vaqti — Otdel kadr → Ish vaqti jadvalidagi qatordan. Hammasi bo'sh — standartga qaytadi. */
export async function setEmployeeScheduleCore(s: KadrActor, employeeId: string, fd: FormData): Promise<KadrResult> {
  const r = parseForm(scheduleSchema, fd);
  if ("error" in r) return { error: r.error };
  const bad = scheduleProblem(r.data.start, r.data.end);
  if (bad) return { error: bad };
  const value = buildSchedule(normTime(r.data.start), normTime(r.data.end), r.data.note);
  const before = await db.employee.findUnique({ where: { id: employeeId }, select: { workSchedule: true } });
  if (!before) return { error: "Xodim topilmadi" };
  if ((before.workSchedule ?? null) === value) return { ok: true, same: true };
  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data: { workSchedule: value } });
    await audit(tx, s.userId, "UPDATE", "Employee", employeeId, { workSchedule: before.workSchedule }, { workSchedule: value });
  });
  return { ok: true };
}

/** Formadagi barcha `doc:<tur>` fayllari — bo'shlari tashlab ketiladi. */
export function documentEntries(fd: FormData) {
  const out: { kind: string; file: File }[] = [];
  for (const [key, value] of fd.entries()) {
    const kind = kindFromField(key);
    if (!kind || !(value instanceof File) || value.size === 0) continue;
    out.push({ kind: kind === OTHER_DOC_KIND ? OTHER_DOC_KIND : kind, file: value });
  }
  return out;
}

/** Tanlangan fayllarni diskka yozadi; birortasi xato bo'lsa yozilganlarini qaytarib o'chiradi. */
export async function saveDocuments(employeeId: string, entries: { kind: string; file: File }[]) {
  const saved: { kind: string; file: string; fileName: string; fileType: string }[] = [];
  for (const e of entries) {
    const r = await saveEmployeeFile(employeeId, e.file);
    if (r && "error" in r) {
      await Promise.all(saved.map((x) => removeEmployeeFile(x.file)));
      return { error: r.error };
    }
    if (r) saved.push({ kind: e.kind, file: r.stored, fileName: r.name, fileType: r.type });
  }
  return { saved };
}

/** Mavjud kartaga hujjat nusxasi qo'shish (`kind` + bir nechta `file`). */
export async function addEmployeeDocumentCore(s: KadrActor, employeeId: string, fd: FormData): Promise<KadrResult> {
  const kind = String(fd.get("kind") ?? "").trim() || OTHER_DOC_KIND;
  const entries = [...fd.getAll("file")].filter((f): f is File => f instanceof File && f.size > 0).map((file) => ({ kind, file }));
  if (entries.length === 0) return { error: "Fayl tanlanmagan" };
  // Avval karta borligi tekshiriladi — yo'q xodim uchun fayl diskka yozilib, egasiz qolmasin
  if (!(await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) return { error: "Xodim topilmadi" };
  const docs = await saveDocuments(employeeId, entries);
  if ("error" in docs) return { error: docs.error! };
  await db.$transaction(async (tx) => {
    await tx.employeeDocument.createMany({ data: docs.saved.map((x) => ({ ...x, employeeId })) });
    await audit(tx, s.userId, "CREATE", "EmployeeDocument", employeeId, undefined, { kind, count: docs.saved.length });
  });
  return { ok: true, note: `${kind} biriktirildi` };
}

/**
 * Kartadagi 3x4 suratni yuklash yoki almashtirish — fayldan ham, kamerada olingan
 * kadrdan ham keladi (`photoEntry` ikkalasini birdek qabul qiladi). Eski surat diskdan ketadi.
 */
export async function updateEmployeePhotoCore(s: KadrActor, employeeId: string, fd: FormData): Promise<KadrResult> {
  const file = photoEntry(fd);
  if (!file) return { error: "Surat tanlanmagan" };
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { photo: true } });
  const saved = await saveEmployeeFile(employeeId, file, { imageOnly: true });
  if (!saved) return { error: "Surat tanlanmagan" };
  if ("error" in saved) return { error: saved.error };
  try {
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: employeeId }, data: { photo: saved.stored } });
      await audit(tx, s.userId, "UPDATE", "Employee", employeeId, { photo: e.photo }, { photo: saved.stored });
    });
  } catch (err) {
    await removeEmployeeFile(saved.stored);
    throw err;
  }
  await removeEmployeeFile(e.photo);
  return { ok: true, note: "Surat saqlandi" };
}

/** Suratni kartadan olib tashlash — fayl ham diskdan ketadi. */
export async function deleteEmployeePhotoCore(s: KadrActor, employeeId: string): Promise<KadrResult> {
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { photo: true } });
  if (!e.photo) return { ok: true, same: true };
  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data: { photo: null } });
    await audit(tx, s.userId, "DELETE", "Employee", employeeId, { photo: e.photo }, undefined);
  });
  await removeEmployeeFile(e.photo);
  return { ok: true, note: "Surat olib tashlandi" };
}

/** Hujjat nusxasini kartadan olib tashlash (`id` — xodim, sahifa yangilanishi uchun). */
export async function deleteEmployeeDocumentCore(s: KadrActor, docId: string): Promise<KadrResult> {
  const doc = await db.employeeDocument.findUniqueOrThrow({ where: { id: docId } });
  await db.$transaction(async (tx) => {
    await tx.employeeDocument.delete({ where: { id: docId } });
    await audit(tx, s.userId, "DELETE", "EmployeeDocument", docId, doc, undefined);
  });
  // Nusxa faylining o'zi diskda qoladi (hujjatlar o'chirilmaydi): nomi auditda, kerak bo'lsa tiklanadi
  return { ok: true, id: doc.employeeId, note: `${doc.kind} olib tashlandi` };
}

/** Lavozimni yoqish/o'chirish. O'chirilgan lavozim yangi xodimga tanlanmaydi, eskilari joyida qoladi. */
export async function toggleWorkPositionCore(s: KadrActor, id: string): Promise<KadrResult> {
  const cur = await db.workPosition.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.workPosition.update({ where: { id }, data: { isActive: !cur.isActive } });
    await audit(tx, s.userId, "UPDATE", "WorkPosition", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  });
  return { ok: true, note: cur.isActive ? `«${cur.name}» yashirildi` : `«${cur.name}» qaytarildi` };
}
