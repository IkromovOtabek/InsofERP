import type { PayAdjKind, PayRule, PayType, PayrollKind, PayrollSettings, PayrollStatus, Prisma, Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import type { Perms } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { money } from "@/lib/format";
import { dayUtc, isoDay, monthDays, monthTitle, today, toMinutes, workedMinutes } from "@/lib/davomat";
import { earlyBy, lateBy } from "@/lib/attendance-time";
import { employeesInWindow } from "@/lib/attendance-report";
import { cashOutflowError } from "@/lib/payments";
import { notifyAfter, notifyEmployees, notifyRoles } from "@/lib/notify";
import { normDaysOf, plansInRange, type DayPlan } from "./shifts";
import { excusedDays } from "./excused";
import { PAYROLL_KIND_LABEL } from "./labels";

/**
 * Ish haqi — vedomost (`PayrollRun`) va qatorlar (`PayrollLine`).
 *
 * Oqim: otdel kadr hisoblaydi (DRAFT, istalgancha qayta hisoblanadi) → direktor tasdig'iga yuboradi (SUBMITTED) →
 * direktor tasdiqlaydi (APPROVED) yoki qaytaradi → kassa to'laydi (qator yoki hammasi; har to'lov — Kirim-Chiqimda
 * "Ish haqi" chiqimi, refType "Payroll") → hamma qator to'langach PAID. Hech narsa o'chirilmaydi: bekor qilish —
 * holat (faqat hali to'lanmagan vedomost), auditda qoladi.
 *
 * Hisob (oy yakuni, bir xodim):
 *   asosiy = oklad: stavka × kelgan kun / oy normasi · kunbay: stavka × kelgan kun · soatbay: stavka × soat ·
 *            sdelka: brigada mahsuloti × sdelka narxi, sdelkadagi a'zolarga ishlagan soati bo'yicha
 *   + ta'til puli (kunlik o'rtacha × haq to'lanadigan ta'til kuni) + kasallik (kunlik o'rtacha × foiz, staj bo'yicha)
 *   + bonus (qoidalar + qo'lda) = hisoblangan (gross)
 *   − JShDS (gross × %) − jarima (qoidalar + qo'lda) − shu oy to'langan avanslar = qo'lga
 *   INPS (gross × 0,1%) — JShDS ichidan o'tkaziladi, qo'lga summaga ta'sir qilmaydi; ijtimoiy soliq — ish beruvchi.
 */

export const PAYROLL_REF = "Payroll";
export const PAYROLL_CATEGORY = "Ish haqi";
/** Ish haqi bo'limini ko'radigan rollar (veb menyu va mobil ro'yxat). */
export const PAYROLL_VIEW_ROLES: Role[] = ["HR", "ACCOUNTING", "FINANCE", "CASHIER"];
/** Kim nima qiladi — `lib/permissions.ts` → "payroll" (direktor ruxsati bilan); veb va mobil bir xil. */
export type PayrollWho = { userId: string; role: Role; perms?: Perms };
export const canPayroll = (who: Pick<PayrollWho, "role" | "perms">, what: "calc" | "approve" | "pay" | "settings") => canDo(who, "payroll", what);

export class PayrollError extends Error {}
const STALE = "Vedomost boshqa joyda o'zgartirildi — sahifani yangilang";
const r0 = (n: number) => Math.round(n);
const thousand = (n: number) => Math.round(n / 1000) * 1000;
const num = (v: unknown) => Number(v ?? 0);

export async function payrollSettings(tx: Prisma.TransactionClient = db): Promise<PayrollSettings> {
  return (await tx.payrollSettings.findUnique({ where: { id: "main" } })) ?? (await tx.payrollSettings.create({ data: { id: "main" } }));
}

// ───────────────────────── Hisob ─────────────────────────

export type RuleHit = { rule: string; kind: PayAdjKind; amount: number; days: number; detail: string };
export type LineBreakdown = {
  period: { from: string; to: string };
  normDays: number; presentDays: number; paidLeaveDays: number; unpaidLeaveDays: number; sickDays: number; absentDays: number; dayoffDays: number;
  minutes: number; dailyAvg: number; sickPct: number;
  piece?: { brigade: string; pool: number; share: number; units: { product: string; qty: number; rate: number; sum: number }[] };
  rules: RuleHit[];
  manual: { id: string; kind: PayAdjKind; amount: number; reason: string }[];
  advances: { docNo: string; amount: number }[];
  advanceFormula?: string;
  warnings: string[];
};

type CalcLine = {
  employeeId: string; fullName: string; position: string; payType: PayType; rate: number;
  normDays: number; workedDays: number; workedMinutes: number; units: number;
  base: number; leavePay: number; sickPay: number; bonus: number; penalty: number; gross: number;
  incomeTax: number; inps: number; advanceDeducted: number; net: number; employerTax: number;
  breakdown: LineBreakdown;
};

type Emp = { id: string; fullName: string; position: string; payType: PayType; tariffRate: unknown; hiredAt: Date | null; firedAt: Date | null; workSchedule: string | null; brigadeId: string | null };

const ruleFits = (r: PayRule, position: string) => !r.position || r.position.trim().toLowerCase() === position.trim().toLowerCase();

/**
 * Oy (yoki avans davri) bo'yicha hisob. Bazaga yozmaydi — vedomost yaratish/qayta hisoblash shu natijani saqlaydi,
 * xodim kartasidagi "Bu oy" ko'rinishi ham shundan.
 */
export async function calculate(month: string, kind: Exclude<PayrollKind, "EXTRA">, opts: { employeeIds?: string[] } = {}): Promise<CalcLine[]> {
  const st = await payrollSettings();
  const days = monthDays(month);
  const from = days[0]!.iso;
  const monthEnd = days[days.length - 1]!.iso;
  const advDay = Math.min(Math.max(st.advanceDay, 1), days.length);
  const to = kind === "ADVANCE" ? days[advDay - 1]!.iso : monthEnd;
  const fromD = dayUtc(from), toD = dayUtc(to);

  const emps: Emp[] = await db.employee.findMany({
    where: { AND: [employeesInWindow(fromD, toD), { OR: [{ userId: null }, { user: { role: { notIn: ["SUPERADMIN"] } } }] }, ...(opts.employeeIds ? [{ id: { in: opts.employeeIds } }] : [])] },
    orderBy: [{ position: "asc" }, { fullName: "asc" }],
    select: { id: true, fullName: true, position: true, payType: true, tariffRate: true, hiredAt: true, firedAt: true, workSchedule: true, brigadeId: true },
  });
  if (!emps.length) return [];
  const ids = emps.map((e) => e.id);
  const [att, plans, excused, rules, manual, advances, piece] = await Promise.all([
    db.attendance.findMany({ where: { employeeId: { in: ids }, date: { gte: fromD, lte: toD } }, select: { employeeId: true, date: true, status: true, checkIn: true, checkOut: true, lateMinutes: true } }),
    plansInRange(emps, from, monthEnd),
    excusedDays(ids, from, to),
    kind === "FINAL" ? db.payRule.findMany({ where: { isActive: true } }) : Promise.resolve([] as PayRule[]),
    kind === "FINAL" ? db.payAdjustment.findMany({ where: { month, employeeId: { in: ids }, cancelledAt: null } }) : Promise.resolve([]),
    // Shu oy uchun allaqachon to'langan avans / alohida to'lovlar — yakunda ushlanadi, avansda takror berilmaydi
    db.payrollLine.findMany({
      where: { employeeId: { in: ids }, paid: { gt: 0 }, run: { month, kind: kind === "FINAL" ? { in: ["ADVANCE", "EXTRA"] } : "EXTRA", status: { in: ["APPROVED", "PAID"] } } },
      select: { employeeId: true, paid: true, run: { select: { docNo: true } } },
    }),
    piecePools(emps.filter((e) => e.payType === "PIECE"), from, to),
  ]);
  const attBy = new Map<string, typeof att>();
  for (const a of att) attBy.set(a.employeeId, [...(attBy.get(a.employeeId) ?? []), a]);
  const nowIso = today();

  // Sdelka: brigada fondi a'zolarga ishlagan daqiqasi bo'yicha (daqiqa yo'q bo'lsa — kelgan kuni bo'yicha)
  const minutesOf = (id: string) => (attBy.get(id) ?? []).reduce((s, a) => s + (a.status === "PRESENT" ? minutesFor(a, plans.get(id)?.get(isoDay(a.date)), nowIso) : 0), 0);
  const presentOf = (id: string) => (attBy.get(id) ?? []).filter((a) => a.status === "PRESENT").length;
  const shareOf = new Map<string, number>();
  for (const bid of piece.keys()) {
    const members = emps.filter((e) => e.payType === "PIECE" && e.brigadeId === bid);
    const w = members.map((m) => ({ id: m.id, w: minutesOf(m.id) || presentOf(m.id) * 480 }));
    const total = w.reduce((s, x) => s + x.w, 0);
    for (const x of w) shareOf.set(x.id, total > 0 ? x.w / total : 0);
  }

  const out: CalcLine[] = [];
  for (const e of emps) {
    const plan = plans.get(e.id)!;
    const rate = num(e.tariffRate);
    const warnings: string[] = [];
    const lo = e.hiredAt && isoDay(e.hiredAt) > from ? isoDay(e.hiredAt) : from;
    const hi = e.firedAt && isoDay(e.firedAt) < to ? isoDay(e.firedAt) : to;
    const inJob = (iso: string) => iso >= lo && iso <= hi;
    const normMonth = normDaysOf(plan, month);
    const periodDays = days.filter((d) => d.iso <= to);
    const normPeriod = periodDays.filter((d) => !(plan.get(d.iso)?.off ?? d.weekend)).length;
    const normInJob = periodDays.filter((d) => inJob(d.iso) && !(plan.get(d.iso)?.off ?? d.weekend)).length;
    const ex = excused.get(e.id);
    const rows = (attBy.get(e.id) ?? []).filter((a) => inJob(isoDay(a.date)));

    let present = 0, minutes = 0, paidLeave = 0, unpaidLeave = 0, sick = 0, absent = 0, dayoff = 0;
    const lateDays: { iso: string; min: number }[] = [];
    const earlyDays: { iso: string; min: number }[] = [];
    for (const a of rows) {
      const iso = isoDay(a.date);
      const p = plan.get(iso);
      if (a.status === "PRESENT") {
        present++;
        minutes += minutesFor(a, p, nowIso);
        const late = a.lateMinutes != null ? a.lateMinutes : lateBy(a.checkIn, p?.start ?? "08:00") ?? 0;
        if (late > 0 && !ex?.late.has(iso)) lateDays.push({ iso, min: late });
        const early = a.checkOut && p ? earlyBy(a.checkOut, p.end) : null;
        if (early && early > 0) earlyDays.push({ iso, min: early });
      } else if (a.status === "LEAVE") { if (ex?.unpaid.has(iso)) unpaidLeave++; else paidLeave++; }
      else if (a.status === "SICK") sick++;
      else if (a.status === "ABSENT") { if (!ex?.absent.has(iso)) absent++; }
      else if (a.status === "DAYOFF") dayoff++;
    }
    if (rate <= 0 && e.payType !== "PIECE") warnings.push("Tarif stavka kiritilmagan — kartada «Tarif stavka» ni to'ldiring");

    // Asosiy
    let base = 0, units = 0;
    let pieceInfo: LineBreakdown["piece"];
    if (e.payType === "SALARY") base = normMonth > 0 ? (rate * present) / normMonth : 0;
    else if (e.payType === "DAILY") base = rate * present;
    else if (e.payType === "HOURLY") base = (rate * minutes) / 60;
    else {
      const pool = e.brigadeId ? piece.get(e.brigadeId) : undefined;
      if (!e.brigadeId) warnings.push("Sdelka: xodim brigadaga biriktirilmagan");
      else if (!pool || pool.sum === 0) warnings.push("Sdelka: brigadada shu davrda bajarilgan ish yo'q yoki mahsulotlarga sdelka narxi qo'yilmagan");
      const share = shareOf.get(e.id) ?? 0;
      if (pool) {
        base = pool.sum * share;
        units = pool.units.reduce((s, u) => s + u.qty, 0) * share;
        pieceInfo = { brigade: pool.brigade, pool: r0(pool.sum), share: Math.round(share * 1000) / 10, units: pool.units };
      }
    }
    const shiftHours = Number(st.hoursPerDay) || 8;
    const dailyAvg = e.payType === "SALARY" ? (normMonth > 0 ? rate / normMonth : 0)
      : e.payType === "DAILY" ? rate
      : e.payType === "HOURLY" ? rate * shiftHours
      : present > 0 ? base / present : 0;

    const tenureYears = e.hiredAt ? (dayUtc(to).getTime() - e.hiredAt.getTime()) / (365.25 * 864e5) : 0;
    const sickPct = tenureYears >= 8 ? st.sickPctLong : st.sickPctShort;
    let leavePay = 0, sickPay = 0, bonus = 0, penalty = 0;
    const hits: RuleHit[] = [];
    const manualList: LineBreakdown["manual"] = [];
    let advanceFormula: string | undefined;

    if (kind === "FINAL") {
      leavePay = st.vacationPaid ? paidLeave * dailyAvg : 0;
      sickPay = (sick * dailyAvg * sickPct) / 100;
      // Avtomatik qoidalar — hamma uchun bir xil
      for (const r of rules) {
        if (!ruleFits(r, e.position)) continue;
        const amt = num(r.amount);
        let total = 0, n = 0;
        let detail = "";
        if (r.trigger === "LATE" || r.trigger === "EARLY_LEAVE") {
          const list = (r.trigger === "LATE" ? lateDays : earlyDays).filter((d) => d.min > r.graceMinutes);
          n = list.length;
          const mins = list.reduce((s, d) => s + d.min - r.graceMinutes, 0);
          total = r.perMinute ? amt * mins : amt * n;
          detail = r.perMinute ? `${n} kun, ${mins} daqiqa × ${money(amt)}` : `${n} kun × ${money(amt)}`;
        } else if (r.trigger === "ABSENT") {
          n = absent; total = amt * n; detail = `${n} kun × ${money(amt)}`;
        } else if (r.trigger === "NO_LATE_MONTH") {
          if (present > 0 && absent === 0 && !lateDays.some((d) => d.min > r.graceMinutes)) { n = 1; total = amt; detail = "kechikishsiz oy"; }
        } else if (r.trigger === "FULL_MONTH") {
          if (normInJob > 0 && present >= normInJob) { n = 1; total = amt; detail = `${present}/${normInJob} kun`; }
        }
        if (r.maxPerMonth != null && total > num(r.maxPerMonth)) { total = num(r.maxPerMonth); detail += ` (oyiga ko'pi ${money(total)})`; }
        if (total > 0) {
          hits.push({ rule: r.name, kind: r.kind, amount: r0(total), days: n, detail });
          if (r.kind === "BONUS") bonus += total; else penalty += total;
        }
      }
      for (const m of manual.filter((x) => x.employeeId === e.id)) {
        manualList.push({ id: m.id, kind: m.kind, amount: num(m.amount), reason: m.reason });
        if (m.kind === "BONUS") bonus += num(m.amount); else penalty += num(m.amount);
      }
    } else {
      // Avans: shu kungacha hisoblangan summadan oylik bashorat × foiz (oklad, to'liq kelgan — oylikning foizi)
      const projected = normPeriod > 0 ? (base * normMonth) / normPeriod : base;
      advanceFormula = `${money(r0(base))} (1–${advDay} kun) → oyga ${money(r0(projected))} × ${st.advancePct}%`;
      base = thousand((projected * st.advancePct) / 100);
    }

    const adv = advances.filter((a) => a.employeeId === e.id).map((a) => ({ docNo: a.run.docNo, amount: num(a.paid) }));
    const advanceSum = adv.reduce((s, a) => s + a.amount, 0);
    const gross = r0(base) + r0(leavePay) + r0(sickPay) + r0(bonus);
    const incomeTax = kind === "FINAL" ? r0((gross * Number(st.incomeTaxPct)) / 100) : 0;
    const inps = kind === "FINAL" ? r0((gross * Number(st.inpsPct)) / 100) : 0;
    const employerTax = kind === "FINAL" ? r0((gross * Number(st.socialTaxPct)) / 100) : 0;
    const net = kind === "FINAL" ? gross - incomeTax - r0(penalty) - r0(advanceSum) : Math.max(0, gross - r0(advanceSum));
    if (kind === "FINAL" && net < 0) warnings.push(`Ushlanmalar hisoblangandan ko'p — xodim qarzi ${money(-net)}`);

    out.push({
      employeeId: e.id, fullName: e.fullName, position: e.position, payType: e.payType, rate,
      normDays: normMonth, workedDays: present, workedMinutes: minutes, units: Math.round(units * 1000) / 1000,
      base: r0(base), leavePay: r0(leavePay), sickPay: r0(sickPay), bonus: r0(bonus), penalty: r0(penalty), gross,
      incomeTax, inps, advanceDeducted: r0(advanceSum), net, employerTax,
      breakdown: {
        period: { from: lo, to: hi }, normDays: normMonth, presentDays: present, paidLeaveDays: paidLeave, unpaidLeaveDays: unpaidLeave,
        sickDays: sick, absentDays: absent, dayoffDays: dayoff, minutes, dailyAvg: r0(dailyAvg), sickPct,
        ...(pieceInfo ? { piece: pieceInfo } : {}), rules: hits, manual: manualList, advances: adv,
        ...(advanceFormula ? { advanceFormula } : {}), warnings,
      },
    });
  }
  return out;
}

/** Ishlangan daqiqa: "Ketdi" belgilanmagan o'tgan kun — smena oxirigacha deb olinadi (tabel ochiq qolmasin). */
function minutesFor(a: { checkIn: string | null; checkOut: string | null; date: Date }, p: DayPlan | undefined, nowIso: string): number {
  const m = workedMinutes(a.checkIn, a.checkOut);
  if (m != null) return m;
  if (a.checkIn && p && isoDay(a.date) < nowIso && toMinutes(p.end) != null) return workedMinutes(a.checkIn, p.end) ?? 0;
  return 0;
}

/** Sdelka fondi brigada bo'yicha: bajarilgan hajm (`TaskProgress`) × mahsulotning sdelka narxi. */
async function piecePools(emps: Emp[], from: string, to: string) {
  const brigadeIds = [...new Set(emps.map((e) => e.brigadeId).filter((x): x is string => !!x))];
  const out = new Map<string, { brigade: string; sum: number; units: { product: string; qty: number; rate: number; sum: number }[] }>();
  if (!brigadeIds.length) return out;
  const rows = await db.taskProgress.findMany({
    where: { date: { gte: dayUtc(from), lte: dayUtc(to) }, task: { brigadeId: { in: brigadeIds }, status: { not: "CANCELLED" } } },
    select: { qty: true, task: { select: { brigadeId: true, brigade: { select: { name: true } }, orderItem: { select: { product: { select: { name: true, pieceRate: true } } } } } } },
  });
  for (const r of rows) {
    const b = out.get(r.task.brigadeId) ?? { brigade: r.task.brigade.name, sum: 0, units: [] };
    const p = r.task.orderItem.product;
    const rate = num(p.pieceRate);
    const qty = num(r.qty);
    const u = b.units.find((x) => x.product === p.name) ?? (b.units[b.units.push({ product: p.name, qty: 0, rate, sum: 0 }) - 1])!;
    u.qty += qty; u.sum += qty * rate; b.sum += qty * rate;
    out.set(r.task.brigadeId, b);
  }
  for (const b of out.values()) for (const u of b.units) { u.qty = Math.round(u.qty * 1000) / 1000; u.sum = r0(u.sum); }
  return out;
}

// ───────────────────────── Vedomost ─────────────────────────

const KIND_CODE: Record<PayrollKind, string> = { ADVANCE: "A", FINAL: "Y", EXTRA: "X" };
async function nextRunNo(tx: Prisma.TransactionClient, month: string, kind: PayrollKind) {
  const head = `IH-${month}-${KIND_CODE[kind]}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"docno:" + head}))`;
  const n = await tx.payrollRun.count({ where: { docNo: { startsWith: head } } });
  return kind === "EXTRA" ? `${head}${n + 1}` : n ? `${head}-${n + 1}` : head;
}

async function writeLines(tx: Prisma.TransactionClient, runId: string, lines: CalcLine[]) {
  await tx.payrollLine.deleteMany({ where: { runId } }); // faqat DRAFT da (pul yo'q) — qayta hisob
  if (lines.length) {
    await tx.payrollLine.createMany({
      data: lines.map((l) => ({
        runId, employeeId: l.employeeId, payType: l.payType, rate: l.rate, normDays: l.normDays, workedDays: l.workedDays, workedMinutes: l.workedMinutes,
        units: l.units, base: l.base, leavePay: l.leavePay, sickPay: l.sickPay, bonus: l.bonus, penalty: l.penalty, gross: l.gross,
        incomeTax: l.incomeTax, inps: l.inps, advanceDeducted: l.advanceDeducted, net: l.net, employerTax: l.employerTax,
        breakdown: l.breakdown as unknown as Prisma.InputJsonValue,
      })),
    });
  }
  const t = totals(lines);
  await tx.payrollRun.update({ where: { id: runId }, data: { ...t, calculatedAt: new Date() } });
  return t;
}
const totals = (lines: { gross: number; incomeTax: number; penalty: number; advanceDeducted: number; net: number; employerTax: number }[]) => ({
  gross: lines.reduce((s, l) => s + l.gross, 0),
  deductions: lines.reduce((s, l) => s + l.incomeTax + l.penalty + l.advanceDeducted, 0),
  net: lines.reduce((s, l) => s + Math.max(0, l.net), 0),
  employerTax: lines.reduce((s, l) => s + l.employerTax, 0),
});

/** Oy uchun avans yoki yakuniy vedomostni hisoblash (bor qoralama bo'lsa — qayta hisoblanadi). */
export async function calculateRun(month: string, kind: Exclude<PayrollKind, "EXTRA">, user: PayrollWho): Promise<{ id?: string; error?: string; note?: string }> {
  if (!canPayroll(user, "calc")) return { error: "Ish haqini otdel kadr yoki buxgalteriya hisoblaydi" };
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "Oy noto'g'ri" };
  if (month > today().slice(0, 7)) return { error: "Kelajak oyi uchun hisoblab bo'lmaydi" };
  const lines = await calculate(month, kind);
  if (!lines.length) return { error: "Shu oyda ishlagan xodim topilmadi" };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"payroll:" + month + kind}))`;
    const cur = await tx.payrollRun.findFirst({ where: { month, kind, status: { not: "CANCELLED" } } });
    if (cur && cur.status !== "DRAFT") return { error: `${cur.docNo} allaqachon ${cur.status === "SUBMITTED" ? "direktor tasdig'ida" : "tasdiqlangan"} — qayta hisoblash uchun avval qoralamaga qaytarilsin` };
    const run = cur ?? await tx.payrollRun.create({ data: { docNo: await nextRunNo(tx, month, kind), month, kind, createdById: user.userId } });
    const t = await writeLines(tx, run.id, lines);
    await audit(tx, user.userId, cur ? "UPDATE" : "CREATE", "PayrollRun", run.id, cur ? { gross: cur.gross, net: cur.net } : undefined, { docNo: run.docNo, month, kind, lines: lines.length, ...t });
    return { id: run.id, note: `${run.docNo}: ${lines.length} xodim, qo'lga ${money(t.net)}${cur ? " (qayta hisoblandi)" : ""}` };
  }, { timeout: 60_000 });
}

/** Tasdiqlangan avans arizasi → bitta xodimga alohida vedomost (direktor tasdig'ida). Ariza tranzaksiyasi ichida. */
export async function createAdvancePayout(tx: Prisma.TransactionClient, input: { employeeId: string; amount: number; requestId: string; docNo: string }, userId: string): Promise<string> {
  const month = today().slice(0, 7);
  const e = await tx.employee.findUniqueOrThrow({ where: { id: input.employeeId }, select: { payType: true, tariffRate: true } });
  const amount = Math.round(input.amount);
  const run = await tx.payrollRun.create({
    data: { docNo: await nextRunNo(tx, month, "EXTRA"), month, kind: "EXTRA", status: "SUBMITTED", submittedAt: new Date(), createdById: userId, gross: amount, net: amount, note: `Avans arizasi ${input.docNo}` },
  });
  await tx.payrollLine.create({
    data: {
      runId: run.id, employeeId: input.employeeId, payType: e.payType, rate: num(e.tariffRate), base: amount, gross: amount, net: amount,
      breakdown: { period: { from: `${month}-01`, to: today() }, normDays: 0, presentDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, sickDays: 0, absentDays: 0, dayoffDays: 0, minutes: 0, dailyAvg: 0, sickPct: 0, rules: [], manual: [], advances: [], advanceFormula: `Avans arizasi ${input.docNo}`, warnings: [] } satisfies LineBreakdown as unknown as Prisma.InputJsonValue,
    },
  });
  await audit(tx, userId, "CREATE", "PayrollRun", run.id, undefined, { docNo: run.docNo, kind: "EXTRA", amount, requestId: input.requestId });
  return run.id;
}

async function transition(id: string, from: PayrollStatus[], data: Prisma.PayrollRunUpdateManyMutationInput, userId: string, label: string) {
  return db.$transaction(async (tx) => {
    const before = await tx.payrollRun.findUnique({ where: { id }, select: { status: true, docNo: true, month: true, kind: true, net: true, paid: true } });
    if (!before) throw new PayrollError("Vedomost topilmadi");
    const n = await tx.payrollRun.updateMany({ where: { id, status: { in: from } }, data });
    if (n.count === 0) throw new PayrollError(STALE);
    await audit(tx, userId, "STATUS_CHANGE", "PayrollRun", id, { status: before.status }, { status: data.status, action: label });
    return before;
  });
}
const wrap = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
  try { return await fn(); } catch (e) { if (e instanceof PayrollError) return { error: e.message }; throw e; }
};

export async function submitRun(id: string, user: PayrollWho) {
  if (!canPayroll(user, "calc")) return { error: "Ruxsat yo'q" };
  return wrap(async () => {
    const r = await transition(id, ["DRAFT"], { status: "SUBMITTED", submittedAt: new Date(), rejectNote: null }, user.userId, "submit");
    notifyAfter(() => notifyRoles(["DIRECTOR"], { type: "PAYROLL_SUBMITTED", title: `${PAYROLL_KIND_LABEL[r.kind]} — tasdiqlang`, body: `${r.docNo} · ${monthTitle(r.month)} · qo'lga ${money(num(r.net))}`, link: { key: "ish-haqi", id } }));
    return { ok: true as const, note: "Direktor tasdig'iga yuborildi" };
  });
}

export async function approveRun(id: string, user: PayrollWho) {
  if (!canPayroll(user, "approve")) return { error: "Ish haqini faqat direktor tasdiqlaydi" };
  return wrap(async () => {
    const r = await transition(id, ["SUBMITTED"], { status: "APPROVED", approvedById: user.userId, approvedAt: new Date() }, user.userId, "approve");
    notifyAfter(() => notifyRoles(["CASHIER", "HR"], { type: "PAYROLL_APPROVED", title: `${r.docNo} tasdiqlandi — to'lovga`, body: `${monthTitle(r.month)} · ${PAYROLL_KIND_LABEL[r.kind]} · ${money(num(r.net))}`, link: { key: "ish-haqi", id } }, { except: user.userId }));
    return { ok: true as const, note: "Tasdiqlandi — kassa to'laydi" };
  });
}

/** Direktor qaytaradi (izoh bilan) — kadr tuzatib, qayta yuboradi. */
export async function returnRun(id: string, note: string, user: PayrollWho) {
  if (!canPayroll(user, "approve")) return { error: "Faqat direktor qaytaradi" };
  if (!note.trim()) return { error: "Qaytarish sababini yozing" };
  return wrap(async () => {
    const r = await transition(id, ["SUBMITTED"], { status: "DRAFT", rejectNote: note.trim().slice(0, 500) }, user.userId, "return");
    notifyAfter(() => notifyRoles(["HR", "ACCOUNTING"], { type: "PAYROLL_RETURNED", title: `${r.docNo} qaytarildi`, body: note, link: { key: "ish-haqi", id } }));
    return { ok: true as const, note: "Qoralamaga qaytarildi" };
  });
}

/** Bekor qilish — faqat direktor va faqat hali hech kimga pul berilmagan bo'lsa. */
export async function cancelRun(id: string, reason: string, user: PayrollWho) {
  if (user.role !== "DIRECTOR") return { error: "Vedomostni faqat direktor bekor qiladi" };
  if (reason.trim().length < 3) return { error: "Bekor qilish sababini yozing" };
  return wrap(async () => {
    const paid = await db.payrollLine.count({ where: { runId: id, paid: { gt: 0 } } });
    if (paid) throw new PayrollError("To'lov qilingan vedomost bekor qilinmaydi");
    await transition(id, ["DRAFT", "SUBMITTED", "APPROVED"], { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.trim(), cancelledById: user.userId }, user.userId, "cancel");
    return { ok: true as const, note: "Vedomost bekor qilindi" };
  });
}

/**
 * Kassadan to'lash: tanlangan (yoki hamma) to'lanmagan qatorlar — bitta "Ish haqi" chiqimi. Kassa qoldig'i qulf ostida
 * tekshiriladi; qatorlar shartli yoziladi (ikki marta bosish ikki marta to'lamaydi).
 */
export async function payRun(id: string, input: { cashAccountId: string; lineIds?: string[] | null; note?: string | null }, user: PayrollWho) {
  if (!canPayroll(user, "pay")) return { error: "Ish haqini kassir to'laydi" };
  const run = await db.payrollRun.findUnique({ where: { id }, select: { id: true, docNo: true, status: true, month: true, kind: true } });
  if (!run) return { error: "Vedomost topilmadi" };
  if (run.status !== "APPROVED") return { error: run.status === "PAID" ? "Vedomost to'liq to'langan" : "Vedomost hali direktor tomonidan tasdiqlanmagan" };
  const acc = input.cashAccountId ? await db.cashAccount.findUnique({ where: { id: input.cashAccountId } }) : null;
  if (!acc || !acc.isActive) return { error: "Kassa / hisob tanlanmagan" };

  return wrap(async () => {
    const res = await db.$transaction(async (tx) => {
      const lines = await tx.payrollLine.findMany({
        where: { runId: id, paidAt: null, net: { gt: 0 }, ...(input.lineIds?.length ? { id: { in: input.lineIds } } : {}) },
        select: { id: true, net: true, employeeId: true, employee: { select: { fullName: true } } },
      });
      if (!lines.length) throw new PayrollError("To'lanadigan qator yo'q — hammasi to'langan");
      const total = lines.reduce((s, l) => s + num(l.net), 0);
      const cashErr = await cashOutflowError(tx, acc.id, total);
      if (cashErr) throw new PayrollError(cashErr);
      const now = new Date();
      const ct = await tx.cashTransaction.create({
        data: {
          type: "EXPENSE", date: now, cashAccountId: acc.id, amount: total, category: PAYROLL_CATEGORY,
          counterparty: lines.length === 1 ? lines[0]!.employee.fullName : `${lines.length} xodim`,
          refType: PAYROLL_REF, refId: id, createdById: user.userId,
          note: [`Ish haqi ${run.docNo} · ${monthTitle(run.month)} · ${PAYROLL_KIND_LABEL[run.kind]}`, input.note?.trim()].filter(Boolean).join(" · ").slice(0, 500),
        },
      });
      for (const l of lines) {
        const n = await tx.payrollLine.updateMany({ where: { id: l.id, paidAt: null }, data: { paid: l.net, paidAt: now, paidById: user.userId, cashTxId: ct.id } });
        if (n.count !== 1) throw new PayrollError(STALE);
      }
      const left = await tx.payrollLine.count({ where: { runId: id, paidAt: null, net: { gt: 0 } } });
      const paidSum = await tx.payrollLine.aggregate({ where: { runId: id }, _sum: { paid: true } });
      await tx.payrollRun.update({ where: { id }, data: { paid: paidSum._sum.paid ?? 0, ...(left === 0 ? { status: "PAID" } : {}) } });
      await audit(tx, user.userId, "CREATE", "CashTransaction", ct.id, undefined, ct);
      await audit(tx, user.userId, "UPDATE", "PayrollRun", id, undefined, { tolandi: lines.length, summa: total, cashTxId: ct.id, qoldi: left });
      return { total, count: lines.length, employees: lines.map((l) => l.employeeId), left };
    });
    notifyAfter(() => notifyEmployees(res.employees, { type: "PAYROLL_PAID", title: `Ish haqi berildi — ${monthTitle(run.month)}`, body: `${PAYROLL_KIND_LABEL[run.kind]} · ${run.docNo}`, link: { key: "oyligim", id: run.id }, channel: "oddiy" }));
    return { ok: true as const, note: `${res.count} xodimga ${money(res.total)} to'landi${res.left ? ` · yana ${res.left} ta qator qoldi` : " · vedomost yopildi"}` };
  });
}

// ───────────────────────── O'qish ─────────────────────────

export async function listRuns(opts: { month?: string; take?: number } = {}) {
  return db.payrollRun.findMany({
    where: opts.month ? { month: opts.month } : {},
    orderBy: [{ month: "desc" }, { createdAt: "desc" }], take: opts.take ?? 60,
    include: { _count: { select: { lines: true } } },
  });
}

export async function runWithLines(id: string) {
  return db.payrollRun.findUnique({
    where: { id },
    include: { lines: { include: { employee: { select: { id: true, fullName: true, position: true, tabelNo: true } } }, orderBy: { employee: { fullName: "asc" } } } },
  });
}

/** Xodimning o'z hisob-kitoblari (tasdiqlangan va to'langan vedomostlar). */
export async function myLines(employeeId: string, take = 24) {
  return db.payrollLine.findMany({
    where: { employeeId, run: { status: { in: ["APPROVED", "PAID"] } } },
    orderBy: { run: { month: "desc" } }, take,
    include: { run: { select: { id: true, docNo: true, month: true, kind: true, status: true } } },
  });
}

export const breakdownOf = (v: unknown) => (v && typeof v === "object" ? (v as LineBreakdown) : null);
