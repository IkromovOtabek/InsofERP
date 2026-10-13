import type { Role } from "@/generated/prisma";
import type { Perms } from "./auth";
import { canDo } from "./permissions";

/**
 * Sklad → «Приход» / «Расход» jurnallarini kim ko'radi (veb sahifa, Sklad sarlavhasidagi tugmalar).
 * Jurnalda xarid narxlari, yetkazuvchilar, QQS va summalar bor — /stock ni ko'radigan hamma rolga emas
 * (MECHANIC, LOGISTICS, SALES ga ochilmaydi; /receipts va /kirim-qqs ham cheklangan). Mobil ro'yxatlar —
 * WAREHOUSE / PROCUREMENT (+ direktor). Direktor bergan ruxsat (`stock` modulida kiritish amali) ham ochadi.
 * `perms.stock === "none"` bo'lsa sahifa umuman ochilmaydi (`requirePage("/stock")` buni oldinroq ushlaydi).
 */
export const PRIXOD_VIEW_ROLES: readonly Role[] = ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"];
/** Расход: zames sarfi ham shu jurnalda — ishlab chiqarish ham ko'radi. */
export const RASXOD_VIEW_ROLES: readonly Role[] = ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "PRODUCTION"];

type Who = { role: Role; perms?: Perms };

const open = (s: Who, roles: readonly Role[], action: string) =>
  s.role === "DIRECTOR" || (s.perms?.stock !== "none" && (roles.includes(s.role) || canDo(s, "stock", action)));

export const canSeePrixod = (s: Who) => open(s, PRIXOD_VIEW_ROLES, "receipt");
export const canSeeRasxod = (s: Who) => open(s, RASXOD_VIEW_ROLES, "issue");
