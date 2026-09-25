import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contractFilePath } from "@/lib/uploads";
import { getSession } from "@/lib/auth";
import { pathAllowed } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** GET /orders/[id]/contract/file — tizimga yuklangan (Didox'da imzolangan) shartnoma faylini ko'rsatadi. Login middleware'da tekshiriladi. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Ikkinchi qulf: middleware'dan tashqari marshrutning o'zi ham sessiya va rolni tekshiradi
  const s = await getSession();
  if (!s || !pathAllowed("/orders", s.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await params;
  const o = await db.order.findUnique({ where: { id }, select: { contractNo: true, contractFile: true, contractFileName: true, contractFileType: true } });
  const p = o?.contractFile ? contractFilePath(o.contractFile) : null;
  if (!o || !p) return NextResponse.json({ error: "Shartnoma fayli yuklanmagan" }, { status: 404 });
  let body: Buffer;
  try { body = await readFile(p); } catch { return NextResponse.json({ error: "Fayl diskda topilmadi" }, { status: 404 }); }
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = encodeURIComponent(o.contractFileName ?? `Shartnoma-${o.contractNo}`);
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": o.contractFileType ?? "application/octet-stream", "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`, "Content-Length": String(body.length) },
  });
}
