"use server";

import { z } from "zod";
import { parseForm, type ActionState } from "@/lib/action";
import { createLead } from "@/lib/leads";
import { requestFromWeb } from "@/lib/account-deletion";

/**
 * Saytdagi "Ariza qoldirish" formasi — login talab qilmaydi, shuning uchun
 * spam va bot yuborishidan himoya kerak:
 *  · `website` — ko'rinmas "honeypot" maydoni; odam uni to'ldirmaydi, bot to'ldiradi;
 *  · bitta raqamdan 2 daqiqada bitta ariza (qoida `lib/leads.ts` da);
 *  · raqam normallashtiriladi, yaroqsiz bo'lsa qabul qilinmaydi.
 */

const schema = z.object({
  name: z.string().trim().min(2, "ism to'liq yozilsin").max(80),
  phone: z.string().trim().min(1, "telefon raqami kerak"),
  productId: z.string().trim().optional().transform((v) => (v ? v : null)),
  qty: z.string().trim().optional().transform((v) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return v && Number.isFinite(n) && n > 0 ? n : null;
  }),
  address: z.string().trim().max(200).optional().transform((v) => (v ? v : null)),
  message: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  website: z.string().optional(), // honeypot
});

export async function submitLead(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseForm(schema, fd);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;

  // Bot to'ldirgan forma — "qabul qilindi" deb ko'rsatamiz, lekin hech narsa yozilmaydi.
  if (d.website) return { ok: true };

  const res = await createLead(d);
  if (!res.ok) return { error: res.error };
  return res.duplicate
    ? { ok: true, note: "Arizangiz allaqachon qabul qilingan — tez orada bog'lanamiz." }
    : { ok: true };
}

/* ───────── Hisobni o'chirish so'rovi (/maxfiylik/hisobni-ochirish) ───────── */

const deletionSchema = z.object({
  name: z.string().trim().min(2, "ism to'liq yozilsin").max(80),
  phone: z.string().trim().min(1, "telefon raqami kerak"),
  note: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
  website: z.string().optional(), // honeypot
});

/** Ilovasiz (o'chirib tashlagan) odam uchun — so'rov direktorga tushadi, u telefon qilib tasdiqlaydi. */
export async function submitDeletionRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = parseForm(deletionSchema, fd);
  if ("error" in parsed) return { error: parsed.error };
  const d = parsed.data;
  if (d.website) return { ok: true };
  const res = await requestFromWeb({ name: d.name, phone: d.phone, note: d.note });
  if (!res.ok) return { error: res.error };
  return res.duplicate ? { ok: true, note: "Bu raqam bo'yicha so'rov allaqachon qabul qilingan." } : { ok: true };
}
