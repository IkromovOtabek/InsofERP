import type { MaterialCategory } from "@/generated/prisma";
import type { TurnoverRow } from "@/lib/stock-turnover";
import type { StockPeriod } from "@/components/stock-period";
import { MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";
import { unitShort } from "@/lib/unit";
import { dateRu } from "@/lib/format";

/**
 * Sklad → «Qoldiqlar» jadvali: ko'rinadigan qatorlar va Excel varag'i. Sahifa ham, Excel server action'i ham
 * (`stockBalanceExcel`) shu yerdan oladi — Excel'dagi qatorlar ekrandagi bilan aynan bir xil bo'lsin.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Rol ko'radigan kategoriyalar (`categoriesFor`), qidiruv (nomi yoki kodi) va tanlangan kategoriya bo'yicha. */
export function filterTurnover(all: TurnoverRow[], p: { cats: MaterialCategory[]; kat: MaterialCategory | null; q: string }) {
  const qLow = p.q.toLowerCase();
  const seen = all.filter((r) => p.cats.includes(r.category) && (!qLow || r.name.toLowerCase().includes(qLow) || r.code.toLowerCase().includes(qLow)));
  return { seen, rows: p.kat ? seen.filter((r) => r.category === p.kat) : seen };
}

export function turnoverTotals(rows: TurnoverRow[]) {
  return rows.reduce((a, r) => ({ open: a.open + r.open.s, in: a.in + r.in.s, out: a.out + r.out.s, close: a.close + r.close.s, approx: a.approx || r.approx }), { open: 0, in: 0, out: 0, close: 0, approx: false });
}

/**
 * Excel — barcha ustunlar (ekrandagi kabi) + «Jami» qatori; raqamlar raqam bo'lib (Excel'da qo'shib bo'lsin).
 * Sarlavha va matnlar o'zbekcha — ExcelButton ularni ekrandagi tilga o'giradi.
 */
export function balanceExcelRows(turnover: TurnoverRow[], period: StockPeriod): Record<string, string | number | null>[] {
  const toIncl = new Date(period.to); toIncl.setDate(toIncl.getDate() - 1);
  const openH = period.all ? "Boshlang'ich qoldiq" : `${dateRu(period.from)} holatiga qoldiq`, closeH = `${dateRu(toIncl)} oxiridagi qoldiq`;
  const rows: Record<string, string | number | null>[] = turnover.map((r, i) => ({
    "№": i + 1, "Nomi": r.name, "Kod": r.code, "Kategoriya": MATERIAL_CATEGORY_LABEL[r.category], "Birlik": unitShort(r.unit),
    "Dona narxi": r.unitPrice, "O'rtacha tannarx": r.avgCost == null ? null : r2(r.avgCost),
    [`${openH}, miqdor`]: r.open.q, [`${openH}, summa`]: r.open.s,
    "Kirim, miqdor": r.in.q, "Kirim, summa": r.in.s,
    "Chiqim, miqdor": r.out.q, "Chiqim, summa": r.out.s,
    [`${closeH}, miqdor`]: r.close.q, [`${closeH}, jami summa`]: r.close.s,
    "Minimal qoldiq": r.minStock, "Baholash": r.approx ? "≈ narxsiz qismi bor" : "", "Holat": r.isActive ? "" : "arxiv",
  }));
  const tot = turnoverTotals(turnover);
  if (turnover.length) rows.push({
    "№": null, "Nomi": "Jami", "Kod": "", "Kategoriya": "", "Birlik": "", "Dona narxi": null, "O'rtacha tannarx": null,
    [`${openH}, miqdor`]: null, [`${openH}, summa`]: r2(tot.open), "Kirim, miqdor": null, "Kirim, summa": r2(tot.in),
    "Chiqim, miqdor": null, "Chiqim, summa": r2(tot.out), [`${closeH}, miqdor`]: null, [`${closeH}, jami summa`]: r2(tot.close),
    "Minimal qoldiq": null, "Baholash": tot.approx ? "≈" : "", "Holat": "",
  });
  return rows;
}
