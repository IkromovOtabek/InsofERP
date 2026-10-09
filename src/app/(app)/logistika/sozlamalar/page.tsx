import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";
import { DRUM_MAX_MIN } from "@/lib/logistics";

export const dynamic = "force-dynamic";

/** Logistika sozlamalari: kechikish/GPS/yuklash chegaralari, smena, ETA uchun o'rtacha tezlik. */
export default async function LogisticsSettingsPage() {
  await requireRoles(["LOGISTICS"], { module: "logistika" });
  const s = await db.companySettings.findUnique({ where: { id: "main" } });
  return (
    <div>
      <PageHeader title="Logistika sozlamalari" subtitle="Dashbord, ogohlantirishlar, kalendar va hisobotlar shu qiymatlarga qaraydi" />
      <Card>
        <CardHeader title="Chegaralar" description="Zavod nuqtasi (masofa hisobi uchun) — umumiy Sozlamalarda, direktor belgilaydi" />
        <SettingsForm v={{
          lateWarnMin: s?.lateWarnMin ?? 15, lateCritMin: s?.lateCritMin ?? 45, gpsSilentMin: s?.gpsSilentMin ?? 15, loadedWarnMin: s?.loadedWarnMin ?? 30,
          assignLeadMin: s?.assignLeadMin ?? 60, shiftStartHour: s?.shiftStartHour ?? 8, shiftEndHour: s?.shiftEndHour ?? 20, avgSpeedKmh: s?.avgSpeedKmh ?? 35,
          stopAlertMin: s?.stopAlertMin ?? 20, offRouteM: s?.offRouteM ?? 500,
        }} />
        <p className="mt-4 text-xs text-slate-500">
          Baraban vaqti (beton yuklangandan quyilishigacha): <b>{DRUM_MAX_MIN} daqiqa</b> — o&apos;zgarmas qoida; 80% dan e&apos;tibor, oshsa kritik ogohlantirish (faqat mikserdagi beton).
          GPS ogohlantirishlari (yo&apos;ldagi mashina, har daqiqada tekshiriladi): &quot;GPS jim&quot;, &quot;uzoq turibdi&quot; va &quot;yo&apos;ldan chiqdi&quot; holatlari logistikaga bir marta xabar bo&apos;lib keladi va holat o&apos;tgach o&apos;zi yopiladi. Yo&apos;ldan chiqish haydovchi ilovasida qurilgan marshrut bo&apos;yicha tekshiriladi.
          {" "}&quot;O&apos;rtacha tezlik&quot; GPS soxtaligini tekshirishda ham ishlatiladi: obyektgacha to&apos;g&apos;ri chiziq masofasini shu tezlikdan tez bosib o&apos;tgan reysga &quot;shubhali tez yetkazish&quot; muammosi yoziladi.
        </p>
      </Card>
    </div>
  );
}
