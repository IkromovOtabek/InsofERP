import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { supplyDocPath } from "@/lib/procurement";
import { getSession } from "@/lib/auth";
import { pathAllowed } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** GET /taminot/[id]/hujjat/[docId] — xarid hujjati (shartnoma, hisob-faktura, nakladnoy...). `?download=1` — yuklab olish. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const s = await getSession();
  if (!s || !pathAllowed(`/taminot/x`, s.role, s.perms)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id, docId } = await params;
  const doc = await db.supplyDocument.findUnique({ where: { id: docId } });
  const p = doc && doc.requestId === id ? supplyDocPath(doc.file) : null;
  if (!doc || !p) return NextResponse.json({ error: "Hujjat topilmadi" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = encodeURIComponent(doc.fileName || doc.kind);
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": doc.fileType, "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`, "Content-Length": String(body.length) },
  });
}
