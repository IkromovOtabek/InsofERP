import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { ListError, listAllowed } from "@/lib/mobile/list";
import { KIND_MIME, requestPhotoPath, type FileKind } from "@/lib/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/kirim/photo?id=<so'rov id> — mexanik so'rovi surati, `{ data }` (data-URL, `face/photo` bilan bir xil shakl).
 * Ruxsat ro'yxat bilan bir xil (`kirim`): mexanik — faqat o'z so'rovi, ish boshqaruvchi, kassa, direktor — hammasi.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireMobileUser(req);
    if (!listAllowed(user, "kirim")) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const r = id ? await db.mechanicRequest.findUnique({ where: { id }, select: { photo: true, createdById: true } }) : null;
    if (!r) throw new ListError("NOT_FOUND", "So'rov topilmadi", 404);
    if (user.role === "MECHANIC" && r.createdById !== user.id) throw new ListError("FORBIDDEN", "Bu so'rov sizniki emas", 403);
    const p = r.photo ? requestPhotoPath(r.photo) : null;
    if (!p) throw new ListError("NOT_FOUND", "Surat yo'q", 404);
    let body: Buffer;
    try { body = await readFile(p); } catch { throw new ListError("NOT_FOUND", "Fayl diskda topilmadi", 404); }
    const mime = KIND_MIME[p.slice(p.lastIndexOf(".") + 1) as FileKind] ?? "image/jpeg";
    return { data: `data:${mime};base64,${body.toString("base64")}` };
  });
}

export const OPTIONS = preflight;
