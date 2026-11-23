import type { PayType } from "@/generated/prisma";
import { db } from "@/lib/db";
import { monthTitle } from "@/lib/davomat";
import { date, fmtNum, money } from "@/lib/format";
import { addrOf, type Cell, type SheetData, type SheetStyle } from "@/lib/sheet-calc";
import { calcBrigadeSheet } from "./brigade-calc";
import { brigadeSheet } from "./brigade-sheet";
import { DEDUCTION_CATS } from "./deduction-cats";
import { deductionsMonth, listWithholdings } from "./deductions";
import { listDebts } from "./employee-debt";
import { calculate, payrollSettings } from "./payroll";
import { groupOf, groupOrder, tabelMonth, type TabelEmp } from "./tabel";
import { parseTabelValue } from "./tabel-value";
import { SHEET_COLS, sheetGroups, type SheetSrcLine } from "./vedomost-sheet";

/**
 * «Oylik varaqlari» Excel fayli yuklanmagan oy uchun ham: ERP'ning o'z ma'lumotidan Excel kitobi ko'rinishi (faqat
 * ko'rish va .xlsx yuklab olish). Varaqlar — Excel'dagi oylik fayl tartibida:
 *   · har komanda / biriktirilmaganlar — tabel (kun × soat, jami, hisob);
 *   · har brigada — brigada varag'i (a'zolar soati, mahsulot soni × narx, kunlik fond, ulush, brak);
 *   · Ushlanmalar (C2026 G–K), C2026 (oy yakuni vedomosti — hisoblanmagan bo'lsa taxminiy), Avans («Аванс наличка»,
 *     vedomost №1), Zarplata 2 («Зарплата 2», vedomost №2 — qoldiq naqd/plastik, imzo), Qarzlar (Карз), Ijro (Миб).
 *     Avans va Zarplata 2 — Excel'dagidek komanda / brigada bo'limlari bilan, imzo ustuni va imzolar.
 * Raqamlar sahifalardagi bilan bir xil manbadan (`tabelMonth`, `brigadeSheet`, `deductionsMonth`, vedomost qatorlari);
 * soat jamilari — Excel formulasi (SUM), pul — ERP hisobi.
 */

/** «Stavka» katagidagi qalam (tahrir oynasi) — manzil (A1) → xodim. Ko'rsatish ruxsatini sahifa hal qiladi (payroll.rate). */
export type RateCell = { employeeId: string; fullName: string; payType: PayType; rate: number };
export type ErpSheet = { id: string; name: string; hidden: boolean; data: SheetData; rates?: Record<string, RateCell> };

const S = {
  title: { b: 1, fs: 1.25 } as SheetStyle,
  note: { i: 1, fc: "64748B" } as SheetStyle,
  head: { b: 1, bg: "E2E8F0", ha: "center", va: "center", w: 1, bd: 15 } as SheetStyle,
  headWe: { b: 1, bg: "DBEAFE", ha: "center", va: "center", bd: 15 } as SheetStyle,
  txt: { bd: 15 } as SheetStyle,
  txtB: { bd: 15, b: 1 } as SheetStyle,
  numB: { bd: 15, b: 1, z: "#,##0;-#,##0;" } as SheetStyle,
  num: { bd: 15, z: "#,##0;-#,##0;" } as SheetStyle,
  dec: { bd: 15, z: "0.##;-0.##;", ha: "center" } as SheetStyle,
  hrs: { bd: 15, ha: "center" } as SheetStyle,
  auto: { bd: 15, ha: "center", i: 1, fc: "94A3B8" } as SheetStyle,
  live: { bd: 15, ha: "center", i: 1, fc: "059669", b: 1 } as SheetStyle,
  autoNum: { bd: 15, z: "#,##0;-#,##0;", i: 1, fc: "0369A1" } as SheetStyle,
  autoNumB: { bd: 15, z: "#,##0;-#,##0;", i: 1, b: 1, fc: "0369A1" } as SheetStyle,
  /** 0 ham ko'rinadi (Avans: berilmagan — 0) */
  num0: { bd: 15, z: "#,##0;-#,##0" } as SheetStyle,
  code: { bd: 15, ha: "center", b: 1, fc: "DC2626" } as SheetStyle,
  tot: { bd: 15, b: 1, bg: "F1F5F9", z: "#,##0;-#,##0;" } as SheetStyle,
  totDec: { bd: 15, b: 1, bg: "F1F5F9", z: "0.##;-0.##;", ha: "center" } as SheetStyle,
  group: { b: 1, bg: "FEF3C7", bd: 15 } as SheetStyle,
  groupNum: { b: 1, bg: "FEF3C7", bd: 15, z: "#,##0;-#,##0;" } as SheetStyle,
};

/** Kichik varaq yasovchi: uslublar indekslanadi, kataklar A1 manzil bilan. */
class Sheet {
  private st: SheetStyle[] = [{}];
  private idx = new Map<string, number>();
  cells: Record<string, Cell> = {};
  cw: Record<number, number> = {};
  mg: [number, number, number, number][] = [];
  rates: Record<string, RateCell> = {};
  nr = 0; nc = 0;
  frz?: [number, number];
  /** Sarlavha / izoh qatorlari — butun eniga birlashtiriladi (matn qisqa ustunda kesilmasin) */
  private wideRows: number[] = [];
  private style(s: SheetStyle) {
    const k = JSON.stringify(s);
    let i = this.idx.get(k);
    if (i == null) { i = this.st.length; this.st.push(s); this.idx.set(k, i); }
    return i;
  }
  set(r: number, c: number, v: number | string | null | undefined, s?: SheetStyle, f?: string) {
    const has = v !== null && v !== undefined && v !== "";
    if (!has && !f && !s) return;
    this.cells[addrOf(r, c)] = { ...(has ? { v: v! } : {}), ...(f ? { f } : {}), ...(s ? { s: this.style(s) } : {}) };
    this.nr = Math.max(this.nr, r + 1); this.nc = Math.max(this.nc, c + 1);
  }
  merge(r1: number, c1: number, r2: number, c2: number) { this.mg.push([r1, c1, r2, c2]); }
  /** Butun eniga yoziladigan matn qatori (sarlavha, izoh). */
  line(r: number, text: string, s: SheetStyle) { this.set(r, 0, text, s); this.wideRows.push(r); }
  width(c: number, px: number) { this.cw[c] = px; }
  data(): SheetData {
    const nc = Math.max(1, this.nc);
    const mg = [...this.mg, ...(nc > 1 ? this.wideRows.map((r): [number, number, number, number] => [r, 0, r, Math.min(nc - 1, 20)]) : [])];
    return { nr: Math.max(1, this.nr), nc, cw: this.cw, rh: {}, dcw: 64, drh: 20, mg, st: this.st, cells: this.cells, ...(this.frz ? { frz: this.frz } : {}) };
  }
}

const r0 = (n: number) => Math.round(n);
const sumF = (r1: number, c1: number, r2: number, c2: number) => `SUM(${addrOf(r1, c1)}:${addrOf(r2, c2)})`;
/** Excel varaq nomi: ko'pi 31 belgi, `[]:*?/\` siz, takrorlanmasin. */
function sheetName(name: string, used: Set<string>) {
  const base = name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Varaq";
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
}

type PayRow = { name: string; pos: string; emp?: TabelEmp; a: number; b: number };
type PayGroup = { label: string; rows: PayRow[] };

/** Qatorlarni komanda / brigada bo'limlariga (tabel va C2026 dagi `groupOf` tartibida), bo'lim ichida — ism bo'yicha. */
function groupRows(rows: PayRow[]): PayGroup[] {
  const m = new Map<string, PayGroup & { order: number }>();
  for (const x of rows) {
    const g = x.emp ? groupOf(x.emp) : { key: "-", label: "Biriktirilmagan" };
    const cur = m.get(g.key) ?? { label: g.label, rows: [], order: groupOrder(g.key) };
    cur.rows.push(x);
    m.set(g.key, cur);
  }
  return [...m.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map((g) => ({ label: g.label, rows: g.rows.sort((p, q) => p.name.localeCompare(q.name)) }));
}

/** Qatorlar komanda / brigada bo'limlariga: Tabel tartibi (komandalar → brigadalar → biriktirilmagan), bo'lim ichida ism bo'yicha. */
function byGroup<T>(rows: T[], groupOfRow: (r: T) => { key: string; label: string }, nameOf: (r: T) => string) {
  const m = new Map<string, { key: string; label: string; rows: T[] }>();
  for (const r of rows) { const g = groupOfRow(r); const cur = m.get(g.key) ?? { key: g.key, label: g.label, rows: [] }; cur.rows.push(r); m.set(g.key, cur); }
  return [...m.values()]
    .sort((a, b) => groupOrder(a.key) - groupOrder(b.key) || a.label.localeCompare(b.label))
    .map((g) => ({ ...g, rows: g.rows.sort((p, q) => nameOf(p).localeCompare(nameOf(q))) }));
}

/** Xodimlarning guruhi (komanda / brigada) — daftar varaqlari (Qarzlar, Ijro) uchun. */
async function groupsOf(employeeIds: string[]) {
  const emps = await db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, brigadeId: true, teamId: true, brigade: { select: { name: true } }, team: { select: { name: true } } } });
  const m = new Map(emps.map((e) => [e.id, groupOf(e)]));
  return (id: string) => m.get(id) ?? { key: "none", label: "Biriktirilmagan" };
}

/**
 * To'lov vedomosti (Excel «Аванс наличка» / «Зарплата 2» kabi): bo'lim sarlavhasi, № · F.I.O. · Lavozim · ikki summa · Imzo,
 * bo'lim jami, umumiy jami (SUM) va imzolar.
 */
function payList(caption: string, cols: [string, string], groups: PayGroup[]): Sheet {
  const sh = new Sheet();
  sh.line(0, caption, S.title);
  const H = 2;
  ["№", "F.I.O.", "Lavozim", cols[0], cols[1], "Imzo"].forEach((t, i) => sh.set(H, i, t, S.head));
  let r = H + 1, n = 0;
  const totals: number[] = [];
  for (const g of groups) {
    const gr = r++;
    sh.set(gr, 0, null, S.group); sh.set(gr, 1, g.label, S.group); sh.set(gr, 2, `${g.rows.length} kishi`, S.group);
    for (const x of g.rows) {
      sh.set(r, 0, ++n, S.hrs); sh.set(r, 1, x.name, S.txt); sh.set(r, 2, x.pos, S.txt);
      sh.set(r, 3, x.a || null, S.num); sh.set(r, 4, x.b || null, S.num); sh.set(r, 5, null, S.txt);
      r++;
    }
    for (const c of [3, 4]) sh.set(gr, c, null, S.groupNum, sumF(gr + 1, c, Math.max(gr + 1, r - 1), c));
    sh.set(gr, 5, null, S.group);
    totals.push(gr);
  }
  sh.set(r, 1, `Jami (${n})`, S.tot);
  for (const c of [3, 4]) sh.set(r, c, null, S.tot, totals.length ? totals.map((gr) => addrOf(gr, c)).join("+") : "0");
  sh.set(r, 5, null, S.tot);
  r += 2;
  for (const t of ["Direktor  ___________", "Bosh buxgalter  ___________", "Hisobchi  ___________", "Kassir  ___________"]) sh.set(r++, 1, t);
  sh.width(0, 32); sh.width(1, 220); sh.width(2, 140); sh.width(3, 110); sh.width(4, 110); sh.width(5, 140);
  sh.frz = [H + 1, 2];
  return sh;
}

/**
 * Shu oy xodimga berilgan avans — oy yakuni hisobidagi (`calculate` FINAL) manbalar bilan bir xil: avans / alohida to'lov
 * vedomostlarida to'langani (tasdiqlangan, to'langan) va Avans varaqasida «Berildi» belgilangani.
 */
async function givenAdvances(month: string): Promise<Map<string, number>> {
  const [runs, sheets] = await Promise.all([
    db.payrollLine.findMany({ where: { paid: { gt: 0 }, run: { month, kind: { in: ["ADVANCE", "EXTRA"] }, status: { in: ["APPROVED", "PAID"] } } }, select: { employeeId: true, paid: true } }),
    db.advanceLine.findMany({ where: { givenAt: { not: null }, amount: { gt: 0 }, sheet: { month, status: { not: "CANCELLED" } } }, select: { employeeId: true, amount: true } }),
  ]);
  const m = new Map<string, number>();
  for (const l of runs) m.set(l.employeeId, (m.get(l.employeeId) ?? 0) + Number(l.paid));
  for (const l of sheets) m.set(l.employeeId, (m.get(l.employeeId) ?? 0) + Number(l.amount));
  return m;
}

export async function erpWorkbook(month: string): Promise<ErpSheet[]> {
  const title = monthTitle(month);
  const out: ErpSheet[] = [];
  const used = new Set<string>();
  const push = (name: string, sh: Sheet) => {
    const n = sheetName(name, used);
    out.push({ id: `erp:${month}:${out.length}`, name: n, hidden: false, data: sh.data(), ...(Object.keys(sh.rates).length ? { rates: sh.rates } : {}) });
  };

  const [tabel, ded, st, given] = await Promise.all([tabelMonth(month, "all"), deductionsMonth(month), payrollSettings(), givenAdvances(month)]);
  const nDays = tabel.days.length;
  // Har xodimning shu oy ushlanmasi (Ushlanmalar jadvali: yozilgani, bo'sh bo'lsa — avtomatik) — tabel va brigada
  // varaqlarida «Ushlanmalar» ustuni shundan
  const held = new Map(ded.rows.map((r) => [r.id, DEDUCTION_CATS.reduce((sm, c) => sm + (r.values[c.key] ?? r.auto[c.key] ?? 0), 0)]));
  // Soliq (JShDS) — Ish haqi sozlamalaridagi foiz (odatda 12%), oy yakuni vedomostidagi kabi hisoblangan summadan
  const pct = Number(st.incomeTaxPct);
  const taxCol = `Soliq ${String(pct).replace(".", ",")}%`;
  const taxOf = (x: number) => r0((x * pct) / 100);
  const taxF = (r: number, c: number) => `ROUND(${addrOf(r, c)}*${pct}/100,0)`;
  // Jami — xodim qo'liga tegadigan: hisob − soliq − ushlanmalar − berilgan avans
  const jamiF = (r: number, cHisob: number, cTax: number, cUsh: number, cAdv: number) => `${addrOf(r, cHisob)}-${addrOf(r, cTax)}-${addrOf(r, cUsh)}-${addrOf(r, cAdv)}`;
  const advOf = (id: string) => r0(given.get(id) ?? 0);

  // ── Brigada varaqlari ma'lumoti (parallel yuklanadi) — avval: sdelkachining soliq va jamisi «Barcha xodimlar» da ham ──
  const bGroups = tabel.groups.filter((x) => x.key.startsWith("b:"));
  const bPrep = (await Promise.all(bGroups.map((g) => brigadeSheet(month, g.key.slice(2))))).map((b) => {
    if (!b) return null;
    // Son: qo'lda yozilgani (0 ham), bo'sh bo'lsa — ishlab chiqarishda brigada bajargani (kul rang)
    const qtyOf = (line: string, d: number): { q: number; auto: boolean } | null => {
      const m = b.qty[line]?.[d];
      if (m !== undefined) return { q: m, auto: false };
      const a = b.autoQty[line]?.[d];
      return a !== undefined ? { q: a, auto: true } : null;
    };
    // Qo'lda yozilgan soat (0 — ishlamadi) — o'sha, bo'sh — davomatdan (sahifadagi va vedomostdagi qoida)
    const hourOf = (id: string, d: number): { h: number; kind: "m" | "a" | "l" } | null => {
      const m = b.hours[id]?.[d];
      if (m !== undefined) return m > 0 ? { h: m, kind: "m" } : null;
      const a = b.auto[id]?.[d];
      return a ? { h: a.h, kind: a.live ? "l" : "a" } : null;
    };
    const calc = calcBrigadeSheet({
      days: nDays, brak: b.brakManual ?? b.brakAuto,
      // Bugun hali ishda («davom etmoqda») — vedomost kabi pulga kirmaydi, katakda ko'rinadi
      hours: Object.fromEntries(b.members.map((m) => [m.id, Array.from({ length: nDays }, (_, i) => { const x = hourOf(m.id, i + 1); return x && x.kind !== "l" ? x.h : null; })])),
      lines: b.lines.map((l) => ({ ...l, qty: Array.from({ length: nDays }, (_, i) => qtyOf(l.name, i + 1)?.q ?? null) })),
    });
    return { b, qtyOf, hourOf, calc };
  });
  // Sdelkachi (o'z brigadasi varag'ida): soliq — «Hisoblandi» dan, jami — Summa (brak ayirilgan) − soliq − ushlanma − avans
  const pieceOut = new Map<string, { tax: number; jami: number }>();
  for (const p of bPrep) {
    if (!p) continue;
    for (const m of p.b.members) {
      if (m.guest || m.payType !== "PIECE") continue;
      const c = p.calc.emp[m.id];
      const tax = taxOf(c?.amount ?? 0);
      pieceOut.set(m.id, { tax, jami: (c?.net ?? 0) - tax - r0(held.get(m.id) ?? 0) - advOf(m.id) });
    }
  }

  // ── Tabel: komandalar va biriktirilmaganlar; brigadadagi oklad/kunbay/soatbay xodimlar — «<brigada> — tabel» ──
  // `groupCol` — «Barcha xodimlar» varag'ida Lavozimdan keyin «Guruh» (komanda / brigada) ustuni
  const groupLabel = new Map(tabel.groups.map((g) => [g.key, g.label]));
  const tabelSheet = (label: string, rows: typeof tabel.rows, groupCol = false) => {
    const sh = new Sheet();
    sh.line(0, `${label} — ${title} tabeli`, S.title);
    sh.line(1, `Soat yoki H — kelmadi, K — kasal, T — ta'til, D — dam olish. Kul rang — davomatdan, yashil — bugun ishda (davom etmoqda). ${taxCol} — Hisobdan; Ushlanmalar — Ish haqi → Ushlanmalar jadvalidan; Avans — shu oy berilgan avans; Jami = Hisob − Soliq − Ushlanmalar − Avans (qo'lga tegadi). Sdelkachining soliq va jamisi (ko'k) — brigada varag'idan.`, S.note);
    const H = 3, c0 = groupCol ? 4 : 3, cS = c0 + nDays;
    // Ustunlar: cS Soat · +1 Kun · +2 Norma · +3 Stavka · +4 Hisob · +5 Soliq · +6 Ushlanmalar · +7 Avans · +8 Jami
    const cH = cS + 4, cT = cS + 5, cU = cS + 6, cA = cS + 7, cJ = cS + 8;
    ["№", "F.I.O.", "Lavozim", ...(groupCol ? ["Guruh"] : [])].forEach((t, i) => sh.set(H, i, t, S.head));
    tabel.days.forEach((d, i) => sh.set(H, c0 + i, d.day, d.weekend ? S.headWe : S.head));
    ["Soat", "Kun", "Norma", "Stavka", "Hisob", taxCol, "Ushlanmalar", "Avans", "Jami"].forEach((t, i) => sh.set(H, cS + i, t, S.head));
    rows.forEach((r, i) => {
      const rr = H + 1 + i;
      sh.set(rr, 0, i + 1, S.hrs); sh.set(rr, 1, r.fullName, S.txt); sh.set(rr, 2, r.position, S.txt);
      if (groupCol) sh.set(rr, 3, groupLabel.get(r.group) ?? "Biriktirilmagan", S.txt);
      let days = 0, hours = 0;
      for (let d = 1; d <= nDays; d++) {
        const c = r.cells[d];
        const p = c ? parseTabelValue(c.v) : null;
        if (!c || !p || "error" in p || p.kind === "clear") { sh.set(rr, c0 + d - 1, null, S.hrs); continue; }
        if (p.kind === "status") { sh.set(rr, c0 + d - 1, c.v, S.code); continue; }
        const h = p.hours ?? tabel.hoursPerDay;
        const inJob = d >= r.from && d <= r.to;
        if (inJob) { hours += h; days += c.auto || p.hours == null ? 1 : h / tabel.hoursPerDay; }
        sh.set(rr, c0 + d - 1, h, !inJob ? S.note : c.live ? S.live : c.auto ? S.auto : S.hrs);
      }
      const sum = r.payType === "SALARY" ? (r.normDays > 0 ? (r.rate * days) / r.normDays : 0) : r.payType === "DAILY" ? r.rate * days : r.payType === "HOURLY" ? r.rate * hours : null;
      const whole = r.from === 1 && r.to === nDays;
      sh.set(rr, cS, hours, S.totDec, whole ? sumF(rr, c0, rr, c0 + nDays - 1) : sumF(rr, c0 + r.from - 1, rr, c0 + r.to - 1));
      sh.set(rr, cS + 1, Math.round(days * 100) / 100, S.dec);
      sh.set(rr, cS + 2, r.payType === "SALARY" ? r.normDays : null, S.hrs);
      sh.set(rr, cS + 3, r.rate || null, S.num);
      // Stavka qalami (oklad / kunbay / soatbay); sdelkachining puli brigada varag'idan — stavka ishlatilmaydi
      if (r.payType !== "PIECE") sh.rates[addrOf(rr, cS + 3)] = { employeeId: r.id, fullName: r.fullName, payType: r.payType, rate: r.rate };
      sh.set(rr, cH, sum == null ? "sdelka" : r0(sum), S.num);
      const ush = r0(held.get(r.id) ?? 0), adv = advOf(r.id);
      sh.set(rr, cU, ush || null, S.num);
      sh.set(rr, cA, adv, S.num0);
      if (sum != null) {
        const tax = taxOf(r0(sum));
        sh.set(rr, cT, tax, S.num, taxF(rr, cH));
        sh.set(rr, cJ, r0(sum) - tax - ush - adv, S.numB, jamiF(rr, cH, cT, cU, cA));
      } else {
        // Sdelka: soliq va jami o'z brigadasi varag'idan (Hisoblandi → soliq, Summa − soliq − ushlanma − avans)
        const p = pieceOut.get(r.id);
        sh.set(rr, cT, p?.tax || null, S.autoNum);
        if (p) sh.set(rr, cJ, p.jami, S.autoNumB);
      }
    });
    const tr = H + 1 + rows.length;
    sh.set(tr, 1, `Jami (${rows.length})`, S.tot);
    for (let d = 0; d < nDays; d++) sh.set(tr, c0 + d, null, S.totDec, sumF(H + 1, c0 + d, tr - 1, c0 + d));
    sh.set(tr, cS, null, S.totDec, sumF(H + 1, cS, tr - 1, cS));
    sh.set(tr, cS + 1, null, S.totDec, sumF(H + 1, cS + 1, tr - 1, cS + 1));
    for (const c of [cH, cT, cU, cA, cJ]) sh.set(tr, c, null, S.tot, sumF(H + 1, c, tr - 1, c));
    sh.width(0, 32); sh.width(1, 220); sh.width(2, 140);
    if (groupCol) sh.width(3, 150);
    for (let d = 0; d < nDays; d++) sh.width(c0 + d, 34);
    sh.width(cS + 3, 100);
    for (const c of [cH, cT, cU, cA, cJ]) sh.width(c, 100);
    sh.frz = [H + 1, c0];
    return sh;
  };
  // Birinchi varaq — hamma xodim bitta jadvalda (Tabel → «Barchasi» kabi): komandalar → brigadalar → biriktirilmagan, ichida ism bo'yicha.
  // Sdelkachining puli brigada varag'ida — bu yerda «Hisob» ustunida «sdelka»
  const order = new Map(tabel.groups.map((g, i) => [g.key, i]));
  const allRows = [...tabel.rows].sort((a, b) => (order.get(a.group) ?? 999) - (order.get(b.group) ?? 999) || a.fullName.localeCompare(b.fullName));
  if (allRows.length) push("Barcha xodimlar", tabelSheet("Barcha xodimlar", allRows, true));
  for (const g of tabel.groups) {
    if (g.key === "all" || g.key.startsWith("b:")) continue;
    const rows = tabel.rows.filter((r) => r.group === g.key);
    if (rows.length) push(g.label, tabelSheet(g.label, rows));
  }

  // ── Brigada varaqlari ──
  for (const [gi, g] of bGroups.entries()) {
    const p = bPrep[gi];
    const others = tabel.rows.filter((r) => r.group === g.key && r.payType !== "PIECE");
    if (others.length) push(`${g.label} — tabel`, tabelSheet(`${g.label} (oklad/kunbay)`, others));
    if (!p) continue;
    const { b, qtyOf, hourOf, calc } = p;
    const hasAny = b.members.some((m) => b.hours[m.id] || b.auto[m.id]) || Object.keys(b.qty).length > 0 || Object.keys(b.autoQty).length > 0;
    if (!hasAny && !b.members.length) continue;
    const sh = new Sheet();
    sh.line(0, `${b.brigade.name} — ${title} (brigada varag'i)`, S.title);
    sh.line(1, `Kunlik fond = Σ soni × narx, shu kungi soatga bo'linadi; oy jami 10 000 ga yaxlitlanadi; brak soatga qarab. Kul rang soat — davomatdan. Kul rang son — ishlab chiqarishda brigada «bajarildi» qayd qilgani. ${taxCol} — Hisoblandidan; Ushlanmalar — Ushlanmalar jadvalidan; Avans — shu oy berilgan; Jami = Summa − Soliq − Ushlanmalar − Avans (qo'lga tegadi).`, S.note);
    const H = 3, c0 = 2, cS = c0 + nDays;
    // Ustunlar: cS Soat · +1 Kun · +2 Ulush · +3 Hisoblandi · +4 Brak · +5 Summa · +6 Soliq · +7 Ushlanmalar · +8 Avans · +9 Jami
    const cAm = cS + 3, cSum = cS + 5, cT = cS + 6, cU = cS + 7, cA = cS + 8, cJ = cS + 9;
    ["№", "F.I.O."].forEach((t, i) => sh.set(H, i, t, S.head));
    b.days.forEach((d, i) => sh.set(H, c0 + i, d.day, d.weekend ? S.headWe : S.head));
    ["Soat", "Kun", "Ulush", "Hisoblandi", "Brak", "Summa", taxCol, "Ushlanmalar", "Avans", "Jami"].forEach((t, i) => sh.set(H, cS + i, t, S.head));
    b.members.forEach((m, i) => {
      const rr = H + 1 + i;
      sh.set(rr, 0, i + 1, S.hrs); sh.set(rr, 1, m.fullName + (m.guest ? " (boshqa brigadadan)" : ""), S.txt);
      for (let d = 1; d <= nDays; d++) {
        const x = hourOf(m.id, d);
        sh.set(rr, c0 + d - 1, x?.h ?? null, !x ? S.hrs : x.kind === "l" ? S.live : x.kind === "a" ? S.auto : S.hrs);
      }
      const c = calc.emp[m.id];
      sh.set(rr, cS, c?.hours ?? 0, S.totDec, sumF(rr, c0, rr, c0 + nDays - 1));
      sh.set(rr, cS + 1, c ? Math.round((c.hours / 8) * 100) / 100 : null, S.dec);
      sh.set(rr, cS + 2, c ? r0(c.raw) : null, S.num);
      sh.set(rr, cS + 3, c?.amount ?? null, S.num);
      sh.set(rr, cS + 4, c?.brak || null, S.num);
      sh.set(rr, cS + 5, c ? c.net : null, S.tot);
      // Soliq, ushlanma, avans va jami — xodimning o'z brigadasi varag'ida (boshqa brigadadan kelgani — o'z varag'ida;
      // oklad/kunbay a'zo — tabelida)
      const own = !m.guest && m.payType === "PIECE";
      if (own) {
        const po = pieceOut.get(m.id);
        const ush = r0(held.get(m.id) ?? 0);
        sh.set(rr, cT, po?.tax || null, S.num, taxF(rr, cAm));
        sh.set(rr, cU, ush || null, S.num);
        sh.set(rr, cA, advOf(m.id), S.num0);
        sh.set(rr, cJ, po?.jami ?? 0, S.numB, jamiF(rr, cSum, cT, cU, cA));
      }
    });
    const tr = H + 1 + b.members.length;
    sh.set(tr, 1, "Jami soat", S.tot);
    for (let d = 0; d < nDays; d++) sh.set(tr, c0 + d, calc.dayHours[d] || null, S.totDec, sumF(H + 1, c0 + d, tr - 1, c0 + d));
    sh.set(tr, cS, calc.total.hours, S.totDec, sumF(H + 1, cS, tr - 1, cS));
    sh.set(tr, cS + 2, r0(calc.total.raw), S.tot); sh.set(tr, cS + 3, calc.total.amount, S.tot);
    sh.set(tr, cS + 4, calc.total.brak, S.tot); sh.set(tr, cS + 5, calc.total.net, S.tot);
    for (const c of [cT, cU, cA, cJ]) sh.set(tr, c, null, S.tot, sumF(H + 1, c, tr - 1, c));
    // Mahsulot qatorlari
    const P = tr + 2;
    sh.set(P, 0, "Narx", S.head); sh.set(P, 1, "Mahsulot — soni", S.head);
    b.days.forEach((d, i) => sh.set(P, c0 + i, d.day, d.weekend ? S.headWe : S.head));
    sh.set(P, cS, "Soni", S.head); sh.set(P, cS + 1, "Summa", S.head);
    b.lines.forEach((l, i) => {
      const rr = P + 1 + i;
      sh.set(rr, 0, l.rate, S.num); sh.set(rr, 1, l.name, S.txt);
      let q = 0;
      for (let d = 1; d <= nDays; d++) { const v = qtyOf(l.name, d); q += v?.q ?? 0; sh.set(rr, c0 + d - 1, v?.q || null, v?.auto ? S.auto : S.hrs); }
      sh.set(rr, cS, q, S.totDec, sumF(rr, c0, rr, c0 + nDays - 1));
      sh.set(rr, cS + 1, r0(q * l.rate), S.num, `${addrOf(rr, cS)}*${addrOf(rr, 0)}`);
    });
    const fr = P + 1 + b.lines.length;
    sh.set(fr, 1, "Kunlik fond", S.tot);
    for (let d = 0; d < nDays; d++) sh.set(fr, c0 + d, calc.pool[d] ? r0(calc.pool[d]!) : null, S.tot);
    sh.set(fr, cS + 1, r0(calc.total.pool), S.tot);
    if (calc.lost > 0) sh.set(fr + 1, 1, `${money(r0(calc.lost))} fond soat yozilmagan kunlarda — hech kimga tushmadi`, S.note);
    sh.set(fr + 2, 1, `Brak (oy): ${fmtNum(b.brakManual ?? b.brakAuto)}${b.brakManual == null ? " — brak yozuvlaridan" : ""}`, S.note);
    sh.width(0, 70); sh.width(1, 220);
    for (let d = 0; d < nDays; d++) sh.width(c0 + d, 40);
    for (let i = 0; i < 10; i++) sh.width(cS + i, 90);
    sh.frz = [H + 1, 2];
    push(b.brigade.name, sh);
  }

  // ── Ushlanmalar ──
  {
    const rows = ded.rows.filter((r) => DEDUCTION_CATS.some((c) => r.values[c.key] != null || r.auto[c.key]));
    // Katak qiymati: yozilgani (0 ham), bo'sh bo'lsa — avtomatik
    const val = (r: (typeof rows)[number], c: (typeof DEDUCTION_CATS)[number]["key"]) => { const v = r.values[c]; return v != null ? v : r.auto[c] ?? 0; };
    const sh = new Sheet();
    sh.line(0, `Ushlanmalar — ${title}`, S.title);
    sh.line(1, "Komanda / brigada bo'yicha: sariq qator — guruh va uning jami. Ko'k kursiv — avtomatik (Kirim-Chiqimdan berilgan pul, nasiya va bo'lingan qarz ulushi, aliment daftari), qolgani Ushlanmalar jadvalida yozilgan.", S.note);
    const H = 3, c0 = 3, cJ = c0 + DEDUCTION_CATS.length;
    ["№", "F.I.O.", "Lavozim", ...DEDUCTION_CATS.map((c) => c.label), "Jami"].forEach((t, i) => sh.set(H, i, t, S.head));
    let r = H + 1, n = 0;
    for (const g of byGroup(rows, (x) => ({ key: x.groupKey, label: x.groupKey === "none" ? "Biriktirilmagan" : x.group }), (x) => x.fullName)) {
      sh.set(r, 0, null, S.group); sh.set(r, 1, g.label, S.group); sh.set(r, 2, `${g.rows.length} kishi`, S.group);
      DEDUCTION_CATS.forEach((c, ci) => sh.set(r, c0 + ci, g.rows.reduce((t, x) => t + val(x, c.key), 0) || null, S.groupNum));
      sh.set(r, cJ, g.rows.reduce((t, x) => t + DEDUCTION_CATS.reduce((u, c) => u + val(x, c.key), 0), 0) || null, S.groupNum);
      r++;
      for (const x of g.rows) {
        sh.set(r, 0, ++n, S.hrs); sh.set(r, 1, x.fullName, S.txt); sh.set(r, 2, x.position, S.txt);
        DEDUCTION_CATS.forEach((c, ci) => { const v = x.values[c.key]; sh.set(r, c0 + ci, v != null ? v || 0 : x.auto[c.key] ?? null, v != null ? S.num : S.autoNum); });
        sh.set(r, cJ, null, S.tot, sumF(r, c0, r, cJ - 1));
        r++;
      }
    }
    sh.set(r, 1, `Jami (${n})`, S.tot);
    DEDUCTION_CATS.forEach((c, ci) => sh.set(r, c0 + ci, rows.reduce((t, x) => t + val(x, c.key), 0), S.tot));
    sh.set(r, cJ, rows.reduce((t, x) => t + DEDUCTION_CATS.reduce((u, c) => u + val(x, c.key), 0), 0), S.tot);
    sh.width(0, 32); sh.width(1, 220); sh.width(2, 140);
    for (let c = c0; c <= cJ; c++) sh.width(c, 110);
    sh.frz = [H + 1, 2];
    if (!rows.length) sh.set(H + 1, 1, "Shu oy ushlanma yo'q", S.note);
    push("Ushlanmalar", sh);
  }

  // ── C2026 (oy yakuni vedomosti) ──
  let finalGroups: ReturnType<typeof sheetGroups>["groups"] = [];
  let finalCaption = "";
  {
    const run = await db.payrollRun.findFirst({ where: { month, kind: "FINAL", status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true, docNo: true } });
    let lines: SheetSrcLine[];
    let caption: string;
    const empSel = { fullName: true, position: true, brigadeId: true, teamId: true, brigade: { select: { name: true } }, team: { select: { name: true } } } as const;
    if (run) {
      lines = await db.payrollLine.findMany({ where: { runId: run.id }, orderBy: { employee: { fullName: "asc" } }, include: { employee: { select: empSel } } });
      caption = `vedomost ${run.docNo}`;
    } else {
      const calc = await calculate(month, "FINAL");
      const emps = await db.employee.findMany({ where: { id: { in: calc.map((c) => c.employeeId) } }, select: { id: true, ...empSel } });
      const eOf = new Map(emps.map((e) => [e.id, e]));
      lines = calc.filter((c) => eOf.has(c.employeeId)).sort((a, b) => a.fullName.localeCompare(b.fullName)).map((c) => ({ ...c, id: c.employeeId, employee: eOf.get(c.employeeId)! }));
      caption = "taxminiy — oy yakuni vedomosti hali hisoblanmagan";
    }
    const { groups, total } = sheetGroups(lines);
    finalGroups = groups; finalCaption = caption;
    const sh = new Sheet();
    sh.line(0, `C2026 — ${title} (${caption})`, S.title);
    const H = 2, c0 = 3;
    ["№", "F.I.O.", "Lavozim", ...SHEET_COLS.map((c) => c.label)].forEach((t, i) => sh.set(H, i, t, S.head));
    let r = H + 1, n = 0;
    for (const g of groups) {
      sh.set(r, 0, null, S.group); sh.set(r, 1, g.label, S.group); sh.set(r, 2, `${g.rows.length} kishi`, S.group);
      SHEET_COLS.forEach((c, ci) => sh.set(r, c0 + ci, g.total[c.key] || null, S.groupNum));
      r++;
      for (const row of g.rows) {
        sh.set(r, 0, ++n, S.hrs); sh.set(r, 1, row.fullName, S.txt); sh.set(r, 2, row.position, S.txt);
        SHEET_COLS.forEach((c, ci) => sh.set(r, c0 + ci, row.v[c.key] || null, c.key === "net" ? S.numB : S.num));
        r++;
      }
    }
    sh.set(r, 1, `Jami (${n})`, S.tot);
    SHEET_COLS.forEach((c, ci) => sh.set(r, c0 + ci, total[c.key], S.tot));
    sh.width(0, 32); sh.width(1, 220); sh.width(2, 140);
    SHEET_COLS.forEach((_, ci) => sh.width(c0 + ci, 100));
    sh.frz = [H + 1, 2];
    push("C2026", sh);
  }

  // ── Avans («Аванс наличка», vedomost №1) ──
  {
    const runs = await db.payrollRun.findMany({ where: { month, kind: "ADVANCE", status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, select: { id: true, docNo: true } });
    // Ish haqi → Avans varaqalari (jo'natilgan / yopilgan): avans — yozilgani, to'langan — «Berildi» belgilangani
    const sheets = await db.advanceSheet.findMany({ where: { month, status: { in: ["SENT", "DONE"] } }, orderBy: { createdAt: "asc" }, select: { id: true, docNo: true } });
    const empSel = { fullName: true, position: true, brigadeId: true, teamId: true, brigade: { select: { name: true } }, team: { select: { name: true } } } as const;
    let rows: PayRow[];
    let caption: string;
    if (runs.length || sheets.length) {
      const [ls, al] = await Promise.all([
        db.payrollLine.findMany({ where: { runId: { in: runs.map((x) => x.id) } }, include: { employee: { select: empSel } }, orderBy: { employee: { fullName: "asc" } } }),
        db.advanceLine.findMany({ where: { sheetId: { in: sheets.map((x) => x.id) }, amount: { gt: 0 } }, include: { employee: { select: empSel } }, orderBy: { employee: { fullName: "asc" } } }),
      ]);
      rows = [
        ...ls.map((l) => ({ name: l.employee.fullName, pos: l.employee.position, emp: l.employee, a: Number(l.net), b: Number(l.paid) })),
        ...al.map((l) => ({ name: l.employee.fullName, pos: l.employee.position, emp: l.employee, a: Number(l.amount), b: l.givenAt ? Number(l.amount) : 0 })),
      ].sort((x, y) => x.name.localeCompare(y.name));
      caption = [...runs, ...sheets].map((x) => x.docNo).join(", ");
    } else {
      const calc = (await calculate(month, "ADVANCE")).filter((c) => c.net > 0);
      const emps = await db.employee.findMany({ where: { id: { in: calc.map((c) => c.employeeId) } }, select: { id: true, ...empSel } });
      const eOf = new Map(emps.map((e) => [e.id, e]));
      rows = calc.filter((c) => eOf.has(c.employeeId)).map((c) => ({ name: c.fullName, pos: c.position, emp: eOf.get(c.employeeId)!, a: c.net, b: 0 }));
      caption = "taxminiy — avans vedomosti hali hisoblanmagan";
    }
    push("Avans", payList(`To'lov vedomosti №1 — avans, ${title} (${caption})`, ["Avans", "To'langan"], groupRows(rows)));
  }

  // ── Zarplata 2 («Зарплата 2», vedomost №2): oy yakuni qoldig'i — naqd va plastik qismi ──
  {
    const groups = finalGroups.map((g) => ({ label: g.label, rows: g.rows.filter((x) => x.v.net > 0).map((x) => ({ name: x.fullName, pos: x.position, a: x.v.cash, b: x.v.card })) })).filter((g) => g.rows.length);
    push("Zarplata 2", payList(`To'lov vedomosti №2 — oylik qoldig'i, ${title} (${finalCaption})`, ["Naqd", "Plastik"], groups));
  }

  // ── Qarzlar (Карз) va Ijro (Миб) ──
  {
    const debts = (await listDebts()).filter((d) => !d.cancelledAt);
    const grp = await groupsOf([...new Set(debts.map((d) => d.employee.id))]);
    const sh = new Sheet();
    sh.line(0, "Xodim qarzlari (nasiya va boshlang'ich qoldiq) — komanda / brigada bo'yicha", S.title);
    const H = 2;
    ["№", "F.I.O.", "Sana", "Summa", "Oyiga", "Muddat", "Ushlangan", "Qolgan", "Izoh"].forEach((t, i) => sh.set(H, i, t, S.head));
    let r = H + 1, n = 0;
    for (const g of byGroup(debts, (d) => grp(d.employee.id), (d) => d.employee.fullName)) {
      sh.set(r, 0, null, S.group); sh.set(r, 1, g.label, S.group); sh.set(r, 2, `${new Set(g.rows.map((d) => d.employee.id)).size} kishi`, S.group);
      sh.set(r, 3, g.rows.reduce((t, d) => t + d.amount, 0), S.groupNum); sh.set(r, 6, g.rows.reduce((t, d) => t + d.held, 0), S.groupNum); sh.set(r, 7, g.rows.reduce((t, d) => t + d.left, 0), S.groupNum);
      r++;
      for (const d of g.rows) {
        sh.set(r, 0, ++n, S.hrs); sh.set(r, 1, d.employee.fullName, S.txt);
        sh.set(r, 2, date(d.date), S.txt);
        sh.set(r, 3, d.amount, S.num); sh.set(r, 4, d.monthly, S.num); sh.set(r, 5, `${monthTitle(d.startMonth)} — ${monthTitle(d.endMonth)}`, S.txt);
        sh.set(r, 6, d.held, S.num); sh.set(r, 7, d.left, S.numB); sh.set(r, 8, d.note ?? null, S.txt);
        r++;
      }
    }
    sh.set(r, 1, `Jami (${n})`, S.tot);
    sh.set(r, 3, debts.reduce((t, d) => t + d.amount, 0), S.tot); sh.set(r, 6, debts.reduce((t, d) => t + d.held, 0), S.tot); sh.set(r, 7, debts.reduce((t, d) => t + d.left, 0), S.tot);
    sh.width(0, 32); sh.width(1, 220); sh.width(2, 80); sh.width(5, 170); sh.width(8, 200);
    for (const c of [3, 4, 6, 7]) sh.width(c, 100);
    push("Qarzlar", sh);
  }
  {
    const ws = (await listWithholdings()).filter((w) => !w.cancelledAt);
    const grp = await groupsOf([...new Set(ws.map((w) => w.employee.id))]);
    const sh = new Sheet();
    sh.line(0, "Ijro varaqalari va aliment — komanda / brigada bo'yicha", S.title);
    const H = 2;
    ["№", "F.I.O.", "Turi", "Raqami", "Kreditor", "Umumiy qarz", "Oyiga", "Boshlanish", "Ushlangan", "Qolgan"].forEach((t, i) => sh.set(H, i, t, S.head));
    let r = H + 1, n = 0;
    for (const g of byGroup(ws, (w) => grp(w.employee.id), (w) => w.employee.fullName)) {
      sh.set(r, 0, null, S.group); sh.set(r, 1, g.label, S.group); sh.set(r, 2, `${new Set(g.rows.map((w) => w.employee.id)).size} kishi`, S.group);
      sh.set(r, 8, g.rows.reduce((t, w) => t + w.held, 0), S.groupNum); sh.set(r, 9, g.rows.reduce((t, w) => t + (w.left ?? 0), 0), S.groupNum);
      r++;
      for (const w of g.rows) {
        sh.set(r, 0, ++n, S.hrs); sh.set(r, 1, w.employee.fullName, S.txt); sh.set(r, 2, w.kind === "MIB" ? "Ijro (MIB)" : "Aliment", S.txt);
        sh.set(r, 3, w.caseNo ?? null, S.txt); sh.set(r, 4, w.creditor ?? null, S.txt);
        sh.set(r, 5, w.amount ?? "muddatsiz", S.num); sh.set(r, 6, w.monthly ?? (w.percent != null ? `${w.percent}%` : null), S.num);
        sh.set(r, 7, monthTitle(w.startMonth), S.txt); sh.set(r, 8, w.held, S.num); sh.set(r, 9, w.left ?? null, S.numB);
        r++;
      }
    }
    sh.width(0, 32); sh.width(1, 220); sh.width(2, 90); sh.width(4, 140); sh.width(7, 110);
    for (const c of [3, 5, 6, 8, 9]) sh.width(c, 100);
    push("Ijro", sh);
  }
  return out;
}
