import { readFile } from "fs/promises";
import { FaceImageError } from "@/lib/ai/face";
import { FaceBusyError, faceAnalyses, type FaceAnalysis } from "@/lib/face-descriptor";
import {
  type FaceActor, canEnrollFaces, deleteFace, distance, faceRoster, facePhotoFor, faceScope, matchFace, recordScan,
  saveEnrollment, scanGate, todayFaceLog, enrollGate,
} from "@/lib/face-id";
import type { FaceMode, FaceScanFail, FaceScanResult } from "@/lib/face-id-const";
import { checkLiveness, livenessRequired, SEQ_MAX_DISTANCE, type LivenessTask } from "@/lib/face-liveness";
import { claimPhotoHash, consumeFaceNonce, photoHash } from "@/lib/face-replay";
import { faceInput, probeKindError, saveFacePhoto } from "@/lib/face-verify";
import { employeeFilePath } from "@/lib/uploads";
import type { MobileUser } from "./auth";
import { ListError } from "./list";

/**
 * Mobil (ECO) «Davomat» — ERP'dagi Bosh sahifa → Davomat bilan bir xil imkoniyatlar:
 *   · GET  /api/mobile/face            — ruxsat, bugungi skaner jurnali, (otdel kadr darajasiga) yuzlar ro'yxati;
 *   · POST /api/mobile/face/scan       — kiosk: kameraga qaragan xodimni hamma xodimlar orasidan tanib, keldi/ketdi yozadi;
 *   · POST /api/mobile/face/enroll     — xodim yuzini ro'yxatga olish (rozilik bilan);
 *   · POST /api/mobile/face/delete     — yuz ma'lumotini o'chirish;
 *   · GET  /api/mobile/face/photo      — jurnal yoki ro'yxatga olish kadri (data-URL).
 *
 * Vebdan farqi: vektorni brauzer emas, server kadrlardan o'zi hisoblaydi (`faceAnalyses`, veb skaneri bilan bir xil model).
 * Ilova yuz skaneri (`face-scan.tsx`) challenge oladi va 3 kadr yuboradi: [0] — to'g'ri qarab, [1] — topshiriq
 * (bosh burish / ko'z yumish), [2] — yana to'g'ri. Jonlilik, kadrlar bir odamniki ekani va qayta yuborish shu yerda tekshiriladi.
 * Ruxsat va yozuv qoidalari — `lib/face-id.ts` (faceScope / canEnrollFaces, recordScan / saveEnrollment).
 */

const actor = (u: MobileUser): FaceActor => ({ userId: u.id, role: u.role, perms: u.perms });
const forbidden = () => new ListError("FORBIDDEN", "Davomat skaneri sizning lavozimingiz uchun ochilmagan", 403);

/** Bosh sahifa tugmasi uchun: skaner ochiqmi va yuzlarni ro'yxatga olish mumkinmi. */
export function faceKioskAccess(u: MobileUser): { canEnroll: boolean } | null {
  const a = actor(u);
  return faceScope(a) ? { canEnroll: canEnrollFaces(a) } : null;
}

export async function faceKioskData(u: MobileUser) {
  const a = actor(u);
  const scope = faceScope(a);
  if (!scope) throw forbidden();
  const canEnroll = canEnrollFaces(a);
  const [log, roster] = await Promise.all([todayFaceLog(scope), canEnroll ? faceRoster() : Promise.resolve(null)]);
  return {
    scope,
    canEnroll,
    log,
    roster,
    enrolled: roster ? roster.filter((r) => r.samples > 0).length : null,
  };
}

// ───────────────────────── Kadrlar ─────────────────────────

type Frames = { ok: true; bufs: Buffer[]; files: File[]; faces: FaceAnalysis[]; task: LivenessTask | null } | { ok: false; error: string; code: string };

/**
 * So'rovdagi kadr(lar) → tahlil: challenge (nonce, bir martalik), format, jonlilik ketma-ketligi.
 * Bitta kadr faqat jonlilik majburiy bo'lmaganda (eski ilova) qabul qilinadi.
 */
async function readFrames(u: MobileUser, body: { photo?: unknown; frames?: unknown; nonce?: unknown }): Promise<Frames> {
  const fi = faceInput(body);
  if ("error" in fi) return { ok: false, error: fi.error, code: "BAD_REQUEST" };
  const input = fi.input;
  if (input.kind === "single" && livenessRequired()) return { ok: false, error: "Ilovani yangilang — yuz skanerining yangi tekshiruvi (topshiriq) kerak", code: "LIVENESS_REQUIRED" };
  const n = await consumeFaceNonce(u.id, body.nonce);
  if (!n.ok) return { ok: false, error: n.error, code: n.code };
  const files = input.kind === "frames" ? input.files : [input.file];
  if (input.kind === "frames" && !n.task) return { ok: false, error: "Topshiriq topilmadi — qayta skaner qiling", code: "LIVENESS_FAILED" };
  const bufs = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  for (const b of bufs) { const e = probeKindError(b); if (e) return { ok: false, error: e, code: "BAD_REQUEST" }; }
  if (new Set(bufs.map(photoHash)).size !== bufs.length) return { ok: false, error: "Topshiriq bajarilmadi — qayta urinib ko'ring", code: "LIVENESS_FAILED" };

  let an: (FaceAnalysis | null)[];
  try { an = await faceAnalyses(bufs); } catch (err) {
    if (err instanceof FaceImageError || err instanceof FaceBusyError) return { ok: false, error: err.message, code: "FACE_ERROR" };
    console.error("[face-kiosk] vektor hisoblanmadi:", (err as Error).message);
    return { ok: false, error: "Yuz tekshiruvi vaqtincha ishlamadi — qayta urining", code: "FACE_ERROR" };
  }
  if (!an[0]) return { ok: false, error: "Kadrda yuz topilmadi — yuzni kameraga to'g'ri qaratib, yorug' joyda qayta urining", code: "NO_FACE" };
  if (an.some((x) => !x)) return { ok: false, error: "Topshiriq bajarilmadi — qayta urinib ko'ring", code: "LIVENESS_FAILED" };
  const faces = an as FaceAnalysis[];
  // Kadrlarning hammasi bitta odamniki (ketma-ketlikka boshqa odamning kadri aralashtirilmagan)
  if (faces.some((f) => distance(f.descriptor, faces[0]!.descriptor) > SEQ_MAX_DISTANCE)) {
    return { ok: false, error: "Kadrlarda boshqa odamning yuzi bor — kadrda faqat bitta odam tursin", code: "FACE_MISMATCH" };
  }
  if (n.task) {
    const lv = checkLiveness(n.task, faces);
    if (!lv.ok) return { ok: false, error: "Topshiriq bajarilmadi — qayta urinib ko'ring", code: "LIVENESS_FAILED" };
  }
  return { ok: true, bufs, files, faces, task: n.task };
}

/** Kadrlar xeshini "band" qiladi — aynan o'sha kadrlar ikkinchi marta kelsa rad (tutib olingan so'rov). */
async function claimAll(bufs: Buffer[], employeeId: string, userId: string) {
  for (const b of bufs) if (!(await claimPhotoHash(b, employeeId, userId))) return false;
  return true;
}

const failScan = (code: FaceScanFail["code"], error: string): FaceScanFail => ({ ok: false, code, error });

/** Dalil-kadr (birinchi, to'g'ri qaragan) — metadata'siz qayta kodlanib saqlanadi. */
const keepPhoto = (file: File) => async (employeeId: string) => {
  const r = await saveFacePhoto(employeeId, file);
  return "stored" in r ? r.stored : null;
};

// ───────────────────────── Kiosk ─────────────────────────

export async function faceKioskScan(u: MobileUser, raw: unknown): Promise<FaceScanResult> {
  const a = actor(u);
  const g = scanGate(a);
  if (!g.ok) return g.fail;
  const body = (raw ?? {}) as { mode?: unknown; photo?: unknown; frames?: unknown; nonce?: unknown };
  const mode: FaceMode = body.mode === "in" || body.mode === "out" ? body.mode : "auto";
  const fr = await readFrames(u, body);
  if (!fr.ok) return failScan(fr.code === "FACE_MISMATCH" || fr.code === "LIVENESS_FAILED" ? "PHOTO_MISMATCH" : "BAD_REQUEST", fr.error);
  // Tanish — topshiriqdan oldingi, to'g'ri qaragan kadr bo'yicha (topshiriq kadrlarida bosh burilgan / ko'z yumuq);
  // qolgan kadrlar shu odamniki ekani `readFrames` da tekshirilgan
  const m = await matchFace([fr.faces[0]!.descriptor]);
  if (m.kind === "match" && !(await claimAll(fr.bufs, m.employeeId, u.id))) {
    return failScan("PHOTO_MISMATCH", "Bu kadr avval yuborilgan — qayta skaner qiling");
  }
  return recordScan(a, g.scope, m, mode, keepPhoto(fr.files[0]!));
}

// ───────────────────────── Ro'yxatga olish ─────────────────────────

export async function faceKioskEnroll(u: MobileUser, raw: unknown): Promise<{ ok: true; count: number; note: string } | { ok: false; error: string }> {
  const a = actor(u);
  const denied = enrollGate(a);
  if (denied) return { ok: false, error: denied };
  const body = (raw ?? {}) as { employeeId?: unknown; consent?: unknown; photo?: unknown; frames?: unknown; nonce?: unknown };
  if (body.consent !== true) return { ok: false, error: "Xodim roziligini belgilang" };
  const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim().slice(0, 64) : "";
  if (!employeeId) return { ok: false, error: "Xodim tanlanmagan" };
  const fr = await readFrames(u, body);
  if (!fr.ok) return { ok: false, error: fr.error };
  if (!(await claimAll(fr.bufs, employeeId, u.id))) return { ok: false, error: "Bu kadr avval yuborilgan — qayta skaner qiling" };
  return saveEnrollment(a, employeeId, fr.faces.map((f) => ({ descriptor: f.descriptor, score: f.score })), keepPhoto(fr.files[0]!));
}

export async function faceKioskDelete(u: MobileUser, raw: unknown) {
  const id = typeof (raw as { employeeId?: unknown })?.employeeId === "string" ? (raw as { employeeId: string }).employeeId : "";
  if (!id) return { ok: false as const, error: "Xodim tanlanmagan" };
  return deleteFace(actor(u), id);
}

// ───────────────────────── Kadrni ko'rish ─────────────────────────

/** Jurnal (`a` + `k`) yoki ro'yxatga olish (`t`) kadri — `{ data: "data:image/jpeg;base64,..." }`. Kim ko'ra olishi — `facePhotoFor`. */
export async function faceKioskPhoto(u: MobileUser, q: URLSearchParams) {
  const a = actor(u);
  if (!faceScope(a)) throw forbidden();
  const stored = await facePhotoFor(a, { a: q.get("a"), k: q.get("k"), t: q.get("t") });
  const p = stored ? employeeFilePath(stored) : null;
  if (!p) throw new ListError("NOT_FOUND", "Kadr yo'q", 404);
  let body: Buffer;
  try { body = await readFile(p); } catch { throw new ListError("NOT_FOUND", "Fayl diskda topilmadi", 404); }
  return { data: `data:image/jpeg;base64,${body.toString("base64")}` };
}
