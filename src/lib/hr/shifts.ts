import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dayUtc, isoDay, monthDays, shiftDay } from "@/lib/davomat";
import { normTime, shiftOf, type Shift } from "@/lib/attendance-time";
import type { Prisma } from "@/generated/prisma";

/**
 * Smena grafigi — xodimning har kungi smenasi yoki dam olish kuni (`ShiftAssignment`).
 * Katak bo'lmasa — xodim kartasidagi "Ish grafigi" (`workSchedule`) va zavod standarti (yakshanba — dam).
 *
 * Bir qoida hamma joyda: kechikish ("Keldim", skaner, sex, kadr tabeli), oyning norma kunlari va ish haqi
 * shu fayldagi `dayPlan` / `plansFor` dan o'qiydi.
 */

export type DayPlan = Shift & { off: boolean; templateId: string | null; label: string | null; fromGrid: boolean };

export const SHIFT_COLORS = ["slate", "sky", "emerald", "amber", "violet", "rose"] as const;

/** Grafik katagi yo'q kun: kartadagi smena, yakshanba — dam olish. */
function fallback(workSchedule: string | null | undefined, iso: string): DayPlan {
  return { ...shiftOf(workSchedule), off: dayUtc(iso).getUTCDay() === 0, templateId: null, label: null, fromGrid: false };
}

type Cell = { employeeId: string; date: Date; off: boolean; start: string | null; end: string | null; templateId: string | null; template: { name: string; start: string; end: string } | null };
function fromCell(c: Cell, workSchedule: string | null | undefined): DayPlan {
  const base = shiftOf(workSchedule);
  const start = c.start ?? c.template?.start ?? base.start;
  const end = c.end ?? c.template?.end ?? base.end;
  return { start, end, off: c.off, templateId: c.templateId, label: c.off ? "Dam" : c.template?.name ?? `${start}–${end}`, fromGrid: true };
}

const CELL_SELECT = { employeeId: true, date: true, off: true, start: true, end: true, templateId: true, template: { select: { name: true, start: true, end: true } } } as const;

/** Bir nechta xodimning bir kunlik rejasi (kechikish hisobi uchun). */
export async function plansFor(employeeIds: string[], iso: string, tx: Prisma.TransactionClient = db): Promise<Map<string, DayPlan>> {
  const ids = [...new Set(employeeIds)];
  if (!ids.length) return new Map();
  const [emps, cells] = await Promise.all([
    tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, workSchedule: true } }),
    tx.shiftAssignment.findMany({ where: { employeeId: { in: ids }, date: dayUtc(iso) }, select: CELL_SELECT }),
  ]);
  const ws = new Map(emps.map((e) => [e.id, e.workSchedule]));
  const byEmp = new Map(cells.map((c) => [c.employeeId, c]));
  return new Map(ids.map((id) => {
    const c = byEmp.get(id);
    return [id, c ? fromCell(c, ws.get(id)) : fallback(ws.get(id), iso)];
  }));
}

/** Bitta xodimning bir kunlik smenasi. */
export async function dayPlan(employeeId: string, iso: string, tx: Prisma.TransactionClient = db): Promise<DayPlan> {
  return (await plansFor([employeeId], iso, tx)).get(employeeId)!;
}

/** Davr bo'yicha reja: xodim → (kun → reja). Grafik sahifasi va ish haqi uchun. */
export async function plansInRange(employees: { id: string; workSchedule: string | null }[], fromIso: string, toIso: string): Promise<Map<string, Map<string, DayPlan>>> {
  const cells = employees.length
    ? await db.shiftAssignment.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: dayUtc(fromIso), lte: dayUtc(toIso) } }, select: CELL_SELECT })
    : [];
  const byKey = new Map(cells.map((c) => [`${c.employeeId}|${isoDay(c.date)}`, c]));
  const days: string[] = [];
  for (let d = fromIso; d <= toIso; d = shiftDay(d, 1)) days.push(d);
  const out = new Map<string, Map<string, DayPlan>>();
  for (const e of employees) {
    out.set(e.id, new Map(days.map((iso) => {
      const c = byKey.get(`${e.id}|${iso}`);
      return [iso, c ? fromCell(c, e.workSchedule) : fallback(e.workSchedule, iso)];
    })));
  }
  return out;
}

/** Oy normasi — reja bo'yicha ish kunlari (dam olish kunlarisiz). */
export function normDaysOf(plan: Map<string, DayPlan> | undefined, month: string): number {
  const days = monthDays(month);
  if (!plan) return days.filter((d) => !d.weekend).length;
  return days.filter((d) => !(plan.get(d.iso)?.off ?? d.weekend)).length;
}

// ───────────────────────── Yozish (otdel kadr) ─────────────────────────

export type CellInput = { employeeId: string; date: string; value: string };

/**
 * Grafik kataklarini saqlaydi. `value`: "" — katak tozalanadi (kartadagi smena), "off" — dam olish,
 * "t:<shablonId>" — shablon, "HH:MM-HH:MM" — qo'lda vaqt.
 */
export async function saveShiftCells(cells: CellInput[], userId: string): Promise<{ saved: number; cleared: number } | { error: string }> {
  if (!cells.length) return { saved: 0, cleared: 0 };
  if (cells.length > 3000) return { error: "Bir martada juda ko'p katak — davrni qisqartiring" };
  const templates = new Map((await db.shiftTemplate.findMany({ select: { id: true } })).map((t) => [t.id, t]));
  const parsed: { employeeId: string; date: Date; data: { off: boolean; templateId: string | null; start: string | null; end: string | null } | null }[] = [];
  for (const c of cells) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return { error: "Sana noto'g'ri" };
    const v = c.value.trim();
    let data: (typeof parsed)[number]["data"] = null;
    if (v === "off") data = { off: true, templateId: null, start: null, end: null };
    else if (v.startsWith("t:")) {
      const id = v.slice(2);
      if (!templates.has(id)) return { error: "Smena shabloni topilmadi — sahifani yangilang" };
      data = { off: false, templateId: id, start: null, end: null };
    } else if (v) {
      const [a, b] = v.split(/[-–]/).map((x) => normTime(x));
      if (!a || !b || a === b) return { error: `Vaqt noto'g'ri: «${v}» — 08:00-17:00 ko'rinishida yozing` };
      data = { off: false, templateId: null, start: a, end: b };
    }
    parsed.push({ employeeId: c.employeeId, date: dayUtc(c.date), data });
  }
  const emps = new Set((await db.employee.findMany({ where: { id: { in: [...new Set(parsed.map((p) => p.employeeId))] } }, select: { id: true } })).map((e) => e.id));
  if (parsed.some((p) => !emps.has(p.employeeId))) return { error: "Xodim topilmadi — sahifani yangilang" };

  return db.$transaction(async (tx) => {
    let saved = 0, cleared = 0;
    for (const p of parsed) {
      if (!p.data) {
        const r = await tx.shiftAssignment.deleteMany({ where: { employeeId: p.employeeId, date: p.date } });
        cleared += r.count;
        continue;
      }
      await tx.shiftAssignment.upsert({
        where: { employeeId_date: { employeeId: p.employeeId, date: p.date } },
        create: { employeeId: p.employeeId, date: p.date, ...p.data, createdById: userId },
        update: { ...p.data, createdById: userId },
      });
      saved++;
    }
    await audit(tx, userId, "UPDATE", "ShiftAssignment", parsed[0]!.employeeId, undefined, { saqlandi: saved, tozalandi: cleared, kataklar: cells.slice(0, 200) });
    return { saved, cleared };
  }, { timeout: 60_000 });
}

/**
 * Takrorlanuvchi naqsh bilan to'ldirish: masalan "5/2" — 5 kun ish, 2 kun dam; "2/2"; "1/3" (sutka/uch kun dam).
 * `startIso` dan `endIso` gacha, `templateId` smenasi bilan. Mavjud kataklar ustidan yoziladi.
 */
export async function fillPattern(input: { employeeIds: string[]; templateId: string; work: number; rest: number; startIso: string; endIso: string }, userId: string) {
  const { work, rest } = input;
  if (!(work >= 1 && work <= 14 && rest >= 0 && rest <= 14)) return { error: "Naqsh noto'g'ri: ish kunlari 1–14, dam 0–14" };
  if (input.endIso < input.startIso) return { error: "Davr oxiri boshidan oldin" };
  const cells: CellInput[] = [];
  for (const employeeId of input.employeeIds) {
    let n = 0;
    for (let d = input.startIso; d <= input.endIso; d = shiftDay(d, 1), n++) {
      const inWork = n % (work + rest) < work;
      cells.push({ employeeId, date: d, value: inWork ? `t:${input.templateId}` : "off" });
    }
  }
  return saveShiftCells(cells, userId);
}
