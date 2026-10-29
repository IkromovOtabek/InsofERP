import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtNum, date, dateTime } from "@/lib/format";
import { MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";
import { acceptShipment, getShipment, listShipments, pendingShipments, rejectShipmentItems, shipmentRights, SHIPMENT_STATUS_LABEL } from "@/lib/shipments";
import type { MobileUser } from "./auth";
import { ListError } from "./list";

/**
 * Ilova: snabjeniye jo'natmalari (`lib/shipments.ts`).
 *   GET  /api/mobile/shipments          — banner va ro'yxat: { canAccept, pending, rows }
 *   GET  /api/mobile/shipments?id=…     — jo'natma qatorlari (qabul ekrani)
 *   POST /api/mobile/shipments          — { id, action: "accept", lines: [{itemId, qty}] } | { id, action: "reject", itemIds, reason }
 * Ruxsat veb bilan bir xil: `stock.shipment_accept` (sklad), ro'yxatni snabjenets ham ko'radi (faqat o'zinikini).
 */

const who = (u: MobileUser) => ({ userId: u.id, role: u.role });
const canAccept = (u: MobileUser) => canDo(u, "stock", "shipment_accept");
const canSee = (u: MobileUser) => canAccept(u) || canDo(u, "stock", "shipment") || u.role === "WAREHOUSE" || u.role === "PROCUREMENT";

export async function mobileShipments(u: MobileUser) {
  if (!canSee(u)) throw new ListError("FORBIDDEN", "Bu bo'lim sizga yopiq", 403);
  const accept = canAccept(u) && u.role !== "DIRECTOR";
  const [pend, rows] = await Promise.all([
    accept ? pendingShipments(10) : Promise.resolve({ count: 0, rows: [] }),
    listShipments(u.role === "PROCUREMENT" ? "all" : "open", who(u), { take: 50 }),
  ]);
  return {
    canAccept: accept,
    pending: pend.count,
    rows: rows.map((r) => ({
      id: r.id, docNo: r.docNo, date: date(r.date), supplier: r.supplier, by: r.by, lines: r.lines, pendingLines: r.pending,
      total: `${fmtNum(r.total)} so'm`, status: r.status, statusLabel: SHIPMENT_STATUS_LABEL[r.status],
    })),
  };
}

export async function mobileShipment(u: MobileUser, id: string) {
  if (!canSee(u)) throw new ListError("FORBIDDEN", "Bu bo'lim sizga yopiq", 403);
  const sh = await getShipment(id);
  const own = sh?.createdById === u.id;
  if (!sh || (u.role === "PROCUREMENT" && !own) || (sh.status === "DRAFT" && !own && u.role !== "DIRECTOR")) throw new ListError("NOT_FOUND", "Jo'natma topilmadi", 404);
  const can = shipmentRights(sh, who(u), { send: false, accept: canAccept(u) });
  return {
    id: sh.id, docNo: sh.docNo, status: sh.status, statusLabel: SHIPMENT_STATUS_LABEL[sh.status], canAccept: can.accept,
    date: date(sh.date), supplier: sh.supplier.name, warehouse: sh.warehouse.name, by: sh.createdBy.fullName,
    waybillNo: sh.waybillNo, carrier: sh.carrier, note: sh.status === "CANCELLED" ? null : sh.note, sentAt: sh.sentAt ? dateTime(sh.sentAt) : null,
    total: `${fmtNum(sh.items.reduce((a, i) => a + Number(i.qty) * Number(i.price), 0))} so'm`,
    items: sh.items.map((i) => ({
      id: i.id, name: i.material?.name ?? i.name, isNew: !i.materialId, category: MATERIAL_CATEGORY_LABEL[i.category], unit: i.unit,
      qty: Number(i.qty), price: Number(i.price), status: i.status, acceptedQty: i.acceptedQty == null ? null : Number(i.acceptedQty),
      rejectReason: i.rejectReason, receiptNo: i.receipt?.docNo ?? null, decidedBy: i.decidedBy?.fullName ?? null,
    })),
  };
}

export async function mobileShipmentAction(u: MobileUser, body: unknown) {
  if (!canAccept(u)) throw new ListError("FORBIDDEN", "Jo'natmani qabul qilishga ruxsatingiz yo'q", 403);
  const b = (body ?? {}) as { id?: unknown; action?: unknown; lines?: unknown; itemIds?: unknown; reason?: unknown };
  const id = typeof b.id === "string" ? b.id : "";
  const exists = id ? await db.supplyShipment.findUnique({ where: { id }, select: { id: true } }) : null;
  if (!exists) throw new ListError("NOT_FOUND", "Jo'natma topilmadi", 404);
  try {
    if (b.action === "accept") {
      const lines = Array.isArray(b.lines)
        ? b.lines.map((l) => ({ itemId: String((l as { itemId?: unknown })?.itemId ?? ""), qty: Number((l as { qty?: unknown })?.qty) }))
        : [];
      const r = await acceptShipment(id, lines, who(u));
      return { ok: true, message: `${r.count} qator qabul qilindi — skladga kirim ${r.receiptNo}` };
    }
    if (b.action === "reject") {
      const ids = Array.isArray(b.itemIds) ? b.itemIds.filter((x): x is string => typeof x === "string") : [];
      await rejectShipmentItems(id, ids, typeof b.reason === "string" ? b.reason : "", who(u));
      return { ok: true, message: "Rad etildi — snabjenetsga xabar ketdi" };
    }
  } catch (e) {
    // Biznes qoidasi xatolari (allaqachon qabul qilingan, miqdor noto'g'ri) — foydalanuvchiga matni bilan
    if (e instanceof Error && !(e instanceof ListError)) throw new ListError("BAD_REQUEST", e.message, 400);
    throw e;
  }
  throw new ListError("BAD_REQUEST", "Amal noto'g'ri", 400);
}
