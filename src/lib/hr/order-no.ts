import type { HrDocKind, Prisma } from "@/generated/prisma";
import { ORDER_KINDS, nextOrderNo } from "@/lib/hr-docs";

/**
 * Buyruq raqamlari (ishga qabul va bo'shatish buyruqlari bitta ketma-ketlikda): yil ichida takrorlanmaydi.
 * Raqam berish bitta qulf ostida — ikki kadr bir vaqtda bir xil raqam bera olmaydi.
 */

const yearRange = (docDate: Date) => {
  const y = docDate.getUTCFullYear();
  return { y, gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) }; // @db.Date — UTC yarim tun
};

const kindsOf = (kind: HrDocKind) => (ORDER_KINDS.includes(kind) ? ORDER_KINDS : [kind]);

const lock = (tx: Prisma.TransactionClient, kind: HrDocKind) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"hrdoc-no:" + (ORDER_KINDS.includes(kind) ? "BUYRUQ" : kind)}))`;

/** Raqam band bo'lsa — xato matni, aks holda null. */
export async function orderNoProblem(tx: Prisma.TransactionClient, kind: HrDocKind, no: string | null, docDate: Date, selfId?: string): Promise<string | null> {
  if (!no) return null;
  await lock(tx, kind);
  const { y, gte, lt } = yearRange(docDate);
  const clash = await tx.hrDocument.findFirst({
    where: {
      kind: { in: kindsOf(kind) }, no: { equals: no.trim(), mode: "insensitive" },
      docDate: { gte, lt },
      ...(selfId ? { id: { not: selfId } } : {}),
    },
    select: { employee: { select: { fullName: true } } },
  });
  return clash ? `№ ${no} raqamli buyruq ${y}-yilda allaqachon bor (${clash.employee.fullName}) — boshqa raqam bering` : null;
}

/** Shu yildagi keyingi bo'sh buyruq raqami (qulf ostida). */
export async function allocateOrderNo(tx: Prisma.TransactionClient, docDate: Date): Promise<string> {
  await lock(tx, "BUYRUQ");
  const { gte, lt } = yearRange(docDate);
  const used = await tx.hrDocument.findMany({ where: { kind: { in: ORDER_KINDS }, docDate: { gte, lt } }, select: { no: true } });
  return nextOrderNo(used.map((x) => x.no));
}
