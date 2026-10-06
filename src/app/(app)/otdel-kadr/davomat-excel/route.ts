import { NextResponse, type NextRequest } from "next/server";
import { requireRoles } from "@/lib/page-guard";
import { attendanceMonthXlsx } from "@/lib/attendance-excel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /otdel-kadr/davomat-excel?oy=YYYY-MM — oylik davomat va haydovchilar reyslari (.xlsx), ish haqi asosi. */
export async function GET(req: NextRequest) {
  await requireRoles(["HR"], { module: "employees" });
  const { file, name } = await attendanceMonthXlsx(req.nextUrl.searchParams.get("oy"));
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}"`,
      "content-length": String(file.length),
      "cache-control": "no-store",
    },
  });
}
