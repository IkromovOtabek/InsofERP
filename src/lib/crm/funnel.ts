import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { lastResults } from "./clients";
import { addDaysIso, dbToIso, isoToDb } from "./dates";
import { orderPayments } from "./order-pay";

/**
 * Voronka va hisobotlar (CRM_SPEC 4.1, 5.5). Davr — `from`..`to` (Toshkent kunlari, ikkalasi ham kiradi), xodim — aloqa yozgan xodim
 * (zayavka bo'yicha bosqichlarda — mijozning mas'ul xodimi). Faqat CRM mijozlari (`crmAt`) — oddiy ERP zayavkalari voronkani to'ldirmaydi.
 *
 * Bosqichlar jamlanuvchi: mijoz davr ichidagi eng yuqori darajasiga qadar har bosqichda sanaladi.
 *   aloqaning natija bosqichi (natijasiz aloqa — 1), «Zayafka oldim» — 6,
 *   davr ichida bekor qilinmagan zayavkasi — 6, shu zayavka «Yetkazildi»/«Yopildi» — 7.
 */
export type Period = { from: string; to: string; userId?: string | null };

export type FunnelData = {
  stages: { n: number; ofFirst: number; ofPrev: number }[];
  levels: Map<string, number>;
  employees: EmployeeRow[];
  sources: { id: string | null; label: string; clients: number; orders: number; conv: number }[];
  refusals: { label: string; n: number }[];
  waiting: { month: string; n: number; ids: string[] }[];
  pay: { paidOrders: number; paidSum: number; orders: number };
  summary: { contacts: number; answered: number; noAnswer: number; offers: number; orders: number; expensive: number; refusals: number; waiting: number };
};

export type EmployeeRow = { userId: string; name: string; total: number; answered: number; noAnswer: number; offer: number; order: number; expensive: number; refusal: number;
  /** onlinePBX: davrdagi qo'ng'iroqlar soni va gaplashilgan vaqt (soniya) */
  calls: number; talkSec: number };

const blank = (userId: string): EmployeeRow => ({ userId, name: "", total: 0, answered: 0, noAnswer: 0, offer: 0, order: 0, expensive: 0, refusal: 0, calls: 0, talkSec: 0 });

/** Toshkent kuni → vaqt chegarasi (zayavka sanasi DateTime) */
const tzStart = (iso: string) => new Date(`${iso}T00:00:00+05:00`);

export async function funnel(p: Period): Promise<FunnelData> {
  const contactWhere: Prisma.CrmContactWhereInput = {
    cancelledAt: null,
    date: { gte: isoToDb(p.from), lte: isoToDb(p.to) },
    customer: { isInternal: false },
    ...(p.userId ? { userId: p.userId } : {}),
  };
  const [contacts, orders] = await Promise.all([
    db.crmContact.findMany({
      where: contactWhere,
      select: { customerId: true, userId: true, result: { select: { code: true, label: true, stage: true, group: true } } },
    }),
    db.order.findMany({
      where: {
        kind: "SALE", status: { not: "CANCELLED" },
        date: { gte: tzStart(p.from), lt: tzStart(addDaysIso(p.to, 1)) },
        customer: { crmAt: { not: null }, isInternal: false, ...(p.userId ? { ownerId: p.userId } : {}) },
      },
      select: { id: true, customerId: true, status: true },
    }),
  ]);

  // ── Har mijozning darajasi ──
  const levels = new Map<string, number>();
  const up = (id: string, n: number) => levels.set(id, Math.max(levels.get(id) ?? 0, n));
  for (const c of contacts) up(c.customerId, c.result?.stage ?? 1);
  for (const o of orders) up(o.customerId, o.status === "DELIVERED" || o.status === "CLOSED" ? 7 : 6);

  const counts = [1, 2, 3, 4, 5, 6, 7].map((k) => [...levels.values()].filter((v) => v >= k).length);
  const stages = counts.map((n, i) => ({ n, ofFirst: counts[0] ? (n / counts[0]) * 100 : 0, ofPrev: i === 0 ? 100 : counts[i - 1] ? (n / counts[i - 1]) * 100 : 0 }));

  // ── Xodimlar ──
  const emp = new Map<string, EmployeeRow>();
  for (const c of contacts) {
    const e = emp.get(c.userId) ?? blank(c.userId);
    e.total++;
    const r = c.result;
    if (r && r.stage >= 2) e.answered++;
    if (r?.group === "NO_ANSWER") e.noAnswer++;
    if (r?.code === "offer_sent") e.offer++;
    if (r?.group === "WIN") e.order++;
    if (r?.code === "expensive") e.expensive++;
    if (r?.group === "REFUSAL" || r?.group === "LOSS") e.refusal++;
    emp.set(c.userId, e);
  }
  // onlinePBX qo'ng'iroqlari (chiquvchi + kiruvchi, ichkisiz)
  const calls = await db.crmCall.groupBy({
    by: ["userId"],
    where: { userId: p.userId ? p.userId : { not: null }, direction: { in: ["OUT", "IN", "MISSED"] }, startedAt: { gte: tzStart(p.from), lt: tzStart(addDaysIso(p.to, 1)) } },
    _count: { _all: true }, _sum: { talkSec: true },
  });
  for (const k of calls) {
    if (!k.userId) continue;
    const e = emp.get(k.userId) ?? blank(k.userId);
    e.calls = k._count._all;
    e.talkSec = k._sum.talkSec ?? 0;
    emp.set(k.userId, e);
  }
  const users = await db.user.findMany({ where: { id: { in: [...emp.keys()] } }, select: { id: true, fullName: true } });
  const employees = [...emp.values()].map((e) => ({ ...e, name: users.find((u) => u.id === e.userId)?.fullName ?? "—" })).sort((a, b) => b.total - a.total);

  // ── Manbalar: voronkadagi mijozlar manbasi bo'yicha ──
  const custs = await db.customer.findMany({ where: { id: { in: [...levels.keys()] } }, select: { id: true, sourceId: true, source: { select: { label: true } } } });
  const src = new Map<string, { id: string | null; label: string; clients: number; orders: number; conv: number }>();
  for (const c of custs) {
    const k = c.sourceId ?? "";
    const row = src.get(k) ?? { id: c.sourceId, label: c.source?.label ?? "Manbasiz", clients: 0, orders: 0, conv: 0 };
    row.clients++;
    if ((levels.get(c.id) ?? 0) >= 6) row.orders++;
    src.set(k, row);
  }
  const sources = [...src.values()].map((r) => ({ ...r, conv: r.clients ? (r.orders / r.clients) * 100 : 0 })).sort((a, b) => b.orders - a.orders || b.clients - a.clients);

  // ── Otkaz sabablari (davr ichidagi aloqalar) ──
  const ref = new Map<string, number>();
  for (const c of contacts) if (c.result && (c.result.group === "REFUSAL" || c.result.group === "LOSS")) ref.set(c.result.label, (ref.get(c.result.label) ?? 0) + 1);
  const refusals = [...ref.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);

  // ── Kutilayotgan: oxirgi aloqasi «Keyinroq kerak» (davrdan qat'iy nazar), keyingi aloqa oyi bo'yicha ──
  const last = await lastResults();
  const waitIds = [...last.values()].filter((r) => r.group === "WAITING").map((r) => r.customerId);
  const waitCust = waitIds.length ? await db.customer.findMany({
    where: { id: { in: waitIds }, isInternal: false, ...(p.userId ? { ownerId: p.userId } : {}) },
    select: { id: true, nextContactAt: true },
  }) : [];
  const wm = new Map<string, string[]>();
  for (const c of waitCust) { const m = c.nextContactAt ? dbToIso(c.nextContactAt).slice(0, 7) : ""; wm.set(m, [...(wm.get(m) ?? []), c.id]); }
  const waiting = [...wm.entries()].sort(([a], [b]) => (a || "9999").localeCompare(b || "9999")).map(([month, ids]) => ({ month, n: ids.length, ids }));

  // ── To'lov: davr ichidagi zayavkalar ──
  const pays = await orderPayments([...new Set(orders.map((o) => o.customerId))]);
  let paidOrders = 0, paidSum = 0;
  for (const o of orders) { const x = pays.get(o.id); if (!x) continue; paidSum += x.paid; if (x.status === "PAID") paidOrders++; }

  const tot = (k: keyof EmployeeRow) => employees.reduce((a, e) => a + (e[k] as number), 0);
  return {
    stages, levels, employees, sources, refusals, waiting,
    pay: { paidOrders, paidSum, orders: orders.length },
    summary: {
      contacts: contacts.length, answered: tot("answered"), noAnswer: tot("noAnswer"), offers: tot("offer"), orders: tot("order"),
      expensive: tot("expensive"), refusals: tot("refusal"), waiting: waitCust.length,
    },
  };
}
