import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { PaymentPlanView } from "./view";

/** To'lov rejasi — sozlamalar va kiritish (`./view.tsx`); to'lov kalendari shundan hisoblanadi. */
export default async function PaymentPlanPage() {
  const s = await requirePage("/moliya/tolov-rejasi");
  return (
    <div>
      <PageHeader eyebrow="Moliya" title="To'lov rejasi" subtitle="Sozlamalar (sariq kataklarni o'zingiz o'zgartirasiz) — to'lov kalendari shundan hisoblanadi" />
      <PaymentPlanView canWrite={canDo(s, "moliya", "plan")} />
    </div>
  );
}
