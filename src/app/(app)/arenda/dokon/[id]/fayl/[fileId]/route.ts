import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { pathAllowed } from "@/lib/nav";
import { rentFilePath } from "@/lib/rent-contract";

export const dynamic = "force-dynamic";

/**
 * GET /arenda/dokon/[id]/fayl/[fileId] — do'kon hujjati yoki surati (shartnoma skani, pasport nusxasi, do'kon rasmi).
 * Faqat Arenda bo'limiga ruxsati bor xodimga. `?download=1` — yuklab olish.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const s = await getSession();
  if (!s || !pathAllowed("/arenda", s.role, s.perms)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id, fileId } = await params;
  const f = await db.rentFile.findUnique({ where: { id: fileId } });
  const p = f && f.shopId === id && !f.removedAt ? rentFilePath(f.file) : null;
  if (!f || !p) return NextResponse.json({ error: "Fayl topilmadi" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": f.fileType || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "Content-Length": String(body.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
