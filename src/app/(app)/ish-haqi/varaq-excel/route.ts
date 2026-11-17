import { NextResponse, type NextRequest } from "next/server";
import { requirePage } from "@/lib/page-guard";
import { canPayroll } from "@/lib/hr/payroll";
import { loadWorkbook, workbookXlsx } from "@/lib/payroll-sheets";
import type { SheetData } from "@/lib/sheet-calc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /ish-haqi/varaq-excel?id=… — oylik kitobning joriy holati (tahrirlar bilan, formulalar qayta hisoblangan) .xlsx bo'lib. */
export async function GET(req: NextRequest) {
  const s = await requirePage("/ish-haqi");
  if (!canPayroll(s, "sheets")) return new NextResponse("Ruxsat yo'q", { status: 403 });
  const wb = await loadWorkbook(req.nextUrl.searchParams.get("id") ?? "");
  if (!wb) return new NextResponse("Topilmadi", { status: 404 });
  const file = workbookXlsx(wb.sheets.map((x) => ({ name: x.name, hidden: x.hidden, data: x.data as unknown as SheetData })));
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="oylik-varaqlar.xlsx"; filename*=UTF-8''${encodeURIComponent(wb.title)}.xlsx`,
      "content-length": String(file.length),
      "cache-control": "no-store",
    },
  });
}
