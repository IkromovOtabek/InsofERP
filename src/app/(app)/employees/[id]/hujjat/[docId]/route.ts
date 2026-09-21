import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employeeFilePath } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** GET /employees/[id]/hujjat/[docId] — hujjat nusxasi (rasm yoki PDF). `?download=1` — yuklab olish. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const doc = await db.employeeDocument.findUnique({ where: { id: docId } });
  const p = doc && doc.employeeId === id ? employeeFilePath(doc.file) : null;
  if (!doc || !p) return NextResponse.json({ error: "Hujjat topilmadi" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = encodeURIComponent(doc.fileName || doc.kind);
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": doc.fileType, "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`, "Content-Length": String(body.length) },
  });
}
