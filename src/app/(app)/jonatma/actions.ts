"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { acceptShipment, cancelShipment, rejectShipmentItems, saveShipment, sendShipment, type ShipmentLineInput } from "@/lib/shipments";

const schema = z.object({
  id: zOpt,
  supplierId: zStr("Yetkazuvchi tanlanmagan"),
  warehouseId: zStr("Sklad tanlanmagan"),
  date: zStr("Sana kerak"),
  waybillNo: zOpt,
  payment: zOpt,
  carrier: zOpt,
  note: zOpt,
  items: zStr("Kamida bitta qator kerak"),
  intent: z.enum(["draft", "send"]).default("send"),
});

/** Qatorlar formada JSON bo'lib keladi (yangi mahsulotda nom/birlik/kategoriya, mavjudida faqat id). */
function parseLines(raw: string): ShipmentLineInput[] | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return null;
    return v.slice(0, 200).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
      return {
        materialId: str("materialId") || null, name: str("name"), unit: str("unit"), category: str("category"),
        qty: Number(String(o.qty ?? "").replace(/\s+/g, "").replace(",", ".")), price: Number(String(o.price ?? "").replace(/\s+/g, "").replace(",", ".")),
      };
    });
  } catch {
    return null;
  }
}

function refresh() {
  revalidatePath("/jonatma"); revalidatePath("/snabjeniye"); revalidatePath("/stock"); revalidatePath("/receipts"); revalidatePath("/", "layout");
}

export async function saveShipmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "shipment");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const items = parseLines(d.items);
  if (!items) return { error: "Qatorlar o'qilmadi — sahifani yangilang" };
  let id: string;
  try {
    const res = await saveShipment({
      supplierId: d.supplierId, warehouseId: d.warehouseId, date: d.date, waybillNo: d.waybillNo,
      payment: d.payment === "BANK" || d.payment === "CASH" ? d.payment : null, carrier: d.carrier, note: d.note, items,
    }, { userId: s.userId, role: s.role }, { id: d.id, send: d.intent === "send" });
    id = res.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Jo'natma saqlanmadi" };
  }
  refresh();
  redirect(`/jonatma/${id}`);
}

export async function sendShipmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "shipment");
  try {
    await sendShipment(String(fd.get("id") ?? ""), { userId: s.userId, role: s.role });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Jo'natilmadi" };
  }
  refresh();
  return { ok: true, note: "Skladga jo'natildi — sklad xodimlariga bildirishnoma ketdi" };
}

export async function cancelShipmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "shipment");
  try {
    await cancelShipment(String(fd.get("id") ?? ""), { userId: s.userId, role: s.role }, String(fd.get("reason") ?? "").trim() || null);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Qaytarib olinmadi" };
  }
  refresh();
  return { ok: true, note: "Jo'natma qaytarib olindi" };
}

/** Qabul: `item` — belgilangan qatorlar id'si, `qty_<id>` — sanab chiqilgan fakt miqdor. */
export async function acceptShipmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "shipment_accept");
  const id = String(fd.get("id") ?? "");
  const ids = fd.getAll("item").map(String).filter(Boolean);
  const lines = ids.map((itemId) => ({ itemId, qty: Number(String(fd.get(`qty_${itemId}`) ?? "").replace(/\s+/g, "").replace(",", ".")) }));
  let res: Awaited<ReturnType<typeof acceptShipment>>;
  try {
    res = await acceptShipment(id, lines, { userId: s.userId, role: s.role });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Qabul qilinmadi" };
  }
  refresh();
  return { ok: true, note: `${res.count} qator qabul qilindi — skladga kirim ${res.receiptNo}` };
}

export async function rejectShipmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("stock", "shipment_accept");
  try {
    await rejectShipmentItems(String(fd.get("id") ?? ""), fd.getAll("item").map(String), String(fd.get("reason") ?? ""), { userId: s.userId, role: s.role });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Rad etilmadi" };
  }
  refresh();
  return { ok: true, note: "Belgilangan qatorlar rad etildi — snabjenetsga xabar ketdi" };
}
