"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zDec, zStr, zOpt, type ActionState } from "@/lib/action";
import { syncCustomerLater, syncCustomersLater } from "@/lib/eco/customers";
import { importParties, type PartyRow } from "@/lib/import-parties";
import { saveCustomerLib } from "@/lib/customer-admin";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { Prisma } from "@/generated/prisma";
import { eco, ecoEnabled } from "@/lib/eco/client";
import { notifyAfter } from "@/lib/notify";

const schema = z.object({
  name: zStr("Nomi to'ldirilishi shart"),
  inn: zOpt,
  phone: zOpt,
  address: zOpt,
  contactPerson: zOpt,
  creditLimit: zDec(0),
  isActive: z.string().optional().transform((v) => v === "on"),
  // Har qatorda bitta nom (nuqtali vergul ham ajratadi; vergul — nom ichida bo'lishi mumkin)
  aliases: z.string().optional().transform((v) => (v ?? "").split(/[\n;]+/)),
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

/**
 * Mijozni o'chirish (ruxsat — saqlash bilan bir xil «customers → edit»). Hech qayerda ishlatilmagan karta
 * (xato yoki takror ochilgan) obyektlari bilan bazadan o'chadi. Zayavka, schyot, to'lov, realizatsiya, ariza,
 * taklif, amoCRM yoki boshlang'ich qoldiqda uchrasa — o'chirilmaydi, «Nofaol» qilinadi (tarix joyida qoladi).
 * Ikkala holat ham AuditLog'da. `fromCard` — mijoz kartasidan: karta o'chsa ro'yxatga qaytadi.
 */
export async function deleteCustomer(fromCard: boolean, id: string): Promise<ActionState> {
  const s = await requireAction("customers", "edit");
  const c = await db.customer.findUnique({ where: { id } });
  if (!c || c.isInternal) return { error: "Mijoz topilmadi" };

  // Bog'liq hujjatlar: ixtiyoriy bog'lanishlar (ariza, taklif, amoCRM, realizatsiya) o'chirishda jim uzilib qolmasin — oldindan sanaladi
  const counts = await Promise.all([
    db.order.count({ where: { OR: [{ customerId: id }, { site: { customerId: id } }] } }),
    db.invoice.count({ where: { customerId: id } }),
    db.payment.count({ where: { customerId: id } }),
    db.paymentRequest.count({ where: { customerId: id } }),
    db.salesRegister.count({ where: { customerId: id } }),
    db.realizationEntry.count({ where: { customerId: id } }),
    db.openingBalance.count({ where: { customerId: id } }),
    db.lead.count({ where: { customerId: id } }),
    db.commercialOffer.count({ where: { customerId: id } }),
    db.amoDeal.count({ where: { customerId: id } }),
  ]);
  const used = counts.reduce((a, b) => a + b, 0);

  if (used === 0) {
    let deleted = false;
    try {
      await db.$transaction(async (tx) => {
        // Obyektlar hujjat emas — mijoz bilan birga ketadi (bloklari Cascade bilan)
        const sites = await tx.site.findMany({ where: { customerId: id }, include: { blocks: { select: { name: true } } } });
        await tx.site.deleteMany({ where: { customerId: id } });
        await tx.customer.delete({ where: { id } });
        await audit(tx, s.userId, "DELETE", "Customer", id, { ...c, sites }, undefined);
      });
      deleted = true;
    } catch (e) {
      // Yuqorida sanalmagan bog'liq yozuv (FK) — hammasi orqaga qaytdi, quyida nofaol qilinadi
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003")) throw e;
    }
    if (deleted) {
      // ECO'da shu karta (tashkilot) bo'lsa — ilovada egasiz faol qolmasin
      if (ecoEnabled()) notifyAfter(async () => { await eco.upsertCustomer({ externalRef: id, name: c.name, isActive: false }); });
      revalidatePath("/customers");
      if (fromCard) redirect("/customers");
      return { ok: true, note: `«${c.name}» o'chirildi` };
    }
  }

  if (!c.isActive) return { error: `«${c.name}» hujjatlarda ishlatilgan — butunlay o'chirilmaydi, u allaqachon nofaol` };
  const done = await db.$transaction(async (tx) => {
    // Shartli: shu orada boshqa xodim faollashtirgan/nofaol qilgan bo'lsa ikki marta yozilmaydi
    const r = await tx.customer.updateMany({ where: { id, isActive: true }, data: { isActive: false } });
    if (!r.count) return false;
    await audit(tx, s.userId, "UPDATE", "Customer", id, { isActive: true }, { isActive: false, reason: "o'chirish so'raldi — hujjatlarda ishlatilgan, nofaol qilindi" });
    return true;
  });
  if (!done) return { error: "Mijoz shu payt o'zgardi — sahifani yangilang" };
  syncCustomerLater(id); // ilovada ham nofaol
  revalidatePath("/customers"); revalidatePath(`/customers/${id}`);
  return { ok: true, note: `«${c.name}» ${used ? `${used} ta hujjatda ishlatilgan` : "bog'liq yozuvlari bor"} — o'chirilmadi, nofaol qilindi (tarix joyida)` };
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
