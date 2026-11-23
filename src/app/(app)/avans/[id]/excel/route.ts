import * as XLSX from "xlsx";
import { NextResponse, type NextRequest } from "next/server";
import { requirePage } from "@/lib/page-guard";
import { dateTime, date } from "@/lib/format";
import { monthTitle } from "@/lib/davomat";
import { ADVANCE_STATUS_LABEL, advanceSheet, canViewSheet } from "@/lib/hr/advance-sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /avans/<id>/excel — avans varaqasi Excel'da («Аванс наличка» kabi): guruh bo'limlari, ishlagani, tavsiya, avans,
 * berildi (sana, kassa, kim) va imzo ustuni. Tuzuvchi, jo'natuvchi va qabul qiluvchi yuklab oladi.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/avans");
  const { id } = await params;
  const sh = await advanceSheet(id);
  if (!sh) return new NextResponse("Topilmadi", { status: 404 });
  if (!canViewSheet(s, sh)) return new NextResponse("Ruxsat yo'q", { status: 403 });
  const draft = sh.status === "DRAFT";
  const lines = draft ? sh.lines : sh.lines.filter((l) => l.amount > 0);
  const head = ["№", "F.I.O.", "Lavozim", "Ishlagan (oy boshidan)", "Tavsiya", "Avans", "Berildi", "Kassa", "Kim berdi", "Imzo"];
  const aoa: (string | number | null)[][] = [
    [`Avans varaqasi ${sh.docNo} — ${monthTitle(sh.month)} (${sh.groupLabel ?? "barcha xodimlar"}), ${date(sh.asOf)} holatiga · ${ADVANCE_STATUS_LABEL[sh.status]}`],
    [`Tuzdi: ${sh.createdBy}${sh.recipient ? ` · jo'natildi: ${sh.recipient}${sh.sentAt ? ` (${dateTime(sh.sentAt)})` : ""}` : ""}`],
    head,
  ];
  const sectionRows: number[] = [];
  let no = 0, grp = "";
  for (const l of lines) {
    if (l.groupLabel !== grp) { grp = l.groupLabel; sectionRows.push(aoa.length); aoa.push([null, grp]); }
    aoa.push([++no, l.fullName, l.position, Math.round(l.earned) || null, Math.round(l.suggested) || null, Math.round(l.amount) || null,
      l.givenAt ? dateTime(l.givenAt) : null, l.account, l.givenBy, null]);
  }
  aoa.push([]);
  aoa.push([null, "JAMI", null, Math.round(lines.reduce((x, l) => x + l.earned, 0)), Math.round(lines.reduce((x, l) => x + l.suggested, 0)),
    Math.round(lines.reduce((x, l) => x + l.amount, 0)), `berildi: ${Math.round(sh.given)}`]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ref = XLSX.utils.decode_range(ws["!ref"]!);
  for (let r = 3; r <= ref.e.r; r++) for (let c = 3; c <= 5; c++) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]?.t === "n") ws[a].z = "#,##0"; }
  ws["!cols"] = [{ wch: 5 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 17 }, { wch: 16 }, { wch: 22 }, { wch: 14 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }, ...sectionRows.map((r) => ({ s: { r, c: 1 }, e: { r, c: 9 } }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Avans");
  const file = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(file), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${sh.docNo}.xlsx"`, "content-length": String(file.length), "cache-control": "no-store" },
  });
}
