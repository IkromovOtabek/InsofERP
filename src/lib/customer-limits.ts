import { db } from "./db";
import { audit } from "./audit";
import { syncCustomersLater } from "./eco/customers";
import type { Role } from "@/generated/prisma";

/**
 * Bir nechta mijozning kredit limitini birdan o'zgartirish — Sozlamalar → Limitlar jadvali (faqat direktor).
 *
 * Har mijoz alohida tranzaksiyada, zayavka qabul qilish (`orderConfirm`) bilan bir xil `credit:<id>` qulfi
 * ostida yoziladi: limit o'zgarayotgan paytda shu mijozning zayavkasi eski limit bilan qabul qilinib ketmasin.
 *
 * `expected` — jadval ochilgandagi limit. Bazadagi qiymat undan farq qilsa (shu orada buxgalteriya mijoz
 * kartasida o'zgartirgan), yozilmaydi va `conflicts` da qaytadi — birovning o'zgarishi jimgina ustidan yozilmasin.
 *
 * Audit: mijoz kartasidagi kabi alohida `CustomerCreditLimit` yozuvi (kim, qanchadan qanchaga). ECO ilovasiga
 * yangi limit yuboriladi (`syncCustomersLater` — bitta fon vazifada, ketma-ket).
 */
export type LimitChange = { id: string; limit: number; expected: number };
export type LimitResult = { changed: number; same: number; conflicts: string[]; missing: number };

const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

export async function setCustomerCreditLimits(actor: { userId: string; role: Role }, changes: LimitChange[], via = "settings"): Promise<LimitResult> {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const res: LimitResult = { changed: 0, same: 0, conflicts: [], missing: 0 };
  const synced: string[] = [];

  for (const c of byId.values()) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"credit:" + c.id}))`;
      const cur = await tx.customer.findUnique({ where: { id: c.id }, select: { name: true, creditLimit: true, isInternal: true } });
      // Ichki "Sklad" kartochkasi mijoz emas — limiti doim 0
      if (!cur || cur.isInternal) { res.missing++; return; }
      const now = Number(cur.creditLimit);
      if (eq(now, c.limit)) { res.same++; return; }
      if (!eq(now, c.expected)) { res.conflicts.push(cur.name); return; }
      // Shartli yozuv: mijoz kartasi va Excel import `credit:` qulfini olmaydi — o'qish va yozish orasida ular
      // limitni o'zgartirgan bo'lsa, ustidan yozilmaydi (aks holda ularning o'zgarishi jimgina yo'qolardi).
      const u = await tx.customer.updateMany({ where: { id: c.id, creditLimit: cur.creditLimit }, data: { creditLimit: c.limit } });
      if (u.count !== 1) { res.conflicts.push(cur.name); return; }
      await audit(tx, actor.userId, "UPDATE", "CustomerCreditLimit", c.id,
        { creditLimit: now, role: actor.role, mijoz: cur.name },
        { creditLimit: c.limit, role: actor.role, mijoz: cur.name, via });
      res.changed++;
      synced.push(c.id);
    });
  }
  syncCustomersLater(synced);
  return res;
}
