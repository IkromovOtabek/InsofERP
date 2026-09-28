import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { shopPhotoPath } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** GET /api/public/shop/photo/[stored] — vitrina surati. Ommaviy: ilova login qilmasdan ko'radi. */
export async function GET(_req: Request, { params }: { params: Promise<{ stored: string }> }) {
  const { stored } = await params;
  const p = shopPhotoPath(stored);
  if (!p) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl topilmadi" }, { status: 404 }); }
  const type = p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Length": String(body.length), "Cache-Control": "public, max-age=86400" },
  });
}
