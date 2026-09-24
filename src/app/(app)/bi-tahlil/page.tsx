import { redirect } from "next/navigation";
import { biContext, BiPage } from "./shell";
import { routeOf } from "./ui";
import { OverviewTab } from "./tabs/overview";

export const dynamic = "force-dynamic";
export type { SP } from "./shell";

/** Eski ?tab= havolalarini yangi sahifalarga yo'naltiradi. */
const LEGACY: Record<string, string> = { sales: "sales", customers: "customers", products: "products", stock: "stock", operations: "operations", finance: "finance", forecast: "forecast" };

export default async function BiTahlil({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { s, sp, range } = await biContext(searchParams);
  if (sp.tab && LEGACY[sp.tab]) {
    const q = new URLSearchParams(Object.entries(sp).filter((kv): kv is [string, string] => kv[0] !== "tab" && !!kv[1]));
    redirect(`${routeOf(LEGACY[sp.tab])}${q.size ? `?${q}` : ""}`);
  }
  return (
    <BiPage title="Rahbar markazi" subtitle="Moliyaviy nazorat tizimi — bugun qancha pul yo'qotilyapti, qayerda xavf bor va nima qilish kerak. Barcha raqamlar joriy holatdan hisoblanadi." eyebrow="BI tahlil · Moliyaviy nazorat" tab="overview" range={range} period={false}>
      <OverviewTab range={range} name={s.fullName} />
    </BiPage>
  );
}
