import type { AttendanceStatus, PayType, Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dayUtc, isoDay, monthDays, monthTitle, today, workedMinutes } from "@/lib/davomat";
import { employeesInWindow } from "@/lib/attendance-report";
import { normDaysOf, plansInRange } from "./shifts";
import { payrollSettings } from "./payroll";
import { toLatin } from "@/lib/translit";
import { parseWorkbook } from "@/lib/payroll-sheets";
import { colName } from "@/lib/sheet-calc";
import { TABEL_CODE_OF, TABEL_MAX_HOURS, parseTabelValue, type TabelParsed } from "./tabel-value";

export { parseTabelValue };

/**
 * Tabel (Ish haqi → Tabel): Excel tabeli kabi — guruh (brigada, komanda, bo'linma), qatorda xodim, ustunda 1..31 kun,
 * katakda soat (8, 4, 2…) yoki holat harfi (H — kelmadi, K — kasal, T — ta'til, D — dam olish).
 * Soat `Attendance.hours` ga yoziladi; ish haqida oklad/kunbay kuni = soat ÷ kunlik soat (`lib/hr/payroll.ts`).
 * Face ID / kelish-ketish vaqti bilan belgilangan kun — soat vaqtdan ko'rinadi, qo'lda yozilsa ustidan yoziladi.
 * Oy yakuni vedomosti direktorga yuborilgach (yoki tasdiqlangach) shu oy tabeli yopiladi.
 */

const CODE_OF = TABEL_CODE_OF;
const MAX_HOURS = TABEL_MAX_HOURS;

export type TabelGroup = { key: string; label: string; count: number };
export type TabelCell = { v: string; auto?: boolean; face?: boolean };
export type TabelRow = {
  id: string; fullName: string; position: string; payType: PayType; rate: number; normDays: number;
  /** Ishga kirgan/bo'shagan kun chegarasi — undan tashqari kunlar yopiq. */
  from: number; to: number;
  cells: Record<number, TabelCell>;
};
export type TabelMonth = {
  month: string; title: string; hoursPerDay: number;
  days: { day: number; iso: string; weekend: boolean; future: boolean }[];
  groups: TabelGroup[]; group: string; rows: TabelRow[];
  locked: string | null;
};

const DRIVER_RE = /haydovchi|shofyor|шофер|водител/i;

type Emp = { id: string; fullName: string; position: string; payType: PayType; subdivision: string | null; brigadeId: string | null; teamId: string | null; brigade: { name: string } | null; team: { name: string } | null };
const PAY_GROUP: Record<PayType, string> = { SALARY: "Oklad (AUP)", DAILY: "Kunbay", HOURLY: "Soatbay", PIECE: "Sdelka" };

/** Xodim guruhi: brigada → komanda → shofyor → bo'linma → ish haqi turi (Excel'dagi varaqlar kabi). */
function groupOf(e: Emp): { key: string; label: string } {
  if (e.brigadeId && e.brigade) return { key: `b:${e.brigadeId}`, label: e.brigade.name };
  if (e.teamId && e.team) return { key: `t:${e.teamId}`, label: e.team.name };
  if (DRIVER_RE.test(e.position)) return { key: "drivers", label: "Shofyorlar" };
  if (e.subdivision?.trim()) return { key: `s:${e.subdivision.trim()}`, label: e.subdivision.trim() };
  return { key: `p:${e.payType}`, label: PAY_GROUP[e.payType] };
}

/** Oy tabeli yopiqmi — yakuniy vedomost direktorga yuborilgan / tasdiqlangan / to'langan. */
export async function tabelLock(month: string, tx: Prisma.TransactionClient | typeof db = db): Promise<string | null> {
  const run = await tx.payrollRun.findFirst({ where: { month, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { docNo: true, status: true } });
  if (!run) return null;
  return `${run.docNo} ${run.status === "SUBMITTED" ? "direktor tasdig'ida" : "tasdiqlangan"} — tabel yopiq. O'zgartirish uchun vedomost qoralamaga qaytarilsin`;
}

const fmtH = (n: number) => String(Math.round(n * 100) / 100);

export async function tabelMonth(month: string, group?: string): Promise<TabelMonth> {
  const days = monthDays(month);
  const from = dayUtc(days[0]!.iso), to = dayUtc(days[days.length - 1]!.iso);
  const now = today();
  const [st, emps, locked] = await Promise.all([
    payrollSettings(),
    db.employee.findMany({
      where: { AND: [employeesInWindow(from, to), { OR: [{ userId: null }, { user: { role: { notIn: ["SUPERADMIN"] } } }] }] },
      orderBy: [{ fullName: "asc" }],
      select: { id: true, fullName: true, position: true, payType: true, tariffRate: true, subdivision: true, brigadeId: true, teamId: true, brigade: { select: { name: true } }, team: { select: { name: true } }, hiredAt: true, firedAt: true, workSchedule: true },
    }),
    tabelLock(month),
  ]);
  const counts = new Map<string, TabelGroup>();
  for (const e of emps) {
    const g = groupOf(e);
    const cur = counts.get(g.key) ?? { key: g.key, label: g.label, count: 0 };
    cur.count++;
    counts.set(g.key, cur);
  }
  const order = (k: string) => (k.startsWith("p:SALARY") ? 0 : k.startsWith("s:") ? 1 : k.startsWith("p:") ? 2 : k.startsWith("t:") ? 3 : k.startsWith("b:") ? 4 : 5);
  const groups = [...counts.values()].sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label));
  groups.push({ key: "all", label: "Barchasi", count: emps.length });
  const g = groups.some((x) => x.key === group) ? group! : groups[0]?.key ?? "all";
  const mine = g === "all" ? emps : emps.filter((e) => groupOf(e).key === g);

  const [att, plans] = await Promise.all([
    db.attendance.findMany({ where: { employeeId: { in: mine.map((e) => e.id) }, date: { gte: from, lte: to } }, select: { employeeId: true, date: true, status: true, hours: true, checkIn: true, checkOut: true, source: true, faceVerifiedAt: true } }),
    plansInRange(mine, days[0]!.iso, days[days.length - 1]!.iso),
  ]);
  const byEmp = new Map<string, typeof att>();
  for (const a of att) byEmp.set(a.employeeId, [...(byEmp.get(a.employeeId) ?? []), a]);
  const first = days[0]!.iso, last = days[days.length - 1]!.iso;
  const rows: TabelRow[] = mine.map((e) => {
    const cells: Record<number, TabelCell> = {};
    for (const a of byEmp.get(e.id) ?? []) {
      const day = Number(isoDay(a.date).slice(8, 10));
      const face = !!a.source || !!a.faceVerifiedAt;
      if (a.status === "PRESENT") {
        if (a.hours != null) cells[day] = { v: fmtH(Number(a.hours)), face };
        else {
          const m = workedMinutes(a.checkIn, a.checkOut);
          cells[day] = { v: m != null ? fmtH(Math.round((m / 60) * 4) / 4) : "+", auto: true, face };
        }
      } else cells[day] = { v: CODE_OF[a.status] ?? "", face };
    }
    const hi = e.hiredAt ? isoDay(e.hiredAt) : first, fi = e.firedAt ? isoDay(e.firedAt) : last;
    return {
      id: e.id, fullName: e.fullName, position: e.position, payType: e.payType, rate: Number(e.tariffRate ?? 0),
      normDays: normDaysOf(plans.get(e.id)!, month),
      from: hi > first ? Number(hi.slice(8, 10)) : 1, to: fi < last ? Number(fi.slice(8, 10)) : days.length,
      cells,
    };
  });
  return {
    month, title: monthTitle(month), hoursPerDay: Number(st.hoursPerDay) || 8,
    days: days.map((d) => ({ day: d.day, iso: d.iso, weekend: d.weekend, future: d.iso > now })),
    groups, group: g, rows, locked,
  };
}

// ───────────────────────── Saqlash ─────────────────────────

export type TabelItem = { employeeId: string; day: number; value: string };
type Parsed = TabelParsed;

type Who = { userId: string };

/**
 * Tabel kataklarini yozish (jadvaldan, nusxa joylashdan yoki Excel importidan). Kelajak kuniga, ishga kirishdan oldingi /
 * bo'shagandan keyingi kunga yozilmaydi; yopiq oyga umuman. Yuz bilan tasdiqlangan yozuv o'chirilmaydi — faqat soati
 * tozalanadi. Audit: bitta yozuvda har o'zgargan katak (oldin/keyin).
 */
export async function saveTabel(who: Who, month: string, items: TabelItem[], opts: { source?: string } = {}): Promise<{ error?: string; saved: number; skipped: string[] }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "Oy noto'g'ri", saved: 0, skipped: [] };
  if (!items.length) return { saved: 0, skipped: [] };
  if (items.length > 20000) return { error: "Bir martada juda ko'p katak", saved: 0, skipped: [] };
  const days = monthDays(month);
  const now = today();
  const parsed: { it: TabelItem; p: Parsed; iso: string }[] = [];
  for (const it of items) {
    if (!Number.isInteger(it.day) || it.day < 1 || it.day > days.length) return { error: `Kun noto'g'ri: ${it.day}`, saved: 0, skipped: [] };
    const p = parseTabelValue(String(it.value ?? ""));
    if ("error" in p) return { error: p.error, saved: 0, skipped: [] };
    parsed.push({ it, p, iso: days[it.day - 1]!.iso });
  }
  const ids = [...new Set(items.map((x) => x.employeeId))];
  const emps = await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, hiredAt: true, firedAt: true } });
  const empOf = new Map(emps.map((e) => [e.id, e]));
  if (emps.length !== ids.length) return { error: "Ro'yxatdagi xodim topilmadi — sahifani yangilang", saved: 0, skipped: [] };
  const st = await payrollSettings();
  const perDay = Number(st.hoursPerDay) || 8;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"tabel:" + month}))`;
    const locked = await tabelLock(month, tx);
    if (locked) return { error: locked, saved: 0, skipped: [] };
    const cur = await tx.attendance.findMany({
      where: { employeeId: { in: ids }, date: { gte: dayUtc(days[0]!.iso), lte: dayUtc(days[days.length - 1]!.iso) } },
      select: { id: true, employeeId: true, date: true, status: true, hours: true, checkIn: true, checkOut: true, source: true, faceVerifiedAt: true },
    });
    const curOf = new Map(cur.map((a) => [`${a.employeeId}|${isoDay(a.date)}`, a]));
    const skipped = new Set<string>();
    const changes: { xodim: string; kun: string; oldin: string; keyin: string }[] = [];
    const snap = (a?: { status: AttendanceStatus; hours: Prisma.Decimal | null; checkIn: string | null } | null) =>
      !a ? "—" : a.status === "PRESENT" ? (a.hours != null ? `${Number(a.hours)} soat` : a.checkIn ? `keldi ${a.checkIn}` : "keldi") : (CODE_OF[a.status] ?? a.status);
    let saved = 0;
    for (const { it, p, iso } of parsed) {
      const e = empOf.get(it.employeeId)!;
      if (iso > now) { skipped.add(`${e.fullName}: ${iso} — kelajak kuni`); continue; }
      if ((e.hiredAt && iso < isoDay(e.hiredAt)) || (e.firedAt && iso > isoDay(e.firedAt))) {
        if (p.kind !== "clear") skipped.add(`${e.fullName}: ${iso} — ishda emas`);
        continue;
      }
      const a = curOf.get(`${it.employeeId}|${iso}`);
      const verified = !!a && (!!a.source || !!a.faceVerifiedAt);
      const before = snap(a);
      if (p.kind === "clear") {
        if (!a) continue;
        if (verified || a.checkIn) {
          if (a.hours == null) continue;
          await tx.attendance.update({ where: { id: a.id }, data: { hours: null, markedById: who.userId } });
        } else await tx.attendance.delete({ where: { id: a.id } });
      } else if (p.kind === "status") {
        if (a?.status === p.status && a.hours == null) continue;
        const data = { status: p.status, hours: null, checkIn: null, checkOut: null, lateMinutes: null, markedById: who.userId, ...(verified ? { source: null, faceVerifiedAt: null } : {}) };
        if (a) await tx.attendance.update({ where: { id: a.id }, data });
        else await tx.attendance.create({ data: { employeeId: it.employeeId, date: dayUtc(iso), ...data } });
      } else {
        const hours = p.hours ?? perDay; // «+» — to'liq kun
        if (a?.status === "PRESENT" && a.hours != null && Number(a.hours) === hours) continue;
        if (a) await tx.attendance.update({ where: { id: a.id }, data: { status: "PRESENT", hours, markedById: who.userId } });
        else await tx.attendance.create({ data: { employeeId: it.employeeId, date: dayUtc(iso), status: "PRESENT", hours, markedById: who.userId } });
      }
      saved++;
      const after = p.kind === "clear" ? (verified || a?.checkIn ? snap({ ...a!, hours: null }) : "—") : p.kind === "status" ? CODE_OF[p.status]! : `${p.hours ?? perDay} soat`;
      changes.push({ xodim: e.fullName, kun: iso, oldin: before, keyin: after });
    }
    if (changes.length) await audit(tx, who.userId, "UPDATE", "Tabel", month, undefined, { manba: opts.source ?? "jadval", ozgarishlar: changes.slice(0, 2000), jami: changes.length });
    return { saved, skipped: [...skipped].slice(0, 50) };
  }, { timeout: 60_000 });
}

// ───────────────────────── Excel importi ─────────────────────────

/** Ism → solishtirish kaliti: lotin, kichik harf, apostroflar bir xil, bo'shliq bitta. */
export function nameKey(name: string): string {
  return toLatin(name).toLowerCase().replace(/[ʻʼ‘’`´]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

export type ImportPerson = {
  key: string; name: string; sheets: string[]; hours: (number | null)[]; total: number;
  /** Bir kunda eng ko'p soat (bir nechta varaqdan qo'shilgan) — 12 dan oshsa tekshirish kerak. */
  maxDay: number;
  match: { employeeId: string; how: "alias" | "aynan" | "o'xshash" } | null;
  candidates: { id: string; fullName: string; position: string }[];
};
export type ImportPreview = { month: string; days: number; sheets: { name: string; people: number }[]; people: ImportPerson[]; warnings: string[] };

const HEADER_RE = /^(ф\.?\s*и\.?\s*о\.?|f\.?\s*i\.?\s*o\.?|фамилия.*|xodim|исм.*)$/i;
const STOP_RE = /^(итого|жами|jami|всего|сони|сумма|бригада|bригада)/i;

/** Excel kitobidan tabel bloklari: «Ф.И.О.» sarlavhasi va undan o'ngda 1..31 kun ustunlari bor varaqlar. */
export function extractTabel(buf: Buffer, month: string): { sheets: { name: string; rows: { name: string; hours: (number | null)[] }[] }[]; warnings: string[] } {
  const nDays = monthDays(month).length;
  const out: { name: string; rows: { name: string; hours: (number | null)[] }[] }[] = [];
  const warnings: string[] = [];
  for (const sh of parseWorkbook(buf)) {
    const cells = sh.data.cells;
    const at = (r: number, c: number) => cells[`${colName(c)}${r + 1}`]?.v;
    // Sarlavha qatori: «Ф.И.О.» katagi + shu qatorda ketma-ket 1, 2, 3 … (kamida 28)
    let head: { r: number; nameC: number; d1: number } | null = null;
    for (let r = 0; r < Math.min(sh.data.nr, 40) && !head; r++) {
      for (let c = 0; c < Math.min(sh.data.nc, 10); c++) {
        const v = at(r, c);
        if (typeof v !== "string" || !HEADER_RE.test(v.trim())) continue;
        for (let d = c + 1; d < Math.min(sh.data.nc, c + 8); d++) {
          let k = 0;
          while (k < 31 && Number(at(r, d + k)) === k + 1) k++;
          if (k >= 28) { head = { r, nameC: c, d1: d }; break; }
        }
        if (head) break;
      }
    }
    if (!head) continue;
    const rows: { name: string; hours: (number | null)[] }[] = [];
    let empty = 0;
    for (let r = head.r + 1; r < sh.data.nr; r++) {
      const raw = at(r, head.nameC);
      const name = typeof raw === "string" ? raw.trim() : "";
      if (!name) { if (++empty >= 3) break; continue; }
      empty = 0;
      if (STOP_RE.test(name)) break;
      if (/^\d+([.,]\d+)?$/.test(name)) continue;
      const hours: (number | null)[] = [];
      for (let k = 0; k < nDays; k++) {
        const v = at(r, head.d1 + k);
        const n = typeof v === "number" ? v : typeof v === "string" && /^\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(",", ".")) : null;
        hours.push(n != null && n > 0 ? Math.min(MAX_HOURS, Math.round(n * 100) / 100) : null);
      }
      if (hours.some((h) => h != null)) rows.push({ name, hours });
    }
    if (rows.length) out.push({ name: sh.name.trim(), rows });
  }
  if (!out.length) warnings.push("Faylda tabel varag'i topilmadi — «Ф.И.О.» sarlavhasi va 1..31 kun ustunlari kerak");
  return { sheets: out, warnings };
}


/** Import oldi ko'rinishi: varaqlardagi odamlar (bir nechta varaqda bo'lsa soatlari qo'shiladi) va ERP xodimiga moslik. */
export async function previewTabelImport(buf: Buffer, month: string): Promise<ImportPreview> {
  const { sheets, warnings } = extractTabel(buf, month);
  const nDays = monthDays(month).length;
  const byKey = new Map<string, ImportPerson>();
  for (const sh of sheets) for (const row of sh.rows) {
    const key = nameKey(row.name);
    if (!key) continue;
    const p = byKey.get(key) ?? { key, name: row.name.replace(/\s+/g, " ").trim(), sheets: [], hours: Array<number | null>(nDays).fill(null), total: 0, maxDay: 0, match: null, candidates: [] };
    if (!p.sheets.includes(sh.name)) p.sheets.push(sh.name);
    row.hours.forEach((h, i) => { if (h != null) p.hours[i] = Math.min(MAX_HOURS, (p.hours[i] ?? 0) + h); });
    byKey.set(key, p);
  }
  const days = monthDays(month);
  const from = dayUtc(days[0]!.iso), to = dayUtc(days[days.length - 1]!.iso);
  const [emps, aliases] = await Promise.all([
    db.employee.findMany({ where: { AND: [employeesInWindow(from, to), { OR: [{ userId: null }, { user: { role: { notIn: ["SUPERADMIN"] } } }] }] }, select: { id: true, fullName: true, position: true } }),
    db.employeeAlias.findMany({ where: { name: { in: [...byKey.keys()] } }, select: { name: true, employeeId: true } }),
  ]);
  const aliasOf = new Map(aliases.map((a) => [a.name, a.employeeId]));
  const empKeys = emps.map((e) => ({ e, key: nameKey(e.fullName), toks: nameKey(e.fullName).split(" ") }));
  const empIds = new Set(emps.map((e) => e.id));
  for (const p of byKey.values()) {
    p.total = Math.round(p.hours.reduce<number>((s, h) => s + (h ?? 0), 0) * 100) / 100;
    p.maxDay = Math.max(0, ...p.hours.map((h) => h ?? 0));
    const al = aliasOf.get(p.key);
    if (al && empIds.has(al)) { p.match = { employeeId: al, how: "alias" }; continue; }
    const exact = empKeys.filter((x) => x.key === p.key);
    if (exact.length === 1) { p.match = { employeeId: exact[0]!.e.id, how: "aynan" }; continue; }
    // Familiya + ism (otasining ismisiz), qisqartma «Д» — ismning bosh harfi
    const t = p.key.split(" ");
    const fuzzy = empKeys.filter((x) => x.toks[0] === t[0] && t.slice(1).every((w, i) => x.toks[i + 1] != null && (x.toks[i + 1] === w || (w.length <= 2 && x.toks[i + 1]!.startsWith(w.replace(/\.$/, ""))))));
    if (fuzzy.length === 1 && t.length >= 2) p.match = { employeeId: fuzzy[0]!.e.id, how: "o'xshash" };
    const sur = empKeys.filter((x) => x.toks[0] === t[0] || (t[0]!.length >= 5 && x.toks[0]!.startsWith(t[0]!.slice(0, 5))));
    p.candidates = (fuzzy.length > 1 ? fuzzy : sur).slice(0, 8).map((x) => ({ id: x.e.id, fullName: x.e.fullName, position: x.e.position }));
  }
  const people = [...byKey.values()].sort((a, b) => Number(!!a.match) - Number(!!b.match) || a.name.localeCompare(b.name));
  return { month, days: nDays, sheets: sheets.map((s) => ({ name: s.name, people: s.rows.length })), people, warnings };
}

/** Importni qo'llash: tanlangan moslik bo'yicha soatlar tabelga yoziladi (bo'sh katak — tegilmaydi), qo'lda tanlangan ismlar eslab qolinadi. */
export async function applyTabelImport(who: Who, month: string, people: { key: string; employeeId: string; hours: (number | null)[]; remember?: boolean }[]) {
  const items: TabelItem[] = [];
  for (const p of people) p.hours.forEach((h, i) => { if (h != null && h > 0) items.push({ employeeId: p.employeeId, day: i + 1, value: String(h) }); });
  const res = await saveTabel(who, month, items, { source: "Excel import" });
  if (res.error) return res;
  const remember = people.filter((p) => p.remember && p.key);
  for (const p of remember) {
    await db.employeeAlias.upsert({ where: { name: p.key }, create: { name: p.key, employeeId: p.employeeId, createdById: who.userId }, update: { employeeId: p.employeeId } });
  }
  return res;
}
