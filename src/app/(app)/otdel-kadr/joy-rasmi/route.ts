import { readFile } from "fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { placePhotoFor } from "@/lib/attendance-report";
import { employeeFilePath } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * GET /otdel-kadr/joy-rasmi?a=<attendanceId>&k=in|out — hududdan tashqarida belgilangan "keldi"/"ketdi" ning joy rasmi.
 * Kim ko'ra olishi — yuz kadri (`/dashboard/davomat/kadr`) bilan bir xil: `placePhotoFor`.
 */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const stored = await placePhotoFor(s, q.get("a"), q.get("k"));
  const p = stored ? employeeFilePath(stored) : null;
  if (!p) return NextResponse.json({ error: "Joy rasmi yo'q" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(body.length), "Cache-Control": "private, max-age=300" },
  });
}
