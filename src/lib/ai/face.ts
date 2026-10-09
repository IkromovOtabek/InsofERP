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
export const FACE_FORMATS = new Set(["jpeg", "png", "webp"]);
export const SHARP_OPTS = { failOn: "error", limitInputPixels: 40_000_000 } as const;

/** Kadr qabul qilinmadi (format, o'lcham, buzuq fayl) — `message` foydalanuvchiga ko'rsatiladi. */
export class FaceImageError extends Error {}

const FORMAT_ERROR = "Rasm formati qo'llab-quvvatlanmaydi — faqat JPEG, PNG yoki WEBP";

/**
 * Yuz kadri uchun kirish tekshiruvi (sharp dekoderiga yetib borishdan oldin): fayl boshidagi baytlar (magic bytes) va
 * sharp o'zi aniqlagan format faqat JPEG/PNG/WEBP; o'lcham `limitInputPixels` dan oshmaydi.
 * AVIF/HEIF, SVG, TIFF, GIF va boshqalar — rad (`FaceImageError`).
 */
export async function checkFaceImage(input: Buffer) {
  const kind = sniffFileKind(input);
  if (kind !== "jpg" && kind !== "png" && kind !== "webp") throw new FaceImageError(FORMAT_ERROR);
  let meta: sharp.Metadata;
  // Faqat sarlavha o'qiladi (piksellar dekodlanmaydi) — o'lcham chegarasi pastda aniq xabar bilan tekshiriladi
  try { meta = await sharp(input, { ...SHARP_OPTS, limitInputPixels: false }).metadata(); } catch { throw new FaceImageError("Kadr o'qilmadi (buzuq fayl) — qayta skaner qiling"); }
  if (!meta.format || !FACE_FORMATS.has(meta.format)) throw new FaceImageError(FORMAT_ERROR);
  if (!meta.width || !meta.height || meta.width * meta.height > SHARP_OPTS.limitInputPixels) throw new FaceImageError("Kadr o'lchami juda katta — qayta skaner qiling");
  return meta;
}

/**
 * Rasmni JPEG qilib qayta kodlaydi (uzun tomoni ≤ `side` px). Faqat JPEG/PNG/WEBP qabul qilinadi.
 * Natijada EXIF (GPS, qurilma), ICC va boshqa metadata YO'Q — sharp sukut bo'yicha yozmaydi; yo'nalish `rotate()` bilan
 * piksellarga o'tkaziladi. Kulrang / 16-bit PNG ham sRGB 8-bit ga keltiriladi.
 */
export async function faceImage(input: Buffer, side = SIDE, quality = 82): Promise<ScanImage> {
  await checkFaceImage(input);
  let buf: Buffer;
  try {
    buf = await sharp(input, SHARP_OPTS).rotate().resize(side, side, { fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb").jpeg({ quality }).toBuffer();
  } catch { throw new FaceImageError("Kadr o'qilmadi (buzuq fayl) — qayta skaner qiling"); }
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
