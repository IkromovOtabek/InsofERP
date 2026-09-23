import type { Role } from "@/generated/prisma";

export type NavChild = { href: string; label: string };
/** `hidden` — menyuda ko'rinmaydi, lekin middleware ruxsatni shu yerdan tekshiradi (havola bo'yicha ochiladi). */
export type NavItem = { href: string; label: string; roles: Role[] | "all"; group: string; children?: NavChild[]; hidden?: boolean };

const BI_ROLES: Role[] = ["DIRECTOR", "FINANCE", "ACCOUNTING"];

export const NAV: NavItem[] = [
  { href: "/dashboard",   label: "Bosh sahifa",        roles: "all", group: "Asosiy" },
  { href: "/orders",      label: "Zayavkalar",         roles: ["SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/sales",       label: "Sotuv",              roles: ["SALES", "PRODUCTION", "LOGISTICS", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/customers",   label: "Mijozlar",           roles: ["SALES", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  // Saytdagi (`/`) formadan tushgan so'rovlar — mijozga aylantirilgandan keyingina Customer yaratiladi
  { href: "/leads",       label: "Sayt arizalari",     roles: ["SALES"], group: "Sotuv" },
  { href: "/production",  label: "Ishlab chiqarish",   roles: ["PRODUCTION", "SUPERVISOR"], group: "Ishlab chiqarish" },
  { href: "/recipes",     label: "Retseptlar",         roles: ["PRODUCTION"], group: "Ishlab chiqarish" },
  { href: "/tasks",       label: "Topshiriqlar",       roles: ["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS"], group: "Ishlab chiqarish" },
  { href: "/brigades",    label: "Brigadalar",         roles: ["SUPERVISOR", "PRODUCTION", "HR", "SALES"], group: "Ishlab chiqarish" },
  { href: "/trips",       label: "Reyslar / nakladnoy", roles: ["LOGISTICS", "PRODUCTION", "SUPERVISOR"], group: "Logistika" },
  // Sklad: xomashyo qoldig'i + "Ishlab chiqarish imkoni" ichida hovlidagi dona mahsulot va tayyor beton (eski Astatka shu yerga ko'chdi)
  { href: "/stock",       label: "Sklad",              roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES", "LOGISTICS"], group: "Sklad" },
  // Snabjeniye oynasi — Sklad bandining ostida: sklad so'roviga narx qo'yiladi, kelgan mol qabul qilinadi
  { href: "/snabjeniye",  label: "Snabjeniye",         roles: ["WAREHOUSE", "PROCUREMENT"], group: "Sklad" },
  // Ta'minot zayavkalari — ma'sul (zayavka) xodim tasdiqlaydi; zanjirdagi boshqa bo'limlar holatini ko'radi
  { href: "/taminot",     label: "Ta'minot zayavkalari", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"], group: "Sklad" },
  // Hujjatning o'zi zanjirdagi hamma bo'limga ochiq (Zayavkalar va Kirim-Chiqimdagi "To'liq hujjat" havolasi)
  { href: "/taminot/",    label: "Ta'minot hujjati",     roles: ["SALES", "WAREHOUSE", "PROCUREMENT", "PRODUCTION", "FINANCE", "ACCOUNTING", "CASHIER"], group: "Sklad", hidden: true },
  { href: "/receipts",    label: "Kirim",              roles: ["WAREHOUSE", "PROCUREMENT", "SALES"], group: "Sklad" }, // SALES — faqat ko'radi (kim, nima, qancha kiritgan)
  { href: "/suppliers",   label: "Yetkazuvchilar",     roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"], group: "Sklad" },
  // Schyotlar menyudan olib tashlandi — sahifa va eski schyotlar joyida (to'lovlar shularga bog'langan)
  { href: "/invoices",    label: "Schyotlar",          roles: ["ACCOUNTING", "FINANCE", "SALES"], group: "Sotuv", hidden: true },
  { href: "/payments",    label: "Kassa / bank",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  { href: "/cashflow",    label: "Kirim-Chiqim",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  // Otdel kadr bo'limi: sahifaning tablari bevosita menyuda turadi — ichida yana "Otdel kadr" bandi bo'lmaydi.
  // Birinchisi sahifaning o'zi (`?tab` siz ochilganda xodimlar ro'yxati chiqadi) — middleware ruxsatni shu yo'ldan tekshiradi.
  { href: "/otdel-kadr",                label: "Xodimlar ro'yxati", roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=lavozimlar", label: "Ishchi lavozimlar", roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=bolimlar",   label: "Bo'limlar",         roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=taqvim",     label: "Kadr taqvimi",      roles: ["HR"], group: "Otdel kadr" },
  { href: "/employees",   label: "Xodimlar",           roles: ["HR", "LOGISTICS"], group: "Boshqaruv" },
  // Haydovchi ERP'ga kirsa faqat shu sahifani ko'radi — o'zining reyslari (qolgan bo'limlar yopiq)
  { href: "/mening-reyslarim", label: "Mening reyslarim", roles: ["DRIVER"], group: "Logistika" },
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
  SUPERVISOR: "Ish boshqaruvchi",
  LOGISTICS: "Logistika",
  WAREHOUSE: "Sklad",
  PROCUREMENT: "Snabjeniye (eski — Sklad bilan qo'shildi)",
  ACCOUNTING: "Buxgalteriya",
  FINANCE: "Finance (eski bo'lim)",
  HR: "Otdel kadr",
  CASHIER: "Kassa / bank",
  DRIVER: "Haydovchi",
};

export function navFor(role: Role) {
  const items = NAV.filter(
    (i) => !i.hidden && (i.roles === "all" || role === "DIRECTOR" || i.roles.includes(role)),
  );
  // Haydovchi vebda faqat o'z reyslarini ko'radi — umumiy bandlar (Bosh sahifa) menyuda turmaydi
  return role === "DRIVER" ? items.filter((i) => i.roles !== "all") : items;
}
