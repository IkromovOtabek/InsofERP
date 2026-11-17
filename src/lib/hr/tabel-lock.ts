import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";

/** Oy tabeli yopiqmi — yakuniy vedomost direktorga yuborilgan / tasdiqlangan / to'langan. */
export async function tabelLock(month: string, tx: Prisma.TransactionClient | typeof db = db): Promise<string | null> {
  const run = await tx.payrollRun.findFirst({ where: { month, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { docNo: true, status: true } });
  if (!run) return null;
  return `${run.docNo} ${run.status === "SUBMITTED" ? "direktor tasdig'ida" : "tasdiqlangan"} — tabel yopiq. O'zgartirish uchun vedomost qoralamaga qaytarilsin`;
}
