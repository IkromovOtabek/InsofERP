import Link from "next/link";
import { ClipboardList, Clock, PackageCheck, ShoppingCart, Truck } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { supplyList, supplyTab, supplyCounts, SUPPLY_TABS, plannedSum } from "@/lib/supply";
import { money } from "@/lib/format";
import { Callout, PageHeader, StatCard, Tabs } from "@/components/ui";
import { SupplyTable } from "../taminot/supply-table";

/**
 * Snabjeniye oynasi: skladdan kelgan so'rovlarga narx qo'yiladi, tasdiqdan o'tganlari
 * sotib olinadi va kelgan mol tekshirilib qabul qilinadi (shundan keyin sklad kirimi bo'ladi).
 */
export default async function SnabjeniyePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireSession(["PROCUREMENT", "WAREHOUSE"]);
  const { tab } = await searchParams;
  const t = supplyTab(tab);
  const [rows, counts] = await Promise.all([supplyList(t.status), supplyCounts()]);
  const funded = await supplyList(["FUNDED"], 5);

  return (
    <div>
      <PageHeader title="Snabjeniye" subtitle="Skladdan kelgan kerakli mahsulotlar jadvaliga narx qo'yasiz, tasdiqdan o'tganini sotib olasiz va kelgan molni tekshirib qabul qilasiz." />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Narx kutmoqda" value={`${counts.NEW} ta`} hint="Skladdan kelgan yangi so'rov" icon={ClipboardList} tone={counts.NEW ? "warning" : "default"} href="/snabjeniye?tab=NEW" />
        <StatCard label="Tasdiq kutmoqda" value={`${counts.PRICED} ta`} icon={Clock} tone="default" href="/snabjeniye?tab=PRICED" />
        <StatCard label="Moliya kutmoqda" value={`${counts.APPROVED} ta`} icon={Clock} tone={counts.APPROVED ? "warning" : "default"} href="/snabjeniye?tab=APPROVED" />
        <StatCard label="Tasdiqdan o'tdi" value={`${counts.FUNDED} ta`} hint="Sotib olib, qabul qilasiz" icon={PackageCheck} tone={counts.FUNDED ? "success" : "default"} href="/snabjeniye?tab=FUNDED" />
      </div>

      {funded.length > 0 && (
        <Callout tone="success" title="Tasdiqdan o'tdi — sotib olish va qabul qilish mumkin">
          {funded.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2">
              <Link href={`/taminot/${r.id}`} className="font-medium underline">{r.docNo}</Link>
              <span>· {r.items.length} qator · {money(plannedSum(r.items))}{r.supplier ? ` · ${r.supplier.name}` : ""}</span>
            </div>
          ))}
        </Callout>
      )}

      <Tabs current={t.key} items={SUPPLY_TABS.map((x) => ({
        key: x.key, label: x.label, href: `/snabjeniye?tab=${x.key}`, icon: x.key === "FUNDED" ? Truck : x.key === "NEW" ? ShoppingCart : undefined,
        count: x.key === "open" ? counts.NEW + counts.PRICED + counts.APPROVED + counts.FUNDED : counts[x.status[0]],
      }))} />
      <SupplyTable rows={rows} empty={`"${t.label}" bo'yicha zayavka yo'q`} />
    </div>
  );
}
