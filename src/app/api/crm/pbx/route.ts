import { NextResponse, type NextRequest } from "next/server";
import { handleHook, hookKeyOk, type PbxHook } from "@/lib/pbx/live";
import { pbxEnabled } from "@/lib/pbx/onlinepbx";

/**
 * onlinePBX webhook (kabinet → Интеграция → Webhooks): `POST /api/crm/pbx?k=<kalit>`. Kalit — CRM → Sozlamalar → Telefoniya.
 * Tana JSON yoki forma bo'lishi mumkin. Har doim tez javob beradi; xato bo'lsa ham onlinePBX qayta-qayta yubormasin (200).
 */
async function body(req: NextRequest): Promise<PbxHook> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (type.includes("json") || text.trim().startsWith("{")) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v == null ? undefined : String(v)]));
    } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export async function POST(req: NextRequest) {
  if (!pbxEnabled()) return NextResponse.json({ ok: false, error: "Telefoniya ulanmagan" }, { status: 503 });
  if (!(await hookKeyOk(req.nextUrl.searchParams.get("k")))) return NextResponse.json({ ok: false, error: "Ruxsat yo'q" }, { status: 401 });
  try {
    const r = await handleHook(await body(req));
    return NextResponse.json({ ok: true, r });
  } catch (e) {
    console.error("pbx webhook", e);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

/** onlinePBX ulashda manzilni GET bilan tekshirishi mumkin */
export async function GET(req: NextRequest) {
  return NextResponse.json({ ok: pbxEnabled() && (await hookKeyOk(req.nextUrl.searchParams.get("k"))) });
}
