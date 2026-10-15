/**
 * SMM media fayllari: UPLOADS_DIR/smm/ (git'ga kirmaydi, har korxona alohida).
 *
 * Reels videolari nginx'ning 16 MB chegarasidan katta — fayl brauzerda 8 MB bo'laklarga bo'linib yuklanadi,
 * server bo'laklarni vaqtinchalik papkada yig'ib, oxirgisida birlashtiradi. Fayl turi brauzer aytganidan
 * emas, boshidagi baytlardan aniqlanadi (rasm nomi ostida HTML/skript yuklab bo'lmasin).
 *
 * Meta (Instagram/Facebook) faylni o'zi yuklab oladi — unga muddatli imzolangan ommaviy havola beriladi
 * (`/api/public/smm-media/<id>?e=…&s=…`); ERP ichida esa fayl login bilan (`/api/marketing/media/<id>`).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UPLOADS_DIR, sniffFileKind } from "@/lib/uploads";
import { authSecret } from "@/lib/secret";
import { SITE_URL } from "@/lib/site";

export const SMM_DIR = path.join(UPLOADS_DIR, "smm");
const TMP_DIR = path.join(SMM_DIR, ".tmp");

export const CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_MB = 300;
const MAX_PARTS = Math.ceil((MAX_MEDIA_MB * 1024 * 1024) / CHUNK_BYTES);

export type MediaType = { kind: "IMAGE" | "VIDEO"; ext: "jpg" | "png" | "webp" | "mp4" | "mov"; mime: string };

const VIDEO_BRANDS: Record<string, "mp4" | "mov"> = {
  isom: "mp4", iso2: "mp4", iso4: "mp4", iso5: "mp4", iso6: "mp4", mp41: "mp4", mp42: "mp4", avc1: "mp4", dash: "mp4", "M4V ": "mp4", "qt  ": "mov",
};

/** Boshidagi baytlar bo'yicha: JPG/PNG/WEBP rasm yoki MP4/MOV video. Boshqasi — null. */
export function sniffMedia(b: Uint8Array): MediaType | null {
  const img = sniffFileKind(b);
  if (img === "jpg") return { kind: "IMAGE", ext: "jpg", mime: "image/jpeg" };
  if (img === "png") return { kind: "IMAGE", ext: "png", mime: "image/png" };
  if (img === "webp") return { kind: "IMAGE", ext: "webp", mime: "image/webp" };
  if (b.length >= 12 && String.fromCharCode(...b.subarray(4, 8)) === "ftyp") {
    const v = VIDEO_BRANDS[String.fromCharCode(...b.subarray(8, 12))];
    if (v) return { kind: "VIDEO", ext: v, mime: v === "mov" ? "video/quicktime" : "video/mp4" };
  }
  return null;
}

/** Saqlangan fayl nomi → diskdagi yo'l (faqat bizning nomlash sxemamiz; yo'l bo'ylab yurish yo'q) */
export function mediaPath(fileName: string): string | null {
  return /^[a-z0-9]{20,40}\.(jpg|png|webp|mp4|mov)$/.test(fileName) ? path.join(SMM_DIR, fileName) : null;
}

const ID_RE = /^[a-z0-9]{16,40}$/;
const MAX_OPEN_UPLOADS = 40;

export type ChunkResult =
  | { done: false }
  | { done: true; tmpFile: string; size: number; type: MediaType }
  | { error: string };

/**
 * Bitta bo'lakni yozadi. Hamma bo'laklar kelgach birlashtiradi va turini tekshiradi.
 * `uploadId` — brauzer yaratgan tasodifiy id; bo'laklar istalgan tartibda kelishi mumkin.
 */
export async function writeChunk(uploadId: string, index: number, total: number, data: Uint8Array): Promise<ChunkResult> {
  if (!ID_RE.test(uploadId)) return { error: "Yuklash identifikatori noto'g'ri" };
  if (!Number.isInteger(total) || total < 1 || total > MAX_PARTS) return { error: `Fayl ${MAX_MEDIA_MB} MB dan katta` };
  if (!Number.isInteger(index) || index < 0 || index >= total) return { error: "Bo'lak raqami noto'g'ri" };
  if (data.byteLength === 0 || data.byteLength > CHUNK_BYTES) return { error: "Bo'lak hajmi noto'g'ri" };
  if (index < total - 1 && data.byteLength !== CHUNK_BYTES) return { error: "Bo'lak hajmi noto'g'ri" };

  const dir = path.join(TMP_DIR, uploadId);
  if (index === 0 || !(await stat(dir).catch(() => null))) {
    // Yangi yuklash: bir vaqtdagi chala yuklashlar soni cheklangan (har biri 300 MB gacha — disk to'lmasin)
    const busy = await readdir(TMP_DIR).catch(() => [] as string[]);
    if (!busy.includes(uploadId) && busy.length >= MAX_OPEN_UPLOADS) return { error: "Hozir juda ko'p fayl yuklanmoqda — birozdan keyin qayta urinib ko'ring" };
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${index}.part`), data);

  const parts = (await readdir(dir)).filter((f) => f.endsWith(".part"));
  if (parts.length < total) return { done: false };

  // Birlashtirish — bir vaqtda ikkita «oxirgi bo'lak» kelsa, faqat bittasi bajaradi (lock fayl)
  const lock = path.join(dir, "merge.lock");
  try {
    const h = await open(lock, "wx");
    await h.close();
  } catch {
    return { done: false };
  }
  const out = path.join(dir, "merged");
  const ws = createWriteStream(out);
  try {
    for (let i = 0; i < total; i++) {
      await pipeline(createReadStream(path.join(dir, `${i}.part`)), ws, { end: false });
    }
  } finally {
    await new Promise<void>((r) => ws.end(r));
  }
  const head = Buffer.alloc(16);
  const fh = await open(out, "r");
  await fh.read(head, 0, 16, 0);
  await fh.close();
  const type = sniffMedia(head);
  if (!type) {
    await rm(dir, { recursive: true, force: true });
    return { error: "Faqat rasm (JPG, PNG, WEBP) yoki video (MP4, MOV) yuklash mumkin" };
  }
  // Instagram rasm sifatida faqat JPEG qabul qiladi — PNG/WEBP shu yerda JPEG ga aylantiriladi
  if (type.kind === "IMAGE" && type.ext !== "jpg") {
    const jpg = path.join(dir, "merged.jpg");
    try {
      const { default: sharp } = await import("sharp");
      await sharp(out).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toFile(jpg);
    } catch {
      await rm(dir, { recursive: true, force: true });
      return { error: "Rasmni o'qib bo'lmadi — boshqa faylni tanlang" };
    }
    return { done: true, tmpFile: jpg, size: (await stat(jpg)).size, type: { kind: "IMAGE", ext: "jpg", mime: "image/jpeg" } };
  }
  const size = (await stat(out)).size;
  return { done: true, tmpFile: out, size, type };
}

/** Birlashtirilgan faylni kutubxonaga ko'chiradi va vaqtinchalik papkani tozalaydi */
export async function commitUpload(uploadId: string, tmpFile: string, id: string, ext: string): Promise<string> {
  await mkdir(SMM_DIR, { recursive: true });
  const fileName = `${id}.${ext}`;
  await rename(tmpFile, path.join(SMM_DIR, fileName));
  await rm(path.join(TMP_DIR, uploadId), { recursive: true, force: true });
  return fileName;
}

/** Bir kundan eski chala yuklashlarni tozalash */
export async function cleanupStaleUploads(): Promise<void> {
  let dirs: string[] = [];
  try { dirs = await readdir(TMP_DIR); } catch { return; }
  const old = Date.now() - 24 * 3600_000;
  for (const d of dirs) {
    try {
      if ((await stat(path.join(TMP_DIR, d))).mtimeMs < old) await rm(path.join(TMP_DIR, d), { recursive: true, force: true });
    } catch { /* boshqa jarayon o'chirgan */ }
  }
}

/* ───────── Imzolangan ommaviy havola (Meta faylni yuklab olishi uchun) ───────── */

const sign = (id: string, exp: number) => createHmac("sha256", Buffer.from(authSecret())).update(`smm-media:${id}:${exp}`).digest("base64url");

/** Muddatli ommaviy havola (standart 6 soat) — Instagram/Facebook video va rasmni shu manzildan oladi */
export function publicMediaUrl(id: string, ttlSec = 6 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${SITE_URL.replace(/\/$/, "")}/api/public/smm-media/${id}?e=${exp}&s=${sign(id, exp)}`;
}

export function verifyMediaSig(id: string, e: string | null, s: string | null): boolean {
  const exp = Number(e);
  if (!s || !Number.isInteger(exp) || exp < Date.now() / 1000) return false;
  const want = Buffer.from(sign(id, exp));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

/* ───────── Faylni berish (Range bilan — video o'ynatish va Meta yuklab olishi uchun) ───────── */

export async function serveMediaFile(file: string, mime: string, req: Request, cache = "private, max-age=3600"): Promise<Response> {
  let size: number;
  try { size = (await stat(file)).size; } catch { return new Response("Not found", { status: 404 }); }
  const range = req.headers.get("range");
  const base = { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" };
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...base, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` } });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...base, "Content-Length": String(size) } });
}
