import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { liveCalls } from "@/lib/pbx/live";
import { pbxEnabled } from "@/lib/pbx/onlinepbx";

/** Davom etayotgan qo'ng'iroqlar (CRM'dagi kiruvchi qo'ng'iroq oynasi har necha soniyada so'raydi) */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ calls: [] }, { status: 401 });
  if (!pbxEnabled() || !canDo(s, "crm", "calls")) return NextResponse.json({ calls: [] });
  return NextResponse.json({ calls: await liveCalls(s.userId) }, { headers: { "Cache-Control": "no-store" } });
}
