import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { compareFaces } from "@/lib/ai/face";
import { employeeFilePath, sniffFileKind } from "@/lib/uploads";

/**
 * Kamera kadrini xodimning profil surati bilan solishtirish — mobil ilovaning yuz skaneri uchun umumiy qadam:
 *   · rahbar xodimni skaner qiladi (`att.face`, `markAttendanceByFace`);
 *   · xodim o'zi "Keldim / Ketdim" (`lib/self-attendance.ts`).
 * Qoida ikkalasida bir xil: profil surati bo'lishi shart, HEIC rad etiladi (sharp o'qiy olmaydi), model "bir odam"
 * desa va ishonchi `FACE_MIN_CONFIDENCE` dan yuqori bo'lsa — mos. AI kaliti borligini (`faceCheckEnabled`)
 * chaqiruvchi o'zi tekshiradi — xabari har joyda boshqacha.
 *
 * `who` — xabardagi egalik: "Karimov Aziz ning" yoki "Sizning".
 */
export type FaceVerify =
  | { ok: true; confidence: number; reason: string }
  | { ok: false; mismatch: boolean; error: string; confidence?: number; reason?: string };

export async function verifyEmployeeFace(employeeId: string, who: string, photo: File): Promise<FaceVerify> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { photo: true } });
  const refPath = emp?.photo ? employeeFilePath(emp.photo) : null;
  if (!refPath) return { ok: false, mismatch: false, error: `${who} profil surati yo'q — otdel kadr avval kartaga rasm yuklaydi` };
  let reference: Buffer;
  try { reference = await readFile(refPath); } catch { return { ok: false, mismatch: false, error: "Profil surati diskda topilmadi — otdel kadr qayta yuklasin" }; }
  const probe = Buffer.from(await photo.arrayBuffer());
  // HEIC (iPhone) serverda o'qilmaydi (sharp 0.33 — HEIF dekoderi o'chiq): umumiy "vaqtincha ishlamadi" o'rniga aniq sabab
  if (sniffFileKind(reference) === "heic") return { ok: false, mismatch: false, error: `${who} profil surati HEIC formatida — yuz tekshiruvi uni o'qiy olmaydi. Otdel kadr suratni JPG yoki PNG qilib qayta yuklasin` };
  const probeKind = sniffFileKind(probe);
  if (probeKind === "heic") return { ok: false, mismatch: false, error: "Kamera kadri HEIC formatida — ilovani yangilang yoki qayta skaner qiling" };
  if (probeKind !== "jpg" && probeKind !== "png" && probeKind !== "webp") return { ok: false, mismatch: false, error: "Kadr rasm emas — qayta skaner qiling" };

  let r: Awaited<ReturnType<typeof compareFaces>>;
  try { r = await compareFaces(reference, probe); } catch (err) {
    // Provayder xatosi (limit, tarmoq) — ichki matn (org id, URL) ilovaga chiqmasin
    const msg = (err as Error).message ?? "";
    console.error("[face] tekshiruv xatosi:", msg);
    return { ok: false, mismatch: false, error: /rate limit/i.test(msg) ? "AI tekshiruvi band (bepul tarif limiti) — bir daqiqadan keyin qayta urining" : "Yuz tekshiruvi vaqtincha ishlamadi — qayta urining" };
  }
  if (!r.match) return { ok: false, mismatch: true, error: `Yuz tasdiqlanmadi (${r.confidence}%): ${r.reason}`, confidence: r.confidence, reason: r.reason };
  return { ok: true, confidence: r.confidence, reason: r.reason };
}
