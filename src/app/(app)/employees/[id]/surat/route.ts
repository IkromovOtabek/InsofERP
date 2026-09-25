import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employeeFilePath } from "@/lib/uploads";
import { getSession } from "@/lib/auth";
import { pathAllowed } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** GET /employees/[id]/surat — xodimning 3x4 surati. Login middleware'da tekshiriladi. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Ikkinchi qulf: xodim hujjatlari faqat /employees ga kirish huquqi borlarga
  const s = await getSession();
  if (!s || !pathAllowed("/employees", s.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const e = await db.employee.findUnique({ where: { id }, select: { photo: true } });
  const p = e?.photo ? employeeFilePath(e.photo) : null;
  if (!p) return NextResponse.json({ error: "Surat yuklanmagan" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  const type = p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : p.endsWith(".heic") ? "image/heic" : "image/jpeg";
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Length": String(body.length), "Cache-Control": "private, max-age=300" },
  });
}
