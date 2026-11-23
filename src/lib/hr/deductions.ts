
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fmtNum } from "@/lib/format";
import { dayUtc, monthDays, monthTitle, shiftMonth } from "@/lib/davomat";
import { employeesInWindow } from "@/lib/attendance-report";
import { isStaffSettleCategory } from "@/lib/cash-categories";
import { tabelLock } from "./tabel-lock";
import { allocOf, closedLines, debtHeld, debtsDue, dueIn, listDebts, type Alloc, type HeldLine } from "./employee-debt";
import { deductionLabel, installment, isDeductionCat, type DeductionCat } from "./deduction-cats";

/**
 * Ushlanmalar (Ish haqi → Ushlanmalar) — Excel C2026'ning G–K ustunlari: aliment/ijro, qarz to'lovi, oylikdan qarz,
 * to'y puli, jarima. Har xodim × oy × tur — bitta `PayAdjustment` (PENALTY, `category`). Oy yakuni vedomosti ularni ushlaydi.
 *
 * Avtomatik (yozilmasa ham vedomost ushlaydi, ko'k): oylikdan qarz — Kirim-Chiqimda xodimga «Hodimlar bilan hisob-kitob»
 * bilan berilgan (nasiyasiz) pul (`staffCashFor`), qarz to'lovi — kassadan berilgan nasiyaning shu oy ulushi, aliment —
 * daftardagi oylik summa. Takliflar (kul rang, ✓ bilan qo'yiladi): kassasiz qarz qoldig'i ulushi, to'y puli — sozlamadan.
 * Yozilgan summa avtomatik o'rniga ushlanadi; qarz va aliment daftardagi qoldiqdan kamayadi
 * (`lib/hr/payroll.ts` → `breakdown.debts` / `breakdown.withholds`). «Oylikdan qarz» ga 0 yozilsa — kassadagi pul ushlanmaydi.
 */

type Who = { userId: string };
/** Aniq 0 saqlanadigan tur: «Oylikdan qarz» = 0 — kassadan berilgan pul shu oy ushlanmaydi. */
const ZERO_KEEP: DeductionCat = "SALARY_DEBT";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v: unknown) => Number(v ?? 0);
const r0 = (n: number) => Math.round(n);

// ───────────────────────── Daftarlar: ushlangani ─────────────────────────

export function withholdHeld(w: { id: string; employeeId: string; heldBefore: unknown }, lines: HeldLine[]) {
  return num(w.heldBefore) + lines.filter((l) => l.employeeId === w.employeeId).reduce((s, l) => s + (allocOf(l.breakdown, "withholds") ?? []).filter((x) => x.id === w.id).reduce((t, x) => t + num(x.amount), 0), 0);
}

/** Vedomost uchun: xodimlarning ochiq qarzlari va ijro/aliment yozuvlari (shu oygacha ushlangani bilan). */
export async function ledgersFor(employeeIds: string[], month: string) {
  const [debts, withs, lines] = await Promise.all([
    db.employeeDebt.findMany({ where: { employeeId: { in: employeeIds }, cancelledAt: null, startMonth: { lte: month } }, orderBy: [{ startMonth: "asc" }, { createdAt: "asc" }], select: { id: true, employeeId: true, amount: true, months: true, startMonth: true, note: true } }),
    db.withholding.findMany({ where: { employeeId: { in: employeeIds }, cancelledAt: null, startMonth: { lte: month } }, orderBy: [{ startMonth: "asc" }, { createdAt: "asc" }] }),
    closedLines(employeeIds, month),
  ]);
  return {
    debts: debts.map((d) => ({ ...d, total: num(d.amount), left: Math.max(0, num(d.amount) - debtHeld(d, lines)), due: dueIn(d, month)?.amount ?? 0 })),
    withholds: withs.map((w) => ({ ...w, left: w.amount != null ? Math.max(0, num(w.amount) - withholdHeld(w, lines)) : null })),
  };
}

/** Summani ro'yxatga eng eskisidan boshlab qoldig'i bo'yicha taqsimlash; ortgani oxirgisiga. */
export function allocate<T extends { id: string; left: number | null }>(items: T[], amount: number): Alloc {
  const out: Alloc = [];
  let rest = r0(amount);
  for (const it of items) {
    if (rest <= 0) break;
    const take = it.left == null ? rest : Math.min(rest, r0(it.left));
    if (take > 0) { out.push({ id: it.id, amount: take }); rest -= take; }
  }
  if (rest > 0 && items.length) {
    const last = out.find((x) => x.id === items[items.length - 1]!.id);
    if (last) last.amount += rest; else out.push({ id: items[items.length - 1]!.id, amount: rest });
  }
  return out;
}

// ───────────────────────── Kassadan berilgan pul ─────────────────────────

export type StaffCash = { id: string; date: Date; amount: number; account: string; sub: string | null; note: string | null; carried: boolean };

/**
 * Kirim-Chiqimda xodimga berilgan pul («Hodimlar bilan hisob-kitob» chiqimi, «Oylikdan nasiya»siz) — shu oy yakunida
 * «Oylikdan qarz» bo'lib ushlanadi. Oyi — chiqim sanasi. O'tgan oy vedomosti yopilgan (direktorga yuborilgan) bo'lsa,
 * uning oxirgi hisobidan KEYIN kiritilgan o'tgan oy sanali chiqim — shu oyga o'tadi. Bekor qilingan chiqim olinmaydi.
 */
export async function staffCashFor(month: string, employeeIds: string[]): Promise<Map<string, StaffCash[]>> {
  const out = new Map<string, StaffCash[]>();
  if (!employeeIds.length || !MONTH_RE.test(month)) return out;
  const [y, m] = month.split("-").map(Number);
  const prev = shiftMonth(month, -1);
  const [py, pm] = prev.split("-").map(Number);
  // O'tgan oy yakuni vedomosti yopilgan bo'lsa — uning qatorlari oxirgi hisoblangan paytdan keyin kiritilgan o'tgan oy
  // sanali chiqimlar unga tushmagan, shu oyga o'tadi. O'tgan oyda «Oylikdan qarz» qo'lda yozilgan xodimga — o'tmaydi
  // (Excel C2026 / qo'lda summa odatda shu pulni ham o'z ichiga oladi, ikki marta ushlanmasin).
  const prevRun = await db.payrollRun.findFirst({ where: { month: prev, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] }, calculatedAt: { not: null } }, orderBy: { calculatedAt: "desc" }, select: { calculatedAt: true } });
  const prevManual = prevRun ? new Set((await db.payAdjustment.findMany({ where: { month: prev, category: "SALARY_DEBT", cancelledAt: null, employeeId: { in: employeeIds } }, select: { employeeId: true } })).map((x) => x.employeeId)) : new Set<string>();
  const base = { type: "EXPENSE" as const, employeeId: { in: employeeIds }, cancelledAt: null, debt: { is: null } };
  const rows = await db.cashTransaction.findMany({
    where: {
      ...base,
      OR: [
        { date: { gte: new Date(y!, m! - 1, 1), lt: new Date(y!, m!, 1) } },
        ...(prevRun?.calculatedAt ? [{ date: { gte: new Date(py!, pm! - 1, 1), lt: new Date(y!, m! - 1, 1) }, createdAt: { gt: prevRun.calculatedAt } }] : []),
      ],
    },
    orderBy: { date: "asc" },
    select: { id: true, employeeId: true, date: true, amount: true, category: true, subCategory: true, note: true, cashAccount: { select: { name: true } } },
  });
  const from = new Date(y!, m! - 1, 1);
  for (const r of rows) {
    if (!r.employeeId || !isStaffSettleCategory(r.category)) continue;
    if (r.date < from && prevManual.has(r.employeeId)) continue;
    const list = out.get(r.employeeId) ?? [];
    list.push({ id: r.id, date: r.date, amount: num(r.amount), account: r.cashAccount.name, sub: r.subCategory, note: r.note, carried: r.date < from });
    out.set(r.employeeId, list);
  }
  return out;
}

// ───────────────────────── Oy jadvali ─────────────────────────

export type DeductionRow = {
  id: string; fullName: string; position: string; group: string;
  /** Guruh kaliti — Tabel bilan bir xil (`tabel.ts` → groupOf): «t:…» komanda, «b:…» brigada, «none» — biriktirilmagan */
  groupKey: string;
  values: Partial<Record<DeductionCat, number>>;
  /** Yozilmasa ham vedomost avtomatik ushlaydigan summa (kassa, nasiya, aliment daftari) */
  auto: Partial<Record<DeductionCat, number>>;
  suggest: Partial<Record<DeductionCat, number>>;
  hints: Partial<Record<DeductionCat, string>>;
};
export type DeductionMonth = { month: string; title: string; rows: DeductionRow[]; locked: string | null; fundAmount: number | null };

export async function deductionsMonth(month: string): Promise<DeductionMonth> {
  const days = monthDays(month);
  const from = dayUtc(days[0]!.iso), to = dayUtc(days[days.length - 1]!.iso);
  const [emps, adj, st, locked] = await Promise.all([
    db.employee.findMany({
      where: { AND: [employeesInWindow(from, to), { OR: [{ userId: null }, { user: { role: { notIn: ["SUPERADMIN"] } } }] }] },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, position: true, brigadeId: true, teamId: true, brigade: { select: { name: true } }, team: { select: { name: true } } },
    }),
    db.payAdjustment.findMany({ where: { month, cancelledAt: null, category: { not: null } }, select: { employeeId: true, category: true, amount: true } }),
    db.payrollSettings.findUnique({ where: { id: "main" }, select: { fundAmount: true } }),
    tabelLock(month),
  ]);
  const ids = emps.map((e) => e.id);
  const [led, cash, nasiya] = await Promise.all([ledgersFor(ids, month), staffCashFor(month, ids), debtsDue(month, ids)]);
  const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  const fund = st?.fundAmount != null ? num(st.fundAmount) : null;
  const rows: DeductionRow[] = emps.map((e) => {
    const values: DeductionRow["values"] = {};
    for (const a of adj) if (a.employeeId === e.id && isDeductionCat(a.category)) values[a.category] = (values[a.category] ?? 0) + num(a.amount);
    const auto: DeductionRow["auto"] = {}, suggest: DeductionRow["suggest"] = {}, hints: DeductionRow["hints"] = {};
    // Aliment / ijro: daftardagi oylik summa — vedomost o'zi ushlaydi; foizlisi vedomostda qo'lga tegadigandan
    const ws = led.withholds.filter((w) => w.employeeId === e.id);
    if (ws.length) {
      const fixed = ws.reduce((s, w) => s + (w.monthly != null ? Math.min(num(w.monthly), w.left ?? Infinity) : 0), 0);
      if (fixed > 0) auto.ALIMENT = r0(fixed);
      const pct = ws.filter((w) => w.monthly == null && w.percent != null);
      hints.ALIMENT = [...ws.map((w) => `${w.kind === "MIB" ? "Ijro" : "Aliment"}${w.caseNo ? ` №${w.caseNo}` : ""}${w.left != null ? `: qoldiq ${fmtNum(r0(w.left))}` : ""}`), ...(pct.length ? [`${pct.map((w) => num(w.percent)).join("%, ")}% — vedomostda qo'lga tegadigandan`] : [])].join("; ");
    }
    // Qarz: kassadan berilgan nasiya ulushi — avtomatik; kassasiz (Excel «Карз» / qo'lda) qoldiq ulushi — taklif
    const ns = nasiya.filter((d) => d.employeeId === e.id);
    const nsIds = new Set(ns.map((d) => d.id));
    const nsSum = ns.reduce((s, d) => s + d.amount, 0);
    if (nsSum > 0) auto.LOAN = r0(nsSum);
    const ds = led.debts.filter((d) => d.employeeId === e.id && d.left > 0);
    const opening = ds.filter((d) => !nsIds.has(d.id)).reduce((s, d) => s + Math.min(d.due, d.left), 0);
    if (opening > 0) suggest.LOAN = r0(nsSum + opening);
    if (ds.length || ns.length) hints.LOAN = [`qarz qoldig'i ${fmtNum(r0(ds.reduce((s, d) => s + d.left, 0)))}`, ...ns.map((d) => `${d.n}/${d.of}-oy ulushi ${fmtNum(d.amount)} (jami ${fmtNum(r0(d.total))}) — avtomatik`)].join("; ");
    // Oylikdan qarz: Kirim-Chiqimda xodimga berilgan pul — avtomatik
    const given = cash.get(e.id) ?? [];
    const givenSum = given.reduce((s, c) => s + c.amount, 0);
    if (givenSum > 0) {
      auto.SALARY_DEBT = r0(givenSum);
      hints.SALARY_DEBT = `Kirim-Chiqimdan: ${given.slice(0, 6).map((c) => `${dmy(c.date)} — ${fmtNum(r0(c.amount))}${c.sub ? ` (${c.sub})` : ""}${c.carried ? " [o'tgan oy, vedomostdan keyin]" : ""}`).join("; ")}${given.length > 6 ? ` va yana ${given.length - 6}` : ""}`;
    }
    if (fund) suggest.FUND = fund;
    const group = e.brigade?.name ?? e.team?.name ?? "";
    // `tabel.ts` → groupOf bilan bir xil (u modul payroll orqali bu faylni import qiladi — aylana bo'lmasin)
    const groupKey = e.brigadeId && e.brigade ? `b:${e.brigadeId}` : e.teamId && e.team ? `t:${e.teamId}` : "none";
    return { id: e.id, fullName: e.fullName, position: e.position, group, groupKey, values, auto, suggest, hints };
  });
  return { month, title: monthTitle(month), rows, locked, fundAmount: fund };
}

/**
 * Ushlanmalarni yozish: xodim × tur bo'yicha summa (bo'sh / 0 — bekor qilinadi). Oy yakuni vedomosti tasdiqqa
 * yuborilgan oyda yozilmaydi. Har o'zgarish AuditLog'da.
 */
export async function saveDeductions(who: Who, month: string, items: { employeeId: string; category: string; value: string }[], opts: { source?: string } = {}) {
  if (!MONTH_RE.test(month)) return { error: "Oy noto'g'ri" };
  const parsed: { employeeId: string; category: DeductionCat; amount: number; keep: boolean }[] = [];
  for (const it of items) {
    if (!isDeductionCat(it.category)) return { error: "Ushlanma turi noto'g'ri" };
    const t = String(it.value ?? "").replace(/[\s'’]/g, "").replace(",", ".");
    const n = t === "" || t === "-" ? 0 : Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 1e11) return { error: `«${it.value}» — summa noto'g'ri` };
    // «Oylikdan qarz» ga aniq 0 — kassadan berilgan pul shu oy ushlanmasin (bo'sh — avtomatik)
    parsed.push({ employeeId: it.employeeId, category: it.category, amount: r0(n), keep: r0(n) > 0 || (n === 0 && t !== "" && t !== "-" && it.category === ZERO_KEEP) });
  }
  if (!parsed.length) return { saved: 0 };
  const ids = [...new Set(parsed.map((p) => p.employeeId))];
  const emps = await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  if (emps.length !== ids.length) return { error: "Xodim topilmadi — sahifani yangilang" };
  const nameOf = new Map(emps.map((e) => [e.id, e.fullName]));
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ushlanma:" + month}))`;
    const locked = await tabelLock(month, tx);
    if (locked) return { error: locked.replace("tabel yopiq", "ushlanmalar yopiq") };
    const cur = await tx.payAdjustment.findMany({ where: { month, employeeId: { in: ids }, cancelledAt: null, category: { in: [...new Set(parsed.map((p) => p.category))] } } });
    let saved = 0;
    for (const p of parsed) {
      const rows = cur.filter((c) => c.employeeId === p.employeeId && c.category === p.category);
      const before = rows.reduce((s, r) => s + num(r.amount), 0);
      if (before === p.amount && (rows.length > 0) === p.keep) continue;
      // Shu tur bo'yicha bitta yozuv qoladi: ortiqchasi bekor qilinadi, birinchisi yangilanadi (yoki yaratiladi)
      for (const extra of rows.slice(1)) await tx.payAdjustment.update({ where: { id: extra.id }, data: { cancelledAt: new Date(), cancelledById: who.userId, cancelReason: "Ushlanmalar jadvalida birlashtirildi" } });
      const first = rows[0];
      if (!p.keep) {
        if (first) await tx.payAdjustment.update({ where: { id: first.id }, data: { cancelledAt: new Date(), cancelledById: who.userId, cancelReason: "Ushlanmalar jadvalida tozalandi" } });
      } else if (first) await tx.payAdjustment.update({ where: { id: first.id }, data: { amount: p.amount } });
      else await tx.payAdjustment.create({ data: { employeeId: p.employeeId, month, kind: "PENALTY", category: p.category, amount: p.amount, reason: deductionLabel(p.category)!, createdById: who.userId } });
      await audit(tx, who.userId, "UPDATE", "Ushlanma", `${p.employeeId}:${month}:${p.category}`, { summa: before }, { xodim: nameOf.get(p.employeeId), tur: deductionLabel(p.category), summa: p.amount, manba: opts.source ?? "jadval" });
      saved++;
    }
    return { saved };
  });
}

/**
 * «Qarz to'lovi» katagidagi summani oylarga bo'lish: summa xodim qarziga aylanadi (`EmployeeDebt`, `scheduled`) —
 * `startMonth` oyligidan boshlab `months` oy, har oy teng ulush (minglikka yaxlitlangan, oxirgisi qoldiq) avtomatik
 * ushlanadi. Katakdagi shu oy yozuvi bekor qilinadi (u summa endi jadval bo'yicha ushlanadi). Yopiq oydan boshlanmaydi.
 */
export async function splitLoan(who: Who, x: { month: string; employeeId: string; amount: number; months: number; startMonth: string; note?: string | null }) {
  if (!MONTH_RE.test(x.month) || !MONTH_RE.test(x.startMonth)) return { error: "Oy noto'g'ri" };
  const amount = r0(x.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e11) return { error: "Summa noto'g'ri" };
  if (!Number.isInteger(x.months) || x.months < 1 || x.months > 60) return { error: "Oylar soni 1 dan 60 gacha" };
  if (x.startMonth < x.month || x.startMonth > shiftMonth(x.month, 12)) return { error: "Boshlanish oyi — shu oydan keyingi 12 oy ichida" };
  const emp = await db.employee.findUnique({ where: { id: x.employeeId }, select: { id: true, fullName: true } });
  if (!emp) return { error: "Xodim topilmadi — sahifani yangilang" };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ushlanma:" + x.month}))`;
    for (const m of new Set([x.month, x.startMonth])) {
      const locked = await tabelLock(m, tx);
      if (locked) return { error: `${monthTitle(m)}: ${locked.replace("tabel yopiq", "ushlanmalar yopiq")}` };
    }
    const note = x.note?.trim() || `Ushlanmalar jadvalidan: ${x.months} oyga bo'lindi`;
    const d = await tx.employeeDebt.create({ data: { employeeId: emp.id, amount, months: x.months, startMonth: x.startMonth, scheduled: true, note: note.slice(0, 300), createdById: who.userId } });
    // Katakdagi summa — endi qarz jadvali: shu oy «Qarz to'lovi» yozuvi bekor qilinadi
    const cur = await tx.payAdjustment.findMany({ where: { month: x.month, employeeId: emp.id, category: "LOAN", cancelledAt: null }, select: { id: true, amount: true } });
    if (cur.length) await tx.payAdjustment.updateMany({ where: { id: { in: cur.map((c) => c.id) } }, data: { cancelledAt: new Date(), cancelledById: who.userId, cancelReason: "Oylarga bo'lindi — qarz jadvali" } });
    await audit(tx, who.userId, "CREATE", "EmployeeDebt", d.id, cur.length ? { katak: cur.reduce((s, c) => s + num(c.amount), 0) } : undefined, { xodim: emp.fullName, summa: amount, oylar: x.months, boshlanish: x.startMonth, manba: "Ushlanmalar → oylarga bo'lish" });
    return { ok: true as const, id: d.id, monthly: installment(amount, x.months, 1) };
  });
}

/** To'y puli sukut summasi (Ushlanmalar jadvalida taklif). */
export async function saveFundAmount(who: Who, amount: number | null) {
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) return { error: "Summa noto'g'ri" };
  const before = await db.payrollSettings.findUnique({ where: { id: "main" }, select: { fundAmount: true } });
  await db.payrollSettings.upsert({ where: { id: "main" }, create: { id: "main", fundAmount: amount }, update: { fundAmount: amount, updatedById: who.userId } });
  await audit(db, who.userId, "UPDATE", "PayrollSettings", "main", { fundAmount: before?.fundAmount ?? null }, { fundAmount: amount });
  return { ok: true as const };
}

// ───────────────────────── Ijro / aliment daftari ─────────────────────────

export async function listWithholdings(employeeId?: string) {
  const ws = await db.withholding.findMany({
    ...(employeeId ? { where: { employeeId } } : {}),
    orderBy: [{ cancelledAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], take: 500,
    include: { employee: { select: { id: true, fullName: true, position: true } } },
  });
  const lines = await closedLines([...new Set(ws.map((w) => w.employeeId))]);
  return ws.map((w) => {
    const held = withholdHeld(w, lines);
    return {
      id: w.id, employee: w.employee, kind: w.kind, caseNo: w.caseNo, creditor: w.creditor,
      amount: w.amount != null ? num(w.amount) : null, percent: w.percent != null ? num(w.percent) : null, monthly: w.monthly != null ? num(w.monthly) : null,
      startMonth: w.startMonth, held, left: w.amount != null ? Math.max(0, num(w.amount) - held) : null,
      note: w.note, cancelledAt: w.cancelledAt, cancelReason: w.cancelReason,
    };
  });
}

/**
 * Xodimning o'z qarz va ijro/aliment qoldig'i («oyligim», «Mening hisobim») — Ish haqi → Xodim qarzlari / Ijro daftari bilan
 * bir hisob (`listDebts` / `listWithholdings`): bekor qilinmagan va qoldig'i bor (summasi belgilanmagan ijro — muddatsiz).
 */
export async function employeeLedger(employeeId: string) {
  const [debts, withs] = await Promise.all([listDebts(employeeId), listWithholdings(employeeId)]);
  const d = debts.filter((x) => !x.cancelledAt && x.left > 0);
  const w = withs.filter((x) => !x.cancelledAt && (x.left == null || x.left > 0));
  return {
    debts: d, withholds: w,
    debtLeft: d.reduce((s, x) => s + x.left, 0),
    withholdLeft: w.reduce((s, x) => s + (x.left ?? 0), 0),
  };
}
export type EmployeeLedger = Awaited<ReturnType<typeof employeeLedger>>;

export type WithholdingInput = { employeeId: string; kind: "MIB" | "ALIMENT"; caseNo?: string | null; creditor?: string | null; amount?: number | null; percent?: number | null; monthly?: number | null; startMonth: string; heldBefore?: number; note?: string | null };

export async function createWithholding(who: Who, x: WithholdingInput) {
  if (!MONTH_RE.test(x.startMonth)) return { error: "Boshlanish oyini tanlang" };
  if (x.kind !== "MIB" && x.kind !== "ALIMENT") return { error: "Turi noto'g'ri" };
  if (x.monthly == null && x.percent == null) return { error: "Oylik summa yoki foizni kiriting" };
  if (x.percent != null && (x.percent <= 0 || x.percent > 100)) return { error: "Foiz 1–100 oralig'ida" };
  for (const v of [x.amount, x.monthly, x.heldBefore]) if (v != null && (!Number.isFinite(v) || v < 0)) return { error: "Summa noto'g'ri" };
  if (!(await db.employee.findUnique({ where: { id: x.employeeId }, select: { id: true } }))) return { error: "Xodim topilmadi" };
  const w = await db.withholding.create({
    data: {
      employeeId: x.employeeId, kind: x.kind, caseNo: x.caseNo?.trim() || null, creditor: x.creditor?.trim() || null,
      amount: x.amount ?? null, percent: x.percent ?? null, monthly: x.monthly ?? null, startMonth: x.startMonth,
      heldBefore: x.heldBefore ?? 0, note: x.note?.trim() || null, createdById: who.userId,
    },
  });
  await audit(db, who.userId, "CREATE", "Withholding", w.id, undefined, w);
  return { ok: true as const, id: w.id };
}

export async function cancelWithholding(who: Who, id: string, reason: string) {
  if (reason.trim().length < 3) return { error: "Sababini yozing" };
  const u = await db.withholding.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: who.userId, cancelReason: reason.trim() } });
  if (!u.count) return { error: "Yozuv topilmadi yoki allaqachon bekor qilingan" };
  await audit(db, who.userId, "STATUS_CHANGE", "Withholding", id, undefined, { bekor: reason.trim() });
  return { ok: true as const };
}

// ───────────────────────── Qarz: boshlang'ich qoldiq ─────────────────────────

/**
 * Excel «Карз»dan o'tish: kassasiz qarz (boshlang'ich qoldiq). Oylik ulush — taklif (Ushlanmalar jadvalida qo'lda o'zgaradi):
 * oylar soni = qoldiq ÷ oylik ulush.
 */
export async function createOpeningDebt(who: Who, x: { employeeId: string; amount: number; monthly: number; startMonth: string; note?: string | null }) {
  if (!MONTH_RE.test(x.startMonth)) return { error: "Boshlanish oyini tanlang" };
  if (!(x.amount > 0) || !(x.monthly > 0)) return { error: "Qarz va oylik ulushni kiriting" };
  if (!(await db.employee.findUnique({ where: { id: x.employeeId }, select: { id: true } }))) return { error: "Xodim topilmadi" };
  const months = Math.min(120, Math.max(1, Math.ceil(x.amount / x.monthly)));
  const d = await db.employeeDebt.create({ data: { employeeId: x.employeeId, amount: r0(x.amount), months, startMonth: x.startMonth, note: x.note?.trim() || "Boshlang'ich qoldiq", createdById: who.userId } });
  await audit(db, who.userId, "CREATE", "EmployeeDebt", d.id, undefined, { ...d, manba: "boshlang'ich qoldiq" });
  return { ok: true as const, id: d.id, months };
}


// ───────────────────────── Avans va plastik summalari (xodim bo'yicha) ─────────────────────────

/** Avans (qo'lda, oyiga) va plastik qismi — `Employee.advanceAmount` / `cardAmount`. Bo'sh — avans foiz bo'yicha, hammasi naqd. */
export async function payoutAmounts() {
  return db.employee.findMany({
    where: { firedAt: null, OR: [{ userId: null }, { user: { role: { notIn: ["SUPERADMIN"] } } }] },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, position: true, advanceAmount: true, cardAmount: true },
  }).then((r) => r.map((e) => ({ id: e.id, fullName: e.fullName, position: e.position, advance: e.advanceAmount != null ? num(e.advanceAmount) : null, card: e.cardAmount != null ? num(e.cardAmount) : null })));
}

export async function savePayoutAmounts(who: Who, items: { employeeId: string; field: "advance" | "card"; value: string }[], opts: { source?: string } = {}) {
  const parsed: { employeeId: string; field: "advance" | "card"; amount: number | null }[] = [];
  for (const it of items) {
    if (it.field !== "advance" && it.field !== "card") return { error: "Maydon noto'g'ri" };
    const t = String(it.value ?? "").replace(/[\s'’]/g, "").replace(",", ".");
    const n = t === "" || t === "-" ? null : Number(t);
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 1e11)) return { error: `«${it.value}» — summa noto'g'ri` };
    parsed.push({ employeeId: it.employeeId, field: it.field, amount: n == null || n === 0 ? null : r0(n) });
  }
  let saved = 0;
  await db.$transaction(async (tx) => {
    for (const p of parsed) {
      const cur = await tx.employee.findUnique({ where: { id: p.employeeId }, select: { fullName: true, advanceAmount: true, cardAmount: true } });
      if (!cur) continue;
      const key = p.field === "advance" ? "advanceAmount" : "cardAmount";
      const before = cur[key] != null ? num(cur[key]) : null;
      if (before === p.amount) continue;
      await tx.employee.update({ where: { id: p.employeeId }, data: { [key]: p.amount } });
      await audit(tx, who.userId, "UPDATE", "Employee", p.employeeId, { [key]: before }, { [key]: p.amount, xodim: cur.fullName, manba: opts.source ?? "Ish haqi → Ushlanmalar" });
      saved++;
    }
  });
  return { saved };
}
