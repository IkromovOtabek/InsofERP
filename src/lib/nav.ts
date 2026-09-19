import type { Role } from "@/generated/prisma";

export type NavChild = { href: string; label: string };
export type NavItem = { href: string; label: string; roles: Role[] | "all"; group: string; children?: NavChild[] };

const BI_ROLES: Role[] = ["DIRECTOR", "FINANCE", "ACCOUNTING"];

export const NAV: NavItem[] = [
  { href: "/dashboard",   label: "Bosh sahifa",        roles: "all", group: "Asosiy" },
  { href: "/orders",      label: "Zayavkalar",         roles: ["SALES", "PRODUCTION", "LOGISTICS", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/sales",       label: "Sotuv",              roles: ["SALES", "PRODUCTION", "LOGISTICS", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/customers",   label: "Mijozlar",           roles: ["SALES", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/production",  label: "Ishlab chiqarish",   roles: ["PRODUCTION"], group: "Ishlab chiqarish" },
  { href: "/recipes",     label: "Retseptlar",         roles: ["PRODUCTION"], group: "Ishlab chiqarish" },
  { href: "/tasks",       label: "Topshiriqlar",       roles: ["PRODUCTION", "SALES", "LOGISTICS"], group: "Ishlab chiqarish" },
  { href: "/brigades",    label: "Brigadalar",         roles: ["PRODUCTION", "HR", "SALES"], group: "Ishlab chiqarish" },
  { href: "/trips",       label: "Reyslar / nakladnoy", roles: ["LOGISTICS", "PRODUCTION"], group: "Logistika" },
  { href: "/stock",       label: "Sklad",              roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES"], group: "Sklad" },
  { href: "/astatka",     label: "Astatka",            roles: ["WAREHOUSE", "PRODUCTION", "SALES", "LOGISTICS", "ACCOUNTING"], group: "Sklad" },
  { href: "/receipts",    label: "Kirim (snabjeniye)", roles: ["PROCUREMENT", "WAREHOUSE", "SALES"], group: "Sklad" }, // SALES — faqat ko'radi (kim, nima, qancha kiritgan)
  { href: "/suppliers",   label: "Yetkazuvchilar",     roles: ["PROCUREMENT", "ACCOUNTING"], group: "Sklad" },
  { href: "/invoices",    label: "Schyotlar",          roles: ["ACCOUNTING", "FINANCE", "SALES"], group: "Sotuv" },
  { href: "/payments",    label: "Kassa / bank",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  { href: "/cashflow",    label: "Kirim-Chiqim",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  { href: "/employees",   label: "Xodimlar",           roles: ["HR", "LOGISTICS"], group: "Boshqaruv" },
  { href: "/vehicles",    label: "Texnika",            roles: ["LOGISTICS"], group: "Logistika" },
  { href: "/drivers",     label: "Haydovchilar (ECO)", roles: ["LOGISTICS", "HR"], group: "Logistika" },
  // ── Tahlil (Team24 BI tuzilmasi) ──
  { href: "/bi-tahlil",                  label: "BI tahlil",        roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/sotuvlar",         label: "Sotuvlar",         roles: BI_ROLES, group: "Tahlil", children: [{ href: "/bi-tahlil/sotuvlar/bekor", label: "Bekor qilinganlar" }] },
  { href: "/bi-tahlil/agentlar",         label: "Agentlar",         roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/mijozlar",         label: "Mijozlar",         roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/ombor",            label: "Ombor",            roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/mahsulotlar",      label: "Mahsulotlar",      roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/ishlab-chiqarish", label: "Ishlab chiqarish", roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/marketing",        label: "Marketing",        roles: BI_ROLES, group: "Tahlil", children: [{ href: "/bi-tahlil/marketing/reja", label: "Marketing reja nazorati" }, { href: "/bi-tahlil/marketing/malumotlar", label: "Marketing ma'lumotlari" }] },
  { href: "/bi-tahlil/reja",             label: "Reja nazorati",    roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/moliya",           label: "Moliya",           roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/ml",               label: "ML tahlil",        roles: BI_ROLES, group: "Tahlil", children: [{ href: "/bi-tahlil/ml/anomaliyalar", label: "Anomaliyalar" }, { href: "/bi-tahlil/ml/churn", label: "Churn tahlili" }, { href: "/bi-tahlil/ml/klasterlar", label: "Klasterlar" }] },
  { href: "/bi-tahlil/ai",               label: "Insof AI",         roles: BI_ROLES, group: "Tahlil", children: [{ href: "/bi-tahlil/ai/chat", label: "AI Chat" }, { href: "/bi-tahlil/ai/telegram", label: "Telegram bot" }] },
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
