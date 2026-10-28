"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normTime } from "@/lib/attendance-time";
import { parseForm, zOpt, type ActionState } from "@/lib/action";
import { UZ_FIXED_HOLIDAYS, dbDate, dbDateKey } from "@/lib/work-calendar";

/**
 * Otdel kadr → «Ish tartibi va bayramlar» (`lib/work-calendar.ts`). Mas'ul — otdel kadr (`employees.calendar`), direktor doim.
 * Hisobot va prognozlardagi ish kunlari shundan; davomat va ish haqiga ta'sir qilmaydi. Hammasi AuditLog'da.
 */
const writer = () => requireAction("employees", "calendar");
const refresh = () => {
  for (const p of ["/settings/ish-tartibi", "/settings", "/bi-tahlil/moliya/realizatsiya", "/bi-tahlil/reja", "/bi-tahlil", "/dashboard"]) revalidatePath(p);
};

export async function saveWorkWeekAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const restDays = [...new Set(fd.getAll("rest").map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (restDays.length >= 7) return { error: "Kamida bitta ish kuni bo'lsin" };
  const workStart = normTime(String(fd.get("workStart") ?? "")), workEnd = normTime(String(fd.get("workEnd") ?? ""));
  if (!workStart || !workEnd) return { error: "Ish boshlanishi va tugashini SS:DD ko'rinishida kiriting" };
  if (workStart === workEnd) return { error: "Ish boshlanishi va tugashi bir xil bo'lmasin" };
  const ls = String(fd.get("lunchStart") ?? "").trim(), le = String(fd.get("lunchEnd") ?? "").trim();
  const lunchStart = ls ? normTime(ls) : null, lunchEnd = le ? normTime(le) : null;
  if ((ls && !lunchStart) || (le && !lunchEnd)) return { error: "Tushlik vaqtini SS:DD ko'rinishida kiriting" };
  if (!!lunchStart !== !!lunchEnd) return { error: "Tushlikning boshlanishi va tugashini ikkalasini kiriting yoki ikkalasini bo'sh qoldiring" };
  if (lunchStart && lunchEnd && lunchStart >= lunchEnd) return { error: "Tushlik tugashi boshlanishidan keyin bo'lsin" };
  const data = { restDays, workStart, workEnd, lunchStart, lunchEnd };
  await db.$transaction(async (tx) => {
    const before = await tx.companySettings.findUnique({ where: { id: "main" }, select: { restDays: true, workStart: true, workEnd: true, lunchStart: true, lunchEnd: true } });
    await tx.companySettings.upsert({ where: { id: "main" }, update: data, create: { id: "main", ...data } });
    await audit(tx, s.userId, "UPDATE", "CompanySettings", "main:ish-tartibi", before ?? undefined, data);
  });
  refresh();
  return { ok: true };
}

const daySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sanani tanlang"),
  kind: z.enum(["HOLIDAY", "WORKDAY"], { message: "Turini tanlang" }),
  name: zOpt,
});

export async function saveCalendarDayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(daySchema, fd);
  if ("error" in r) return { error: r.error };
  const { date, kind, name } = r.data;
  const y = Number(date.slice(0, 4));
  if (y < 2020 || y > 2100) return { error: "Sana noto'g'ri" };
  await db.$transaction(async (tx) => {
    const before = await tx.workCalendarDay.findUnique({ where: { date: dbDate(date) } });
    const after = await tx.workCalendarDay.upsert({ where: { date: dbDate(date) }, update: { kind, name }, create: { date: dbDate(date), kind, name } });
    await audit(tx, s.userId, before ? "UPDATE" : "CREATE", "WorkCalendarDay", after.id, before ?? undefined, after);
  });
  refresh();
  return { ok: true };
}

export async function deleteCalendarDayAction(fd: FormData): Promise<void> {
  const s = await writer();
  const id = String(fd.get("id") ?? "");
  const before = await db.workCalendarDay.findUnique({ where: { id } });
  if (!before) return;
  await db.$transaction(async (tx) => {
    await tx.workCalendarDay.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "WorkCalendarDay", id, before, undefined);
  });
  refresh();
}

/** Yil uchun sanasi o'zgarmaydigan bayramlar; mavjud sanalarga tegmaydi. */
export async function addUzHolidaysAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const year = Number(fd.get("year"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return { error: "Yil noto'g'ri" };
  const existing = new Set((await db.workCalendarDay.findMany({ where: { date: { gte: dbDate(`${year}-01-01`), lte: dbDate(`${year}-12-31`) } }, select: { date: true } })).map((d) => dbDateKey(d.date)));
  const add = UZ_FIXED_HOLIDAYS.map((h) => ({ date: `${year}-${h.md}`, name: h.name })).filter((h) => !existing.has(h.date));
  if (add.length === 0) return { ok: true, note: "Hammasi allaqachon kiritilgan" };
  await db.$transaction(async (tx) => {
    for (const h of add) {
      const row = await tx.workCalendarDay.create({ data: { date: dbDate(h.date), kind: "HOLIDAY", name: h.name } });
      await audit(tx, s.userId, "CREATE", "WorkCalendarDay", row.id, undefined, row);
    }
  });
  refresh();
  return { ok: true, note: `${add.length} ta bayram qo'shildi. Ramazon va Qurbon hayit sanalarini qo'lda qo'shing.` };
}
