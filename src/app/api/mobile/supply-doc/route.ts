import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { ListError } from "@/lib/mobile/list";
import { pathAllowed } from "@/lib/nav";
import { supplyDocPath } from "@/lib/procurement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/supply-doc?id=<hujjat id> — ta'minot hujjati (shartnoma, faktura, nakladnoy…), `{ data }` (data-URL,
 * `kirim/photo` bilan bir xil shakl). Ruxsat veb `/taminot/[id]/hujjat/[docId]` bilan aynan bir xil: `pathAllowed("/taminot/x")`
 * (rol + direktor bergan `taminot` moduli). Ilova rasmni o'zida ochadi; PDF ham shu yo'l bilan keladi (ko'rsatish — ilovaga bog'liq).
 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireMobileUser(req);
    if (!pathAllowed("/taminot/x", user.role, user.perms)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const doc = id ? await db.supplyDocument.findUnique({ where: { id }, select: { file: true, fileType: true } }) : null;
    const p = doc ? supplyDocPath(doc.file) : null;
    if (!doc || !p) throw new ListError("NOT_FOUND", "Hujjat topilmadi", 404);
    let body: Buffer;
    try { body = await readFile(p); } catch { throw new ListError("NOT_FOUND", "Fayl diskda topilmadi", 404); }
    return { data: `data:${doc.fileType};base64,${body.toString("base64")}` };
  });
}

export const OPTIONS = preflight;
