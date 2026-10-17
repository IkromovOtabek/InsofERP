import type { Role } from "@/generated/prisma";

/**
 * Sklad / snabjeniye kabinetining qo'shimcha ro'yxat, kartochka, amal va formalari (veb → mobil parity) — ruxsat jadvallari.
 * Alohida fayl: `list.ts`, `detail.ts`, `create.ts` ularni modul yuklanishida yoyadi (`...SKLAD_ACCESS`) — bu faylda registry
 * fayllardan import yo'q, aylanma import bo'lmasin. Mantiq — `./sklad-extra.ts`.
 * Rollar veb bilan bir xil: `lib/nav.ts` (sahifa) va `lib/permissions.ts` (`stock` amallari).
 */

/** Veb `/stock` sahifasi (Qoldiqlar, «Ishlab chiqarish imkoni», tayyor mahsulot) — `lib/nav.ts` dagi rollar. */
const STOCK_PAGE: Role[] = ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES", "LOGISTICS", "MECHANIC"];

/** Ro'yxatlar (`list.ts` ACCESS). Logistikada vebdagidek menyuda yo'q (`menuHide`), ruxsat qoladi. */
export const SKLAD_ACCESS: Record<string, { title: string; roles: Role[]; menuHide?: Role[] }> = {
  // Hovlidagi tayyor (dona) mahsulot: jami / band / erkin — veb Sklad → «Ishlab chiqarish imkoni» (`lib/ostatka.ts`)
  products: { title: "Tayyor mahsulot", roles: STOCK_PAGE, menuHide: ["LOGISTICS"] },
  // Xomashyo qoldig'i bilan har mahsulotdan qancha chiqadi (`lib/production-capacity.ts`)
  capacity: { title: "Ishlab chiqarish imkoni", roles: STOCK_PAGE, menuHide: ["LOGISTICS"] },
  // Brigadalar qo'lidagi xomashyo (veb Sklad → «Brigadalarga berish», `stock` → `brigade` amali bor rollar).
  // SUPERVISOR vebda /stock ni ochmaydi, lekin `brigade` amali unga berilgan va brigada kartasini (/oluvchi) ko'radi
  "brig-stock": { title: "Brigadalar skladi", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR"] },
  // «Kimga» ro'yxati (erkin oluvchilar) — veb Sklad → Chiqim → Oluvchilar (`stock` → `issue`)
  recipients: { title: "Oluvchilar (Kimga)", roles: ["WAREHOUSE", "PROCUREMENT"] },
};

/**
 * Ro'yxat/kartochka → veb modul (`moduleClosed`). `brig-stock` bu yerda YO'Q: shu kalitli kartochka brigadirning
 * «Mening skladim»i ham — modul yopilishi uni yopmasin; ro'yxat o'zi `stock` ni tekshiradi (`sklad-extra.ts`).
 */
export const SKLAD_KEY_MODULE: Record<string, string> = {
  products: "stock", capacity: "stock", recipients: "stock", oluvchi: "stock", "supply-doc": "taminot",
};

/** Kartochkalar (`detail.ts` DETAIL_ROLES). */
export const SKLAD_DETAIL_ROLES: Record<string, Role[]> = {
  products: STOCK_PAGE,
  capacity: STOCK_PAGE,
  // Oluvchi kartasi (brigada / xodim / erkin oluvchi) — veb `/oluvchi` (`lib/nav.ts`)
  oluvchi: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR", "ACCOUNTING"],
  // Ta'minot hujjati (shartnoma, faktura…) — veb `/taminot/` (hujjatning o'zi zanjirdagi hammaga)
  "supply-doc": ["SALES", "WAREHOUSE", "PROCUREMENT", "PRODUCTION", "FINANCE", "ACCOUNTING", "CASHIER"],
};

/** Shu fayldagi kartochkalar — `mobileDetail` ularni `skladDetail` ga yuboradi. */
export const SKLAD_CARDS: ReadonlySet<string> = new Set(["products", "capacity", "oluvchi", "supply-doc"]);
/** Shu fayldagi ro'yxatlar — `mobileList` ularni `skladList` ga yuboradi. */
export const SKLAD_LISTS: ReadonlySet<string> = new Set(Object.keys(SKLAD_ACCESS));

/**
 * Amallar (`detail.ts` ACTION_ROLES) — vebdagi `requireAction(...)` / `requireModuleWrite(...)` rollari.
 * Direktor faqat yozilgan amalda (storno, narx, o'chirish — vebda ham asosan uning qarori).
 */
export const SKLAD_ACTION_ROLES: Record<string, Role[]> = {
  // Storno — `stock` → `receipt_storno` / `issue_storno`: rol bo'yicha hech kim, faqat direktor va u ruxsat bergan xodim
  "receipt.storno": ["DIRECTOR"],
  "rasxod.storno": ["DIRECTOR"],
  // Brigadaga berish / brigadadan qaytarish — `stock` → `brigade`
  "brigade.issue": ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR"],
  "brig.return": ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR"],
  // «Kimga» oluvchisi: nomi/izohi va faol/nofaol — `stock` → `issue`
  "recipient.edit": ["WAREHOUSE", "PROCUREMENT"],
  "recipient.toggle": ["WAREHOUSE", "PROCUREMENT"],
  // «Dona narxi»: olib tashlash va narxsizlarga o'rtacha tannarx — `stock` → `price`
  "material.price.clear": ["PROCUREMENT", "DIRECTOR"],
  "material.price.fill": ["PROCUREMENT", "DIRECTOR"],
  // Xomashyoni o'chirish (ishlatilgan bo'lsa — arxiv) — `requireModuleWrite("stock", MATERIAL_CATALOG_ROLES)`
  "material.delete": ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "DIRECTOR"],
  // Yetkazuvchi rekvizitlari — `stock` → `suppliers` (veb kartasida direktor ham tahrirlaydi)
  "supplier.edit": ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "DIRECTOR"],
  // Ta'minot: taklifni o'chirish (snabjeniye), hujjatni o'chirish (qabul qilinganini faqat direktor — `canRemoveSupplyDoc`)
  "supply.quote.drop": ["PROCUREMENT", "WAREHOUSE"],
  "supply.doc.drop": ["PROCUREMENT", "WAREHOUSE", "ACCOUNTING", "FINANCE", "DIRECTOR"],
};

/** Amal → veb ruxsat (`detail.ts` PERM_EXACT). `supply.*` — umumiy `taminot` prefiksi bilan. */
export const SKLAD_PERM_EXACT: Record<string, { module: string; action?: string }> = {
  "receipt.storno": { module: "stock", action: "receipt_storno" },
  "rasxod.storno": { module: "stock", action: "issue_storno" },
  "brigade.issue": { module: "stock", action: "brigade" },
  "brig.return": { module: "stock", action: "brigade" },
  "recipient.edit": { module: "stock", action: "issue" },
  "recipient.toggle": { module: "stock", action: "issue" },
  "material.price.clear": { module: "stock", action: "price" },
  "material.price.fill": { module: "stock", action: "price" },
  "material.delete": { module: "stock" },
  "supplier.edit": { module: "stock", action: "suppliers" },
};

/** Shu fayldagi amallar — `runMobileAction` ularni `runSkladAction` ga yuboradi. */
export const SKLAD_ACTIONS: ReadonlySet<string> = new Set(Object.keys(SKLAD_ACTION_ROLES));

/** Yangi hujjat formalari (`create.ts` CREATE_ROLES) — veb sahifa rollari. */
export const SKLAD_CREATE_ROLES: Record<string, { roles: Role[]; title: string; label: string }> = {
  // Veb `/stock/products/new` — `requireRoles(["WAREHOUSE", "PRODUCTION"], stock → products)`
  products: { roles: ["WAREHOUSE", "PRODUCTION"], title: "Tayyor mahsulot qo'shish", label: "Tayyor mahsulot qo'shish" },
  // Veb `/stock/inventarizatsiya`, `/stock/spisanie` — `requireRoles(["WAREHOUSE"], stock → adjust)`
  inventory: { roles: ["WAREHOUSE"], title: "Inventarizatsiya", label: "Inventarizatsiya" },
  writeoff: { roles: ["WAREHOUSE"], title: "Hisobdan chiqarish", label: "Hisobdan chiqarish" },
  // «Kimga» ro'yxatiga yangi oluvchi — `stock` → `issue`
  recipient: { roles: ["WAREHOUSE", "PROCUREMENT"], title: "Yangi oluvchi (Kimga)", label: "Oluvchi qo'shish" },
};

/** Forma → veb ruxsat (`create.ts` CREATE_PERM, `strict` — `requireAction` bilan aynan bir xil). */
export const SKLAD_CREATE_PERM: Record<string, { module: string; action?: string; strict?: boolean }> = {
  products: { module: "stock", action: "products", strict: true },
  inventory: { module: "stock", action: "adjust", strict: true },
  writeoff: { module: "stock", action: "adjust", strict: true },
  recipient: { module: "stock", action: "issue", strict: true },
};

export const SKLAD_FORMS: ReadonlySet<string> = new Set(Object.keys(SKLAD_CREATE_ROLES));

/** Ro'yxat → kartochka (`list.ts` DETAIL_KEY): «Oluvchilar» qatori — oluvchi kartasi (`r~<id>`). */
export const SKLAD_DETAIL_KEY: Record<string, string> = { recipients: "oluvchi" };
