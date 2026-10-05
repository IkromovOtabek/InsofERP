import Link from "next/link";
import { CalendarDays, Landmark, Receipt, Store } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { companyVatPayer, inputVatReport } from "@/lib/receipt-vat";
import { date, money } from "@/lib/format";
import { Badge, Empty, Input, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

const DAY = 86_400_000;
const ymd = /^\d{4}-\d{2}-\d{2}$/;
/** Toshkent (UTC+5) sanasi "YYYY-MM-DD" → kun boshi. */
const tashkent = (s: string) => new Date(`${s}T00:00:00+05:00`);
const todayYmd = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const monthLabel = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1] ?? k.slice(5, 7)} ${k.slice(0, 4)}`;

/**
 * Kirim QQS reyestri — buxgalteriya uchun: davrdagi kirim hujjatlari (storno qilinganlari kirmaydi)
 * oy va yetkazuvchi kesimida QQS'siz summa, QQS va jami. Hisob qoidasi — `lib/receipt-vat.ts`.
 * Ko'rish: direktor, buxgalteriya, moliya (yoki direktor "Kirim QQS reyestri" modulini bergan xodim).
 */
export default async function InputVatPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePage("/kirim-qqs");
  const sp = await searchParams;
  const today = todayYmd();
  const fromS = sp.from && ymd.test(sp.from) ? sp.from : `${today.slice(0, 4)}-01-01`;
  const toS = sp.to && ymd.test(sp.to) ? sp.to : today;
  const from = tashkent(fromS);
  const to = new Date(tashkent(toS).getTime() + DAY); // `to` kuni ham kiradi
  const [d, vatPayer] = await Promise.all([inputVatReport(from, to), companyVatPayer()]);
  const t = d.totals;

  return (
    <div>
      <PageHeader title="Kirim QQS" subtitle="Yetkazuvchilardan olingan mol bo'yicha QQS (NDS 12%) reyestri — oy va yetkazuvchi kesimida" action={<PrintButton />} />

      <form method="get" className="mb-5 flex flex-wrap items-end gap-2 print:hidden">
        <label className="text-xs text-slate-500">Sanadan<Input type="date" name="from" defaultValue={fromS} className="mt-1 w-44" /></label>
        <label className="text-xs text-slate-500">Sanagacha<Input type="date" name="to" defaultValue={toS} className="mt-1 w-44" /></label>
        <button className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="QQS'siz summa" value={money(t.base)} hint={`${t.docs} ta kirim hujjati`} icon={Receipt} tone="info" />
        <StatCard label="Kirim QQS" value={money(t.vat)} hint={vatPayer ? "hisobga olinadi (qaytariladi)" : "korxona QQS to'lovchisi emas — tannarxda"} icon={Landmark} tone="brand" />
        <StatCard label="Jami (QQS bilan)" value={money(t.total)} hint="yetkazuvchilarga to'lanadigan" icon={Store} tone="default" />
        <StatCard label="Davr" value={`${date(from)} — ${date(tashkent(toS))}`} icon={CalendarDays} tone="default" />
      </div>

      <Section title="Oylar bo'yicha">
        <Table>
          <thead><tr><Th>Oy</Th><Th right>Hujjatlar</Th><Th right>QQS&apos;siz</Th><Th right>QQS</Th><Th right>Jami</Th></tr></thead>
          <tbody>
            {d.months.length === 0 && <Empty text="Davrda kirim yo'q" icon={Receipt} />}
            {d.months.map((m) => (
              <Tr key={m.key}>
                <Td className="font-medium">{monthLabel(m.key)}</Td>
                <Td right className="text-slate-500">{m.docs}</Td>
                <Td right>{money(m.base)}</Td>
                <Td right className="font-medium">{money(m.vat)}</Td>
                <Td right>{money(m.total)}</Td>
              </Tr>
            ))}
            {d.months.length > 1 && (
              <Tr><Td className="font-semibold">Jami</Td><Td right className="text-slate-500">{t.docs}</Td><Td right className="font-semibold">{money(t.base)}</Td><Td right className="font-semibold">{money(t.vat)}</Td><Td right className="font-semibold">{money(t.total)}</Td></Tr>
            )}
          </tbody>
        </Table>
      </Section>

      <Section title="Yetkazuvchilar bo'yicha">
        <Table>
          <thead><tr><Th>Yetkazuvchi</Th><Th>INN</Th><Th right>Hujjatlar</Th><Th right>QQS&apos;siz</Th><Th right>QQS</Th><Th right>Jami</Th></tr></thead>
          <tbody>
            {d.suppliers.length === 0 && <Empty text="Davrda kirim yo'q" icon={Store} />}
            {d.suppliers.map((s) => (
              <Tr key={s.key}>
                <Td><Link href={`/suppliers/${s.key}`} className="font-medium hover:underline">{s.label}</Link>{!s.vatPayer && <> <Badge>QQS&apos;siz</Badge></>}</Td>
                <Td className="text-slate-500">{s.inn ?? "—"}</Td>
                <Td right className="text-slate-500">{s.docs}</Td>
                <Td right>{money(s.base)}</Td>
                <Td right className="font-medium">{money(s.vat)}</Td>
                <Td right>{money(s.total)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Kirim hujjatlari">
        <Table>
          <thead><tr><Th>Kirim</Th><Th>Sana</Th><Th>Yetkazuvchi</Th><Th right>QQS&apos;siz</Th><Th right>QQS</Th><Th right>Jami</Th></tr></thead>
          <tbody>
            {d.docs.length === 0 && <Empty text="Davrda kirim yo'q" icon={Receipt} />}
            {d.docs.slice(0, 300).map((r) => (
              <Tr key={r.id}>
                <Td><Link href={`/receipts/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
                <Td>{date(r.date)}</Td>
                <Td>{r.supplier}{r.inn ? <span className="text-xs text-slate-400"> · {r.inn}</span> : null}</Td>
                <Td right>{money(r.base)}</Td>
                <Td right>{money(r.vat)}</Td>
                <Td right>{money(r.total)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {d.docs.length > 300 && <p className="mt-2 text-xs text-slate-500">Oxirgi 300 ta hujjat ko&apos;rsatildi — davrni qisqartiring.</p>}
        <p className="mt-3 text-xs text-slate-500">Storno qilingan kirimlar reyestrga kirmaydi. 2026-10-05 dan oldingi (QQS kiritilmasdan yozilgan) kirimlarda QQS 0 bo&apos;lib ko&apos;rinadi.</p>
      </Section>
    </div>
  );
}
