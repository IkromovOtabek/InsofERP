/**
 * Mobil «Yangi kirim»: nakladnoy suratini o'qib, formani to'ldirish (veb skaner bilan bir xil model — `lib/ai/vision`).
 *
 * Hujjatdagi nomlar bazadagidan farq qiladi ("Цемент М400 (мешок)" ↔ "Sement M400"), shuning uchun
 * moslash bosqichma-bosqich: kod → to'liq nom → bir-birining ichida → so'zlar o'xshashligi.
 * Ishonch past bo'lsa qator tanlanmaydi — xodim «Topilmadi» ro'yxatidan qo'lda qo'shadi (o'ylab topilgan
 * xomashyo skladga tushib qolmasin). Saqlash odatdagi `/create` orqali: qoidalarni server qayta tekshiradi.
 */
import { db } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { flatName } from "@/lib/excel";
import { scanInvoice, visionEnabled, type ScanImage } from "@/lib/ai/vision";
import { ListError } from "./list";
import type { MobileUser } from "./auth";

const ROLES = new Set(["PROCUREMENT", "WAREHOUSE", "DIRECTOR"]);
const MAX_IMAGES = 4;
const MAX_BYTES = 6_000_000;

export const scanAllowed = (u: MobileUser) => ROLES.has(u.role) && canDo(u, "stock", "receipt");
export const scanEnabled = visionEnabled;

function parseDataUrl(s: unknown): ScanImage | null {
  if (typeof s !== "string") return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s.trim());
  if (!m || m[2].length * 0.75 > MAX_BYTES) return null;
  return { mime: m[1], base64: m[2] };
}

/**
 * Hujjatdagi son matni → son. "48 109 286" → 48109286; "4,900" (minglik) → 4900; "23,5" / "23.5" → 23.5;
 * "1.234,56" → 1234.56. O'qib bo'lmasa — null.
 */
export function docNumber(raw: string | undefined): number | null {
  let s = (raw ?? "").replace(/[\s ']/g, "").replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Ikkalasi bor: oxirgisi — kasr ajratkichi
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Faqat vergul: 3 xonali guruhlar bo'lsa minglik ("4,900", "1,250,000"), aks holda kasr ("23,5")
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.250.000"
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Kirill ↔ lotin: hujjat ruscha, bazada o'zbekcha (yoki aksincha) yozilgan bo'lishi mumkin
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};
const latin = (s: string) => s.toLowerCase().replace(/[а-яёўқғҳ]/g, (c) => CYR[c] ?? c);
const flat = (s: string) => flatName(latin(s).replace(/[ʻʼ'`‘’]/g, ""));
const tokens = (s: string) => latin(s).replace(/[ʻʼ'`‘’]/g, "").split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

/** So'zlar o'xshashligi (Dice): 0..1. Raqamli so'z (M400, 20mm) mos kelmasa — jarima (boshqa marka). */
function similarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  const used = new Set<number>();
  let hit = 0;
  for (const t of A) {
    const j = B.findIndex((u, k) => !used.has(k) && (u === t || (t.length >= 4 && u.length >= 4 && (u.startsWith(t.slice(0, 4)) || t.startsWith(u.slice(0, 4))))));
    if (j >= 0) { used.add(j); hit++; }
  }
  let score = (2 * hit) / (A.length + B.length);
  const nums = (x: string[]) => x.filter((t) => /\d/.test(t));
  const na = nums(A), nb = nums(B);
  if (na.length && nb.length && !na.some((t) => nb.includes(t))) score *= 0.4;
  return score;
}

type Named = { id: string; name: string; code?: string | null };

/** Eng mos yozuv yoki null (ishonch 0.6 dan past bo'lsa) */
export function bestMatch<T extends Named>(raw: string, list: T[], code?: string): T | null {
  const f = flat(raw);
  if (!f) return null;
  if (code?.trim()) {
    const byCode = list.find((m) => m.code && m.code.toLowerCase() === code.trim().toLowerCase());
    if (byCode) return byCode;
  }
  const exact = list.find((m) => flat(m.name) === f || (m.code && flat(m.code) === f));
  if (exact) return exact;
  let best: T | null = null, score = 0;
  for (const m of list) {
    const fm = flat(m.name);
    let s = similarity(raw, m.name);
    // Biri ikkinchisining ichida ("sement m400" ⊂ "sement m400 qopda") — kuchli belgi, lekin juda qisqa emas
    if (fm.length >= 4 && f.length >= 4 && (f.includes(fm) || fm.includes(f))) s = Math.max(s, 0.8);
    if (s > score) { score = s; best = m; }
  }
  return score >= 0.6 ? best : null;
}

export type ScanPrefill = {
  values: Record<string, string | Record<string, string>[]>;
  /** Xodimga: nima to'ldirildi, nima topilmadi */
  matched: number;
  missing: { name: string; qty: string; unit: string }[];
  supplier: { found: string | null; raw: string };
  model: string;
};

export async function mobileScanReceipt(user: MobileUser, body: unknown): Promise<ScanPrefill> {
  if (!scanAllowed(user)) throw new ListError("FORBIDDEN", "Nakladnoyni skanerlash faqat sklad va snabjeniye uchun", 403);
  if (!visionEnabled()) throw new ListError("UNAVAILABLE", "Rasmdan o'qish sozlanmagan — qatorlarni qo'lda kiriting", 503);
  const list = ((body as { images?: unknown[] } | null)?.images ?? []).slice(0, MAX_IMAGES);
  if (!list.length) throw new ListError("BAD_REQUEST", "Rasm yuborilmadi", 400);
  const images = list.map(parseDataUrl);
  if (images.some((x) => !x)) throw new ListError("BAD_REQUEST", "Rasm formati noto'g'ri yoki juda katta (6 MB gacha)", 400);

  const out = await scanInvoice(images as ScanImage[]);
  const [suppliers, materials] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.material.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true } }),
  ]);

  const supplier = out.doc.supplier ? bestMatch(out.doc.supplier, suppliers) : null;
  const items: Record<string, string>[] = [];
  const missing: ScanPrefill["missing"] = [];
  for (const r of out.rows) {
    const m = bestMatch(r.material, materials, r.code);
    const qty = docNumber(r.qty);
    if (!m) { missing.push({ name: r.material, qty: r.qty ?? "", unit: r.unit ?? "" }); continue; }
    const price = docNumber(r.price);
    items.push({ materialId: m.id, qty: qty != null ? String(qty) : "", price: price != null ? String(price) : "" });
  }

  const values: ScanPrefill["values"] = {};
  if (supplier) values.supplierId = supplier.id;
  if (out.doc.docNo) values.waybillNo = out.doc.docNo.slice(0, 60);
  if (items.length) values.items = items;
  return { values, matched: items.length, missing, supplier: { found: supplier?.name ?? null, raw: out.doc.supplier }, model: out.model };
}
