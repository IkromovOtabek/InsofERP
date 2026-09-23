import { ClipboardCheck, Clock, CircleDollarSign, PackageCheck, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { supplyList, supplyTab, supplyCounts, SUPPLY_TABS, plannedSum } from "@/lib/supply";
import { money } from "@/lib/format";
import { LinkButton, PageHeader, StatCard, Tabs } from "@/components/ui";
import { SupplyTable } from "./supply-table";

/**
 * Ta'minot zayavkalari — ma'sul xodim (zayavka bo'limi) shu yerdan tasdiqlaydi yoki bekor qiladi.
 * Zanjirdagi boshqa bo'limlar ham shu ro'yxatdan hujjatni ochib holatini ko'radi.
 */
export default async function TaminotPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession(["SALES", "WAREHOUSE", "PROCUREMENT", "PRODUCTION", "FINANCE", "ACCOUNTING", "CASHIER"]);
  const { tab } = await searchParams;
  const t = supplyTab(tab);
  const [rows, counts] = await Promise.all([supplyList(t.status), supplyCounts()]);
  const waiting = rows.filter((r) => r.status === "PRICED");
  const canAsk = ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "DIRECTOR"].includes(s.role);

  return (
    <div>
      <PageHeader title="Ta'minot zayavkalari"
        subtitle="Sklad so'ragan mahsulotlar snabjeniye narxi bilan shu yerga tushadi. Tasdiqlansa — Moliya bo'limiga (Kirim-Chiqim) o'tadi."
        action={canAsk ? <LinkButton href="/stock/supply/new"><Plus size={16} /> Kerakli mahsulotlar</LinkButton> : undefined} />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Tasdiq kutmoqda" value={`${counts.PRICED} ta`} hint={waiting.length ? money(waiting.reduce((x, r) => x + plannedSum(r.items), 0)) : undefined} icon={ClipboardCheck} tone={counts.PRICED ? "warning" : "default"} href="/taminot?tab=PRICED" />
        <StatCard label="Moliya kutmoqda" value={`${counts.APPROVED} ta`} icon={Clock} tone={counts.APPROVED ? "warning" : "default"} href="/taminot?tab=APPROVED" />
        <StatCard label="Tasdiqdan o'tdi" value={`${counts.FUNDED} ta`} hint="Snabjeniye sotib olmoqda" icon={CircleDollarSign} tone={counts.FUNDED ? "info" : "default"} href="/taminot?tab=FUNDED" />
        <StatCard label="Qabul qilingan" value={`${counts.RECEIVED} ta`} icon={PackageCheck} tone="success" href="/taminot?tab=RECEIVED" />
      </div>

      <Tabs current={t.key} items={SUPPLY_TABS.map((x) => ({
        key: x.key, label: x.label, href: `/taminot?tab=${x.key}`,
        count: x.key === "open" ? counts.NEW + counts.PRICED + counts.APPROVED + counts.FUNDED : counts[x.status[0]],
      }))} />
      <SupplyTable rows={rows} empty={`"${t.label}" bo'yicha zayavka yo'q`} />
    </div>
  );
}
