import type { PayAdjKind, PayRule, PayType, PayrollKind, PayrollSettings, PayrollStatus, Prisma, Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import type { Perms } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { audit, auditMany } from "@/lib/audit";
import { money } from "@/lib/format";
import { MAX_SHIFT_MINUTES, dayUtc, isoDay, monthDays, monthTitle, shiftMonth, today, toMinutes, workedMinutes } from "@/lib/davomat";
import { earlyBy, lateBy } from "@/lib/attendance-time";
import { employeesInWindow } from "@/lib/attendance-report";
import { cashOutflowError } from "@/lib/payments";
import { cancelCashTxIn } from "@/lib/cash-entry";
import { notifyAfter, notifyEmployees, notifyRoles } from "@/lib/notify";
import { normDaysOf, plansInRange, type DayPlan } from "./shifts";
import { excusedDays } from "./excused";
import { kpiMonth } from "./kpi";
import { tripPayByDriver } from "@/lib/driver-trip-pay";
import { PAYROLL_KIND_LABEL } from "./labels";
import { brigadeDefectSums, brigadeOutput, dayEnd, dayStart, type PieceUnit } from "@/lib/brigade-pay";
import { debtsDue } from "./employee-debt";
import { brigadeSheetPay, type SheetPayItem } from "./brigade-sheet";
import { allocate, ledgersFor, staffCashFor, type StaffCash } from "./deductions";

/**
 * Ish haqi — vedomost (`PayrollRun`) va qatorlar (`PayrollLine`).
 *
 * Oqim: otdel kadr hisoblaydi (DRAFT, istalgancha qayta hisoblanadi) → direktor tasdig'iga yuboradi (SUBMITTED) →
 * direktor tasdiqlaydi (APPROVED) yoki qaytaradi → kassa to'laydi (qator yoki hammasi; har to'lov — Kirim-Chiqimda
 * "Ish haqi" chiqimi, refType "Payroll") → hamma qator to'langach PAID. Hech narsa o'chirilmaydi: bekor qilish —
 * holat (faqat hali to'lanmagan vedomost), auditda qoladi. Noto'g'ri to'lov — direktor «To'lovni bekor qilish» (`unpayRun`):
 * chiqim kassada bekor qilinadi, qatorlar yana to'lanmagan, vedomost APPROVED.
 *
 * Hisob (oy yakuni, bir xodim):
 *   asosiy = oklad: stavka × kelgan kun / oy normasi · kunbay: stavka × kelgan kun · soatbay: stavka × soat ·
 *            sdelka: brigada mahsuloti × sdelka narxi, sdelkadagi a'zolarga ishlagan soati bo'yicha
 *   + ta'til puli (kunlik o'rtacha × haq to'lanadigan ta'til kuni) + kasallik (kunlik o'rtacha × foiz, staj bo'yicha)
 *   + bonus (qoidalar + qo'lda) = hisoblangan (gross)
 *   − JShDS (gross × %) − jarima (qoidalar + qo'lda + brigada braki ulushi + o'tgan oydan qarz) − shu oy to'langan avanslar = qo'lga
 *   O'tgan oydan qarz: xodimning eng so'nggi tasdiqlangan (APPROVED / PAID) oy yakuni vedomostida qo'lga manfiy bo'lsa —
 *   shu summa ushlanadi; yana yetmasa qolgani keyingi oyga o'tadi (zanjir, xodim bir oy ishlamasa ham yo'qolmaydi).
 *   INPS (gross × 0,1%) — JShDS ichidan o'tkaziladi, qo'lga summaga ta'sir qilmaydi; ijtimoiy soliq — ish beruvchi.
 */

export const PAYROLL_REF = "Payroll";
export const PAYROLL_CATEGORY = "Ish haqi";
/** Ish haqi bo'limini ko'radigan rollar (veb menyu va mobil ro'yxat). */
export const PAYROLL_VIEW_ROLES: Role[] = ["HR", "ACCOUNTING", "FINANCE", "CASHIER"];
/** Kim nima qiladi — `lib/permissions.ts` → "payroll" (direktor ruxsati bilan); veb va mobil bir xil. */
export type PayrollWho = { userId: string; role: Role; perms?: Perms };
export const canPayroll = (who: Pick<PayrollWho, "role" | "perms">, what: "calc" | "approve" | "pay" | "settings" | "debts" | "sheets" | "rate" | "tabel" | "deductions" | "advance" | "advance_delete") => canDo(who, "payroll", what);
/** Ish haqi bo'yicha mas'ul rollar — vedomostlarni har doim ko'radi. */
const RUN_ROLES = ["HR", "ACCOUNTING", "FINANCE", "CASHIER", "DIRECTOR", "SUPERADMIN"];
/**
 * Vedomostlarni (ro'yxat, `/ish-haqi/<id>`, Excel, chop) ko'rish: mas'ul rol, hisoblash yoki sozlama huquqi bor —
 * ko'radi; faqat tabel / ushlanma / varaq / qarzlar / avans varaqasi bilan ishlaydigan (Sekretar) — ko'rmaydi.
 */
export function canSeeRuns(who: Pick<PayrollWho, "role" | "perms">) {
  if (RUN_ROLES.includes(who.role) || canPayroll(who, "calc") || canPayroll(who, "settings")) return true;
  return !(["debts", "sheets", "tabel", "deductions", "advance"] as const).some((w) => canPayroll(who, w));
}

export class PayrollError extends Error {}
const STALE = "Vedomost boshqa joyda o'zgartirildi — sahifani yangilang";
const r0 = (n: number) => Math.round(n);
const thousand = (n: number) => Math.round(n / 1000) * 1000;
const num = (v: unknown) => Number(v ?? 0);

export async function payrollSettings(tx: Prisma.TransactionClient = db): Promise<PayrollSettings> {
  const s = await tx.payrollSettings.findUnique({ where: { id: "main" } });
  if (s) return s;
  // Yangi bazada bir sahifa bir vaqtda bir necha joydan so'raydi (`erpWorkbook` + `tabelMonth`…) — ikkinchi yaratish
  // P2002 bilan yiqilmasin (ON CONFLICT DO NOTHING; tranzaksiya ichida ham buzilmaydi)
  await tx.payrollSettings.createMany({ data: [{ id: "main" }], skipDuplicates: true });
  return tx.payrollSettings.findUniqueOrThrow({ where: { id: "main" } });
}

// ───────────────────────── Hisob ─────────────────────────

export type RuleHit = { rule: string; kind: PayAdjKind; amount: number; days: number; detail: string };
export type LineBreakdown = {
  period: { from: string; to: string };
  normDays: number; presentDays: number; paidLeaveDays: number; unpaidLeaveDays: number; sickDays: number; absentDays: number; dayoffDays: number;
  minutes: number; dailyAvg: number; sickPct: number;
  /** Tabel soati yozilgan kunlar bo'lsa — ishlagan kun = Σ(soat ÷ kunlik soat), yozilmaganlari 1 kun (Excel tabeli kabi). */
  dayUnits?: number; tabelDays?: number;
  /** Brigada varag'i bo'yicha sdelka (Excel usuli: kunlik fond kun soatiga, 10 000 ga yaxlitlab) — har brigada alohida. */
  sheets?: SheetPayItem[];
  piece?: { brigade: string; pool: number; share: number; units: Pick<PieceUnit, "product" | "qty" | "rate" | "sum">[] };
  /** Haydovchi: dispetcher narxlagan reyslar (oy yakuni, `lib/driver-trip-pay.ts`); narxsizlari kirmaydi. */
  trips?: { count: number; km: number; sum: number; unpriced: number };
  rules: RuleHit[];
  manual: { id: string; kind: PayAdjKind; amount: number; reason: string; category?: string | null }[];
  /** Qarz (nasiya) ushlanmasining qarzlar bo'yicha taqsimoti — «Xodim qarzlari» qoldig'i shundan (`lib/hr/employee-debt.ts`). */
  debts?: { id: string; amount: number }[];
  /** Ijro/aliment ushlanmasining yozuvlar bo'yicha taqsimoti (`Withholding`). */
  withholds?: { id: string; amount: number }[];
  advances: { docNo: string; amount: number }[];
  advanceFormula?: string;
  warnings: string[];
};

type CalcLine = {
  employeeId: string; fullName: string; position: string; payType: PayType; rate: number;
  normDays: number; workedDays: number; workedMinutes: number; units: number;
  base: number; leavePay: number; sickPay: number; bonus: number; penalty: number; gross: number;
  incomeTax: number; inps: number; advanceDeducted: number; net: number; employerTax: number;
  /** Qo'lga tegadiganning plastik kartaga qismi (xodim kartasidagi summa, qo'lgadan oshmaydi) */
  cardAmount: number;
  /** Avans: davr boshidan `to` gacha ishlagani (avans qoidasi qo'llanmagan) — Ish haqi → Avans varaqasi uchun */
  earned?: number;
  breakdown: LineBreakdown;
};

type Emp = { id: string; fullName: string; position: string; payType: PayType; tariffRate: unknown; hiredAt: Date | null; firedAt: Date | null; workSchedule: string | null; brigadeId: string | null; advanceAmount: unknown; cardAmount: unknown };

const ruleFits = (r: PayRule, position: string) => !r.position || r.position.trim().toLowerCase() === position.trim().toLowerCase();

/**
 * Oy (yoki avans davri) bo'yicha hisob. Bazaga yozmaydi — vedomost yaratish/qayta hisoblash shu natijani saqlaydi,
 * xodim kartasidagi "Bu oy" ko'rinishi ham shundan. `upTo` (faqat avans) — davr oxiri sozlamadagi kun o'rniga shu sana
 * (Avans varaqasi: oy boshidan bugungacha).
 */
export async function calculate(month: string, kind: Exclude<PayrollKind, "EXTRA">, opts: { employeeIds?: string[]; upTo?: string } = {}): Promise<CalcLine[]> {
  const st = await payrollSettings();
  const days = monthDays(month);
  const from = days[0]!.iso;
  const monthEnd = days[days.length - 1]!.iso;
  const advDay = Math.min(Math.max(st.advanceDay, 1), days.length);
  const upTo = kind === "ADVANCE" && opts.upTo ? (opts.upTo < from ? from : opts.upTo > monthEnd ? monthEnd : opts.upTo) : null;
  const to = upTo ?? (kind === "ADVANCE" ? days[advDay - 1]!.iso : monthEnd);
  const fromD = dayUtc(from), toD = dayUtc(to);

  const emps: Emp[] = await db.employee.findMany({
    where: { AND: [employeesInWindow(fromD, toD), { OR: [{ userId: null }, { user: { role: { notIn: ["SUPERADMIN"] } } }] }, ...(opts.employeeIds ? [{ id: { in: opts.employeeIds } }] : [])] },
    orderBy: [{ position: "asc" }, { fullName: "asc" }],
    select: { id: true, fullName: true, position: true, payType: true, tariffRate: true, hiredAt: true, firedAt: true, workSchedule: true, brigadeId: true, advanceAmount: true, cardAmount: true },
  });
  if (!emps.length) return [];
  const ids = emps.map((e) => e.id);
  const [y, m] = month.split("-").map(Number);
  // Brigada varag'i to'ldirilgan brigadalar — sdelka va brak shu varaqdan (`lib/hr/brigade-sheet.ts`), qolganlari avvalgidek
  const sheet = await brigadeSheetPay(month, to, { final: kind === "FINAL" });
  const legacyPiece = pieceBrigades(emps).filter((b) => !sheet.brigades.has(b));
  const [att, plans, excused, rules, manual, advances, piece, kpi, tripPay, sheetAdv] = await Promise.all([
    db.attendance.findMany({ where: { employeeId: { in: ids }, date: { gte: fromD, lte: toD } }, select: { employeeId: true, date: true, status: true, checkIn: true, checkOut: true, lateMinutes: true, hours: true } }),
    plansInRange(emps, from, monthEnd),
    excusedDays(ids, from, to),
    kind === "FINAL" ? db.payRule.findMany({ where: { isActive: true } }) : Promise.resolve([] as PayRule[]),
    kind === "FINAL" ? db.payAdjustment.findMany({ where: { month, employeeId: { in: ids }, cancelledAt: null } }) : Promise.resolve([]),
    // Shu oy uchun allaqachon to'langan avans / alohida to'lovlar — yakunda ushlanadi, avansda takror berilmaydi
    db.payrollLine.findMany({
      where: { employeeId: { in: ids }, paid: { gt: 0 }, run: { month, kind: kind === "FINAL" ? { in: ["ADVANCE", "EXTRA"] } : "EXTRA", status: { in: ["APPROVED", "PAID"] } } },
      select: { employeeId: true, paid: true, run: { select: { docNo: true } } },
    }),
    // Sdelka fondi va brigada braki (`lib/brigade-pay.ts` — brigadalar sahifasidagi «Oylik» bilan bir xil hisob)
    brigadeOutput(dayStart(from), dayEnd(to), legacyPiece),
    // KPI mukofoti — oy yakunida bonus (`lib/hr/kpi.ts`)
    kind === "FINAL" ? kpiMonth(month, { employeeIds: ids }) : Promise.resolve([]),
    // Haydovchi reys haqi — oy yakunida asosiyga qo'shiladi (avansda emas)
    kind === "FINAL" ? tripPayByDriver(new Date(y!, m! - 1, 1), new Date(y!, m!, 1), ids) : Promise.resolve(new Map<string, { trips: number; km: number; sum: number; unpriced: number }>()),
    // Ish haqi → Avans varaqasida berilgan avans (kassadan) — yakunda ushlanadi, avans vedomostida takror berilmaydi
    db.advanceLine.findMany({
      where: { employeeId: { in: ids }, givenAt: { not: null }, amount: { gt: 0 }, sheet: { month, status: { not: "CANCELLED" } } },
      select: { employeeId: true, amount: true, sheet: { select: { docNo: true } } },
    }),
  ]);
  const brak = kind === "FINAL" ? await brigadeDefectSums(dayStart(from), dayEnd(to), legacyPiece) : new Map<string, { qty: number; sum: number; count: number }>();
  // O'tgan oylardan ushlanmay qolgan qarz — har xodimning eng so'nggi tasdiqlangan oy yakuni qatori (qoralama / bekor qilingan hisobga olinmaydi)
  const debtOf = new Map<string, { amount: number; docNo: string; month: string }>();
  if (kind === "FINAL") {
    const prev = await db.payrollLine.findMany({
      where: { employeeId: { in: ids }, run: { kind: "FINAL", month: { lt: month }, status: { in: ["APPROVED", "PAID"] } } },
      orderBy: { run: { month: "desc" } },
      select: { employeeId: true, net: true, run: { select: { docNo: true, month: true } } },
    });
    const seen = new Set<string>();
    for (const l of prev) {
      if (seen.has(l.employeeId)) continue;
      seen.add(l.employeeId);
      if (num(l.net) < 0) debtOf.set(l.employeeId, { amount: -num(l.net), docNo: l.run.docNo, month: l.run.month });
    }
  }
  // Xodim qarzi (nasiya) — shu oy ulushi (`lib/hr/employee-debt.ts`)
  const nasiya = kind === "FINAL" ? await debtsDue(month, ids) : [];
  // Qarz qoldiqlari va ijro/aliment yozuvlari — Ushlanmalar jadvalidagi qo'lda summa taqsimoti va avtomatik aliment uchun
  const led = kind === "FINAL" ? await ledgersFor(ids, month) : { debts: [], withholds: [] };
  // Kirim-Chiqimda xodimga berilgan pul («Hodimlar bilan hisob-kitob», nasiyasiz) — «Oylikdan qarz» (`lib/hr/deductions.ts`)
  const staffCash = kind === "FINAL" ? await staffCashFor(month, ids) : new Map<string, StaffCash[]>();
  const attBy = new Map<string, typeof att>();
  for (const a of att) attBy.set(a.employeeId, [...(attBy.get(a.employeeId) ?? []), a]);
  const nowIso = today();
  // Tabel soati (qo'lda yozilgan) bo'lsa — kun = soat ÷ kunlik soat; yo'q bo'lsa kelgan kun 1 kun (avvalgidek)
  const shiftHours = Number(st.hoursPerDay) || 8;
  const dayUnit = (a: { hours: Prisma.Decimal | null }) => (a.hours != null ? Number(a.hours) / shiftHours : 1);

  // Sdelka: brigada fondi a'zolarga ishlagan daqiqasi bo'yicha (daqiqa yo'q bo'lsa — kelgan kuni bo'yicha)
  const minutesOf = (id: string) => (attBy.get(id) ?? []).reduce((s, a) => s + (a.status === "PRESENT" ? minutesFor(a, plans.get(id)?.get(isoDay(a.date)), nowIso) : 0), 0);
  const presentOf = (id: string) => (attBy.get(id) ?? []).filter((a) => a.status === "PRESENT").length;
  const shareOf = new Map<string, number>();
  for (const bid of new Set([...piece.keys(), ...brak.keys()])) {
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

    let present = 0, minutes = 0, paidLeave = 0, unpaidLeave = 0, sick = 0, absent = 0, dayoff = 0, dayUnits = 0, tabelDays = 0;
    const lateDays: { iso: string; min: number }[] = [];
    const earlyDays: { iso: string; min: number }[] = [];
    for (const a of rows) {
      const iso = isoDay(a.date);
      const p = plan.get(iso);
      if (a.status === "PRESENT") {
        present++;
        dayUnits += dayUnit(a);
        if (a.hours != null) tabelDays++;
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
    const tp = tripPay.get(e.id);
    if (rate <= 0 && e.payType !== "PIECE" && !tp?.trips) warnings.push("Tarif stavka kiritilmagan — kartada «Tarif stavka» ni to'ldiring");

    // Asosiy
    let base = 0, units = 0;
    let pieceInfo: LineBreakdown["piece"];
    if (e.payType === "SALARY") base = normMonth > 0 ? (rate * dayUnits) / normMonth : 0;
    else if (e.payType === "DAILY") base = rate * dayUnits;
    else if (e.payType === "HOURLY") base = (rate * minutes) / 60;
    else if (e.brigadeId && sheet.brigades.has(e.brigadeId)) {
      // Brigada varag'idan (pastda qo'shiladi)
      if (!sheet.byEmp.get(e.id)?.length) warnings.push("Sdelka: brigada varag'ida shu davrda soati yo'q");
    } else {
      const pool = e.brigadeId ? piece.get(e.brigadeId) : undefined;
      if (!e.brigadeId && !sheet.byEmp.get(e.id)?.length) warnings.push("Sdelka: xodim brigadaga biriktirilmagan");
      else if (!pool || pool.sum === 0) warnings.push("Sdelka: brigadada shu davrda bajarilgan ish yo'q yoki mahsulotlarga sdelka narxi qo'yilmagan");
      const share = shareOf.get(e.id) ?? 0;
      if (pool) {
        base = pool.sum * share;
        units = pool.units.reduce((s, u) => s + u.qty, 0) * share;
        pieceInfo = { brigade: pool.brigade, pool: r0(pool.sum), share: Math.round(share * 1000) / 10, units: pool.units };
      }
    }
    // Brigada varag'i puli: sdelkachida asosiy pulning o'zi (kunlik o'rtachaga kiradi), boshqalarda qo'shimcha (kirmaydi)
    const sheetItems = sheet.byEmp.get(e.id) ?? [];
    const sheetSum = sheetItems.reduce((s, x) => s + x.amount, 0);
    if (e.payType === "PIECE") base += sheetSum;
    const dailyAvg = e.payType === "SALARY" ? (normMonth > 0 ? rate / normMonth : 0)
      : e.payType === "DAILY" ? rate
      : e.payType === "HOURLY" ? rate * shiftHours
      : present > 0 ? base / present : 0;
    // Reys haqi vedomostga kirmaydi (2026-11-25): logistika daromadidan, faqat logistika hisobidan to'lanadi —
    // Logistika moliya → «Oylik reys haqi» (`lib/logistics-finance.ts` → `payDriverMonth`)
    if (e.payType !== "PIECE") base += sheetSum;

    const tenureYears = e.hiredAt ? (dayUtc(to).getTime() - e.hiredAt.getTime()) / (365.25 * 864e5) : 0;
    const sickPct = tenureYears >= 8 ? st.sickPctLong : st.sickPctShort;
    let leavePay = 0, sickPay = 0, bonus = 0, penalty = 0;
    const hits: RuleHit[] = [];
    const debtsAlloc: { id: string; amount: number }[] = [];
    const withholdsAlloc: { id: string; amount: number }[] = [];
    const manualList: LineBreakdown["manual"] = [];
    let advanceFormula: string | undefined;
    let earned: number | undefined;

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
      // Brigada braki — sdelkadagi a'zolardan fond ulushi bo'yicha ushlanadi (summa brigadalar sahifasida tahrirlanadi)
      const bk = e.payType === "PIECE" && e.brigadeId ? brak.get(e.brigadeId) : undefined;
      const bkShare = shareOf.get(e.id) ?? 0;
      if (bk && bk.sum > 0 && bkShare > 0) {
        const amt = bk.sum * bkShare;
        hits.push({ rule: "Brigada braki", kind: "PENALTY", amount: r0(amt), days: bk.count, detail: `${money(bk.sum)} × ${Math.round(bkShare * 1000) / 10}% (${bk.count} ta yozuv)` });
        penalty += amt;
      }
      for (const it of sheetItems) if (it.brak > 0) {
        hits.push({ rule: "Brigada braki", kind: "PENALTY", amount: it.brak, days: 0, detail: `${it.brigade}: brak × ${it.hours} soat ulushi` });
        penalty += it.brak;
      }
      const debt = debtOf.get(e.id);
      if (debt) {
        hits.push({ rule: "O'tgan oydan qarz", kind: "PENALTY", amount: r0(debt.amount), days: 0, detail: `${debt.docNo} (${monthTitle(debt.month)}) — ushlanmay qolgan` });
        penalty += debt.amount;
      }
      // Ushlanmalar jadvalida «Qarz to'lovi» yozilgan bo'lsa — jadval ulushi o'rniga o'sha summa (pastda, qo'lda yozuvlar bilan)
      const loanManual = manual.filter((x) => x.employeeId === e.id && x.category === "LOAN").reduce((sm, x) => sm + num(x.amount), 0);
      if (loanManual > 0) debtsAlloc.push(...allocate(led.debts.filter((d) => d.employeeId === e.id && d.left > 0).map((d) => ({ id: d.id, left: d.left })), loanManual));
      for (const d of loanManual > 0 ? [] : nasiya.filter((x) => x.employeeId === e.id)) {
        debtsAlloc.push({ id: d.id, amount: d.amount });
        hits.push({ rule: "Qarz (nasiya)", kind: "PENALTY", amount: d.amount, days: 0, detail: `${d.n}/${d.of}-oy · jami ${money(d.total)}${d.note ? ` · ${d.note}` : ""}` });
        penalty += d.amount;
      }
      for (const k of kpi.filter((x) => x.employeeId === e.id && x.reward > 0)) {
        hits.push({ rule: `KPI: ${k.name}`, kind: "BONUS", amount: k.reward, days: 1, detail: `fakt ${k.fact ?? "—"} / reja ${k.target} ${k.unit} = ${k.pct ?? 0}%` });
        bonus += k.reward;
      }
      // Oylikdan qarz: Ushlanmalar jadvalida yozilmagan bo'lsa — Kirim-Chiqimda shu xodimga berilgan pul (0 yozilgan — ushlanmaydi)
      const sdWritten = manual.some((x) => x.employeeId === e.id && x.category === "SALARY_DEBT");
      const given = sdWritten ? [] : staffCash.get(e.id) ?? [];
      const givenSum = r0(given.reduce((sm, c) => sm + c.amount, 0));
      if (givenSum > 0) {
        const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
        hits.push({ rule: STAFF_CASH_RULE, kind: "PENALTY", amount: givenSum, days: given.length, detail: `Kirim-Chiqim: ${given.slice(0, 6).map((c) => `${dm(c.date)} ${money(c.amount)}${c.carried ? " (o'tgan oy)" : ""}`).join(", ")}${given.length > 6 ? ` va yana ${given.length - 6}` : ""}` });
        penalty += givenSum;
      }
      for (const m of manual.filter((x) => x.employeeId === e.id && num(x.amount) !== 0)) {
        manualList.push({ id: m.id, kind: m.kind, amount: num(m.amount), reason: m.reason, category: m.category });
        if (m.kind === "BONUS") bonus += num(m.amount); else penalty += num(m.amount);
      }
    } else {
      // Avans: xodimga qo'lda belgilangan summa bo'lsa — o'sha (Excel «Аванс наличка» kabi, davrda ishda bo'lsa);
      // aks holda shu kungacha hisoblangan summadan oylik bashorat × foiz (oklad, to'liq kelgan — oylikning foizi)
      earned = r0(base);
      const fixedAdv = num(e.advanceAmount);
      if (fixedAdv > 0) {
        base = lo <= hi ? r0(fixedAdv) : 0;
        advanceFormula = lo <= hi ? `qo'lda belgilangan avans: ${money(r0(fixedAdv))}` : "avans davrida ishda emas";
      } else {
        const projected = normPeriod > 0 ? (base * normMonth) / normPeriod : base;
        advanceFormula = `${money(r0(base))} (1–${advDay} kun) → oyga ${money(r0(projected))} × ${st.advancePct}%`;
        base = thousand((projected * st.advancePct) / 100);
      }
    }

    const adv = [
      ...advances.filter((a) => a.employeeId === e.id).map((a) => ({ docNo: a.run.docNo, amount: num(a.paid) })),
      ...sheetAdv.filter((a) => a.employeeId === e.id).map((a) => ({ docNo: a.sheet.docNo, amount: num(a.amount) })),
    ];
    const advanceSum = adv.reduce((s, a) => s + a.amount, 0);
    const gross = r0(base) + r0(leavePay) + r0(sickPay) + r0(bonus);
    const incomeTax = kind === "FINAL" ? r0((gross * Number(st.incomeTaxPct)) / 100) : 0;
    // Ijro / aliment: Ushlanmalar jadvalida yozilgan bo'lsa — o'sha (yozuvlarga taqsimlanadi), bo'lmasa daftardan avtomatik:
    // oylik summa yoki qo'lga tegadigan (yalpi − soliq) summaning foizi, umumiy qarz qoldig'idan oshmaydi
    if (kind === "FINAL") {
      const ws = led.withholds.filter((w) => w.employeeId === e.id);
      const alimManual = manual.filter((x) => x.employeeId === e.id && x.category === "ALIMENT").reduce((sm, x) => sm + num(x.amount), 0);
      if (alimManual > 0) withholdsAlloc.push(...allocate(ws.map((w) => ({ id: w.id, left: w.left })), alimManual));
      else for (const w of ws) {
        const want = w.monthly != null ? num(w.monthly) : w.percent != null ? ((gross - incomeTax) * num(w.percent)) / 100 : 0;
        const amt = r0(Math.max(0, Math.min(want, w.left ?? Infinity)));
        if (amt <= 0) continue;
        hits.push({ rule: w.kind === "MIB" ? "Ijro varaqasi" : "Aliment", kind: "PENALTY", amount: amt, days: 0, detail: `${w.caseNo ? `№${w.caseNo} · ` : ""}${w.monthly != null ? "oylik summa" : `${num(w.percent)}% qo'lga tegadigandan`}${w.left != null ? ` · qoldiq ${money(w.left)}` : ""}` });
        penalty += amt;
        withholdsAlloc.push({ id: w.id, amount: amt });
      }
    }
    const inps = kind === "FINAL" ? r0((gross * Number(st.inpsPct)) / 100) : 0;
    const employerTax = kind === "FINAL" ? r0((gross * Number(st.socialTaxPct)) / 100) : 0;
    const net = kind === "FINAL" ? gross - incomeTax - r0(penalty) - r0(advanceSum) : Math.max(0, gross - r0(advanceSum));
    if (kind === "FINAL" && net < 0) warnings.push(`Ushlanmalar hisoblangandan ko'p — xodim qarzi ${money(-net)}: vedomost tasdiqlangach keyingi oy yakunida ushlanadi`);

    // Plastik qismi — faqat oy yakunida (avans naqd, Excel'dagidek), qo'lga tegadigandan oshmaydi
    const cardAmount = kind === "FINAL" ? Math.max(0, Math.min(net, r0(num(e.cardAmount)))) : 0;
    out.push({
      employeeId: e.id, fullName: e.fullName, position: e.position, payType: e.payType, rate, cardAmount, ...(earned != null ? { earned } : {}),
      normDays: normMonth, workedDays: present, workedMinutes: minutes, units: Math.round(units * 1000) / 1000,
      base: r0(base), leavePay: r0(leavePay), sickPay: r0(sickPay), bonus: r0(bonus), penalty: r0(penalty), gross,
      incomeTax, inps, advanceDeducted: r0(advanceSum), net, employerTax,
      breakdown: {
        period: { from: lo, to: hi }, normDays: normMonth, presentDays: present, paidLeaveDays: paidLeave, unpaidLeaveDays: unpaidLeave,
        sickDays: sick, absentDays: absent, dayoffDays: dayoff, minutes, dailyAvg: r0(dailyAvg), sickPct,
        ...(tabelDays ? { dayUnits: Math.round(dayUnits * 100) / 100, tabelDays } : {}),
        ...(sheetItems.length ? { sheets: sheetItems } : {}),
        // Oy yakunida taqsimot har doim yoziladi (bo'sh bo'lsa ham) — daftar «ushlangan»ni shundan oladi, eski vedomostlarni ajratadi
        ...(kind === "FINAL" ? { debts: debtsAlloc, withholds: withholdsAlloc } : {}),
        ...(pieceInfo ? { piece: pieceInfo } : {}), rules: hits, manual: manualList, advances: adv,
        ...(advanceFormula ? { advanceFormula } : {}), warnings,
      },
    });
  }
  return out;
}

/** Ishlangan daqiqa: "Ketdi" belgilanmagan o'tgan kun — smena oxirigacha deb olinadi (tabel ochiq qolmasin). */
function minutesFor(a: { checkIn: string | null; checkOut: string | null; date: Date; hours?: Prisma.Decimal | null }, p: DayPlan | undefined, nowIso: string): number {
  if (a.hours != null) return Math.round(Number(a.hours) * 60); // tabelda qo'lda yozilgan soat
  const m = workedMinutes(a.checkIn, a.checkOut);
  if (m != null) return m;
  if (a.checkIn && p && isoDay(a.date) < nowIso && toMinutes(p.end) != null) {
    // Ketish yozilmagan: smena oxirigacha; kelgan vaqt smena oxiridan keyin (16 soatdan uzun chiqadi) — hisoblanmaydi
    const m2 = workedMinutes(a.checkIn, p.end) ?? 0;
    return m2 <= MAX_SHIFT_MINUTES ? m2 : 0;
  }
  return 0;
}

/** Vedomost qoidasi nomi: Kirim-Chiqimda xodimga berilgan pul (C2026 «Oylikdan qarz» ustuni — `vedomost-sheet.ts`). */
export const STAFF_CASH_RULE = "Kassadan berilgan";

const pieceBrigades = (emps: Emp[]) => [...new Set(emps.filter((e) => e.payType === "PIECE").map((e) => e.brigadeId).filter((x): x is string => !!x))];

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
        incomeTax: l.incomeTax, inps: l.inps, advanceDeducted: l.advanceDeducted, net: l.net, employerTax: l.employerTax, cardAmount: l.cardAmount,
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

/** Qoralama vedomostni qayta hisoblash (veb «Qayta hisoblash» va mobil kartochka) — alohida to'lov (EXTRA) qayta hisoblanmaydi. */
export async function recalculateRun(id: string, user: PayrollWho): Promise<{ id?: string; error?: string; note?: string }> {
  const run = await db.payrollRun.findUnique({ where: { id }, select: { month: true, kind: true } });
  if (!run || run.kind === "EXTRA") return { error: "Bu vedomost qayta hisoblanmaydi" };
  return calculateRun(run.month, run.kind, user);
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
  // Oy yakuni: o'tgan oy vedomosti shu qoralamadan keyin qayta hisoblangan bo'lsa — kassadan o'tgan pul (Oylikdan qarz)
  // eskirgan, ikki marta ushlanmasin: avval qayta hisoblash kerak
  const cur = await db.payrollRun.findUnique({ where: { id }, select: { kind: true, month: true, calculatedAt: true } });
  if (cur?.kind === "FINAL" && cur.calculatedAt) {
    const prev = await db.payrollRun.findFirst({ where: { kind: "FINAL", month: shiftMonth(cur.month, -1), status: { not: "CANCELLED" }, calculatedAt: { gt: cur.calculatedAt } }, select: { docNo: true } });
    if (prev) return { error: `${prev.docNo} (o'tgan oy) shu vedomostdan keyin qayta hisoblangan — avval «Qayta hisoblash» ni bosing` };
  }
  // Oy yakuni avans / alohida to'lovlarni faqat to'langanini ushlaydi (`calculate`): to'lanmagani yakun yopilgach to'lansa
  // yoki hisobdan keyin to'langan bo'lsa — hech qaysi vedomostda ushlanmay qoladi (ikki marta to'lov)
  if (cur?.kind === "FINAL") {
    const other = { month: cur.month, kind: { in: ["ADVANCE", "EXTRA"] as PayrollKind[] } };
    const pending = await db.payrollLine.findFirst({ where: { paidAt: null, net: { gt: 0 }, run: { ...other, status: { in: ["SUBMITTED", "APPROVED"] } } }, select: { run: { select: { docNo: true } } } });
    if (pending) return { error: `${pending.run.docNo} (avans / alohida to'lov) hali to'lanmagan — avval to'lang yoki bekor qiling, keyin yakuniy vedomostni qayta hisoblang` };
    const late = cur.calculatedAt ? await db.payrollLine.findFirst({ where: { paidAt: { gt: cur.calculatedAt }, run: other }, select: { run: { select: { docNo: true } } } }) : null;
    if (late) return { error: `${late.run.docNo} shu vedomost hisoblangandan keyin to'langan — avval «Qayta hisoblash» ni bosing (avans ushlansin)` };
    // Avans varaqasi (Ish haqi → Avans): jo'natilgan, hali berilmagan qator — yakun yopilgach berilsa ushlanmay qoladi;
    // hisobdan keyin berilgan / bekor qilingan — vedomostdagi avans eskirgan
    const avPending = await db.advanceLine.findFirst({ where: { givenAt: null, amount: { gt: 0 }, sheet: { month: cur.month, status: "SENT" } }, select: { sheet: { select: { docNo: true } } } });
    if (avPending) return { error: `${avPending.sheet.docNo} (avans varaqasi) hali to'liq berilmagan — avval bering yoki varaqani yoping, keyin yakuniy vedomostni qayta hisoblang` };
    const avLate = cur.calculatedAt ? await db.advanceLine.findFirst({ where: { changedAt: { gt: cur.calculatedAt }, sheet: { month: cur.month } }, select: { sheet: { select: { docNo: true } } } }) : null;
    if (avLate) return { error: `${avLate.sheet.docNo} avansi shu vedomost hisoblangandan keyin o'zgargan — avval «Qayta hisoblash» ni bosing (avans ushlansin)` };
  }
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
export async function payRun(id: string, input: { cashAccountId: string; bankAccountId?: string | null; lineIds?: string[] | null; note?: string | null }, user: PayrollWho) {
  if (!canPayroll(user, "pay")) return { error: "Ish haqini kassir to'laydi" };
  const run = await db.payrollRun.findUnique({ where: { id }, select: { id: true, docNo: true, status: true, month: true, kind: true } });
  if (!run) return { error: "Vedomost topilmadi" };
  if (run.status !== "APPROVED") return { error: run.status === "PAID" ? "Vedomost to'liq to'langan" : "Vedomost hali direktor tomonidan tasdiqlanmagan" };
  // Avans / alohida to'lov: oy yakuni yopilgan bo'lsa (yuborilgan / tasdiqlangan) — u bu pulni ushlamaydi, ikki marta to'lanadi
  if (run.kind !== "FINAL") {
    const fin = await db.payrollRun.findFirst({ where: { month: run.month, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { docNo: true } });
    if (fin) return { error: `${fin.docNo} (oy yakuni) yopilgan — bu to'lov yakunda ushlanmay qoladi. Avval oy yakuni vedomostini qoralamaga qaytaring yoki bu vedomostni bekor qiling` };
  }
  const acc = input.cashAccountId ? await db.cashAccount.findUnique({ where: { id: input.cashAccountId } }) : null;
  if (!acc || !acc.isActive) return { error: "Kassa / hisob tanlanmagan" };
  // Plastik qismi (qatordagi `cardAmount`) — alohida hisobdan (bank); tanlanmasa plastik qismi bo'lgan qator to'lanmaydi
  const bank = input.bankAccountId ? await db.cashAccount.findUnique({ where: { id: input.bankAccountId } }) : null;
  if (input.bankAccountId && (!bank || !bank.isActive)) return { error: "Plastik uchun hisob topilmadi" };

  return wrap(async () => {
    const res = await db.$transaction(async (tx) => {
      // Vedomost qatori qulfi: to'lash va to'lovni bekor qilish (`unpayRun`) navbat bilan — «qolmadi» hisobi eski bo'lmasin
      await tx.$queryRaw`SELECT id FROM "PayrollRun" WHERE id = ${id} FOR UPDATE`;
      const lines = await tx.payrollLine.findMany({
        where: { runId: id, paidAt: null, net: { gt: 0 }, ...(input.lineIds?.length ? { id: { in: input.lineIds } } : {}) },
        select: { id: true, net: true, cardAmount: true, employeeId: true, employee: { select: { fullName: true } } },
      });
      if (!lines.length) throw new PayrollError("To'lanadigan qator yo'q — hammasi to'langan");
      const cardOf = (l: (typeof lines)[number]) => Math.min(num(l.net), num(l.cardAmount));
      const cardTotal = lines.reduce((s, l) => s + cardOf(l), 0);
      const cashTotal = lines.reduce((s, l) => s + num(l.net) - cardOf(l), 0);
      const total = cashTotal + cardTotal;
      if (cardTotal > 0 && !bank) throw new PayrollError(`Plastik qismi ${money(cardTotal)} — uni qaysi hisobdan (bank) o'tkazishni tanlang`);
      const cashErr = cashTotal > 0 ? await cashOutflowError(tx, acc.id, cashTotal) : null;
      if (cashErr) throw new PayrollError(cashErr);
      if (cardTotal > 0) { const e2 = await cashOutflowError(tx, bank!.id, cardTotal); if (e2) throw new PayrollError(e2); }
      const now = new Date();
      const who = lines.length === 1 ? lines[0]!.employee.fullName : `${lines.length} xodim`;
      const baseNote = [`Ish haqi ${run.docNo} · ${monthTitle(run.month)} · ${PAYROLL_KIND_LABEL[run.kind]}`, input.note?.trim()].filter(Boolean).join(" · ");
      const mk = (accountId: string, amount: number, part: string) => tx.cashTransaction.create({
        data: {
          type: "EXPENSE", date: now, cashAccountId: accountId, amount, category: PAYROLL_CATEGORY, counterparty: who,
          refType: PAYROLL_REF, refId: id, createdById: user.userId, note: `${baseNote}${part}`.slice(0, 500),
        },
      });
      const cashTx = cashTotal > 0 ? await mk(acc.id, cashTotal, cardTotal > 0 ? " · naqd qismi" : "") : null;
      const cardTx = cardTotal > 0 ? await mk(bank!.id, cardTotal, " · plastik") : null;
      const ct = (cashTx ?? cardTx)!;
      for (const l of lines) {
        const card = cardOf(l), cash = num(l.net) - card;
        // cashTxId — asosiy chiqim (naqd, u bo'lmasa plastik); cardTxId — plastik alohida chiqim bo'lsa
        const main = cash > 0 ? cashTx! : cardTx!;
        const n = await tx.payrollLine.updateMany({ where: { id: l.id, paidAt: null }, data: { paid: l.net, paidAt: now, paidById: user.userId, cashTxId: main.id, cardTxId: cash > 0 && card > 0 ? cardTx!.id : null } });
        if (n.count !== 1) throw new PayrollError(STALE);
      }
      const left = await tx.payrollLine.count({ where: { runId: id, paidAt: null, net: { gt: 0 } } });
      const paidSum = await tx.payrollLine.aggregate({ where: { runId: id }, _sum: { paid: true } });
      await tx.payrollRun.update({ where: { id }, data: { paid: paidSum._sum.paid ?? 0, ...(left === 0 ? { status: "PAID" } : {}) } });
      for (const t of [cashTx, cardTx]) if (t) await audit(tx, user.userId, "CREATE", "CashTransaction", t.id, undefined, t);
      await audit(tx, user.userId, "UPDATE", "PayrollRun", id, undefined, { tolandi: lines.length, summa: total, naqd: cashTotal, plastik: cardTotal, cashTxId: ct.id, cardTxId: cardTx?.id ?? null, qoldi: left });
      return { total, card: cardTotal, count: lines.length, employees: lines.map((l) => l.employeeId), left };
    });
    notifyAfter(() => notifyEmployees(res.employees, { type: "PAYROLL_PAID", title: `Ish haqi berildi — ${monthTitle(run.month)}`, body: `${PAYROLL_KIND_LABEL[run.kind]} · ${run.docNo}`, link: { key: "oyligim", id: run.id }, channel: "oddiy" }));
    return { ok: true as const, note: `${res.count} xodimga ${money(res.total)} to'landi${res.card ? ` (naqd ${money(res.total - res.card)}, plastik ${money(res.card)})` : ""}${res.left ? ` · yana ${res.left} ta qator qoldi` : " · vedomost yopildi"}` };
  });
}

/**
 * To'lovni bekor qilish (faqat direktor, sabab bilan) — noto'g'ri to'langan qatorlar uchun. Kassa bunday chiqimni
 * qo'lda bekor qilmaydi («hujjat orqali»), shuning uchun shu yerda, bitta tranzaksiyada:
 *  · qatorlarning «Ish haqi» chiqimi kassadagi oddiy bekor qilish kabi bekor qilinadi (`cancelCashTxIn`): yozuv sabab bilan
 *    jurnalda kulrang qoladi, qoldiq va hisobotlarga kirmaydi;
 *  · qatorlar yana to'lanmagan (paid 0, paidAt / cashTxId bo'sh), vedomost PAID → APPROVED — kassir qayta to'lay oladi;
 *  · bitta chiqim bir nechta qatorni birga to'lagan bo'lsa — chiqim bo'linmaydi: o'sha qatorlarning hammasi belgilanishi kerak,
 *    aks holda rad etiladi (qaysi xodimlar ekani aytiladi);
 *  · avans / alohida to'lov boshqa vedomostda (oy yakuni) allaqachon ushlangan bo'lsa — o'sha vedomost hali qoralama
 *    bo'lmasa rad etiladi (ikki marta ushlanib qolmasin); qoralama bo'lsa — qayta hisoblash eslatiladi.
 * `lineIds` bo'sh — vedomostdagi barcha to'langan qatorlar.
 */
export async function unpayRun(id: string, input: { lineIds?: string[] | null; reason: string }, user: PayrollWho) {
  if (!canPayroll(user, "approve")) return { error: "Ish haqi to'lovini faqat direktor bekor qiladi" };
  const why = input.reason.trim();
  if (why.length < 3) return { error: "Bekor qilish sababini yozing (kamida 3 belgi)" };
  const run = await db.payrollRun.findUnique({ where: { id }, select: { id: true, docNo: true, status: true, month: true, kind: true } });
  if (!run) return { error: "Vedomost topilmadi" };
  if (run.status !== "APPROVED" && run.status !== "PAID") return { error: "Bu vedomostda to'lov yo'q" };

  return wrap(async () => {
    const res = await db.$transaction(async (tx) => {
      // `payRun` bilan bir xil qulf — ikkalasi bir vaqtda kelsa navbat bilan
      await tx.$queryRaw`SELECT id FROM "PayrollRun" WHERE id = ${id} FOR UPDATE`;
      const lines = await tx.payrollLine.findMany({
        where: { runId: id, paidAt: { not: null }, ...(input.lineIds?.length ? { id: { in: input.lineIds } } : {}) },
        select: { id: true, paid: true, paidAt: true, paidById: true, cashTxId: true, cardTxId: true, employeeId: true, employee: { select: { fullName: true } } },
      });
      if (!lines.length) throw new PayrollError("Bekor qilinadigan to'lov yo'q — qatorlar to'lanmagan yoki allaqachon qaytarilgan");
      const noTx = lines.filter((l) => !l.cashTxId);
      if (noTx.length) throw new PayrollError(`${noTx.map((l) => l.employee.fullName).join(", ")}: to'lov chiqimi bog'lanmagan — bekor qilib bo'lmaydi`);
      // Naqd va plastik chiqimlari (plastik alohida bo'lsa — `cardTxId`)
      const txIds = [...new Set(lines.flatMap((l) => [l.cashTxId!, ...(l.cardTxId ? [l.cardTxId] : [])]))];
      // Bitta chiqim bo'linmaydi: shu chiqimdagi qolgan qatorlar ham tanlangan bo'lsin
      const picked = new Set(lines.map((l) => l.id));
      const rest = await tx.payrollLine.findMany({ where: { OR: [{ cashTxId: { in: txIds } }, { cardTxId: { in: txIds } }], id: { notIn: [...picked] } }, select: { employee: { select: { fullName: true } } } });
      if (rest.length) throw new PayrollError(`Bitta to'lov (chiqim) bo'linmaydi — u bilan birga to'langan: ${rest.map((l) => l.employee.fullName).join(", ")}. Ularni ham belgilang`);
      const cts = await tx.cashTransaction.findMany({ where: { id: { in: txIds } }, orderBy: { cashAccountId: "asc" } });
      if (cts.length !== txIds.length || cts.some((c) => c.refType !== PAYROLL_REF || c.refId !== id)) throw new PayrollError("To'lov chiqimi topilmadi yoki boshqa hujjatga tegishli — sahifani yangilang");

      // Avans / alohida to'lov boshqa vedomostda ushlangan bo'lsa (`calculate` → advances): o'sha vedomost qoralama bo'lsin
      let recalc: string[] = [];
      if (run.kind !== "FINAL") {
        const used = (await tx.payrollLine.findMany({
          where: { employeeId: { in: lines.map((l) => l.employeeId) }, runId: { not: id }, run: { month: run.month, status: { not: "CANCELLED" } } },
          select: { breakdown: true, employee: { select: { fullName: true } }, run: { select: { docNo: true, status: true } } },
        })).filter((l) => breakdownOf(l.breakdown)?.advances.some((a) => a.docNo === run.docNo));
        const fixed = used.filter((l) => l.run.status !== "DRAFT");
        if (fixed.length) throw new PayrollError(`Bu to'lov ${[...new Set(fixed.map((l) => l.run.docNo))].join(", ")} vedomostida ushlangan (${fixed.map((l) => l.employee.fullName).join(", ")}) — avval o'sha vedomost qoralamaga qaytarilsin yoki bekor qilinsin`);
        recalc = [...new Set(used.map((l) => l.run.docNo))];
      }

      for (const c of cts) {
        // Allaqachon bekor qilingan chiqim (pul kassaga qaytgan) — faqat qatorlar bo'shatiladi
        if (!c.cancelledAt) {
          const err = await cancelCashTxIn(tx, c, `Ish haqi to'lovi bekor qilindi (${run.docNo}): ${why}`, user.userId);
          if (err) throw new PayrollError(err);
        }
      }
      // Qatorlar bo'shatiladi (naqd va plastik chiqim havolalari bilan) — chiqimlar yuqorida bekor qilindi
      const n = await tx.payrollLine.updateMany({ where: { id: { in: lines.map((l) => l.id) }, paidAt: { not: null } }, data: { paid: 0, paidAt: null, paidById: null, cashTxId: null, cardTxId: null } });
      if (n.count !== lines.length) throw new PayrollError(STALE);
      const paidSum = await tx.payrollLine.aggregate({ where: { runId: id }, _sum: { paid: true } });
      const paid = paidSum._sum.paid ?? 0;
      // Qator yana to'lanmagan — vedomost to'liq to'langan bo'lolmaydi: PAID → APPROVED (shartli, poyga bo'lmasin)
      const u = await tx.payrollRun.updateMany({ where: { id, status: { in: ["APPROVED", "PAID"] } }, data: { paid, status: "APPROVED" } });
      if (u.count !== 1) throw new PayrollError(STALE);
      await auditMany(tx, user.userId, "UPDATE", "PayrollLine", lines.map((l) => ({
        id: l.id, before: { paid: l.paid, paidAt: l.paidAt, paidById: l.paidById, cashTxId: l.cashTxId, cardTxId: l.cardTxId }, after: { paid: 0, paidAt: null, cashTxId: null, cardTxId: null, reason: why },
      })));
      const total = lines.reduce((s, l) => s + num(l.paid), 0);
      await audit(tx, user.userId, "STATUS_CHANGE", "PayrollRun", id, { status: run.status }, { status: "APPROVED", action: "unpay", reason: why, qaytarildi: lines.length, summa: total, cashTxIds: txIds, paid });
      return { count: lines.length, total, txs: txIds.length, recalc };
    }, { timeout: 30_000 });
    return {
      ok: true as const,
      note: `${res.count} xodim to'lovi bekor qilindi (${money(res.total)}, ${res.txs} ta chiqim kassada bekor qilindi) — qatorlar yana to'lanmagan${res.recalc.length ? ` · ${res.recalc.join(", ")} qoralamasini qayta hisoblang (avans ushlanmasin)` : ""}`,
    };
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
