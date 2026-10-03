/**
 * Davomat "Keldi" — yuz bilan tasdiqlash.
 *
 * Brigadir/sex boshlig'i ilovada kamerani xodimga qaratadi; kadr xodimning kadrdagi profil
 * surati bilan solishtiriladi. Solishtirishni `vision.ts` dagi model qiladi (Claude / OpenAI / Groq —
 * qaysi kalit bo'lsa). Bu biometrik tizim emas — ehtimoliy tekshiruv: model "bir odam" desa va
 * ishonchi chegaradan yuqori bo'lsa, davomat yoziladi; aks holda yozilmaydi (qat'iy rejim).
 *
 * Rasmlar modelga yuborishdan oldin kichraytiriladi (`sharp`): telefon kadri 3–5 MB bo'ladi,
 * modelga 640 px yetadi — tez va arzon.
 */
import sharp from "sharp";
import { askVision, extractJson, visionEnabled, type ScanImage } from "./vision";
import { sniffFileKind } from "@/lib/uploads";

export type FaceMatch = { match: boolean; confidence: number; reason: string };

/** Shundan past ishonch — "tasdiqlanmadi" (model "ha" desa ham). */
export const FACE_MIN_CONFIDENCE = 75;
/**
 * Uzun tomoni. Groq bepul tarifi daqiqasiga ~7000 kirish tokeni beradi, 640 px da ikki rasm ≈ 4500 token
 * (daqiqasiga bitta tekshiruv). 512 px yuzni ajratishga yetadi va so'rovni ~3000 tokenga tushiradi.
 */
const SIDE = 512;

const PROMPT = `Sen — zavod davomat tizimining yuz tekshiruvchisisan. Ikkita rasm berilgan:
1-rasm — xodimning kadrlar bo'limidagi profil surati (etalon).
2-rasm — hozir kamerada olingan kadr.

Vazifa: ikkala rasmdagi odam BIR ODAMMI? Yuz tuzilishini solishtir: ko'z oralig'i, burun va lab shakli, yuz ovali, qosh, quloq, xollar/chandiqlar. Soch turmagi, soqol, ko'zoynak, bosh kiyim, yorug'lik va rakurs farqi bir odam bo'lishiga xalaqit bermaydi.

Faqat JSON qaytar, boshqa matn yozma:
{"match": true yoki false, "confidence": 0-100, "reason": "bir jumla, o'zbekcha"}

Qoidalar:
- 2-rasmda odam yuzi aniq ko'rinmasa (qorong'i, yuz burilgan, niqob, bir nechta odam, rasm surati/ekran) — match=false, reason'da sababini yoz.
- 1-rasmda yuz bo'lmasa — match=false, reason: "etalon suratda yuz yo'q".
- Ishonchsiz bo'lsang confidence'ni past qo'y — "ha" deb o'ylab topma.`;

/**
 * sharp xavfsizligi (sharp 0.33.5 da qoladi — server CPU cheklovi, yangilanmaydi):
 *  · faqat JPEG / PNG / WEBP — HEIF/AVIF/SVG/TIFF dekoderlari (libheif, librsvg, libtiff) eng ko'p
 *    zaiflik topilgan joy, ularga umuman yetib bormaymiz: avval fayl boshidagi baytlar, keyin sharp
 *    o'zi aniqlagan format tekshiriladi;
 *  · `limitInputPixels` — "dekompressiya bombasi" (kichik fayl, ulkan o'lcham) xotirani yeb qo'ymasin;
 *  · `failOn: "error"` — buzuq fayl jimgina "tuzatilib" o'qilmaydi, rad etiladi.
 */
const FACE_FORMATS = new Set(["jpeg", "png", "webp"]);
const SHARP_OPTS = { failOn: "error", limitInputPixels: 40_000_000 } as const;

/** Rasmni modelga mos o'lchamga keltiradi (JPEG, uzun tomoni ≤ 512 px). Faqat JPEG/PNG/WEBP qabul qilinadi. */
export async function faceImage(input: Buffer): Promise<ScanImage> {
  const kind = sniffFileKind(input);
  if (kind !== "jpg" && kind !== "png" && kind !== "webp") throw new Error("Rasm formati qo'llab-quvvatlanmaydi — faqat JPEG, PNG yoki WEBP");
  const meta = await sharp(input, SHARP_OPTS).metadata();
  if (!meta.format || !FACE_FORMATS.has(meta.format)) throw new Error("Rasm formati qo'llab-quvvatlanmaydi — faqat JPEG, PNG yoki WEBP");
  const buf = await sharp(input, SHARP_OPTS).rotate().resize(SIDE, SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return { mime: "image/jpeg", base64: buf.toString("base64") };
}

export const faceCheckEnabled = visionEnabled;

/** Etalon (profil) va kamera kadri — bir odammi. Model javobi buzuq bo'lsa — mos emas deb qaytadi, xato tashlamaydi. */
export async function compareFaces(reference: Buffer, probe: Buffer): Promise<FaceMatch> {
  const [ref, cam] = await Promise.all([faceImage(reference), faceImage(probe)]);
  const text = await askVision([ref, cam], PROMPT, 300);
  let parsed: { match?: unknown; confidence?: unknown; reason?: unknown };
  try { parsed = extractJson(text) as typeof parsed; } catch { return { match: false, confidence: 0, reason: "Model javobi o'qilmadi — qayta urinib ko'ring" }; }
  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)));
  const reason = typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "";
  const match = parsed.match === true && confidence >= FACE_MIN_CONFIDENCE;
  return { match, confidence, reason: reason || (match ? "Yuz mos keldi" : "Yuz mos kelmadi") };
}
