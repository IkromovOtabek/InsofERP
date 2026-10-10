import { randomBytes } from "node:crypto";
import { readFile } from "fs/promises";
import { FaceImageError } from "@/lib/ai/face";
import { FaceBusyError, faceAnalyses, faceVariants, type FaceAnalysis } from "@/lib/face-descriptor";
import {
  type FaceActor, type Match, type Probe, canEnrollFaces, checkEnrollment, deleteFace, distance, faceRoster, facePhotoFor,
  faceScope, matchFace, rank, recordScan, saveEnrollment, scanGate, similarity, todayFaceLog, enrollGate,
} from "@/lib/face-id";
import { ENROLL_MAX_SAMPLES, ENROLL_MIN_SAMPLES, type FaceMode, type FaceScanFail, type FaceScanResult } from "@/lib/face-id-const";
import { checkLiveness, frontalFrames, livenessRequired, LIVENESS_FRAMES, SEQ_MAX_DISTANCE, type LivenessTask } from "@/lib/face-liveness";
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
 *
 * Tanish va namunalar faqat TO'G'RI qaragan kadrlardan (`frontalFrames`: [0] va to'g'ri bo'lsa [2]); har biri ko'zgu-aksi
 * bilan solishtiriladi (namuna orqa, skaner old kamerada — ba'zi telefonlarda old kamera kadri ko'zgu-aks), yig'ish "min"
 * (`lib/face-id.ts` → `rank`). Ro'yxatga olish ikki bosqichli — saqlashdan oldin skaner shu odamni haqiqatan taniyotgani
 * tekshiriladi (`faceKioskEnroll`).
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

type Frames =
  | { ok: true; bufs: Buffer[]; files: File[]; faces: FaceAnalysis[]; task: LivenessTask | null; frontal: number[]; probes: Probe[] }
  | { ok: false; error: string; code: string };

/**
 * So'rovdagi kadr(lar) → tahlil: challenge (nonce, bir martalik), format, jonlilik ketma-ketligi.
 * Bitta kadr faqat jonlilik majburiy bo'lmaganda (eski ilova) qabul qilinadi.
 * `frontal` — to'g'ri qaragan kadrlar indekslari, `probes` — ularning [asl, ko'zgu-aksi] vektorlari (tanish uchun).
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
  try { an = await faceAnalyses(bufs, { mirror: frontalFrames }); } catch (err) {
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
  const frontal = frontalFrames(faces);
  return { ok: true, bufs, files, faces, task: n.task, frontal, probes: frontal.map((i) => faceVariants(faces[i]!)) };
}

/** Kadrlar xeshini "band" qiladi — aynan o'sha kadrlar ikkinchi marta kelsa rad (tutib olingan so'rov). */
async function claimAll(bufs: Buffer[], employeeId: string, userId: string) {
  for (const b of bufs) if (!(await claimPhotoHash(b, employeeId, userId))) return false;
  return true;
}

const failScan = (code: FaceScanFail["code"], error: string): FaceScanFail => ({ ok: false, code, error });

/** Tanish diagnostikasi — bitta tuzilgan qator (ism/kadr yo'q): chegarani haqiqiy telefonlarda moslash uchun. */
function logMatch(stage: string, code: string, m: { best: number | null; second: number | null; mirror: boolean }, probes: number) {
  const r = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
  console.info(`[face-kiosk] ${JSON.stringify({ stage, code, best: r(m.best), second: r(m.second), probes, mirror: m.mirror })}`);
}

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
  // Tanish — to'g'ri qaragan kadrlar ([0], to'g'ri bo'lsa [2]) va ularning ko'zgu-aksi bo'yicha, "min" (topshiriq kadrida
  // bosh burilgan / ko'z yumuq — namuna emas); qolgan kadrlar shu odamniki ekani `readFrames` da tekshirilgan
  const m = await matchFace(fr.probes, { agg: "min" });
  if (m.kind === "none") logMatch("scan", "NO_MATCH", m, fr.probes.length);
  if (m.kind === "ambiguous") logMatch("scan", "AMBIGUOUS", { best: m.d, second: m.second, mirror: m.mirror }, fr.probes.length);
  if (m.kind === "match" && !(await claimAll(fr.bufs, m.employeeId, u.id))) {
    return failScan("PHOTO_MISMATCH", "Bu kadr avval yuborilgan — qayta skaner qiling");
  }
  return recordScan(a, g.scope, m, mode, keepPhoto(fr.files[0]!));
}

// ───────────────────────── Ro'yxatga olish ─────────────────────────

/**
 * Tasdiqlanmagan ro'yxatga olish (1-bosqich natijasi) — jarayon xotirasida (`globalThis`, Next bir modulni bir nechta
 * chunk'da yuklasa ham bitta). Kalit — tasodifiy `pendingId`, foydalanuvchi va xodimga bog'langan; `PENDING_TTL_MS`
 * yashaydi, `VERIFY_ATTEMPTS` ta tasdiqlash urinishi; eskirganlari har murojaatda tozalanadi. Bazaga hech narsa
 * yozilmaydi — server qayta ishga tushsa (deploy) foydalanuvchi "qaytadan boshlang" xabarini oladi.
 */
type Pending = {
  userId: string; employeeId: string;
  /** To'g'ri qaragan kadrlar vektorlari — saqlanadigan namunalar (ko'zgu-aks saqlanmaydi, tanishda hisoblanadi). */
  samples: { descriptor: number[]; score: number }[];
  /** Shu kadrlarning [asl, ko'zgu-aksi] — faqat "boshqa xodim kartasida yo'q" tekshiruvi uchun. */
  probes: Probe[];
  /** Namuna kadri (birinchi, to'g'ri qaragan) — saqlashda dalil sifatida. */
  photo: File;
  expires: number; attempts: number; busy: boolean;
};
const PENDING_TTL_MS = 5 * 60_000;
const VERIFY_ATTEMPTS = 3;
/** Xotira chegarasi — undan ko'p bo'lsa eng eskisi tashlanadi. */
const PENDING_MAX = 200;
const PG = globalThis as unknown as { __insofFaceEnrollPending?: Map<string, Pending> };

function pendingStore(): Map<string, Pending> {
  const map = (PG.__insofFaceEnrollPending ??= new Map());
  const now = Date.now();
  for (const [k, v] of map) if (v.expires <= now) map.delete(k);
  return map;
}

export type FaceEnrollStep1 = { ok: true; stage: "verify"; pendingId: string; note: string } | { ok: false; error: string };
export type FaceEnrollStep2 = { ok: true; stage: "done"; count: number; note: string; similarity: number } | { ok: false; error: string; retry: boolean };

/**
 * Yuzni ro'yxatga olish — ikki bosqich (skaner shu odamni taniyotgani saqlashdan OLDIN tekshiriladi):
 *   1. `{ employeeId, consent: true, nonce, frames }` — ruxsat, rozilik, jonlilik, kadrlar bir odamniki, namunalar
 *      to'g'ri qaragan kadrlardan (kamida 2 ta: [0] va [2]), yuz boshqa xodim kartasida yo'q (ko'zgu-aks bilan) →
 *      xotirada kutib turadi, javob `{ stage: "verify", pendingId }`. FaceTemplate'ga hali hech narsa yozilmaydi.
 *   2. `{ employeeId, pendingId, nonce, frames }` — yangi kadrlar (jonlilik, bir odam) bilan HAQIQIY 1:N tanish:
 *      barcha faol namunalar, shu xodimning eskilari o'rniga 1-bosqich namunalari; natija shu xodim, `MATCH_MAX_DISTANCE`
 *      ichida va "aniq emas" qoidasidan o'tishi shart. O'tsa — saqlanadi (1-bosqich + tasdiqlash kadrlarining to'g'ri
 *      qaraganlari, ko'pi `ENROLL_MAX_SAMPLES`); o'tmasa — `retry: true` (urinishlar tugaguncha), keyin qaytadan boshlash.
 * Topshiriq kadri [1] namuna qilinmaydi: bosh burilgan (yoki ko'z yumuq) kadr vektori to'g'ri qaragan yuzdan 0,2–0,5
 * uzoq — u namuna bo'lsa begona odamning to'g'ri yuzi ham unga "yaqin" chiqishi mumkin (1:N da noto'g'ri tanish xavfi),
 * skaner esa baribir to'g'ri qaragan kadr bilan tanaydi; kadr shu odamniki ekani `readFrames` da tekshiriladi.
 */
export async function faceKioskEnroll(u: MobileUser, raw: unknown): Promise<FaceEnrollStep1 | FaceEnrollStep2> {
  const a = actor(u);
  const denied = enrollGate(a);
  if (denied) return { ok: false, error: denied };
  const body = (raw ?? {}) as { employeeId?: unknown; consent?: unknown; photo?: unknown; frames?: unknown; nonce?: unknown; pendingId?: unknown };
  const employeeId = typeof body.employeeId === "string" ? body.employeeId.trim().slice(0, 64) : "";
  if (body.pendingId !== undefined && body.pendingId !== null && body.pendingId !== "") return enrollVerify(u, employeeId, body);
  if (body.consent !== true) return { ok: false, error: "Xodim roziligini belgilang" };
  if (!employeeId) return { ok: false, error: "Xodim tanlanmagan" };
  const fr = await readFrames(u, body);
  if (!fr.ok) return { ok: false, error: fr.error };
  if (fr.bufs.length < LIVENESS_FRAMES) return { ok: false, error: `Kamida ${ENROLL_MIN_SAMPLES} ta namuna kerak — ilovani yangilang` };
  if (!(await claimAll(fr.bufs, employeeId, u.id))) return { ok: false, error: "Bu kadr avval yuborilgan — qayta skaner qiling" };
  // Namuna faqat to'g'ri qaragan kadrdan: oxirgi kadrda ([2]) ham yuz kameraga to'g'ri qaragan bo'lsin
  if (fr.frontal.length < 2) return { ok: false, error: "Oxirgi kadrda yuz kameraga to'g'ri qaramagan — topshiriqdan keyin kameraga to'g'ri qarang va qayta urining" };
  const samples = fr.frontal.map((i) => ({ descriptor: fr.faces[i]!.descriptor, score: fr.faces[i]!.score }));
  const c = await checkEnrollment(employeeId, samples.map((x) => x.descriptor), { probes: fr.probes, agg: "min" });
  if (!c.ok) return c;

  const store = pendingStore();
  // Shu foydalanuvchining shu xodim uchun avvalgi tasdiqlanmagan urinishi — yangisi bilan almashadi
  for (const [k, v] of store) if (v.userId === u.id && v.employeeId === employeeId) store.delete(k);
  while (store.size >= PENDING_MAX) store.delete(store.keys().next().value!);
  const pendingId = randomBytes(18).toString("base64url");
  store.set(pendingId, { userId: u.id, employeeId, samples, probes: fr.probes, photo: fr.files[0]!, expires: Date.now() + PENDING_TTL_MS, attempts: 0, busy: false });
  return { ok: true, stage: "verify", pendingId, note: "Namunalar olindi — endi tasdiqlash: xodim kameraga to'g'ri qarasin" };
}

/** Texnik xatolar (so'rov formati, challenge, server band) — tasdiqlash urinishi hisoblanmaydi. */
const TECH_CODES = new Set(["BAD_REQUEST", "LIVENESS_REQUIRED", "NONCE_REQUIRED", "NONCE_INVALID", "FACE_ERROR"]);

async function enrollVerify(u: MobileUser, employeeId: string, body: { pendingId?: unknown; photo?: unknown; frames?: unknown; nonce?: unknown }): Promise<FaceEnrollStep2> {
  const store = pendingStore();
  const pendingId = typeof body.pendingId === "string" ? body.pendingId : "";
  const p = pendingId ? store.get(pendingId) : undefined;
  // Begona foydalanuvchi yoki boshqa xodim — "topilmadi" (pendingId borligini oshkor qilmaydi)
  if (!p || p.userId !== u.id || p.employeeId !== employeeId) {
    return { ok: false, error: "Tasdiqlash topilmadi yoki muddati o'tgan — yuzni ro'yxatga olishni qaytadan boshlang", retry: false };
  }
  if (p.busy) return { ok: false, error: "Tasdiqlash davom etmoqda — biroz kuting", retry: true };
  p.busy = true;
  try {
    const attemptFailed = (reason: string): FaceEnrollStep2 => {
      p.attempts++;
      const left = VERIFY_ATTEMPTS - p.attempts;
      if (left <= 0) {
        store.delete(pendingId);
        return { ok: false, error: `${reason}. Urinishlar tugadi — yuzni ro'yxatga olishni qaytadan boshlang`, retry: false };
      }
      return { ok: false, error: `${reason} — xodim kameraga to'g'ri qarab qayta urinsin (yana ${left} ta urinish)`, retry: true };
    };

    const fr = await readFrames(u, body);
    if (!fr.ok) return TECH_CODES.has(fr.code) ? { ok: false, error: fr.error, retry: true } : attemptFailed(fr.error.split(" — ")[0]!);
    if (!(await claimAll(fr.bufs, employeeId, u.id))) return attemptFailed("Bu kadr avval yuborilgan");

    // Haqiqiy 1:N tanish: shu xodimning eski namunalari o'rniga 1-bosqich namunalari, qolgan hamma faol xodimlar
    const cand = { employeeId, descriptors: p.samples.map((x) => x.descriptor) };
    const m = await matchFace(fr.probes, { agg: "min", exclude: employeeId, extra: [cand] });
    const own = rank(fr.probes, [cand], "min")[0]!;
    const pct = similarity(own.d);
    if (m.kind !== "match" || m.employeeId !== employeeId) {
      const diag: { best: number | null; second: number | null; mirror: boolean } =
        m.kind === "none" ? m : m.kind === "ambiguous" ? { best: m.d, second: m.second, mirror: m.mirror } : m.kind === "match" ? { best: m.d, second: m.second, mirror: m.mirror } : { best: null, second: null, mirror: false };
      const code = m.kind === "match" ? "OTHER" : m.kind === "ambiguous" ? "AMBIGUOUS" : "NO_MATCH";
      logMatch("enroll-verify", code, diag, fr.probes.length);
      return attemptFailed(verifyFailText(m, pct));
    }

    // Saqlash: 1-bosqich + tasdiqlash kadrlarining to'g'ri qaraganlari (tasdiqlash kadri — boshqa paytdagi yorug'lik/holat)
    const extra = fr.frontal.map((i) => ({ descriptor: fr.faces[i]!.descriptor, score: fr.faces[i]!.score }));
    const samples = [...p.samples, ...extra].slice(0, ENROLL_MAX_SAMPLES);
    store.delete(pendingId);
    const r = await saveEnrollment(actor(u), employeeId, samples, keepPhoto(p.photo), { probes: [...p.probes, ...fr.probes], agg: "min" });
    if (!r.ok) return { ok: false, error: r.error, retry: false };
    return { ok: true, stage: "done", count: r.count, note: r.note, similarity: similarity(m.d) };
  } finally {
    p.busy = false;
  }
}

function verifyFailText(m: Match, pct: number): string {
  if (m.kind === "match") return `Tasdiqlanmadi: kadrdagi yuz boshqa xodim deb tanildi (namunaga o'xshashlik ${pct}%)`;
  if (m.kind === "ambiguous") return `Tasdiqlanmadi: yuz boshqa xodimga ham o'xshaydi (o'xshashlik ${pct}%)`;
  return `Tasdiqlanmadi: yuz olingan namunalarga mos kelmadi (o'xshashlik ${pct}%)`;
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
