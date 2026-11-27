import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { handleRealizator, realizatorSchema } from "@/lib/crm/realizator";

/**
 * INSOF realizator boti → Sotuv CRM (`lib/crm/realizator.ts`). Faqat bot: `Authorization: Bearer <CRM_BOT_TOKEN>`
 * (korxona sozlamasi `tenants/<slug>.env`). Token sozlanmagan bo'lsa — 503, noto'g'ri — 401.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRM_BOT_TOKEN?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "CRM_BOT_TOKEN sozlanmagan" }, { status: 503 });
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(got), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "Ruxsat yo'q" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const p = realizatorSchema.safeParse(body);
  if (!p.success) return NextResponse.json({ ok: false, error: `Noto'g'ri so'rov: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}` }, { status: 400 });
  try {
    const r = await handleRealizator(p.data);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("crm realizator", e);
    return NextResponse.json({ ok: false, error: "Ichki xato" }, { status: 500 });
  }
}
