"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zDec, zOpt, type ActionState } from "@/lib/action";
import { cancelContact, saveContact } from "@/lib/crm/contacts";
import { canDo } from "@/lib/permissions";

const schema = z.object({
  customerId: z.string().min(1),
  date: z.string().min(1, "Sana kiritilmagan"),
  channelId: zOpt,
  resultId: z.string().min(1, "Natijani tanlang"),
  productId: zOpt,
  offeredPrice: z.union([z.literal("").transform(() => null), zDec(0)]).optional().transform((v) => (v == null ? null : v)),
  nextContactDate: zOpt,
  leadSourceId: zOpt,
  objectName: zOpt,
  objectArea: zOpt,
  note: zOpt,
  clientToken: zOpt,
  back: zOpt,
});

/** Aloqa yozish (CRM_SPEC 5.4). «Zayafka oldim» — saqlangach zayavka formasi mijoz bilan ochiladi. */
export async function saveContactAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("crm", "contact");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const { back, ...d } = r.data;
  const res = await saveContact({ ...d, date: d.date, resultId: d.resultId }, s.userId);
  if (!res.ok) return { error: res.error, field: res.field };
  revalidatePath("/crm");
  // Zayavka ochish huquqi bo'lsa — forma mijoz bilan ochiladi; bo'lmasa kartochkaga (zayavkani sotuv ochadi)
  if (res.win && canDo(s, "orders", "create")) redirect(`/orders/new?customer=${d.customerId}&crm=${res.id}`);
  // Faqat ichki yo'l (ochiq redirect bo'lmasin)
  redirect(back && back.startsWith("/crm") && !back.startsWith("//") ? back : `/crm/mijozlar/${d.customerId}`);
}

/** Menejer aloqani bekor qiladi (sababi bilan). */
export async function cancelContactAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("crm", "manage");
  const res = await cancelContact(id, String(fd.get("reason") ?? ""), s.userId);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/crm/mijozlar/${res.customerId}`);
  revalidatePath("/crm");
  return { ok: true };
}
