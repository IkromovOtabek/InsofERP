import { readFile } from "fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { facePhotoFor } from "@/lib/face-id";
import { employeeFilePath } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * GET /dashboard/davomat/kadr?a=<attendanceId>&k=in|out — skaner yozgan belgining kadri;
 * ?t=<faceTemplateId> — ro'yxatga olishdagi kadr. Kim ko'ra olishi — `facePhotoFor`.
 */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const stored = await facePhotoFor(s, { a: q.get("a"), k: q.get("k"), t: q.get("t") });
  const p = stored ? employeeFilePath(stored) : null;
  if (!p) return NextResponse.json({ error: "Kadr yo'q" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(body.length), "Cache-Control": "private, max-age=300" },
  });
}
