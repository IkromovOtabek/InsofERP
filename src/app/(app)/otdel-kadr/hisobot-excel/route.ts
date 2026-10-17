import { NextResponse, type NextRequest } from "next/server";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { hrReportXlsx } from "@/lib/hr/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /otdel-kadr/hisobot-excel?oy=YYYY-MM — kadr hisoboti (12 oy, lavozimlar, bo'shatish sabablari). */
export async function GET(req: NextRequest) {
  await requirePage("/otdel-kadr");
  await requireRoles(["HR"], { module: "employees" });
  const { file, name } = await hrReportXlsx(req.nextUrl.searchParams.get("oy"));
  return new NextResponse(new Uint8Array(file), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}"`, "content-length": String(file.length), "cache-control": "no-store" },
  });
}
