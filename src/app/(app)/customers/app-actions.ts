"use server";

import { requireSession } from "@/lib/auth";
import { appAccountByPhone, findAppCandidates, linkCustomerApp } from "@/lib/eco/customers";
import type { EcoCustomerApp, EcoUnlinkedCustomer } from "@/lib/eco/client";

/**
 * Mijozning ilova hisobi — server action'lar (mijoz kartasi va zayavka formasi chaqiradi).
 * Mantiq `lib/eco/customers.ts` da; bu yerda faqat ruxsat tekshiruvi.
 */

/** Ulash uchun nomzodlar: ilovada o'zi ro'yxatdan o'tgan, hali ulanmagan mijozlar. */
export async function searchAppCandidates(q: string): Promise<{ items: EcoUnlinkedCustomer[]; error?: string }> {
  await requireSession(["SALES", "ACCOUNTING", "FINANCE"]);
  return findAppCandidates(q);
}

/** Sotuvchi (yoki direktor) mijozni ilova hisobiga uladi. */
export async function linkAppAccount(customerId: string, orgId: string): Promise<{ ok: true; status: EcoCustomerApp } | { ok: false; error: string }> {
  const s = await requireSession(["SALES"]);
  return linkCustomerApp(customerId, orgId, s.userId);
}

/** Zayavka formasi: "Yangi mijoz" telefoni ilovada bormi (saqlanganda o'zi ulanadi). */
export async function lookupAppByPhone(phone: string) {
  await requireSession(["SALES"]);
  return appAccountByPhone(phone);
}
