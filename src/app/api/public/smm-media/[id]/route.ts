import { db } from "@/lib/db";
import { mediaPath, serveMediaFile, verifyMediaSig } from "@/lib/smm/media";

/**
 * Meta (Instagram/Facebook) post faylini shu manzildan yuklab oladi. Login yo'q — muddatli HMAC imzo
 * (`publicMediaUrl`, standart 6 soat) bilan; imzosiz yoki muddati o'tgan so'rov 404.
 */
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  if (!/^[a-z0-9]{16,40}$/.test(id) || !verifyMediaSig(id, q.get("e"), q.get("s"))) return new Response("Not found", { status: 404 });
  const m = await db.smmMedia.findUnique({ where: { id }, select: { fileName: true, mime: true } });
  const file = m && mediaPath(m.fileName);
  if (!m || !file) return new Response("Not found", { status: 404 });
  return serveMediaFile(file, m.mime, req, "private, max-age=600");
}
