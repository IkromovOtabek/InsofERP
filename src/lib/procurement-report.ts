import type { SupplyIncidentKind } from "@/generated/prisma";
import { db } from "./db";
import { totalFact } from "./supply";

/**
 * Snabjeniye hisoboti (TZ 4.13): xaridlar, sarf, yetkazib berish, kechikish va yetkazib beruvchilar — davr bo'yicha.
 * Kechikish: qabul sanasi "kerak sana" (yoki ETA) dan keyin bo'lgan xaridlar.
 */

const DAY = 86400000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const parse = (s?: string) => { if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : startOfDay(d); };

export async function procurementReport(p: { from?: string; to?: string }) {
  const now = new Date();
  const from = parse(p.from) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const toIncl = parse(p.to) ?? startOfDay(now);
  const to = new Date(toIncl.getTime() + DAY);

  const [created, received, receiptItems, consumed, incidents, rejected] = await Promise.all([
    db.supplyRequest.findMany({ where: { date: { gte: from, lt: to } }, select: { id: true, status: true, department: true, priority: true } }),
    db.supplyRequest.findMany({
      where: { status: "RECEIVED", receipt: { date: { gte: from, lt: to } } },
      include: { items: true, supplier: { select: { id: true, name: true } }, receipt: { select: { date: true } } },
    }),
    db.goodsReceiptItem.findMany({
      where: { receipt: { cancelledAt: null, date: { gte: from, lt: to } } },
      select: { qty: true, price: true, material: { select: { id: true, name: true, unit: true } }, receipt: { select: { supplier: { select: { id: true, name: true } } } } },
    }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "PRODUCTION_CONSUME", date: { gte: from, lt: to }, materialId: { not: null } }, _sum: { qty: true } }),
    db.supplyIncident.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { kind: true, resolvedAt: true, request: { select: { supplierId: true } } } }),
    db.supplyRequest.count({ where: { status: "REJECTED", updatedAt: { gte: from, lt: to } } }),
  ]);

  /* ── Yetkazib berish muddati va kechikish ── */
  const lead = received.map((r) => {
    const got = r.receipt!.date;
    const due = r.eta ?? r.needBy;
    return { r, days: (got.getTime() - r.date.getTime()) / DAY, late: due ? Math.max(0, Math.round((startOfDay(got).getTime() - startOfDay(due).getTime()) / DAY)) : 0 };
  });
  const avgLead = lead.length ? lead.reduce((s, x) => s + x.days, 0) / lead.length : null;
  const lateCount = lead.filter((x) => x.late > 0).length;

  /* ── Yetkazib beruvchilar ── */
  const sup = new Map<string, { id: string; name: string; sum: number; receipts: number; orders: number; leadSum: number; late: number; incidents: number }>();
  const S = (id: string, name: string) => { const c = sup.get(id) ?? { id, name, sum: 0, receipts: 0, orders: 0, leadSum: 0, late: 0, incidents: 0 }; sup.set(id, c); return c; };
  for (const i of receiptItems) { const c = S(i.receipt.supplier.id, i.receipt.supplier.name); c.sum += Number(i.qty) * Number(i.price); }
  for (const x of lead) {
    if (!x.r.supplier) continue;
    const c = S(x.r.supplier.id, x.r.supplier.name);
    c.orders += 1; c.leadSum += x.days; if (x.late > 0) c.late += 1;
  }
  const receiptSupplierDocs = await db.goodsReceipt.groupBy({ by: ["supplierId"], where: { cancelledAt: null, date: { gte: from, lt: to } }, _count: { _all: true } });
  for (const g of receiptSupplierDocs) { const c = sup.get(g.supplierId); if (c) c.receipts = g._count._all; }
  for (const inc of incidents) { const id = inc.request.supplierId; if (id && sup.has(id)) sup.get(id)!.incidents += 1; }
  const suppliers = [...sup.values()].map((c) => ({ ...c, avgLead: c.orders ? c.leadSum / c.orders : null })).sort((a, b) => b.sum - a.sum);

  /* ── Materiallar: xarid va sarf ── */
  const mat = new Map<string, { id: string; name: string; unit: string; qty: number; sum: number; used: number }>();
  for (const i of receiptItems) {
    const c = mat.get(i.material.id) ?? { id: i.material.id, name: i.material.name, unit: i.material.unit, qty: 0, sum: 0, used: 0 };
    c.qty += Number(i.qty); c.sum += Number(i.qty) * Number(i.price);
    mat.set(i.material.id, c);
  }
  const usedIds = consumed.map((x) => x.materialId!).filter((id) => !mat.has(id));
  const extra = usedIds.length ? await db.material.findMany({ where: { id: { in: usedIds } }, select: { id: true, name: true, unit: true } }) : [];
  for (const m of extra) mat.set(m.id, { id: m.id, name: m.name, unit: m.unit, qty: 0, sum: 0, used: 0 });
  for (const x of consumed) { const c = mat.get(x.materialId!); if (c) c.used = -Number(x._sum.qty ?? 0); }
  const materials = [...mat.values()].map((m) => ({ ...m, avgPrice: m.qty ? m.sum / m.qty : null })).sort((a, b) => b.sum - a.sum || b.used - a.used);

  /* ── Bo'limlar va muammolar ── */
  const dept = new Map<string, { name: string; count: number; done: number; critical: number }>();
  for (const r of created) {
    const k = r.department ?? "Ko'rsatilmagan";
    const c = dept.get(k) ?? { name: k, count: 0, done: 0, critical: 0 };
    c.count += 1; if (r.status === "RECEIVED") c.done += 1; if (r.priority === "CRITICAL") c.critical += 1;
    dept.set(k, c);
  }
  const incidentsByKind = new Map<SupplyIncidentKind, { total: number; open: number }>();
  for (const i of incidents) {
    const c = incidentsByKind.get(i.kind) ?? { total: 0, open: 0 };
    c.total += 1; if (!i.resolvedAt) c.open += 1;
    incidentsByKind.set(i.kind, c);
  }

  return {
    from, to: toIncl,
    totals: {
      purchase: receiptItems.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0),
      receivedFact: received.reduce((s, r) => s + totalFact(r), 0),
      requests: created.length, done: received.length, rejected,
      avgLead, lateCount, incidents: incidents.length,
    },
    suppliers, materials,
    departments: [...dept.values()].sort((a, b) => b.count - a.count),
    incidents: [...incidentsByKind.entries()].map(([kind, v]) => ({ kind, ...v })),
    late: lead.filter((x) => x.late > 0).sort((a, b) => b.late - a.late).slice(0, 15).map((x) => ({ id: x.r.id, docNo: x.r.docNo, supplier: x.r.supplier?.name ?? "—", late: x.late, days: x.days })),
  };
}
