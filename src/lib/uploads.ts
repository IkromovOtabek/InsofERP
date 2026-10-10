import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import path from "path";

/**
 * Yuklangan fayllar (imzolangan shartnomalar) — loyiha ildizidagi `uploads/` papkasida saqlanadi (git'ga kirmaydi).
 * Fayl faqat marshrut orqali (login talab qiladi) beriladi, `public/` ga qo'yilmaydi.
 */
// Ko'p korxonali serverda har korxona fayllari alohida (UPLOADS_DIR=/var/lib/insof/<slug>/uploads)
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");

// ───────────────────────── Fayl turini mazmunidan aniqlash ─────────────────────────

export type FileKind = "pdf" | "jpg" | "png" | "webp" | "heic";
export const KIND_MIME: Record<FileKind, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
};
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "heif", "mif1", "msf1"]);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/**
 * Fayl boshidagi baytlar (magic bytes) bo'yicha haqiqiy turi. Brauzer yuborgan `file.type` ga
 * ishonilmaydi — uni istalgan qiymatga almashtirib, rasm nomi ostida HTML/skript yuklash mumkin.
 *   PDF  `%PDF-` · JPEG `FF D8 FF` · PNG `89 50 4E 47` · WEBP `RIFF....WEBP` · HEIC/HEIF `....ftyp<heic|heif|mif1…>`
 */
export function sniffFileKind(b: Uint8Array): FileKind | null {
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(b, 8, 12))) return "heic";
  return null;
}

/**
 * Yuklangan faylni o'qiydi va mazmuni bo'yicha turini tekshiradi. Ruxsat etilgan turlardan biri
 * bo'lmasa `null` — chaqiruvchi o'z xato matnini qaytaradi. Saqlashda kengaytma va MIME turi
 * brauzerdan emas, shu aniqlangan turdan olinadi.
 */
export async function readUpload(file: File, allowed: readonly FileKind[]): Promise<{ buf: Buffer; ext: FileKind; mime: string } | null> {
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffFileKind(buf);
  if (!ext || !allowed.includes(ext)) return null;
  return { buf, ext, mime: KIND_MIME[ext] };
}

const CONTRACT_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const CONTRACT_ACCEPT = Object.keys(CONTRACT_TYPES).join(",");
export const CONTRACT_MAX_MB = 15;

export type SavedFile = { stored: string; name: string; type: string };

/** FormData'dan kelgan faylni tekshirib saqlaydi. Fayl tanlanmagan bo'lsa null, xato bo'lsa { error }. */
export async function saveContractFile(orderId: string, file: FormDataEntryValue | null): Promise<SavedFile | null | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > CONTRACT_MAX_MB * 1024 * 1024) return { error: `Fayl ${CONTRACT_MAX_MB} MB dan katta` };
  const f = await readUpload(file, ["pdf", "jpg", "png", "webp"]);
  if (!f) return { error: "Shartnoma fayli PDF yoki rasm (JPG, PNG, WEBP) bo'lishi kerak" };
  const dir = path.join(UPLOADS_DIR, "contracts");
  await mkdir(dir, { recursive: true });
  const stored = `${orderId}-${Date.now()}.${f.ext}`;
  await writeFile(path.join(dir, stored), f.buf);
  return { stored, name: file.name || `shartnoma.${f.ext}`, type: f.mime };
}

/** Saqlangan fayl nomidan diskdagi to'liq yo'l — faqat bizning nomlash sxemamizga mos nomlar (yo'l bo'ylab yurish yo'q). */
export function contractFilePath(stored: string) {
  if (!/^[\w-]+\.(pdf|jpg|png|webp)$/.test(stored)) return null;
  return path.join(UPLOADS_DIR, "contracts", stored);
}

/** Almashtirilgan eski faylni diskdan o'chiradi; bo'lmasa indamay o'tadi. */
export async function removeContractFile(stored: string | null | undefined) {
  const p = stored ? contractFilePath(stored) : null;
  if (!p) return;
  try { await unlink(p); } catch { /* fayl allaqachon yo'q */ }
}

// ───────────────────────── Kadr hujjatlari ─────────────────────────

const EMPLOYEE_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
export const EMPLOYEE_ACCEPT = Object.keys(EMPLOYEE_TYPES).join(",");
// Profil surati HEIC bo'lmaydi: yuz tekshiruvi (sharp 0.33, HEIF o'chiq) uni o'qiy olmaydi. `accept` da HEIC yo'qligi
// iPhone Safari'ni rasmni o'zi JPEG ga o'girib yuborishga majbur qiladi
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
export const HEIC_PHOTO_ERROR = "HEIC (iPhone) surat qabul qilinmaydi — yuz tekshiruvi uni o'qiy olmaydi. Suratni JPG yoki PNG qilib yuklang (iPhone: Sozlamalar → Kamera → Formatlar → «Eng mos»)";
export const EMPLOYEE_MAX_MB = 10;

/**
 * Xodim surati yoki hujjat nusxasi. `uploads/employees/` ga yoziladi,
 * faqat login talab qiladigan marshrut orqali beriladi.
 */
export async function saveEmployeeFile(employeeId: string, file: FormDataEntryValue | null, opts?: { imageOnly?: boolean }): Promise<SavedFile | null | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > EMPLOYEE_MAX_MB * 1024 * 1024) return { error: `"${file.name}" — ${EMPLOYEE_MAX_MB} MB dan katta` };
  // Surat (profil, yuz kadri) — HEIC'siz: aks holda saqlanadi-yu, keyin yuz tekshiruvi tushunarsiz xato beradi.
  // Hujjat nusxasi esa HEIC bo'lishi mumkin (faqat saqlanadi va yuklab olinadi)
  const f = await readUpload(file, opts?.imageOnly ? ["jpg", "png", "webp"] : ["pdf", "jpg", "png", "webp", "heic"]);
  if (!f) {
    if (opts?.imageOnly && sniffFileKind(Buffer.from(await file.arrayBuffer())) === "heic") return { error: HEIC_PHOTO_ERROR };
    return { error: opts?.imageOnly ? "Surat rasm bo'lishi kerak (JPG, PNG, WEBP)" : "Hujjat PDF yoki rasm (JPG, PNG, WEBP) bo'lishi kerak" };
  }
  const dir = path.join(UPLOADS_DIR, "employees");
  await mkdir(dir, { recursive: true });
  const stored = `${employeeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${f.ext}`;
  await writeFile(path.join(dir, stored), f.buf);
  return { stored, name: file.name || `hujjat.${f.ext}`, type: f.mime };
}

/**
 * Surat maydoni: odatda oddiy fayl, ammo kamerada olingan kadr brauzer fayl maydonini
 * to'ldirishga ruxsat bermagan holatda `<name>Data` yashirin maydonida data-URL bo'lib keladi.
 * Ikkalasi ham shu yerda bitta `File` ga keltiriladi — chaqiruvchi farqini bilmaydi.
 */
export function photoEntry(fd: FormData, name = "photo"): File | null {
  const f = fd.get(name);
  if (f instanceof File && f.size > 0) return f;
  const data = fd.get(`${name}Data`);
  if (typeof data !== "string") return null;
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(data.trim());
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length) return null;
  return new File([new Uint8Array(buf)], `surat.${m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg"}`, { type: m[1] });
}

/** Saqlangan nomdan diskdagi to'liq yo'l — faqat bizning nomlash sxemamiz (yo'l bo'ylab yurish yo'q). */
export function employeeFilePath(stored: string) {
  if (!/^[\w-]+\.(pdf|jpg|png|webp|heic)$/.test(stored)) return null;
  return path.join(UPLOADS_DIR, "employees", stored);
}

/** Almashtirilgan/o'chirilgan faylni diskdan olib tashlaydi; bo'lmasa indamay o'tadi. */
export async function removeEmployeeFile(stored: string | null | undefined) {
  const p = stored ? employeeFilePath(stored) : null;
  if (!p) return;
  try { await unlink(p); } catch { /* fayl allaqachon yo'q */ }
}

// ───────────────────────── E-commerce (do'kon) suratlari ─────────────────────────

import { SHOP_TYPES, SHOP_PHOTO_MAX_MB } from "./shop-upload";
import { shopTemplate } from "./shop-templates";
export { SHOP_PHOTO_ACCEPT, SHOP_PHOTO_MAX_MB } from "./shop-upload";

/**
 * Do'kon vitrinasidagi mahsulot surati. `uploads/shop/` ga yoziladi va OMMAVIY marshrut
 * (`/api/public/shop/photo/<stored>`) orqali beriladi — ilova login talab qilmaydi.
 * Shuning uchun faqat rasm (PDF emas) va kichik hajm.
 */
export async function saveShopPhoto(productId: string, file: FormDataEntryValue | null): Promise<SavedFile | null | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > SHOP_PHOTO_MAX_MB * 1024 * 1024) return { error: `Surat ${SHOP_PHOTO_MAX_MB} MB dan katta` };
  // Ommaviy marshrut orqali beriladi — mazmuni haqiqatan rasm bo'lsin (SHOP_TYPES dagi turlar)
  const f = await readUpload(file, Object.values(SHOP_TYPES) as FileKind[]);
  if (!f) return { error: "Surat JPG, PNG yoki WEBP bo'lishi kerak" };
  const dir = path.join(UPLOADS_DIR, "shop");
  await mkdir(dir, { recursive: true });
  const stored = `${productId}-${Date.now()}.${f.ext}`;
  await writeFile(path.join(dir, stored), f.buf);
  return { stored, name: file.name || `mahsulot.${f.ext}`, type: f.mime };
}

/**
 * Tayyor shablon surati (`public/shop-templates/<key>.webp`, `lib/shop-templates.ts`) → `uploads/shop` ga nusxa.
 * Nusxalanadi (havola emas): mahsulot surati keyin o'chirilsa ham, shablon almashsa ham boshqa mahsulotlarga ta'sir qilmaydi.
 */
export async function saveShopTemplatePhoto(productId: string, key: FormDataEntryValue | null): Promise<SavedFile | null | { error: string }> {
  if (typeof key !== "string" || !key) return null;
  const t = shopTemplate(key);
  if (!t) return { error: "Shablon topilmadi — sahifani yangilang" };
  let buf: Buffer;
  try { buf = await readFile(path.join(process.cwd(), "public", "shop-templates", `${t.key}.webp`)); } catch { return { error: "Shablon fayli serverda topilmadi" }; }
  const dir = path.join(UPLOADS_DIR, "shop");
  await mkdir(dir, { recursive: true });
  const stored = `${productId}-${Date.now()}.webp`;
  await writeFile(path.join(dir, stored), buf);
  return { stored, name: `${t.key}.webp`, type: "image/webp" };
}

export function shopPhotoPath(stored: string) {
  if (!/^[\w-]+\.(jpg|png|webp)$/.test(stored)) return null;
  return path.join(UPLOADS_DIR, "shop", stored);
}

export async function removeShopPhoto(stored: string | null | undefined) {
  const p = stored ? shopPhotoPath(stored) : null;
  if (!p) return;
  try { await unlink(p); } catch { /* fayl allaqachon yo'q */ }
}
