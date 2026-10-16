"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zOpt, zStr, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { normTime } from "@/lib/attendance-time";
import { validDay, validMonth } from "@/lib/davomat";
import { fillPattern, saveShiftCells, SHIFT_COLORS, type CellInput } from "@/lib/hr/shifts";
import { createHrRequest, decideHrRequest } from "@/lib/hr/requests";
import { REQUEST_KINDS, RULE_TRIGGER } from "@/lib/hr/labels";
import type { HrRequestKind, PayRuleTrigger } from "@/generated/prisma";

/*
 * Otdel kadr: smena grafigi, arizalar, jarima va bonuslar. Qoidalar — `lib/hr/*`.
 * Har amal — "employees" modulidagi aniq amal (direktor ruxsat katalogi, `lib/permissions.ts`).
 */

const refresh = (...extra: string[]) => { for (const p of ["/otdel-kadr", "/hisobim", "/ish-haqi", ...extra]) revalidatePath(p); };

// ───────────────────────── Smena shablonlari va grafik ─────────────────────────

const templateSchema = z.object({
  name: zStr("Smena nomi kerak").pipe(z.string().max(60, "Nom 60 belgidan oshmasin")),
  start: zStr("Boshlanish vaqti kerak"),
  end: zStr("Tugash vaqti kerak"),
  color: zOpt,
});

export async function saveShiftTemplate(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "schedule", ["HR"]);
  const r = parseForm(templateSchema, fd);
  if ("error" in r) return { error: r.error };
  const start = normTime(r.data.start), end = normTime(r.data.end);
  if (!start || !end) return { error: "Vaqtni SS:DD ko'rinishida kiriting (masalan 08:00)" };
  if (start === end) return { error: "Boshlanish va tugash bir xil bo'lmasin" };
  const color = r.data.color && (SHIFT_COLORS as readonly string[]).includes(r.data.color) ? r.data.color : "slate";
  try {
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.shiftTemplate.findUniqueOrThrow({ where: { id } });
        const after = await tx.shiftTemplate.update({ where: { id }, data: { name: r.data.name, start, end, color } });
        await audit(tx, s.userId, "UPDATE", "ShiftTemplate", id, before, after);
      } else {
        const last = await tx.shiftTemplate.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
        const x = await tx.shiftTemplate.create({ data: { name: r.data.name, start, end, color, sortOrder: (last?.sortOrder ?? 0) + 10 } });
        await audit(tx, s.userId, "CREATE", "ShiftTemplate", x.id, undefined, x);
      }
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bunday nomli smena bor" };
    throw e;
  }
  refresh();
  return { ok: true, note: "Smena saqlandi" };
}

/** Shablonni yashirish / qaytarish (grafikdagi eski kataklar o'z vaqtini saqlaydi). */
export async function toggleShiftTemplate(id: string): Promise<ActionState> {
  const s = await requireAction("employees", "schedule", ["HR"]);
  const cur = await db.shiftTemplate.findUnique({ where: { id } });
  if (!cur) return { error: "Smena topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.shiftTemplate.update({ where: { id }, data: { isActive: !cur.isActive } });
    await audit(tx, s.userId, "UPDATE", "ShiftTemplate", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  });
  refresh();
  return { ok: true };
}

/** Grafik kataklari: `cells` — JSON [{employeeId, date, value}] (faqat o'zgarganlari). */
export async function saveShiftGrid(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "schedule", ["HR"]);
  let cells: CellInput[];
  try {
    const raw: unknown = JSON.parse(String(fd.get("cells") ?? "[]"));
    if (!Array.isArray(raw)) throw new Error();
    cells = raw.filter((c): c is CellInput => !!c && typeof c.employeeId === "string" && typeof c.date === "string" && typeof c.value === "string");
  } catch { return { error: "Grafik ma'lumoti o'qilmadi — sahifani yangilang" }; }
  if (!cells.length) return { ok: true, note: "O'zgarish yo'q" };
  const r = await saveShiftCells(cells, s.userId);
  if ("error" in r) return { error: r.error };
  refresh("/dashboard");
  return { ok: true, note: `Grafik saqlandi: ${r.saved} katak${r.cleared ? `, ${r.cleared} tasi tozalandi (kartadagi smena)` : ""}` };
}

const patternSchema = z.object({
  templateId: zStr("Smenani tanlang"),
  pattern: zStr("Naqshni tanlang"),
  from: zStr("Boshlanish sanasi kerak"),
  to: zStr("Tugash sanasi kerak"),
});

/** Tanlangan xodimlarga naqsh (5/2, 2/2, 1/3…) bilan to'ldirish. `ids` — vergul bilan. */
export async function fillShiftPattern(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "schedule", ["HR"]);
  const r = parseForm(patternSchema, fd);
  if ("error" in r) return { error: r.error };
  const ids = fd.getAll("emp").map(String).filter(Boolean);
  if (!ids.length) return { error: "Kamida bitta xodimni belgilang" };
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(r.data.pattern);
  if (!m) return { error: "Naqsh 5/2 ko'rinishida bo'lsin" };
  const from = validDay(r.data.from), to = validDay(r.data.to);
  if (!from || !to) return { error: "Sana noto'g'ri" };
  const res = await fillPattern({ employeeIds: ids, templateId: r.data.templateId, work: Number(m[1]), rest: Number(m[2]), startIso: from, endIso: to }, s.userId);
  if ("error" in res) return { error: res.error };
  refresh("/dashboard");
  return { ok: true, note: `${ids.length} xodimga ${r.data.pattern} grafigi qo'yildi (${res.saved} kun)` };
}

// ───────────────────────── Arizalar ─────────────────────────

export async function decideRequest(id: string, approve: boolean, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "requests", ["HR"]);
  const note = String(fd.get("note") ?? "").trim() || null;
  const r = await decideHrRequest(id, approve, note, s);
  if (r.error) return { error: r.error };
  refresh();
  return { ok: true, note: r.note };
}

const onBehalfSchema = z.object({
  employeeId: zStr("Xodimni tanlang"),
  kind: z.enum(REQUEST_KINDS as [HrRequestKind, ...HrRequestKind[]], { message: "Ariza turini tanlang" }),
  dateFrom: zOpt, dateTo: zOpt, amount: zOpt, reason: zOpt,
});

/** Otdel kadr xodim nomidan ariza kiritadi (qog'oz ariza, kasallik varaqasi keltirilgan). */
export async function createRequestForEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "requests", ["HR"]);
  const r = parseForm(onBehalfSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const res = await createHrRequest({ employeeId: d.employeeId, kind: d.kind, dateFrom: d.dateFrom, dateTo: d.dateTo, amount: d.amount ? Number(d.amount.replace(/\s/g, "")) : null, reason: d.reason }, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: `${res.docNo} kiritildi — endi tasdiqlashingiz mumkin` };
}

// ───────────────────────── Jarima va bonus qoidalari ─────────────────────────

const TRIGGERS = Object.keys(RULE_TRIGGER) as [PayRuleTrigger, ...PayRuleTrigger[]];
const ruleSchema = z.object({
  name: zStr("Qoida nomi kerak").pipe(z.string().max(80, "Nom 80 belgidan oshmasin")),
  trigger: z.enum(TRIGGERS, { message: "Nimaga qarab hisoblanishini tanlang" }),
  amount: zDec(0),
  perMinute: z.string().optional().transform((v) => v === "on"),
  graceMinutes: z.coerce.number({ message: "Imtiyoz daqiqasi raqam bo'lsin" }).int().min(0, "Imtiyoz manfiy bo'lmasin").max(240, "Imtiyoz ko'pi 240 daqiqa").default(0),
  maxPerMonth: z.preprocess((v) => (v == null || String(v).trim() === "" ? null : String(v).replace(/\s/g, "")),
    z.coerce.number({ message: "Oylik chegara raqam bo'lsin" }).min(0).max(MAX_AMOUNT).nullable()),
  position: zOpt,
  note: zOpt,
});

export async function savePayRule(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "payrules", ["HR"]);
  const r = parseForm(ruleSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (d.amount <= 0) return { error: "Summani kiriting" };
  const meta = RULE_TRIGGER[d.trigger];
  const data = {
    name: d.name, trigger: d.trigger, kind: meta.kinds[0]!, amount: Math.round(d.amount),
    perMinute: meta.perMinute && d.perMinute, graceMinutes: meta.perMinute || d.trigger === "LATE" || d.trigger === "EARLY_LEAVE" ? d.graceMinutes : 0,
    maxPerMonth: d.maxPerMonth == null ? null : Math.round(d.maxPerMonth), position: d.position, note: d.note,
  };
  await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.payRule.findUniqueOrThrow({ where: { id } });
      const after = await tx.payRule.update({ where: { id }, data });
      await audit(tx, s.userId, "UPDATE", "PayRule", id, before, after);
    } else {
      const x = await tx.payRule.create({ data: { ...data, createdById: s.userId } });
      await audit(tx, s.userId, "CREATE", "PayRule", x.id, undefined, x);
    }
  });
  refresh("/settings/davomat");
  return { ok: true, note: "Qoida saqlandi — oy yakuni hisobida qo'llanadi" };
}

export async function togglePayRule(id: string): Promise<ActionState> {
  const s = await requireAction("employees", "payrules", ["HR"]);
  const cur = await db.payRule.findUnique({ where: { id } });
  if (!cur) return { error: "Qoida topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.payRule.update({ where: { id }, data: { isActive: !cur.isActive } });
    await audit(tx, s.userId, "UPDATE", "PayRule", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  });
  refresh("/settings/davomat");
  return { ok: true };
}

const adjSchema = z.object({
  employeeId: zStr("Xodimni tanlang"),
  month: zStr("Oyni tanlang"),
  kind: z.enum(["BONUS", "PENALTY"], { message: "Turini tanlang" }),
  amount: zDec(0),
  reason: zStr("Sababini yozing").pipe(z.string().max(300, "Sabab 300 belgidan oshmasin")),
  date: zOpt,
});

/** Qo'lda jarima / bonus — shu oyning yakuniy hisobida. */
export async function addPayAdjustment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "payrules", ["HR"]);
  const r = parseForm(adjSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (!validMonth(d.month)) return { error: "Oy noto'g'ri" };
  if (d.amount <= 0) return { error: "Summani kiriting" };
  const closed = await db.payrollRun.findFirst({ where: { month: d.month, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { docNo: true } });
  if (closed) return { error: `${d.month} oyining yakuniy vedomosti (${closed.docNo}) allaqachon tasdiqqa yuborilgan — keyingi oyga yozing` };
  const emp = await db.employee.findUnique({ where: { id: d.employeeId }, select: { id: true } });
  if (!emp) return { error: "Xodim topilmadi" };
  const date = d.date && validDay(d.date) ? new Date(`${d.date}T00:00:00.000Z`) : null;
  await db.$transaction(async (tx) => {
    const x = await tx.payAdjustment.create({ data: { employeeId: d.employeeId, month: d.month, kind: d.kind, amount: Math.round(d.amount), reason: d.reason, date, createdById: s.userId } });
    await audit(tx, s.userId, "CREATE", "PayAdjustment", x.id, undefined, x);
  });
  refresh();
  return { ok: true, note: `${d.kind === "BONUS" ? "Bonus" : "Jarima"} yozildi` };
}

/** Bekor qilish (o'chirilmaydi) — sababi bilan. */
export async function cancelPayAdjustment(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "payrules", ["HR"]);
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Bekor qilish sababini yozing" };
  const cur = await db.payAdjustment.findUnique({ where: { id } });
  if (!cur) return { error: "Yozuv topilmadi" };
  const closed = await db.payrollRun.findFirst({ where: { month: cur.month, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { docNo: true } });
  if (closed) return { error: `${closed.docNo} tasdiqqa yuborilgan — bu yozuv endi o'zgarmaydi` };
  const n = await db.$transaction(async (tx) => {
    const x = await tx.payAdjustment.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelReason: reason, cancelledById: s.userId } });
    if (x.count) await audit(tx, s.userId, "UPDATE", "PayAdjustment", id, { cancelledAt: null }, { cancelledAt: new Date(), cancelReason: reason });
    return x.count;
  });
  if (!n) return { error: "Yozuv allaqachon bekor qilingan" };
  refresh();
  return { ok: true, note: "Bekor qilindi" };
}
