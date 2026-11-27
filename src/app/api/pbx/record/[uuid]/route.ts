import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canView } from "@/lib/nav";
import { db } from "@/lib/db";
import { recordUrl } from "@/lib/pbx/onlinepbx";

/**
 * Qo'ng'iroq yozuvi (onlinePBX): CRM'ni ko'ra oladigan xodim uchun — onlinePBX'ning vaqtinchalik mp3 havolasiga yo'naltiradi.
 * Faqat bazada bor qo'ng'iroq (begona uuid bilan boshqa yozuvlarni olib bo'lmaydi).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ uuid: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  if (!canView(s, "crm")) return NextResponse.json({ error: "Ruxsat yo'q" }, { status: 403 });
  const { uuid } = await params;
  const call = await db.crmCall.findUnique({ where: { uuid }, select: { talkSec: true } });
  if (!call || call.talkSec <= 0) return NextResponse.json({ error: "Yozuv yo'q" }, { status: 404 });
  const url = await recordUrl(uuid);
  if (!url) return NextResponse.json({ error: "Yozuv topilmadi (onlinePBX'da saqlanmagan yoki muddati o'tgan)" }, { status: 404 });
  return NextResponse.redirect(url, { headers: { "Cache-Control": "private, no-store" } });
}
