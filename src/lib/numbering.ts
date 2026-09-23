import type { Prisma } from "@/generated/prisma";
import { db } from "./db";

type Tx = Prisma.TransactionClient | typeof db;

/** Hujjat raqami: PREFIX-YYYY-00001. Yil bo'yicha sanaladi. */
export async function nextNo(tx: Tx, table: "order" | "productionBatch" | "trip" | "goodsReceipt" | "invoice" | "brigadeTask" | "contract" | "supplyRequest", prefix: string) {
  const year = new Date().getFullYear();
  const start = new Date(year, 0, 1);
  let n = 0;
  switch (table) {
    case "order": n = await tx.order.count({ where: { createdAt: { gte: start } } }); break;
    case "productionBatch": n = await tx.productionBatch.count({ where: { createdAt: { gte: start } } }); break;
    case "trip": n = await tx.trip.count({ where: { createdAt: { gte: start } } }); break;
    case "goodsReceipt": n = await tx.goodsReceipt.count({ where: { createdAt: { gte: start } } }); break;
    case "invoice": n = await tx.invoice.count({ where: { createdAt: { gte: start } } }); break;
    case "brigadeTask": n = await tx.brigadeTask.count({ where: { createdAt: { gte: start } } }); break;
    case "supplyRequest": n = await tx.supplyRequest.count({ where: { createdAt: { gte: start } } }); break;
    case "contract": n = await tx.order.count({ where: { contractNo: { not: null }, contractAt: { gte: start } } }); break;
  }
  return `${prefix}-${year}-${String(n + 1).padStart(5, "0")}`;
}
