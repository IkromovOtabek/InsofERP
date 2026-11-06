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

export type LastEdit = { by: string; at: Date };

/**
 * Har yozuvning oxirgi tahriri (AuditLog UPDATE) — kim va qachon. Ro'yxatlardagi «Tahrirlangan» belgisi uchun,
 * butun ro'yxatga bitta so'rov. Alohida ustun yo'q: tahrir allaqachon audit jurnaliga yoziladi.
 */
export async function lastEdits(entity: string, ids: string[]): Promise<Map<string, LastEdit>> {
  if (!ids.length) return new Map();
  const rows = await db.auditLog.findMany({
    where: { entity, action: "UPDATE", entityId: { in: [...new Set(ids)] } },
    orderBy: { createdAt: "desc" },
    distinct: ["entityId"],
    select: { entityId: true, createdAt: true, user: { select: { fullName: true } } },
  });
  return new Map(rows.map((r) => [r.entityId, { by: r.user.fullName, at: r.createdAt }]));
}
