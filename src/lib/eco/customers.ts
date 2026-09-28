import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { eco, ecoEnabled, EcoError, normalizePhone, type EcoCustomerApp, type EcoUnlinkedCustomer } from "./client";
import { pushCustomer } from "./master";

/**
 * Mijozning ilova hisobi: ERP mijoz kartasi ↔ Insof ECO ilovasida ro'yxatdan o'tgan quruvchi.
 *
 * Kalit: ECO tashkilotining `externalRef` = ERP `Customer.id`. Ulangan mijoz ilovada o'z zayavkalarini,
 * reyslarini va mashina qayerda ekanini ko'radi — ERP reyslari ECO'ga shu tashkilot nomiga yoziladi.
 *
 * Ulanish uch yo'l bilan bo'ladi:
 *  1. Sotuvchi mijozni telefon bilan kiritdi → ERP darhol ECO'ga yuboradi (`syncCustomerLater`) → ECO'da
 *     parolsiz a'zo paydo bo'ladi → mijoz keyin shu telefon bilan ro'yxatdan o'tsa hisob o'zi ulanadi,
 *     ERP'ga `customer.registered` webhook keladi (`applyEcoCustomerRegistered`) — sotuvchi xabar oladi.
 *  2. Mijoz ERP'dan OLDIN ro'yxatdan o'tgan, telefoni mos → ECO `ensureClient` o'zi ulaydi, yangi tashkilot ochmaydi.
 *  3. Telefon boshqa yoki yo'q → sotuvchi mijoz kartasida "Ilova hisobi" bo'limidan qo'lda ulaydi
 *     (`findAppCandidates` → `linkCustomerApp`).
 *
 * ECO o'chiq bo'lsa hech narsa buzilmaydi: holat `available:false` qaytadi, karta sokin xabar ko'rsatadi.
 */
export type AppStatus =
  | ({ available: true } & EcoCustomerApp)
  | { available: false; reason: "disabled" | "unreachable" | "error"; message: string };

const errMsg = (e: unknown) => (e instanceof EcoError ? e.message : String((e as Error)?.message ?? e));

/** Mijoz kartasi uchun holat. Tashlamaydi. */
export async function customerAppStatus(customerId: string): Promise<AppStatus> {
  if (!ecoEnabled()) return { available: false, reason: "disabled", message: "ECO ulanmagan" };
  try {
    return { available: true, ...(await eco.customerApp(customerId)) };
  } catch (e) {
    const reason = e instanceof EcoError && (e.code === "ECO_UNREACHABLE" || e.code === "ECO_DISABLED") ? "unreachable" : "error";
    return { available: false, reason, message: errMsg(e) };
  }
}

/** Ulash uchun nomzodlar — ilovada o'zi ro'yxatdan o'tgan, hali ulanmagan mijozlar. */
export async function findAppCandidates(q: string): Promise<{ items: EcoUnlinkedCustomer[]; error?: string }> {
  if (!ecoEnabled()) return { items: [], error: "ECO ulanmagan" };
  try {
    return { items: await eco.unlinkedCustomers(q.trim() || undefined) };
  } catch (e) {
    return { items: [], error: errMsg(e) };
  }
}

/**
 * Telefon bo'yicha tezkor tekshiruv (zayavka formasidagi "Yangi mijoz" uchun):
 * shu raqam ilovada ro'yxatdan o'tganmi va hali ulanmaganmi. Topilsa mijoz saqlanganda o'zi ulanadi.
 */
export async function appAccountByPhone(rawPhone: string): Promise<{ fullName: string | null; orgName: string; registered: boolean } | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone || !ecoEnabled()) return null;
  try {
    const items = await eco.unlinkedCustomers(phone);
    for (const o of items) {
      const m = o.members.find((x) => x.phone === phone);
      if (m) return { fullName: m.fullName, orgName: o.name, registered: m.registered };
    }
    return null;
  } catch {
    return null;
  }
}

/** Sotuvchi qo'lda uladi: ECO'da ulash/birlashtirish, keyin ERP kartasi (nom, INN, limit) ECO'ga qayta yuboriladi. */
export async function linkCustomerApp(customerId: string, orgId: string, userId: string): Promise<{ ok: true; status: EcoCustomerApp } | { ok: false; error: string }> {
  const c = await db.customer.findUnique({ where: { id: customerId } });
  if (!c || c.isInternal) return { ok: false, error: "Mijoz topilmadi" };
  if (!ecoEnabled()) return { ok: false, error: "ECO ulanmagan" };
  try {
    const status = await eco.linkCustomer(customerId, orgId);
    const push = await pushCustomer(customerId);
    await audit(db, userId, "UPDATE", "Customer", customerId, { ecoOrgId: null }, { ecoOrgId: orgId, appMembers: status.members.map((m) => m.phone), pushed: push.ok });
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Mijoz kartasi yaratildi/o'zgardi → ECO'ga javobdan keyin yuboriladi (foydalanuvchi kutmaydi).
 * Aynan shu yuborish telefon bo'yicha avtomatik ulanishni ishga tushiradi.
 */
export function syncCustomerLater(customerId: string): void {
  if (!ecoEnabled()) return;
  notifyAfter(async () => {
    const r = await pushCustomer(customerId);
    if (!r.ok && !r.skipped) console.warn("[eco] mijoz yuborilmadi", customerId, r.error);
  });
}

/** ECO webhook: ERP'dan taklif qilingan mijoz ilovada parol qo'ydi → sotuvchilarga bildirishnoma. */
export async function applyEcoCustomerRegistered(p: { externalRef: string; phone: string; fullName: string | null }): Promise<{ applied: boolean }> {
  const c = await db.customer.findUnique({ where: { id: p.externalRef }, select: { id: true, name: true } });
  if (!c) return { applied: false };
  const who = p.fullName ? `${p.fullName} (${p.phone})` : p.phone;
  await notifyRoles(["SALES"], {
    type: "CUSTOMER_APP_REGISTERED",
    title: `${c.name} ilovaga kirdi`,
    body: `${who} Insof ECO ilovasida ro'yxatdan o'tdi — endi zayavkalari va reyslarini ilovada kuzatadi`,
    link: { key: "customers", id: c.id },
    channel: "oddiy",
  });
  revalidatePath(`/customers/${c.id}`);
  return { applied: true };
}
