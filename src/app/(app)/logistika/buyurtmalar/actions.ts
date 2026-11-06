"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { orderDeliveryEdit } from "@/lib/orders";
import { parseForm, zOpt, type ActionState } from "@/lib/action";

const coord = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().optional()).catch(undefined);

const schema = z.object({
  deliveryDate: z.string().trim().min(1, "Yetkazish sanasini tanlang").refine((v) => Number.isFinite(new Date(v).getTime()), "Yetkazish sanasi noto'g'ri"),
  deliveryTime: zOpt,
  deliveryAddress: z.string().trim().min(1, "Obyekt manzili kerak"),
  // Nuqta belgilanmagan bo'lsa maydon bo'sh keladi — 0 bo'lib qolmasin (0, 0 — okean, «nuqta yo'q» emas)
  lat: coord,
  lng: coord,
  needsPump: z.string().optional().transform((v) => v === "on"),
  isUrgent: z.string().optional().transform((v) => v === "on"),
  note: zOpt,
});

/** «Buyurtmalar» → qatordagi qalamcha: yetkazish ma'lumotlari. Qoida — `lib/orders.ts` → `orderDeliveryEdit`. */
export async function editOrderDelivery(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "order_edit");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const res = await orderDeliveryEdit(id, {
    deliveryDate: new Date(d.deliveryDate),
    deliveryTime: d.deliveryTime,
    deliveryAddress: d.deliveryAddress,
    lat: Number.isFinite(d.lat) && Number.isFinite(d.lng) && !(d.lat === 0 && d.lng === 0) ? d.lat! : null,
    lng: Number.isFinite(d.lat) && Number.isFinite(d.lng) && !(d.lat === 0 && d.lng === 0) ? d.lng! : null,
    needsPump: d.needsPump,
    isUrgent: d.isUrgent,
    note: d.note,
  }, s.userId);
  if (res.error) return { error: res.error };
  // Zayavka ko'rinadigan hamma joy yangisini ko'rsin
  revalidatePath("/logistika", "layout"); revalidatePath("/orders", "layout"); revalidatePath("/sales"); revalidatePath("/trips", "layout");
  revalidatePath("/production"); revalidatePath("/tasks");
  redirect("/logistika/buyurtmalar");
}
