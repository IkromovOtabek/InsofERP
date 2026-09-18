import { db } from "./db";
import type { Prisma } from "@/generated/prisma";

type Tx = Prisma.TransactionClient | typeof db;

export function audit(
  tx: Tx,
  userId: string,
  action: "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE",
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  return tx.auditLog.create({
    data: {
      userId, action, entity, entityId,
      before: before === undefined ? undefined : JSON.parse(JSON.stringify(before)),
      after: after === undefined ? undefined : JSON.parse(JSON.stringify(after)),
    },
  });
}
