import { db } from "./db";
import type { Prisma } from "@/generated/prisma";

type Tx = Prisma.TransactionClient | typeof db;
type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "STATUS_CHANGE";

export function audit(
  tx: Tx,
  userId: string,
  action: AuditAction,
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

/** Bir amalda ko'p yozuv (Excel import): har yozuvga alohida AuditLog qatori, bitta so'rov bilan. */
export function auditMany(tx: Tx, userId: string, action: AuditAction, entity: string, items: { id: string; before?: unknown; after?: unknown }[]) {
  return tx.auditLog.createMany({
    data: items.map((x) => ({
      userId, action, entity, entityId: x.id,
      before: x.before === undefined ? undefined : JSON.parse(JSON.stringify(x.before)),
      after: x.after === undefined ? undefined : JSON.parse(JSON.stringify(x.after)),
    })),
  });
}
