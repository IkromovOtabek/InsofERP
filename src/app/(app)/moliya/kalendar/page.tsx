import { requirePage } from "@/lib/page-guard";
import { CAL_DAYS } from "@/lib/fin-report/calendar";
import { PageHeader } from "@/components/ui";
import { MoliyaTabs } from "../moliya-tabs";
import { CalendarView } from "./view";

/**
 * To'lov kalendari — bugundan 30 kun: har kun kutilayotgan tushum, ta'minotchilar, majburiy, kundalik, yangi xom-ashyo
 * va divident to'lovlari, kun oxiridagi qoldiq. Hisob — `lib/fin-report/calendar.ts`; sozlamalar — «To'lov rejasi».
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/moliya/kalendar");
  const sp = await searchParams;
  return (
    <div>
      <PageHeader eyebrow="Moliya" title="To'lov kalendari" subtitle={`Kelgusi ${CAL_DAYS} kun: kimga, qachon, qancha — pul yetadimi va qaysi kuni eng kam qoladi`} />
      <MoliyaTabs current="/moliya/kalendar" />
      <CalendarView base="/moliya/kalendar" qoldiq={sp.qoldiq} />
    </div>
  );
}
