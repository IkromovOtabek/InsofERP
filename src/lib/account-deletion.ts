import { phoneTail, samePhone } from "./phone-lookup";
import { db } from "@/lib/db";
import { revokeSessions, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { normalizePhone } from "@/lib/phone";
import { eco, ecoEnabled } from "@/lib/eco/client";
import type { DeletionRequestSource } from "@/generated/prisma";
import { randomBytes } from "crypto";

/**
 * Hisobni o'chirish so'rovlari — App Store (5.1.1) va Google Play talabi.
 *
 * Mijoz (ECO quruvchi/tadbirkor) ilovada o'zi darhol o'chiradi — bu ECO tomonida (`DELETE /v1/me`).
 * Zavod xodimi esa so'rov qoldiradi, chunki uning hisobini direktor bergan: so'rov shu jadvalga
 * tushadi, direktorga push ketadi, u Sozlamalar > "Hisob so'rovlari" da tasdiqlaydi yoki rad etadi.
 *
 * Tasdiq = ERP logini yopiladi (isActive=false, login almashadi, parol kuyadi, sessiyalar bekor),
 * qurilma va bildirishnoma yozuvlari o'chadi; ECO haydovchisi bo'lsa ECO a'zoligi o'chiriladi va
 * ECO o'zi anonimlashtiradi. Xodim kartasi (HR, tabel, ish haqi) qoladi — mehnat va buxgalteriya
 * hujjatlari qonun bo'yicha saqlanadi, bu maxfiylik siyosatida yozilgan.
 */

const THROTTLE_MS = 10 * 60_000;

export type DeletionResult = { ok: true; duplicate?: boolean } | { ok: false; error: string };

/** Ilovadan (ERP logini bilan kirgan xodim). */
export async function requestFromApp(user: { id: string; fullName: string }, note: string | null): Promise<{ status: "requested"; requestId: string }> {
  const open = await db.accountDeletionRequest.findFirst({ where: { userId: user.id, status: "PENDING" }, select: { id: true } });
  if (open) return { status: "requested", requestId: open.id };
  const emp = await db.employee.findUnique({ where: { userId: user.id }, select: { id: true, phone: true } });
  const r = await db.accountDeletionRequest.create({
    data: { source: "APP", userId: user.id, employeeId: emp?.id ?? null, fullName: user.fullName, phone: emp?.phone ?? null, note },
  });
  notifyDirector(r.id, user.fullName, "ilovadan", emp?.id ?? null);
  return { status: "requested", requestId: r.id };
}

/** Ilovadan: so'rovni qaytarib olish (direktor hali ko'rmagan bo'lsa). */
export async function cancelFromApp(userId: string) {
  await db.accountDeletionRequest.updateMany({ where: { userId, status: "PENDING" }, data: { status: "REJECTED", result: "Xodim o'zi qaytarib oldi", handledAt: new Date() } });
  return { ok: true as const };
}

export async function pendingFor(userId: string) {
  const r = await db.accountDeletionRequest.findFirst({ where: { userId, status: "PENDING" }, select: { id: true, createdAt: true } });
  return { pending: !!r, requestedAt: r?.createdAt ?? null };
}

/** ECO webhook: zavod haydovchisi ilovada so'radi. Idempotent — ochiq so'rov bo'lsa qaytadan yozilmaydi. */
export async function requestFromEco(input: { userId: string; fullName: string | null; phone: string }): Promise<{ applied: boolean }> {
  const open = await db.accountDeletionRequest.findFirst({ where: { ecoUserId: input.userId, status: "PENDING" }, select: { id: true } });
  if (open) return { applied: false };
  const phone = normalizePhone(input.phone) ?? input.phone;
  const emp = (await db.employee.findFirst({ where: { ecoUserId: input.userId }, select: { id: true, fullName: true, userId: true } }))
    ?? await employeeByPhone(phone);
  const fullName = input.fullName?.trim() || emp?.fullName || phone;
  const r = await db.accountDeletionRequest.create({
    data: { source: "ECO", ecoUserId: input.userId, employeeId: emp?.id ?? null, userId: emp?.userId ?? null, fullName, phone },
  });
  notifyDirector(r.id, fullName, "ilovadan (haydovchi)", emp?.id ?? null);
  return { applied: true };
}

/** Saytdagi forma — ilovasiz. Shaxs tekshirilmagan: direktor telefon qilib aniqlaydi. */
export async function requestFromWeb(input: { name: string; phone: string; note: string | null }): Promise<DeletionResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: "Telefon raqami noto'g'ri. Masalan: 90 123 45 67" };
  const recent = await db.accountDeletionRequest.findFirst({ where: { phone, createdAt: { gt: new Date(Date.now() - THROTTLE_MS) } }, select: { id: true } });
  if (recent) return { ok: true, duplicate: true };
  const emp = await employeeByPhone(phone);
  const r = await db.accountDeletionRequest.create({
    data: { source: "WEB", fullName: input.name, phone, note: input.note, employeeId: emp?.id ?? null, userId: emp?.userId ?? null },
  });
  notifyDirector(r.id, input.name, "saytdan", emp?.id ?? null);
  return { ok: true };
}

/**
 * Xodim kartasidagi raqam erkin ko'rinishda ("90 123 45 67") — normallashtirib solishtiriladi.
 * Ilgari `where: { phone }` topolmay, direktor tasdiqlagan so'rov ERP loginini yopmay qolardi.
 */
async function employeeByPhone(phone: string) {
  const rows = await db.employee.findMany({
    where: { phone: { contains: phoneTail(phone) } },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    select: { id: true, fullName: true, userId: true, phone: true },
  });
  const hit = rows.find((e) => samePhone(e.phone, phone));
  return hit ? { id: hit.id, fullName: hit.fullName, userId: hit.userId } : null;
}

function notifyDirector(requestId: string, fullName: string, via: string, employeeId: string | null) {
  notifyAfter(() => notifyRoles(["DIRECTOR"], {
    type: "ACCOUNT_DELETE_REQUEST",
    title: "Hisobni o'chirish so'rovi",
    body: `${fullName} ${via} hisobini o'chirishni so'radi. Sozlamalar → Hisob so'rovlari.`,
    ...(employeeId ? { link: { key: "employees", id: employeeId } } : {}),
    channel: "oddiy",
  }));
  void requestId;
}

/** Direktor tasdiqladi. Nima qilingani `result` ga yoziladi — keyin ko'rish uchun. */
export async function approveRequest(id: string, actorId: string): Promise<DeletionResult> {
  const r = await db.accountDeletionRequest.findUnique({ where: { id }, include: { employee: { select: { id: true, ecoUserId: true } } } });
  if (!r) return { ok: false, error: "So'rov topilmadi" };
  if (r.status !== "PENDING") return { ok: false, error: "So'rov allaqachon ko'rib chiqilgan" };
  if (r.userId === actorId) return { ok: false, error: "O'z hisobingizni shu yerdan o'chira olmaysiz" };
  const done: string[] = [];

  if (r.userId) {
    await db.$transaction(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: r.userId! } });
      const login = `ochirilgan-${u.id.slice(-8)}`;
      await tx.user.update({ where: { id: u.id }, data: { isActive: false, login, passwordHash: await hashPassword(randomBytes(24).toString("hex")) } });
      await revokeSessions(tx, u.id);
      await tx.mobileDevice.deleteMany({ where: { userId: u.id } });
      await tx.notification.deleteMany({ where: { userId: u.id } });
      await tx.passwordResetCode.deleteMany({ where: { userId: u.id } });
      await tx.telegramAccount.updateMany({ where: { userId: u.id }, data: { userId: null, linkedAt: null } });
      await audit(tx, actorId, "UPDATE", "User", u.id, { login: u.login, isActive: u.isActive }, { login, isActive: false, deleted: true });
    });
    done.push("ERP logini yopildi");
  }

  const ecoUserId = r.ecoUserId ?? r.employee?.ecoUserId ?? null;
  if (ecoEnabled()) {
    try {
      if (ecoUserId) {
        await eco.deactivateDriver(ecoUserId);
        if (r.employeeId) await db.employee.update({ where: { id: r.employeeId }, data: { ecoActive: false, ecoSyncedAt: new Date(), ecoError: null } });
        done.push(r.source === "ECO" ? "ECO hisobi anonimlashtirildi" : "ECO haydovchi a'zoligi o'chirildi");
      } else if (r.source === "WEB" && r.phone) {
        const res = await eco.deleteUser(r.phone);
        done.push(res.status === "deleted" ? "ECO hisobi anonimlashtirildi" : "ECO'da bunday raqam yo'q");
      }
    } catch (e) {
      done.push(`ECO xatosi: ${(e as Error).message}`);
    }
  } else if (ecoUserId || r.source === "WEB") {
    done.push("ECO ulanmagan — ECO tomoni qo'lda");
  }
  if (done.length === 0) done.push("ERP'da bunday hisob topilmadi — faqat so'rov yopildi");

  await db.accountDeletionRequest.update({ where: { id }, data: { status: "APPROVED", handledById: actorId, handledAt: new Date(), result: done.join("; ") } });
  return { ok: true };
}

export async function rejectRequest(id: string, actorId: string, reason: string | null): Promise<DeletionResult> {
  const r = await db.accountDeletionRequest.findUnique({ where: { id } });
  if (!r) return { ok: false, error: "So'rov topilmadi" };
  if (r.status !== "PENDING") return { ok: false, error: "So'rov allaqachon ko'rib chiqilgan" };
  await db.accountDeletionRequest.update({ where: { id }, data: { status: "REJECTED", handledById: actorId, handledAt: new Date(), result: reason || "Rad etildi" } });
  // ECO haydovchisi so'rovi rad etilsa ECO'dagi belgini ham olib tashlaymiz — aks holda keyinroq
  // boshqa sabab bilan bloklansa u anonimlashib ketadi
  if (r.ecoUserId && ecoEnabled()) { try { await eco.cancelDeletion(r.ecoUserId); } catch { /* ECO o'chiq — keyingi so'rovda yana keladi */ } }
  return { ok: true };
}

export const SOURCE_LABEL: Record<DeletionRequestSource, string> = { APP: "Ilova (ERP xodimi)", ECO: "Ilova (haydovchi)", WEB: "Sayt" };
