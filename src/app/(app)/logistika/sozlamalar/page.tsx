import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

/** Logistika sozlamalari: kechikish/GPS/yuklash chegaralari, smena, ETA uchun o'rtacha tezlik. */
export default async function LogisticsSettingsPage() {
  await requireSession(["LOGISTICS"]);
  const s = await db.companySettings.findUnique({ where: { id: "main" } });
  return (
    <div>
      <PageHeader title="Logistika sozlamalari" subtitle="Dashbord, ogohlantirishlar, kalendar va hisobotlar shu qiymatlarga qaraydi" />
      <Card>
        <CardHeader title="Chegaralar" description="Zavod nuqtasi (masofa hisobi uchun) — umumiy Sozlamalarda, direktor belgilaydi" />
        <SettingsForm v={{
          lateWarnMin: s?.lateWarnMin ?? 15, lateCritMin: s?.lateCritMin ?? 45, gpsSilentMin: s?.gpsSilentMin ?? 15, loadedWarnMin: s?.loadedWarnMin ?? 30,
          assignLeadMin: s?.assignLeadMin ?? 60, shiftStartHour: s?.shiftStartHour ?? 8, shiftEndHour: s?.shiftEndHour ?? 20, avgSpeedKmh: s?.avgSpeedKmh ?? 35,
        }} />
      </Card>
    </div>
  );
}
