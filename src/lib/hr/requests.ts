import { Prisma as P, type AttendanceStatus, type HrRequestKind, type HrRequestStatus, type Prisma, type Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { money } from "@/lib/format";
import { dayUtc, isoDay, shiftDay, today } from "@/lib/davomat";
import { notifyAfter, notifyEmployees, notifyRoles } from "@/lib/notify";
import { lockEmployeeAttendance } from "@/lib/production-staff";
import { REQUEST_KIND } from "./labels";
import { createAdvancePayout } from "./payroll";

/**
 * Xodim arizalari (ta'til, kasallik, dam olish, avans, kechikish/kelmaslik sababi).
 * Yuboradi: xodimning o'zi (mobil ilova yoki "Mening hisobim"), yoki otdel kadr uning nomidan.
 * Hal qiladi: otdel kadr yoki direktor. Holat o'tishlari shartli `updateMany` bilan (poyga bo'lmasin).
 *
 * Tasdiqlanganda: ta'til / o'z hisobidan / kasallik / dam olish kunlari davomatga yoziladi ("Keldi" bo'lgan kunga
 * tegilmaydi); avans — direktor tasdig'iga alohida vedomost; kechikish / kelmaslik sababi — shu kunlar jarimadan ozod.
 */

export const DECIDE_ROLES: Role[] = ["HR", "DIRECTOR"];
const MAX_DAYS = 120;
const STALE = "Ariza boshqa joyda o'zgartirildi — sahifani yangilang";

/** Tasdiqlansa davomatga qaysi belgi tushadi. */
const ATT_STATUS: Partial<Record<HrRequestKind, AttendanceStatus>> = { VACATION: "LEAVE", UNPAID: "LEAVE", SICK: "SICK", DAYOFF: "DAYOFF" };

export type RequestInput = {
  employeeId: string; kind: HrRequestKind; dateFrom?: string | null; dateTo?: string | null;
  amount?: number | null; reason?: string | null; clientToken?: string | null;
};
export type RequestResult = { id?: string; docNo?: string; error?: string; note?: string; existed?: boolean };

const reqToken = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v.trim()) ? v.trim() : null);
const validIso = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(dayUtc(v).getTime()) ? v : null);

/** Ariza yuborish. `byUserId` — kim yubordi (xodimning o'zi yoki kadr). */
export async function createHrRequest(input: RequestInput, byUserId: string): Promise<RequestResult> {
  const meta = REQUEST_KIND[input.kind];
  if (!meta) return { error: "Ariza turi noto'g'ri" };
  const reason = (input.reason ?? "").trim().slice(0, 1000);
  const from = validIso(input.dateFrom ?? null);
  const to = validIso(input.dateTo ?? null) ?? from;
  if (meta.dates) {
    if (!from) return { error: "Boshlanish sanasini kiriting" };
    if (to! < from) return { error: "Tugash sanasi boshlanishdan oldin bo'lishi mumkin emas" };
    const span = Math.round((dayUtc(to!).getTime() - dayUtc(from).getTime()) / 864e5) + 1;
    if (span > MAX_DAYS) return { error: `Bir arizada ${MAX_DAYS} kundan ko'p bo'lmaydi` };
    // Sabab arizasi o'tgan kunlar uchun; ta'til / kasallik — o'tgan 60 kungacha (kasallik varaqasi kech keladi)
    if (from < shiftDay(today(), -60)) return { error: "60 kundan oldingi kunlar uchun ariza berilmaydi — otdel kadrga murojaat qiling" };
  }
  let amount: number | null = null;
  if (meta.amount) {
    amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Avans summasini kiriting" };
    if (amount > 1_000_000_000) return { error: "Summa juda katta" };
    amount = Math.round(amount);
  }
  if (!reason && input.kind !== "VACATION" && input.kind !== "ADVANCE") return { error: "Sababini yozing" };

  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, fullName: true, isActive: true, firedAt: true } });
  if (!emp || !emp.isActive || emp.firedAt) return { error: "Xodim topilmadi yoki ishlamaydi" };
  // Bir xil turdagi kesishgan kutilayotgan ariza — ikki marta bosilmasin
  if (meta.dates) {
    const clash = await db.hrRequest.findFirst({
      where: { employeeId: emp.id, kind: input.kind, status: { in: ["PENDING", "APPROVED"] }, dateFrom: { lte: dayUtc(to!) }, dateTo: { gte: dayUtc(from!) } },
      select: { docNo: true, status: true },
    });
    if (clash) return { error: `Shu kunlar uchun ${clash.docNo} arizasi bor (${clash.status === "PENDING" ? "ko'rib chiqilmoqda" : "tasdiqlangan"})` };
  }

  const token = reqToken(input.clientToken);
  if (token) {
    const dup = await db.hrRequest.findUnique({ where: { clientToken: token }, select: { id: true, docNo: true, createdById: true } });
    if (dup) return dup.createdById === byUserId ? { id: dup.id, docNo: dup.docNo, existed: true } : { error: "Ariza kaliti band — formani qayta oching" };
  }
  let r: { id: string; docNo: string };
  try {
    r = await db.$transaction(async (tx) => {
      const x = await tx.hrRequest.create({
        data: {
          docNo: await nextNo(tx, "hrRequest", "AR"), employeeId: emp.id, kind: input.kind,
          dateFrom: meta.dates ? dayUtc(from!) : null, dateTo: meta.dates ? dayUtc(to!) : null,
          amount, reason: reason || meta.label, createdById: byUserId, clientToken: token,
        },
      });
      await audit(tx, byUserId, "CREATE", "HrRequest", x.id, undefined, x);
      return x;
    });
  } catch (e) {
    if (token && e instanceof P.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await db.hrRequest.findUnique({ where: { clientToken: token }, select: { id: true, docNo: true } });
      if (dup) return { id: dup.id, docNo: dup.docNo, existed: true };
    }
    throw e;
  }
  const what = `${emp.fullName} · ${meta.label}${meta.dates ? ` · ${periodText(from!, to!)}` : ""}${amount ? ` · ${money(amount)}` : ""}`;
  notifyAfter(() => notifyRoles(["HR"], { type: "HR_REQUEST_NEW", title: `Yangi ariza — ${r.docNo}`, body: `${what} — ko'rib chiqing`, link: { key: "arizalar", id: r.id } }, { except: byUserId }));
  return { id: r.id, docNo: r.docNo, note: `Ariza ${r.docNo} yuborildi — otdel kadr ko'rib chiqadi` };
}

export const periodText = (from: string, to: string) => (from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`);
const fmt = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Tasdiqlash yoki rad etish. */
export async function decideHrRequest(id: string, approve: boolean, note: string | null, user: { userId: string; role: Role }): Promise<RequestResult> {
  if (!DECIDE_ROLES.includes(user.role)) return { error: "Arizani otdel kadr yoki direktor hal qiladi" };
  const before = await db.hrRequest.findUnique({ where: { id }, include: { employee: { select: { fullName: true, userId: true, hiredAt: true } } } });
  if (!before) return { error: "Ariza topilmadi" };
  if (before.status !== "PENDING") return { error: "Ariza allaqachon ko'rib chiqilgan" };
  // O'z arizasini o'zi tasdiqlamaydi (kadr xodimining o'z ta'tili — direktor yoki boshqa kadr)
  if (approve && before.employee.userId === user.userId && user.role !== "DIRECTOR") return { error: "O'z arizangizni o'zingiz tasdiqlay olmaysiz — direktor yoki boshqa kadr tasdiqlaydi" };
  if (!approve && !(note ?? "").trim()) return { error: "Rad etish sababini yozing" };
  const meta = REQUEST_KIND[before.kind];

  const res = await db.$transaction(async (tx) => {
    const n = await tx.hrRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: approve ? "APPROVED" : "REJECTED", decidedById: user.userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
    });
    if (n.count === 0) return { error: STALE };
    let applied: number | null = null;
    let kept: string[] = [];
    const status = ATT_STATUS[before.kind];
    if (approve && status && before.dateFrom && before.dateTo) {
      const r = await applyToAttendance(tx, before.employeeId, isoDay(before.dateFrom), isoDay(before.dateTo), status, `${meta.label} · ${before.docNo}`, user.userId, before.employee.hiredAt);
      applied = r.applied; kept = r.kept;
    }
    let runId: string | null = null;
    if (approve && before.kind === "ADVANCE" && before.amount) {
      runId = await createAdvancePayout(tx, { employeeId: before.employeeId, amount: Number(before.amount), requestId: id, docNo: before.docNo }, user.userId);
    }
    if (applied !== null || runId) await tx.hrRequest.update({ where: { id }, data: { appliedDays: applied, payrollRunId: runId } });
    const after = await tx.hrRequest.findUniqueOrThrow({ where: { id } });
    await audit(tx, user.userId, "STATUS_CHANGE", "HrRequest", id, { status: before.status }, { status: after.status, decisionNote: after.decisionNote, appliedDays: applied, kept, payrollRunId: runId });
    return { applied, kept, runId };
  });
  if ("error" in res) return { error: res.error };

  const title = `${before.docNo}: ${meta.label} — ${approve ? "tasdiqlandi" : "rad etildi"}`;
  notifyAfter(async () => {
    await notifyEmployees([before.employeeId], { type: approve ? "HR_REQUEST_APPROVED" : "HR_REQUEST_REJECTED", title, body: approve ? (res.runId ? "Avans direktor tasdig'idan keyin kassadan beriladi" : "Arizangiz tasdiqlandi") : `Sabab: ${note}`, link: { key: "arizalarim", id } });
    if (res.runId) await notifyRoles(["DIRECTOR"], { type: "PAYROLL_SUBMITTED", title: "Avans tasdig'ingizni kutmoqda", body: `${before.employee.fullName} · ${money(Number(before.amount))}`, link: { key: "ish-haqi", id: res.runId } });
  });
  const keptNote = res.kept.length ? ` · ${res.kept.length} kun «Keldi» bo'lgani uchun o'zgartirilmadi (${res.kept.join(", ")})` : "";
  return {
    id, docNo: before.docNo,
    note: approve
      ? `Tasdiqlandi${res.applied !== null ? ` — davomatga ${res.applied} kun yozildi${keptNote}` : ""}${res.runId ? " — avans direktor tasdig'iga yuborildi" : ""}`
      : "Rad etildi — xodimga xabar yuborildi",
  };
}

/**
 * Tasdiqlangan ta'til / kasallik / dam olish kunlarini davomatga yozadi. "Keldi" belgisi bor kun (xodim baribir ishga
 * chiqqan) va ishga kirgan sanadan oldingi kun o'zgarmaydi. Kelajak kunlari ham oldindan yoziladi — tabelda ko'rinadi.
 */
async function applyToAttendance(tx: Prisma.TransactionClient, employeeId: string, from: string, to: string, status: AttendanceStatus, note: string, userId: string, hiredAt: Date | null) {
  await lockEmployeeAttendance(tx, employeeId);
  const cur = await tx.attendance.findMany({ where: { employeeId, date: { gte: dayUtc(from), lte: dayUtc(to) } }, select: { date: true, status: true } });
  const by = new Map(cur.map((a) => [isoDay(a.date), a.status]));
  let applied = 0;
  const kept: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) {
    if (hiredAt && d < isoDay(hiredAt)) continue;
    if (by.get(d) === "PRESENT") { kept.push(fmt(d)); continue; }
    await tx.attendance.upsert({
      where: { employeeId_date: { employeeId, date: dayUtc(d) } },
      create: { employeeId, date: dayUtc(d), status, note, markedById: userId },
      update: { status, checkIn: null, checkOut: null, lateMinutes: null, note, markedById: userId },
    });
    applied++;
  }
  return { applied, kept };
}

/** Xodim o'z kutilayotgan arizasini qaytarib oladi. */
export async function cancelHrRequest(id: string, userId: string): Promise<RequestResult> {
  const r = await db.hrRequest.findUnique({ where: { id }, include: { employee: { select: { userId: true } } } });
  if (!r) return { error: "Ariza topilmadi" };
  if (r.employee.userId !== userId && r.createdById !== userId) return { error: "Bu ariza sizniki emas" };
  const n = await db.$transaction(async (tx) => {
    const x = await tx.hrRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), decidedById: userId } });
    if (x.count) await audit(tx, userId, "STATUS_CHANGE", "HrRequest", id, { status: "PENDING" }, { status: "CANCELLED" });
    return x.count;
  });
  return n ? { id, docNo: r.docNo, note: "Ariza qaytarib olindi" } : { error: "Faqat ko'rib chiqilmagan arizani qaytarib olish mumkin" };
}

// ───────────────────────── O'qish ─────────────────────────

const LIST_INCLUDE = { employee: { select: { id: true, fullName: true, position: true } } } as const;
export type RequestRow = Prisma.HrRequestGetPayload<{ include: typeof LIST_INCLUDE }>;

export async function listHrRequests(opts: { status?: HrRequestStatus | "ALL"; employeeId?: string; q?: string; take?: number } = {}): Promise<RequestRow[]> {
  const q = opts.q?.trim();
  return db.hrRequest.findMany({
    where: {
      ...(opts.status && opts.status !== "ALL" ? { status: opts.status } : {}),
      ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
      ...(q ? { OR: [{ docNo: { contains: q, mode: "insensitive" } }, { reason: { contains: q, mode: "insensitive" } }, { employee: { fullName: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }], take: opts.take ?? 200, include: LIST_INCLUDE,
  });
}

export async function requestCounts() {
  const g = await db.hrRequest.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(g.map((x) => [x.status, x._count._all])) as Partial<Record<HrRequestStatus, number>>;
}

/** Xodim kartasi (login → xodim). Login egasi kartasiz bo'lsa — null. */
export async function employeeOfUser(userId: string) {
  return db.employee.findFirst({ where: { userId }, select: { id: true, fullName: true, position: true, isActive: true, firedAt: true, workSchedule: true, hiredAt: true, payType: true } });
}
