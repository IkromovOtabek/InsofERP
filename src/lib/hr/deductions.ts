
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dayUtc, monthDays, monthTitle } from "@/lib/davomat";
import { employeesInWindow } from "@/lib/attendance-report";
import { isStaffSettleCategory } from "@/lib/cash-categories";
import { tabelLock } from "./tabel-lock";
import { allocOf, closedLines, debtHeld, dueIn, type Alloc, type HeldLine } from "./employee-debt";
import { deductionLabel, isDeductionCat, type DeductionCat } from "./deduction-cats";

/**
 * Ushlanmalar (Ish haqi → Ushlanmalar) — Excel C2026'ning G–K ustunlari: aliment/ijro, qarz to'lovi, oylikdan qarz,
 * to'y puli, jarima. Har xodim × oy × tur — bitta `PayAdjustment` (PENALTY, `category`). Oy yakuni vedomosti ularni ushlaydi.
 *
 * Takliflar (kul rang): aliment — ijro/aliment daftaridan (`Withholding`), qarz — nasiya jadvalidan (`EmployeeDebt`),
 * oylikdan qarz — shu oy kassadan xodimga «Hodimlar bilan hisob-kitob» bilan berilgan (nasiyasiz) pul, to'y puli — sozlamadan.
 * Qarz va aliment uchun yozilgan summa jadvaldagi/avtomatik ulush o'rniga ushlanadi va daftardagi qoldiqdan kamayadi
 * (`lib/hr/payroll.ts` → `breakdown.debts` / `breakdown.withholds`).
 */

type Who = { userId: string };
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

// ───────────────────────── Oy jadvali ─────────────────────────

export type DeductionRow = {
  id: string; fullName: string; position: string; group: string;
  values: Partial<Record<DeductionCat, number>>;
  suggest: Partial<Record<DeductionCat, number>>;
  hints: Partial<Record<DeductionCat, string>>;
};
export type DeductionMonth = { month: string; title: string; rows: DeductionRow[]; locked: string | null; fundAmount: number | null };

export async function deductionsMonth(month: string): Promise<DeductionMonth> {
  const days = monthDays(month);
  const from = dayUtc(days[0]!.iso), to = dayUtc(days[days.length - 1]!.iso);
  const [y, m] = month.split("-").map(Number);
  const [emps, adj, st, locked, cash] = await Promise.all([
    db.employee.findMany({
      where: { AND: [employeesInWindow(from, to), { OR: [{ userId: null }, { user: { role: { notIn: ["SUPERADMIN"] } } }] }] },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, position: true, subdivision: true, brigade: { select: { name: true } }, team: { select: { name: true } } },
    }),
    db.payAdjustment.findMany({ where: { month, cancelledAt: null, category: { not: null } }, select: { employeeId: true, category: true, amount: true } }),
    db.payrollSettings.findUnique({ where: { id: "main" }, select: { fundAmount: true } }),
    tabelLock(month),
    // Shu oy kassadan xodimga berilgan (nasiyasiz) pul — «oylikdan qarz» taklifi
    db.cashTransaction.findMany({
      where: { type: "EXPENSE", employeeId: { not: null }, cancelledAt: null, debt: { is: null }, date: { gte: new Date(y!, m! - 1, 1), lt: new Date(y!, m!, 1) } },
      select: { employeeId: true, amount: true, category: true },
    }),
  ]);
  const ids = emps.map((e) => e.id);
  const led = await ledgersFor(ids, month);
  const fund = st?.fundAmount != null ? num(st.fundAmount) : null;
  const rows: DeductionRow[] = emps.map((e) => {
    const values: DeductionRow["values"] = {};
    for (const a of adj) if (a.employeeId === e.id && isDeductionCat(a.category)) values[a.category] = (values[a.category] ?? 0) + num(a.amount);
    const suggest: DeductionRow["suggest"] = {}, hints: DeductionRow["hints"] = {};
    const ws = led.withholds.filter((w) => w.employeeId === e.id);
    if (ws.length) {
      const fixed = ws.reduce((s, w) => s + (w.monthly != null ? Math.min(num(w.monthly), w.left ?? Infinity) : 0), 0);
      if (fixed > 0) suggest.ALIMENT = r0(fixed);
      const pct = ws.filter((w) => w.monthly == null && w.percent != null);
      hints.ALIMENT = [...ws.map((w) => `${w.kind === "MIB" ? "Ijro" : "Aliment"}${w.caseNo ? ` №${w.caseNo}` : ""}${w.left != null ? `: qoldiq ${r0(w.left)}` : ""}`), ...(pct.length ? [`${pct.map((w) => num(w.percent)).join("%, ")}% — vedomostda qo'lga tegadigandan`] : [])].join("; ");
    }
    const ds = led.debts.filter((d) => d.employeeId === e.id && d.left > 0);
    if (ds.length) {
      const due = ds.reduce((s, d) => s + Math.min(d.due, d.left), 0);
      if (due > 0) suggest.LOAN = r0(due);
      hints.LOAN = `qarz qoldig'i ${r0(ds.reduce((s, d) => s + d.left, 0))}`;
    }
    const given = cash.filter((c) => c.employeeId === e.id && isStaffSettleCategory(c.category)).reduce((s, c) => s + num(c.amount), 0);
    if (given > 0) { suggest.SALARY_DEBT = r0(given); hints.SALARY_DEBT = "shu oy kassadan berilgan (nasiyasiz)"; }
    if (fund) suggest.FUND = fund;
    const group = e.brigade?.name ?? e.team?.name ?? e.subdivision?.trim() ?? "";
    return { id: e.id, fullName: e.fullName, position: e.position, group, values, suggest, hints };
  });
  return { month, title: monthTitle(month), rows, locked, fundAmount: fund };
}

/**
 * Ushlanmalarni yozish: xodim × tur bo'yicha summa (bo'sh / 0 — bekor qilinadi). Oy yakuni vedomosti tasdiqqa
 * yuborilgan oyda yozilmaydi. Har o'zgarish AuditLog'da.
 */
export async function saveDeductions(who: Who, month: string, items: { employeeId: string; category: string; value: string }[], opts: { source?: string } = {}) {
  if (!MONTH_RE.test(month)) return { error: "Oy noto'g'ri" };
  const parsed: { employeeId: string; category: DeductionCat; amount: number }[] = [];
  for (const it of items) {
    if (!isDeductionCat(it.category)) return { error: "Ushlanma turi noto'g'ri" };
    const t = String(it.value ?? "").replace(/[\s'’]/g, "").replace(",", ".");
    const n = t === "" || t === "-" ? 0 : Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 1e11) return { error: `«${it.value}» — summa noto'g'ri` };
    parsed.push({ employeeId: it.employeeId, category: it.category, amount: r0(n) });
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
      if (before === p.amount) continue;
      // Shu tur bo'yicha bitta yozuv qoladi: ortiqchasi bekor qilinadi, birinchisi yangilanadi (yoki yaratiladi)
      for (const extra of rows.slice(1)) await tx.payAdjustment.update({ where: { id: extra.id }, data: { cancelledAt: new Date(), cancelledById: who.userId, cancelReason: "Ushlanmalar jadvalida birlashtirildi" } });
      const first = rows[0];
      if (p.amount === 0) {
        if (first) await tx.payAdjustment.update({ where: { id: first.id }, data: { cancelledAt: new Date(), cancelledById: who.userId, cancelReason: "Ushlanmalar jadvalida tozalandi" } });
      } else if (first) await tx.payAdjustment.update({ where: { id: first.id }, data: { amount: p.amount } });
      else await tx.payAdjustment.create({ data: { employeeId: p.employeeId, month, kind: "PENALTY", category: p.category, amount: p.amount, reason: deductionLabel(p.category)!, createdById: who.userId } });
      await audit(tx, who.userId, "UPDATE", "Ushlanma", `${p.employeeId}:${month}:${p.category}`, { summa: before }, { xodim: nameOf.get(p.employeeId), tur: deductionLabel(p.category), summa: p.amount, manba: opts.source ?? "jadval" });
      saved++;
    }
    return { saved };
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

export async function listWithholdings() {
  const ws = await db.withholding.findMany({
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

