import Link from "next/link";
import { Wallet, Coins, ListChecks, Percent, Trash2 } from "lucide-react";
import { biContext, BiPage } from "../../shell";
import { marketingEntries, CHANNELS, KIND_LABEL } from "@/lib/bi/marketing";
import { MONTHS_UZ, MONTHS_SHORT } from "@/lib/bi/plans";
import { moneyShort, fmtNum } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Badge, Select } from "@/components/ui";
import { Kpi, Panel, Note, Why } from "../../ui";
import { RowForm } from "@/components/row-form";
import { saveEntry, deleteEntry } from "../actions";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  const now = new Date();
  const year = sp.year === "" ? undefined : Number(sp.year) || now.getFullYear();
  const d = await marketingEntries({ year, month: Number(sp.month) || undefined, channel: sp.channel || undefined, kind: sp.kind || undefined });
  const S = d.summary;
  const KIND_COLOR = { BUDGET: "blue", PLAN: "amber", FACT: "green" } as const;

  return (
    <BiPage title="Marketing ma'lumotlari" subtitle="Oy × kanal bo'yicha byudjet, reja va fakt yozuvlari. Marketing va Reja nazorati sahifalari shu yozuvlardan hisoblanadi." tab="marketingData" range={range} period={false}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Rejalashtirilgan byudjet" value={moneyShort(S.budget)} icon={Wallet} tone="info" hint={`${S.year}-yil`} />
          <Kpi label="Haqiqiy sarflangan" value={moneyShort(S.spent)} icon={Coins} tone="brand" hint={S.budget ? `${S.spent <= S.budget ? "▼" : "▲"} ${fmtNum(Math.abs(((S.spent - S.budget) / S.budget) * 100), 1)}% byudjetdan ${S.spent <= S.budget ? "kam" : "ko'p"}` : "byudjet kiritilmagan"} />
          <Kpi label="Kiritilgan yozuvlar" value={String(S.count)} icon={ListChecks} hint="oy × kanal bo'yicha" />
          <Kpi label="Qaytim (ROAS)" value={S.roas !== null ? `${fmtNum(S.roas, 2)}x` : "—"} icon={Percent} tone={S.roas !== null && S.roas >= 1 ? "success" : "default"} hint="daromad / fakt xarajat" />
        </div>

        <Panel title="Yangi yozuv qo'shish" info="Byudjet — oy boshida kanalga ajratilgan pul. Reja — natija maqsadlari (xarajat, lead, mijoz, daromad). Fakt — haqiqiy to'langan xarajat va olingan natija.">
          <RowForm action={saveEntry.bind(null, null)} mode="create" submit="Saqlash" cols={6} fields={[
            { name: "year", label: "Yil *", type: "number", defaultValue: now.getFullYear(), required: true },
            { name: "month", label: "Oy *", type: "select", defaultValue: String(now.getMonth() + 1), options: MONTHS_UZ.map((m, i) => [String(i + 1), m]) },
            { name: "kind", label: "Yozuv turi *", type: "select", defaultValue: "FACT", options: Object.entries(KIND_LABEL) },
            { name: "channel", label: "Kanal *", type: "select", defaultValue: "Instagram", options: CHANNELS.map((c) => [c, c]) },
            { name: "amount", label: "Summa (so'm) *", type: "number", step: "1", required: true, placeholder: "xarajat / byudjet" },
            { name: "revenue", label: "Daromad (so'm)", type: "number", step: "1", placeholder: "keltirgan sotuv" },
            { name: "leads", label: "Leadlar (murojaat)", type: "number", step: "1" },
            { name: "customers", label: "Mijozlar", type: "number", step: "1" },
            { name: "impressions", label: "Ko'rsatishlar", type: "number", step: "1" },
            { name: "clicks", label: "Bosishlar", type: "number", step: "1" },
            { name: "note", label: "Izoh", className: "sm:col-span-2" },
          ]} />
          <Note>Reja va Fakt uchun daromad, lead va mijoz maydonlarini to'ldiring — ular ROAS, CAC va reja bajarilishini beradi. Byudjet uchun faqat summa kifoya.</Note>
        </Panel>

        <Panel title="Kiritilgan ma'lumotlar" padded={false} action={<span>{d.rows.length} yozuv</span>}>
          <form method="get" action="/bi-tahlil/marketing/malumotlar" className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-[13px]">
            <Select name="year" defaultValue={sp.year ?? String(now.getFullYear())} className="h-8 w-32"><option value="">Barcha yillar</option>{[...new Set([now.getFullYear(), ...d.years])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}</Select>
            <Select name="month" defaultValue={sp.month ?? ""} className="h-8 w-36"><option value="">Barcha oylar</option>{MONTHS_UZ.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
            <Select name="channel" defaultValue={sp.channel ?? ""} className="h-8 w-40"><option value="">Barcha kanallar</option>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</Select>
            <Select name="kind" defaultValue={sp.kind ?? ""} className="h-8 w-44"><option value="">Reja va fakt</option>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <button className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white">Qo'llash</button>
            {(sp.month || sp.channel || sp.kind || sp.year === "") && <Link href="/bi-tahlil/marketing/malumotlar" className="text-xs text-slate-500 hover:underline">Tozalash</Link>}
          </form>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Davr</Th><Th>Kanal</Th><Th>Turi</Th><Th right>Summa</Th><Th right>Lead</Th><Th right>Mijoz</Th><Th right>Daromad</Th><Th right>ROAS</Th><Th>Izoh</Th><Th>Kim kiritdi</Th><Th></Th></tr></thead>
            <tbody>
              {d.rows.length === 0 && <Empty text="Yozuv yo'q" />}
              {d.rows.map((r) => { const amt = Number(r.amount), rev = r.revenue === null ? null : Number(r.revenue); return (
                <Tr key={r.id}><Td className="whitespace-nowrap">{r.year} · {MONTHS_SHORT[r.month - 1]}</Td><Td className="font-medium">{r.channel}</Td><Td><Badge color={KIND_COLOR[r.kind]} dot={false}>{{ BUDGET: "Byudjet", PLAN: "Reja", FACT: "Fakt" }[r.kind]}</Badge></Td><Td right className="font-medium">{moneyShort(amt)}</Td><Td right>{r.leads ?? "—"}</Td><Td right>{r.customers ?? "—"}</Td><Td right>{rev === null ? "—" : moneyShort(rev)}</Td><Td right>{rev !== null && amt > 0 ? `${fmtNum(rev / amt, 2)}x` : "—"}</Td><Td className="max-w-48 truncate text-xs text-slate-500">{r.note ?? ""}</Td><Td className="text-xs text-slate-500">{r.createdBy.fullName}</Td><Td right><form action={deleteEntry.bind(null, r.id)}><button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50" title="O'chirish"><Trash2 size={12} /></button></form></Td></Tr>
              ); })}
            </tbody>
          </Table>
        </Panel>
        <Why label="Yozuv turlari"><p><b>Byudjet</b> — oy boshida kanalga ajratilgan pul (rejalashtirilgan xarajat). <b>Reja</b> — shu oyda kanaldan kutilayotgan natija: xarajat, leadlar, mijozlar, daromad. <b>Fakt</b> — oy yakunida haqiqiy raqamlar.</p><p>Xatoni tuzatish uchun yozuvni o'chirib qaytadan kiriting. Har o'zgarish audit jurnaliga tushadi.</p></Why>
      </div>
    </BiPage>
  );
}
