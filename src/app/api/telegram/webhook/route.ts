import { NextResponse, after } from "next/server";
import { handleUpdate } from "@/lib/telegram/bot";
import { botEnabled, type TgUpdate } from "@/lib/telegram/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Telegram webhook. Ochiq endpoint — himoya: setWebhook'da berilgan maxfiy token
 * (TELEGRAM_WEBHOOK_SECRET) har so'rovda sarlavhada keladi.
 *
 * Telegram javobni ~60 soniya kutadi va kechiksa update'ni qayta yuboradi, shuning uchun
 * darhol 200 qaytarib, ishlov berishni after() ichida bajaramiz.
 */
export async function POST(req: Request) {
  if (!botEnabled()) return NextResponse.json({ error: "BOT_DISABLED" }, { status: 503 });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let update: TgUpdate;
  try { update = (await req.json()) as TgUpdate; } catch { return NextResponse.json({ error: "BAD_JSON" }, { status: 400 }); }

  after(async () => {
    try { await handleUpdate(update); } catch (e) { console.error("[telegram][webhook]", e); }
  });
  return NextResponse.json({ ok: true });
}

/** Tirikligini tekshirish uchun. */
export function GET() {
  return NextResponse.json({ ok: true, bot: botEnabled() });
}
