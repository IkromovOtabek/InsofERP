import path from "node:path";
import sharp from "sharp";
import { FACE_DIM } from "@/lib/face-id-const";

/**
 * Serverda yuz vektori — ERP Face ID skaneri brauzerda ishlatadigan AYNAN o'sha model (face-api: TinyFaceDetector →
 * 68 nuqta → ResNet-34, 128 son). Mobil ilova (ECO) kadr yuboradi, server vektorni shu yerda hisoblab, ERP'da
 * ro'yxatga olingan `FaceTemplate` namunalari bilan solishtiradi (`lib/face-verify.ts`) — profil surati va AI kerak emas.
 *
 * Backend — WASM (`@tensorflow/tfjs-backend-wasm`): tfjs-node kabi AVX talab qilmaydi, serverning eski protsessorida
 * ham ishlaydi; bir kadr ~0,1–0,5 s. Modellar va kutubxona birinchi chaqiruvda bir marta yuklanadi.
 * Paketlar `next.config.ts` → `serverExternalPackages` da (webpack bundle qilmaydi — wasm/model fayllari joyida qolsin).
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

/** Kadrdagi (JPEG/PNG/WEBP) eng aniq yuzning vektori; yuz topilmasa — null. */
export async function faceDescriptor(image: Buffer): Promise<{ descriptor: number[]; score: number } | null> {
  const api = await load();
  const { data, info } = await sharp(image).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const input = api.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], "int32");
  try {
    const r = await api.detectSingleFace(input as never, new api.TinyFaceDetectorOptions({ inputSize: INPUT_SIZE, scoreThreshold: SCORE_THRESHOLD }))
      .withFaceLandmarks().withFaceDescriptor();
    if (!r || r.descriptor.length !== FACE_DIM) return null;
    return { descriptor: Array.from(r.descriptor), score: r.detection.score };
  } finally {
    input.dispose();
  }
}
