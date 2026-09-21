import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileCreate } from "@/lib/mobile/create";
import { handle, jsonErr, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/mobile/create — {key, payload} → yangi zayavka yoki reys. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { key?: string; payload?: unknown } | null;
  if (!body?.key) return jsonErr("BAD_REQUEST", "key kerak", 400);
  return handle(async () => mobileCreate(await requireMobileUser(req), body.key!, body.payload ?? {}));
}

export const OPTIONS = preflight;
