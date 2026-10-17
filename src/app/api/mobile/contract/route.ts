import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { requireMobileUser } from "@/lib/mobile/auth";
import { handle, preflight } from "@/lib/mobile/http";
import { ListError, moduleClosed } from "@/lib/mobile/list";
import { contractFilePath } from "@/lib/uploads";
import { pathAllowed } from "@/lib/nav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/contract?id=<zayavka id> — imzolangan shartnoma surati, `{ data }` (data-URL, `kirim/photo` bilan bir xil shakl).
 * Faqat rasm (PDF — vebda ochiladi). Ruxsat: zayavka kartochkasi kabi; sotuv agenti va haydovchi/brigadirga — yo'q.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireMobileUser(req);
    // Veb `orders/[id]/contract/file` bilan bir xil: «Zayavkalar» bo'limi ochiq rollar (direktor bergan modul ruxsati ham)
    if (["AGENT", "DRIVER", "BRIGADIER"].includes(user.role) || moduleClosed(user, "orders") || !pathAllowed("/orders", user.role, user.perms)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const o = id ? await db.order.findUnique({ where: { id }, select: { contractFile: true, contractFileType: true } }) : null;
    const p = o?.contractFile ? contractFilePath(o.contractFile) : null;
    if (!o || !p || !o.contractFileType?.startsWith("image/")) throw new ListError("NOT_FOUND", "Shartnoma surati yo'q", 404);
    let body: Buffer;
    try { body = await readFile(p); } catch { throw new ListError("NOT_FOUND", "Fayl diskda topilmadi", 404); }
    return { data: `data:${o.contractFileType};base64,${body.toString("base64")}` };
  });
}

export const OPTIONS = preflight;
