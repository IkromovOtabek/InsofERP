import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dayUtc, isoDay, monthDays, today } from "@/lib/davomat";
import { nowHHMM } from "@/lib/production-staff";

/**
 * Kundalik cheklistlar — har lavozimga har kungi majburiyatlar (masalan sklad: "qoldiq tekshirildi", "kalit topshirildi").
 * Shablon (`ChecklistTemplate`) lavozim bo'yicha (bo'sh — hamma uchun); xodim har kuni o'z ro'yxatini belgilaydi
 * (`ChecklistRun`, kun + xodim + shablon — bitta yozuv). Bajarilganlik KPI'ga (CHECKLIST) va kadr hisobotiga tushadi.
 */

export type ChecklistItem = { key: string; label: string };
export const itemsOf = (v: unknown): ChecklistItem[] =>
  Array.isArray(v) ? v.filter((x): x is ChecklistItem => !!x && typeof x.key === "string" && typeof x.label === "string") : [];
const doneOf = (v: unknown): Record<string, string> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {});
const fits = (pos: string | null, employeePos: string) => !pos || pos.trim().toLowerCase() === employeePos.trim().toLowerCase();

/** Matn qatorlari → bandlar; mavjud bandlarning kaliti matni bo'yicha saqlanadi (bajarilganlar yo'qolmasin). */
export function itemsFromText(text: string, prev: ChecklistItem[] = []): ChecklistItem[] {
  const byLabel = new Map(prev.map((i) => [i.label.trim().toLowerCase(), i.key]));
  const used = new Set<string>();
  let n = prev.reduce((m, i) => Math.max(m, Number(i.key.replace(/\D/g, "")) || 0), 0);
  return text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 40).map((label) => {
    let key = byLabel.get(label.toLowerCase());
    if (!key || used.has(key)) key = `b${++n}`;
    used.add(key);
    return { key, label: label.slice(0, 200) };
  });
}

export async function saveTemplate(id: string | null, input: { name: string; position: string | null; text: string }, userId: string) {
  const name = input.name.trim().slice(0, 100);
  if (!name) return { error: "Cheklist nomi kerak" };
  const prev = id ? await db.checklistTemplate.findUnique({ where: { id } }) : null;
  if (id && !prev) return { error: "Cheklist topilmadi" };
  const items = itemsFromText(input.text, prev ? itemsOf(prev.items) : []);
  if (!items.length) return { error: "Kamida bitta band yozing (har qatorga bittadan)" };
  await db.$transaction(async (tx) => {
    if (prev) {
      const after = await tx.checklistTemplate.update({ where: { id: prev.id }, data: { name, position: input.position, items } });
      await audit(tx, userId, "UPDATE", "ChecklistTemplate", prev.id, prev, after);
    } else {
      const last = await tx.checklistTemplate.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      const x = await tx.checklistTemplate.create({ data: { name, position: input.position, items, sortOrder: (last?.sortOrder ?? 0) + 10, createdById: userId } });
      await audit(tx, userId, "CREATE", "ChecklistTemplate", x.id, undefined, x);
    }
  });
  return { ok: true as const };
}

export async function toggleTemplate(id: string, userId: string) {
  const cur = await db.checklistTemplate.findUnique({ where: { id } });
  if (!cur) return { error: "Cheklist topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.checklistTemplate.update({ where: { id }, data: { isActive: !cur.isActive } });
    await audit(tx, userId, "UPDATE", "ChecklistTemplate", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  });
  return { ok: true as const };
}

export type MyChecklist = { templateId: string; name: string; items: (ChecklistItem & { done: string | null })[]; doneCount: number; total: number };

/** Xodimning shu kungi cheklistlari (shablon + belgilanganlari). */
export async function myChecklists(employee: { id: string; position: string }, iso = today()): Promise<MyChecklist[]> {
  const [tpls, runs] = await Promise.all([
    db.checklistTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.checklistRun.findMany({ where: { employeeId: employee.id, date: dayUtc(iso) } }),
  ]);
  const runBy = new Map(runs.map((r) => [r.templateId, doneOf(r.done)]));
  return tpls.filter((t) => fits(t.position, employee.position)).map((t) => {
    const done = runBy.get(t.id) ?? {};
    const items = itemsOf(t.items).map((i) => ({ ...i, done: done[i.key] ?? null }));
    return { templateId: t.id, name: t.name, items, doneCount: items.filter((i) => i.done).length, total: items.length };
  }).filter((c) => c.total > 0);
}

/**
 * Belgilash: `checked` — shu shablondagi belgilangan kalitlar (to'liq ro'yxat). Faqat bugun uchun (o'tgan kunni
 * keyin to'ldirib bo'lmaydi — cheklist kunlik nazorat). Avval belgilangan vaqt saqlanadi.
 */
export async function saveMyChecklist(employee: { id: string; position: string }, templateId: string, checked: string[], userId: string) {
  const t = await db.checklistTemplate.findUnique({ where: { id: templateId } });
  if (!t || !t.isActive || !fits(t.position, employee.position)) return { error: "Bu cheklist sizga tegishli emas" };
  const items = itemsOf(t.items);
  const keys = new Set(items.map((i) => i.key));
  const date = dayUtc(today());
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"checklist:" + employee.id + templateId}))`;
    const cur = await tx.checklistRun.findUnique({ where: { templateId_employeeId_date: { templateId, employeeId: employee.id, date } } });
    const prev = doneOf(cur?.done);
    const now = nowHHMM();
    const done: Record<string, string> = {};
    for (const k of checked) if (keys.has(k)) done[k] = prev[k] ?? now;
    const doneCount = Object.keys(done).length;
    const data = { done: done as Prisma.InputJsonValue, total: items.length, doneCount, completedAt: doneCount === items.length ? cur?.completedAt ?? new Date() : null };
    await tx.checklistRun.upsert({ where: { templateId_employeeId_date: { templateId, employeeId: employee.id, date } }, create: { templateId, employeeId: employee.id, date, ...data }, update: data });
    await audit(tx, userId, "UPDATE", "ChecklistRun", `${templateId}:${employee.id}`, { done: prev }, { done, sana: today() });
    return { ok: true as const, note: `${doneCount} / ${items.length} bajarildi` };
  });
}

/** Kadr ko'rinishi: kun bo'yicha kim nechta band bajargan. */
export async function checklistDay(iso: string) {
  const [tpls, emps, runs] = await Promise.all([
    db.checklistTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } }),
    db.checklistRun.findMany({ where: { date: dayUtc(iso) } }),
  ]);
  const runBy = new Map(runs.map((r) => [`${r.employeeId}|${r.templateId}`, r]));
  return emps.flatMap((e) => tpls.filter((t) => fits(t.position, e.position)).map((t) => {
    const r = runBy.get(`${e.id}|${t.id}`);
    return { employee: e, template: { id: t.id, name: t.name }, total: itemsOf(t.items).length, doneCount: r?.doneCount ?? 0, completedAt: r?.completedAt ?? null };
  })).filter((x) => x.total > 0);
}

/** KPI (CHECKLIST): oy ish kunlarida (shu kungacha) bajarilgan bandlar ulushi, %. */
export async function checklistPct(employees: { id: string; position: string }[], month: string, workDays: (employeeId: string) => string[]): Promise<Map<string, number | null>> {
  const days = monthDays(month);
  const from = dayUtc(days[0]!.iso), to = dayUtc(days[days.length - 1]!.iso);
  const [tpls, runs] = await Promise.all([
    db.checklistTemplate.findMany({ where: { isActive: true } }),
    db.checklistRun.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: from, lte: to } }, select: { employeeId: true, date: true, doneCount: true } }),
  ]);
  const now = today();
  const out = new Map<string, number | null>();
  for (const e of employees) {
    const perDay = tpls.filter((t) => fits(t.position, e.position)).reduce((s, t) => s + itemsOf(t.items).length, 0);
    const wd = workDays(e.id).filter((d) => d <= now);
    if (!perDay || !wd.length) { out.set(e.id, null); continue; }
    const set = new Set(wd);
    const done = runs.filter((r) => r.employeeId === e.id && set.has(isoDay(r.date))).reduce((s, r) => s + r.doneCount, 0);
    out.set(e.id, Math.round((done / (perDay * wd.length)) * 1000) / 10);
  }
  return out;
}
