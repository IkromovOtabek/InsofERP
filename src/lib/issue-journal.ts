import { headerRowIndex, num, numMoney, str } from "./excel";
import { journalColumns, journalDate, journalPayment, journalUnit, type JournalIssue } from "./prixod-journal";
import { UNIT_FALLBACK } from "./unit";
import { normTargetName } from "./issue-target";

/**
 * Sklad → Chiqim → «Excel'dan yuklash»: Kirim bilan bir xil ustunli fayl (Sana, Tovar, TTN №, O'lchov, Miqdor, Ta'minotchi,
 * Kimga, To'lov, Dostavka, Narx (QQSsiz), Summa, QQS, Jami, Manzil, Snabjenets, Izoh, Mashina, Qayerdan yuklandi…).
 * Chiqimga Sana, Tovar, O'lchov, Miqdor, Kimga yoziladi; TTN, Manzil, Izoh, Ta'minotchi — chiqim izohiga.
 * Narx skladdan olinadi (dona narxi yoki o'rtacha — `issuePrices`), fayldagi Narx/To'lov faqat oldindan ko'rishda.
 * «Kimga» bo'sh bo'lsa — «Darhol kimga berildi» ustuni. Qatorlar «sana + kimga» bo'yicha chiqim hujjatlariga guruhlanadi.
 * O'qish brauzerda va serverda bir xil.
 */

export type IssueJournalRow = {
  line: number;
  date: string;
  material: string;
  unit: string;
  qty: number;
  recipient: string;
  supplier: string;
  waybillNo: string;
  address: string;
  note: string;
  payment: "BANK" | "CASH" | null;
  /** Fayldagi summa QQSsiz (Summa yoki Miqdor × Narx) — faqat ko'rsatish uchun */
  fileSum: number;
};

export type IssueJournalDoc = {
  /** Guruh kaliti — server bir martalik kalitni shundan yasaydi: fayl qayta yuklansa chiqim takrorlanmaydi */
  key: string;
  date: string;
  recipient: string;
  note: string;
  rows: IssueJournalRow[];
};

/** Varaq → chiqim qatorlari. Kelajakdagi sana, bo'sh tovar/miqdor/kimga — xato (qator o'tkazib yuboriladi). */
export function parseIssueJournal(aoa: unknown[][], today: string): { rows: IssueJournalRow[]; errors: JournalIssue[]; warnings: JournalIssue[]; missing: string[] } {
  const hi = headerRowIndex(aoa);
  if (hi < 0) return { rows: [], errors: [], warnings: [], missing: ["Sana", "Tovar nomi", "Miqdor", "Kimga"] };
  const { cols, missing } = journalColumns(aoa[hi] ?? []);
  if (cols.recipient == null && cols.autoIssue == null) missing.push("Kimga");
  if (missing.length) return { rows: [], errors: [], warnings: [], missing };
  const at = (r: unknown[], c: keyof typeof cols) => (cols[c] == null ? "" : r[cols[c]!]);
  const money = (v: unknown) => { const n = str(v) === "" ? NaN : numMoney(v); return Number.isFinite(n) ? n : 0; };
  const rows: IssueJournalRow[] = [], errors: JournalIssue[] = [], warnings: JournalIssue[] = [];

  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const line = i + 1;
    const material = str(at(r, "material")).replace(/\s+/g, " ");
    if (!material && !r.some((c) => str(c) !== "")) continue;
    if (!material) { errors.push({ line, text: "tovar nomi bo'sh" }); continue; }
    const date = journalDate(at(r, "date"));
    if (!date) { errors.push({ line, text: `${material}: sana noto'g'ri («${str(at(r, "date"))}»)` }); continue; }
    if (date > today) { errors.push({ line, text: `${material}: sana kelajakda (${date})` }); continue; }
    const qty = num(at(r, "qty"));
    if (!(qty > 0) || qty > 1e12) { errors.push({ line, text: `${material}: miqdor bo'sh yoki 0` }); continue; }
    const recipient = (str(at(r, "recipient")) || str(at(r, "autoIssue"))).replace(/\s+/g, " ");
    if (!recipient) { errors.push({ line, text: `${material}: «Kimga» bo'sh` }); continue; }
    const unit = str(at(r, "unit"));
    if (unit && !journalUnit(unit)) warnings.push({ line, text: `${material}: birlik «${unit}» tanilmadi — «${UNIT_FALLBACK}» deb olinadi` });
    const sum = money(at(r, "sum"));
    const waybill = str(at(r, "waybill"));
    rows.push({
      line, date, material, unit, qty: Math.round(qty * 1000) / 1000, recipient,
      supplier: str(at(r, "supplier")), waybillNo: waybill === "0" ? "" : waybill, address: str(at(r, "address")),
      note: str(at(r, "note")), payment: journalPayment(at(r, "payment")),
      fileSum: sum > 0 ? sum : Math.round(qty * money(at(r, "price")) * 100) / 100,
    });
  }
  return { rows, errors, warnings, missing: [] };
}

/** Chiqim izohi: fayldagi Izoh, TTN, Manzil, Ta'minotchi (takrorlarsiz), 300 belgigacha. */
function docNote(rows: IssueJournalRow[]): string {
  const parts = new Set<string>();
  for (const r of rows) {
    if (r.note) parts.add(r.note);
    if (r.waybillNo) parts.add(`TTN ${r.waybillNo}`);
    if (r.address) parts.add(r.address);
    if (r.supplier) parts.add(`Ta'minotchi: ${r.supplier}`);
  }
  return [...parts, "Excel'dan"].join(" · ").slice(0, 300);
}

/** Chiqim hujjatlariga guruhlash: sana + kimga (katta-kichik harf, probel va tire turlari farqsiz). Sana bo'yicha tartiblangan. */
export function groupIssueJournal(rows: IssueJournalRow[]): IssueJournalDoc[] {
  const m = new Map<string, IssueJournalDoc>();
  for (const r of rows) {
    const key = `${r.date}|${normTargetName(r.recipient)}`;
    const d = m.get(key) ?? { key, date: r.date, recipient: r.recipient, note: "", rows: [] };
    d.rows.push(r);
    m.set(key, d);
  }
  const docs = [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.recipient.localeCompare(b.recipient));
  for (const d of docs) d.note = docNote(d.rows);
  return docs;
}
