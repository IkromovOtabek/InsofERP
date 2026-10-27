import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { biContext, BiPage, type SP } from "../../shell";
import { PaymentPlanView } from "@/app/(app)/moliya/tolov-rejasi/view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("/bi-tahlil/moliya/tolov-rejasi");
  const { s, range } = await biContext(searchParams);
  return (
    <BiPage title="Moliya" subtitle="To'lov rejasi — sozlamalar (sariq kataklarni o'zingiz o'zgartirasiz), to'lov kalendari shundan hisoblanadi" tab="finance" range={range} period={false}>
      <PaymentPlanView canWrite={canDo(s, "moliya", "plan")} />
    </BiPage>
  );
}
