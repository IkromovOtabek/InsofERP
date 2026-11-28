import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { addDaysIso, tzHour } from "./dates";

/**
 * Call-markaz (`/crm/callcenter`): o'tkazib yuborilgan qo'ng'iroqlar navbati, qo'ng'iroqlar jurnali va operatorlar statistikasi.
 * Manba — `CrmCall` (onlinePBX tarixi + webhook). Navbatdan chiqish: shu raqam bilan keyin gaplashilsa (`lib/pbx/sync.ts`) yoki
 * operator «Hal qilindi» bossa. Ichki (INTERNAL) qo'ng'iroqlar hisobga olinmaydi.
 */

/** Toshkent kuni → vaqt chegarasi */
const tzStart = (iso: string) => new Date(`${iso}T00:00:00+05:00`);
export const QUEUE_DAYS = 7;

export type QueueRow = {
  /** Shu raqamdan eng so'nggi o'tkazib yuborilgan qo'ng'iroq */
  id: string; phone: string | null; lastAt: Date; firstAt: Date; count: number; ids: string[];
  customer: { id: string; name: string; owner: string | null } | null;
  takenBy: { id: string; name: string } | null; takenAt: Date | null;
};

/** O'tkazib yuborilgan, hali hal qilinmagan qo'ng'iroqlar — raqam bo'yicha jamlab, eng uzoq kutgani tepada */
export async function callQueue(): Promise<QueueRow[]> {
  const rows = await db.crmCall.findMany({
    where: { direction: "MISSED", handledAt: null, state: "ENDED", startedAt: { gte: new Date(Date.now() - QUEUE_DAYS * 86_400_000) } },
    orderBy: { startedAt: "asc" }, take: 500,
    select: {
      id: true, phone: true, startedAt: true, takenAt: true,
      takenBy: { select: { id: true, fullName: true } },
      customer: { select: { id: true, name: true, owner: { select: { fullName: true } } } },
    },
  });
  const by = new Map<string, QueueRow>();
  for (const r of rows) {
    const key = r.phone ?? `id:${r.id}`;
    const q = by.get(key);
    const cust = r.customer ? { id: r.customer.id, name: r.customer.name, owner: r.customer.owner?.fullName ?? null } : null;
    if (!q) {
      by.set(key, { id: r.id, phone: r.phone, lastAt: r.startedAt, firstAt: r.startedAt, count: 1, ids: [r.id], customer: cust,
        takenBy: r.takenBy ? { id: r.takenBy.id, name: r.takenBy.fullName } : null, takenAt: r.takenAt });
    } else {
      q.count++; q.ids.push(r.id); q.lastAt = r.startedAt; q.id = r.id;
      q.customer ??= cust;
      if (r.takenBy) { q.takenBy = { id: r.takenBy.id, name: r.takenBy.fullName }; q.takenAt = r.takenAt; }
    }
  }
  return [...by.values()].sort((a, b) => a.firstAt.getTime() - b.firstAt.getTime());
}

export type JournalFilter = { from: string; to: string; dir?: string; userId?: string | null; onlyMissed?: boolean; q?: string };
export const JOURNAL_LIMIT = 300;

export async function callJournal(f: JournalFilter) {
  const digits = (f.q ?? "").replace(/[^\d]/g, "");
  const where: Prisma.CrmCallWhereInput = {
    direction: f.onlyMissed ? "MISSED" : f.dir && ["IN", "OUT", "MISSED"].includes(f.dir) ? f.dir : { in: ["IN", "OUT", "MISSED"] },
    startedAt: { gte: tzStart(f.from), lt: tzStart(addDaysIso(f.to, 1)) },
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.q?.trim() ? { OR: [
      ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-9) } }] : []),
      { customer: { name: { contains: f.q.trim(), mode: "insensitive" as const } } },
    ] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.crmCall.findMany({
      where, orderBy: { startedAt: "desc" }, take: JOURNAL_LIMIT,
      select: {
        id: true, uuid: true, direction: true, state: true, phone: true, ext: true, startedAt: true, durationSec: true, talkSec: true,
        handledAt: true, contactId: true,
        user: { select: { fullName: true } }, handledBy: { select: { fullName: true } },
        customer: { select: { id: true, name: true } },
      },
    }),
    db.crmCall.count({ where }),
  ]);
  return { rows, total };
}

export type OperatorStat = { userId: string; name: string; out: number; outAnswered: number; inAnswered: number; talkSec: number; callbacks: number; avgCallbackMin: number | null };

export type CallStats = {
  total: number; inbound: number; inAnswered: number; missed: number; missedOpen: number; outbound: number; outAnswered: number;
  talkSec: number; avgTalkSec: number; avgCallbackMin: number | null;
  operators: OperatorStat[];
  hours: { hour: number; in: number; out: number; missed: number }[];
};

/** Davr statistikasi (menejer): umumiy ko'rsatkichlar, operatorlar kesimi, soatlar bo'yicha yuklama */
export async function callStats(from: string, to: string, userId?: string | null): Promise<CallStats> {
  const rows = await db.crmCall.findMany({
    where: {
      direction: { in: ["IN", "OUT", "MISSED"] }, state: "ENDED",
      startedAt: { gte: tzStart(from), lt: tzStart(addDaysIso(to, 1)) },
      ...(userId ? { OR: [{ userId }, { handledById: userId }] } : {}),
    },
    select: { direction: true, talkSec: true, startedAt: true, userId: true, handledAt: true, handledById: true },
  });
  const ops = new Map<string, OperatorStat & { cbSum: number }>();
  const op = (id: string) => {
    let o = ops.get(id);
    if (!o) { o = { userId: id, name: "", out: 0, outAnswered: 0, inAnswered: 0, talkSec: 0, callbacks: 0, avgCallbackMin: null, cbSum: 0 }; ops.set(id, o); }
    return o;
  };
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, in: 0, out: 0, missed: 0 }));
  let inbound = 0, inAnswered = 0, missed = 0, missedOpen = 0, outbound = 0, outAnswered = 0, talk = 0, talked = 0, cbN = 0, cbSum = 0;
  for (const r of rows) {
    const h = hours[tzHour(r.startedAt)];
    if (r.direction === "OUT") {
      outbound++; h.out++;
      if (r.talkSec > 0) outAnswered++;
      if (r.userId) { const o = op(r.userId); o.out++; if (r.talkSec > 0) o.outAnswered++; o.talkSec += r.talkSec; }
    } else {
      inbound++; h.in++;
      if (r.direction === "IN") { inAnswered++; if (r.userId) { const o = op(r.userId); o.inAnswered++; o.talkSec += r.talkSec; } }
      else {
        missed++; h.missed++;
        if (!r.handledAt) missedOpen++;
        else {
          const min = Math.max(0, (r.handledAt.getTime() - r.startedAt.getTime()) / 60_000);
          cbN++; cbSum += min;
          if (r.handledById) { const o = op(r.handledById); o.callbacks++; o.cbSum += min; }
        }
      }
    }
    if (r.talkSec > 0) { talk += r.talkSec; talked++; }
  }
  const users = await db.user.findMany({ where: { id: { in: [...ops.keys()] } }, select: { id: true, fullName: true } });
  const operators = [...ops.values()].map(({ cbSum: s, ...o }) => ({
    ...o, name: users.find((u) => u.id === o.userId)?.fullName ?? "—", avgCallbackMin: o.callbacks ? s / o.callbacks : null,
  })).sort((a, b) => b.out + b.inAnswered - (a.out + a.inAnswered));
  return {
    total: rows.length, inbound, inAnswered, missed, missedOpen, outbound, outAnswered,
    talkSec: talk, avgTalkSec: talked ? talk / talked : 0, avgCallbackMin: cbN ? cbSum / cbN : null,
    operators, hours,
  };
}
