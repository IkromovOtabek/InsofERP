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
        info={<>
          <p>Har oy varag&apos;i alohida yuklanadi: do&apos;konlar, shu oy hisobi (perechisleniye, naqd, svet, soliq) va tushgan pul. Faylda bir nechta varaq bo&apos;lsa — kerakli oyni tanlang.</p>
          <p>«Общий», «Буш» va summasi yo&apos;q qatorlar (izohlar) o&apos;tkazib yuboriladi. «Жами» va «Колдик» ustunlari kerak emas — tizim o&apos;zi hisoblaydi.
            Bazada yo&apos;q do&apos;kon qo&apos;shiladi, bor do&apos;konning shu oy hisobi fayldagi summalar bilan yangilanadi.</p>
          <p>Diqqat: o&apos;tgan oylar to&apos;lovlari kirim qilinsa, arenda kassasi umumiy summasi oshadi — zavod kassasiga topshirilgan pulni «Kassaga topshirildi» chiqimi bilan yozing.</p>
        </>}
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
