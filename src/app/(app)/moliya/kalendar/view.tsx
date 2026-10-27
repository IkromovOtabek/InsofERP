import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, CalendarRange, Clock, TriangleAlert, Wallet } from "lucide-react";
import { date, fmtNum, money, moneyShort } from "@/lib/format";
import { CAL_DAYS, CAL_KIND_LABEL, cashCalendar, isOutKind, supplierMonth } from "@/lib/fin-report/calendar";
import { Badge, Callout, Card, CardHeader, Empty, Input, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { ForecastChart } from "../forecast-chart";

const WD = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
const Out = ({ v }: { v: number }) => (v ? <span className="text-red-600">{fmtNum(v)}</span> : <span className="text-slate-300">–</span>);

/** `qoldiq` — foydalanuvchi yozgan haqiqiy pul qoldig'i («191 853 846» ham bo'ladi); bo'sh — jurnal bo'yicha. */
export function parseStart(v?: string): number | undefined {
  const s = v?.replace(/[\s ]/g, "").replace(",", ".");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * To'lov kalendari — «Insof 2026» → «To'lov kalendari» varag'idek: tepada asosiy ko'rsatkichlar, kunma-kun 30 kun
 * (kirim / chiqim turlari, kun natijasi, kun oxiri qoldig'i, belgi), «Kimga, qachon, qancha» ro'yxati, ta'minotchilar
 * shu oy holati va divident limiti. `/moliya/kalendar` va Tahlil → Moliya → To'lov kalendari bir xil ko'rinishda.
 */
export async function CalendarView({ base, qoldiq }: { base: string; qoldiq?: string }) {
  const c = await cashCalendar(new Date(), { start: parseStart(qoldiq) });
  const sup = await supplierMonth(c);
  const t = c.totals;
  const outTotal = t.outSupplier + t.outMandatory + t.outDaily + t.outMaterials + t.outDividend;
  const negative = c.days.find((d) => d.balance < 0);
  const manual = Math.abs(c.start - c.journal) >= 1;
  const supT = (f: (r: (typeof sup)[number]) => number) => sup.reduce((s, r) => s + f(r), 0);

  const sheets = [
    { name: "Kunma-kun", rows: c.days.map((d) => ({ Sana: date(d.date), Kun: WD[d.date.getDay()]!, "Kirim: odatiy tushum": d.inForecast, "Kirim: va'da qilingan": d.inPromised, "Chiqim: ta'minotchilar": d.outSupplier, "Chiqim: oylik, kredit, soliq, kommunal": d.outMandatory, "Chiqim: kundalik xarajatlar": d.outDaily, "Chiqim: yangi xom-ashyo": d.outMaterials, "Chiqim: divident": d.outDividend, "Kun natijasi": d.net, "Kun oxiri pul qoldig'i": d.balance })) },
    { name: "Kimga, qachon, qancha", rows: c.items.map((i) => ({ Sana: date(i.date), "Kimga / kimdan": i.who, "Nima uchun": i.what, Turi: CAL_KIND_LABEL[i.kind], "Chiqim, so'm": isOutKind(i.kind) ? i.amount : 0, "Kirim, so'm": isOutKind(i.kind) ? 0 : i.amount, Izoh: i.overdue ? `muddati o'tgan (${dm(i.due)})` : "" })) },
    { name: "Ta'minotchilar", rows: sup.map((x) => ({ "Ta'minotchi": x.name, "Oy boshidagi qarzimiz": x.open, "Shu oy to'ladik": x.paid, "Shu oy tovar keldi": x.arrived, "Hozirgi qarzimiz": x.now, "Shundan muddati o'tgan": x.overdue })) },
  ];

  const mark = (i: number) => {
    const d = c.days[i]!;
    if (d.balance < 0) return <Badge color="red">pul yetmaydi</Badge>;
    if (d.date.getTime() === c.min.date.getTime()) return <Badge color="amber">eng past</Badge>;
    if (i === 0) return <Badge color="blue">bugun</Badge>;
    return null;
  };

  return (
    <div>
      <form method="get" action={base} className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Bugun: <b className="text-slate-800">{date(c.today)}</b></span>
        <span className="text-slate-500">· Hozirgi pul (kassa + bank, jurnal): <b className="tabular text-slate-800">{fmtNum(c.journal)}</b></span>
        <label className="ml-auto flex items-center gap-2 text-slate-500">Haqiqiy qoldiqni bilsangiz yozing
          <Input name="qoldiq" inputMode="numeric" defaultValue={manual ? fmtNum(c.start) : ""} placeholder={fmtNum(c.journal)} className="h-9 w-44 bg-amber-50 text-right tabular" />
        </label>
        <button className="h-9 rounded-lg bg-slate-900 px-3 font-medium text-white hover:bg-slate-800">Hisoblash</button>
        {manual && <Link href={base} className="h-9 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:bg-slate-50">Jurnal bo&apos;yicha</Link>}
        <ExcelButton file={`Tolov kalendari ${date(c.today)}`} sheets={sheets} />
      </form>

      {negative && <Callout tone="danger" title={`${date(negative.date)} da pul yetmaydi`}>Prognoz bo&apos;yicha qoldiq {money(negative.balance)} ga tushadi. Tushumni tezlashtiring (qarzdorlar), to&apos;lovlarni surish yoki kredit liniyasini ko&apos;rib chiqing.</Callout>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label={`${CAL_DAYS} kunda kutilayotgan kirim`} value={moneyShort(t.inForecast + t.inPromised)} hint={fmtNum(t.inForecast + t.inPromised)} icon={ArrowDownLeft} tone="success" href="#kunma-kun" />
        <StatCard label={`${CAL_DAYS} kunda chiqim`} value={moneyShort(outTotal)} hint={fmtNum(outTotal)} icon={ArrowUpRight} tone="danger" href="#kunma-kun" />
        <StatCard label="Eng past pul qoldig'i" value={moneyShort(c.min.balance)} hint={fmtNum(c.min.balance)} icon={TriangleAlert} tone={c.min.balance < 0 ? "danger" : "warning"} href="#kunma-kun" />
        <StatCard label="O'sha kun" value={dm(c.min.date)} hint={`${WD[c.min.date.getDay()]}, ${c.min.date.getFullYear()}`} icon={CalendarClock} href="#kunma-kun" />
        <StatCard label="Muddati o'tgan to'lovlarimiz" value={moneyShort(c.overdueOut)} hint={fmtNum(c.overdueOut)} icon={Clock} tone={c.overdueOut > 0 ? "danger" : "default"} href="#tolovlar-royxati" />
        <StatCard label="Yaqin 7 kunda to'lanadi" value={moneyShort(c.next7Out)} hint={fmtNum(c.next7Out)} icon={Wallet} href="#tolovlar-royxati" />
      </div>

      <Card className="mt-6">
        <CardHeader title="Qoldiq prognozi" icon={CalendarRange} description="Chiziq — kun oxiridagi qoldiq; qizil ustunlar — ta'minotchi va majburiy to'lovlar kuni" />
        <ForecastChart days={c.days} />
      </Card>

      <Section id="kunma-kun" title={`Kunma-kun (${CAL_DAYS} kun)`}>
        <Table maxHeight="75vh">
          <thead>
            <tr>
              <Th>Sana</Th><Th>Kun</Th><Th right>Kirim: odatiy tushum (prognoz)</Th><Th right>Kirim: va&apos;da qilingan</Th>
              <Th right>Chiqim: ta&apos;minotchilar</Th><Th right>Chiqim: oylik, kredit, soliq, kommunal</Th><Th right>Chiqim: kundalik xarajatlar</Th>
              <Th right>Chiqim: yangi xom-ashyo (rejaga ko&apos;ra)</Th><Th right>Chiqim: divident (faqat foydadan)</Th><Th right>Kun natijasi</Th><Th right>Kun oxiri pul qoldig&apos;i</Th><Th>Belgi</Th>
            </tr>
          </thead>
          <tbody>
            {c.days.map((d, i) => (
              <Tr key={i} className={cn(d.balance < 0 && "bg-red-50", d.date.getDay() === 0 && "text-slate-500")}>
                <Td className="whitespace-nowrap">{date(d.date)}</Td>
                <Td className="text-slate-500">{WD[d.date.getDay()]}</Td>
                <Td right className="bg-emerald-50/50">{fmtNum(d.inForecast)}</Td>
                <Td right className="bg-emerald-50/50 text-emerald-700">{d.inPromised ? fmtNum(d.inPromised) : "–"}</Td>
                <Td right className="bg-orange-50/50"><Out v={d.outSupplier} /></Td>
                <Td right className="bg-orange-50/50"><Out v={d.outMandatory} /></Td>
                <Td right className="bg-orange-50/50"><Out v={d.outDaily} /></Td>
                <Td right className="bg-orange-50/50"><Out v={d.outMaterials} /></Td>
                <Td right className="bg-orange-50/50"><Out v={d.outDividend} /></Td>
                <Td right className={d.net < 0 ? "text-red-600" : "text-emerald-700"}>{fmtNum(d.net)}</Td>
                <Td right className={cn("font-semibold", d.balance < 0 && "text-red-700")}>{fmtNum(d.balance)}</Td>
                <Td>{mark(i)}</Td>
              </Tr>
            ))}
            <Tr className="bg-slate-50 font-semibold">
              <Td>Jami ({CAL_DAYS} kun)</Td><Td />
              <Td right>{fmtNum(t.inForecast)}</Td><Td right>{fmtNum(t.inPromised)}</Td><Td right>{fmtNum(t.outSupplier)}</Td><Td right>{fmtNum(t.outMandatory)}</Td>
              <Td right>{fmtNum(t.outDaily)}</Td><Td right>{fmtNum(t.outMaterials)}</Td><Td right>{fmtNum(t.outDividend)}</Td>
              <Td right className="font-bold">{fmtNum(t.net)}</Td><Td right className="font-bold">{fmtNum(c.days[c.days.length - 1]?.balance ?? c.start)}</Td><Td />
            </Tr>
          </tbody>
        </Table>
        <p className="mt-2 text-[13px] text-slate-500">
          Odatiy tushum — oxirgi {c.histDays} kun o&apos;rtachasi × reja koeffitsiyenti {fmtNum(c.factor, 2)}. Yangi xom-ashyo — kuniga {fmtNum(c.perDayMaterials)}, bugun kelgan mol {c.termDays} kundan keyin to&apos;lanadi.
          Sozlamalar (reja, doimiy to&apos;lovlar, ta&apos;minotchi muddatlari) — «To&apos;lov rejasi».
        </p>
      </Section>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
        <div className="2xl:col-span-3">
          <Section id="tolovlar-royxati" title="Kimga, qachon, qancha — to'lovlar va tushumlar ro'yxati" action={<span className="text-sm text-slate-500">Jami chiqim: <b className="tabular text-slate-800">{fmtNum(c.items.filter((i) => isOutKind(i.kind)).reduce((s, i) => s + i.amount, 0))}</b></span>}>
            <Table maxHeight="70vh">
              <thead><tr><Th>Sana</Th><Th>Kimga / kimdan</Th><Th>Nima uchun</Th><Th>Turi</Th><Th right>Chiqim, so&apos;m</Th><Th right>Kirim, so&apos;m</Th><Th>Izoh</Th></tr></thead>
              <tbody>
                {c.items.length === 0 && <Empty text="Aniq sanali to'lov yo'q — To'lov rejasida doimiy to'lovlarni kiriting" />}
                {c.items.map((i, k) => (
                  <Tr key={k} className={i.overdue ? "bg-red-50/60" : undefined}>
                    <Td className="whitespace-nowrap">{date(i.date)}</Td>
                    <Td>{i.href ? <Link href={i.href} className="hover:underline">{i.who}</Link> : i.who}</Td>
                    <Td className="text-slate-500">{i.what}</Td>
                    <Td><Badge color={isOutKind(i.kind) ? (i.kind === "RECURRING" ? "violet" : "amber") : "green"}>{CAL_KIND_LABEL[i.kind]}</Badge></Td>
                    <Td right className="text-red-600">{isOutKind(i.kind) ? fmtNum(i.amount) : "–"}</Td>
                    <Td right className="text-emerald-700">{isOutKind(i.kind) ? "–" : fmtNum(i.amount)}</Td>
                    <Td className="whitespace-nowrap text-red-600">{i.overdue ? `muddati o'tgan (${dm(i.due)})` : ""}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        </div>
        <div className="2xl:col-span-2">
          <Section title="Ta'minotchilar — shu oy: qarz, to'langan, kelgan">
            <Table maxHeight="70vh">
              <thead><tr><Th>Ta&apos;minotchi</Th><Th right>Oy boshidagi qarzimiz</Th><Th right>Shu oy to&apos;ladik</Th><Th right>Shu oy tovar keldi</Th><Th right>Hozirgi qarzimiz</Th><Th right>Shundan muddati o&apos;tgan</Th></tr></thead>
              <tbody>
                {sup.length === 0 && <Empty text="Ta'minotchilar bilan shu oy harakat yo'q" />}
                {sup.map((x) => (
                  <Tr key={x.supplierId}>
                    <Td><Link href={`/suppliers/${x.supplierId}`} className="hover:underline">{x.name}</Link></Td>
                    <Td right>{fmtNum(x.open)}</Td>
                    <Td right className="bg-emerald-50/50">{x.paid ? fmtNum(x.paid) : "–"}</Td>
                    <Td right>{x.arrived ? fmtNum(x.arrived) : "–"}</Td>
                    <Td right className={cn("font-semibold", x.now < 0 && "text-emerald-700")}>{fmtNum(x.now)}</Td>
                    <Td right className={x.overdue ? "bg-red-50 font-semibold text-red-600" : "text-slate-300"}>{x.overdue ? fmtNum(x.overdue) : "–"}</Td>
                  </Tr>
                ))}
                {sup.length > 0 && (
                  <Tr className="bg-slate-50 font-semibold">
                    <Td>JAMI</Td><Td right>{fmtNum(supT((r) => r.open))}</Td><Td right>{fmtNum(supT((r) => r.paid))}</Td><Td right>{fmtNum(supT((r) => r.arrived))}</Td>
                    <Td right>{fmtNum(supT((r) => r.now))}</Td><Td right className="text-red-600">{fmtNum(supT((r) => r.overdue))}</Td>
                  </Tr>
                )}
              </tbody>
            </Table>
            <p className="mt-2 text-[13px] text-slate-500">Manfiy qarz — biz oldindan to&apos;laganmiz (avans).</p>
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
              {c.dividend.left < 0 && <p className="mt-2 text-[13px] text-red-600">Foydadan {moneyShort(-c.dividend.left)} ko&apos;p olingan — shu oy oxirigacha divident ustuni bo&apos;sh.</p>}
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
