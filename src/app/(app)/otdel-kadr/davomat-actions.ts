"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { dayUtc, isAttendanceStatus, toMinutes, validDay, workedMinutes } from "@/lib/davomat";
import type { ActionState } from "@/lib/action";
import type { AttendanceStatus } from "@/generated/prisma";

/** Davomatni faqat otdel kadr (va direktor) yuritadi. */
const hr = () => requireSession(["HR"]);

type Row = { employeeId: string; status: AttendanceStatus | null; checkIn: string | null; checkOut: string | null; note: string | null };

const clean = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

/**
 * Kunlik tabel bitta forma bilan yuboriladi: har xodimga `st:`, `in:`, `out:`, `nt:` maydonlari.
 * Ro'yxatning o'zi `emp[]` da keladi — formada bo'lmagan xodimga tegilmaydi.
 */
function readRows(fd: FormData): { rows: Row[] } | { error: string } {
  const ids = fd.getAll("emp[]").map(String);
  if (!ids.length) return { error: "Xodimlar ro'yxati bo'sh" };
  const rows: Row[] = [];
  for (const employeeId of ids) {
    const raw = clean(fd.get(`st:${employeeId}`));
    if (raw && !isAttendanceStatus(raw)) return { error: "Noma'lum davomat belgisi" };
    const status = (raw ?? null) as AttendanceStatus | null;
    // Soat faqat ishga chiqqan kunda saqlanadi — qolgan belgilarda kerak emas
    const checkIn = status === "PRESENT" ? clean(fd.get(`in:${employeeId}`)) : null;
    const checkOut = status === "PRESENT" ? clean(fd.get(`out:${employeeId}`)) : null;
    if (checkIn && toMinutes(checkIn) === null) return { error: "Kelgan vaqt noto'g'ri — SS:DD ko'rinishida yozing" };
    if (checkOut && toMinutes(checkOut) === null) return { error: "Ketgan vaqt noto'g'ri — SS:DD ko'rinishida yozing" };
    rows.push({ employeeId, status, checkIn, checkOut, note: clean(fd.get(`nt:${employeeId}`)) });
  }
  return { rows };
}

/**
 * Kunlik davomatni saqlaydi. Belgi tanlanmagan xodimning yozuvi o'chadi (tabelda bo'sh katak),
 * qolganlari `employeeId + date` bo'yicha yangilanadi.
 */
export async function saveAttendance(iso: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const day = validDay(iso);
  if (!day) return { error: "Sana noto'g'ri" };
  const r = readRows(fd);
  if ("error" in r) return { error: r.error };

  const date = dayUtc(day);
  const marked = r.rows.filter((x) => x.status);
  const cleared = r.rows.filter((x) => !x.status).map((x) => x.employeeId);

  await db.$transaction(async (tx) => {
    if (cleared.length) await tx.attendance.deleteMany({ where: { date, employeeId: { in: cleared } } });
    for (const x of marked) {
      const data = { status: x.status!, checkIn: x.checkIn, checkOut: x.checkOut, note: x.note, markedById: s.userId };
      await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: x.employeeId, date } },
        create: { employeeId: x.employeeId, date, ...data },
        update: data,
      });
    }
    await audit(tx, s.userId, "UPDATE", "Attendance", day, undefined, { belgilandi: marked.length, tozalandi: cleared.length });
  });

  revalidatePath("/otdel-kadr");
  const hours = marked.reduce((n, x) => n + (workedMinutes(x.checkIn, x.checkOut) ?? 0), 0);
  return {
    ok: true,
    note: `${marked.length} ta xodim belgilandi${hours ? ` · jami ${(hours / 60).toFixed(1).replace(".0", "")} soat` : ""}${cleared.length ? ` · ${cleared.length} ta katak tozalandi` : ""}`,
  };
}
