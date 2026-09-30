import { biContext, BiPage } from "../shell";
import { ProductsTab } from "../tabs/products";
import { requirePage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mahsulotlar");
  const { range } = await biContext(searchParams);
  return (
    <BiPage title="Mahsulotlar" subtitle="ABC × XYZ matritsa, foydalilik, klasterlar, Pareto 80/20 va mahsulotlar ro'yxati." tab="products" range={range}>
      <ProductsTab range={range} />
    </BiPage>
  );
}
