import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { passwordProblem } from "@/lib/password-policy";
import { POSITIONS, roleForPosition } from "@/lib/positions";
import { normalizePhone } from "@/lib/phone";
import { gatewayEnabled, sendGatewayCode } from "@/lib/telegram/gateway";
import { CODE_DELIVERY_HINT, devCodeAllowed, logUndelivered } from "@/lib/telegram/otp";
import { hit } from "@/lib/rate-limit";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import type { Role } from "@/generated/prisma";

/**
 * Kirish sahifasidagi "Ro'yxatdan o'tish" — xodim ariza beradi, login HR/direktor tasdig'idan keyin ochiladi.
 *
 *  1) `submitAccessRequest` — F.I.O., telefon, bo'lim, login, parol → UNVERIFIED ariza + telefonga kod;
 *  2) `verifyAccessRequest` — kod to'g'ri bo'lsa PENDING, Otdel kadr va direktorga xabar;
 *  3) Xodimlar sahifasida `approve`/`reject` (employees/access-actions.ts).
 *
 * Xavfsizlik: ariza hech qachon o'zi login bermaydi; parol faqat bcrypt xeshi bilan saqlanadi;
 * direktor bo'limini so'rab bo'lmaydi; IP va raqam bo'yicha cheklov; kod 5 daqiqa, 5 urinish.
 */

const CODE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Ariza berib bo'ladigan bo'limlar — direktor hisobi faqat direktor qo'li bilan ochiladi. */
export const SIGNUP_POSITIONS = POSITIONS.filter((p) => p.role !== "DIRECTOR").map((p) => p.label);

export type SignupVia = "gateway";
export type SubmitResult =
  | { ok: true; requestId: string; phone: string; via?: SignupVia; devCode?: string }
  | { ok: false; error: string };

export type SignupInput = {
  fullName: string; phone: string; position: string; login: string;
  password: string; password2: string; note?: string | null;
};

/**
 * Tasdiqlash kodi FAQAT Telegram Gateway orqali (SMS kanali yo'q) — ariza beruvchi hali xodim emas,
 * botga ulana olmaydi. Bu yerda hisob mavjudligi masalasi yo'q (yangi ariza), shuning uchun
 * yetkazilmasa aniq tushuntirish qaytariladi; sabab server jurnaliga yoziladi.
 */
async function sendCode(phone: string, code: string, requestId: string): Promise<{ ok: true; via?: SignupVia; devCode?: string } | { ok: false; error: string }> {
  if (gatewayEnabled()) {
    const gw = await sendGatewayCode(phone, code, { ttlSec: CODE_TTL_MS / 1000, payload: `signup:${requestId}` });
    if (gw.ok) return { ok: true, via: "gateway" };
    logUndelivered("signup", phone, `Gateway: ${gw.reason}${gw.error ? ` (${gw.error})` : ""}`);
    if (gw.reason === "RATE_LIMIT") return { ok: false, error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring." };
  } else if (!devCodeAllowed()) {
    logUndelivered("signup", phone, "TELEGRAM_GATEWAY_TOKEN sozlanmagan");
  }
  // Dev/test: kanal yo'q — kod ekranda ko'rinadi. Prodda yopiq.
  if (devCodeAllowed()) return { ok: true, devCode: code };
  return { ok: false, error: `Kod yuborilmadi. ${CODE_DELIVERY_HINT}` };
}

export async function submitAccessRequest(input: SignupInput, ip: string): Promise<SubmitResult> {
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  const login = input.login.trim().toLowerCase();
  const position = input.position.trim();
  const note = input.note?.trim() || null;
  const phone = normalizePhone(input.phone);

  if (fullName.length < 5 || !fullName.includes(" ")) return { ok: false, error: "F.I.O. to'liq yozing (familiya va ism)" };
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri. Masalan: 90 123 45 67" };
  if (!SIGNUP_POSITIONS.includes(position)) return { ok: false, error: "Bo'limni tanlang" };
  if (!LOGIN_RE.test(login)) return { ok: false, error: "Login 3–32 belgi: lotin harf, raqam, nuqta, chiziq" };
  if (login.startsWith("test.")) return { ok: false, error: "Bu login band — boshqasini tanlang" };
  const problem = passwordProblem(input.password);
  if (problem) return { ok: false, error: problem };
  if (input.password !== input.password2) return { ok: false, error: "Parollar bir xil emas" };

  if (!hit(`signup:ip:${ip}`, 5, 60 * 60_000) || !hit("signup:all", 30, 60_000)) {
    return { ok: false, error: "So'rovlar juda ko'p. Birozdan keyin qayta urinib ko'ring." };
  }
  if (!hit(`signup:phone:${phone}`, 3, 60 * 60_000)) {
    return { ok: false, error: "Bu raqamga juda ko'p kod so'raldi. Bir soatdan keyin qayta urinib ko'ring." };
  }

  const [taken, pendingPhone, pendingLogin] = await Promise.all([
    db.user.findUnique({ where: { login }, select: { id: true } }),
    db.accessRequest.findFirst({ where: { phone, status: "PENDING" }, select: { id: true } }),
    db.accessRequest.findFirst({ where: { login, status: "PENDING" }, select: { id: true } }),
  ]);
  if (taken || pendingLogin) return { ok: false, error: "Bu login band — boshqasini tanlang" };
  if (pendingPhone) return { ok: false, error: "Bu raqamdan ariza allaqachon yuborilgan — Otdel kadr tasdig'ini kuting" };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const data = {
    fullName, phone, position, login, note, ip,
    passwordHash: await hashPassword(input.password),
    codeHash: await bcrypt.hash(code, 10),
    codeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    attempts: 0,
  };
  // Shu raqamdan tasdiqlanmay qolgan eski ariza bo'lsa — ustidan yoziladi (qayta urinish)
  const old = await db.accessRequest.findFirst({ where: { phone, status: "UNVERIFIED" }, select: { id: true } });
  const req = old
    ? await db.accessRequest.update({ where: { id: old.id }, data })
    : await db.accessRequest.create({ data });

  const sent = await sendCode(phone, code, req.id);
  if (!sent.ok) return sent;
  return { ok: true, requestId: req.id, phone, via: sent.via, devCode: sent.devCode };
}

const WRONG = "Kod noto'g'ri yoki muddati tugagan";

export async function verifyAccessRequest(requestId: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const req = await db.accessRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status !== "UNVERIFIED" || !req.codeHash || !req.codeExpiresAt) return { ok: false, error: WRONG };
  if (req.codeExpiresAt < new Date()) return { ok: false, error: WRONG };
  if (req.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Urinishlar tugadi — arizani qaytadan yuboring" };
  if (!(await bcrypt.compare(code.trim(), req.codeHash))) {
    await db.accessRequest.update({ where: { id: req.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: WRONG };
  }
  // Kod ishlatildi — boshqa kod bilan ikkinchi marta tasdiqlanmaydi
  const done = await db.accessRequest.updateMany({
    where: { id: req.id, status: "UNVERIFIED" },
    data: { status: "PENDING", verifiedAt: new Date(), codeHash: null, codeExpiresAt: null },
  });
  if (done.count === 0) return { ok: false, error: WRONG };

  notifyAfter(() => notifyRoles(["HR", "DIRECTOR"], {
    type: "ACCESS_REQUEST",
    title: "Yangi kirish arizasi",
    body: `${req.fullName} · ${req.position} · login «${req.login}» — Xodimlar sahifasida tasdiqlang`,
  }));
  return { ok: true };
}

/* ───────── Tasdiqlash / rad etish (Xodimlar sahifasi) ───────── */

export type PendingRequest = {
  id: string; fullName: string; phone: string; position: string; login: string; note: string | null;
  createdAt: Date; suggestedRole: Role | null;
  /** Shu raqamdagi loginsiz faol xodim kartasi — tasdiqlanganda yangi karta ochilmaydi */
  employee: { id: string; fullName: string; position: string } | null;
  /** Shu raqamda allaqachon login bor — ehtimol qayta ariza yoki begona */
  existingLogin: string | null;
};

export async function pendingAccessRequests(): Promise<PendingRequest[]> {
  const reqs = await db.accessRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  if (reqs.length === 0) return [];
  const staff = await db.employee.findMany({
    where: { isActive: true, phone: { not: null } },
    select: { id: true, fullName: true, position: true, phone: true, user: { select: { login: true } } },
  });
  return reqs.map((r) => {
    const same = staff.filter((e) => normalizePhone(e.phone) === r.phone);
    const free = same.filter((e) => !e.user);
    return {
      id: r.id, fullName: r.fullName, phone: r.phone, position: r.position, login: r.login, note: r.note,
      createdAt: r.createdAt, suggestedRole: roleForPosition(r.position),
      employee: free.length === 1 ? { id: free[0].id, fullName: free[0].fullName, position: free[0].position } : null,
      existingLogin: same.find((e) => e.user)?.user?.login ?? null,
    };
  });
}

/** Login ochadi: mavjud loginsiz kartaga bog'laydi yoki yangi xodim kartasi ochadi. */
export async function approveAccessRequest(requestId: string, role: Role, byUserId: string): Promise<{ ok: true; login: string; employeeId: string } | { ok: false; error: string }> {
  return db.$transaction(async (tx) => {
    const req = await tx.accessRequest.findUnique({ where: { id: requestId } });
    if (!req || req.status !== "PENDING") return { ok: false as const, error: "Ariza topilmadi yoki allaqachon ko'rib chiqilgan" };
    if (await tx.user.findUnique({ where: { login: req.login }, select: { id: true } })) {
      return { ok: false as const, error: `«${req.login}» logini band bo'lib qolgan — arizani rad eting, xodim boshqa login bilan qayta yuborsin` };
    }
    const user = await tx.user.create({ data: { login: req.login, fullName: req.fullName, role, passwordHash: req.passwordHash } });

    const staff = await tx.employee.findMany({ where: { isActive: true, userId: null, phone: { not: null } }, select: { id: true, phone: true } });
    const free = staff.filter((e) => normalizePhone(e.phone) === req.phone);
    const employeeId = free.length === 1
      ? (await tx.employee.update({ where: { id: free[0].id }, data: { userId: user.id } })).id
      : (await tx.employee.create({ data: { fullName: req.fullName, position: req.position, phone: req.phone, userId: user.id } })).id;

    await tx.accessRequest.update({ where: { id: req.id }, data: { status: "APPROVED", userId: user.id, decidedById: byUserId, decidedAt: new Date() } });
    await audit(tx, byUserId, "CREATE", "AccessRequest", req.id, undefined, { approved: true, login: req.login, role, employeeId });
    return { ok: true as const, login: req.login, employeeId };
  });
}

export async function rejectAccessRequest(requestId: string, reason: string | null, byUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await db.accessRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "REJECTED", rejectReason: reason, decidedById: byUserId, decidedAt: new Date() },
  });
  if (r.count === 0) return { ok: false, error: "Ariza topilmadi yoki allaqachon ko'rib chiqilgan" };
  await audit(db, byUserId, "STATUS_CHANGE", "AccessRequest", requestId, undefined, { rejected: true, reason });
  return { ok: true };
}
