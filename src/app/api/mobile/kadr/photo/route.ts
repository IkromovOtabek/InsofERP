import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { pathAllowed } from "@/lib/nav";
import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { ListError } from "@/lib/mobile/list";
import { KIND_MIME, employeeFilePath, type FileKind } from "@/lib/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/kadr/photo?id=<employeeId> — xodimning 3x4 surati; ?doc=<documentId> — hujjat nusxasi (faqat rasm).
 * `{ data }` (data-URL, `face/photo` bilan bir xil shakl). Ruxsat veb bilan bir xil: surat — `/employees` ga kirganlar
 * (`employees/[id]/surat`), hujjat — faqat otdel kadr va direktor (`employees/[id]/hujjat/[docId]`).
 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireMobileUser(req);
    if (!pathAllowed("/employees", user.role, user.perms)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
    const q = new URL(req.url).searchParams;
    let stored: string | null = null;
    const docId = q.get("doc");
    if (docId) {
      if (user.role !== "HR" && user.role !== "DIRECTOR") throw new ListError("FORBIDDEN", "Hujjatlar faqat otdel kadrga ochiq", 403);
      const d = await db.employeeDocument.findUnique({ where: { id: docId }, select: { file: true, fileType: true } });
      if (d && !d.fileType.startsWith("image/")) throw new ListError("NOT_FOUND", "Bu nusxa rasm emas — kompyuterdagi ERP'da oching", 404);
      stored = d?.file ?? null;
    } else {
      const id = q.get("id") ?? "";
      stored = id ? (await db.employee.findUnique({ where: { id }, select: { photo: true } }))?.photo ?? null : null;
    }
    const p = stored ? employeeFilePath(stored) : null;
    if (!p) throw new ListError("NOT_FOUND", "Surat yo'q", 404);
    let body: Buffer;
    try { body = await readFile(p); } catch { throw new ListError("NOT_FOUND", "Fayl diskda topilmadi", 404); }
    const mime = KIND_MIME[p.slice(p.lastIndexOf(".") + 1) as FileKind] ?? "image/jpeg";
    return { data: `data:${mime};base64,${body.toString("base64")}` };
  });
}

export const OPTIONS = preflight;
