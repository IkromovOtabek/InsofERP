/**
 * Raqam manbasi (drill-down): hisobotdagi son bosilganda u qaysi yozuvlardan yig'ilganini ko'rsatish.
 * Hisobot o'z hisobini bitta funksiyada qiladi va shu katakni tashkil qilgan yozuvlarni (`DrillItem`) yig'ib beradi —
 * jadvaldagi son va paneldagi ro'yxat bir xil hisobdan chiqadi (alohida so'rov yozilmaydi, farq bo'lmaydi).
 * Panel — `components/drill-panel.tsx`, URL'da `?drill=<qator kaliti>&m=<oy>` (oy yo'q — davr jami).
 */

/** Katakni tashkil qilgan bitta yozuv: kassa yozuvi, reys/zayavka, vedomost, sklad harakati… `amount` — jadvaldagi ishora bilan. */
export type DrillItem = { date: Date | null; title: string; sub?: string; amount: number; href?: string };

/** Jami qatorning tarkibi (Yalpi foyda = Daromad + Tannarx…): har biri o'z navbatida bosiladi. */
export type DrillPart = { key: string; label: string; value: number };

export type Drill = {
  /** Qator nomi */
  title: string;
  /** Oy yoki davr yorlig'i */
  period: string;
  /** Jadvaldagi qiymat */
  value: number;
  /** Miqdor qatori (dona, m³) — so'm emas */
  isQty?: boolean;
  parts: DrillPart[];
  items: DrillItem[];
  note?: string;
};

/** Panelda ko'rsatiladigan yozuvlar soni (qolgani — «yana N ta», jami summaga baribir kiradi). */
export const DRILL_LIMIT = 500;

/** Yozuvlar: sana bo'yicha yangisi tepada; bir kunda — summasi kattasi. */
export function sortDrill(items: DrillItem[]): DrillItem[] {
  return [...items].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0) || Math.abs(b.amount) - Math.abs(a.amount));
}

/** Kassa yozuvining kuni — Kassa jurnalida shu kun ochiladi (alohida yozuv sahifasi yo'q, qator bosilsa tafsilot oynasi). */
export function cashDayHref(d: Date): string {
  const ymd = new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
  return `/payments?from=${ymd}&to=${ymd}`;
}

/** URL'dan kelgan kalit bo'yicha jadvaldan o'qish — faqat o'z kalitlari («constructor», «__proto__» prototipdan kelmasin). */
export const own = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

/** Moliyaviy hisobot qatori (PNL, DDS) — `FinRow` ning drill uchun kerakli qismi. */
type RowLike = { key: string; label: string; kind: string; values: (number | null)[]; total: number | null };

/**
 * Hisobot katagidan panel ma'lumoti: qator qiymati, tarkibi (`parts` — bola yoki qo'shiluvchi qatorlar kalitlari) va yozuvlar.
 * `virtual` — jadvalda qatori yo'q, faqat tarkibdan yig'iladigan ko'rsatkich (statistika kartasi). `col` — ustun, null — davr jami.
 */
export function finDrill(rows: RowLike[], period: string, key: string, col: number | null, o: { parts: string[]; items: DrillItem[]; compose?: boolean; virtual?: string; isQty?: boolean }): Drill | null {
  const row = rows.find((r) => r.key === key);
  if (!o.virtual && (!row || row.kind === "pct" || row.kind === "head")) return null;
  const at = (r: RowLike) => (col === null ? r.total : r.values[col]) ?? 0;
  const parts = o.parts.map((k) => rows.find((r) => r.key === k)).filter((r): r is RowLike => !!r).map((r) => ({ key: r.key, label: r.label, value: at(r) }));
  const value = row ? at(row) : Math.round(parts.reduce((s, p) => s + p.value, 0) * 100) / 100;
  const items = sortDrill(o.items.filter((it) => Math.abs(it.amount) >= 0.005));
  const note = o.compose
    ? "Jami qator — quyidagi qatorlar yig'indisi (chiqim va xarajat manfiy). Har birini bosib ichiga kiring."
    : items.length > DRILL_LIMIT ? `${items.length} ta yozuvdan eng so'nggi ${DRILL_LIMIT} tasi ko'rsatildi — jami summaga hammasi kirgan.` : undefined;
  return { title: row?.label ?? o.virtual!, period, value, isQty: o.isQty, parts, items: items.slice(0, DRILL_LIMIT), note };
}
