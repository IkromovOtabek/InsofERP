import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

/**
 * GET /api/face-models/<fayl> — Face ID skaneri modellari (face-api: yuz topish, 68 nuqta, yuz vektori).
 * Fayllar npm paketining o'zidan beriladi (repoga 7 MB ikkilik qo'shilmaydi, versiya paket bilan birga yangilanadi).
 * Faqat ro'yxatdagi nomlar — boshqa yo'l o'qilmaydi. Login middleware'da tekshiriladi.
 */
const MODELS = new Set([
  "tiny_face_detector_model-weights_manifest.json", "tiny_face_detector_model.bin",
  "face_landmark_68_model-weights_manifest.json", "face_landmark_68_model.bin",
  "face_recognition_model-weights_manifest.json", "face_recognition_model.bin",
]);
const DIR = path.join(process.cwd(), "node_modules", "@vladmandic", "face-api", "model");

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!MODELS.has(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(path.join(DIR, file)); } catch { return NextResponse.json({ error: "Model topilmadi" }, { status: 404 }); }
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": file.endsWith(".json") ? "application/json" : "application/octet-stream",
      "Content-Length": String(body.length),
      // Modellar o'zgarmaydi (paket versiyasi bilan) — brauzer bir hafta keshdan oladi, skaner tez ochiladi
      "Cache-Control": "private, max-age=604800",
    },
  });
}
