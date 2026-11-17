import * as XLSX from "xlsx";
import { NextResponse, type NextRequest } from "next/server";
import { requirePage } from "@/lib/page-guard";
import { SHEET_COLS, runSheet } from "@/lib/hr/vedomost-sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /ish-haqi/<id>/excel — vedomost Excel C2026 ko'rinishida: bo'limlar, ushlanma ustunlari, bo'lim va umumiy jami. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requirePage("/ish-haqi");
  const { id } = await params;
  const sh = await runSheet(id);
  if (!sh) return new NextResponse("Topilmadi", { status: 404 });
  const head = ["№", "F.I.O.", "Lavozim", ...SHEET_COLS.map((c) => c.label)];
  const aoa: (string | number | null)[][] = [[sh.run.title], [], head];
  const sectionRows: number[] = [], totalRows: number[] = [];
  let no = 0;
  for (const g of sh.groups) {
    sectionRows.push(aoa.length);
    aoa.push([null, g.label]);
    for (const r of g.rows) aoa.push([++no, r.fullName, r.position, ...SHEET_COLS.map((c) => Math.round(r.v[c.key]) || null)]);
    totalRows.push(aoa.length);
    aoa.push([null, `Jami: ${g.label}`, null, ...SHEET_COLS.map((c) => Math.round(g.total[c.key]) || null)]);
  }
  aoa.push([]);
  aoa.push([null, "JAMI", null, ...SHEET_COLS.map((c) => Math.round(sh.total[c.key]))]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Raqam formati: minglik ajratgich
  const ref = XLSX.utils.decode_range(ws["!ref"]!);
  for (let r = 3; r <= ref.e.r; r++) for (let c = 3; c <= ref.e.c; c++) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]?.t === "n") ws[a].z = "#,##0"; }
  ws["!cols"] = [{ wch: 5 }, { wch: 34 }, { wch: 18 }, ...SHEET_COLS.map(() => ({ wch: 14 }))];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, ...sectionRows.map((r) => ({ s: { r, c: 1 }, e: { r, c: 2 + SHEET_COLS.length } }))];
  ws["!freeze"] = { xSplit: 2, ySplit: 3 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vedomost");
  const file = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const name = `${sh.run.docNo}.xlsx`;
  return new NextResponse(new Uint8Array(file), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}"`, "content-length": String(file.length), "cache-control": "no-store" },
  });
}
