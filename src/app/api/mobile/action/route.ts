import { requireMobileUser } from "@/lib/mobile/auth";
import { runMobileAction } from "@/lib/mobile/actions";
import { handle, jsonErr, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/mobile/action — {action, id, payload} → amalni bajaradi (veb ERP tugmasi bilan bir xil). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { action?: string; id?: string; payload?: Record<string, unknown> } | null;
  if (!body?.action || !body.id) return jsonErr("BAD_REQUEST", "action va id kerak", 400);
  return handle(async () => runMobileAction(await requireMobileUser(req), body.action!, body.id!, body.payload ?? {}));
}

export const OPTIONS = preflight;
