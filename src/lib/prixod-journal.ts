import { headerRowIndex, num, numMoney, str } from "./excel";
import { normalizeUnit, toMaterialUnit, UNIT_FALLBACK } from "./unit";

/**
 * Sklad → Kirim → «Excel jurnal»: ko'p sanali, ko'p yetkazuvchili kirim jurnali (bir necha oylik daftar).
 * Ustunlar Sklad → Kirim jurnali bilan bir xil: Sana, Tovar, TTN, O'lchov, Miqdor, Ta'minotchi (Kimdan), Kimga,
 * To'lov (P-r / n-q), Dostavka, Narx, Summa (QQSsiz), QQS, Jami, Manzil, Izoh, Mashina (kim olib keldi), Qayerdan yuklandi,
 * Darhol kimga berildi (Excel'dan avto chiqim yozilmaydi — izohga tushadi). «Snabjenets» ustuni o'qilmaydi (kiritgan xodim yoziladi).
 *
 * Qatorlar «sana + yetkazuvchi + TTN + to'lov» bo'yicha kirim hujjatlariga guruhlanadi. O'qish brauzerda
 * (oldindan ko'rish uchun) va serverda bir xil — shu fayldagi funksiyalar ikkala tomonda ishlaydi.
 *
 * Qo'lda yuritilgan daftarning odatiy xatolari:
 *  · miqdor minglik ajratkichi bilan buzilgan ("2,706" t → 2706): Miqdor × Narx Summadan 10ⁿ barobar katta bo'lsa,
 *    miqdor Summa / Narx ga tuzatiladi (ogohlantirish bilan);
 *  · tonnada 1000 dan ortiq (summa ham shu xato miqdordan hisoblangan) — kg'da yozilgan, 1000 ga bo'linadi;
 *  · Summa xato (Miqdor × Narx dan 10ⁿ barobar katta) — Narx olinadi;
 *  · Narx yo'q — Summa / Miqdor;
 *  · yetkazuvchi bo'sh — «Noma'lum yetkazuvchi».
 */

export const UNKNOWN_SUPPLIER = "Noma'lum yetkazuvchi";

/** Kirim va Chiqim Excel namunasi ustunlari — foydalanuvchi daftari bilan bir xil tartibda. */
export const JOURNAL_HEADERS = [
  "Sana", "Tovar", "TTN №", "O'lchov", "Miqdor", "Ta'minotchi", "Kimga", "To'lov", "Dostavka", "Narx (QQSsiz)", "Summa (QQSsiz)",
  "QQS 12%", "Jami (QQS bilan)", "Manzil", "Snabjenets", "Izoh", "Mashina (kim olib keldi)", "Qayerdan yuklandi", "Darhol kimga berildi",
] as const;

/** Daftardagi qo'shimcha birlik yozuvlari (`lib/unit.ts` dagilardan tashqari). */
const EXTRA_UNITS: Record<string, string> = { m4: "m3", "м4": "m3", kam: "dona", kampi: "dona", komp: "dona", "к-т": "dona" };
export const journalUnit = (v: unknown) => {
  const k = str(v).toLowerCase().replace(/[\s.()]+/g, "");
  return normalizeUnit(EXTRA_UNITS[k] ?? k);
};

type Col = "date" | "material" | "waybill" | "unit" | "qty" | "supplier" | "recipient" | "payment" | "delivery" | "price" | "sum" | "vat" | "total" | "address"
  | "note" | "carrier" | "loadedFrom" | "autoIssue";

/** Sarlavha → ustun. Tartib muhim: «Jami summa» «Summa» dan oldin tekshiriladi. */
const HEADERS: [Col, RegExp][] = [
  ["date", /^(sana|дата|date)/],
  ["material", /tovar|nomi|наимен|товар|material|xomashyo/],
  ["waybill", /ttn|ттн|nakladnoy|накладн/],
  ["unit", /o.?lchov|birlik|ед|изм|unit/],
  ["qty", /miqdor|кол|soni|qty/],
  ["supplier", /kimdan|ta.?minotchi|yetkazuvchi|от кого|постав/],
  // «Darhol kimga berildi» ham «kimga» ni o'z ichiga oladi — avval shu tekshiriladi
  ["autoIssue", /darhol|avto.?chiqim|авто/],
  ["recipient", /kimga|кому/],
  ["carrier", /mashina|машина|kim olib keldi|transport/],
  ["loadedFrom", /qayerdan|yuklandi|откуда|погруз/],
  ["note", /^(izoh|примеч|коммент|note)/],
  ["payment", /to.?lov|деньги|оплат/],
  ["delivery", /dostavka|достав/],
  ["price", /^(narx|цена|price)/],
  ["total", /jami|итого|всего/],
  ["vat", /qqs|ндс|nds/],
  ["sum", /summa|сумма|общ/],
  ["address", /manzil|адрес/],
];

/** Sarlavha qatoridan ustun raqamlari; topilmagan majburiy ustunlar — `missing`. */
export function journalColumns(header: unknown[]): { cols: Partial<Record<Col, number>>; missing: string[] } {
  const cols: Partial<Record<Col, number>> = {};
  header.forEach((h, i) => {
    const t = str(h).toLowerCase();
    if (!t) return;
    // «Summa (QQSsiz)» — QQS ustuni emas; «QQS 12%» — summa emas
    const hit = HEADERS.find(([k, re]) => cols[k] == null && re.test(t) && !(k === "vat" && /qqssiz|без ндс/.test(t)));
    if (hit) cols[hit[0]] = i;
  });
  const need: [Col, string][] = [["date", "Sana"], ["material", "Tovar nomi"], ["qty", "Miqdor"]];
  return { cols, missing: need.filter(([k]) => cols[k] == null).map(([, l]) => l) };
}

/** "20.04.2026", "2026-04-20" yoki Excel sana raqami → "YYYY-MM-DD"; tanilmasa "". */
export function journalDate(v: unknown): string {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = str(v);
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** «P-r» / «П-р» / «perechisleniye» — bank o'tkazmasi; «n-q» / «Н-к» / «naqd» — naqd. */
export function journalPayment(v: unknown): "BANK" | "CASH" | null {
  const t = str(v).toLowerCase().replace(/[\s'`‘’]+/g, "");
  if (!t) return null;
  if (/^(p|п)|bank|банк|o.?tkazma|переч/.test(t)) return "BANK";
  if (/^(n|н)|naqd|нал|cash/.test(t)) return "CASH";
  return null;
}

export type JournalRow = {
  /** Fayldagi qator raqami (Excel'dagi kabi, sarlavha bilan) */
  line: number;
  date: string;
  material: string;
  /** Fayldagi birlik matni (server shu bo'yicha xomashyo birligiga o'giradi) */
  unit: string;
  qty: number;
  /** Birlik narxi QQS'siz */
  price: number;
  /** 0 yoki 12 */
  vatRate: 0 | 12;
  delivery: number;
  supplier: string;
  waybillNo: string;
  payment: "BANK" | "CASH" | null;
  recipient: string;
  address: string;
  note: string;
  /** «Mashina (kim olib keldi)» */
  carrier: string;
  /** «Qayerdan yuklandi» */
  loadedFrom: string;
  /** «Darhol kimga berildi» — oluvchi nomi (kirim importida izohga; chiqim importida «Kimga» bo'sh bo'lsa shu olinadi) */
  autoIssueTo: string;
  /** To'lanadigan summa: Miqdor × Narx + QQS + Dostavka (fayldagi «Jami» emas — u ham xato bo'lishi mumkin) */
  total: number;
};

export type JournalIssue = { line: number; text: string };

const isPow10 = (k: number) => k >= 9 && Math.abs(Math.log10(k) - Math.round(Math.log10(k))) < 0.003;

/** Varaq (`sheet_to_json(..., { header: 1 })`) → qatorlar, xatolar (qator o'tkazib yuboriladi) va ogohlantirishlar. */
export function parseJournal(aoa: unknown[][]): { rows: JournalRow[]; errors: JournalIssue[]; warnings: JournalIssue[]; missing: string[] } {
  const hi = headerRowIndex(aoa);
  if (hi < 0) return { rows: [], errors: [], warnings: [], missing: ["Sana", "Tovar nomi", "Miqdor"] };
  const { cols, missing } = journalColumns(aoa[hi] ?? []);
  if (missing.length) return { rows: [], errors: [], warnings: [], missing };
  const at = (r: unknown[], c: Col) => (cols[c] == null ? "" : r[cols[c]!]);
  const money = (v: unknown) => { const n = str(v) === "" ? NaN : numMoney(v); return Number.isFinite(n) ? n : NaN; };
  const rows: JournalRow[] = [], errors: JournalIssue[] = [], warnings: JournalIssue[] = [];

  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? [];
    const line = i + 1;
    const material = str(at(r, "material"));
    if (!material && !r.some((c) => str(c) !== "")) continue; // bo'sh qator
    if (!material) { errors.push({ line, text: "tovar nomi bo'sh" }); continue; }
    const date = journalDate(at(r, "date"));
    if (!date) { errors.push({ line, text: `${material}: sana noto'g'ri («${str(at(r, "date"))}»)` }); continue; }
    let qty = num(at(r, "qty"));
    if (!(qty > 0)) { errors.push({ line, text: `${material}: miqdor bo'sh yoki 0` }); continue; }

    let price = money(at(r, "price"));
    const sum = money(at(r, "sum"));
    const vat = money(at(r, "vat"));
    if (Number.isFinite(price) && price > 0 && Number.isFinite(sum) && sum > 0) {
      const k = (qty * price) / sum;
      if (isPow10(k)) {
        const fixed = Math.round((sum / price) * 1000) / 1000;
        warnings.push({ line, text: `${material}: miqdor ${qty} → ${fixed} (Summa / Narx bo'yicha tuzatildi)` });
        qty = fixed;
      } else if (isPow10(1 / k)) {
        warnings.push({ line, text: `${material}: Summa xato — Miqdor × Narx olindi` });
      } else if (Math.abs(k - 1) > 0.01) {
        warnings.push({ line, text: `${material}: Miqdor × Narx Summaga teng emas — Narx olindi` });
      }
    } else if (!(price >= 0)) {
      price = Number.isFinite(sum) && sum > 0 ? Math.round((sum / qty) * 100) / 100 : 0;
      if (!(price > 0)) warnings.push({ line, text: `${material}: narx yo'q — 0 so'm bilan kiritiladi` });
    }
    // Summa ham xato miqdordan hisoblangan bo'lsa yuqoridagi tekshiruv ushlamaydi: bir yukda 1000 t bo'lmaydi.
    // Narx tonnaga xos bo'lsa (≥ 100 000 so'm) — miqdor kg'da: 1000 ga bo'linadi; narx ham kg'niki bo'lsa — birlik xato, kg deb olinadi
    let unitRaw = str(at(r, "unit"));
    if (journalUnit(unitRaw) === "t" && qty >= 1000) {
      if (price >= 100_000) {
        warnings.push({ line, text: `${material}: ${qty} t — kg'da yozilgan, ${qty / 1000} t olindi` });
        qty = qty / 1000;
      } else {
        warnings.push({ line, text: `${material}: ${qty} «${unitRaw}» narxi ${price} — birlik kg deb olindi` });
        unitRaw = "kg";
      }
    }
    if (!(qty > 0) || qty > 1e12 || !(price >= 0) || price > 1e15) { errors.push({ line, text: `${material}: miqdor yoki narx noto'g'ri` }); continue; }

    let supplier = str(at(r, "supplier"));
    if (!supplier) { supplier = UNKNOWN_SUPPLIER; warnings.push({ line, text: `${material}: yetkazuvchi bo'sh — «${UNKNOWN_SUPPLIER}»` }); }
    if (unitRaw && !journalUnit(unitRaw)) warnings.push({ line, text: `${material}: birlik «${unitRaw}» tanilmadi — «${UNIT_FALLBACK}»` });
    const delivery = money(at(r, "delivery"));
    const waybill = str(at(r, "waybill"));
    const base = Math.round(qty * price * 100) / 100;
    const vatRate: 0 | 12 = Number.isFinite(vat) && vat > 0 ? 12 : 0;
    const dlv = Number.isFinite(delivery) && delivery > 0 ? delivery : 0;
    rows.push({
      line, date, material, unit: unitRaw, qty, price, vatRate,
      delivery: dlv,
      supplier, waybillNo: waybill === "0" ? "" : waybill, payment: journalPayment(at(r, "payment")),
      recipient: str(at(r, "recipient")), address: str(at(r, "address")),
      note: str(at(r, "note")), carrier: str(at(r, "carrier")), loadedFrom: str(at(r, "loadedFrom")), autoIssueTo: str(at(r, "autoIssue")),
      total: base + dlv + (vatRate ? Math.round(base * 12) / 100 : 0),
    });
  }
  return { rows, errors, warnings, missing: [] };
}

export type JournalDoc = {
  /** Guruh kaliti — shu bilan server bir martalik kalit (clientToken) yasaydi: fayl qayta yuklansa ikkinchi kirim ochilmaydi */
  key: string;
  date: string;
  supplier: string;
  waybillNo: string;
  payment: "BANK" | "CASH" | null;
  recipient: string;
  address: string;
  note: string;
  carrier: string;
  loadedFrom: string;
  autoIssueTo: string;
  rows: JournalRow[];
};

/**
 * Kirim hujjatlariga guruhlash: sana + yetkazuvchi + TTN + to'lov turi (+ «Darhol kimga berildi», bo'lsa — izohi alohida
 * hujjat bo'yicha yoziladi). Sana bo'yicha tartiblangan. Kalit eski fayllar uchun o'zgarmagan (qayta yuklash takror ochmasin).
 */
export function groupJournal(rows: JournalRow[]): JournalDoc[] {
  const m = new Map<string, JournalDoc>();
  for (const r of rows) {
    const auto = (r.autoIssueTo ?? "").trim();
    const key = [r.date, r.supplier.toLowerCase(), r.waybillNo, r.payment ?? ""].join("|") + (auto ? `|auto:${auto.toLowerCase()}` : "");
    const d = m.get(key) ?? {
      key, date: r.date, supplier: r.supplier, waybillNo: r.waybillNo, payment: r.payment, recipient: r.recipient, address: r.address,
      note: r.note ?? "", carrier: r.carrier ?? "", loadedFrom: r.loadedFrom ?? "", autoIssueTo: auto, rows: [],
    };
    d.rows.push(r);
    m.set(key, d);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.supplier.localeCompare(b.supplier));
}

export type JournalMaterial = { name: string; unit: string };

/**
 * Har qatorning xomashyosi: nom bo'yicha (katta-kichik harf farqsiz) mavjud xomashyo yoki fayldagi birinchi birlik bilan yangisi.
 * Daftarda bir tovar turli birlikda yozilgan bo'lsa (bo'yoq «l» va «dona», kabel «m» va «dona») va birlikni o'girib
 * bo'lmasa — qator alohida xomashyoga tushadi: «Qizil kiraska (l)». Shunda hech qaysi qator yo'qolmaydi va
 * qoldiq birliklari aralashmaydi; keyin Sklad → Xomashyo'da birlashtirish yoki nomini o'zgartirish mumkin.
 * `existing` — bazadagi xomashyolar: kichik harfli nom → birlik.
 */
export function journalMaterials(rows: JournalRow[], existing: Map<string, string>): Map<number, JournalMaterial> {
  const unitOf = new Map(existing);
  const out = new Map<number, JournalMaterial>();
  for (const r of rows) {
    const from = journalUnit(r.unit);
    let name = r.material.trim().replace(/\s+/g, " ");
    let k = name.toLowerCase();
    const target = unitOf.get(k);
    if (target && from && !toMaterialUnit(r.qty, r.price, from, target)) {
      name = `${name} (${from})`;
      k = name.toLowerCase();
    }
    const unit = unitOf.get(k) ?? from ?? UNIT_FALLBACK;
    unitOf.set(k, unit);
    out.set(r.line, { name, unit });
  }
  return out;
}
