import type { Prisma } from "@/generated/prisma";
import { db } from "./db";

type Tx = Prisma.TransactionClient | typeof db;
type Table = "order" | "productionBatch" | "trip" | "goodsReceipt" | "invoice" | "brigadeTask" | "contract" | "supplyRequest" | "cashTransfer";

/** Joriy yil zavod vaqti bo'yicha (server UTC da bo'lsa ham 1-yanvar 00:00–05:00 o'tgan yilga tushmasin). */
function tashkentYear() {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Tashkent", year: "numeric" }).format(new Date()));
}

/** Shu yil, shu prefiks bilan eng katta mavjud raqam ("Z-2026-00042" → "Z-2026-00042"). */
async function lastNo(tx: Tx, table: Table, head: string): Promise<string | null> {
  const where = { startsWith: head };
  const desc = "desc" as const;
  switch (table) {
    case "order": return (await tx.order.findFirst({ where: { orderNo: where }, orderBy: { orderNo: desc }, select: { orderNo: true } }))?.orderNo ?? null;
    case "productionBatch": return (await tx.productionBatch.findFirst({ where: { batchNo: where }, orderBy: { batchNo: desc }, select: { batchNo: true } }))?.batchNo ?? null;
    case "trip": return (await tx.trip.findFirst({ where: { deliveryNoteNo: where }, orderBy: { deliveryNoteNo: desc }, select: { deliveryNoteNo: true } }))?.deliveryNoteNo ?? null;
    case "goodsReceipt": return (await tx.goodsReceipt.findFirst({ where: { docNo: where }, orderBy: { docNo: desc }, select: { docNo: true } }))?.docNo ?? null;
    case "invoice": return (await tx.invoice.findFirst({ where: { invoiceNo: where }, orderBy: { invoiceNo: desc }, select: { invoiceNo: true } }))?.invoiceNo ?? null;
    case "brigadeTask": return (await tx.brigadeTask.findFirst({ where: { taskNo: where }, orderBy: { taskNo: desc }, select: { taskNo: true } }))?.taskNo ?? null;
    case "supplyRequest": return (await tx.supplyRequest.findFirst({ where: { docNo: where }, orderBy: { docNo: desc }, select: { docNo: true } }))?.docNo ?? null;
    case "cashTransfer": return (await tx.cashTransfer.findFirst({ where: { docNo: where }, orderBy: { docNo: desc }, select: { docNo: true } }))?.docNo ?? null;
    case "contract": return (await tx.order.findFirst({ where: { contractNo: where }, orderBy: { contractNo: desc }, select: { contractNo: true } }))?.contractNo ?? null;
  }
}

/**
 * Hujjat raqami: PREFIX-YYYY-00001. Yil bo'yicha sanaladi.
 *
 * Ilgari "yil boshidan nechta yozuv bor + 1" edi: bir vaqtda ikki hujjat bir xil raqam olib,
 * biri unique xatosi bilan yiqilardi, o'chirilgan yozuvdan keyin esa mavjud raqam takrorlanardi.
 * Endi: tranzaksiya ichida jadval bo'yicha qulf va eng katta mavjud raqamdan keyingisi.
 * Qulf tranzaksiya tugaguncha turadi — shuning uchun `tx` tranzaksiya bo'lishi kerak.
 */
export async function nextNo(tx: Tx, table: Table, prefix: string) {
  const year = tashkentYear();
  const head = `${prefix}-${year}-`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"docno:" + head}))`;
  const last = await lastNo(tx, table, head);
  const n = last ? Number(last.slice(head.length)) || 0 : 0;
  return `${head}${String(n + 1).padStart(5, "0")}`;
}
