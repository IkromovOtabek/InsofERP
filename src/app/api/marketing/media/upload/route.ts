import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { commitUpload, writeChunk } from "@/lib/smm/media";

/**
 * Media kutubxonaga bo'laklab yuklash: POST ?u=<uploadId>&i=<index>&n=<total>&name=<fayl nomi>, tana — bo'lak baytlari.
 * Oxirgi bo'lakda fayl birlashtiriladi, turi tekshiriladi va SmmMedia yozuvi yaratiladi.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Kirish kerak" }, { status: 401 });
  if (!canDo(s, "marketing", "content")) return Response.json({ error: "Ruxsat yo'q" }, { status: 403 });

  const q = new URL(req.url).searchParams;
  const uploadId = q.get("u") ?? "";
  const index = Number(q.get("i"));
  const total = Number(q.get("n"));
  const name = (q.get("name") ?? "media").replace(/\.[^.]+$/, "").slice(0, 120) || "media";
  const data = new Uint8Array(await req.arrayBuffer());

  const r = await writeChunk(uploadId, index, total, data);
  if ("error" in r) return Response.json({ error: r.error }, { status: 422 });
  if (!r.done) return Response.json({ ok: true, done: false });

  const id = randomBytes(12).toString("hex");
  const fileName = await commitUpload(uploadId, r.tmpFile, id, r.type.ext);
  const m = await db.smmMedia.create({
    data: { id, kind: r.type.kind, fileName, mime: r.type.mime, size: r.size, title: name, uploadedById: s.userId, uploadedBy: s.fullName },
  });
  await audit(db, s.userId, "CREATE", "SmmMedia", m.id, undefined, { title: m.title, kind: m.kind, size: m.size });
  return Response.json({ ok: true, done: true, media: { id: m.id, kind: m.kind, title: m.title } });
}
