import { z } from "zod";
import { mobileRefresh } from "@/lib/mobile/auth";
import { handle, jsonErr, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ refreshToken: z.string().min(1) });

/** POST /api/mobile/auth/refresh — eski refresh → yangi juftlik. */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return jsonErr("BAD_REQUEST", "refreshToken yo'q", 400);
  return handle(() => mobileRefresh(p.data.refreshToken));
}

export const OPTIONS = preflight;
