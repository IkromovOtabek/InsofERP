import type { CrmClientStatus, Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { addDaysIso, dbToIso, isoToDb, todayIso } from "./dates";

/**
 * «Bugun» ekrani (CRM_SPEC 5.1): keyingi aloqa sanasi ≤ bugun, holati «Yo'qotilgan» emas; eng eski muddat tepada.
 * Qo'shimcha (amoCRM vazifalari kabi): Ertaga va keyingi 7 kun — oldindan ko'rish uchun.
 */
export type TodayBucket = "overdue" | "today" | "tomorrow" | "later";

export type TodayRow = {
  id: string; name: string; phone: string | null; owner: string | null; status: CrmClientStatus;
  next: string; bucket: TodayBucket; lastLabel: string | null; lastNote: string | null;
};

export async function todayList(p: { ownerId?: string | null }): Promise<{ today: string; rows: TodayRow[]; counts: Record<TodayBucket, number> }> {
  const today = todayIso();
  const tomorrow = addDaysIso(today, 1);
  const horizon = addDaysIso(today, 7);
  const where: Prisma.CustomerWhereInput = {
    isInternal: false, isActive: true, crmAt: { not: null },
    nextContactAt: { not: null, lte: isoToDb(horizon) },
    OR: [{ crmStatus: null }, { crmStatus: { not: "LOST" } }],
    ...(p.ownerId ? { ownerId: p.ownerId } : {}),
  };
  const list = await db.customer.findMany({
    where,
    orderBy: [{ nextContactAt: "asc" }, { name: "asc" }],
    take: 500,
    select: { id: true, name: true, phone: true, crmStatus: true, nextContactAt: true, owner: { select: { fullName: true } } },
  });

  const ids = list.map((c) => c.id);
  const last = ids.length
    ? await db.crmContact.findMany({
      where: { customerId: { in: ids }, cancelledAt: null },
      orderBy: [{ customerId: "asc" }, { date: "desc" }, { createdAt: "desc" }],
      distinct: ["customerId"],
      select: { customerId: true, note: true, result: { select: { label: true } } },
    })
    : [];
  const lastBy = new Map(last.map((l) => [l.customerId, l]));

  const counts: Record<TodayBucket, number> = { overdue: 0, today: 0, tomorrow: 0, later: 0 };
  const rows = list.map((c) => {
    const next = dbToIso(c.nextContactAt!);
    const bucket: TodayBucket = next < today ? "overdue" : next === today ? "today" : next === tomorrow ? "tomorrow" : "later";
    counts[bucket]++;
    const l = lastBy.get(c.id);
    return {
      id: c.id, name: c.name, phone: c.phone, owner: c.owner?.fullName ?? null, status: c.crmStatus ?? "NEW",
      next, bucket, lastLabel: l?.result?.label ?? null, lastNote: l?.note ?? null,
    };
  });
  return { today, rows, counts };
}
