import type { AdvanceSheetStatus, Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { Perms } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { money } from "@/lib/format";
import { dayUtc, monthDays, monthTitle, today } from "@/lib/davomat";
import { cashOutflowError } from "@/lib/payments";
import { cancelCashTxIn } from "@/lib/cash-entry";
import { notifyAfter, notifyEmployees, notifyUsers } from "@/lib/notify";
import { PAYROLL_CATEGORY, calculate, canPayroll, payrollSettings, type PayrollWho } from "./payroll";
import { groupOf, groupOrder, NO_GROUP } from "./tabel";
import { tabelLock } from "./tabel-lock";

/**
 * Avans varaqasi (Ish haqi → Avans). Oqim:
 *   1. Sekretar (payroll.advance) varaqa ochadi — hamma xodim yoki bitta guruh (komanda / brigada): har xodimga oy
 *      boshidan bugungacha ishlagani (`calculate` ADVANCE, `upTo` = bugun) va tavsiya: xodim kartasidagi qo'lda avans,
 *      bo'lmasa avans qoidasi (sozlamadagi foiz, bashorat bilan) — ishlaganidan oshmaydi; shu oy berilgan / jo'natilgan
 *      avans ayiriladi. Avans summasi qo'lda yoziladi → «Saqlash» (DRAFT, bizda qoladi).
 *   2. «Jo'natish» — kassa huquqi bor xodim tanlanadi (SENT), unga bildirishnoma.
 *   3. U `/avans/<id>` da kassani tanlab, har xodimga «Berildi» belgilaydi: har biriga kassadan alohida «Ish haqi» chiqimi
 *      (refType `ADVANCE_REF`). Hammasi berilgach — DONE, jo'natganga xabar. Qolganlarini bermasdan varaqani yopish mumkin.
 * Berilgan avans oy yakuni vedomostida ushlanadi (`calculate` → advances); oy yakuni yopilgan oyda berib / qaytarib
 * bo'lmaydi (ushlanmay qolardi). Hujjat o'chirilmaydi: bekor qilinadi, har amal AuditLog'da.
 */

export const ADVANCE_REF = "AdvanceSheet";
const num = (v: unknown) => Number(v ?? 0);
const r0 = (n: number) => Math.round(n);
const thousand = (n: number) => Math.round(n / 1000) * 1000;
const STALE = "Varaqa boshqa joyda o'zgartirildi — sahifani yangilang";

type Who = Pick<PayrollWho, "userId" | "role" | "perms">;
export class AdvanceError extends Error {}
const wrap = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
  try { return await fn(); } catch (e) { if (e instanceof AdvanceError) return { error: e.message }; throw e; }
};

export const ADVANCE_STATUS_LABEL: Record<AdvanceSheetStatus, string> = { DRAFT: "Qoralama", SENT: "Jo'natilgan", DONE: "Berildi", CANCELLED: "Bekor qilingan" };
export const ADVANCE_STATUS_BADGE: Record<AdvanceSheetStatus, "slate" | "amber" | "green" | "red"> = { DRAFT: "slate", SENT: "amber", DONE: "green", CANCELLED: "red" };

/** Varaqa tuzish, saqlash, jo'natish (Sekretar). */
export const canAdvance = (who: Pick<Who, "role" | "perms">) => canPayroll(who, "advance");
/** Avansni bera oladi (qabul qiluvchi): kassadan ish haqi to'lash yoki Kirim-Chiqim yozish huquqi. */
export const canGiveAdvance = (who: Pick<Who, "role" | "perms">) => canPayroll(who, "pay") || canDo(who, "cashflow", "create");

type SheetHead = { createdById: string; sentById: string | null; recipientId: string | null };
/** Varaqani ko'radi: tuzuvchi/jo'natuvchi, qabul qiluvchi, avans huquqi bori, ish haqini hisoblovchi va direktor. */
export const canViewSheet = (who: Who, sh: SheetHead) =>
  who.role === "DIRECTOR" || canAdvance(who) || canPayroll(who, "calc") || who.userId === sh.createdById || who.userId === sh.sentById || who.userId === sh.recipientId;

/** Jo'natish oynasidagi ro'yxat: faol, kassa huquqi bor foydalanuvchilar (IT superadmin'siz). */
export async function advanceRecipients() {
  const users = await db.user.findMany({ where: { isActive: true, role: { not: "SUPERADMIN" } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, role: true, perms: true } });
  return users.filter((u) => canGiveAdvance({ role: u.role, perms: (u.perms ?? undefined) as Perms | undefined })).map((u) => ({ id: u.id, fullName: u.fullName, role: u.role }));
}

// ───────────────────────── Hisob: ishlagani va tavsiya ─────────────────────────

export type AdvanceCalcRow = { employeeId: string; fullName: string; position: string; groupKey: string; groupLabel: string; earned: number; suggested: number; given: number; planned: number; formula: string };

/**
 * Oy boshidan `asOf` gacha: ishlagani va tavsiya etilgan avans. Berilgani — shu oy to'langan avans / alohida to'lov
 * vedomostlari va boshqa varaqalarda berilgan avans; rejada — boshqa jo'natilgan varaqalarda hali berilmagani.
 */
export async function advanceCalc(month: string, asOf: string, opts: { groupKey?: string | null; exceptSheetId?: string } = {}): Promise<AdvanceCalcRow[]> {
  const [lines, st] = await Promise.all([calculate(month, "ADVANCE", { upTo: asOf }), payrollSettings()]);
  if (!lines.length) return [];
  const ids = lines.map((l) => l.employeeId);
  const [emps, paid, sheetLines] = await Promise.all([
    db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, advanceAmount: true, brigadeId: true, teamId: true, brigade: { select: { name: true } }, team: { select: { name: true } } } }),
    db.payrollLine.findMany({ where: { employeeId: { in: ids }, paid: { gt: 0 }, run: { month, kind: { in: ["ADVANCE", "EXTRA"] }, status: { in: ["APPROVED", "PAID"] } } }, select: { employeeId: true, paid: true } }),
    db.advanceLine.findMany({
      where: { employeeId: { in: ids }, amount: { gt: 0 }, sheet: { month, status: { in: ["SENT", "DONE"] }, ...(opts.exceptSheetId ? { id: { not: opts.exceptSheetId } } : {}) } },
      select: { employeeId: true, amount: true, givenAt: true, sheet: { select: { status: true } } },
    }),
  ]);
  const eOf = new Map(emps.map((e) => [e.id, e]));
  const rows: AdvanceCalcRow[] = [];
  for (const l of lines) {
    const e = eOf.get(l.employeeId);
    if (!e) continue;
    const g = groupOf(e);
    if (opts.groupKey && g.key !== opts.groupKey) continue;
    const earned = r0(l.earned ?? 0);
    const given = paid.filter((p) => p.employeeId === e.id).reduce((s, p) => s + num(p.paid), 0)
      + sheetLines.filter((x) => x.employeeId === e.id && x.givenAt).reduce((s, x) => s + num(x.amount), 0);
    // Yopilgan (DONE) varaqada berilmay qolgan qator — reja emas
    const planned = sheetLines.filter((x) => x.employeeId === e.id && !x.givenAt && x.sheet.status === "SENT").reduce((s, x) => s + num(x.amount), 0);
    const fixed = num(e.advanceAmount);
    // Qoida: qo'lda belgilangan avans (ishda bo'lsa) yoki bashorat × foiz — ishlaganidan oshmaydi
    const rule = fixed > 0 ? l.base : Math.min(l.base, earned);
    const suggested = Math.max(0, thousand(rule - given - planned));
    const formula = [
      fixed > 0 ? `kartada belgilangan avans ${money(r0(fixed))}` : `avans qoidasi (${st.advancePct}%) ${money(r0(l.base))}${l.base > earned ? `, ishlaganidan oshmaydi` : ""}`,
      given > 0 ? `berilgan −${money(r0(given))}` : null,
      planned > 0 ? `jo'natilgan −${money(r0(planned))}` : null,
    ].filter(Boolean).join(" · ");
    rows.push({ employeeId: e.id, fullName: l.fullName, position: l.position, groupKey: g.key, groupLabel: g.label, earned, suggested, given: r0(given), planned: r0(planned), formula });
  }
  return rows.sort((a, b) => groupOrder(a.groupKey) - groupOrder(b.groupKey) || a.groupLabel.localeCompare(b.groupLabel) || a.fullName.localeCompare(b.fullName));
}

/** Varaqa ochishdagi guruhlar: komandalar, brigadalar, biriktirilmaganlar (Tabel guruhlari bilan bir xil kalitlar). */
export async function advanceGroups() {
  const [teams, brigades] = await Promise.all([
    db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return [...teams.map((t) => ({ key: `t:${t.id}`, label: t.name })), ...brigades.map((b) => ({ key: `b:${b.id}`, label: b.name })), { ...NO_GROUP }];
}

// ───────────────────────── O'qish ─────────────────────────

export async function listAdvanceSheets(where: Prisma.AdvanceSheetWhereInput = {}, take = 60) {
  const sheets = await db.advanceSheet.findMany({
    where, orderBy: [{ createdAt: "desc" }], take,
    include: { lines: { select: { amount: true, givenAt: true } } },
  });
  const userIds = [...new Set(sheets.flatMap((x) => [x.createdById, x.recipientId].filter((v): v is string => !!v)))];
  const users = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return sheets.map((x) => {
    const act = x.lines.filter((l) => num(l.amount) > 0);
    return {
      id: x.id, docNo: x.docNo, month: x.month, asOf: x.asOf, status: x.status, groupLabel: x.groupLabel, createdAt: x.createdAt, sentAt: x.sentAt,
      createdBy: users.get(x.createdById) ?? "—", recipient: x.recipientId ? users.get(x.recipientId) ?? "—" : null,
      count: act.length, total: act.reduce((s, l) => s + num(l.amount), 0), given: act.filter((l) => l.givenAt).reduce((s, l) => s + num(l.amount), 0),
    };
  });
}
export type AdvanceSheetRow = Awaited<ReturnType<typeof listAdvanceSheets>>[number];

export async function advanceSheet(id: string) {
  const sh = await db.advanceSheet.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          employee: { select: { id: true, fullName: true, position: true, brigadeId: true, teamId: true, brigade: { select: { name: true } }, team: { select: { name: true } } } },
          cashTx: { select: { id: true, date: true, cancelledAt: true, cashAccount: { select: { name: true } } } },
        },
      },
    },
  });
  if (!sh) return null;
  const userIds = [...new Set([sh.createdById, sh.sentById, sh.recipientId, sh.cancelledById, ...sh.lines.map((l) => l.givenById)].filter((v): v is string => !!v))];
  const users = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const lines = sh.lines.map((l) => {
    const g = groupOf(l.employee);
    return {
      id: l.id, employeeId: l.employeeId, fullName: l.employee.fullName, position: l.employee.position, groupKey: g.key, groupLabel: g.label,
      earned: num(l.earned), suggested: num(l.suggested), amount: num(l.amount),
      givenAt: l.givenAt, givenBy: l.givenById ? users.get(l.givenById) ?? "—" : null, givenById: l.givenById, account: l.cashTx?.cashAccount.name ?? null,
    };
  }).sort((a, b) => groupOrder(a.groupKey) - groupOrder(b.groupKey) || a.groupLabel.localeCompare(b.groupLabel) || a.fullName.localeCompare(b.fullName));
  const act = lines.filter((l) => l.amount > 0);
  return {
    ...sh, lines,
    createdBy: users.get(sh.createdById) ?? "—", sentBy: sh.sentById ? users.get(sh.sentById) ?? "—" : null, recipient: sh.recipientId ? users.get(sh.recipientId) ?? "—" : null,
    cancelledBy: sh.cancelledById ? users.get(sh.cancelledById) ?? "—" : null,
    total: act.reduce((s, l) => s + l.amount, 0), given: act.filter((l) => l.givenAt).reduce((s, l) => s + l.amount, 0),
    count: act.length, givenCount: act.filter((l) => l.givenAt).length,
  };
}
export type AdvanceSheetFull = NonNullable<Awaited<ReturnType<typeof advanceSheet>>>;

// ───────────────────────── Qoralama: ochish, saqlash, qayta hisoblash ─────────────────────────

async function nextDocNo(tx: Prisma.TransactionClient, month: string) {
  const head = `AV-${month}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"docno:" + head}))`;
  const n = await tx.advanceSheet.count({ where: { docNo: { startsWith: head } } });
  return `${head}-${n + 1}`;
}

/** Joriy oy uchun yangi varaqa (bugungi holat bilan): hamma xodim yoki bitta guruh. */
export async function createAdvanceSheet(who: Who, input: { groupKey?: string | null }) {
  if (!canAdvance(who)) return { error: "Avans varaqasini sekretar tuzadi — ruxsat yo'q" };
  const asOf = today();
  const month = asOf.slice(0, 7);
  const locked = await tabelLock(month);
  if (locked) return { error: `${monthTitle(month)} oy yakuni yopilgan — avans berilsa ushlanmay qoladi (${locked.split(" — ")[0]})` };
  const groupKey = input.groupKey?.trim() || null;
  const group = groupKey ? (await advanceGroups()).find((g) => g.key === groupKey) : null;
  if (groupKey && !group) return { error: "Guruh topilmadi" };
  const rows = await advanceCalc(month, asOf, { groupKey });
  if (!rows.length) return { error: group ? `«${group.label}» da shu oy ishlagan xodim yo'q` : "Shu oy ishlagan xodim topilmadi" };
  const sh = await db.$transaction(async (tx) => {
    const x = await tx.advanceSheet.create({
      data: {
        docNo: await nextDocNo(tx, month), month, asOf: dayUtc(asOf), groupKey, groupLabel: group?.label ?? null, createdById: who.userId,
        lines: { create: rows.map((r) => ({ employeeId: r.employeeId, earned: r.earned, suggested: r.suggested, amount: 0 })) },
      },
    });
    await audit(tx, who.userId, "CREATE", "AdvanceSheet", x.id, undefined, { docNo: x.docNo, month, guruh: group?.label ?? "hammasi", xodim: rows.length });
    return x;
  });
  return { ok: true as const, id: sh.id, docNo: sh.docNo };
}

/** Qoralamada: ishlagani va tavsiyani bugungi holatga yangilash, guruhga yangi kelganlarni qo'shish (yozilgan avans saqlanadi). */
export async function refreshAdvanceSheet(who: Who, id: string) {
  if (!canAdvance(who)) return { error: "Ruxsat yo'q" };
  const sh = await db.advanceSheet.findUnique({ where: { id }, select: { id: true, month: true, status: true, groupKey: true, lines: { select: { id: true, employeeId: true } } } });
  if (!sh) return { error: "Varaqa topilmadi" };
  if (sh.status !== "DRAFT") return { error: "Faqat qoralama qayta hisoblanadi" };
  const now = today();
  // O'tgan oy qoralamasi — oy oxiri holatiga
  const asOf = now.slice(0, 7) === sh.month ? now : monthDays(sh.month).at(-1)!.iso;
  const rows = await advanceCalc(sh.month, asOf, { groupKey: sh.groupKey, exceptSheetId: sh.id });
  const have = new Map(sh.lines.map((l) => [l.employeeId, l.id]));
  return wrap(() => db.$transaction(async (tx) => {
    const u = await tx.advanceSheet.updateMany({ where: { id, status: "DRAFT" }, data: { asOf: dayUtc(asOf) } });
    if (!u.count) throw new AdvanceError(STALE);
    for (const r of rows) {
      const lid = have.get(r.employeeId);
      if (lid) await tx.advanceLine.update({ where: { id: lid }, data: { earned: r.earned, suggested: r.suggested } });
      else await tx.advanceLine.create({ data: { sheetId: id, employeeId: r.employeeId, earned: r.earned, suggested: r.suggested, amount: 0 } });
    }
    await audit(tx, who.userId, "UPDATE", "AdvanceSheet", id, undefined, { qaytaHisob: asOf, xodim: rows.length });
    return { ok: true as const, note: `${rows.length} xodim — ${asOf.split("-").reverse().join(".")} holatiga yangilandi` };
  }, { timeout: 30_000 }));
}

const parseAmount = (v: unknown) => {
  const t = String(v ?? "").replace(/[\s'’]/g, "").replace(",", ".");
  const n = t === "" || t === "-" ? 0 : Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 1e11 ? r0(n) : null;
};

async function writeAmounts(tx: Prisma.TransactionClient, who: Who, id: string, items: { lineId: string; amount: string }[]) {
  const lines = await tx.advanceLine.findMany({ where: { sheetId: id }, select: { id: true, amount: true, employee: { select: { fullName: true } } } });
  const byId = new Map(lines.map((l) => [l.id, l]));
  const changed: { xodim: string; oldin: number; endi: number }[] = [];
  for (const it of items) {
    const l = byId.get(it.lineId);
    if (!l) throw new AdvanceError(STALE);
    const n = parseAmount(it.amount);
    if (n == null) throw new AdvanceError(`${l.employee.fullName}: «${it.amount}» — summa noto'g'ri`);
    if (n === num(l.amount)) continue;
    await tx.advanceLine.update({ where: { id: l.id }, data: { amount: n } });
    changed.push({ xodim: l.employee.fullName, oldin: num(l.amount), endi: n });
  }
  if (changed.length) await audit(tx, who.userId, "UPDATE", "AdvanceSheet", id, undefined, { avans: changed.slice(0, 200), soni: changed.length });
  return changed.length;
}

/** «Saqlash»: qoralamadagi avans summalari (bo'sh / 0 — avans yo'q). */
export async function saveAdvanceAmounts(who: Who, id: string, items: { lineId: string; amount: string }[]) {
  if (!canAdvance(who)) return { error: "Ruxsat yo'q" };
  return wrap(() => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AdvanceSheet" WHERE id = ${id} FOR UPDATE`;
    const sh = await tx.advanceSheet.findUnique({ where: { id }, select: { status: true } });
    if (!sh) throw new AdvanceError("Varaqa topilmadi");
    if (sh.status !== "DRAFT") throw new AdvanceError("Varaqa jo'natilgan — o'zgartirish uchun avval qaytarib oling");
    const n = await writeAmounts(tx, who, id, items);
    return { ok: true as const, saved: n };
  }));
}

// ───────────────────────── Jo'natish, qaytarib olish, bekor qilish, yopish ─────────────────────────

/** Saqlab, tanlangan xodimga jo'natish (bildirishnoma bilan). */
export async function sendAdvanceSheet(who: Who, id: string, input: { recipientId: string; items: { lineId: string; amount: string }[]; note?: string | null }) {
  if (!canAdvance(who)) return { error: "Ruxsat yo'q" };
  const rec = await db.user.findUnique({ where: { id: input.recipientId }, select: { id: true, fullName: true, role: true, perms: true, isActive: true } });
  if (!rec || !rec.isActive) return { error: "Qabul qiluvchi xodimni tanlang" };
  if (!canGiveAdvance({ role: rec.role, perms: (rec.perms ?? undefined) as Perms | undefined })) return { error: `${rec.fullName}da kassa huquqi yo'q — avansni u kassadan bera olmaydi` };
  const res = await wrap(() => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AdvanceSheet" WHERE id = ${id} FOR UPDATE`;
    const sh = await tx.advanceSheet.findUnique({ where: { id }, select: { status: true, docNo: true, month: true } });
    if (!sh) throw new AdvanceError("Varaqa topilmadi");
    if (sh.status !== "DRAFT") throw new AdvanceError("Varaqa allaqachon jo'natilgan");
    const locked = await tabelLock(sh.month, tx);
    if (locked) throw new AdvanceError(`${monthTitle(sh.month)} oy yakuni yopilgan — avans berilsa ushlanmay qoladi`);
    await writeAmounts(tx, who, id, input.items);
    const agg = await tx.advanceLine.aggregate({ where: { sheetId: id, amount: { gt: 0 } }, _sum: { amount: true }, _count: true });
    const total = num(agg._sum.amount);
    if (!(total > 0)) throw new AdvanceError("Avans summasi yozilmagan — kamida bitta xodimga summa kiriting");
    const now = new Date();
    const u = await tx.advanceSheet.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SENT", sentAt: now, sentById: who.userId, recipientId: rec.id, note: input.note?.trim().slice(0, 300) || null } });
    if (!u.count) throw new AdvanceError(STALE);
    await audit(tx, who.userId, "STATUS_CHANGE", "AdvanceSheet", id, { status: "DRAFT" }, { status: "SENT", kimga: rec.fullName, xodim: agg._count, summa: total });
    return { docNo: sh.docNo, month: sh.month, total, count: agg._count };
  }));
  if ("error" in res) return res;
  notifyAfter(() => notifyUsers([rec.id], {
    type: "ADVANCE_SENT", title: "Avans berish kerak", body: `${res.docNo} · ${monthTitle(res.month)} · ${res.count} xodim · ${money(res.total)}`, link: { key: "avans", id },
  }));
  return { ok: true as const, note: `${rec.fullName}ga jo'natildi: ${res.count} xodim, ${money(res.total)}` };
}

/** Jo'natilgan, hali hech kimga berilmagan varaqani qoralamaga qaytarib olish (tahrir uchun). */
export async function recallAdvanceSheet(who: Who, id: string) {
  if (!canAdvance(who)) return { error: "Ruxsat yo'q" };
  return wrap(() => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AdvanceSheet" WHERE id = ${id} FOR UPDATE`;
    if (await tx.advanceLine.count({ where: { sheetId: id, givenAt: { not: null } } })) throw new AdvanceError("Avans berila boshlangan — qaytarib olib bo'lmaydi");
    const u = await tx.advanceSheet.updateMany({ where: { id, status: "SENT" }, data: { status: "DRAFT", sentAt: null, sentById: null, recipientId: null } });
    if (!u.count) throw new AdvanceError(STALE);
    await audit(tx, who.userId, "STATUS_CHANGE", "AdvanceSheet", id, { status: "SENT" }, { status: "DRAFT", action: "qaytarib olindi" });
    return { ok: true as const, note: "Qoralamaga qaytarildi" };
  }));
}

/** Bekor qilish — hali hech kimga avans berilmagan bo'lsa (qoralama yoki jo'natilgan). */
export async function cancelAdvanceSheet(who: Who, id: string, reason: string) {
  if (!canAdvance(who) && who.role !== "DIRECTOR") return { error: "Ruxsat yo'q" };
  if (reason.trim().length < 3) return { error: "Bekor qilish sababini yozing" };
  return wrap(() => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AdvanceSheet" WHERE id = ${id} FOR UPDATE`;
    if (await tx.advanceLine.count({ where: { sheetId: id, givenAt: { not: null } } })) throw new AdvanceError("Avans berilgan varaqa bekor qilinmaydi — berilganini qaytaring yoki varaqani yoping");
    const u = await tx.advanceSheet.updateMany({ where: { id, status: { in: ["DRAFT", "SENT"] } }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: who.userId, cancelReason: reason.trim().slice(0, 300) } });
    if (!u.count) throw new AdvanceError(STALE);
    await audit(tx, who.userId, "STATUS_CHANGE", "AdvanceSheet", id, undefined, { status: "CANCELLED", sabab: reason.trim() });
    return { ok: true as const, note: "Varaqa bekor qilindi" };
  }));
}

/** Qolganlariga bermasdan yopish (DONE): berilmagan qatorlar avans bo'lmaydi. Qabul qiluvchi yoki jo'natuvchi. */
export async function closeAdvanceSheet(who: Who, id: string) {
  const sh = await db.advanceSheet.findUnique({ where: { id }, select: { recipientId: true, createdById: true, sentById: true } });
  if (!sh) return { error: "Varaqa topilmadi" };
  if (!(who.userId === sh.recipientId || canAdvance(who) || who.role === "DIRECTOR")) return { error: "Ruxsat yo'q" };
  const res = await wrap(() => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AdvanceSheet" WHERE id = ${id} FOR UPDATE`;
    const given = await tx.advanceLine.count({ where: { sheetId: id, givenAt: { not: null } } });
    if (!given) throw new AdvanceError("Hech kimga berilmagan — varaqani bekor qiling");
    const left = await tx.advanceLine.count({ where: { sheetId: id, givenAt: null, amount: { gt: 0 } } });
    const u = await tx.advanceSheet.updateMany({ where: { id, status: "SENT" }, data: { status: "DONE", doneAt: new Date() } });
    if (!u.count) throw new AdvanceError(STALE);
    await audit(tx, who.userId, "STATUS_CHANGE", "AdvanceSheet", id, { status: "SENT" }, { status: "DONE", berilmadi: left });
    return { left };
  }));
  if ("error" in res) return res;
  return { ok: true as const, note: `Varaqa yopildi${res.left ? ` — ${res.left} xodimga berilmadi` : ""}` };
}

// ───────────────────────── Berish (kassa) va qaytarish ─────────────────────────

/**
 * «Berildi»: tanlangan (yoki hamma berilmagan) qatorlar — har biriga kassadan alohida «Ish haqi» chiqimi. Qabul qiluvchi
 * (yoki direktor), kassa huquqi bilan. Kassa qoldig'i qulf ostida tekshiriladi; qatorlar shartli yoziladi.
 */
export async function giveAdvance(who: Who, id: string, input: { cashAccountId: string; lineIds?: string[] | null }) {
  if (!canGiveAdvance(who)) return { error: "Avansni kassa huquqi bor xodim beradi" };
  const sh = await db.advanceSheet.findUnique({ where: { id }, select: { id: true, docNo: true, month: true, status: true, recipientId: true, sentById: true, createdById: true } });
  if (!sh) return { error: "Varaqa topilmadi" };
  if (sh.recipientId !== who.userId && who.role !== "DIRECTOR") return { error: "Bu varaqa boshqa xodimga jo'natilgan" };
  if (sh.status !== "SENT") return { error: sh.status === "DONE" ? "Varaqa yopilgan" : "Varaqa hali jo'natilmagan" };
  const acc = input.cashAccountId ? await db.cashAccount.findUnique({ where: { id: input.cashAccountId }, select: { id: true, isActive: true, name: true } }) : null;
  if (!acc?.isActive) return { error: "Qaysi kassadan berilishini tanlang" };
  const res = await wrap(() => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AdvanceSheet" WHERE id = ${id} FOR UPDATE`;
    const locked = await tabelLock(sh.month, tx);
    if (locked) throw new AdvanceError(`${monthTitle(sh.month)} oy yakuni yopilgan — avans berilsa ushlanmay qoladi. Avval oy yakuni vedomosti qoralamaga qaytarilsin`);
    const lines = await tx.advanceLine.findMany({
      where: { sheetId: id, givenAt: null, amount: { gt: 0 }, ...(input.lineIds?.length ? { id: { in: input.lineIds } } : {}) },
      select: { id: true, amount: true, employeeId: true, employee: { select: { fullName: true } } },
    });
    if (!lines.length) throw new AdvanceError("Beriladigan qator yo'q — hammasi berilgan");
    const total = lines.reduce((s, l) => s + num(l.amount), 0);
    const err = await cashOutflowError(tx, acc.id, total);
    if (err) throw new AdvanceError(err);
    const now = new Date();
    for (const l of lines) {
      const ct = await tx.cashTransaction.create({
        data: {
          type: "EXPENSE", date: now, cashAccountId: acc.id, amount: num(l.amount), category: PAYROLL_CATEGORY, counterparty: l.employee.fullName,
          refType: ADVANCE_REF, refId: id, createdById: who.userId, note: `Avans ${sh.docNo} · ${monthTitle(sh.month)}`,
        },
      });
      const n = await tx.advanceLine.updateMany({ where: { id: l.id, givenAt: null }, data: { givenAt: now, givenById: who.userId, cashTxId: ct.id, changedAt: now } });
      if (n.count !== 1) throw new AdvanceError(STALE);
      await audit(tx, who.userId, "CREATE", "CashTransaction", ct.id, undefined, ct);
    }
    const left = await tx.advanceLine.count({ where: { sheetId: id, givenAt: null, amount: { gt: 0 } } });
    if (!left) await tx.advanceSheet.update({ where: { id }, data: { status: "DONE", doneAt: now } });
    await audit(tx, who.userId, "UPDATE", "AdvanceSheet", id, undefined, { berildi: lines.length, summa: total, kassa: acc.name, qoldi: left });
    return { count: lines.length, total, left, employees: lines.map((l) => l.employeeId) };
  }, { timeout: 30_000 }));
  if ("error" in res) return res;
  notifyAfter(async () => {
    // Havolasiz: ilovadagi «oyligim/<id>» vedomost id kutadi (varaqa id bilan «topilmadi» chiqardi)
    await notifyEmployees(res.employees, { type: "ADVANCE_PAID", title: `Avans berildi — ${monthTitle(sh.month)}`, body: sh.docNo, channel: "oddiy" });
    if (!res.left) await notifyUsers([sh.sentById ?? sh.createdById].filter((u) => u !== who.userId), { type: "ADVANCE_DONE", title: "Avans to'liq berildi", body: `${sh.docNo} · ${monthTitle(sh.month)}`, link: { key: "avans", id } });
  });
  return { ok: true as const, note: `${res.count} xodimga ${money(res.total)} berildi${res.left ? ` · yana ${res.left} ta qoldi` : " · varaqa yopildi"}` };
}

/**
 * Noto'g'ri «Berildi»ni qaytarish (sabab bilan): kassa chiqimi bekor qilinadi, qator yana berilmagan. Belgilagan xodim
 * yoki direktor; oy yakuni yopilgan oyda bo'lmaydi (u avansni ushlab bo'lgan).
 */
export async function ungiveAdvance(who: Who, lineId: string, reason: string) {
  const why = reason.trim();
  if (why.length < 3) return { error: "Qaytarish sababini yozing (kamida 3 belgi)" };
  const line = await db.advanceLine.findUnique({ where: { id: lineId }, select: { id: true, sheetId: true, givenAt: true, givenById: true, cashTxId: true, amount: true, employee: { select: { fullName: true } }, sheet: { select: { docNo: true, month: true, status: true } } } });
  if (!line?.givenAt) return { error: "Bu qatorga avans berilmagan" };
  if (line.givenById !== who.userId && who.role !== "DIRECTOR") return { error: "Faqat avansni bergan xodim yoki direktor qaytaradi" };
  return wrap(() => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AdvanceSheet" WHERE id = ${line.sheetId} FOR UPDATE`;
    const locked = await tabelLock(line.sheet.month, tx);
    if (locked) throw new AdvanceError(`${monthTitle(line.sheet.month)} oy yakuni yopilgan — avans u yerda ushlangan. Avval oy yakuni vedomosti qoralamaga qaytarilsin`);
    const ct = line.cashTxId ? await tx.cashTransaction.findUnique({ where: { id: line.cashTxId } }) : null;
    if (ct && !ct.cancelledAt) {
      const err = await cancelCashTxIn(tx, ct, `Avans qaytarildi (${line.sheet.docNo}, ${line.employee.fullName}): ${why}`, who.userId);
      if (err) throw new AdvanceError(err);
    }
    const now = new Date();
    const n = await tx.advanceLine.updateMany({ where: { id: line.id, givenAt: { not: null } }, data: { givenAt: null, givenById: null, cashTxId: null, changedAt: now } });
    if (n.count !== 1) throw new AdvanceError(STALE);
    if (line.sheet.status === "DONE") await tx.advanceSheet.update({ where: { id: line.sheetId }, data: { status: "SENT", doneAt: null } });
    await audit(tx, who.userId, "UPDATE", "AdvanceLine", line.id, { givenAt: line.givenAt, cashTxId: line.cashTxId }, { givenAt: null, sabab: why, xodim: line.employee.fullName, summa: num(line.amount) });
    return { ok: true as const, note: `${line.employee.fullName}: avans qaytarildi, kassa chiqimi bekor qilindi` };
  }));
}
