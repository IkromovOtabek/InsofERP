import type { Panel } from "@/lib/fin-report/panel";
import { fmtNum, moneyShort, pct } from "@/lib/format";
import { Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * «INSOF MCHJ — BOSHQARUV PANELI» bloklari («Insof 2026» → Dashboard) — atamalar va ustunlar jadvaldagidek.
 * Ma'lumot — `lib/fin-report/panel.ts`. Server komponenti; «Bugun» tabida ishlatiladi.
 */
const n0 = (v: number | null | undefined) => (v === null || v === undefined || Math.abs(v) < 0.005 ? "–" : fmtNum(v));
const n1 = (v: number) => (Math.abs(v) < 0.0005 ? "–" : fmtNum(v, 1));
const neg = (v: number) => (v < 0 ? "text-red-600" : undefined);

function Block({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0", className)}>
      <h3 className="mb-2 rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-white">{title}</h3>
      {children}
    </section>
  );
}

const TotalTr = ({ children }: { children: React.ReactNode }) => <tr className="bg-slate-50 font-bold text-slate-900 [&>td]:border-t [&>td]:border-slate-200 [&>td]:px-4 [&>td]:py-2.5 [&>td:not(:first-child)]:whitespace-nowrap">{children}</tr>;

export function PulQoldiqlari({ p }: { p: Panel }) {
  const t = p.accounts.reduce((s, a) => ({ open: s.open + a.open, inToday: s.inToday + a.inToday, outToday: s.outToday + a.outToday, inMonth: s.inMonth + a.inMonth, outMonth: s.outMonth + a.outMonth, balance: s.balance + a.balance }), { open: 0, inToday: 0, outToday: 0, inMonth: 0, outMonth: 0, balance: 0 });
  return (
    <Block title="Pul qoldiqlari (kassa va bank hisoblari)">
      <Table>
        <thead><tr><Th>Hisob</Th><Th right>Oy boshi</Th><Th right>Bugun kirim</Th><Th right>Bugun chiqim</Th><Th right>Oy kirim</Th><Th right>Oy chiqim</Th><Th right>Hozirgi qoldiq</Th></tr></thead>
        <tbody>
          {p.accounts.map((a) => (
            <Tr key={a.id}><Td>{a.name}</Td><Td right>{n0(a.open)}</Td><Td right>{n0(a.inToday)}</Td><Td right>{n0(a.outToday)}</Td><Td right>{n0(a.inMonth)}</Td><Td right>{n0(a.outMonth)}</Td><Td right className={cn("font-semibold", neg(a.balance))}>{n0(a.balance)}</Td></Tr>
          ))}
          <tr className="text-[13px] italic text-slate-500 [&>td]:border-t [&>td]:border-slate-100 [&>td]:px-4 [&>td]:py-2">
            <td>Ichki o&apos;tkazmalar (hisobdan hisobga, naqd yechish, inkassa, pul aylantirish) — oborotga kirmaydi</td>
            <td /><td className="text-right">{n0(p.transfers.inToday)}</td><td className="text-right">{n0(p.transfers.outToday)}</td><td className="text-right">{n0(p.transfers.inMonth)}</td><td className="text-right">{n0(p.transfers.outMonth)}</td><td />
          </tr>
          <TotalTr><td>JAMI</td><td className="text-right">{n0(t.open)}</td><td className="text-right">{n0(t.inToday)}</td><td className="text-right">{n0(t.outToday)}</td><td className="text-right">{n0(t.inMonth)}</td><td className="text-right">{n0(t.outMonth)}</td><td className="text-right">{n0(t.balance)}</td></TotalTr>
        </tbody>
      </Table>
    </Block>
  );
}

export function SotuvBlock({ p }: { p: Panel }) {
  const t = p.salesTotal;
  return (
    <Block title="Sotuv (Realizatsiya, QQS bilan)">
      <Table>
        <thead><tr><Th>Guruh</Th><Th right>Bugun miqdor</Th><Th right>Bugun summa</Th><Th right>Oy miqdor</Th><Th right>Oy summa</Th><Th right>Oy ulushi</Th><Th right>O&apos;rtacha narx (oy)</Th></tr></thead>
        <tbody>
          {p.sales.length === 0 && <tr><td colSpan={7} className="px-4 py-3 text-sm text-slate-500">Oy boshidan yetkazilgan sotuv yo&apos;q</td></tr>}
          {p.sales.map((s) => (
            <Tr key={s.group}><Td>{s.group}</Td><Td right>{n1(s.qtyToday)}</Td><Td right>{n0(s.sumToday)}</Td><Td right>{n1(s.qtyMonth)}</Td><Td right>{n0(s.sumMonth)}</Td><Td right>{pct(s.share)}</Td><Td right>{n0(s.avgPrice)}</Td></Tr>
          ))}
          <TotalTr><td>JAMI</td><td className="text-right">{n1(t.qtyToday)}</td><td className="text-right">{n0(t.sumToday)}</td><td className="text-right">{n1(t.qtyMonth)}</td><td className="text-right">{n0(t.sumMonth)}</td><td className="text-right">{t.sumMonth ? pct(100) : "–"}</td><td /></TotalTr>
          <tr className="text-[13px] italic text-slate-500 [&>td]:border-t [&>td]:border-slate-100 [&>td]:px-4 [&>td]:py-2">
            <td colSpan={2}>Naqd sotuv / kassaga «Savdo tushumi» (oy)</td>
            <td className="text-right">{n0(p.cashSales.sales)}</td><td /><td className="text-right">{n0(p.cashSales.cashIn)}</td><td className="text-right">Farq:</td>
            <td className={cn("text-right font-semibold not-italic", p.cashSales.diff > 0 ? "text-red-600" : "text-slate-700")}>{n0(p.cashSales.diff)}</td>
          </tr>
        </tbody>
      </Table>
    </Block>
  );
}

export function IshlabChiqarishBlock({ p }: { p: Panel }) {
  const t = p.productionTotal;
  return (
    <Block title="Ishlab chiqarish va tayyor mahsulot ombori">
      <Table>
        <thead><tr><Th>Guruh</Th><Th right>Bugun ishlab chiq.</Th><Th right>Oy ishlab chiq.</Th><Th right>Oy boshi qoldiq</Th><Th right>Oy jo&apos;natildi</Th><Th right>Qoldiq soni</Th><Th right>Qoldiq (tannarxda)</Th><Th right>Qoldiq (sotuv narxida)</Th></tr></thead>
        <tbody>
          {p.production.map((r) => (
            <Tr key={r.group}><Td>{r.group}</Td><Td right>{n1(r.producedToday)}</Td><Td right>{n1(r.producedMonth)}</Td><Td right>{n1(r.openQty)}</Td><Td right>{n1(r.shippedMonth)}</Td><Td right className="font-semibold">{n1(r.qty)}</Td><Td right>{n0(r.valueCost)}</Td><Td right>{n0(r.valuePrice)}</Td></Tr>
          ))}
          <Tr><Td>Beton, m3 (sotilgani = ishlab chiqarilgani)</Td><Td right>{n1(p.concrete.today)}</Td><Td right>{n1(p.concrete.month)}</Td><Td right>–</Td><Td right>{n1(p.concrete.month)}</Td><Td right>–</Td><Td right>–</Td><Td right>–</Td></Tr>
          <TotalTr><td>JAMI buyumlar (dona, betonsiz)</td><td className="text-right">{n1(t.producedToday)}</td><td className="text-right">{n1(t.producedMonth)}</td><td className="text-right">{n1(t.openQty)}</td><td className="text-right">{n1(t.shippedMonth)}</td><td className="text-right">{n1(t.qty)}</td><td className="text-right">{n0(t.valueCost)}</td><td className="text-right">{n0(t.valuePrice)}</td></TotalTr>
        </tbody>
      </Table>
    </Block>
  );
}

export function XomAshyoBlock({ p }: { p: Panel }) {
  return (
    <Block title="Xom-ashyo skladi">
      <Table>
        <thead><tr><Th>Material</Th><Th right>Oy boshi</Th><Th right>Keldi</Th><Th right>Sarflandi</Th><Th right>Qoldiq</Th><Th right>Narx</Th><Th right>Qoldiq summasi</Th><Th right>Normadan farq</Th></tr></thead>
        <tbody>
          {p.materials.length === 0 && <tr><td colSpan={8} className="px-4 py-3 text-sm text-slate-500">Retseptdagi xom-ashyo bo&apos;yicha harakat yo&apos;q</td></tr>}
          {p.materials.map((m) => (
            <Tr key={m.id}>
              <Td>{m.name} <span className="text-[12px] font-normal text-slate-400">{m.unit}</span></Td>
              <Td right>{n1(m.open)}</Td><Td right>{n1(m.received)}</Td><Td right>{n1(m.consumed)}</Td><Td right className={cn("font-semibold", neg(m.balance))}>{n1(m.balance)}</Td>
              <Td right>{n0(m.price)}</Td><Td right>{n0(m.value)}</Td>
              <Td right className={m.normDevPct !== null && m.normDevPct > 0 ? "text-red-600" : undefined}>{m.normDevPct === null ? "–" : pct(m.normDevPct)}</Td>
            </Tr>
          ))}
          <TotalTr><td>Jami xom-ashyo qoldig&apos;i</td><td className="text-right">{n0(p.materialsTotal.open)}</td><td /><td /><td /><td /><td className="text-right">{n0(p.materialsTotal.balance)}</td><td /></TotalTr>
          <tr className="text-[13px] italic text-slate-500 [&>td]:border-t [&>td]:border-slate-100 [&>td]:px-4 [&>td]:py-2"><td colSpan={6}>Zapchast va boshqa tovarlar kirimi (Ombor, oy)</td><td className="text-right">{n0(p.spareParts)}</td><td /></tr>
        </tbody>
      </Table>
    </Block>
  );
}

export function QarzlarBlock({ p }: { p: Panel }) {
  const d = p.debts;
  const rowsD: [string, [number, number]][] = [["Mijozlar (naqd)", d.cashCustomers], ["Mijozlar (perechisleniye)", d.bankCustomers], ["Ta'minotchilar va bank kreditlari", d.suppliers]];
  return (
    <Block title="Qarzlar: haqdorlik va qarzdorlik">
      <Table>
        <thead><tr><Th>Kim bilan</Th><Th right>Bizga qarz (haqdorlik)</Th><Th right>Bizning qarzimiz</Th><Th right>Sof (+ bizga, − bizdan)</Th></tr></thead>
        <tbody>
          {rowsD.map(([k, v]) => <Tr key={k}><Td>{k}</Td><Td right>{n0(v[0])}</Td><Td right>{n0(v[1])}</Td><Td right className={neg(v[0] - v[1])}>{n0(v[0] - v[1])}</Td></Tr>)}
          <TotalTr><td>JAMI</td><td className="text-right">{n0(d.total[0])}</td><td className="text-right">{n0(d.total[1])}</td><td className={cn("text-right", neg(d.total[0] - d.total[1]))}>{n0(d.total[0] - d.total[1])}</td></TotalTr>
          <tr className="text-[13px] italic text-slate-500 [&>td]:border-t [&>td]:border-slate-100 [&>td]:px-4 [&>td]:py-2"><td>shundan bank kreditlari</td><td /><td className="text-right">{n0(d.bankLoans)}</td><td /></tr>
        </tbody>
      </Table>
    </Block>
  );
}

export function FoydaZararBlock({ p }: { p: Panel }) {
  const x = p.pnl;
  const rowsP: [string, number, boolean?][] = [
    ["Daromad (QQSsiz)", x.income], ["Sotuv tannarxi", x.cogs], ["Yalpi foyda", x.gross], ["Operatsion foyda", x.operating],
    ["Zavod sof foydasi", x.net, true], ["Loyihalar", x.projects], ["Divident", x.dividend], ["Taqsimlanmagan foyda", x.retained, true],
  ];
  return (
    <Block title="Foyda va zarar (oy, «PNL» dan)">
      <Table>
        <thead><tr><Th>Ko&apos;rsatkich</Th><Th right>Summa</Th><Th right>Daromadga nisbatan</Th></tr></thead>
        <tbody>
          {rowsP.map(([k, v, bold]) => (
            <Tr key={k} className={bold ? "bg-slate-50 font-bold" : undefined}><Td>{k}</Td><Td right className={neg(v)}>{n0(v)}</Td><Td right className={neg(v)}>{x.income ? pct((v / x.income) * 100) : "–"}</Td></Tr>
          ))}
        </tbody>
      </Table>
    </Block>
  );
}

/** «Kunlik sotuv va tushum (oy)» — jadval va ikki ustunli grafik (sotuv QQS bilan / kassaga savdo tushumi). */
export function KunlikBlock({ p }: { p: Panel }) {
  const dd = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  return (
    <Block title="Kunlik sotuv va tushum (oy)">
      <Table maxHeight="28rem">
        <thead><tr><Th>Sana</Th><Th right>Sotuv (QQS bilan)</Th><Th right>Kassaga savdo tushumi</Th></tr></thead>
        <tbody>
          {p.daily.map((d) => <Tr key={d.date.toISOString()}><Td>{dd(d.date)}</Td><Td right>{n0(d.sales)}</Td><Td right>{n0(d.cashIn)}</Td></Tr>)}
        </tbody>
      </Table>
    </Block>
  );
}

export function KunlikChart({ p }: { p: Panel }) {
  const W = 760, H = 220, L = 64, R = 10, T = 12, B = 34;
  const max = Math.max(1, ...p.daily.flatMap((d) => [d.sales, d.cashIn]));
  const step = (W - L - R) / Math.max(1, p.daily.length);
  const bw = Math.max(2, step / 2 - 2);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const dd = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  return (
    <section className="min-w-0 rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card)">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-slate-800">Kunlik sotuv va kassaga savdo tushumi</h3>
        <div className="flex gap-3 text-[12px] text-slate-600"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500" />Sotuv (QQS bilan)</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />Kassaga savdo tushumi</span></div>
      </div>
      <div className="overflow-x-auto"><svg viewBox={`0 0 ${W} ${H}`} width="100%" className="min-w-[560px]" role="img" aria-label="Kunlik sotuv va kassaga savdo tushumi">
        {ticks.map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-slate-200" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{moneyShort(t)}</text></g>
        ))}
        {p.daily.map((d, i) => {
          const x = L + i * step + 1;
          return (
            <g key={i}>
              {d.sales > 0 && <rect x={x} y={y(d.sales)} width={bw} height={H - B - y(d.sales)} rx={1.5} className="fill-blue-500"><title>{`${dd(d.date)}: sotuv ${fmtNum(d.sales)}`}</title></rect>}
              {d.cashIn > 0 && <rect x={x + bw + 1} y={y(d.cashIn)} width={bw} height={H - B - y(d.cashIn)} rx={1.5} className="fill-emerald-500"><title>{`${dd(d.date)}: kassaga ${fmtNum(d.cashIn)}`}</title></rect>}
              {(i % 3 === 0 || i === p.daily.length - 1) && <text x={x + bw} y={H - B + 14} textAnchor="middle" className="fill-slate-400 text-[10px]">{dd(d.date)}</text>}
            </g>
          );
        })}
      </svg></div>
    </section>
  );
}
