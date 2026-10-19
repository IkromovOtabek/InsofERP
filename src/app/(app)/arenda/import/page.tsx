import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { currentMonth, monthKey, monthLabel, shiftMonth } from "@/lib/rent";
import { Card, Callout, PageHeader } from "@/components/ui";
import { RentImport } from "./rent-import";

/** Arenda → «Excel'dan import»: sekretarning eski «Аренда …xlsx» daftaridagi oy varaqlari bittadan yuklanadi. */
export default async function ArendaImportPage() {
  const s = await requirePage("/arenda");
  const canShops = canDo(s, "arenda", "shops");
  const now = currentMonth();
  const locs = await db.rentShop.findMany({ distinct: ["location"], select: { location: true }, orderBy: { location: "asc" } });
  const months = Array.from({ length: 25 }, (_, i) => shiftMonth(now, 1 - i)).map((m) => ({ key: monthKey(m), label: monthLabel(m) }));
  return (
    <div>
      <PageHeader
        back={{ href: "/arenda", label: "Arenda" }}
        title="Excel'dan import"
        subtitle="Har oy varag'i alohida yuklanadi: do'konlar, shu oy hisobi (perechisleniye, naqd, svet, soliq) va tushgan pul. Faylda bir nechta varaq bo'lsa — kerakli oyni tanlang."
      />
      {canShops ? (
        <Card className="max-w-6xl">
          <RentImport months={months} defaultMonth={monthKey(now)} locations={locs.map((l) => l.location)} canPay={canDo(s, "arenda", "create")} />
        </Card>
      ) : (
        <Callout tone="warning" title="Ruxsat yo'q">Import do&apos;konlar va oylik hisobni o&apos;zgartiradi — buning uchun «Do&apos;konlar va oylik hisobni tahrirlash» ruxsati kerak.</Callout>
      )}
    </div>
  );
}
