/**
 * Skaner qilingan nakladnoy (`api/scan/receipt` natijasi) → Sklad «Kirim» formasining qiymatlari.
 * Brauzerda ishlaydi: xomashyo, yetkazuvchi va oluvchi nomlari spravochnik bilan solishtiriladi
 * (kirill/lotin farqi, «ООО», «MChJ» kabi shakllar e'tiborsiz). Hech narsa saqlanmaydi — forma
 * ko'rish rejimida ochiladi, foydalanuvchi rasm bilan solishtirib (kerak bo'lsa tahrirlab) saqlaydi.
 *
 * Qoidalar:
 * - xomashyo topilmasa — qator «yangi»: saqlashda nakladnoydagi nom va birlik bilan yaratiladi;
 * - yetkazuvchi faqat yetarli o'xshash bo'lsa tanlanadi, aks holda qo'lda tanlanadi;
 * - nakladnoyda QQS bo'lmasa — QQS 0 va to'lov turi «Naqd pul»; QQS bo'lsa stavka (12/6%) QQS summasidan aniqlanadi,
 *   narx QQS bilan yozilgan bo'lsa QQS'siz narxga o'giriladi (forma narxni QQS'siz kutadi).
 */

import { num, numMoney, translit } from "@/lib/excel";
import { fmtNum } from "@/lib/format";
import { normalizeUnit, toMaterialUnit, unitShort, UNIT_FALLBACK, type MaterialUnit } from "@/lib/unit";

export type ScanInput = { doc: { supplier: string; date: string; docNo: string; recipient?: string }; rows: Record<string, string>[] };
export type ScanVat = "12" | "6" | "0";
/** `exact` — nomi/kodi aynan mos, `similar` — o'xshash (tekshirish kerak), `new` — spravochnikda yo'q. */
export type ScanMatch = "exact" | "similar" | "new";
export type ScannedRow = {
  materialId: string; // `new` da bo'sh
  newName: string; newUnit: MaterialUnit; // `new` uchun
  scanName: string; match: ScanMatch; warn: string;
  qty: string; price: string; vat: ScanVat;
};
export type ScannedDoc = {
  date: string; dateFromDoc: boolean;
  supplierId: string; supplierName: string; // supplierName — nakladnoydagi yozuv (topilmasa ko'rsatiladi)
  recipientId: string; waybillNo: string; payment: "BANK" | "CASH"; note: string;
  rows: ScannedRow[];
};

type Named = { id: string; name: string };
type Mat = Named & { code: string; unit: string };

/** Tashkiliy-huquqiy shakllar — nom solishtirishda tashlanadi. */
const LEGAL = new Set(["ooo", "mchj", "chp", "hk", "ip", "ao", "aj", "oao", "zao", "llc", "ltd"]);

/** Taqqoslash kaliti: kirill → lotin, kichik harf, belgilarsiz («Цемент М-400» va «Sement M400» yaqinlashadi). */
export function nameKey(s: string): string {
  return translit(s).replace(/['ʻʼ`’‘"«»]/g, "").replace(/w/g, "v").replace(/x/g, "h").replace(/q/g, "k").replace(/c/g, "s")
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && !LEGAL.has(t)).join(" ");
}

function bigrams(s: string): Map<string, number> {
  const t = ` ${s} `, m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}
/** O'xshashlik 0…1 (Dice, harf juftliklari bo'yicha) — kalitlar `nameKey` dan o'tgan bo'lsin. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, n = 0;
  for (const [g, v] of A) { inter += Math.min(v, B.get(g) ?? 0); n += v; }
  for (const v of B.values()) n += v;
  return (2 * inter) / n;
}

/** Shu darajadan o'xshash xomashyo tanlanadi (ko'rish rejimida «o'xshash — tekshiring» bilan). */
const MATERIAL_MIN = 0.72;
/** Yetkazuvchi — biroz yumshoqroq: nakladnoyda nom ko'pincha qisqa/qo'lda yozilgan, u baribir ko'rinib turadi. */
const SUPPLIER_MIN = 0.65;
/** Oluvchi («Kimga») — so'z bo'yicha (familiya), masalan «нач. Болтабоев Ш» ↔ «Boltaboyev Sh.». */
const RECIPIENT_MIN = 0.75;

function best<T>(key: string, list: T[], keyOf: (x: T) => string): { item: T | null; score: number } {
  let item: T | null = null, score = 0;
  for (const x of list) { const s = similarity(key, keyOf(x)); if (s > score) { score = s; item = x; } }
  return { item, score };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const ok = (n: number) => Number.isFinite(n) && n > 0;

/** QQS stavkasi QQS summasidan: narx QQS'siz (QQS/tovar ≈ 12%) yoki QQS bilan (QQS/(tovar−QQS) ≈ 12%). */
function vatOf(qty: number, price: number, nds: number): { rate: ScanVat; price: number } {
  if (!ok(nds) || !ok(qty) || !ok(price)) return { rate: "0", price };
  const pick = (k: number): ScanVat | null => (Math.abs(k - 0.12) <= 0.015 ? "12" : Math.abs(k - 0.06) <= 0.01 ? "6" : null);
  const base = qty * price;
  const ex = pick(nds / base);
  if (ex) return { rate: ex, price };
  const inc = base > nds ? pick(nds / (base - nds)) : null;
  if (inc) return { rate: inc, price: price / (1 + Number(inc) / 100) };
  return { rate: "12", price };
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.015);

export function scanToPrixod(scan: ScanInput, ctx: { materials: Mat[]; suppliers: Named[]; recipients: Named[]; today: string }): ScannedDoc {
  const mats = ctx.materials.map((m) => ({ m, key: nameKey(m.name), code: m.code.trim().toLowerCase() }));
  const parsed = scan.rows.map((r) => {
    const qty = num(r.qty), nds = numMoney(r.nds), sum = numMoney(r.sum);
    let price = numMoney(r.price);
    if (!ok(price) && ok(sum) && ok(qty)) price = (ok(nds) && sum > nds ? sum - nds : sum) / qty;
    return { r, qty, price, nds, sum };
  });
  const anyVat = parsed.some((p) => ok(p.nds));

  const rows = parsed.map(({ r, qty, price: rawPrice, nds, sum }): ScannedRow => {
    const scanName = (r.material ?? "").trim();
    const scanUnit = (r.unit ?? "").trim();
    const key = nameKey(scanName), code = (r.code ?? "").trim().toLowerCase();
    const warns: string[] = [];

    const v = anyVat ? vatOf(qty, rawPrice, nds) : { rate: "0" as ScanVat, price: rawPrice };
    // Summa nazorati: o'qishdagi xato (raqam noto'g'ri o'qilgan) ko'rish rejimida ko'zga tashlansin
    if (ok(sum) && ok(qty) && ok(rawPrice)) {
      const goods = qty * v.price, vat = (goods * Number(v.rate)) / 100;
      if (![goods, goods + vat, qty * rawPrice].some((x) => near(x, sum))) warns.push(`Nakladnoyda summa ${fmtNum(sum, 0)} — miqdor × narxga mos emas, tekshiring`);
    }
    if (!ok(qty)) warns.push("Miqdor o'qilmadi");
    if (!ok(rawPrice)) warns.push("Narx o'qilmadi");

    const exact = mats.find((x) => (code && x.code === code) || (key && x.key === key));
    const near_ = exact ? null : best(key, mats, (x) => x.key);
    const hit = exact ?? (near_ && near_.score >= MATERIAL_MIN ? near_.item : null);
    let match: ScanMatch = exact ? "exact" : hit ? "similar" : "new";
    let q = qty, p = v.price;
    if (hit) {
      const conv = toMaterialUnit(qty, v.price, scanUnit, hit.m.unit);
      if (conv) { q = conv.qty; p = conv.price; }
      else { warns.push(`Birlik: nakladnoyda «${scanUnit}», spravochnikda «${unitShort(hit.m.unit)}» — tekshiring`); match = "similar"; }
    }
    return {
      materialId: hit?.m.id ?? "",
      newName: hit ? "" : scanName.slice(0, 200), newUnit: normalizeUnit(scanUnit) ?? UNIT_FALLBACK,
      scanName, match, warn: warns.join(" · "),
      qty: ok(q) ? String(r3(q)) : "", price: ok(p) ? String(r2(p)) : "", vat: v.rate,
    };
  });

  // Yetkazuvchi
  const supKey = nameKey(scan.doc.supplier ?? "");
  const sup = supKey ? best(supKey, ctx.suppliers, (x) => nameKey(x.name)) : { item: null, score: 0 };
  // Oluvchi: nakladnoydagi «Kimga» so'zlaridan biri oluvchi nomidagi so'zga yaqin bo'lsa
  const recWords = nameKey(scan.doc.recipient ?? "").split(" ").filter((w) => w.length >= 4);
  let recipientId = "", recScore = 0;
  for (const x of ctx.recipients) {
    for (const w of nameKey(x.name).split(" ").filter((t) => t.length >= 4)) {
      for (const rw of recWords) { const s = similarity(w, rw); if (s > recScore) { recScore = s; recipientId = x.id; } }
    }
  }

  const d = (scan.doc.date ?? "").trim();
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && d >= "2000-01-01" && d <= ctx.today;
  const note = scan.rows.filter((r) => (r.note ?? "").trim()).map((r) => `${(r.material ?? "").trim()}: ${(r.note ?? "").trim()}`).join("; ").slice(0, 1000);

  return {
    date: dateOk ? d : ctx.today, dateFromDoc: dateOk,
    supplierId: sup.item && sup.score >= SUPPLIER_MIN ? sup.item.id : "", supplierName: (scan.doc.supplier ?? "").trim(),
    recipientId: recScore >= RECIPIENT_MIN ? recipientId : "",
    waybillNo: (scan.doc.docNo ?? "").trim().slice(0, 60),
    payment: anyVat ? "BANK" : "CASH",
    note, rows,
  };
}
