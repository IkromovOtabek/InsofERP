import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employeeFilePath } from "@/lib/uploads";
import { getSession } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { pathAllowed } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** GET /otdel-kadr/nomzod/[id]/fayl — nomzod rezyumesi (faqat yollash huquqi borlarga). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || !pathAllowed("/otdel-kadr", s.role, s.perms) || !canDo(s, "employees", "recruit", ["HR"])) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const c = await db.candidate.findUnique({ where: { id }, select: { file: true, fileName: true, fileType: true } });
  const p = c?.file ? employeeFilePath(c.file) : null;
  if (!c || !p) return NextResponse.json({ error: "Rezyume yo'q" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": c.fileType || "application/octet-stream", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(c.fileName || "rezyume")}`, "Content-Length": String(body.length) },
  });
}
