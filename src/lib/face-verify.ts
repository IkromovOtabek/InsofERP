import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { FaceImageError, compareFaces, faceCheckEnabled, faceImage } from "@/lib/ai/face";
import { FaceBusyError, faceAnalyses, faceDescriptor } from "@/lib/face-descriptor";
import { MATCH_MAX_DISTANCE, MATCH_MIN_MARGIN, distance, faceTemplates, similarity } from "@/lib/face-id";
import { MAX_FACE_PHOTO_CHARS } from "@/lib/face-id-const";
import { claimPhotoHash, consumeFaceNonce, photoHash } from "@/lib/face-replay";
import { LIVENESS_FRAMES, type LivenessTask, MAX_FACE_FRAMES_TOTAL_CHARS, POSE_SLACK, SEQ_MAX_DISTANCE, checkLiveness, livenessRequired } from "@/lib/face-liveness";
import { dataUrlFile } from "@/lib/procurement";
import { employeeFilePath, saveEmployeeFile, sniffFileKind } from "@/lib/uploads";

/**
 * Kamera kadrini xodim yuzi bilan solishtirish — mobil ilovaning (ECO) yuz skaneri uchun umumiy qadam:
 *   · rahbar xodimni skaner qiladi (`att.face`, `markAttendanceByFace`);
 *   · xodim o'zi "Keldim / Ketdim" (`lib/self-attendance.ts`).
 *
 * Etalon:
 *   1. ERP'da Face ID ro'yxatga olingan bo'lsa (Davomat → yuzni ro'yxatga olish, `FaceTemplate`) — FAQAT shu namunalar:
 *      server kadrdan ERP skaneri bilan bir xil model orqali vektor hisoblaydi (`lib/face-descriptor.ts`) va eng yaqin
 *      namunagacha masofani oladi. Chegara ERP skaneri bilan bir xil (`MATCH_MAX_DISTANCE`); kadr boshqa xodimning
 *      namunasiga ancha yaqin bo'lsa — rad etiladi (begona odam). Profil surati ham, AI kaliti ham kerak emas.
 *   2. Ro'yxatga olinmagan bo'lsa — eskicha: profil surati bilan AI solishtiruvi (`compareFaces`, AI kaliti kerak).
 *
 * Qayta yuborish: tekshiruvga yetib kelgan har kadrning sha256 xeshi saqlanadi — aynan o'sha kadr ikkinchi marta
 * kelsa rad (`lib/face-replay.ts`). Namunalar qisqa muddatli keshdan (`faceTemplates`).
 *
 * Jonlilik: yangi ilova bitta kadr o'rniga 3 kadrli ketma-ketlik (`frames`) va challenge topshirig'ini bajaradi —
 * `verifyFaceRequest` / `verifyEmployeeFaceFrames`, qoidalar va chegaralar `lib/face-liveness.ts` da.
 *
 * `who` — xabardagi egalik: "Karimov Aziz ning" yoki "Sizning".
 * `disabled: true` — bu xodim uchun yuz tekshiruvi umuman mumkin emas (na Face ID, na AI kaliti).
 * `replay: true` — bu kadr avval yuborilgan.
 */
export type FaceVerify =
  | { ok: true; confidence: number; reason: string; method: "faceid" | "ai" }
  | { ok: false; mismatch: boolean; error: string; confidence?: number; reason?: string; disabled?: boolean; replay?: boolean; liveness?: boolean };

/** Shu xodimning ERP Face ID namunasi bormi (keshdan). */
export async function hasFaceTemplate(employeeId: string): Promise<boolean> {
  return (await faceTemplates()).some((t) => t.employeeId === employeeId);
}

/** Shu xodim uchun yuz tekshiruvi ishlaydimi (Face ID namunasi bor yoki AI kaliti sozlangan). */
export async function faceVerifyAvailable(employeeId: string): Promise<boolean> {
  if (faceCheckEnabled()) return true;
  return hasFaceTemplate(employeeId);
}

/**
 * Mobil yuz skaneri kadri (data-URL) → `File`. Chegaradan (`MAX_FACE_PHOTO_CHARS`) katta yoki data-URL emas — null
 * (`tooBig` bilan sababi). Dekoderga (sharp) yetib borishdan oldingi birinchi to'siq.
 */
export function facePhotoFile(raw: unknown): { file: File } | { file: null; tooBig: boolean } {
  if (typeof raw !== "string" || !raw) return { file: null, tooBig: false };
  if (raw.length > MAX_FACE_PHOTO_CHARS) return { file: null, tooBig: true };
  const file = dataUrlFile(raw, "yuz");
  return file ? { file } : { file: null, tooBig: false };
}

/** Kadr formati (magic bytes): JPEG/PNG/WEBP bo'lmasa — xato matni. */
export function probeKindError(probe: Buffer): string | null {
  const probeKind = sniffFileKind(probe);
  if (probeKind === "heic") return "Kamera kadri HEIC formatida — ilovani yangilang yoki qayta skaner qiling";
  if (probeKind !== "jpg" && probeKind !== "png" && probeKind !== "webp") return "Kadr rasm emas — qayta skaner qiling";
  return null;
}

// ───────────────────────── So'rov: bitta kadr yoki jonlilik ketma-ketligi ─────────────────────────

/** Mobil so'rovdagi yuz ma'lumoti: eski bitta `photo` yoki yangi `frames` (jonlilik, `LIVENESS_FRAMES` ta). */
export type FaceInput = { kind: "single"; file: File } | { kind: "frames"; files: File[] };

/**
 * `{ photo?, frames? }` → `FaceInput`. `frames` bo'lsa u ishlatiladi (`photo` e'tiborsiz). Har kadr
 * `MAX_FACE_PHOTO_CHARS` ichida, jami `MAX_FACE_FRAMES_TOTAL_CHARS` — dekoderga yetib borishdan oldingi to'siq.
 * Hech biri yo'q — `missing: true` (chaqiruvchi o'z matnini beradi).
 */
export function faceInput(raw: { photo?: unknown; frames?: unknown }): { input: FaceInput } | { error: string; missing?: boolean } {
  const fr = raw.frames;
  if (fr !== undefined && fr !== null) {
    if (!Array.isArray(fr) || fr.length !== LIVENESS_FRAMES) return { error: `Kadrlar soni noto'g'ri (${LIVENESS_FRAMES} ta kerak) — qayta skaner qiling` };
    let total = 0;
    const files: File[] = [];
    for (const f of fr) {
      if (typeof f !== "string" || !f) return { error: "Kadr o'qilmadi — qayta skaner qiling" };
      total += f.length;
      if (f.length > MAX_FACE_PHOTO_CHARS || total > MAX_FACE_FRAMES_TOTAL_CHARS) return { error: "Kadr juda katta — qayta skaner qiling" };
    }
    for (const f of fr as string[]) {
      const file = dataUrlFile(f, "yuz");
      if (!file) return { error: "Kadr o'qilmadi — qayta skaner qiling" };
      files.push(file);
    }
    return { input: { kind: "frames", files } };
  }
  const ph = facePhotoFile(raw.photo);
  if (ph.file) return { input: { kind: "single", file: ph.file } };
  if (ph.tooBig) return { error: "Kadr juda katta — qayta skaner qiling" };
  return raw.photo === undefined || raw.photo === null || raw.photo === "" ? { error: "Yuzni skaner qiling", missing: true } : { error: "Kadr o'qilmadi — qayta skaner qiling" };
}

export const LIVENESS_FAILED_MSG = "Topshiriq bajarilmadi — qayta urinib ko'ring";
const LIVENESS_REQUIRED_MSG = "Ilovani yangilang — davomat uchun yuz skanerining yangi tekshiruvi (topshiriq) kerak";

/** `verifyFaceRequest` natijasi: muvaffaqiyatda saqlanadigan kadr (`photo`), xatoda mobil API kodi va HTTP holati. */
export type FaceGate =
  | { ok: true; confidence: number; reason: string; method: "faceid" | "ai"; photo: File; liveness: string | null }
  | { ok: false; code: string; status: number; error: string; mismatch: boolean; confidence?: number; reason?: string };

/**
 * Mobil yuz so'rovining to'liq tekshiruvi ("Keldim/Ketdim" va `att.face` uchun umumiy):
 *   1. `MOBILE_FACE_LIVENESS_REQUIRED=true` va bitta kadr — LIVENESS_REQUIRED (nonce sarflanmaydi);
 *   2. bir martalik challenge (`consumeFaceNonce`) — topshiriq shundan olinadi;
 *   3. `frames` — `verifyEmployeeFaceFrames` (topshiriqsiz nonce bilan — rad), bitta kadr — `verifyEmployeeFace`.
 * Muvaffaqiyatda `photo` — dalil sifatida saqlanadigan kadr (ketma-ketlikda birinchisi — topshiriqdan oldingi, yuz to'g'ri).
 */
export async function verifyFaceRequest(employeeId: string, who: string, input: FaceInput, nonce: unknown, ctx: { userId: string }): Promise<FaceGate> {
  if (input.kind === "single" && livenessRequired()) {
    return { ok: false, code: "LIVENESS_REQUIRED", status: 400, error: LIVENESS_REQUIRED_MSG, mismatch: false };
  }
  const n = await consumeFaceNonce(ctx.userId, nonce);
  if (!n.ok) return { ok: false, code: n.code, status: 400, error: n.error, mismatch: false };
  let v: FaceVerify;
  let photo: File;
  if (input.kind === "frames") {
    if (!n.task) {
      return livenessRequired()
        ? { ok: false, code: "LIVENESS_REQUIRED", status: 400, error: LIVENESS_REQUIRED_MSG, mismatch: false }
        : { ok: false, code: "LIVENESS_FAILED", status: 400, error: "Topshiriq topilmadi — qayta skaner qiling", mismatch: false, reason: "nonce'da topshiriq yo'q" };
    }
    v = await verifyEmployeeFaceFrames(employeeId, who, input.files, n.task, ctx);
    photo = input.files[0]!;
  } else {
    v = await verifyEmployeeFace(employeeId, who, input.file, ctx);
    photo = input.file;
  }
  if (!v.ok) {
    const code = v.replay ? "FACE_REPLAY" : v.liveness ? "LIVENESS_FAILED" : v.mismatch ? "FACE_MISMATCH" : "FACE_ERROR";
    const status = code === "LIVENESS_FAILED" ? 400 : v.mismatch ? 403 : 409;
    return { ok: false, code, status, error: v.error, mismatch: v.mismatch, confidence: v.confidence, reason: v.reason };
  }
  return { ok: true, confidence: v.confidence, reason: v.reason, method: v.method, photo, liveness: input.kind === "frames" ? n.task : null };
}

/**
 * Jonlilik ketma-ketligi (`lib/face-liveness.ts`): [0] — topshiriqdan oldingi kadr (asosiy, dalil), [1], [2] — topshiriq.
 *   · format, xeshlar har xil (bir kadr nusxasi — rad), har xesh "band" qilinadi (qayta yuborish — FACE_REPLAY);
 *   · uchala kadr bitta navbat o'rnida tahlil qilinadi (`faceAnalyses`);
 *   · asosiy kadr — bitta kadrli oqimdagi AYNAN o'sha qoida (Face ID namunasi yoki AI bilan profil surati);
 *   · topshiriq kadrlari ham shu odam: namunaga `MATCH_MAX_DISTANCE + POSE_SLACK` (bosh burilganda vektor
 *     uzoqlashadi) va asosiy kadrga `SEQ_MAX_DISTANCE` ichida;
 *   · topshiriq bajarilgan va kadrlar qotgan emas (`checkLiveness`).
 */
export async function verifyEmployeeFaceFrames(employeeId: string, who: string, files: File[], task: LivenessTask, ctx: { userId: string }): Promise<FaceVerify> {
  const bufs = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  for (const b of bufs) { const e = probeKindError(b); if (e) return { ok: false, mismatch: false, error: e }; }
  const live = (reason: string): FaceVerify => ({ ok: false, mismatch: false, liveness: true, error: LIVENESS_FAILED_MSG, reason: `Jonlilik (${task}): ${reason}` });
  if (new Set(bufs.map(photoHash)).size !== bufs.length) return live("bir xil kadrlar (xesh)");
  for (const b of bufs) {
    if (!(await claimPhotoHash(b, employeeId, ctx.userId))) return { ok: false, mismatch: false, replay: true, error: "Bu kadr avval yuborilgan — yuzni qayta skaner qiling" };
  }

  let an: Awaited<ReturnType<typeof faceAnalyses>>;
  try { an = await faceAnalyses(bufs); } catch (err) {
    if (err instanceof FaceImageError || err instanceof FaceBusyError) return { ok: false, mismatch: false, error: err.message };
    console.error("[face] vektor hisoblanmadi:", (err as Error).message);
    return { ok: false, mismatch: false, error: TEMP_FAIL };
  }
  const main = an[0];
  if (!main) return { ok: false, mismatch: false, error: NO_FACE };
  if (an.some((a) => !a)) return live("topshiriq kadrida yuz topilmadi");
  const all = an as NonNullable<(typeof an)[number]>[];

  // Asosiy kadr — bitta kadrli oqim qoidasi
  const own = (await faceTemplates()).filter((t) => t.employeeId === employeeId).map((t) => t.descriptor);
  let primary: FaceVerify;
  if (own.length) primary = await matchTemplates(employeeId, who, own, main.descriptor);
  else if (faceCheckEnabled()) primary = await verifyByProfilePhoto(employeeId, who, bufs[0]!);
  else return { ok: false, mismatch: false, disabled: true, error: `${who} yuzi Face ID'da ro'yxatga olinmagan — otdel kadr ERP → Davomat bo'limida yuzni ro'yxatga olsin` };
  if (!primary.ok) return primary;

  // Topshiriq kadrlari — o'sha odam (boshqa odamning kadri aralashtirilmagan)
  for (let i = 1; i < all.length; i++) {
    const dSeq = distance(all[i]!.descriptor, main.descriptor);
    const dOwn = own.length ? Math.min(...own.map((t) => distance(all[i]!.descriptor, t))) : 0;
    if (dSeq > SEQ_MAX_DISTANCE || dOwn > MATCH_MAX_DISTANCE + POSE_SLACK) {
      const reason = `${i + 1}-kadr boshqa odamga o'xshaydi (asosiy kadrdan ${dSeq.toFixed(2)}${own.length ? `, namunadan ${dOwn.toFixed(2)}` : ""})`;
      return { ok: false, mismatch: true, error: "Yuz tasdiqlanmadi: kadrlarda boshqa odamning yuzi bor — qayta skaner qiling", confidence: primary.confidence, reason };
    }
  }

  const lv = checkLiveness(task, all);
  if (!lv.ok) return live(`${lv.reason}; ${lv.detail}`);
  return { ...primary, reason: `${primary.reason}; jonlilik ${task} (${lv.detail})` };
}

export async function verifyEmployeeFace(employeeId: string, who: string, photo: File, ctx: { userId: string }): Promise<FaceVerify> {
  const probe = Buffer.from(await photo.arrayBuffer());
  const kindErr = probeKindError(probe);
  if (kindErr) return { ok: false, mismatch: false, error: kindErr };
  // Aynan shu kadr avval yuborilgan bo'lsa — tutib olingan/takror so'rov
  if (!(await claimPhotoHash(probe, employeeId, ctx.userId))) {
    return { ok: false, mismatch: false, replay: true, error: "Bu kadr avval yuborilgan — yuzni qayta skaner qiling" };
  }

  const own = (await faceTemplates()).filter((t) => t.employeeId === employeeId).map((t) => t.descriptor);
  if (own.length) return verifyByTemplates(employeeId, who, own, probe);
  if (!faceCheckEnabled()) {
    return { ok: false, mismatch: false, disabled: true, error: `${who} yuzi Face ID'da ro'yxatga olinmagan — otdel kadr ERP → Davomat bo'limida yuzni ro'yxatga olsin` };
  }
  return verifyByProfilePhoto(employeeId, who, probe);
}

/**
 * Tasdiqlangan kadrni dalil sifatida saqlaydi — asl fayl emas, qayta kodlangan JPEG (EXIF/GPS, qurilma ma'lumoti va
 * boshqa metadata tashlanadi, uzun tomoni ≤ 1024 px). Xato bo'lsa `{ error }`.
 */
export async function saveFacePhoto(employeeId: string, photo: File): Promise<{ stored: string } | { error: string }> {
  let clean: Buffer;
  try {
    const img = await faceImage(Buffer.from(await photo.arrayBuffer()), 1024, 85);
    clean = Buffer.from(img.base64, "base64");
  } catch (e) {
    return { error: e instanceof FaceImageError ? e.message : "Kadr saqlanmadi — qayta urining" };
  }
  const saved = await saveEmployeeFile(employeeId, new File([new Uint8Array(clean)], "yuz.jpg", { type: "image/jpeg" }), { imageOnly: true });
  if (!saved || "error" in saved) return { error: saved?.error ?? "Kadr saqlanmadi — qayta urining" };
  return { stored: saved.stored };
}

const NO_FACE = "Kadrda yuz topilmadi — yuzni kameraga to'g'ri qaratib, yorug' joyda qayta skaner qiling";
const TEMP_FAIL = "Yuz tekshiruvi vaqtincha ishlamadi — qayta urining";

async function verifyByTemplates(employeeId: string, who: string, own: number[][], probe: Buffer): Promise<FaceVerify> {
  let face: Awaited<ReturnType<typeof faceDescriptor>>;
  try { face = await faceDescriptor(probe); } catch (err) {
    if (err instanceof FaceImageError || err instanceof FaceBusyError) return { ok: false, mismatch: false, error: err.message };
    console.error("[face] vektor hisoblanmadi:", (err as Error).message);
    return { ok: false, mismatch: false, error: TEMP_FAIL };
  }
  if (!face) return { ok: false, mismatch: false, error: NO_FACE };
  return matchTemplates(employeeId, who, own, face.descriptor);
}

/** Vektor ↔ xodimning Face ID namunalari: chegara va "begona odam" (boshqa xodimga ancha yaqin) qoidasi. */
async function matchTemplates(employeeId: string, who: string, own: number[][], descriptor: number[]): Promise<FaceVerify> {
  const d = Math.min(...own.map((t) => distance(descriptor, t)));
  const confidence = similarity(d);
  if (d > MATCH_MAX_DISTANCE) {
    const reason = `Face ID namunasiga mos emas (masofa ${d.toFixed(2)})`;
    return { ok: false, mismatch: true, error: `Yuz tasdiqlanmadi (${confidence}%): ${who} Face ID namunasiga mos kelmadi`, confidence, reason };
  }
  // Begona odam: kadr boshqa faol xodimning namunasiga o'zinikidan sezilarli yaqin bo'lsa — rad
  const nearestOther = (await faceTemplates()).reduce((m, t) => (t.active && t.employeeId !== employeeId ? Math.min(m, distance(descriptor, t.descriptor)) : m), Infinity);
  if (nearestOther < d - MATCH_MIN_MARGIN) {
    const reason = `Kadr boshqa xodimning Face ID namunasiga yaqinroq (${nearestOther.toFixed(2)} < ${d.toFixed(2)})`;
    return { ok: false, mismatch: true, error: "Yuz tasdiqlanmadi: kadrdagi yuz boshqa xodimnikiga ko'proq o'xshaydi", confidence, reason };
  }
  return { ok: true, confidence, reason: `Face ID namunasi bilan mos (masofa ${d.toFixed(2)})`, method: "faceid" };
}

async function verifyByProfilePhoto(employeeId: string, who: string, probe: Buffer): Promise<FaceVerify> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { photo: true } });
  const refPath = emp?.photo ? employeeFilePath(emp.photo) : null;
  if (!refPath) return { ok: false, mismatch: false, error: `${who} Face ID'si ham, profil surati ham yo'q — otdel kadr ERP → Davomat bo'limida yuzni ro'yxatga olsin` };
  let reference: Buffer;
  try { reference = await readFile(refPath); } catch { return { ok: false, mismatch: false, error: "Profil surati diskda topilmadi — otdel kadr qayta yuklasin" }; }
  // HEIC (iPhone) serverda o'qilmaydi (sharp 0.33 — HEIF dekoderi o'chiq): umumiy "vaqtincha ishlamadi" o'rniga aniq sabab
  if (sniffFileKind(reference) === "heic") return { ok: false, mismatch: false, error: `${who} profil surati HEIC formatida — yuz tekshiruvi uni o'qiy olmaydi. Otdel kadr suratni JPG yoki PNG qilib qayta yuklasin` };

  let r: Awaited<ReturnType<typeof compareFaces>>;
  try { r = await compareFaces(reference, probe); } catch (err) {
    if (err instanceof FaceImageError) return { ok: false, mismatch: false, error: err.message };
    // Provayder xatosi (limit, tarmoq) — ichki matn (org id, URL) ilovaga chiqmasin
    const msg = (err as Error).message ?? "";
    console.error("[face] tekshiruv xatosi:", msg);
    return { ok: false, mismatch: false, error: /rate limit/i.test(msg) ? "AI tekshiruvi band (bepul tarif limiti) — bir daqiqadan keyin qayta urining" : "Yuz tekshiruvi vaqtincha ishlamadi — qayta urining" };
  }
  if (!r.match) return { ok: false, mismatch: true, error: `Yuz tasdiqlanmadi (${r.confidence}%): ${r.reason}`, confidence: r.confidence, reason: r.reason };
  return { ok: true, confidence: r.confidence, reason: r.reason, method: "ai" };
}
