import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { pathAllowed } from "@/lib/nav";
import { KIND_MIME, requestPhotoPath, type FileKind } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** GET /mexanik-sorovlar/[id]/surat — so'rov surati. Mexanik — faqat o'z so'rovi. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || !pathAllowed("/mexanik-sorovlar", s.role, s.perms)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const r = await db.mechanicRequest.findUnique({ where: { id }, select: { photo: true, createdById: true } });
  if (!r || (s.role === "MECHANIC" && r.createdById !== s.userId)) return NextResponse.json({ error: "So'rov topilmadi" }, { status: 404 });
  const p = r.photo ? requestPhotoPath(r.photo) : null;
  if (!p) return NextResponse.json({ error: "Surat yo'q" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  const type = KIND_MIME[p.slice(p.lastIndexOf(".") + 1) as FileKind] ?? "image/jpeg";
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Length": String(body.length), "Cache-Control": "private, max-age=300" },
  });
}
