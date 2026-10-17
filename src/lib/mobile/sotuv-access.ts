import type { Role } from "@/generated/prisma";
import { STOCK_ORDER_ROLES } from "@/lib/stock-orders";

/**
 * Sotuv va agent kabineti (ERP → mobil paritet) — ro'yxat, kartochka, amal va forma ruxsatlari.
 * Faqat o'zgarmaslar: `list.ts`, `detail.ts`, `create.ts` ularni o'z jadvallariga yoyadi (`hr-access.ts` kabi —
 * aylana importda jadval bo'sh qolib ketmasin). Mantiq — `./sotuv-extra.ts`.
 * Rollar veb bilan bir xil: `lib/nav.ts` (menyu), `lib/permissions.ts` (amal), sahifadagi `requireRoles`.
 */

/** Ro'yxatlar — veb menyusidagi «Sotuv» va «Marketing» bo'limlari. */
export const SOTUV_ACCESS: Record<string, { title: string; roles: Role[]; menuHide?: Role[] }> = {
  // Tijorat takliflari (`/takliflar`): buxgalteriya menyusida yo'q, lekin ruxsat bor (vebdagi `menuHide`)
  offers: { title: "Tijorat takliflari", roles: ["SALES", "ACCOUNTING"], menuHide: ["ACCOUNTING"] },
  // E-commerce vitrinasi (`/e-commerce`): ko'rinishi va do'kon narxi; bannerlar va shablonlar — vebda
  shop: { title: "E-commerce", roles: ["SALES"] },
  // Marketing (`/marketing/*`): kontent reja, target, statistika. AI studiya, media, sozlamalar — vebda
  smm: { title: "Kontent reja", roles: ["SALES"] },
  target: { title: "Target", roles: ["SALES"] },
  marketing: { title: "Marketing statistikasi", roles: ["SALES"] },
};

/** Ro'yxat/kartochka kaliti → veb modul (direktor modulni yopsa, ilovada ham yopiladi). */
export const SOTUV_KEY_MODULE: Record<string, string> = {
  offers: "offers", shop: "sales", smm: "marketing", target: "marketing", marketing: "marketing", boost: "marketing", mstat: "marketing",
  akt: "customers", csite: "customers",
};

/** Ro'yxat kaliti → kartochka kaliti. */
export const SOTUV_DETAIL_KEY: Record<string, string> = { target: "boost", marketing: "mstat" };

/** Kartochkalar — veb sahifa rollari. */
export const SOTUV_DETAIL_ROLES: Record<string, Role[]> = {
  offers: ["SALES", "ACCOUNTING"],
  shop: ["SALES"],
  // Akt sverki va obyekt — veb mijoz kartasi bilan bir xil (`requireRoles(["SALES","ACCOUNTING","FINANCE"])`)
  akt: ["SALES", "ACCOUNTING", "FINANCE"],
  csite: ["SALES", "ACCOUNTING", "FINANCE"],
  mstat: ["SALES"],
};

const STOCK: Role[] = [...STOCK_ORDER_ROLES, "DIRECTOR"];

/** Amallar — veb server action'idagi `requireAction(module, action)` rollari (direktor — har doim). */
export const SOTUV_ACTION_ROLES: Record<string, Role[]> = {
  // Kafolat xati va shartnoma (`orders` → `contract`)
  "order.guarantee": ["SALES", "ACCOUNTING", "DIRECTOR"],
  "order.contract": ["SALES", "ACCOUNTING", "DIRECTOR"],
  // Sklad (zaxira) zayavkasi: qabul qilish, bekor qilish, yopish (`orders` → `stock`)
  "order.confirm-stock": STOCK,
  "order.cancel-stock": STOCK,
  "order.close-stock": STOCK,
  // Mijoz kartasi (`customers` → edit / app_link / agent / sites). Limit maydoni — faqat buxgalteriya/moliya/direktor
  "customer.edit": ["SALES", "ACCOUNTING", "FINANCE", "DIRECTOR"],
  // Vebda «Ilova hisobi»ni ulash tugmasi faqat sotuv va direktorga (`app_link`)
  "customer.app": ["SALES", "DIRECTOR"],
  "customer.agent": ["SALES", "HR", "DIRECTOR"],
  // Mijoz obyekti — veb mijoz kartasidagi «Obyektlar» (`customers` → `sites`). Logistika obyekt kartasidagi
  // `site.save` (`logistika` → `sites`, `./logistika-extra.ts`) — boshqa veb amal, boshqa ruxsat
  "customer.site": ["SALES", "ACCOUNTING", "FINANCE", "DIRECTOR"],
  "site.delete": ["SALES", "ACCOUNTING", "FINANCE", "DIRECTOR"],
  // Tijorat taklifi (`offers` → `cancel`: bekor qilish va «qabul qilindi» belgisi)
  "offer.cancel": ["SALES", "DIRECTOR"],
  "offer.accept": ["SALES", "DIRECTOR"],
  // E-commerce (`sales` → `ecommerce`)
  "shop.toggle": ["SALES", "DIRECTOR"],
  "shop.price": ["SALES", "DIRECTOR"],
  // Kontent: tasdiqqa yuborish — sotuv (`content`); nashr — direktor (`publish`, explicit: boshqaga faqat aniq beriladi)
  "smm.submit": ["SALES"],
  "smm.publish": ["DIRECTOR"],
  // Target: so'rov — sotuv (`boost`); to'xtatish/davom ettirish — direktor (`boost_approve`, explicit)
  "boost.request": ["SALES"],
  "boost.toggle": ["DIRECTOR"],
  // Statistikani yangilash (`marketing` → `content`)
  "marketing.sync": ["SALES", "DIRECTOR"],
};

/** Mobil amal → veb katalog amali (`lib/permissions.ts`) — direktor bergan/yopgan ruxsat veb bilan bir xil ishlaydi. */
export const SOTUV_PERM_EXACT: Record<string, { module: string; action?: string }> = {
  "order.guarantee": { module: "orders", action: "contract" },
  "order.contract": { module: "orders", action: "contract" },
  "order.confirm-stock": { module: "orders", action: "stock" },
  "order.cancel-stock": { module: "orders", action: "stock" },
  "order.close-stock": { module: "orders", action: "stock" },
  "customer.edit": { module: "customers", action: "edit" },
  "customer.app": { module: "customers", action: "app_link" },
  "customer.agent": { module: "customers", action: "agent" },
  "customer.site": { module: "customers", action: "sites" },
  "site.delete": { module: "customers", action: "sites" },
  "offer.cancel": { module: "offers", action: "cancel" },
  "offer.accept": { module: "offers", action: "cancel" },
  "shop.toggle": { module: "sales", action: "ecommerce" },
  "shop.price": { module: "sales", action: "ecommerce" },
  "smm.submit": { module: "marketing", action: "content" },
  "smm.publish": { module: "marketing", action: "publish" },
  "boost.request": { module: "marketing", action: "boost" },
  "boost.toggle": { module: "marketing", action: "boost_approve" },
  "marketing.sync": { module: "marketing", action: "content" },
};

/** Yangi hujjat formalari. */
export const SOTUV_CREATE_ROLES: Record<string, { roles: Role[]; title: string; label: string }> = {
  // Sklad (zaxira) zayavkasi — veb `/orders/new?tur=sklad` (`requireRoles(STOCK_ORDER_ROLES, orders: create|stock)`)
  "stock-order": { roles: [...STOCK_ORDER_ROLES], title: "Sklad zayavkasi", label: "Sklad zayavkasi" },
  // Tijorat taklifi — veb `/takliflar/new` (`requireRoles(["SALES"], offers: create)`)
  offers: { roles: ["SALES"], title: "Yangi tijorat taklifi", label: "Tijorat taklifi" },
};
export const SOTUV_CREATE_PERM: Record<string, { module: string; action?: string; strict?: boolean }> = {
  "stock-order": { module: "orders", action: "stock" },
  offers: { module: "offers", action: "create" },
};
