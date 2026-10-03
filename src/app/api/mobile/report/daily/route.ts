import { NextResponse } from "next/server";
import { MobileAuthError, requireMobileUser } from "@/lib/mobile/auth";
import { dailyReportXlsx } from "@/lib/mobile/daily-report";
import { jsonErr, preflight } from "@/lib/mobile/http";
import { ListError } from "@/lib/mobile/list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mobile/report/daily?date=YYYY-MM-DD — kunlik hisobot (.xlsx), faqat direktor.
 * Xato bo'lsa boshqa mobil endpointlar kabi JSON (`{code, message}`) qaytadi — ilova shuni o'qiydi.
 */
export async function GET(req: Request) {
  try {
    const user = await requireMobileUser(req);
    const { file, name } = await dailyReportXlsx(user, new URL(req.url).searchParams.get("date"));
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${name}"`,
        "content-length": String(file.length),
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "content-disposition",
      },
    });
  } catch (e) {
    if (e instanceof MobileAuthError) return jsonErr(e.code, e.message, e.status);
    if (e instanceof ListError) return jsonErr(e.code, e.message, e.status);
    console.error("[mobile-api] report/daily", e);
    return jsonErr("INTERNAL", "Hisobotni tayyorlab bo'lmadi", 500);
  }
}

export const OPTIONS = preflight;
