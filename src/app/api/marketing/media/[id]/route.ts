import { getSession } from "@/lib/auth";
import { canView } from "@/lib/nav";
import { db } from "@/lib/db";
import { mediaPath, serveMediaFile } from "@/lib/smm/media";

/** ERP ichida media ko'rish (login + Marketing moduli). Video — Range bilan. */
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new Response("Kirish kerak", { status: 401 });
  if (!canView(s, "marketing")) return new Response("Ruxsat yo'q", { status: 403 });
  const { id } = await params;
  const m = await db.smmMedia.findUnique({ where: { id }, select: { fileName: true, mime: true } });
  const file = m && mediaPath(m.fileName);
  if (!m || !file) return new Response("Topilmadi", { status: 404 });
  return serveMediaFile(file, m.mime, req);
}
