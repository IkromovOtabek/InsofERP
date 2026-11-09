import { db } from "@/lib/db";
import { pathAllowed } from "@/lib/nav";
import type { Session } from "@/lib/auth";
import type { NotifyLink } from "@/lib/notify";

/**
 * Vebdagi bildirishnomalar oqimi (o'ng tepadagi kartochkalar). Manba — mobil ilova bilan bitta `Notification`
 * jadvali (`lib/notify.ts`): xabar qayerdan kelishidan qat'i nazar ikkalasida ko'rinadi.
 * «Tozalash» = o'qilgan (`readAt`) — ilovadagi raqam ham nolga tushadi.
 */

/** Ilova kartochkasi kaliti → veb sahifa. `id` bo'lsa ichki sahifa, aks holda ro'yxat. */
const WEB_PATH: Record<string, (id: string) => string> = {
  orders: (id) => `/orders/${id}`,
  trips: (id) => `/trips/${id}`,
  supply: (id) => `/taminot/${id}`,
  kirim: (id) => `/mexanik-sorovlar/${id}`, // mexanik so'rovi eslatmasi
  "trip-pay": () => "/logistika/tabel",
  employees: (id) => `/employees/${id}`,
  vazifalarim: (id) => `/vazifalar/${id}`,
  "ish-haqi": (id) => `/ish-haqi/${id}`,
  tasks: () => "/tasks",
  jonatma: (id) => `/jonatma/${id}`,
  "brig-issue": () => "/brigades",
  "brig-shift": () => "/brigades",
  boost: () => "/marketing/target",
  stock: () => "/stock",
  offers: (id) => `/takliflar/${id}`,
  leads: () => "/leads",
  "sex-emp": () => "/otdel-kadr?tab=davomat",
  oyligim: () => "/hisobim",
  smm: (id) => `/marketing/kontent/${id}`,
  receipts: (id) => `/receipts/${id}`,
  "prod-report": (id) => (id ? `/dashboard/hisobot/${id}` : "/dashboard/hisobot"), // ochilganda «ko'rildi» belgilanadi
  payreq: () => "/pul-qabul",
  invoices: () => "/invoices",
  customers: (id) => `/customers/${id}`,
};

/** Bosilganda ochiladigan sahifa — xodimga yopiq bo'lsa null (kartochka bosilmaydi). */
export function notificationHref(link: NotifyLink | null, s: Session): string | null {
  const to = link?.key ? WEB_PATH[link.key] : undefined;
  if (!to) return null;
  const href = to(link!.id ?? "");
  if (href.endsWith("/")) return null;
  return pathAllowed(href.split("?")[0]!, s.role, s.perms) ? href : null;
}

export type WebNotification = { id: string; type: string; title: string; body: string; href: string | null; at: string };

/** Ko'rsatiladigan eng yangi (o'qilmagan) xabarlar soni — qolgani «yana N ta» bo'lib yoziladi. */
export const STACK_LIMIT = 20;

export async function webNotifications(s: Session): Promise<{ unread: number; rows: WebNotification[] }> {
  const where = { userId: s.userId, readAt: null };
  const [unread, rows] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: STACK_LIMIT, select: { id: true, type: true, title: true, body: true, link: true, createdAt: true } }),
  ]);
  return {
    unread,
    rows: rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, href: notificationHref(r.link as NotifyLink | null, s), at: r.createdAt.toISOString() })),
  };
}
