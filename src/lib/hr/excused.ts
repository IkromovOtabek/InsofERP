import { db } from "@/lib/db";
import { dayUtc, isoDay, shiftDay } from "@/lib/davomat";

/** Sababi tasdiqlangan kunlar (jarima yozilmaydi): xodim → kunlar to'plami. */
export async function excusedDays(employeeIds: string[], from: string, to: string): Promise<Map<string, { late: Set<string>; absent: Set<string>; unpaid: Set<string> }>> {
  const rows = employeeIds.length
    ? await db.hrRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: "APPROVED", kind: { in: ["LATE_REASON", "ABSENCE_REASON", "UNPAID"] }, dateFrom: { lte: dayUtc(to) }, dateTo: { gte: dayUtc(from) } },
      select: { employeeId: true, kind: true, dateFrom: true, dateTo: true },
    })
    : [];
  const out = new Map<string, { late: Set<string>; absent: Set<string>; unpaid: Set<string> }>();
  for (const r of rows) {
    const e = out.get(r.employeeId) ?? { late: new Set(), absent: new Set(), unpaid: new Set() };
    const set = r.kind === "LATE_REASON" ? e.late : r.kind === "ABSENCE_REASON" ? e.absent : e.unpaid;
    for (let d = isoDay(r.dateFrom!); d <= isoDay(r.dateTo!); d = shiftDay(d, 1)) set.add(d);
    out.set(r.employeeId, e);
  }
  return out;
}
