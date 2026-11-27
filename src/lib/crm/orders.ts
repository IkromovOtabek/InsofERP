import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { refreshClient } from "./contacts";

/**
 * CRM ↔ zayavkalar (CRM_SPEC 3.3, 4.3, 8 — 6-bosqich). Zayavka yangi jadval emas — mavjud `Order`; CRM faqat
 * «Zayafka oldim» aloqasiga bog'lanadi (`Order.crmContactId`) va mijozning avto-holatini yangilaydi.
 */

/** Zayavka ochilganda (tranzaksiya ichida): aloqaga bog'lash va CRM mijozi holatini qayta hisoblash. */
export async function linkCrmOrderTx(tx: Prisma.TransactionClient, orderId: string, customerId: string, contactId: string | null) {
  if (contactId) {
    const c = await tx.crmContact.findFirst({ where: { id: contactId, customerId, cancelledAt: null }, select: { id: true } });
    if (c) await tx.order.update({ where: { id: orderId }, data: { crmContactId: c.id } });
  }
  const cust = await tx.customer.findUnique({ where: { id: customerId }, select: { crmAt: true } });
  if (cust?.crmAt) await refreshClient(tx, customerId);
}

/** Zayavka bekor qilinganda / holati o'zgarganda — CRM mijozi bo'lsa holatini yangilash. Xato zayavka amalini buzmasin. */
export async function refreshCrmCustomer(customerId: string) {
  try {
    const cust = await db.customer.findUnique({ where: { id: customerId }, select: { crmAt: true } });
    if (cust?.crmAt) await db.$transaction((tx) => refreshClient(tx, customerId));
  } catch (e) {
    console.error("crm refresh", e);
  }
}

/**
 * Vaqt o'tishi bilan o'zgaradigan holat: oxirgi zayavkadan N kun o'tgach «Ishlayotgan» → «Eski mijoz».
 * Hech qanday hodisa bo'lmaydi, shuning uchun «Bugun» ochilganda tekshiriladi (bir jarayonda soatiga bir marta).
 */
const g = globalThis as { __crmStaleAt?: number };
export async function refreshStaleStatuses() {
  if (g.__crmStaleAt && Date.now() - g.__crmStaleAt < 3_600_000) return;
  g.__crmStaleAt = Date.now();
  const cfg = await db.companySettings.findUnique({ where: { id: "main" }, select: { crmColdDays: true } });
  const since = new Date(Date.now() - (cfg?.crmColdDays ?? 90) * 86_400_000);
  const stale = await db.customer.findMany({
    where: { crmAt: { not: null }, crmStatus: "ACTIVE", crmStatusManual: false, orders: { some: { kind: "SALE", status: { not: "CANCELLED" } }, none: { kind: "SALE", status: { not: "CANCELLED" }, date: { gte: since } } } },
    select: { id: true },
    take: 500,
  });
  for (const c of stale) await refreshCrmCustomer(c.id);
}
