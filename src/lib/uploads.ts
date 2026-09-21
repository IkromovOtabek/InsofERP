import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";

/**
 * Yuklangan fayllar (imzolangan shartnomalar) — loyiha ildizidagi `uploads/` papkasida saqlanadi (git'ga kirmaydi).
 * Fayl faqat marshrut orqali (login talab qiladi) beriladi, `public/` ga qo'yilmaydi.
 */
export const UPLOADS_DIR = path.join(process.cwd(), "uploads");

const CONTRACT_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const CONTRACT_ACCEPT = Object.keys(CONTRACT_TYPES).join(",");
export const CONTRACT_MAX_MB = 15;

export type SavedFile = { stored: string; name: string; type: string };

/** FormData'dan kelgan faylni tekshirib saqlaydi. Fayl tanlanmagan bo'lsa null, xato bo'lsa { error }. */
export async function saveContractFile(orderId: string, file: FormDataEntryValue | null): Promise<SavedFile | null | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = CONTRACT_TYPES[file.type];
  if (!ext) return { error: "Shartnoma fayli PDF yoki rasm (JPG, PNG, WEBP) bo'lishi kerak" };
  if (file.size > CONTRACT_MAX_MB * 1024 * 1024) return { error: `Fayl ${CONTRACT_MAX_MB} MB dan katta` };
  const dir = path.join(UPLOADS_DIR, "contracts");
  await mkdir(dir, { recursive: true });
  const stored = `${orderId}-${Date.now()}.${ext}`;
  await writeFile(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));
  return { stored, name: file.name || `shartnoma.${ext}`, type: file.type };
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
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
export const EMPLOYEE_MAX_MB = 10;

/**
 * Xodim surati yoki hujjat nusxasi. `uploads/employees/` ga yoziladi,
 * faqat login talab qiladigan marshrut orqali beriladi.
 */
export async function saveEmployeeFile(employeeId: string, file: FormDataEntryValue | null, opts?: { imageOnly?: boolean }): Promise<SavedFile | null | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = EMPLOYEE_TYPES[file.type];
  if (!ext || (opts?.imageOnly && ext === "pdf")) {
    return { error: opts?.imageOnly ? "Surat rasm bo'lishi kerak (JPG, PNG, WEBP)" : "Hujjat PDF yoki rasm (JPG, PNG, WEBP) bo'lishi kerak" };
  }
  if (file.size > EMPLOYEE_MAX_MB * 1024 * 1024) return { error: `"${file.name}" — ${EMPLOYEE_MAX_MB} MB dan katta` };
  const dir = path.join(UPLOADS_DIR, "employees");
  await mkdir(dir, { recursive: true });
  const stored = `${employeeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await writeFile(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));
  return { stored, name: file.name || `hujjat.${ext}`, type: file.type };
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
