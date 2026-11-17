import type { AttendanceStatus } from "@/generated/prisma";

/* Tabel katagi qiymati — server (`lib/hr/tabel.ts`) va brauzer (`ish-haqi/tabel-grid.tsx`) bir xil tushunadi. */

export const TABEL_CODES: Record<string, AttendanceStatus> = { H: "ABSENT", K: "SICK", T: "LEAVE", D: "DAYOFF" };
export const TABEL_CODE_OF: Partial<Record<AttendanceStatus, string>> = { ABSENT: "H", SICK: "K", LEAVE: "T", DAYOFF: "D" };
export const TABEL_MAX_HOURS = 24;

export type TabelParsed = { kind: "clear" } | { kind: "hours"; hours: number | null } | { kind: "status"; status: AttendanceStatus };

/** «8», «7,5», «4.5» — soat; «+» — to'liq kun; H/K/T/D (kirill Н/К/Т/Д ham) — holat; bo'sh, 0 yoki «-» — tozalash. */
export function parseTabelValue(raw: string): TabelParsed | { error: string } {
  const t = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (!t || t === "0" || t === "-") return { kind: "clear" };
  const lat = t.replace("Н", "H").replace("К", "K").replace("Т", "T").replace("Д", "D");
  if (TABEL_CODES[lat]) return { kind: "status", status: TABEL_CODES[lat] };
  if (t === "+") return { kind: "hours", hours: null };
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return { error: `«${raw}» — soat (masalan 8) yoki H/K/T/D yozing` };
  if (n > TABEL_MAX_HOURS) return { error: `«${raw}» — bir kunda ${TABEL_MAX_HOURS} soatdan ko'p bo'lmaydi` };
  return { kind: "hours", hours: Math.round(n * 100) / 100 };
}
