import { redirect } from "next/navigation";
import { routeOf } from "./ui";
import { requirePage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";
export type { SP } from "./shell";

/** Eski ?tab= havolalarini yangi sahifalarga yo'naltiradi. */
const LEGACY: Record<string, string> = { sales: "sales", customers: "customers", products: "products", stock: "stock", operations: "operations", finance: "finance", forecast: "forecast" };

/** Umumiy BI ko'rinishi Bosh sahifaning «Tahlil» tabiga ko'chdi — eski havolalar (davr filtri bilan) o'sha yerga boradi. */
export default async function BiTahlil({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil");
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).filter((kv): kv is [string, string] => kv[0] !== "tab" && !!kv[1]));
  const legacy = sp.tab && LEGACY[sp.tab] ? routeOf(LEGACY[sp.tab]) : null;
  if (!legacy) q.set("view", "tahlil");
  redirect(`${legacy ?? "/dashboard"}${q.size ? `?${q}` : ""}`);
}
