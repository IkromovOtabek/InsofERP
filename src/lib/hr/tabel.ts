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
import { tabelLock } from "./tabel-lock";
import { calcBrigadeSheet } from "./brigade-calc";
import { saveBrigadeHours, saveBrigadeMonth, saveBrigadeOutput } from "./brigade-sheet";

export { parseTabelValue, tabelLock };

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

export type TabelEmp = { id: string; fullName: string; position: string; payType: PayType; subdivision: string | null; brigadeId: string | null; teamId: string | null; brigade: { name: string } | null; team: { name: string } | null };
const PAY_GROUP: Record<PayType, string> = { SALARY: "Oklad (AUP)", DAILY: "Kunbay", HOURLY: "Soatbay", PIECE: "Sdelka" };

/** Xodim guruhi: brigada → komanda → shofyor → bo'linma → ish haqi turi (Excel'dagi varaqlar kabi). */
export function groupOf(e: TabelEmp): { key: string; label: string } {
  if (e.brigadeId && e.brigade) return { key: `b:${e.brigadeId}`, label: e.brigade.name };
  if (e.teamId && e.team) return { key: `t:${e.teamId}`, label: e.team.name };
  if (DRIVER_RE.test(e.position)) return { key: "drivers", label: "Shofyorlar" };
  if (e.subdivision?.trim()) return { key: `s:${e.subdivision.trim()}`, label: e.subdivision.trim() };
  return { key: `p:${e.payType}`, label: PAY_GROUP[e.payType] };
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
  // A'zosi yo'q, lekin shu oyda varag'i bor brigadalar (БРУ, boshqa brigadadan kelganlar bilan ishlagan) ham ro'yxatda
  const sheetBrigades = await db.brigade.findMany({
    where: { OR: [{ sheetHours: { some: { date: { gte: from, lte: to } } } }, { sheetOutputs: { some: { date: { gte: from, lte: to } } } }, { sheetMonths: { some: { month } } }] },
    select: { id: true, name: true },
  });
  const sheetPeople = sheetBrigades.length
    ? await db.brigadeHours.groupBy({ by: ["brigadeId", "employeeId"], where: { brigadeId: { in: sheetBrigades.map((b) => b.id) }, date: { gte: from, lte: to } } })
    : [];
  for (const b of sheetBrigades) {
    const key = `b:${b.id}`;
    const n = sheetPeople.filter((x) => x.brigadeId === b.id).length;
    const cur = counts.get(key);
    if (!cur) counts.set(key, { key, label: b.name, count: n });
    else cur.count = Math.max(cur.count, n);
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
  // Unlidan keyingi «ye» kirildan «e» bo'lib o'tadi («Тухтаев» → tuxtaev, lotinda «Tuxtayev») — ikkalasi bir xil kalit
  return toLatin(name).toLowerCase().replace(/[ʻʼ‘’`´]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/([aeiou'])y(?=e)/g, "$1").replace(/\s+/g, " ").trim();
}

export type ImportPerson = {
  key: string; name: string; sheets: string[];
  /** Oddiy tabel varaqlari (Ауп, Поврименшики…) soati — davomatga yoziladi */
  hours: (number | null)[]; total: number;
  /** Brigada varaqlaridagi soati — brigada tabeliga (varaq nomi bo'yicha) */
  bsheets: { sheet: string; hours: (number | null)[] }[];
  /** Bir kunda eng ko'p soat (bir nechta varaqdan qo'shilgan) — 12 dan oshsa tekshirish kerak. */
  maxDay: number;
  match: { employeeId: string; how: "alias" | "aynan" | "o'xshash" } | null;
  candidates: { id: string; fullName: string; position: string }[];
};
export type ImportBrigade = {
  sheet: string; title: string | null; lines: { name: string; rate: number; qty: (number | null)[] }[]; brak: number; people: number; pool: number;
  match: { brigadeId: string; how: "alias" | "nomi" | "brigadir" } | null;
  /** Excel bilan solishtirish: har a'zoning ERP hisobi (10 000 ga yaxlitlangan) = Excel'dagi «сумма + брак» */
  check: { ok: number; diff: { name: string; erp: number; excel: number }[] };
};
export type ImportPreview = {
  month: string; days: number; sheets: { name: string; people: number; kind: "plain" | "brigade" }[];
  people: ImportPerson[]; brigades: ImportBrigade[]; allBrigades: { id: string; name: string }[]; warnings: string[];
};

const HEADER_RE = /^(ф\.?\s*и\.?\s*о\.?|f\.?\s*i\.?\s*o\.?|фамилия.*|xodim|исм.*)$/i;
const STOP_RE = /^(итого|жами|jami|всего|сони|сумма|бригада|bригада)/i;

export type ExtractRow = { name: string; hours: (number | null)[]; /** Excel'ning o'z hisobi (brigada: brakdan oldingi «сумма») — taqqoslash uchun */ excel?: number };
export type ExtractSheet = {
  name: string; kind: "plain" | "brigade"; rows: ExtractRow[];
  /** Brigada varag'i: «Сони» qatorlari (kunlik soni) va «Сумма» dagi narx; brak — a'zolar brak ustunlari yig'indisi. */
  lines?: { name: string; rate: number; qty: (number | null)[] }[]; brak?: number; title?: string;
};

const numOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(",", ".")) : null);

/**
 * Excel kitobidan tabel bloklari: «Ф.И.О.» sarlavhasi va undan o'ngda 1..31 kun ustunlari bor varaqlar.
 * «Сони» bloki bor varaq — brigada varag'i (Илхом, Столба, БРУ…): a'zolar soati, kunlik mahsulot soni, narx va brak.
 */
export function extractTabel(buf: Buffer, month: string): { sheets: ExtractSheet[]; warnings: string[] } {
  const nDays = monthDays(month).length;
  const out: ExtractSheet[] = [];
  const warnings: string[] = [];
  for (const sh of parseWorkbook(buf)) {
    const cells = sh.data.cells;
    const at = (r: number, c: number) => cells[`${colName(c)}${r + 1}`]?.v;
    const text = (r: number, c: number) => { const v = at(r, c); return typeof v === "string" ? v.trim() : ""; };
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
    const { nameC, d1 } = head;
    const dayVals = (r: number, cap: number | null) => Array.from({ length: nDays }, (_, k) => {
      const n = numOf(at(r, d1 + k));
      return n != null && n > 0 ? (cap ? Math.min(cap, Math.round(n * 100) / 100) : n) : null;
    });
    // Sarlavhadagi «сумма» (brakdan oldingi summa emas — Excel: yaxlitlangan − brak) va «брак» ustunlari (kunlardan keyin)
    const after = Array.from({ length: Math.max(0, sh.data.nc - (d1 + 31)) }, (_, i) => d1 + 31 + i);
    const brakCols = after.filter((c) => /брак/i.test(text(head!.r, c)));
    const sumCol = after.find((c) => /^сумма$/i.test(text(head!.r, c)));
    const rows: ExtractRow[] = [];
    let empty = 0, r = head.r + 1;
    for (; r < sh.data.nr; r++) {
      const name = text(r, nameC);
      if (!name) { if (++empty >= 3) break; continue; }
      empty = 0;
      if (STOP_RE.test(name)) break;
      if (/^\d+([.,]\d+)?$/.test(name)) continue;
      const hours = dayVals(r, MAX_HOURS);
      if (!hours.some((h) => h != null)) continue;
      const row: ExtractRow = { name, hours };
      if (sumCol != null) row.excel = (numOf(at(r, sumCol)) ?? 0) + brakCols.reduce((s, c) => s + (numOf(at(r, c)) ?? 0), 0);
      rows.push(row);
    }
    if (!rows.length) continue;
    // Brigada bloki: «Сони» → mahsulot qatorlari (soni), «Сумма» → shu qatorlar narxi
    const findLabel = (re: RegExp, from: number) => { for (let i = from; i < sh.data.nr; i++) if (re.test(text(i, nameC))) return i; return -1; };
    const soniAt = findLabel(/^сони$/i, head.r + 1);
    if (soniAt < 0) { out.push({ name: sh.name.trim(), kind: "plain", rows }); continue; }
    const qtyRows: { name: string; qty: (number | null)[] }[] = [];
    for (let i = soniAt + 1; i < sh.data.nr; i++) {
      const label = text(i, nameC);
      if (/^итого/i.test(label)) break;
      // Bo'sh nomli qator ham o'rnini saqlaydi (narx tartib bo'yicha olinadi)
      qtyRows.push({ name: label || `${qtyRows.length + 1}-qator`, qty: dayVals(i, null) });
    }
    // Narx «Сумма» blokidan — Excel'dagi SUMPRODUCT kabi QATOR TARTIBI bo'yicha (nomi farq qilsa ham: «ПЛИТЫ(50-59)» soni ↔ 2-narx)
    const summaAt = findLabel(/^сумма$/i, soniAt + 1);
    const rates: number[] = [];
    if (summaAt >= 0) for (let i = summaAt + 1; i < sh.data.nr; i++) {
      const label = text(i, nameC);
      if (/^итого/i.test(label)) break;
      if (!label && !Array.from({ length: nDays }, (_, k) => numOf(at(i, d1 + k))).some((v) => v)) { if (rates.length >= qtyRows.length) break; rates.push(0); continue; }
      // Narx kunlar ustunlarida takrorlangan — eng ko'p uchragani olinadi
      const freq = new Map<number, number>();
      for (let k = 0; k < nDays; k++) { const v = numOf(at(i, d1 + k)); if (v && v > 0) freq.set(v, (freq.get(v) ?? 0) + 1); }
      rates.push([...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
    }
    const lines = qtyRows.map((q, i) => ({ name: q.name, rate: rates[i] ?? 0, qty: q.qty }))
      .filter((l) => l.rate > 0 || l.qty.some((x) => x != null));
    const brak = rows.length && brakCols.length
      ? Math.round(Array.from({ length: r - head.r - 1 }, (_, i) => head!.r + 1 + i).reduce((s, rr) => s + brakCols.reduce((t, c) => t + (numOf(at(rr, c)) ?? 0), 0), 0))
      : 0;
    const title = text(head.r - 1, nameC) || undefined;
    out.push({ name: sh.name.trim(), kind: "brigade", rows, lines, brak, title });
  }
  if (!out.length) warnings.push("Faylda tabel varag'i topilmadi — «Ф.И.О.» sarlavhasi va 1..31 kun ustunlari kerak");
  return { sheets: out, warnings };
}

/** Import oldi ko'rinishi: varaqlardagi odamlar (bir nechta varaqda bo'lsa soatlari qo'shiladi) va ERP xodimiga moslik. */
export type PersonMatch = { match: { employeeId: string; how: "alias" | "aynan" | "o'xshash" } | null; candidates: { id: string; fullName: string; position: string }[] };

/**
 * Excel'dagi ismlar (nameKey) → ERP xodimi: eslab qolingan moslik (EmployeeAlias), aynan bir xil ism, yoki familiya +
 * ism (otasining ismisiz; «Д» — bosh harf) bo'yicha yagona o'xshash. Topilmaganiga — familiyasi o'xshash nomzodlar.
 */
export async function matchPeople(keys: string[], from: Date, to: Date): Promise<{ results: Map<string, PersonMatch> }> {
  const [emps, aliases] = await Promise.all([
    db.employee.findMany({ where: { AND: [employeesInWindow(from, to), { OR: [{ userId: null }, { user: { role: { notIn: ["SUPERADMIN"] } } }] }] }, select: { id: true, fullName: true, position: true } }),
    db.employeeAlias.findMany({ where: { name: { in: keys } }, select: { name: true, employeeId: true } }),
  ]);
  const aliasOf = new Map(aliases.map((a) => [a.name, a.employeeId]));
  const empKeys = emps.map((e) => ({ e, key: nameKey(e.fullName), toks: nameKey(e.fullName).split(" ") }));
  const empIds = new Set(emps.map((e) => e.id));
  const results = new Map<string, PersonMatch>();
  for (const key of keys) {
    const al = aliasOf.get(key);
    if (al && empIds.has(al)) { results.set(key, { match: { employeeId: al, how: "alias" }, candidates: [] }); continue; }
    const exact = empKeys.filter((x) => x.key === key);
    if (exact.length === 1) { results.set(key, { match: { employeeId: exact[0]!.e.id, how: "aynan" }, candidates: [] }); continue; }
    const t = key.split(" ");
    const fuzzy = empKeys.filter((x) => x.toks[0] === t[0] && t.slice(1).every((w, i) => x.toks[i + 1] != null && (x.toks[i + 1] === w || (w.length <= 2 && x.toks[i + 1]!.startsWith(w.replace(/\.$/, ""))))));
    const sur = empKeys.filter((x) => x.toks[0] === t[0] || (t[0]!.length >= 5 && x.toks[0]!.startsWith(t[0]!.slice(0, 5))));
    results.set(key, {
      match: fuzzy.length === 1 && t.length >= 2 ? { employeeId: fuzzy[0]!.e.id, how: "o'xshash" } : null,
      candidates: (fuzzy.length > 1 ? fuzzy : sur).slice(0, 8).map((x) => ({ id: x.e.id, fullName: x.e.fullName, position: x.e.position })),
    });
  }
  return { results };
}

export async function previewTabelImport(buf: Buffer, month: string): Promise<ImportPreview> {
  const { sheets, warnings } = extractTabel(buf, month);
  const nDays = monthDays(month).length;
  const byKey = new Map<string, ImportPerson>();
  for (const sh of sheets) for (const row of sh.rows) {
    const key = nameKey(row.name);
    if (!key) continue;
    const p = byKey.get(key) ?? { key, name: row.name.replace(/\s+/g, " ").trim(), sheets: [], hours: Array<number | null>(nDays).fill(null), total: 0, bsheets: [], maxDay: 0, match: null, candidates: [] };
    if (!p.sheets.includes(sh.name)) p.sheets.push(sh.name);
    if (sh.kind === "brigade") p.bsheets.push({ sheet: sh.name, hours: row.hours });
    else row.hours.forEach((h, i) => { if (h != null) p.hours[i] = Math.min(MAX_HOURS, (p.hours[i] ?? 0) + h); });
    byKey.set(key, p);
  }
  const days = monthDays(month);
  const from = dayUtc(days[0]!.iso), to = dayUtc(days[days.length - 1]!.iso);
  const [{ results }, brigadeList] = await Promise.all([
    matchPeople([...byKey.keys()], from, to),
    db.brigade.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], select: { id: true, name: true, aliases: true, leader: { select: { fullName: true } } } }),
  ]);
  for (const p of byKey.values()) {
    p.total = Math.round((p.hours.reduce<number>((s, h) => s + (h ?? 0), 0) + p.bsheets.reduce((s, b) => s + b.hours.reduce<number>((t, h) => t + (h ?? 0), 0), 0)) * 100) / 100;
    p.maxDay = Math.max(0, ...Array.from({ length: nDays }, (_, i) => (p.hours[i] ?? 0) + p.bsheets.reduce((s, b) => s + (b.hours[i] ?? 0), 0)));
    const m = results.get(p.key)!;
    p.match = m.match;
    p.candidates = m.candidates;
  }
  // Brigada varaqlari → ERP brigadasi: eslab qolingan nom, brigada nomida varaq nomi, yoki brigadir ismida
  const brigades: ImportBrigade[] = sheets.filter((s) => s.kind === "brigade").map((sh) => {
    const k = nameKey(sh.name), tk = sh.title ? nameKey(sh.title) : "";
    const words = (x: string) => x.split(" ").filter((w) => w.length >= 3);
    const byAlias = brigadeList.find((b) => b.aliases.includes(k));
    const byName = brigadeList.filter((b) => { const bn = nameKey(b.name); return bn === k || words(k).some((w) => bn.split(" ").includes(w)) || (!!tk && bn === tk); });
    const byLeader = brigadeList.filter((b) => b.leader && words(k).some((w) => nameKey(b.leader!.fullName).split(" ").includes(w)));
    const match = byAlias ? { brigadeId: byAlias.id, how: "alias" as const }
      : byName.length === 1 ? { brigadeId: byName[0]!.id, how: "nomi" as const }
      : byLeader.length === 1 ? { brigadeId: byLeader[0]!.id, how: "brigadir" as const } : null;
    const hours: Record<string, (number | null)[]> = {};
    sh.rows.forEach((r, i) => { hours[String(i)] = r.hours; });
    const c = calcBrigadeSheet({ days: nDays, hours, lines: sh.lines ?? [], brak: sh.brak ?? 0 });
    const diff: ImportBrigade["check"]["diff"] = [];
    let ok = 0;
    sh.rows.forEach((r, i) => {
      if (r.excel == null) return;
      const erp = c.emp[String(i)]!.amount;
      if (Math.abs(erp - r.excel) < 1) ok++; else diff.push({ name: r.name, erp, excel: Math.round(r.excel) });
    });
    return { sheet: sh.name, title: sh.title ?? null, lines: sh.lines ?? [], brak: sh.brak ?? 0, people: sh.rows.length, pool: Math.round(c.total.pool), match, check: { ok, diff } };
  });
  const people = [...byKey.values()].sort((a, b) => Number(!!a.match) - Number(!!b.match) || a.name.localeCompare(b.name));
  return {
    month, days: nDays, sheets: sheets.map((s) => ({ name: s.name, people: s.rows.length, kind: s.kind })),
    people, brigades, allBrigades: brigadeList.map((b) => ({ id: b.id, name: b.name })), warnings,
  };
}

/**
 * Importni qo'llash. Oddiy tabel soati — davomatga (`saveTabel`); brigada varaqlari — brigada varag'iga: qatorlar va narx,
 * brak, kunlik soni va a'zolar soati (`lib/hr/brigade-sheet.ts`). Bo'sh katak tegilmaydi. Qo'lda tanlangan ism va
 * brigada moslugi eslab qolinadi; «yangi» tanlangan varaq uchun brigada ochiladi.
 */
export async function applyTabelImport(
  who: Who, month: string,
  people: { key: string; employeeId: string; hours: (number | null)[]; bsheets?: { sheet: string; hours: (number | null)[] }[]; remember?: boolean }[],
  brigades: { sheet: string; brigadeId: string; newName?: string; remember?: boolean; lines: { name: string; rate: number; qty: (number | null)[] }[]; brak: number }[] = [],
): Promise<{ error?: string; saved: number; skipped: string[] }> {
  const items: TabelItem[] = [];
  for (const p of people) p.hours.forEach((h, i) => { if (h != null && h > 0) items.push({ employeeId: p.employeeId, day: i + 1, value: String(h) }); });
  const res = items.length ? await saveTabel(who, month, items, { source: "Excel import" }) : { saved: 0, skipped: [] as string[] };
  if (res.error) return res;
  let saved = res.saved;
  const skipped = [...res.skipped];
  // Brigada varaqlari
  const brigadeOf = new Map<string, string>();
  for (const b of brigades) {
    let id = b.brigadeId;
    if (id === "new") {
      const name = (b.newName ?? b.sheet).trim().slice(0, 80) || b.sheet;
      const created = await db.brigade.create({ data: { name, aliases: [nameKey(b.sheet)] }, select: { id: true } });
      await audit(db, who.userId, "CREATE", "Brigade", created.id, undefined, { name, manba: "Excel tabel importi" });
      id = created.id;
    } else if (b.remember) {
      const cur = await db.brigade.findUnique({ where: { id }, select: { aliases: true } });
      if (cur && !cur.aliases.includes(nameKey(b.sheet))) await db.brigade.update({ where: { id }, data: { aliases: [...cur.aliases, nameKey(b.sheet)] } });
    }
    if (!id) continue;
    brigadeOf.set(b.sheet, id);
    const m = await saveBrigadeMonth(who, month, id, { lines: b.lines.map((l) => ({ name: l.name, rate: l.rate })), brak: b.brak || null });
    if ("error" in m && m.error) return { error: `${b.sheet}: ${m.error}`, saved, skipped };
    const out = b.lines.flatMap((l) => l.qty.map((q, i) => (q != null && q > 0 ? { line: l.name, day: i + 1, value: String(q) } : null)).filter((x): x is NonNullable<typeof x> => !!x));
    if (out.length) {
      const r = await saveBrigadeOutput(who, month, id, out);
      if ("error" in r) return { error: `${b.sheet}: ${r.error}`, saved, skipped };
      saved += r.saved;
    }
  }
  const hoursBy = new Map<string, { employeeId: string; day: number; value: string }[]>();
  for (const p of people) for (const bs of p.bsheets ?? []) {
    const bid = brigadeOf.get(bs.sheet);
    if (!bid) continue;
    const list = hoursBy.get(bid) ?? [];
    bs.hours.forEach((h, i) => { if (h != null && h > 0) list.push({ employeeId: p.employeeId, day: i + 1, value: String(h) }); });
    hoursBy.set(bid, list);
  }
  for (const [bid, list] of hoursBy) {
    // Bir xodimga ikki Excel qatori tanlangan bo'lsa — shu kunning soatlari qo'shiladi
    const merged = new Map<string, { employeeId: string; day: number; value: string }>();
    for (const it of list) {
      const k = `${it.employeeId}:${it.day}`, cur = merged.get(k);
      merged.set(k, cur ? { ...it, value: String(Math.min(MAX_HOURS, Number(cur.value) + Number(it.value))) } : it);
    }
    const r = await saveBrigadeHours(who, month, bid, [...merged.values()]);
    if ("error" in r) return { error: r.error, saved, skipped };
    saved += r.saved;
    skipped.push(...r.skipped);
  }
  for (const p of people.filter((x) => x.remember && x.key)) {
    await db.employeeAlias.upsert({ where: { name: p.key }, create: { name: p.key, employeeId: p.employeeId, createdById: who.userId }, update: { employeeId: p.employeeId } });
  }
  return { saved, skipped: skipped.slice(0, 50) };
}
