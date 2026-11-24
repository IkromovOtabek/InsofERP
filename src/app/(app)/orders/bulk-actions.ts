"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { orderCloseAtDelivered } from "@/lib/orders";
import { cancelOrderWithReason } from "@/lib/order-docs";
import type { ActionState } from "@/lib/action";

/**
 * Eski ochiq zayavkalarni ommaviy ko'rib chiqish (Sarvar rejasi 2-bosqich: «37 ta zayavka 5–6-noyabrdan beri kutmoqda»).
 * Ruxsat — bittalab bekor qilish / «Yetkazilganicha yopish» bilan bir xil («orders → cancel»), faqat mijoz zayavkasi.
 * Har zayavka o'z qoidasi bilan (`orderCloseAtDelivered`, `cancelOrderWithReason`) — o'tmaganlari sababi bilan qaytadi,
 * qolganlari bajariladi; har biri AuditLog'ga o'z sababi bilan yoziladi.
 *  · close — yetkazilganicha yopish (yetkazilgan reysi bo'lishi shart);
 *  · cancel — bekor qilish (zames, reys, brigada qaydi yo'q bo'lsa; bekor qilingan zayavka bazadan o'chadi);
 *  · auto — yetkazilgan reysi bori yopiladi, umuman boshlanmagani bekor qilinadi.
 */
const MAX = 100;

export async function bulkCloseOrders(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("orders", "cancel");
  const mode = String(fd.get("mode") ?? "");
  if (!["close", "cancel", "auto"].includes(mode)) return { error: "Amalni tanlang" };
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300);
  if (reason.length < 3) return { error: "Sababni yozing (masalan: 30-noyabr sanog'i — mijoz qolganidan voz kechdi)" };
  const ids = [...new Set(fd.getAll("ids").map(String).filter(Boolean))];
  if (!ids.length) return { error: "Zayavka belgilanmagan" };
  if (ids.length > MAX) return { error: `Bir martada ko'pi bilan ${MAX} ta zayavka` };

  const orders = await db.order.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderNo: true, kind: true, customer: { select: { name: true } }, trips: { where: { status: "DELIVERED" }, select: { id: true } } },
  });
  let closed = 0, cancelled = 0;
  const failed: string[] = [];
  for (const o of orders) {
    const label = `${o.orderNo} (${o.customer.name})`;
    if (o.kind !== "SALE") { failed.push(`${label}: sklad zayavkasi — o'z kartasidan yopiladi`); continue; }
    const close = mode === "close" || (mode === "auto" && o.trips.length > 0);
    if (close) {
      const r = await orderCloseAtDelivered(o.id, reason, s.userId);
      if (r.error) failed.push(`${label}: ${r.error}`); else closed++;
    } else {
      const r = await cancelOrderWithReason(o.id, reason, s.userId);
      if (!r.ok) failed.push(`${label}: ${r.error}`); else cancelled++;
    }
  }
  const missing = ids.length - orders.length;
  if (missing) failed.push(`${missing} ta zayavka topilmadi (ehtimol allaqachon bekor qilingan)`);
  for (const p of ["/orders", "/sales", "/customers", "/tasks", "/brigades", "/production", "/payments"]) revalidatePath(p);
  const done = [closed && `${closed} ta yetkazilganicha yopildi`, cancelled && `${cancelled} ta bekor qilindi`].filter(Boolean).join(", ");
  if (!done) return { error: `Hech biri o'zgarmadi: ${failed.slice(0, 10).join("; ")}${failed.length > 10 ? ` va yana ${failed.length - 10} ta` : ""}` };
  return {
    ok: true, note: `${done}.`,
    warn: failed.length ? `${failed.length} tasi o'zgarmadi: ${failed.slice(0, 10).join("; ")}${failed.length > 10 ? ` va yana ${failed.length - 10} ta` : ""}` : undefined,
  };
}
