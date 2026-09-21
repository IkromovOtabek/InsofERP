import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { scanInvoice, visionEnabled, visionProvider, visionModel, type ScanImage } from "@/lib/ai/vision";

/** Kamera bilan kirim: hujjat rasmini faqat sklad xodimi yuboradi. */
const ROLES = new Set(["PROCUREMENT", "WAREHOUSE", "DIRECTOR"]);
const MAX_IMAGES = 4;
const MAX_BYTES = 6_000_000; // bitta rasm uchun (~6 MB) — brauzer o'zi kichraytirib yuboradi

type Body = { images?: string[] };

/** "data:image/jpeg;base64,AAA…" → { mime, base64 }. */
function parseDataUrl(s: string): ScanImage | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s.trim());
  if (!m) return null;
  if (m[2].length * 0.75 > MAX_BYTES) return null;
  return { mime: m[1], base64: m[2] };
}

/** Rasmdan o'qish sozlanganmi — sahifa shu bo'yicha tugmani ko'rsatadi. */
export async function GET() {
  const s = await getSession();
  if (!s || !ROLES.has(s.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const p = visionProvider();
  return NextResponse.json({ enabled: visionEnabled(), provider: p, model: p ? visionModel(p) : null });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Tizimga kiring" }, { status: 401 });
  if (!ROLES.has(s.role)) return NextResponse.json({ error: "Bu amal uchun huquq yo'q" }, { status: 403 });
  if (!visionEnabled()) return NextResponse.json({ error: "Rasmdan o'qish sozlanmagan (AI kaliti yo'q). Qatorlarni qo'lda kiriting yoki Excel'dan yuklang." }, { status: 503 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "So'rov o'qilmadi" }, { status: 400 }); }
  const list = (body.images ?? []).slice(0, MAX_IMAGES);
  if (!list.length) return NextResponse.json({ error: "Rasm yuborilmadi" }, { status: 400 });
  const images = list.map(parseDataUrl);
  if (images.some((x) => !x)) return NextResponse.json({ error: "Rasm formati noto'g'ri yoki juda katta (JPEG/PNG, 6 MB gacha)" }, { status: 400 });

  const t0 = Date.now();
  try {
    const out = await scanInvoice(images as ScanImage[]);
    return NextResponse.json({ ...out, latency: Date.now() - t0 });
  } catch (e) {
    console.error("[scan/receipt]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Rasmni o'qib bo'lmadi" }, { status: 500 });
  }
}
