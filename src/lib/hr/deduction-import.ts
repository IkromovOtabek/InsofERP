import { db } from "@/lib/db";
import { dayUtc, monthDays } from "@/lib/davomat";
import { parseWorkbook } from "@/lib/payroll-sheets";
import { colName } from "@/lib/sheet-calc";
import { matchPeople, nameKey, type PersonMatch } from "./tabel";
import { createOpeningDebt, createWithholding, saveDeductions } from "./deductions";
import type { DeductionCat } from "./deduction-cats";

/**
 * Ushlanmalar importi (Excel → ERP):
 *   · C2026 (bosh hisob) G–K ustunlari → shu oy ushlanmalari (aliment, qarz to'lovi, oylikdan qarz, to'y puli, jarima);
 *   · «Карз» → qarz qoldig'i (C sentabrdan o'tgan + D yangi) va oylik ulush (J) — `EmployeeDebt`, kassasiz;
 *   · «Миб карздорлик» → ijro varaqalari (qarz D, foiz C, ish raqami G) — `Withholding`.
 * C2026 H (qarz to'lovi) va Карз J farq qilsa — ogohlantirish (Excel'da qo'lda ko'chirishda qator siljigan bo'lishi mumkin).
 */

type Who = { userId: string };
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(",", ".")) : 0);
const r0 = (n: number) => Math.round(n);

const C2026_COLS: [RegExp, DeductionCat][] = [[/алимент|удержан/i, "ALIMENT"], [/ойма.?ой/i, "LOAN"], [/ойлик\s+хисобидан/i, "SALARY_DEBT"], [/тугилган|туй/i, "FUND"], [/штраф/i, "FINE"]];

export type DeductImportPerson = PersonMatch & {
  key: string; name: string;
  values: Partial<Record<DeductionCat, number>>;
  loan: { balance: number; monthly: number } | null;
  cases: { caseNo: string | null; percent: number | null; debt: number; held: number }[];
  warnings: string[];
};
export type DeductImportPreview = { month: string; sources: string[]; people: DeductImportPerson[]; totals: Partial<Record<DeductionCat, number>>; warnings: string[] };

export async function previewDeductImport(buf: Buffer, month: string): Promise<DeductImportPreview> {
  const sheets = parseWorkbook(buf);
  const byKey = new Map<string, Omit<DeductImportPerson, keyof PersonMatch>>();
  const person = (name: string) => {
    const key = nameKey(name);
    const p = byKey.get(key) ?? { key, name: name.replace(/\s+/g, " ").trim(), values: {}, loan: null, cases: [], warnings: [] };
    byKey.set(key, p);
    return p;
  };
  const sources: string[] = [];
  const carzJ = new Map<string, number>();
  for (const sh of sheets) {
    const at = (r: number, c: number) => sh.data.cells[`${colName(c)}${r + 1}`]?.v;
    const text = (r: number, c: number) => { const v = at(r, c); return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; };
    // Sarlavha qatori (birinchi 6 qatordan) va ustunlar
    for (let hr = 0; hr < Math.min(6, sh.data.nr); hr++) {
      const cols = Array.from({ length: sh.data.nc }, (_, c) => text(hr, c));
      const nameC = cols.findIndex((x) => /^ф\.?\s*и\.?\s*о\.?$/i.test(x));
      if (nameC < 0) continue;
      const rows = (fn: (r: number, name: string) => void) => {
        for (let r = hr + 1; r < sh.data.nr; r++) {
          const name = text(r, nameC);
          if (!name || /^(итого|жами|сумма|директор|гл\.|расч|нач\.)/i.test(name)) continue;
          fn(r, name);
        }
      };
      // C2026: «подоход» + ushlanma ustunlari
      if (cols.some((x) => /подоход/i.test(x)) && cols.some((x) => /штраф/i.test(x))) {
        const map = C2026_COLS.map(([re, cat]) => ({ cat, c: cols.findIndex((x) => re.test(x)) })).filter((x) => x.c >= 0);
        sources.push(`${sh.name.trim()} (ushlanmalar)`);
        rows((r, name) => {
          const vals = map.map((m) => ({ cat: m.cat, v: r0(num(at(r, m.c))) })).filter((x) => x.v > 0);
          if (!vals.length) return;
          const p = person(name);
          for (const v of vals) p.values[v.cat] = (p.values[v.cat] ?? 0) + v.v;
        });
        break;
      }
      // Карз: «утган» (o'tgan qoldiq) + «босиб» (ushlangan)
      if (cols.some((x) => /утган/i.test(x)) && cols.some((x) => /босиб/i.test(x))) {
        const cC = cols.findIndex((x) => /утган/i.test(x) && !/ойига/i.test(x));
        const cD = cols.findIndex((x, i) => i > cC && /^ойма ой олинадиган карз$/i.test(x));
        const cJ = cols.findIndex((x) => /ойма ой.*босиб/i.test(x));
        sources.push(`${sh.name.trim()} (qarz qoldig'i)`);
        rows((r, name) => {
          const balance = r0(num(at(r, cC)) + (cD >= 0 ? num(at(r, cD)) : 0)), j = cJ >= 0 ? r0(num(at(r, cJ))) : 0;
          if (balance <= 0 && j <= 0) return;
          const p = person(name);
          p.loan = { balance: (p.loan?.balance ?? 0) + balance, monthly: (p.loan?.monthly ?? 0) + j };
          carzJ.set(p.key, (carzJ.get(p.key) ?? 0) + j);
        });
        break;
      }
      // Миб: «ушлаб колинадиган фоиз» / «карздорлик суммаси»
      if (cols.some((x) => /карздорлик суммаси/i.test(x))) {
        const cP = cols.findIndex((x) => /фоиз/i.test(x)), cD = cols.findIndex((x) => /карздорлик суммаси/i.test(x));
        const cE = cols.findIndex((x) => /ушлаб колинди/i.test(x)), cF = cols.findIndex((x) => /^колдик/i.test(x));
        sources.push(`${sh.name.trim()} (ijro varaqalari)`);
        rows((r, name) => {
          const debt = r0(num(at(r, cD)));
          if (debt <= 0) return;
          const caseRaw = at(r, (cF >= 0 ? cF : cE) + 1);
          person(name).cases.push({
            caseNo: caseRaw != null && String(caseRaw).trim() ? String(caseRaw).replace(/\.0+$/, "").trim() : null,
            percent: cP >= 0 && num(at(r, cP)) > 0 ? num(at(r, cP)) : null, debt, held: cE >= 0 ? r0(num(at(r, cE))) : 0,
          });
        });
        break;
      }
    }
  }
  const warnings: string[] = [];
  if (!sources.length) warnings.push("Faylda C2026 (ushlanma ustunlari), «Карз» yoki «Миб» varag'i topilmadi");
  const days = monthDays(month);
  const { results } = await matchPeople([...byKey.keys()], dayUtc(days[0]!.iso), dayUtc(days[days.length - 1]!.iso));
  const people: DeductImportPerson[] = [...byKey.values()].map((p) => ({ ...p, ...results.get(p.key)! }))
    .sort((a, b) => Number(!!a.match) - Number(!!b.match) || a.name.localeCompare(b.name));
  // Varaqlararo tekshiruv — bitta xodim (ERP moslugi bo'yicha; topilmagan bo'lsa ism bo'yicha): C2026 ↔ «Карз» J, C2026 ↔ «Миб» E
  const groups = new Map<string, DeductImportPerson[]>();
  for (const p of people) { const g = p.match?.employeeId ?? `k:${p.key}`; groups.set(g, [...(groups.get(g) ?? []), p]); }
  for (const list of groups.values()) {
    const loan = list.reduce((s, p) => s + (p.values.LOAN ?? 0), 0), alim = list.reduce((s, p) => s + (p.values.ALIMENT ?? 0), 0);
    const inCarz = list.some((p) => carzJ.has(p.key)), j = list.reduce((s, p) => s + (carzJ.get(p.key) ?? 0), 0);
    const mibList = list.flatMap((p) => p.cases), mib = mibList.reduce((s, c) => s + c.held, 0);
    const host = list.find((p) => Object.keys(p.values).length) ?? list[0]!;
    if (inCarz && loan !== j) host.warnings.push(`C2026 «ойма-ой карз» ${loan}, «Карз» varag'ida ${j} — qaysi biri to'g'ri ekanini tekshiring`);
    if (!inCarz && loan > 0) host.warnings.push(`C2026 da qarz to'lovi ${loan}, lekin «Карз» varag'ida qarzi yo'q — boshqa odamniki emasmi?`);
    if (mibList.length && mib !== alim) host.warnings.push(`«Миб» da shu oy ${mib} ushlangan, C2026 «алимент» ${alim}`);
  }
  const totals: DeductImportPreview["totals"] = {};
  for (const p of people) for (const [c, v] of Object.entries(p.values) as [DeductionCat, number][]) totals[c] = (totals[c] ?? 0) + v;
  return { month, sources, people, totals, warnings };
}

/**
 * Qo'llash: oy ushlanmalari (`saveDeductions`), qarz qoldiqlari va ijro varaqalari (takror yozilmaydi — xodimda shu oy
 * Excel'dan ochilgan qarz / shu raqamli ijro bo'lsa o'tkazib yuboriladi). Qo'lda tanlangan moslik eslab qolinadi.
 */
export async function applyDeductImport(who: Who, month: string, people: { key: string; employeeId: string; remember?: boolean; values: Partial<Record<DeductionCat, number>>; loan: { balance: number; monthly: number } | null; cases: { caseNo: string | null; percent: number | null; debt: number; held: number }[] }[]) {
  const items = people.flatMap((p) => Object.entries(p.values).filter(([, v]) => typeof v === "number" && v > 0).map(([category, v]) => ({ employeeId: p.employeeId, category, value: String(v) })));
  const r = await saveDeductions(who, month, items, { source: "Excel import" });
  if ("error" in r && r.error) return { error: r.error };
  let debts = 0, cases = 0;
  const skipped: string[] = [];
  for (const p of people) {
    if (p.loan && p.loan.balance > 0) {
      const exists = await db.employeeDebt.findFirst({ where: { employeeId: p.employeeId, startMonth: month, cashTxId: null, cancelledAt: null, note: { startsWith: "Excel «Карз»" } }, select: { id: true } });
      if (exists) skipped.push(`qarz qoldig'i allaqachon bor`);
      else {
        const d = await createOpeningDebt(who, { employeeId: p.employeeId, amount: p.loan.balance, monthly: p.loan.monthly || p.loan.balance, startMonth: month, note: "Excel «Карз» — boshlang'ich qoldiq" });
        if ("error" in d) skipped.push(d.error!); else debts++;
      }
    }
    for (const c of p.cases) {
      const exists = await db.withholding.findFirst({ where: { employeeId: p.employeeId, cancelledAt: null, ...(c.caseNo ? { caseNo: c.caseNo } : { amount: c.debt }) }, select: { id: true } });
      if (exists) { skipped.push(`ijro ${c.caseNo ?? c.debt} allaqachon bor`); continue; }
      // Oylik summa — shu oy Excel'da ushlangani (keyingi oylarga taklif); u ham foiz ham bo'lmasa — 0 (Ushlanmalar jadvalida qo'lda)
      const w = await createWithholding(who, { employeeId: p.employeeId, kind: "MIB", caseNo: c.caseNo, amount: c.debt, percent: c.percent, monthly: c.held > 0 ? c.held : c.percent ? null : 0, startMonth: month, note: "Excel «Миб» dan" });
      if ("error" in w) skipped.push(w.error!); else cases++;
    }
    if (p.remember && p.key) await db.employeeAlias.upsert({ where: { name: p.key }, create: { name: p.key, employeeId: p.employeeId, createdById: who.userId }, update: { employeeId: p.employeeId } });
  }
  return { saved: ("saved" in r ? r.saved : 0) ?? 0, debts, cases, skipped: [...new Set(skipped)].slice(0, 20) };
}
