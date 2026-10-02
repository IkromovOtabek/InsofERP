"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { validMonth } from "@/lib/davomat";
import { EXPENSE_CATEGORIES } from "@/app/(app)/cashflow/categories";

const refresh = () => { revalidatePath("/dashboard"); revalidatePath("/dashboard/byudjet"); };
const zMoney = z.string().trim().optional().transform((v) => (v ? Number(v.replace(/[\s,]/g, "")) : null)).refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT), "summa noto'g'ri");

/**
 * Oy byudjeti — bitta forma, har kategoriya uchun `amt:<kat>` va `lim:<kat>`.
 * Bo'sh qoldirilgan kategoriya byudjeti o'chadi (rejalashtirilmagan xarajat sifatida ko'rinadi).
 * Har o'zgarish auditda — TZ "byudjet o'zgarish tarixi" shu yerdan o'qiladi.
 */
export async function saveBudgets(month: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([]); // faqat direktor
  const ym = validMonth(month);
  if (!ym) return { error: "Oy noto'g'ri" };
  const [year, mon] = ym.split("-").map(Number);
  const cats = [...new Set([...EXPENSE_CATEGORIES, ...fd.getAll("cat[]").map(String)])];
  const rows: { category: string; amount: number; limit: number | null }[] = [];
  const clear: string[] = [];
  for (const category of cats) {
    const a = zMoney.safeParse(fd.get(`amt:${category}`) ?? undefined);
    const l = zMoney.safeParse(fd.get(`lim:${category}`) ?? undefined);
    if (!a.success || !l.success) return { error: `${category}: summa noto'g'ri` };
    if (a.data === null || a.data === 0) { clear.push(category); continue; }
    if (l.data !== null && l.data < a.data) return { error: `${category}: limit byudjetdan kam bo'lmasin` };
    rows.push({ category, amount: a.data, limit: l.data });
  }
  await db.$transaction(async (tx) => {
    const before = await tx.expenseBudget.findMany({ where: { year, month: mon } });
    if (clear.length) await tx.expenseBudget.deleteMany({ where: { year, month: mon, category: { in: clear } } });
    for (const r of rows) {
      await tx.expenseBudget.upsert({
        where: { year_month_category: { year, month: mon, category: r.category } },
        create: { year, month: mon, ...r, setById: s.userId },
        update: { amount: r.amount, limit: r.limit, setById: s.userId },
      });
    }
    await audit(tx, s.userId, "UPDATE", "ExpenseBudget", ym, before.map((b) => ({ c: b.category, a: Number(b.amount), l: b.limit ? Number(b.limit) : null })), rows.map((r) => ({ c: r.category, a: r.amount, l: r.limit })));
  });
  refresh();
  return { ok: true, note: `${rows.length} ta kategoriya byudjeti saqlandi` };
}

/** O'tgan oy byudjetini joriy oyga nusxalash — har oy qo'lda terib chiqmaslik uchun. */
export async function copyBudgets(fromMonth: string, toMonth: string): Promise<ActionState> {
  const s = await requireSession([]);
  const a = validMonth(fromMonth), b = validMonth(toMonth);
  if (!a || !b) return { error: "Oy noto'g'ri" };
  const [fy, fm] = a.split("-").map(Number), [ty, tm] = b.split("-").map(Number);
  const src = await db.expenseBudget.findMany({ where: { year: fy, month: fm } });
  if (!src.length) return { error: "O'tgan oyda byudjet yo'q" };
  await db.$transaction(async (tx) => {
    for (const r of src) {
      await tx.expenseBudget.upsert({
        where: { year_month_category: { year: ty, month: tm, category: r.category } },
        create: { year: ty, month: tm, category: r.category, amount: r.amount, limit: r.limit, note: r.note, setById: s.userId },
        update: {},
      });
    }
    await audit(tx, s.userId, "CREATE", "ExpenseBudget", b, undefined, { copiedFrom: a, count: src.length });
  });
  refresh();
  return { ok: true, note: `${src.length} ta kategoriya nusxalandi` };
}

const ThresholdSchema = z.object({
  alertWarnPct: z.coerce.number().int().min(1).max(500),
  alertCritPct: z.coerce.number().int().min(1).max(1000),
  stockWarnDays: z.coerce.number().int().min(1).max(365),
  stockCritDays: z.coerce.number().int().min(0).max(365),
  overdueDays: z.coerce.number().int().min(1).max(365),
  supplyDirectorLimit: z.coerce.number().min(0).max(1e13),
});

/** Norma / e'tibor / kritik chegaralari — TZ §16: administrator sozlaydi. */
export async function saveThresholds(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([]);
  const r = parseForm(ThresholdSchema, fd);
  if ("error" in r) return { error: r.error };
  if (r.data.alertCritPct < r.data.alertWarnPct) return { error: "Kritik foiz e'tibor foizidan kam bo'lmasin" };
  if (r.data.stockCritDays > r.data.stockWarnDays) return { error: "Kritik kun e'tibor kunidan ko'p bo'lmasin" };
  const before = await db.companySettings.findUnique({ where: { id: "main" } });
  const after = await db.companySettings.upsert({ where: { id: "main" }, update: r.data, create: { id: "main", ...r.data } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before, after);
  refresh();
  return { ok: true };
}
