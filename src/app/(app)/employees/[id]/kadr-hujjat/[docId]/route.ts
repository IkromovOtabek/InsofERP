import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { employeeFilePath } from "@/lib/uploads";
import { getSession } from "@/lib/auth";
import { pathAllowed } from "@/lib/nav";
import { hrDocLabel } from "@/lib/hr-docs";

export const dynamic = "force-dynamic";

/**
 * GET /employees/[id]/kadr-hujjat/[docId] — kadr hujjatining imzolangan nusxasi
 * (ariza, shartnoma, buyruq…). `?download=1` — yuklab olish.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  // Ikkinchi qulf: kadr hujjatlari faqat /employees ga kirish huquqi borlarga
  const s = await getSession();
  if (!s || !pathAllowed("/employees", s.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id, docId } = await params;
  const doc = await db.hrDocument.findUnique({ where: { id: docId } });
  const p = doc?.file && doc.employeeId === id ? employeeFilePath(doc.file) : null;
  if (!doc || !p) return NextResponse.json({ error: "Imzolangan nusxa topilmadi" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = encodeURIComponent(doc.fileName || hrDocLabel(doc.kind));
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": doc.fileType || "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      "Content-Length": String(body.length),
    },
  });
}
