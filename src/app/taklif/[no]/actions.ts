"use server";

import { z } from "zod";
import type { ActionState } from "@/lib/action";
import { replyOfferPublic } from "@/lib/offers";

const schema = z.object({
  kind: z.enum(["accept", "question"]),
  name: z.string().trim().min(2, "Ismingizni yozing").max(120),
  phone: z.string().trim().min(7, "Telefon raqamini yozing").max(32),
  note: z.string().trim().max(1000).optional(),
  // Spam-bot himoyasi: odam ko'rmaydigan maydon to'ldirilsa — jim rad
  site: z.string().optional(),
});

/** Ommaviy (QR) sahifadan mijoz javobi — login yo'q, taklif kaliti (`k`) bilan tekshiriladi. */
export async function replyOffer(offerNo: string, k: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const p = schema.safeParse(Object.fromEntries(fd.entries()));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri" };
  if (p.data.site) return { ok: true, note: "Yuborildi" };
  const r = await replyOfferPublic(offerNo, k, { kind: p.data.kind, name: p.data.name, phone: p.data.phone, note: p.data.note || null });
  return r.ok ? { ok: true, note: r.note } : { error: r.error };
}
