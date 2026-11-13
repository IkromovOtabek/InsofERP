"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { deleteCustomerSite, saveCustomerSite } from "@/lib/customer-sites";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { numIn } from "@/lib/logistics-admin";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { renameSiteBlocks } from "@/lib/site-blocks";

/** Obyekt (Site) qo'shish/tahrirlash — mijoz kartasidagi kabi rol: SALES, ACCOUNTING, FINANCE (+DIRECTOR). */

const schema = z.object({
  name: zStr("Obyekt nomi to'ldirilishi shart"),
  address: zStr("Manzil to'ldirilishi shart"),
  lat: numIn(-90, 90),
  lng: numIn(-180, 180),
  contactName: zOpt,
  contactPhone: zOpt,
  deliveryHours: zOpt,
  instructions: zOpt,
  isActive: z.string().optional().transform((v) => v === "on"),
  // Obyekt ichidagi bloklar (A blok, B blok…) — forma har doim yuboradi (bo'sh ro'yxat — bloklar yo'q)
  block: z.array(z.string()).optional(),
  // Har chip uchun bazadagi asl nomi (yangi qo'shilgani — bo'sh): qalam bilan qayta nomlangan blok id'si saqlanadi
  blockWas: z.array(z.string()).optional(),
  blocksSent: z.string().optional(),
});

export async function saveSite(customerId: string, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("customers", "sites");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  // Qoida `lib/customer-sites.ts` da — mobil ilova (mijoz kartasi) ham shuni chaqiradi
  const { block, blockWas, blocksSent, ...site } = r.data;
  // Qayta nomlangan bloklar — avval nomi almashadi (o'sha id), keyin ro'yxat sinxroni ularni yangi nom bilan topadi
  if (id && blocksSent && block && blockWas) {
    const pairs = block.map((to, i) => ({ from: blockWas[i] ?? "", to })).filter((p) => p.from.trim() && p.from !== p.to);
    if (pairs.length) {
      const ren = await db.$transaction(async (tx) => {
        const own = await tx.site.findUnique({ where: { id }, select: { customerId: true } });
        if (!own || own.customerId !== customerId) return { ok: false as const, error: "Bu obyekt boshqa mijozga tegishli" };
        const x = await renameSiteBlocks(tx, id, pairs);
        if (x.ok) for (const b of x.renamed) await audit(tx, s.userId, "UPDATE", "SiteBlock", b.id, { name: b.from, siteId: id }, { name: b.to, siteId: id });
        return x;
      });
      if (!ren.ok) return { error: ren.error };
    }
  }
  const res = await saveCustomerSite(customerId, id, { ...site, blocks: blocksSent ? block ?? [] : undefined }, s.userId);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}

/**
 * Obyektni «faol emas» / qayta faol qilish — zayavkasi bor obyekt o'chirilmaydi, o'rniga shu (yangi zayavkada tanlanmaydi,
 * tarix joyida). Shartli yozuv: holat shu orada o'zgargan bo'lsa ikki marta yozilmaydi. AuditLog'da.
 */
export async function setSiteActive(customerId: string, id: string, active: boolean): Promise<ActionState> {
  const s = await requireAction("customers", "sites");
  const on = active === true;
  const done = await db.$transaction(async (tx) => {
    const r = await tx.site.updateMany({ where: { id, customerId, isActive: !on }, data: { isActive: on } });
    if (!r.count) return false;
    await audit(tx, s.userId, "UPDATE", "Site", id, { isActive: !on }, { isActive: on });
    return true;
  });
  if (!done) return { error: "Obyekt topilmadi yoki holati shu payt o'zgardi — sahifani yangilang" };
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}

export async function deleteSite(customerId: string, id: string): Promise<ActionState> {
  const s = await requireAction("customers", "sites");
  const res = await deleteCustomerSite(customerId, id, s.userId);
  if (!res.ok) return { error: res.error };
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}
