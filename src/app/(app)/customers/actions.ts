"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zDec, zStr, zOpt, type ActionState } from "@/lib/action";
import { syncCustomerLater, syncCustomersLater } from "@/lib/eco/customers";
import { importParties, type PartyRow } from "@/lib/import-parties";
import { saveCustomerLib } from "@/lib/customer-admin";

const schema = z.object({
  name: zStr("Nomi to'ldirilishi shart"),
  inn: zOpt,
  phone: zOpt,
  address: zOpt,
  contactPerson: zOpt,
  creditLimit: zDec(0),
  isActive: z.string().optional().transform((v) => v === "on"),
});

export async function saveCustomer(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("customers", "edit");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  // Qoida (INN, limit to'qnashuvi, kim limitni o'zgartiradi, audit) — `lib/customer-admin.ts`; mobil ham shuni chaqiradi
  const res = await saveCustomerLib(id, r.data, { userId: s.userId, role: s.role }, String(fd.get("creditLimitWas") ?? ""));
  if (!res.ok) return { error: res.error };
  // Ilovaga ham yetsin (nom/telefon/limit) — telefoni ilovada bo'lsa hisobi o'sha yerda ulanadi
  syncCustomerLater(res.id);
  revalidatePath("/customers");
  redirect("/customers");
}

// ───────────────────────── Excel'dan mijozlar ro'yxati ─────────────────────────

const importSchema = z.object({
  rows: z.string(),
  updateExisting: z.string().optional().transform((v) => v === "on"),
});

/**
 * Mijozlar → "Excel import": Nomi, INN, Telefon, Manzil, Mas'ul shaxs, Kredit limit.
 * Bazada bor mijoz (INN → telefon → nom bo'yicha) qayta ochilmaydi — qoida `lib/import-parties.ts` da.
 */
export async function importCustomersFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("customers", "edit");
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  let rows: PartyRow[];
  try { rows = JSON.parse(r.data.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows) || !rows.length) return { error: "Faylda qator yo'q" };
  let res;
  try {
    res = await importParties("customer", rows, { updateExisting: r.data.updateExisting, canSetLimit: ["FINANCE", "ACCOUNTING", "DIRECTOR"].includes(s.role), role: s.role }, s.userId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  // Yangi va o'zgargan kartalar ilovaga ham yetsin (nom/telefon/limit) — bitta fon vazifada, ketma-ket
  syncCustomersLater(res.ids);
  revalidatePath("/customers");
  return {
    ok: true,
    note: [
      `${res.created} ta yangi mijoz qo'shildi, ${res.updated} tasi yangilandi`,
      res.skipped ? `${res.skipped} tasi bazada bor — o'tkazib yuborildi${res.samples.length ? ` (${res.samples.join("; ")})` : ""}` : "",
      res.dupInFile ? `faylda ${res.dupInFile} ta takroriy qator bitta kartaga birlashdi` : "",
    ].filter(Boolean).join(" · "),
  };
}
