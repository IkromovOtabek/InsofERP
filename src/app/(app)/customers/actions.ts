"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zStr, zOpt, type ActionState } from "@/lib/action";
import { syncCustomerLater, syncCustomersLater } from "@/lib/eco/customers";
import { defaultCreditLimit } from "@/lib/finance";
import { importParties, type PartyRow } from "@/lib/import-parties";
import { parseInn } from "@/lib/inn";
import { money } from "@/lib/format";

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
  const d = r.data;
  const cur = id ? await db.customer.findUnique({ where: { id } }) : null;
  if (id && !cur) return { error: "Mijoz topilmadi" };

  // INN: 9 (STIR) yoki 14 (JSHSHIR) raqam. Tahrirda o'zgartirilmagan eski qiymat qayta tekshirilmaydi
  if (!(cur && d.inn === cur.inn)) {
    const inn = parseInn(d.inn);
    if (inn.error !== undefined) return { error: inn.error };
    d.inn = inn.inn;
  }

  // Forma ochilgandagi limit (`creditLimitWas`). Xodim limitga tegmagan bo'lsa, u umuman yozilmaydi: shu orada direktor
  // (Sozlamalar → Limitlar) yoki buxgalteriya o'zgartirgan limit eski forma bilan orqaga qaytib ketmasin.
  const wasRaw = String(fd.get("creditLimitWas") ?? "").trim();
  const was = cur && wasRaw !== "" && Number.isFinite(Number(wasRaw)) ? Number(wasRaw) : null;
  const limitTouched = !(cur && was !== null && Math.abs(d.creditLimit - was) < 0.005);
  if (!limitTouched) d.creditLimit = Number(cur!.creditLimit);
  else if (cur && was !== null && Math.abs(Number(cur.creditLimit) - was) >= 0.005) {
    return { error: `Kredit limiti shu orada boshqa joyda o'zgartirilgan (hozir ${money(Number(cur.creditLimit))}). Sahifani yangilab, qayta kiriting` };
  }

  // Kredit limitni faqat buxgalteriya/finance/direktor o'zgartira oladi. Yangi mijozda ham: aks holda sotuvchi
  // mijozni 10 mlrd limit bilan ochib, qora ro'yxat tekshiruvini chetlab o'tardi. Yangi mijozga — standart limit
  // (direktor Sozlamalar → Limitlar'da belgilaydi), formadan kelgan qiymat hisobga olinmaydi.
  if (!["FINANCE", "ACCOUNTING", "DIRECTOR"].includes(s.role)) {
    if (cur) {
      if (Number(cur.creditLimit) !== d.creditLimit) return { error: "Kredit limitni faqat Buxgalteriya, Finance yoki Direktor o'zgartira oladi" };
    } else {
      d.creditLimit = await defaultCreditLimit();
    }
  }

  let savedId = id;
  try {
    await db.$transaction(async (tx) => {
      if (id) {
        // Limit o'zgarsa — zayavka qabul qilish va Limitlar jadvali bilan bir xil `credit:` navbati; limitga tegilmagan bo'lsa
        // uni yozmaymiz (o'qish va yozish orasida boshqa joyda o'zgargan limit saqlanib qolsin)
        if (limitTouched) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"credit:" + id}))`;
        const before = await tx.customer.findUniqueOrThrow({ where: { id } });
        if (limitTouched && was !== null && Math.abs(Number(before.creditLimit) - was) >= 0.005) throw new Error("LIMIT_CONFLICT");
        const { creditLimit, ...rest } = d;
        const after = await tx.customer.update({ where: { id }, data: limitTouched ? { ...rest, creditLimit } : rest });
        await audit(tx, s.userId, "UPDATE", "Customer", id, before, after);
        // Limit o'zgarishi alohida yozuv: kim, qachon, qanchadan qanchaga — tekshiruvda tez topilsin
        if (Number(before.creditLimit) !== Number(after.creditLimit)) {
          await audit(tx, s.userId, "UPDATE", "CustomerCreditLimit", id, { creditLimit: before.creditLimit, role: s.role }, { creditLimit: after.creditLimit, role: s.role });
        }
      } else {
        const c = await tx.customer.create({ data: d });
        await audit(tx, s.userId, "CREATE", "Customer", c.id, undefined, c);
        savedId = c.id;
      }
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan mijoz allaqachon bor" };
    if (String(e).includes("LIMIT_CONFLICT")) return { error: "Kredit limiti shu orada boshqa joyda o'zgartirilgan. Sahifani yangilab, qayta kiriting" };
    throw e;
  }
  // Ilovaga ham yetsin (nom/telefon/limit) — telefoni ilovada bo'lsa hisobi o'sha yerda ulanadi
  if (savedId) syncCustomerLater(savedId);
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
