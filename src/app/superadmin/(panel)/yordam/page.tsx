import { requireAdmin } from "@/lib/control/auth";
import { PageHeader } from "@/components/ui";
import { HelpGlossary } from "./view";

export const metadata = { title: "Yordam" };

/** Yordam: panel bo'yicha barcha tushuntirishlar (lib/control/help-content.ts) — qidiruv bilan, bo'limlarga ajratilgan. */
export default async function HelpPage() {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  return (
    <div className="space-y-4">
      <PageHeader title="Yordam" subtitle="Paneldagi har bo'lim, ko'rsatkich, tugma va ogohlantirish oddiy tilda. Sahifalardagi «?» belgisi ham shu matnlarni ko'rsatadi." />
      <HelpGlossary />
    </div>
  );
}
