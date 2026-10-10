import { getSession } from "@/lib/auth";
import { pathAllowed } from "@/lib/nav";
import { Tabs } from "@/components/ui";

/**
 * Bir vazifadagi sahifalar — menyuda bitta band (`lib/nav.ts` → `menuFor`), qolganlari shu tablar orqali ochiladi.
 * Tab faqat foydalanuvchiga ruxsat bor sahifa uchun chiqadi; bittadan kam qolsa umuman ko'rinmaydi.
 */
export const SECTION_TABS = {
  reyslar: [
    { href: "/trips", label: "Reyslar" },
    { href: "/logistika/nakladnoylar", label: "Nakladnoylar" },
    { href: "/logistika/yetkazish", label: "Yetkazib berish" },
  ],
  transport: [
    { href: "/logistika/transport", label: "Transport" },
    { href: "/logistika/yoqilgi", label: "Yoqilg'i" },
    { href: "/logistika/xarajatlar", label: "Xarajatlar" },
  ],
  hisobot: [
    { href: "/logistika/hisobotlar", label: "Hisobotlar" },
    { href: "/logistika/analitika", label: "Analitika" },
  ],
  haydovchi: [
    { href: "/logistika/haydovchilar", label: "Haydovchilar" },
    { href: "/drivers", label: "Haydovchi ilovasi (ECO)" },
  ],
} as const;

export async function SectionTabs({ section, current }: { section: keyof typeof SECTION_TABS; current: string }) {
  const s = await getSession();
  if (!s) return null;
  const items = SECTION_TABS[section].filter((t) => pathAllowed(t.href, s.role, s.perms));
  if (items.length < 2) return null;
  return <Tabs current={current} items={items.map((t) => ({ key: t.href, label: t.label, href: t.href }))} />;
}
