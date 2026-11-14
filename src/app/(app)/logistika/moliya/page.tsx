import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Building2, Landmark } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { avtoReport } from "@/lib/fin-report/avto";
import {
  LOGI_EXPENSE, LOGI_INCOME, LOGI_TRANSFER_IN, canLogiPay, canLogiWrite, cashLinkCandidates, driverMonthPays, logiAccounts, logiJournal, logiRequestsToPay, paySources,
} from "@/lib/logistics-finance";
import { driverEmployees } from "@/lib/logistics";
import { stockIssueDrill } from "@/lib/stock-drill";
import { pathAllowed } from "@/lib/nav";
import { db } from "@/lib/db";
import { date, dateTime, money, moneyShort } from "@/lib/format";
import { Badge, Callout, Card, CardHeader, Empty, PageHeader, Section, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { DRILL_LINK, DrillPanel } from "@/components/drill-panel";
import { AvtoView } from "@/app/(app)/bi-tahlil/logistika/avto-view";
import { DayRangeBar, MonthBar, monthTitle, parseDayRange, parseMonth } from "@/app/(app)/bi-tahlil/month-bar";
import { CancelTx, LinkCashForm, MonthPayForm, TxForm, type SourceOpt } from "./forms";
import { LogiOverview } from "./umumiy";

export const dynamic = "force-dynamic";

const BASE = "/logistika/moliya";
const KIND_LABEL = { LOGI: "Logistika hisobi", FACTORY: "Zavod hisobi", TRANSFER: "O'tkazma" } as const;
const KIND_COLOR = { LOGI: "blue", FACTORY: "slate", TRANSFER: "amber" } as const;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Logistika moliya — logistikaning alohida hisobi (`lib/logistics-finance.ts`). Faqat direktor, ish boshqaruvchi va mexanik:
 *  · Umumiy — hamma muhim raqam bitta joyda: kirim, chiqim, foyda, kassa qoldig'i, pul harakati, to'lovlar, mashinalar (`umumiy.tsx`);
 *  · Foyda — dastavka haqi (avtomatik daromad) − tannarx (yoqilg'i, haydovchi haqi, ta'mir, boshqa), mashina va kun bo'yicha;
 *  · Kirim-chiqim — pul harakati: logistika hisobidan, zavod kassa/bankidan berilgani va o'tkazmalar (qayerdan bo'lmasin);
 *    skladdan transportga berilgan zapchast ham shu yerda — summasi bosilsa (`?zap=<chiqim hujjati>`) zapchastlar va kirimi;
 *  · To'lovlar — tasdiqlangan logistika so'rovlari (naqd reys haqi, usta puli, ta'mir) va oylik reys haqi.
 */
export default async function LogistikaMoliyaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePage(BASE);
  const sp = await searchParams;
  const tab = sp.tab === "jurnal" || sp.tab === "tolov" || sp.tab === "foyda" ? sp.tab : "umumiy";
  const [accounts, toPay] = await Promise.all([logiAccounts(), logiRequestsToPay()]);

  const tabs = (
    <Tabs current={tab} items={[
      { key: "umumiy", label: "Umumiy", href: BASE },
      { key: "foyda", label: "Foyda", href: `${BASE}?tab=foyda` },
      { key: "jurnal", label: "Kirim-chiqim", href: `${BASE}?tab=jurnal` },
      { key: "tolov", label: <>To&apos;lovlar{toPay.length ? <Badge color="amber">{toPay.length}</Badge> : null}</>, href: `${BASE}?tab=tolov` },
    ]} />
  );
  const header = (
    <PageHeader title="Logistika moliya"
      subtitle="Logistikaning alohida hisobi: daromad (dastavka), xarajat, foyda va pul harakati. Faqat direktor, ish boshqaruvchi va mexanik ko'radi." />
  );

  // Umumiy — logistikaning hamma muhim raqami bitta joyda (kirim, chiqim, qoldiq, foyda, to'lovlar, mashinalar)
  if (tab === "umumiy") {
    const period = parseDayRange(sp);
    return (
      <div>
        {header}
        {tabs}
        <div className="mt-4">
          <DayRangeBar base={BASE} range={period} />
          <LogiOverview period={period} accounts={accounts} toPay={toPay} />
        </div>
      </div>
    );
  }

  if (tab === "foyda") {
    const period = parseDayRange(sp);
    const r = await avtoReport(period.from, period.to);
    return (
      <div>
        {header}
        {tabs}
        <div className="mt-4">
          <AvtoView r={r} period={period} base={BASE} keep={{ tab: "foyda" }} />
        </div>
      </div>
    );
  }

  if (tab === "jurnal") {
    const period = parseDayRange(sp);
    const write = canLogiWrite(s);
    const [j, links, sources, vehicles, drivers] = await Promise.all([
      logiJournal(period.from, period.to),
      write ? cashLinkCandidates() : Promise.resolve({ total: 0, rows: [] }),
      write ? paySources(true) : Promise.resolve([]),
      write ? db.vehicle.findMany({ where: { isActive: true }, select: { id: true, plate: true }, orderBy: { plate: "asc" } }) : Promise.resolve([]),
      write ? driverEmployees({ activeOnly: true }) : Promise.resolve([]),
    ]);
    const srcOpts: SourceOpt[] = sources.map((a) => ({ id: a.id, group: a.group, type: a.type, label: `${a.name} (${a.type === "CASH" ? "naqd" : "bank"}) · qoldiq ${money(a.balance)}` }));
    // Davr parametrlari saqlanadi: zapchast paneli ochilib-yopilganda jurnal o'sha davrda qoladi
    const keep = { tab: "jurnal", davr: sp.davr, dan: sp.dan, gacha: sp.gacha, oy: sp.oy };
    const jurnalHref = (extra: Record<string, string> = {}) =>
      `${BASE}?${new URLSearchParams(Object.entries({ ...keep, ...extra }).filter((kv): kv is [string, string] => !!kv[1]))}`;
    // Skladdan zapchast: faqat jurnaldagi hujjat ochiladi (ixtiyoriy chiqim id'si bilan sklad ma'lumoti ko'rinmasin)
    const zapRef = sp.zap && j.rows.some((r) => r.stockRef === sp.zap) ? sp.zap : null;
    const zap = zapRef ? await stockIssueDrill(zapRef, { receiptHref: pathAllowed("/receipts", s.role, s.perms) }) : null;
    return (
      <div>
        {header}
        {tabs}
        {zap && <DrillPanel drill={zap} closeHref={jurnalHref()} />}
        <div className="mt-4">
          <DayRangeBar base={BASE} range={period} keep={{ tab: "jurnal" }} />
          <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {accounts.map((a) => (
              <StatCard key={a.id} label={`${a.name} — qoldiq`} value={moneyShort(a.balance)} hint="butun davr · kassaga kirmaydi" icon={Landmark} tone={a.balance < 0 ? "danger" : "brand"} />
            ))}
            <StatCard label="Kirim" value={moneyShort(j.totals.income)} hint={j.totals.transferIn ? `shundan zavoddan o'tkazma ${moneyShort(j.totals.transferIn)}` : period.label} icon={ArrowDownLeft} tone="success" />
            <StatCard label="Chiqim — zavod hisobidan" value={moneyShort(j.totals.expenseFactory)} hint="kassa/bankdan berilgan logistika puli" icon={Building2} />
            <StatCard label="Chiqim — logistika hisobidan" value={moneyShort(j.totals.expenseLogi)} hint={`jami chiqim ${moneyShort(j.totals.expense)}`} icon={ArrowUpRight} tone="warning" />
          </div>

          {write && (
            <Card className="mb-5">
              <CardHeader title="Kirim / chiqim yozish" description="Chiqim ko'pincha zavod kassasidan — qayerdan bo'lmasin, shu jurnalda ko'rinadi. Logistika hisobidagi pul zavod kassasiga tushmaydi." />
              <TxForm sources={srcOpts} vehicles={vehicles.map((v) => ({ id: v.id, label: v.plate }))} drivers={drivers.map((d) => ({ id: d.id, label: d.fullName }))}
                expense={LOGI_EXPENSE} income={LOGI_INCOME} transfer={LOGI_TRANSFER_IN} today={isoDay(new Date())} />
            </Card>
          )}

          {write && links.total > 0 && (
            <Card className="mb-5">
              <CardHeader title={`Kassadagi transport yozuvlari — logistikaga olinmagan: ${links.total} ta`}
                description="Zavod kassasida to'g'ridan yozilgan «Transport» chiqimlari va transport xizmati kirimi. Logistikaga olinsa — tafsiloti (toifa, mashina, haydovchi) shu yerda; kassa qoldig'i va PNL o'zgarmaydi, kassada qator qulflanadi. Mashinaga yozilgan ta'mir, zapchast, yo'l xarajati Foydaga ham tushadi (yoqilg'i — zapravkadan). Toifa va mashina izohdan taklif qilingan — tekshiring." />
              <LinkCashForm
                rows={links.rows.map((r) => ({
                  id: r.id, date: date(r.date), type: r.type as "INCOME" | "EXPENSE", amount: money(r.amount), account: r.account, source: r.source,
                  counterparty: r.counterparty, note: r.note, category: r.category, vehicleId: r.vehicleId,
                }))}
                vehicles={vehicles.map((v) => ({ id: v.id, label: v.plate }))} drivers={drivers.map((d) => ({ id: d.id, label: d.fullName }))}
                expense={LOGI_EXPENSE} income={LOGI_INCOME.filter((c) => c !== LOGI_TRANSFER_IN)} />
              {links.total > links.rows.length && <p className="mt-2 text-xs text-slate-500">Ko&apos;rsatilgan: oxirgi {links.rows.length} ta — saqlangach keyingilari chiqadi.</p>}
            </Card>
          )}

          <Section title={`Jurnal — ${period.label}`}>
            {j.rows.length === 0 ? <Empty text="Bu davrda logistika kirim-chiqimi yo'q" /> : (
              <Table>
                <thead><Tr><Th>Sana</Th><Th>Hujjat</Th><Th>Hisob</Th><Th>Toifa</Th><Th>Mashina / kim</Th><Th right>Kirim</Th><Th right>Chiqim</Th><Th>Izoh</Th>{write && <Th />}</Tr></thead>
                <tbody>
                  {j.rows.map((r) => (
                    <Tr key={r.key}>
                      <Td className="whitespace-nowrap tabular">{dateTime(r.at)}</Td>
                      <Td className="whitespace-nowrap">{r.href ? <Link href={r.href} className="font-medium hover:underline">{r.docNo}</Link> : <span className="font-medium">{r.docNo}</span>}</Td>
                      <Td><Badge color={KIND_COLOR[r.kind]}>{KIND_LABEL[r.kind]}</Badge><div className="text-xs text-slate-500">{r.account}</div></Td>
                      <Td>{r.category}</Td>
                      <Td>{[r.vehicle, r.who].filter(Boolean).join(" · ") || "—"}</Td>
                      <Td right className="tabular text-emerald-700">{r.type === "INCOME" ? money(r.amount) : ""}</Td>
                      <Td right className="tabular">
                        {r.type !== "EXPENSE" ? "" : r.stockRef
                          ? <Link href={jurnalHref({ zap: r.stockRef })} scroll={false} className={DRILL_LINK} title="Qaysi zapchastlar va ular skladga qachon, kimdan kirim bo'lgani">{money(r.amount)}</Link>
                          : money(r.amount)}
                      </Td>
                      <Td className="max-w-72 text-xs text-slate-500">{r.note ?? ""}</Td>
                      {write && <Td>{r.logiTxId && r.cancellable ? <CancelTx id={r.logiTxId} docNo={r.docNo} unlink={r.linked} /> : null}</Td>}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Section>
          <p className="mt-3 text-xs text-slate-500">
            Jurnal — pul harakati. Foyda tabidagi xarajat esa tannarx: yoqilg&apos;i zapravkadan, haydovchi haqi reys narxidan olinadi, shuning uchun
            ularning to&apos;lovi xarajatga ikki marta qo&apos;shilmaydi. Zavod vedomosti orqali to&apos;langan oylik reys haqi bu jurnalga kirmaydi.
          </p>
        </div>
      </div>
    );
  }

  // ── To'lovlar ──
  const month = parseMonth(sp.oy);
  const pay = canLogiPay(s);
  const [mp, sources] = await Promise.all([driverMonthPays(month), pay ? paySources(true) : Promise.resolve([])]);
  const srcOpts: SourceOpt[] = sources.map((a) => ({ id: a.id, group: a.group, type: a.type, label: `${a.name} (${a.type === "CASH" ? "naqd" : "bank"}) · qoldiq ${money(a.balance)}` }));
  return (
    <div>
      {header}
      {tabs}
      <div className="mt-4 space-y-5">
        <Section title="Pul berish kerak — tasdiqlangan so'rovlar">
          {toPay.length === 0 ? <Empty text="Berilmagan logistika so'rovi yo'q" /> : (
            <Table>
              <thead><Tr><Th>Hujjat</Th><Th>Nima uchun</Th><Th>Kimga</Th><Th>Tasdiqlangan</Th><Th right>Summa</Th><Th /></Tr></thead>
              <tbody>
                {toPay.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap font-medium">{r.docNo}{r.urgent && <> <Badge color="red">Shoshilinch</Badge></>}</Td>
                    <Td>{r.vehicle?.plate ?? r.object ?? "—"} · {r.problem}</Td>
                    <Td>{r.payee ?? r.createdBy.fullName}</Td>
                    <Td className="whitespace-nowrap tabular">{r.decidedAt ? dateTime(r.decidedAt) : "—"}</Td>
                    <Td right className="tabular font-medium">{money(r.amount)}</Td>
                    <Td><Link href={`/mexanik-sorovlar/${r.id}`} className="text-sm font-medium text-blue-700 hover:underline">{pay ? "Pul berish" : "Ochish"}</Link></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>

        <Section title={`Oylik reys haqi — ${monthTitle(month)}`}>
          <MonthBar base={BASE} month={month} keep={{ tab: "tolov" }} />
          {mp.lock
            ? <Callout tone="info" title="Vedomost orqali">{mp.lock} — bu oyning oylik reys haqi zavod vedomosti orqali to&apos;lanadi.</Callout>
            : <p className="mb-3 text-sm text-slate-600">Tasdiqlangan oylik reys haqini shu yerdan zavod yoki logistika hisobidan to&apos;lashingiz mumkin — to&apos;langani zavod vedomostiga tushmaydi. To&apos;lanmay qolgani oy yakuni vedomostiga tushadi.</p>}
          {mp.draft && !mp.lock && <Callout tone="warning" title="Vedomost qoralamasi bor">Shu oy uchun yakuniy vedomost qoralamasi hisoblangan. Bu yerdan to&apos;lasangiz, otdel kadr vedomostni qayta hisoblashi kerak.</Callout>}
          {mp.rows.length === 0 ? <Empty text="Bu oyda tasdiqlangan oylik reys haqi yo'q" /> : (
            <Table>
              <thead><Tr><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Qo&apos;lda yozuv</Th><Th right>To&apos;lanmagan</Th><Th right>Logistikadan to&apos;langan</Th><Th>{pay && !mp.lock ? "To'lash" : ""}</Th></Tr></thead>
              <tbody>
                {mp.rows.map((r) => (
                  <Tr key={r.driverId}>
                    <Td className="font-medium">{r.driver}</Td>
                    <Td right className="tabular">{r.trips || ""}</Td>
                    <Td right className="tabular">{r.entries || ""}</Td>
                    <Td right className="tabular font-medium">{r.due ? money(r.due) : "—"}</Td>
                    <Td right className="tabular text-emerald-700">{r.paid ? <>{money(r.paid)}<div className="text-xs text-slate-500">{r.paidDocs.join(", ")}</div></> : "—"}</Td>
                    <Td>{pay && !mp.lock && r.due > 0 ? <MonthPayForm month={month} driverId={r.driverId} amount={moneyShort(r.due)} sources={srcOpts} /> : null}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
        <p className="text-xs text-slate-500">Hisob qoldig&apos;i: {accounts.map((a) => `${a.name} — ${money(a.balance)}`).join(" · ") || "logistika hisobi yo'q"} · {date(new Date())}</p>
      </div>
    </div>
  );
}
