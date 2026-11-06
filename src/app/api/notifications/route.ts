import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { markNotificationsRead } from "@/lib/notify";
import { webNotifications } from "@/lib/web-notifications";

export const dynamic = "force-dynamic";

/** GET /api/notifications — vebdagi kartochkalar oqimi: o'qilmaganlar soni va eng yangilari (cookie sessiya). */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await webNotifications(s), { headers: { "Cache-Control": "no-store" } });
}

/** POST /api/notifications — «Tozalash»: {ids?} o'qilgan deb belgilanadi (ids bo'lmasa hammasi). */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined;
  await markNotificationsRead(s.userId, ids);
  return NextResponse.json(await webNotifications(s), { headers: { "Cache-Control": "no-store" } });
}
