import path from "node:path";
import sharp from "sharp";
import { FACE_DIM } from "@/lib/face-id-const";
import { FaceImageError, SHARP_OPTS, checkFaceImage } from "@/lib/ai/face";

/**
 * Serverda yuz vektori — ERP Face ID skaneri brauzerda ishlatadigan AYNAN o'sha model (face-api: TinyFaceDetector →
 * 68 nuqta → ResNet-34, 128 son). Mobil ilova (ECO) kadr yuboradi, server vektorni shu yerda hisoblab, ERP'da
 * ro'yxatga olingan `FaceTemplate` namunalari bilan solishtiradi (`lib/face-verify.ts`) — profil surati va AI kerak emas.
 *
 * Backend — WASM (`@tensorflow/tfjs-backend-wasm`): tfjs-node kabi AVX talab qilmaydi, serverning eski protsessorida
 * ham ishlaydi; bir kadr ~0,1–0,5 s. Modellar va kutubxona birinchi chaqiruvda bir marta yuklanadi.
 * Paketlar `next.config.ts` → `serverExternalPackages` da (webpack bundle qilmaydi — wasm/model fayllari joyida qolsin).
 *
 * Navbat: hisob Node asosiy oqimida (WASM sinxron bo'laklari event loop'ni band qiladi), shuning uchun bir vaqtda
 * ko'pi bilan `FACE_CONCURRENCY` (standart 1, ko'pi 2) ta kadr hisoblanadi, qolganlari navbatda kutadi; navbatda
 * `QUEUE_WAIT_MS` dan ko'p turgan yoki navbat `QUEUE_MAX` dan uzun bo'lsa — `FaceBusyError` ("band, qayta urining").
 * worker_threads'ga chiqarilmadi: Next bundle'idan tashqarida alohida JS fayl kerak bo'lardi va tfjs + modellar har
 * worker'da qayta yuklanadi (+40–60 MB xotira har korxona jarayonida — ko'p korxonali serverda qimmat); bir kadr esa
 * 0,1–0,5 s, navbat bilan event loop bir vaqtda bitta hisobdan ortiq band bo'lmaydi.
 *
 * Kirish: faqat JPEG/PNG/WEBP (magic bytes + sharp aniqlagan format), `limitInputPixels`, `failOn` (`lib/ai/face.ts`);
 * kulrang, 16-bit, alfa kanalli rasmlar sRGB 8-bit 3 kanalga keltiriladi.
 */

type FaceApi = typeof import("@vladmandic/face-api");

/** ERP skaneri bilan bir xil sozlama (`dashboard/davomat/face-engine.ts`). */
const INPUT_SIZE = 416;
const SCORE_THRESHOLD = 0.5;
/** Kadr shu kenglikka kichraytiriladi — yuz aniqlash uchun yetarli, hisob tez. */
const MAX_WIDTH = 640;

let loading: Promise<FaceApi> | null = null;

function load(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      // face-api `require("@tensorflow/tfjs")` qiladi — aynan shu nusxa, backend shu yerda tanlanadi
      const tf = await import("@tensorflow/tfjs");
      await import("@tensorflow/tfjs-backend-wasm");
      const api = (await import("@vladmandic/face-api/dist/face-api.node-wasm.js")) as unknown as FaceApi;
      await tf.setBackend("wasm");
      await tf.ready();
      const dir = path.join(process.cwd(), "node_modules", "@vladmandic", "face-api", "model");
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromDisk(dir),
        api.nets.faceLandmark68Net.loadFromDisk(dir),
        api.nets.faceRecognitionNet.loadFromDisk(dir),
      ]);
      return api;
    })();
    // Xatodan keyin qayta urinish mumkin bo'lsin; sababi server logida
    loading.catch((e) => { console.error("[face] model yuklanmadi:", (e as Error).message); loading = null; });
  }
  return loading;
}

// ───────────────────────── Navbat (semafor) ─────────────────────────

/** Server band — navbat to'la yoki kutish vaqti o'tdi. `message` foydalanuvchiga ko'rsatiladi. */
export class FaceBusyError extends Error {}

const CONCURRENCY = Math.max(1, Math.min(2, Math.floor(Number(process.env.FACE_CONCURRENCY)) || 1));
/** Navbatda kutishning eng uzoq vaqti — ilova 20 s kutadi, undan oldin aniq javob qaytsin. */
const QUEUE_WAIT_MS = 12_000;
/** Navbatdagi so'rovlar chegarasi — undan ko'pi darhol "band" (xotira va kutish cheksiz o'smasin). */
const QUEUE_MAX = 16;
/** Bitta hisobning eng uzoq vaqti — oshsa chaqiruvchiga xato; slot esa hisob haqiqatan tugaguncha band qoladi. */
const RUN_TIMEOUT_MS = 15_000;

type Waiter = { start: () => void; timer: NodeJS.Timeout };
type Gate = { active: number; queue: Waiter[] };
// globalThis'da — Next bir modulni bir nechta chunk'da yuklasa ham navbat jarayonda bitta bo'lsin
const G = globalThis as unknown as { __insofFaceGate?: Gate };
const gate: Gate = (G.__insofFaceGate ??= { active: 0, queue: [] });

const BUSY = "Yuz tekshiruvi band — bir necha soniyadan keyin qayta urining";

function acquire(): Promise<void> {
  if (gate.active < CONCURRENCY) { gate.active++; return Promise.resolve(); }
  if (gate.queue.length >= QUEUE_MAX) return Promise.reject(new FaceBusyError(BUSY));
  return new Promise((resolve, reject) => {
    const w: Waiter = {
      start: () => { clearTimeout(w.timer); gate.active++; resolve(); },
      timer: setTimeout(() => {
        const i = gate.queue.indexOf(w);
        if (i >= 0) gate.queue.splice(i, 1);
        reject(new FaceBusyError(BUSY));
      }, QUEUE_WAIT_MS),
    };
    gate.queue.push(w);
  });
}

function release() {
  gate.active = Math.max(0, gate.active - 1);
  gate.queue.shift()?.start();
}

/** `fn` ni navbat orqali bajaradi (bir vaqtda `CONCURRENCY` ta). */
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  const run = fn().finally(release);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new FaceBusyError(BUSY)), RUN_TIMEOUT_MS); });
  run.catch(() => { /* kech tugagan hisob xatosi — javob allaqachon qaytgan */ });
  try { return await Promise.race([run, timeout]); } finally { clearTimeout(timer); }
}

/** Navbat holati (monitoring / test uchun). */
export const faceQueueState = () => ({ active: gate.active, waiting: gate.queue.length, concurrency: CONCURRENCY });

// ───────────────────────── Vektor ─────────────────────────

export type FaceVector = { descriptor: number[]; score: number };

/**
 * Kadrdagi (JPEG/PNG/WEBP) eng aniq yuzning vektori; yuz topilmasa — null.
 * Format/o'lcham/buzuq fayl — `FaceImageError`, server band — `FaceBusyError` (ikkalasining matni foydalanuvchiga).
 */
export async function faceDescriptor(image: Buffer): Promise<FaceVector | null> {
  await checkFaceImage(image);
  return withSlot(() => describe(image));
}

/**
 * Yuz topish urinishlari. TinyFaceDetector kadrni deyarli to'ldirgan (yaqin kesilgan) yuzni ba'zan ko'rmaydi — bunda
 * kadr atrofiga qora hoshiya qo'shib qayta urinadi, keyin past chegara bilan. Past chegara xavfsiz: topilgan vektor
 * baribir namuna/yuborilgan vektorga yaqin bo'lishi shart (`MATCH_MAX_DISTANCE`, `PHOTO_PROBE_MAX`).
 */
const PASSES = [
  { pad: 0, threshold: SCORE_THRESHOLD },
  { pad: 0.5, threshold: SCORE_THRESHOLD },
  { pad: 0.5, threshold: 0.3 },
  { pad: 0, threshold: 0.3 },
] as const;

async function describe(image: Buffer): Promise<FaceVector | null> {
  const api = await load();
  let raw: { data: Buffer; info: sharp.OutputInfo };
  try {
    raw = await sharp(image, SHARP_OPTS).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .toColourspace("srgb").removeAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  } catch {
    throw new FaceImageError("Kadr o'qilmadi (buzuq fayl) — qayta skaner qiling");
  }
  const { data, info } = raw;
  if (info.channels !== 3 || data.length !== info.width * info.height * 3) throw new FaceImageError("Kadr ranglari o'qilmadi — qayta skaner qiling");
  const plain = api.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], "int32");
  let padded: typeof plain | null = null;
  try {
    for (const p of PASSES) {
      if (p.pad && !padded) {
        const px = Math.round(Math.max(info.width, info.height) * p.pad);
        padded = api.tf.pad(plain, [[px, px], [px, px], [0, 0]]) as typeof plain;
      }
      const input = p.pad ? padded! : plain;
      const r = await api.detectSingleFace(input as never, new api.TinyFaceDetectorOptions({ inputSize: INPUT_SIZE, scoreThreshold: p.threshold }))
        .withFaceLandmarks().withFaceDescriptor();
      if (r && r.descriptor.length === FACE_DIM) return { descriptor: Array.from(r.descriptor), score: r.detection.score };
    }
    return null;
  } finally {
    plain.dispose();
    padded?.dispose();
  }
}
