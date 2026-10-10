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
async function withSlot<T>(fn: () => Promise<T>, runTimeoutMs = RUN_TIMEOUT_MS): Promise<T> {
  await acquire();
  const run = fn().finally(release);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new FaceBusyError(BUSY)), runTimeoutMs); });
  run.catch(() => { /* kech tugagan hisob xatosi — javob allaqachon qaytgan */ });
  try { return await Promise.race([run, timeout]); } finally { clearTimeout(timer); }
}

/** Navbat holati (monitoring / test uchun). */
export const faceQueueState = () => ({ active: gate.active, waiting: gate.queue.length, concurrency: CONCURRENCY });

// ───────────────────────── Vektor ─────────────────────────

export type FaceVector = { descriptor: number[]; score: number };
/**
 * Vektor + yuz qutisi va 68 nuqta (face-api `faceLandmark68Net`: 0–16 jag', 27–35 burun, 36–41 va 42–47 ko'zlar —
 * kadrdagi tartibda). Koordinatalar kichraytirilgan kadr pikselida (hoshiya ayirilgan); jonlilik tekshiruvi
 * (`lib/face-liveness.ts`) faqat nisbatlardan foydalanadi, shuning uchun kadr o'lchami ahamiyatsiz.
 */
export type FaceAnalysis = FaceVector & {
  box: { x: number; y: number; width: number; height: number };
  landmarks: [number, number][];
  /** Ko'z sohasining nisbiy kontrasti (`eyeContrast`) — ochiq ko'zda katta, yumuqda kichik; aniqlab bo'lmasa null. */
  eyeContrast: number | null;
  /**
   * Shu kadrning gorizontal ko'zgu-aksidan (sharp `.flop()`) olingan vektor — faqat so'ralgan kadrlar uchun
   * (`faceAnalyses` → `mirror`); so'ralmagan yoki aksda yuz topilmagan bo'lsa yo'q. Ko'zgu-aksning vektori aslidan
   * ~0,26 uzoq (face-api demo surati) — namunalar boshqa kameradan (orqa ↔ old, ba'zi telefonlarda old kamera kadri
   * ko'zgu-aks) olingan bo'lsa shu farq yorug'lik/burchak farqiga qo'shilib, o'sha odam tanilmay qolardi.
   * Solishtirishda masofa = min(asl, aks) (`lib/face-id.ts` → `rank`).
   */
  mirror?: number[];
};

/** Kadr vektorining solishtiriladigan variantlari: [asl, ko'zgu-aksi?]. */
export const faceVariants = (f: { descriptor: number[]; mirror?: number[] }): number[][] => (f.mirror ? [f.descriptor, f.mirror] : [f.descriptor]);

/**
 * Kadrdagi (JPEG/PNG/WEBP) eng aniq yuzning vektori; yuz topilmasa — null.
 * Format/o'lcham/buzuq fayl — `FaceImageError`, server band — `FaceBusyError` (ikkalasining matni foydalanuvchiga).
 */
export async function faceDescriptor(image: Buffer, opts: { mirror?: boolean } = {}): Promise<(FaceVector & { mirror?: number[] }) | null> {
  await checkFaceImage(image);
  // Ko'zgu-aks bilan — o'sha navbat o'rnida, hisob vaqti chegarasi bitta qo'shimcha kadrga kengayadi
  const r = await withSlot(async () => {
    const a = await describe(image);
    if (!a || !opts.mirror) return a;
    const m = await describe(image, true);
    return m ? { ...a, mirror: m.descriptor } : a;
  }, RUN_TIMEOUT_MS + (opts.mirror ? EXTRA_FRAME_MS : 0));
  return r ? { descriptor: r.descriptor, score: r.score, ...(r.mirror ? { mirror: r.mirror } : {}) } : null;
}

/** Har qo'shimcha hisob (kadr yoki uning ko'zgu-aksi) uchun hisob vaqti chegarasiga qo'shiladigan vaqt. */
const EXTRA_FRAME_MS = 5_000;

/**
 * Bir nechta kadr (jonlilik ketma-ketligi, odatda 3 ta) — BITTA navbat o'rnida ketma-ket hisoblanadi: har kadr uchun
 * alohida navbatga turilsa, band paytda kutish kadrlar soniga ko'payib ilovaning 20 s chegarasidan oshardi; bitta
 * o'rinda so'rov bir marta kutadi (`QUEUE_WAIT_MS`). Natija tartibi kirish bilan bir xil; yuz topilmagan kadr — null.
 *
 * `mirror` — barcha kadrlar tahlil qilingach chaqiriladi va ko'zgu-aksi ham hisoblanadigan kadrlar indekslarini
 * qaytaradi (odatda to'g'ri qaragan kadrlar — tanish namunalari, `lib/face-liveness.ts` → `frontalFrames`); aks
 * vektorlari o'sha navbat o'rnida hisoblanib `FaceAnalysis.mirror` ga yoziladi. Hisob vaqti chegarasi eng yomon holatga
 * qarab kengayadi: `RUN_TIMEOUT_MS` + 5 s har qo'shimcha kadrga va (mirror bo'lsa) har kadr aksiga.
 */
export async function faceAnalyses(images: Buffer[], opts: { mirror?: (faces: (FaceAnalysis | null)[]) => number[] } = {}): Promise<(FaceAnalysis | null)[]> {
  for (const img of images) await checkFaceImage(img);
  const extra = Math.max(0, images.length - 1) + (opts.mirror ? images.length : 0);
  return withSlot(async () => {
    const out: (FaceAnalysis | null)[] = [];
    for (const img of images) out.push(await describe(img));
    if (opts.mirror) {
      for (const i of new Set(opts.mirror(out))) {
        const f = out[i];
        if (!f) continue;
        const m = await describe(images[i]!, true);
        if (m) f.mirror = m.descriptor;
      }
    }
    return out;
  }, RUN_TIMEOUT_MS + EXTRA_FRAME_MS * extra);
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

/** `flop` — kadrning gorizontal ko'zgu-aksi tahlil qilinadi (nuqtalar ham aks kadr koordinatalarida). */
async function describe(image: Buffer, flop = false): Promise<FaceAnalysis | null> {
  const api = await load();
  let raw: { data: Buffer; info: sharp.OutputInfo };
  try {
    let img = sharp(image, SHARP_OPTS).rotate();
    if (flop) img = img.flop();
    raw = await img.resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .toColourspace("srgb").removeAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  } catch {
    throw new FaceImageError("Kadr o'qilmadi (buzuq fayl) — qayta skaner qiling");
  }
  const { data, info } = raw;
  if (info.channels !== 3 || data.length !== info.width * info.height * 3) throw new FaceImageError("Kadr ranglari o'qilmadi — qayta skaner qiling");
  const plain = api.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], "int32");
  let padded: typeof plain | null = null;
  let px = 0;
  try {
    for (const p of PASSES) {
      if (p.pad && !padded) {
        px = Math.round(Math.max(info.width, info.height) * p.pad);
        padded = api.tf.pad(plain, [[px, px], [px, px], [0, 0]]) as typeof plain;
      }
      const input = p.pad ? padded! : plain;
      const r = await api.detectSingleFace(input as never, new api.TinyFaceDetectorOptions({ inputSize: INPUT_SIZE, scoreThreshold: p.threshold }))
        .withFaceLandmarks().withFaceDescriptor();
      if (r && r.descriptor.length === FACE_DIM) {
        // Hoshiyali o'tishda koordinatalar hoshiya qadar siljigan — asl kadrga qaytariladi
        const off = p.pad ? px : 0;
        const b = r.detection.box;
        const landmarks = r.landmarks.positions.map((pt) => [pt.x - off, pt.y - off] as [number, number]);
        return {
          descriptor: Array.from(r.descriptor),
          score: r.detection.score,
          box: { x: b.x - off, y: b.y - off, width: b.width, height: b.height },
          landmarks,
          eyeContrast: eyeContrast(data, info.width, info.height, landmarks),
        };
      }
    }
    return null;
  } finally {
    plain.dispose();
    padded?.dispose();
  }
}

/**
 * Ko'z ochiqligining piksel o'lchovi: ikkala ko'z sohasidagi yorqinlik tarqalishi (standart og'ish) / butun yuz
 * sohasidagi tarqalish. Ochiq ko'zda qorachiq (qora) va oqi (oq) yonma-yon — tarqalish katta; yumuq ko'zda faqat
 * qovoq terisi va kiprik chizig'i — sezilarli kichik. Yuz bo'yicha normallashtirilgani uchun yorug'lik va kontrast
 * o'zgarishiga chidamli. 68 nuqta modeli (face-api) qovoqni deyarli kuzatmaydi — yumuq ko'zda ham ochiq ko'z shaklini
 * chizadi (sinovda EAR atigi ~5–10% kamaydi), shuning uchun ko'z joyi nuqtalardan, holati esa piksellardan olinadi.
 * Soha kadrdan chiqsa — null.
 */
function eyeContrast(rgb: Buffer, W: number, H: number, lm: [number, number][]): number | null {
  const stdIn = (x0: number, y0: number, x1: number, y1: number) => {
    const a = Math.max(0, Math.floor(x0)), b = Math.min(W, Math.ceil(x1)), c = Math.max(0, Math.floor(y0)), d = Math.min(H, Math.ceil(y1));
    if (b - a < 3 || d - c < 3) return null;
    let n = 0, s = 0, s2 = 0;
    for (let y = c; y < d; y++) for (let x = a; x < b; x++) {
      const i = (y * W + x) * 3;
      const g = 0.299 * rgb[i]! + 0.587 * rgb[i + 1]! + 0.114 * rgb[i + 2]!;
      n++; s += g; s2 += g * g;
    }
    return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  };
  const eye = (st: number) => {
    const pts = lm.slice(st, st + 6);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = x1 - x0, h = Math.max(w * 0.45, Math.max(...ys) - Math.min(...ys));
    // Faqat ko'z kesimi (qosh va ko'z osti soyasi kirmasin): kenglik bo'yicha 10% ichkariga, balandlik ~ko'z ochig'i
    return stdIn(x0 + w * 0.1, cy - h / 2, x1 - w * 0.1, cy + h / 2);
  };
  const all = lm.slice(17); // qoshlardan iyakkacha (jag' chizig'isiz — fon kirmasin)
  const fx = all.map((q) => q[0]), fy = all.map((q) => q[1]);
  const face = stdIn(Math.min(...fx), Math.min(...fy), Math.max(...fx), Math.max(...fy));
  const l = eye(36), r = eye(42);
  if (face === null || l === null || r === null || face < 1) return null;
  return (l + r) / 2 / face;
}
