import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { compareFaces, faceCheckEnabled } from "@/lib/ai/face";
import { faceDescriptor } from "@/lib/face-descriptor";
import { MATCH_MAX_DISTANCE, MATCH_MIN_MARGIN, distance, similarity } from "@/lib/face-id";
import { FACE_DIM } from "@/lib/face-id-const";
import { employeeFilePath, sniffFileKind } from "@/lib/uploads";

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
 * `who` — xabardagi egalik: "Karimov Aziz ning" yoki "Sizning".
 * `disabled: true` — bu xodim uchun yuz tekshiruvi umuman mumkin emas (na Face ID, na AI kaliti).
 */
export type FaceVerify =
  | { ok: true; confidence: number; reason: string; method: "faceid" | "ai" }
  | { ok: false; mismatch: boolean; error: string; confidence?: number; reason?: string; disabled?: boolean };

/** Shu xodim uchun yuz tekshiruvi ishlaydimi (Face ID namunasi bor yoki AI kaliti sozlangan). */
export async function faceVerifyAvailable(employeeId: string): Promise<boolean> {
  if (faceCheckEnabled()) return true;
  return (await db.faceTemplate.count({ where: { employeeId } })) > 0;
}

export async function verifyEmployeeFace(employeeId: string, who: string, photo: File): Promise<FaceVerify> {
  const probe = Buffer.from(await photo.arrayBuffer());
  const probeKind = sniffFileKind(probe);
  if (probeKind === "heic") return { ok: false, mismatch: false, error: "Kamera kadri HEIC formatida — ilovani yangilang yoki qayta skaner qiling" };
  if (probeKind !== "jpg" && probeKind !== "png" && probeKind !== "webp") return { ok: false, mismatch: false, error: "Kadr rasm emas — qayta skaner qiling" };

  const templates = await db.faceTemplate.findMany({ where: { employeeId }, select: { descriptor: true } });
  const own = templates.map((t) => t.descriptor).filter((d) => d.length === FACE_DIM);
  if (own.length) return verifyByTemplates(employeeId, who, own, probe);
  if (!faceCheckEnabled()) {
    return { ok: false, mismatch: false, disabled: true, error: `${who} yuzi Face ID'da ro'yxatga olinmagan — otdel kadr ERP → Davomat bo'limida yuzni ro'yxatga olsin` };
  }
  return verifyByProfilePhoto(employeeId, who, probe);
}

async function verifyByTemplates(employeeId: string, who: string, own: number[][], probe: Buffer): Promise<FaceVerify> {
  let face: Awaited<ReturnType<typeof faceDescriptor>>;
  try { face = await faceDescriptor(probe); } catch (err) {
    console.error("[face] vektor hisoblanmadi:", (err as Error).message);
    return { ok: false, mismatch: false, error: "Yuz tekshiruvi vaqtincha ishlamadi — qayta urining" };
  }
  if (!face) return { ok: false, mismatch: false, error: "Kadrda yuz topilmadi — yuzni kameraga to'g'ri qaratib, yorug' joyda qayta skaner qiling" };

  const d = Math.min(...own.map((t) => distance(face!.descriptor, t)));
  const confidence = similarity(d);
  if (d > MATCH_MAX_DISTANCE) {
    const reason = `Face ID namunasiga mos emas (masofa ${d.toFixed(2)})`;
    return { ok: false, mismatch: true, error: `Yuz tasdiqlanmadi (${confidence}%): ${who} Face ID namunasiga mos kelmadi`, confidence, reason };
  }
  // Begona odam: kadr boshqa faol xodimning namunasiga o'zinikidan sezilarli yaqin bo'lsa — rad
  const others = await db.faceTemplate.findMany({
    where: { employeeId: { not: employeeId }, employee: { isActive: true, firedAt: null } },
    select: { descriptor: true },
  });
  const nearestOther = others.reduce((m, t) => (t.descriptor.length === FACE_DIM ? Math.min(m, distance(face!.descriptor, t.descriptor)) : m), Infinity);
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
    // Provayder xatosi (limit, tarmoq) — ichki matn (org id, URL) ilovaga chiqmasin
    const msg = (err as Error).message ?? "";
    console.error("[face] tekshiruv xatosi:", msg);
    return { ok: false, mismatch: false, error: /rate limit/i.test(msg) ? "AI tekshiruvi band (bepul tarif limiti) — bir daqiqadan keyin qayta urining" : "Yuz tekshiruvi vaqtincha ishlamadi — qayta urining" };
  }
  if (!r.match) return { ok: false, mismatch: true, error: `Yuz tasdiqlanmadi (${r.confidence}%): ${r.reason}`, confidence: r.confidence, reason: r.reason };
  return { ok: true, confidence: r.confidence, reason: r.reason, method: "ai" };
}
