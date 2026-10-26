import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarRange, TriangleAlert, Wallet } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { date, fmtNum, money, moneyShort } from "@/lib/format";
import { CAL_DAYS, CAL_KIND_LABEL, cashCalendar, isOutKind } from "@/lib/fin-report/calendar";
import { Badge, Callout, Card, CardHeader, Empty, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { MoliyaTabs } from "../moliya-tabs";
import { ForecastChart } from "../forecast-chart";

const WD = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];

/**
 * To'lov kalendari — bugundan 30 kun: har kun kutilayotgan tushum, ta'minotchilar, majburiy va kundalik to'lovlar,
 * kun oxiridagi qoldiq; eng past qoldiq kuni. Hisob — `lib/fin-report/calendar.ts`; sozlamalar — «To'lov rejasi».
 */
export default async function CalendarPage() {
  await requirePage("/moliya/kalendar");
  const c = await cashCalendar();
  const t = c.totals;
  const negative = c.days.find((d) => d.balance < 0);
  const overdue = c.items.filter((i) => i.overdue && isOutKind(i.kind));

  const sheets = [
    { name: "Kunlar", rows: c.days.map((d) => ({ Sana: date(d.date), Kun: WD[d.date.getDay()]!, "Odatiy tushum": d.inForecast, "Va'da qilingan": d.inPromised, "Ta'minotchilar": -d.outSupplier, "Majburiy": -d.outMandatory, "Kundalik": -d.outDaily, "Kun natijasi": d.net, "Qoldiq": d.balance })) },
    { name: "To'lovlar ro'yxati", rows: c.items.map((i) => ({ Sana: date(i.date), "Kimga / kimdan": i.who, "Nima uchun": i.what, Turi: CAL_KIND_LABEL[i.kind], Summa: isOutKind(i.kind) ? -i.amount : i.amount, "Muddati o'tgan": i.overdue ? "ha" : "" })) },
    { name: "Ta'minotchilar", rows: c.suppliers.map((x) => ({ "Ta'minotchi": x.name, "Muddat, kun": x.termDays, Qarz: x.debt, "Muddati o'tgan": x.overdue, "30 kunda": x.due30, Keyin: x.later })) },
  ];

  return (
    <div>
      <PageHeader eyebrow="Moliya" title="To'lov kalendari" subtitle={`${date(c.today)} dan ${CAL_DAYS} kun oldinga: pul yetadimi va qaysi kuni eng kam qoladi`} action={<ExcelButton file={`Tolov kalendari ${date(c.today)}`} sheets={sheets} />} />
      <MoliyaTabs current="/moliya/kalendar" />

      {negative && <Callout tone="danger" title={`${date(negative.date)} da pul yetmaydi`}>Prognoz bo&apos;yicha qoldiq {money(negative.balance)} ga tushadi. Tushumni tezlashtiring (qarzdorlar), to&apos;lovlarni surish yoki kredit liniyasini ko&apos;rib chiqing.</Callout>}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Hozirgi pul (kassa + bank)" value={moneyShort(c.start)} hint={money(c.start)} icon={Wallet} />
        <StatCard label={`${CAL_DAYS} kunda kutilayotgan tushum`} value={moneyShort(t.inForecast + t.inPromised)} hint={`kuniga ${fmtNum(c.perDayIn)} · va'da ${fmtNum(t.inPromised)}`} icon={ArrowDownLeft} tone="success" />
        <StatCard label={`${CAL_DAYS} kunda chiqim`} value={moneyShort(t.outSupplier + t.outMandatory + t.outDaily)} hint={`ta'minotchi ${fmtNum(t.outSupplier)} · majburiy ${fmtNum(t.outMandatory)}`} icon={ArrowUpRight} tone="danger" />
        <StatCard label="Eng past qoldiq" value={moneyShort(c.min.balance)} hint={`${date(c.min.date)} · ${WD[c.min.date.getDay()]}`} icon={TriangleAlert} tone={c.min.balance < 0 ? "danger" : "warning"} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Qoldiq prognozi" icon={CalendarRange} description="Chiziq — kun oxiridagi qoldiq; qizil ustunlar — ta'minotchi va majburiy to'lovlar kuni" />
        <ForecastChart days={c.days} />
      </Card>

      {overdue.length > 0 && (
        <Callout tone="warning" title={`Muddati o'tgan to'lovlar: ${overdue.length} ta, ${money(overdue.reduce((s, i) => s + i.amount, 0))}`}>
          Ular bugungi kunga qo&apos;yildi. Ta&apos;minotchi muddatlarini «To&apos;lov rejasi» sahifasida o&apos;zgartirish mumkin.
        </Callout>
      )}

      <Section title="Kunma-kun">
        <Table maxHeight="75vh">
          <thead><tr><Th>Kun</Th><Th right>Odatiy tushum</Th><Th right>Va&apos;da qilingan</Th><Th right>Ta&apos;minotchilar</Th><Th right>Majburiy</Th><Th right>Kundalik</Th><Th right>Kun natijasi</Th><Th right>Qoldiq</Th></tr></thead>
          <tbody>
            {c.days.map((d, i) => (
              <Tr key={i} className={cn(d.balance < 0 && "bg-red-50", d.date.getTime() === c.min.date.getTime() && "ring-1 ring-inset ring-red-300", d.date.getDay() === 0 && "text-slate-500")}>
                <Td className="whitespace-nowrap">{date(d.date)} <span className="text-[12px] font-normal text-slate-400">{WD[d.date.getDay()]}</span></Td>
                <Td right>{fmtNum(d.inForecast)}</Td>
                <Td right className="text-emerald-700">{d.inPromised ? fmtNum(d.inPromised) : "–"}</Td>
                <Td right className="text-red-600">{d.outSupplier ? `−${fmtNum(d.outSupplier)}` : "–"}</Td>
                <Td right className="text-red-600">{d.outMandatory ? `−${fmtNum(d.outMandatory)}` : "–"}</Td>
                <Td right className="text-slate-500">−{fmtNum(d.outDaily)}</Td>
                <Td right className={d.net < 0 ? "text-red-600" : "text-emerald-700"}>{fmtNum(d.net)}</Td>
                <Td right className={cn("font-semibold", d.balance < 0 && "text-red-700")}>{fmtNum(d.balance)}</Td>
              </Tr>
            ))}
            <Tr className="bg-slate-50"><Td className="font-semibold">Jami</Td><Td right className="font-semibold">{fmtNum(t.inForecast)}</Td><Td right className="font-semibold">{fmtNum(t.inPromised)}</Td><Td right className="font-semibold">−{fmtNum(t.outSupplier)}</Td><Td right className="font-semibold">−{fmtNum(t.outMandatory)}</Td><Td right className="font-semibold">−{fmtNum(t.outDaily)}</Td><Td right className="font-bold">{fmtNum(t.net)}</Td><Td right className="font-bold">{fmtNum(c.days[c.days.length - 1]?.balance ?? c.start)}</Td></Tr>
          </tbody>
        </Table>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Section title="To'lovlar va tushumlar ro'yxati">
            <Table maxHeight="70vh">
              <thead><tr><Th>Sana</Th><Th>Kimga / kimdan</Th><Th>Nima uchun</Th><Th>Turi</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {c.items.length === 0 && <Empty text="Aniq sanali to'lov yo'q — To'lov rejasida doimiy to'lovlarni kiriting" />}
                {c.items.map((i, k) => (
                  <Tr key={k}>
                    <Td className="whitespace-nowrap">{date(i.date)}{i.overdue && <> <Badge color="red">o&apos;tgan</Badge></>}</Td>
                    <Td>{i.href ? <Link href={i.href} className="hover:underline">{i.who}</Link> : i.who}</Td>
                    <Td className="text-slate-500">{i.what}</Td>
                    <Td><Badge color={isOutKind(i.kind) ? (i.kind === "RECURRING" ? "violet" : "amber") : "green"}>{CAL_KIND_LABEL[i.kind]}</Badge></Td>
                    <Td right className={isOutKind(i.kind) ? "text-red-600" : "text-emerald-700"}>{isOutKind(i.kind) ? "−" : "+"}{fmtNum(i.amount)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        </div>
        <div className="xl:col-span-2">
          <Section title="Ta'minotchilar">
            <Table maxHeight="70vh">
              <thead><tr><Th>Ta&apos;minotchi</Th><Th right>Qarz</Th><Th right>O&apos;tgan</Th><Th right>30 kunda</Th></tr></thead>
              <tbody>
                {c.suppliers.length === 0 && <Empty text="Ta'minotchilarga qarz yo'q" />}
                {c.suppliers.map((x) => (
                  <Tr key={x.supplierId}>
                    <Td><Link href={`/suppliers/${x.supplierId}`} className="hover:underline">{x.name}</Link><div className="text-[12px] font-normal text-slate-400">{x.termDays} kun muddat</div></Td>
                    <Td right>{fmtNum(x.debt)}</Td>
                    <Td right className={x.overdue ? "font-semibold text-red-600" : "text-slate-400"}>{x.overdue ? fmtNum(x.overdue) : "–"}</Td>
                    <Td right>{x.due30 ? fmtNum(x.due30) : "–"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
          <Section title="Divident limiti">
            <Card>
              <dl className="divide-y divide-slate-100 text-sm">
                {[
                  [`O'tgan oy (${c.dividend.month}) zavod sof foydasi`, money(c.dividend.profit)],
                  [`Foydaning ${fmtNum(c.dividend.pct)}% i — shu oy limiti`, money(c.dividend.limit)],
                  ["Shu oy olingan divident", money(c.dividend.taken)],
                ].map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-2"><dt className="text-slate-500">{k}</dt><dd className="font-medium tabular">{v}</dd></div>)}
                <div className="flex justify-between gap-3 py-2"><dt className="font-semibold">Qolgan limit</dt><dd className={cn("font-bold tabular", c.dividend.left < 0 ? "text-red-600" : "text-emerald-700")}>{money(c.dividend.left)}</dd></div>
              </dl>
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
