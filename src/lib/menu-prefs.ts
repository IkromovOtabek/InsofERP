import { z } from "zod";
import type { Role } from "@/generated/prisma";
import type { Session } from "./auth";
import { db } from "./db";
import { navFor, OWN_PAGE_ONLY, type NavItem } from "./nav";
import { ARENDA_PATH, arendaHost } from "./arenda-host";

/**
 * Xodimning o'z menyusi (`User.menuPrefs`, Mening hisobim → «Kabinetim»). Faqat veb menyu ko'rinishi:
 * yashirilgan band sahifasi ruxsat bo'yicha ochiq qoladi (havola, bo'lim tablari), ruxsat o'zgarmaydi.
 * - `flat` — bo'limlarsiz: guruh sarlavhalari (Sotuv, Logistika…) yo'q, barcha bandlar bitta ro'yxatda ikonkasi bilan;
 * - `hidden` — menyuda ko'rinmaydigan bandlar (href);
 * - `order` — bandlar tartibi (href; ro'yxatda yo'q yangi band oxiriga tushadi). Bo'limli ko'rinishda — bo'lim ichida;
 * - `home` — kirgandan keyin ochiladigan sahifa (null — Bosh sahifa).
 */
export type MenuPrefs = { flat: boolean; hidden: string[]; order: string[]; home: string | null };

/** Saqlanmagan bo'lsa sukut bo'yicha bo'limlarsiz menyu — logistika kabinetida bandlar bitta ro'yxatda tursin */
const FLAT_BY_DEFAULT: Role[] = ["LOGISTICS"];

const schema = z.object({
  flat: z.boolean().optional(),
  hidden: z.array(z.string().max(200)).max(300).optional(),
  order: z.array(z.string().max(200)).max(300).optional(),
  home: z.string().max(200).nullable().optional(),
});

export function menuPrefs(raw: unknown, role: Role): MenuPrefs {
  const p = schema.safeParse(raw ?? {});
  const v = p.success ? p.data : {};
  return { flat: v.flat ?? FLAT_BY_DEFAULT.includes(role), hidden: v.hidden ?? [], order: v.order ?? [], home: v.home ?? null };
}

/** Tartib bo'yicha saralash: `order` dagilar o'sha ketma-ketlikda, qolganlari NAV tartibida oxirida. */
export function sortByOrder<T extends { href: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const pos = new Map(order.map((h, i) => [h, i]));
  return items
    .map((it, i) => ({ it, k: pos.get(it.href) ?? order.length + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.it);
}

/** Menyuga qo'llash: yashirilganlar olib tashlanadi, qolgani tartiblanadi. Hammasi yashirilgan bo'lsa — menyu bo'sh qolmasin. */
export function applyMenuPrefs(items: NavItem[], p: MenuPrefs): NavItem[] {
  const hidden = new Set(p.hidden);
  const shown = items.filter((i) => !hidden.has(i.href));
  return sortByOrder(shown.length ? shown : items, p.order);
}

/** Xodim menyusidagi barcha bandlar (yashirish va tartibdan oldin) — layout va «Kabinetim» bir xil ro'yxatni ko'rsin.
 *  Arenda bandi asosiy domenda (arenda domeni sozlangan bo'lsa) va direktor menyusida turmaydi. */
export function menuBase(s: Pick<Session, "role" | "perms">): NavItem[] {
  const nav = navFor(s.role, s.perms);
  return arendaHost() || s.role === "DIRECTOR" ? nav.filter((i) => i.href !== ARENDA_PATH) : nav;
}

/** Kirgandan keyingi sahifa (`home`): faqat xodim menyusidagi band; o'z sahifasi bilan cheklangan rollarda — yo'q. */
export async function startPage(s: Session): Promise<string | null> {
  if (OWN_PAGE_ONLY[s.role]) return null;
  const u = await db.user.findUnique({ where: { id: s.userId }, select: { menuPrefs: true } });
  const home = menuPrefs(u?.menuPrefs, s.role).home;
  return home && menuBase(s).some((i) => i.href === home) ? home : null;
}
