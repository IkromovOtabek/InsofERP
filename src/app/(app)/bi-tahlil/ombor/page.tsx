import { biContext, BiPage } from "../shell";
import { StockTab } from "../tabs/stock";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Ombor" subtitle="Harakat qatlami: ogohlantirish, buyurtma navbati, prognoz. Xomashyo qiymati, aylanma, stockout va dead stock." tab="stock" range={range}>
      <StockTab range={range} sp={sp} />
    </BiPage>
  );
}
