import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dayUtc, isoDay, monthDays, monthTitle, today } from "@/lib/davomat";
import { employeesInWindow } from "@/lib/attendance-report";
import { calcBrigadeSheet, type SheetLine } from "./brigade-calc";
import { tabelLock } from "./tabel-lock";
import { parseTabelValue } from "./tabel-value";

/**
 * Brigada varag'i (Ish haqi → Tabel → brigada): Excel'dagi brigada varag'ining ERP'dagi o'rni.
 *   · a'zolar × kun — shu brigadada ishlagan soat (`BrigadeHours`; bir odam bir kunda bir nechta brigadada bo'lishi mumkin);
 *   · mahsulot qatorlari × kun — soni (`BrigadeOutput`), qator narxi oy bo'yicha (`BrigadeMonth.lines`);
 *   · brak — qo'lda yozilgan summa (`BrigadeMonth.brak`) yoki brak yozuvlari (`ProductDefect`) yig'indisi.
 * Hisob — `brigade-calc.ts` (Excel formulasi). Vedomost (`lib/hr/payroll.ts`) shu yerdan oladi: varag'i to'ldirilgan
 * brigadada sdelka shu usulda, to'ldirilmaganida avvalgidek (topshiriq bajarilishi × narx, oylik soatga).
 */

export type BrigadeSheetData = {
  month: string; title: string; brigade: { id: string; name: string };
  days: { day: number; iso: string; weekend: boolean; future: boolean }[];
  members: { id: string; fullName: string; position: string; payType: string; guest: boolean; from: number; to: number }[];
  hours: Record<string, Record<number, number>>;
  lines: SheetLine[];
  qty: Record<string, Record<number, number>>;
  brakManual: number | null; brakAuto: number;
  /** Oy narxlari o'tgan oydan olingan (shu oy hali saqlanmagan) */
  inherited: boolean;
  locked: string | null;
  addable: { id: string; fullName: string; position: string }[];
};

const monthRangeUtc = (month: string) => {
  const days = monthDays(month);
  return { days, from: dayUtc(days[0]!.iso), to: dayUtc(days[days.length - 1]!.iso) };
};

function linesOf(v: Prisma.JsonValue | null | undefined): SheetLine[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) return [];
    const o = x as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const rate = Number(o.rate);
    return name ? [{ name, rate: Number.isFinite(rate) ? rate : 0, productId: typeof o.productId === "string" ? o.productId : null }] : [];
  });
}

/** Brak yozuvlari (ProductDefect) yig'indisi — oy bo'yicha, brigada. Mahalliy oy chegarasi. */
async function defectSum(brigadeIds: string[], month: string): Promise<Map<string, number>> {
  if (!brigadeIds.length) return new Map();
  const [y, m] = month.split("-").map(Number);
  const g = await db.productDefect.groupBy({ by: ["brigadeId"], where: { brigadeId: { in: brigadeIds }, date: { gte: new Date(y!, m! - 1, 1), lt: new Date(y!, m!, 1) } }, _sum: { amount: true } });
  return new Map(g.map((r) => [r.brigadeId!, Math.round(Number(r._sum.amount ?? 0))]));
}

export async function brigadeSheet(month: string, brigadeId: string): Promise<BrigadeSheetData | null> {
  const { days, from, to } = monthRangeUtc(month);
  const brigade = await db.brigade.findUnique({ where: { id: brigadeId }, select: { id: true, name: true } });
  if (!brigade) return null;
  const now = today();
  const [hoursRows, outRows, bm, prevBm, members, locked, brak] = await Promise.all([
    db.brigadeHours.findMany({ where: { brigadeId, date: { gte: from, lte: to } }, select: { employeeId: true, date: true, hours: true } }),
    db.brigadeOutput.findMany({ where: { brigadeId, date: { gte: from, lte: to } }, select: { line: true, date: true, qty: true } }),
    db.brigadeMonth.findUnique({ where: { brigadeId_month: { brigadeId, month } } }),
    db.brigadeMonth.findFirst({ where: { brigadeId, month: { lt: month } }, orderBy: { month: "desc" } }),
    db.employee.findMany({ where: { AND: [{ brigadeId }, employeesInWindow(from, to)] }, select: { id: true } }),
    tabelLock(month),
    defectSum([brigadeId], month),
  ]);
  const guestIds = [...new Set(hoursRows.map((h) => h.employeeId))].filter((id) => !members.some((m) => m.id === id));
  const emps = await db.employee.findMany({ where: { id: { in: [...members.map((m) => m.id), ...guestIds] } }, select: { id: true, fullName: true, position: true, payType: true, hiredAt: true, firedAt: true } });
  const first = days[0]!.iso, last = days[days.length - 1]!.iso;
  const memberSet = new Set(members.map((m) => m.id));
  const hours: BrigadeSheetData["hours"] = {};
  for (const h of hoursRows) (hours[h.employeeId] ??= {})[Number(isoDay(h.date).slice(8, 10))] = Number(h.hours);
  const qty: BrigadeSheetData["qty"] = {};
  for (const o of outRows) (qty[o.line] ??= {})[Number(isoDay(o.date).slice(8, 10))] = Number(o.qty);
  let lines = linesOf(bm?.lines);
  const inherited = !bm && !!prevBm;
  if (!bm && prevBm) lines = linesOf(prevBm.lines);
  // Soni bor, lekin qatorlar ro'yxatida yo'q qator (masalan, nomi o'zgargan) — yo'qolmasin
  for (const name of Object.keys(qty)) if (!lines.some((l) => l.name === name)) lines.push({ name, rate: 0, productId: null });
  const ids = new Set(emps.map((e) => e.id));
  const addable = await db.employee.findMany({ where: { AND: [employeesInWindow(from, to), { id: { notIn: [...ids] } }, { OR: [{ userId: null }, { user: { role: { notIn: ["SUPERADMIN"] } } }] }] }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } });
  return {
    month, title: monthTitle(month), brigade,
    days: days.map((d) => ({ day: d.day, iso: d.iso, weekend: d.weekend, future: d.iso > now })),
    members: emps
      .map((e) => {
        const hi = e.hiredAt ? isoDay(e.hiredAt) : first, fi = e.firedAt ? isoDay(e.firedAt) : last;
        return { id: e.id, fullName: e.fullName, position: e.position, payType: e.payType, guest: !memberSet.has(e.id), from: hi > first ? Number(hi.slice(8, 10)) : 1, to: fi < last ? Number(fi.slice(8, 10)) : days.length };
      })
      .sort((a, b) => Number(a.guest) - Number(b.guest) || a.fullName.localeCompare(b.fullName)),
    hours, lines, qty,
    brakManual: bm?.brak != null ? Number(bm.brak) : null, brakAuto: brak.get(brigadeId) ?? 0,
    inherited, locked, addable,
  };
}

// ───────────────────────── Saqlash ─────────────────────────

type Who = { userId: string };
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function guard(month: string, brigadeId: string, tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"tabel:" + month}))`;
  const locked = await tabelLock(month, tx);
  if (locked) return locked;
  if (!(await tx.brigade.findUnique({ where: { id: brigadeId }, select: { id: true } }))) return "Brigada topilmadi";
  return null;
}

/** Brigada a'zolari soati: «8», «2», bo'sh — tozalash. Kelajak kuni va ishda bo'lmagan kun yozilmaydi. */
export async function saveBrigadeHours(who: Who, month: string, brigadeId: string, items: { employeeId: string; day: number; value: string }[]) {
  if (!MONTH_RE.test(month)) return { error: "Oy noto'g'ri" };
  const { days } = monthRangeUtc(month);
  const now = today();
  const parsed: { employeeId: string; iso: string; hours: number | null }[] = [];
  for (const it of items) {
    if (!Number.isInteger(it.day) || it.day < 1 || it.day > days.length) return { error: `Kun noto'g'ri: ${it.day}` };
    const p = parseTabelValue(String(it.value ?? ""));
    if ("error" in p) return { error: p.error };
    if (p.kind === "status") return { error: "Brigada varag'ida faqat soat yoziladi (H/K/T/D — oddiy tabelda)" };
    parsed.push({ employeeId: it.employeeId, iso: days[it.day - 1]!.iso, hours: p.kind === "clear" ? null : p.hours ?? 8 });
  }
  const emps = await db.employee.findMany({ where: { id: { in: [...new Set(parsed.map((p) => p.employeeId))] } }, select: { id: true, fullName: true, hiredAt: true, firedAt: true } });
  const empOf = new Map(emps.map((e) => [e.id, e]));
  return db.$transaction(async (tx) => {
    const g = await guard(month, brigadeId, tx);
    if (g) return { error: g };
    const skipped: string[] = [];
    const changes: { xodim: string; kun: string; keyin: number | null }[] = [];
    for (const p of parsed) {
      const e = empOf.get(p.employeeId);
      if (!e) return { error: "Xodim topilmadi — sahifani yangilang" };
      if (p.iso > now) { if (p.hours != null) skipped.push(`${e.fullName}: ${p.iso} — kelajak kuni`); continue; }
      if (p.hours != null && ((e.hiredAt && p.iso < isoDay(e.hiredAt)) || (e.firedAt && p.iso > isoDay(e.firedAt)))) { skipped.push(`${e.fullName}: ${p.iso} — ishda emas`); continue; }
      const key = { brigadeId_employeeId_date: { brigadeId, employeeId: p.employeeId, date: dayUtc(p.iso) } };
      if (p.hours == null) await tx.brigadeHours.deleteMany({ where: { brigadeId, employeeId: p.employeeId, date: dayUtc(p.iso) } });
      else await tx.brigadeHours.upsert({ where: key, create: { brigadeId, employeeId: p.employeeId, date: dayUtc(p.iso), hours: p.hours }, update: { hours: p.hours } });
      changes.push({ xodim: e.fullName, kun: p.iso, keyin: p.hours });
    }
    if (changes.length) await audit(tx, who.userId, "UPDATE", "BrigadeSheet", `${brigadeId}:${month}`, undefined, { soat: changes.slice(0, 2000), jami: changes.length });
    return { saved: changes.length, skipped: skipped.slice(0, 50) };
  });
}

/** Kunlik ishlab chiqarish soni (qator nomi bo'yicha). */
export async function saveBrigadeOutput(who: Who, month: string, brigadeId: string, items: { line: string; day: number; value: string }[]) {
  if (!MONTH_RE.test(month)) return { error: "Oy noto'g'ri" };
  const { days } = monthRangeUtc(month);
  const now = today();
  const parsed: { line: string; iso: string; qty: number | null }[] = [];
  for (const it of items) {
    if (!Number.isInteger(it.day) || it.day < 1 || it.day > days.length) return { error: `Kun noto'g'ri: ${it.day}` };
    const line = String(it.line ?? "").trim().slice(0, 80);
    if (!line) return { error: "Qator nomi bo'sh" };
    const t = String(it.value ?? "").trim().replace(/\s+/g, "").replace(",", ".");
    const q = t === "" || t === "-" ? null : Number(t);
    if (q != null && (!Number.isFinite(q) || q < 0 || q > 1e7)) return { error: `«${it.value}» — son yozing` };
    parsed.push({ line, iso: days[it.day - 1]!.iso, qty: q == null || q === 0 ? null : Math.round(q * 1000) / 1000 });
  }
  return db.$transaction(async (tx) => {
    const g = await guard(month, brigadeId, tx);
    if (g) return { error: g };
    let saved = 0;
    const skipped: string[] = [];
    for (const p of parsed) {
      if (p.iso > now) { if (p.qty != null) skipped.push(`${p.iso} — kelajak kuni`); continue; }
      if (p.qty == null) await tx.brigadeOutput.deleteMany({ where: { brigadeId, line: p.line, date: dayUtc(p.iso) } });
      else await tx.brigadeOutput.upsert({ where: { brigadeId_date_line: { brigadeId, date: dayUtc(p.iso), line: p.line } }, create: { brigadeId, date: dayUtc(p.iso), line: p.line, qty: p.qty }, update: { qty: p.qty } });
      saved++;
    }
    if (saved) await audit(tx, who.userId, "UPDATE", "BrigadeSheet", `${brigadeId}:${month}`, undefined, { soni: parsed.slice(0, 2000), jami: saved });
    return { saved, skipped: [...new Set(skipped)].slice(0, 20) };
  });
}

/** Oy qatorlari (nomi, narxi) va qo'lda brak summasi. Qator nomi o'zgarsa — shu oydagi soni ham yangi nomga o'tadi. */
export async function saveBrigadeMonth(who: Who, month: string, brigadeId: string, input: { lines: { name: string; rate: number; productId?: string | null; was?: string }[]; brak: number | null }) {
  if (!MONTH_RE.test(month)) return { error: "Oy noto'g'ri" };
  // Narx Excel aniqligida (79 545,454…) — 6 xonagacha, aks holda 10 000 ga yaxlitlashda chegarada farq chiqishi mumkin
  const lines = input.lines.map((l) => ({ name: String(l.name ?? "").trim().slice(0, 80), rate: Math.round(Number(l.rate) * 1e6) / 1e6, productId: l.productId ?? null, was: l.was?.trim() }));
  if (lines.some((l) => !l.name)) return { error: "Qator nomini yozing" };
  if (lines.some((l) => !Number.isFinite(l.rate) || l.rate < 0)) return { error: "Narx noto'g'ri" };
  if (new Set(lines.map((l) => l.name.toLowerCase())).size !== lines.length) return { error: "Bir xil nomli ikki qator bo'lmasin" };
  if (input.brak != null && (!Number.isFinite(input.brak) || input.brak < 0)) return { error: "Brak summasi noto'g'ri" };
  const { from, to } = monthRangeUtc(month);
  return db.$transaction(async (tx) => {
    const g = await guard(month, brigadeId, tx);
    if (g) return { error: g };
    const before = await tx.brigadeMonth.findUnique({ where: { brigadeId_month: { brigadeId, month } } });
    for (const l of lines) if (l.was && l.was !== l.name) {
      await tx.brigadeOutput.updateMany({ where: { brigadeId, line: l.was, date: { gte: from, lte: to } }, data: { line: l.name } });
    }
    const removed = linesOf(before?.lines).filter((o) => !lines.some((l) => l.name === o.name || l.was === o.name));
    if (removed.length) {
      const used = await tx.brigadeOutput.count({ where: { brigadeId, line: { in: removed.map((r) => r.name) }, date: { gte: from, lte: to } } });
      if (used) return { error: `«${removed.map((r) => r.name).join("», «")}» qatorida shu oy soni bor — avval sonlarini tozalang` };
    }
    const data = { lines: lines.map(({ name, rate, productId }) => ({ name, rate, productId })) as Prisma.InputJsonValue, brak: input.brak };
    await tx.brigadeMonth.upsert({ where: { brigadeId_month: { brigadeId, month } }, create: { brigadeId, month, ...data }, update: data });
    await audit(tx, who.userId, before ? "UPDATE" : "CREATE", "BrigadeMonth", `${brigadeId}:${month}`, before ? { lines: before.lines, brak: before.brak } : undefined, { lines: data.lines, brak: input.brak });
    return { ok: true as const };
  });
}

// ───────────────────────── Vedomost uchun ─────────────────────────

export type SheetPayItem = { brigadeId: string; brigade: string; hours: number; amount: number; brak: number };

/**
 * Varag'i to'ldirilgan brigadalar bo'yicha har xodimning sdelka puli (oy boshidan `toIso` gacha).
 * `round` — oy yakunida 10 000 ga yaxlitlanadi (Excel kabi); avansda yo'q, brak ham faqat yakunda.
 */
export async function brigadeSheetPay(month: string, toIso: string, opts: { final: boolean }): Promise<{ brigades: Set<string>; byEmp: Map<string, SheetPayItem[]> }> {
  const { days, from } = monthRangeUtc(month);
  const to = dayUtc(toIso);
  const [hoursRows, outRows, months] = await Promise.all([
    db.brigadeHours.findMany({ where: { date: { gte: from, lte: to } }, select: { brigadeId: true, employeeId: true, date: true, hours: true } }),
    db.brigadeOutput.findMany({ where: { date: { gte: from, lte: to } }, select: { brigadeId: true, line: true, date: true, qty: true } }),
    db.brigadeMonth.findMany({ where: { month }, select: { brigadeId: true, lines: true, brak: true } }),
  ]);
  const brigades = new Set([...hoursRows.map((h) => h.brigadeId), ...outRows.map((o) => o.brigadeId), ...months.map((m) => m.brigadeId)]);
  const byEmp = new Map<string, SheetPayItem[]>();
  if (!brigades.size) return { brigades, byEmp };
  const [names, defects] = await Promise.all([
    db.brigade.findMany({ where: { id: { in: [...brigades] } }, select: { id: true, name: true } }),
    opts.final ? defectSum([...brigades], month) : Promise.resolve(new Map<string, number>()),
  ]);
  const nameOf = new Map(names.map((b) => [b.id, b.name]));
  const prevLines = new Map<string, SheetLine[]>();
  const missing = [...brigades].filter((b) => !months.some((m) => m.brigadeId === b));
  if (missing.length) {
    const prev = await db.brigadeMonth.findMany({ where: { brigadeId: { in: missing }, month: { lt: month } }, orderBy: { month: "desc" }, select: { brigadeId: true, lines: true } });
    for (const p of prev) if (!prevLines.has(p.brigadeId)) prevLines.set(p.brigadeId, linesOf(p.lines));
  }
  const nDays = days.length;
  const dayIdx = (d: Date) => Number(isoDay(d).slice(8, 10)) - 1;
  for (const bid of brigades) {
    const bm = months.find((m) => m.brigadeId === bid);
    const lines = bm ? linesOf(bm.lines) : prevLines.get(bid) ?? [];
    const qtyByLine = new Map<string, (number | null)[]>();
    for (const o of outRows) if (o.brigadeId === bid) {
      const arr = qtyByLine.get(o.line) ?? Array<number | null>(nDays).fill(null);
      arr[dayIdx(o.date)] = Number(o.qty);
      qtyByLine.set(o.line, arr);
    }
    const hours: Record<string, (number | null)[]> = {};
    for (const h of hoursRows) if (h.brigadeId === bid) (hours[h.employeeId] ??= Array<number | null>(nDays).fill(null))[dayIdx(h.date)] = Number(h.hours);
    const brak = opts.final ? (bm?.brak != null ? Number(bm.brak) : defects.get(bid) ?? 0) : 0;
    const c = calcBrigadeSheet({ days: nDays, hours, lines: lines.map((l) => ({ ...l, qty: qtyByLine.get(l.name) ?? [] })), brak, round: opts.final });
    for (const [emp, r] of Object.entries(c.emp)) {
      if (!r.amount && !r.brak) continue;
      const list = byEmp.get(emp) ?? [];
      list.push({ brigadeId: bid, brigade: nameOf.get(bid) ?? "Brigada", hours: r.hours, amount: r.amount, brak: r.brak });
      byEmp.set(emp, list);
    }
  }
  return { brigades, byEmp };
}
