import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cleanVisitPath } from "@/lib/visit-info";
import { recordPage } from "@/lib/visits";

/**
 * Sahifa ochildi — ERP qobig'i (`AppShell`) `navigator.sendBeacon` bilan yuboradi: `{ path }` (text/plain).
 * Faqat kirgan xodim, faqat ERP ichki yo'li. Javobni hech kim kutmaydi: jurnal yozilmasa ham 204 (xato logda).
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return new NextResponse(null, { status: 401 });
  let path: string | null = null;
  try { path = cleanVisitPath((JSON.parse(await req.text()) as { path?: unknown })?.path); } catch { /* buzuq tana */ }
  if (!path) return new NextResponse(null, { status: 400 });
  try {
    await recordPage(s, path, req.headers);
  } catch (e) {
    console.error("[visits] sahifa yozilmadi", e instanceof Error ? e.message : e);
  }
  return new NextResponse(null, { status: 204 });
}
