import { readFile } from "fs/promises";
import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { ListError } from "@/lib/mobile/list";
import { placePhotoFor } from "@/lib/attendance-report";
import { faceScope } from "@/lib/face-id";
import { employeeFilePath } from "@/lib/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/attendance/place-photo?id=<attendanceId>&kind=in|out — hududdan tashqarida belgilangan "keldi"/"ketdi"
 * ning joy rasmi, `{ data }` (data-URL). Kim ko'ra olishi — yuz kadri (`/api/mobile/face/photo`) bilan bir xil: `placePhotoFor`.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return handle(async () => {
    const u = await requireMobileUser(req);
    const who = { role: u.role, perms: u.perms };
    if (!faceScope(who)) throw new ListError("FORBIDDEN", "Bu bo'lim sizning lavozimingiz uchun ochilmagan", 403);
    const stored = await placePhotoFor(who, q.get("id"), q.get("kind"));
    const p = stored ? employeeFilePath(stored) : null;
    if (!p) throw new ListError("NOT_FOUND", "Joy rasmi yo'q", 404);
    let body: Buffer;
    try { body = await readFile(p); } catch { throw new ListError("NOT_FOUND", "Fayl diskda topilmadi", 404); }
    return { data: `data:image/jpeg;base64,${body.toString("base64")}` };
  });
}

export const OPTIONS = preflight;
