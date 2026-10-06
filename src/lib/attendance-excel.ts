import * as XLSX from "xlsx";
import { staffMonth } from "@/lib/attendance-report";
import { driversMonth } from "@/lib/driver-pay";

/**
 * Oylik davomat eksporti (.xlsx) — ish haqi asosi: xodimlar bo'yicha jami (kun, soat, kechikish),
 * har kunlik kelgan/ketgan vaqt va haydovchilarning reyslari. Veb "Otdel kadr → Davomat → oy" dan yuklanadi.
 */

type Cell = string | number | null;
const h2 = (min: number) => Math.round((min / 60) * 100) / 100;

function sheet(title: string, head: string[], rows: Cell[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet([[title], [], head, ...rows]);
  ws["!cols"] = widths.map((w) => ({ wch: w }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + rows.length, c: head.length - 1 } }) };
  return ws;
}

export async function attendanceMonthXlsx(rawMonth?: string | null): Promise<{ file: Buffer; name: string }> {
  const [m, drivers] = await Promise.all([staffMonth(rawMonth), driversMonth(rawMonth)]);
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: `Davomat ${m.title}`, CreatedDate: new Date() };

  XLSX.utils.book_append_sheet(wb, sheet(`Davomat — ${m.title}: jami (ish haqi asosi)`, [
    "№", "F.I.Sh.", "Lavozim", "Smena", "Ish kunlari", "Jami soat", "Kechikkan kun", "Kechikish, daq", "Erta ketgan kun", "Erta ketish, daq",
    "Ketdi yozilmagan", "Kelmadi", "Kasal", "Ta'til", "Dam olish", "Belgilanmagan",
  ], m.rows.map((r, i) => [
    i + 1, r.fullName, r.position, `${r.shift.start}–${r.shift.end}`, r.totals.present, h2(r.totals.minutes),
    r.totals.lateDays, r.totals.lateMinutes, r.totals.earlyDays, r.totals.earlyMinutes, r.totals.openDays,
    r.totals.absent, r.totals.sick, r.totals.leave, r.totals.dayoff, r.totals.notMarked,
  ]), [5, 30, 20, 13, 10, 10, 12, 13, 13, 14, 15, 9, 7, 7, 9, 13]), "Jami");

  const dayRows: Cell[][] = [];
  for (const d of m.days) {
    for (const r of m.rows) {
      const x = r.days.get(d.iso);
      if (!x || x.status === "NONE") continue;
      dayRows.push([
        d.iso, x.weekday, r.fullName, r.position, x.statusLabel, x.checkIn, x.checkOut,
        x.minutes != null ? h2(x.minutes) : null, x.lateMin, x.earlyMin, x.source, x.note,
      ]);
    }
  }
  XLSX.utils.book_append_sheet(wb, sheet(`Davomat — ${m.title}: kunlar`, [
    "Sana", "Kun", "F.I.Sh.", "Lavozim", "Belgi", "Keldi", "Ketdi", "Soat", "Kechikdi, daq", "Erta ketdi, daq", "Manba", "Izoh",
  ], dayRows, [11, 6, 30, 20, 11, 7, 7, 7, 12, 13, 12, 30]), "Kunlar");

  XLSX.utils.book_append_sheet(wb, sheet(`Haydovchilar — ${m.title}: reyslar va davomat`, [
    "№", "F.I.Sh.", "Mashina", "Reyslar", "Hajm", "m³", "Km (taxminan)", "Ish kunlari", "Reysli kunlar", "Davomat kunlari", "Soat (davomat)", "Kechikkan kun",
  ], drivers.rows.map((r, i) => [
    i + 1, r.fullName, r.plate, r.trips, r.qtyText, Math.round(r.m3 * 10) / 10, r.km, r.workedDays, r.tripDays, r.attDays, h2(r.minutes), r.lateDays,
  ]), [5, 30, 12, 9, 18, 8, 13, 11, 13, 14, 13, 13]), "Haydovchilar");

  const file = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  return { file, name: `davomat-${m.month}.xlsx` };
}
