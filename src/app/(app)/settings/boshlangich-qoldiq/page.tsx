import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { KIND_LABEL } from "@/lib/opening-balances";
import { PageHeader, Tabs } from "@/components/ui";
import { OPENING_ICON, OpeningSection } from "./section";
import type { OpeningKind } from "@/generated/prisma";

/**
 * Sozlamalar → Boshlang'ich qoldiqlar: real korxonani tizimga o'tkazish sanasidagi holat.
 * Mijozlar qarzi/avansi, yetkazuvchilarga qarz, kassa/bank qoldiqlari va tayyor mahsulot qoldig'i —
 * qo'lda yoki Excel'dan. Kiritish, tahrir, kamaytirish va o'chirish — direktor va buxgalteriya (yoki «opening» ruxsati berilgan xodim).
 * Bo'limning o'zi `section.tsx` da (Tahlil → debitorka sahifalaridagi «Qarzlarni kiritish» ham shuni ishlatadi).
 * Qanday hisobotlarga tushishi — `lib/opening-balances.ts` boshidagi izohda.
 */
const KINDS: OpeningKind[] = ["CUSTOMER", "SUPPLIER", "CASH", "STOCK"];

export default async function OpeningBalancesPage({ searchParams }: { searchParams: Promise<{ tab?: string; bekor?: string; q?: string }> }) {
  // Yo'l ruxsati (rol + direktor bergan "opening" modul ruxsati): "yopiq" qilingan buxgalter ham kira olmaydi
  const s = await requirePage("/settings/boshlangich-qoldiq");
  const sp = await searchParams;
  const kind: OpeningKind = KINDS.includes(sp.tab as OpeningKind) ? (sp.tab as OpeningKind) : "CUSTOMER";
  const counts = await db.openingBalance.groupBy({ by: ["kind"], where: { cancelledAt: null }, _count: true });
  const countOf = (k: OpeningKind) => counts.find((c) => c.kind === k)?._count ?? 0;

  return (
    <div>
      <PageHeader
        title="Boshlang'ich qoldiqlar"
        info="Tizimga o'tish sanasidagi holat: mijozlar va yetkazuvchilar bilan hisob-kitob, kassa/bank va tayyor mahsulot qoldig'i. Kiritish, tahrir va o'chirish — direktor va buxgalteriya (har o'zgarish auditda)."
      />
      <Tabs current={kind} className="mb-4" items={KINDS.map((k) => ({ key: k, label: KIND_LABEL[k], href: `/settings/boshlangich-qoldiq?tab=${k}`, icon: OPENING_ICON[k], count: countOf(k) || undefined }))} />
      <OpeningSection kind={kind} s={s} base="/settings/boshlangich-qoldiq" keep={{ tab: kind }} showCancelled={sp.bekor === "1"} q={sp.q} />
    </div>
  );
}
