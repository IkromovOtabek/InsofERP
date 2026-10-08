import { PageHeader } from "@/components/ui";
import { HelpGlossary } from "./view";

export const metadata = { title: "Yordam" };

/** Yordam: panel bo'yicha barcha tushuntirishlar (lib/control/help-content.ts) — qidiruv bilan, bo'limlarga ajratilgan. */
export default function HelpPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Yordam" subtitle="Paneldagi har bo'lim, ko'rsatkich, tugma va ogohlantirish oddiy tilda. Sahifalardagi «?» belgisi ham shu matnlarni ko'rsatadi." />
      <HelpGlossary />
    </div>
  );
}
