import type { Role } from "@/generated/prisma";

export type NavItem = { href: string; label: string; roles: Role[] | "all"; group: string };

export const NAV: NavItem[] = [
  { href: "/dashboard",   label: "Bosh sahifa",        roles: "all", group: "Asosiy" },
  { href: "/orders",      label: "Zayavkalar",         roles: ["SALES", "PRODUCTION", "LOGISTICS", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/customers",   label: "Mijozlar",           roles: ["SALES", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/production",  label: "Ishlab chiqarish",   roles: ["PRODUCTION"], group: "Ishlab chiqarish" },
  { href: "/recipes",     label: "Retseptlar",         roles: ["PRODUCTION"], group: "Ishlab chiqarish" },
  { href: "/trips",       label: "Reyslar / nakladnoy", roles: ["LOGISTICS", "PRODUCTION"], group: "Logistika" },
  { href: "/stock",       label: "Sklad",              roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING"], group: "Sklad" },
  { href: "/astatka",     label: "Astatka",            roles: ["WAREHOUSE", "PRODUCTION", "SALES", "LOGISTICS", "ACCOUNTING"], group: "Sklad" },
  { href: "/receipts",    label: "Kirim (snabjeniye)", roles: ["PROCUREMENT", "WAREHOUSE"], group: "Sklad" },
  { href: "/suppliers",   label: "Yetkazuvchilar",     roles: ["PROCUREMENT", "ACCOUNTING"], group: "Sklad" },
  { href: "/invoices",    label: "Schyotlar",          roles: ["ACCOUNTING", "FINANCE", "SALES"], group: "Sotuv" },
  { href: "/payments",    label: "Kassa / bank",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  { href: "/employees",   label: "Xodimlar",           roles: ["HR", "LOGISTICS"], group: "Boshqaruv" },
  { href: "/vehicles",    label: "Texnika",            roles: ["LOGISTICS"], group: "Logistika" },
  { href: "/settings",    label: "Sozlamalar",         roles: ["DIRECTOR"], group: "Boshqaruv" },
];

export const ROLE_LABELS: Record<Role, string> = {
  DIRECTOR: "Direktor",
  SALES: "Sotuv",
  PRODUCTION: "Ishlab chiqarish",
  LOGISTICS: "Logistika",
  WAREHOUSE: "Sklad",
  PROCUREMENT: "Snabjeniye",
  ACCOUNTING: "Buxgalteriya",
  FINANCE: "Finance",
  HR: "Otdel kadr",
  CASHIER: "Kassa / bank",
};

export function navFor(role: Role) {
  return NAV.filter(
    (i) => i.roles === "all" || role === "DIRECTOR" || i.roles.includes(role),
  );
}
