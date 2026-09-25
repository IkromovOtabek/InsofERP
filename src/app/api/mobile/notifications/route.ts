import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileNotifications, readNotifications } from "@/lib/mobile/notifications";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/notifications — ro'yxat va o'qilmaganlar soni. */
export async function GET(req: Request) {
  return handle(async () => mobileNotifications(await requireMobileUser(req)));
}

/** POST /api/mobile/notifications — {ids?} o'qilgan deb belgilaydi (ids bo'lmasa hammasi). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return handle(async () => readNotifications(await requireMobileUser(req), body));
}

export const OPTIONS = preflight;
