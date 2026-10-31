/**
 * IT jamoasi rollari: har amal bitta minimal rolga beriladi. Yuqori rol pastkisining hammasini qila oladi.
 * Bu fayl brauzerda ham ishlatiladi (tugmalarni o'chirish uchun) — Prisma/Node moduli YO'Q.
 * Haqiqiy tekshiruv har doim serverda (requireRole / roleDenied, enqueueAction).
 */
export const ADMIN_ROLES = ["OWNER", "OPERATOR", "VIEWER"] as const;
export type AdminRoleT = (typeof ADMIN_ROLES)[number];

export const ROLE_LABEL: Record<AdminRoleT, string> = { OWNER: "Egasi", OPERATOR: "Navbatchi", VIEWER: "Kuzatuvchi" };
export const ROLE_DESCR: Record<AdminRoleT, string> = {
  OWNER: "Hammasi: korxona yaratish va to'xtatish, direktor paroli, deploy, reboot, IT jamoasini boshqarish",
  OPERATOR: "Hodisalar, xavfsiz server amallari (xizmatni qayta ishga tushirish, zaxira, tekshiruvlar), loglar, korxonaga SSO",
  VIEWER: "Faqat ko'radi: monitoring, hodisalar, jurnal. Hech qanday amal bajarmaydi",
};

const RANK: Record<AdminRoleT, number> = { VIEWER: 0, OPERATOR: 1, OWNER: 2 };
export const isAdminRole = (v: unknown): v is AdminRoleT => typeof v === "string" && (ADMIN_ROLES as readonly string[]).includes(v);
export const roleAllows = (role: AdminRoleT, min: AdminRoleT) => RANK[role] >= RANK[min];

/** Rad javobi (o'zbekcha) yoki null. */
export const roleDeniedText = (role: AdminRoleT, min: AdminRoleT): string | null =>
  roleAllows(role, min) ? null : `Ruxsat yo'q: bu amal «${ROLE_LABEL[min]}» roli uchun (sizniki — «${ROLE_LABEL[role]}»)`;

/**
 * Agent amallari: serverni to'xtatadigan, kod almashtiradigan, tarmoqni to'sadigan yoki sirlarga tegadigan amallar — faqat OWNER.
 * Qolganlari (o'qish, tekshiruv, zaxira, bitta xizmatni qayta ishga tushirish, so'rovni bekor qilish) — OPERATOR.
 */
const OWNER_ACTIONS: readonly string[] = [
  "DEPLOY", "ROLLBACK", "REBOOT", "REBOOT_CANCEL", "TENANT_UP", "CLEAN_RELEASES", "JOURNAL_VACUUM", "RUN_RESTORE_TEST",
  "PG_TERMINATE", "BLOCK_IP", "UNBLOCK_IP", "RENEW_CERT", "FIX_SECRET_PERMS",
];
export const actionMinRole = (type: string): AdminRoleT => (OWNER_ACTIONS.includes(type) ? "OWNER" : "OPERATOR");
