import { biContext, BiPage } from "../shell";
import { CustomersTab } from "../tabs/customers";
import { requirePage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mijozlar");
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Mijozlar" subtitle="Kim ketyapti, kimni qaytarish mumkin va nima qilish kerak — RFM segmentlar, Next Best Action, LTV, qarz aging." tab="customers" range={range}>
      <CustomersTab range={range} sp={sp} />
    </BiPage>
  );
}
