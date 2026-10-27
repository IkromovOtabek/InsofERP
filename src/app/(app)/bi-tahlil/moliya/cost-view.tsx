import Link from "next/link";
import { Calculator, Coins, Factory, Percent, Scale, Settings2, TrendingUp, Truck, Wallet } from "lucide-react";
import { type CostSheet, type ItemCost, type ProductProfit, COEF_GROUPS, isVolumeUnit } from "@/lib/fin-report/cost";
import { type MonthKey, addMonths, monthKeyOf } from "@/lib/fin-report/period";
import { loadCategories, toTree } from "@/lib/fin-report/categories";
import { MONTHS_UZ } from "@/lib/bi/plans";
import { fmtNum, moneyShort, pct } from "@/lib/format";
import { Card, CardHeader, Empty, Section, Select, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { CostCategoryToggle, CostMonthForm, GroupWageForm } from "./cost-forms";

/**
 * Tahlil → Moliya: «Tannarx hisobi» va «Mahsulot foydasi» — «Insof 2026» jadvalidagi varaqlar ko'rinishida.
 * Hisob — `lib/fin-report/cost.ts`; sozlamalar (koeffitsiyent, stavka, brigada ish haqi, tannarxga kiradigan xarajatlar) —
 * buxgalteriya (`moliya.cost`). URL: `oy` (YYYY-MM).
 */
export const monthTitle = (m: MonthKey) => `${MONTHS_UZ[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

const N = ({ v, className }: { v: number | null; className?: string }) => (v === null ? <span className="text-slate-300">—</span> : Math.abs(v) < 0.5 ? <span className="text-slate-300">–</span> : <span className={className}>{fmtNum(v)}</span>);
const Neg = ({ v }: { v: number }) => (v < 0 ? <span className="text-red-600">({fmtNum(-v)})</span> : <span>{fmtNum(v)}</span>);
const coefStr = (v: number | null) => (v === null ? "—" : fmtNum(v, 3));

/** Marja rangi — jadvaldagidek: past (< 15%) qizil, yuqori (≥ 35%) yashil. */
function Margin({ v }: { v: number | null }) {
  if (v === null) return <span className="text-slate-300">—</span>;
  return <span className={cn("rounded px-1.5 py-0.5", v < 15 ? "bg-red-50 font-semibold text-red-600" : v >= 35 ? "bg-emerald-50 text-emerald-700" : "")}>{pct(v)}</span>;
}

/** Oy tanlash: oldingi / keyingi oy va kalendar. */
export function MonthBar({ base, month, excel }: { base: string; month: MonthKey; excel?: React.ReactNode }) {
  const cur = monthKeyOf(new Date());
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <Link href={`${base}?oy=${addMonths(month, -1)}`} className="h-9 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:bg-slate-50">← {monthTitle(addMonths(month, -1))}</Link>
      <Select name="oy" defaultValue={month} className="h-9 w-48">
        {Array.from({ length: 24 }, (_, i) => addMonths(cur, -i)).map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
      </Select>
      <button className="h-9 rounded-lg bg-slate-900 px-3 font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
      {month < cur && <Link href={`${base}?oy=${addMonths(month, 1)}`} className="h-9 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-600 hover:bg-slate-50">{monthTitle(addMonths(month, 1))} →</Link>}
      <span className="ml-auto" />
      {excel}
    </form>
  );
}

// ───────────────────────── Tannarx hisobi ─────────────────────────

export async function CostSheetView({ s, base, canWrite }: { s: CostSheet; base: string; canWrite: boolean }) {
  const pieces = s.items.filter((i) => !isVolumeUnit(i.unit));
  const volume = s.items.filter((i) => isVolumeUnit(i.unit));
  const cats = canWrite ? toTree(await loadCategories(), { type: "EXPENSE" }) : [];
  const over = s.normDiff, overPct = s.normTotal > 0 ? (s.normDiff / s.normTotal) * 100 : null;

  const sheets = [
    { name: "Kelgan xom-ashyo", rows: s.arrivals.map((a) => ({ Guruh: a.group, "Ta'minotchi": a.supplier, "Keldi (QQS bilan)": a.gross, "QQS bor?": a.hasVat ? "ha" : "yo'q", QQSsiz: a.net, Manba: a.source === "cash" ? "kassa" : "kirim hujjati" })) },
    { name: "Guruhlar", rows: s.groups.map((g) => ({ Guruh: g.group, "Keldi (QQSsiz)": g.arrived, "Norma bo'yicha kerak edi": g.norm, Farq: g.diff, Koeffitsiyent: g.coef })) },
    { name: "Ishlab chiqarish xarajatlari", rows: s.overhead.map((o) => ({ Xarajat: o.name, Summa: o.amount })) },
    { name: "Tannarx (1 birlik)", rows: s.items.map((i) => ({ Mahsulot: i.name, "O'lchov": i.unit, "Ishlab chiqarildi": i.produced, Sotildi: i.sold, "Xom-ashyo (1)": i.material, "Brigada ish haqi (1)": i.wage, "Ishlab chiq. xarajati (1)": i.overhead, "TANNARX (1)": i.unitCost, "O'rtacha sotuv narxi (QQSsiz)": i.price, "Foyda (1)": i.profit, "Marja, %": i.margin })) },
  ];

  return (
    <div>
      <MonthBar base={base} month={s.month} excel={<ExcelButton file={`Tannarx hisobi ${s.month}`} sheets={sheets} />} />
      <p className="mb-4 max-w-4xl text-[13px] text-slate-500">
        Xom-ashyo — norma yoki hisobotdagi narxdan emas, oy davomida ta&apos;minotchilardan <b>haqiqatda kelgan</b> xom-ashyodan ({s.vatPayer ? "QQSsiz" : "QQS bilan — korxona QQS to'lovchisi emas"}).
        Tayyor mahsulot omborida ko&apos;paygan qismi ayiriladi, xom-ashyo skladi qoldig&apos;i o&apos;zgarishi hisobga olinadi. Ehtiyot qism, yoqilg&apos;i kabi xom-ashyo bo&apos;lmagan kirimlar kirmaydi.
      </p>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Kelgan xom-ashyo (QQSsiz)" value={moneyShort(s.arrivedNet)} hint={fmtNum(s.arrivedNet)} icon={Truck} />
        <StatCard label="Tannarxga kirgan xom-ashyo" value={moneyShort(s.consumed)} hint={fmtNum(s.consumed)} icon={Factory} />
        <StatCard label="Koeffitsiyent (haqiqiy ÷ norma)" value={coefStr(s.coefTotal)} hint={overPct !== null ? `normadan ${over < 0 ? "kam" : "ortiq"} ${pct(Math.abs(overPct))}` : "sotuv yo'q"} icon={Scale} tone={s.coefTotal !== null && s.coefTotal > 1.05 ? "warning" : "default"} />
        <StatCard label="Ishlab chiqarish xarajatlari stavkasi" value={pct(s.overheadPct)} hint={`${fmtNum(s.overheadTotal)} xom-ashyoga nisbatan`} icon={Percent} />
      </div>

      <Section title={`1. ${monthTitle(s.month)}da kelgan xom-ashyo`}>
        <Table maxHeight="60vh">
          <thead><tr><Th>Guruh</Th><Th>Ta&apos;minotchi</Th><Th right>Keldi (QQS bilan)</Th><Th>QQS bor?</Th><Th right>{s.vatPayer ? "QQSsiz" : "Tannarxga"}</Th><Th>Manba</Th></tr></thead>
          <tbody>
            {s.arrivals.length === 0 && <Empty text="Shu oyda xom-ashyo kirimi yo'q" />}
            {s.arrivals.map((a, k) => (
              <Tr key={k}>
                <Td className="text-slate-500">{a.group}</Td>
                <Td>{a.supplierId ? <Link href={`/suppliers/${a.supplierId}`} className="hover:underline">{a.supplier}</Link> : a.supplier}</Td>
                <Td right>{fmtNum(a.gross)}</Td>
                <Td>{a.hasVat ? "ha" : "yo'q"}</Td>
                <Td right className="font-medium">{fmtNum(a.net)}</Td>
                <Td className="text-[13px] italic text-slate-500">{a.source === "cash" ? "kassa" : "kirim hujjati"}</Td>
              </Tr>
            ))}
            {s.arrivals.length > 0 && <Tr className="bg-violet-50/60 font-semibold"><Td>Jami keldi</Td><Td /><Td right>{fmtNum(s.arrivedGross)}</Td><Td /><Td right>{fmtNum(s.arrivedNet)}</Td><Td /></Tr>}
          </tbody>
        </Table>
      </Section>

      <Section title="Guruhlar bo'yicha">
        <Table>
          <thead><tr><Th>Guruh</Th><Th right>Keldi ({s.vatPayer ? "QQSsiz" : "QQS bilan"})</Th><Th right>Norma bo&apos;yicha kerak edi</Th><Th right>Farq</Th><Th right>Koeffitsiyent</Th></tr></thead>
          <tbody>
            {s.groups.length === 0 && <Empty text="Ma'lumot yo'q" />}
            {s.groups.map((g) => (
              <Tr key={g.group}>
                <Td>{g.group}</Td>
                <Td right>{fmtNum(g.arrived)}</Td>
                <Td right>{g.norm ? fmtNum(g.norm) : <span className="text-[13px] italic text-slate-400">normada yo&apos;q</span>}</Td>
                <Td right>{g.norm ? <Neg v={g.diff} /> : "—"}</Td>
                <Td right className="font-semibold">{coefStr(g.coef)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-2 text-[13px] text-slate-500">Norma — sotilgan beton va buyumga (retsept × oyning o&apos;rtacha xarid narxi); kelgani — ishlab chiqarilgan hamma narsaga.</p>
      </Section>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <Section title="2. Tannarxga kirgan xom-ashyo">
          <Card>
            <dl className="divide-y divide-slate-100 text-sm">
              {([
                ["Kelgan xom-ashyo", <span key="a">{fmtNum(s.arrivedNet)}</span>, "font-semibold"],
                ["− Tayyor mahsulot omborida ko'paydi (materiali, norma bo'yicha)", <Neg key="b" v={-s.finishedIncrease} />],
                ["± Xom-ashyo skladida qoldiq o'zgarishi (sklad kamaysa — qo'shiladi)", <Neg key="c" v={s.rawStockChange} />],
                ["TANNARXGA KIRGAN XOM-ASHYO", <span key="d">{fmtNum(s.consumed)}</span>, "bg-violet-50/60 font-bold"],
                ["Norma bo'yicha (sotilganga)", <span key="e">{fmtNum(s.normTotal)}</span>],
                [`Normadan ortiq sarf / narx farqi${overPct !== null ? ` (${pct(overPct)})` : ""}`, <Neg key="f" v={over} />],
                ["Koeffitsiyent (haqiqiy ÷ norma)", <span key="g">{coefStr(s.coefTotal)}</span>, "font-semibold"],
              ] as [string, React.ReactNode, string?][]).map(([k, v, cls]) => (
                <div key={k} className={cn("flex items-baseline justify-between gap-3 px-1 py-2", cls)}>
                  <dt className="min-w-0 text-slate-600">{k}</dt><dd className="shrink-0 tabular">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </Section>

        <Section title="3. Ishlab chiqarish xarajatlari (buyumlarga taqsimlanadi)">
          <Card>
            <dl className="divide-y divide-slate-100 text-sm">
              {s.overhead.length === 0 && <div className="py-2 text-slate-400">Tannarxga kiradigan xarajat yo&apos;q</div>}
              {s.overhead.map((o) => <div key={o.name} className="flex justify-between gap-3 px-1 py-2"><dt className="text-slate-600">{o.name}</dt><dd className="tabular">{fmtNum(o.amount)}</dd></div>)}
              <div className="flex justify-between gap-3 bg-violet-50/60 px-1 py-2 font-bold"><dt>Jami ishlab chiqarish xarajatlari</dt><dd className="tabular">{fmtNum(s.overheadTotal)}</dd></div>
              <div className="flex justify-between gap-3 px-1 py-2"><dt className="text-slate-600">Xom-ashyoga nisbatan stavka</dt><dd className="font-semibold tabular">{pct(s.overheadPct)}</dd></div>
            </dl>
            <p className="mt-2 text-[13px] text-slate-500">Har bir buyumga materiali qiymatiga qarab taqsimlanadi. Transport, ma&apos;muriy, bank, soliq, kredit — davr xarajati, buyum tannarxiga kirmaydi.</p>
            {canWrite && (
              <details className="mt-3 rounded-lg border border-slate-200 p-3">
                <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-slate-700"><Settings2 size={15} /> Qaysi xarajatlar tannarxga kiradi</summary>
                <div className="mt-2 grid gap-0.5 sm:grid-cols-2">
                  {cats.map((t) => (
                    <div key={t.id}>
                      <CostCategoryToggle id={t.id} name={t.name} on={t.inCost} />
                      {t.children.map((c) => <CostCategoryToggle key={c.id} id={c.id} name={c.name} on={c.inCost} sub />)}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-slate-400">Manba belgilansa — hamma sub manbalari kiradi. Brigada (sdelka) ish haqini belgilamang: u buyumga alohida qo&apos;shiladi.</p>
              </details>
            )}
          </Card>
        </Section>
      </div>

      <Section title="4. Buyum tannarxi (1 dona)">
        <ItemTable items={pieces} piece />
      </Section>
      <Section title="5. Beton tannarxi (1 m³)">
        <ItemTable items={volume} />
        <p className="mt-2 text-[13px] text-slate-500">Sotuv narxi — shu oyda o&apos;rtacha qanchadan sotilgani (QQSsiz, dostavkasiz). Beton narxida yetkazib berish bo&apos;lsa — transport xarajati bu yerda emas.</p>
      </Section>
    </div>
  );
}

function ItemTable({ items, piece }: { items: ItemCost[]; piece?: boolean }) {
  return (
    <Table maxHeight="70vh">
      <thead>
        <tr>
          <Th>Mahsulot</Th>{piece && <Th right>Ishlab chiq.</Th>}<Th right>{piece ? "Sotildi" : "Sotildi, m³"}</Th><Th right>Xom-ashyo (1)</Th>{piece && <Th right>Brigada ish haqi (1)</Th>}
          <Th right>Ishlab chiq. xarajati</Th><Th right>TANNARX (1)</Th><Th right>O&apos;rtacha sotuv narxi (QQSsiz)</Th><Th right>Foyda (1)</Th><Th right>Marja</Th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && <Empty text="Shu oyda ishlab chiqarilgan yoki sotilgan mahsulot yo'q" />}
        {items.map((i) => (
          <Tr key={i.productId}>
            <Td>{i.name}{i.material === null && <div className="text-[12px] font-normal text-amber-600">retsepti yoki xom-ashyo narxi yo&apos;q</div>}</Td>
            {piece && <Td right><N v={i.produced} /></Td>}
            <Td right><N v={i.sold} /></Td>
            <Td right><N v={i.material} /></Td>
            {piece && <Td right><N v={i.wage} /></Td>}
            <Td right><N v={i.overhead} /></Td>
            <Td right className="bg-amber-50 font-bold"><N v={i.unitCost} /></Td>
            <Td right><N v={i.price} /></Td>
            <Td right className={i.profit !== null && i.profit < 0 ? "text-red-600" : undefined}><N v={i.profit} /></Td>
            <Td right><Margin v={i.margin} /></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

// ───────────────────────── Mahsulot foydasi ─────────────────────────

export function ProductProfitView({ p, base, canWrite }: { p: ProductProfit; base: string; canWrite: boolean }) {
  const prm = p.params;
  const sheets = [
    { name: "Mahsulotlar", rows: p.items.map((i) => ({ Guruh: i.group, Mahsulot: i.name, "O'lchov": i.unit, Sotildi: i.sold, "Tushum, so'm": i.revenue, "O'rtacha narx": i.price, "Tannarx (1 birlik)": i.unitCost, "Jami tannarx": i.unitCost !== null ? Math.round(i.unitCost * i.sold) : null, "Foyda, so'm": i.profit !== null ? Math.round(i.profit * i.sold) : null, "Marja, %": i.margin, "1 birlikdan foyda": i.profit })) },
    { name: "Guruhlar", rows: p.groups.map((g) => ({ Guruh: g.group, "Tushum, so'm": g.revenue, "Foyda, so'm": g.profit, "Marja, %": g.margin })) },
  ];
  const sourceNote = prm.source === prm.month ? `${monthTitle(prm.month)} oyining tannarx hisobidan` : `o'tgan oy (${monthTitle(prm.source)}) tannarx hisobidan — joriy oy hali yopilmagan`;

  return (
    <div>
      <MonthBar base={base} month={p.month} excel={<ExcelButton file={`Mahsulot foydasi ${p.month}`} sheets={sheets} />} />
      <p className="mb-4 max-w-4xl text-[13px] text-slate-500">
        Tannarx (1 birlik) = norma bo&apos;yicha xom-ashyo (QQSsiz narxda) × haqiqiy/norma koeffitsiyenti + ishlab chiqarish xarajatlari (xom-ashyoning %) + brigada ish haqi.
        Tushum — QQSsiz va dostavkasiz: zayavkada alohida yozilgan dostavka ayirilgan. Koeffitsiyentlar — {sourceNote}.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Tushum (mahsulot, QQSsiz)" value={moneyShort(p.revenue)} hint={fmtNum(p.revenue)} icon={Wallet} />
        <StatCard label="Tannarx" value={moneyShort(p.cost)} hint={fmtNum(p.cost)} icon={Calculator} />
        <StatCard label="Yalpi foyda" value={moneyShort(p.profit)} hint={fmtNum(p.profit)} icon={TrendingUp} tone={p.profit < 0 ? "danger" : "success"} />
        <StatCard label="O'rtacha marja" value={p.margin !== null ? pct(p.margin) : "—"} icon={Percent} />
        <StatCard label="Dostavka tushumi" value={moneyShort(p.delivery)} hint="zayavkadagi «Доставка», tushumga kirmagan" icon={Truck} />
      </div>
      {p.uncostedRevenue > 0 && <p className="mt-2 text-[13px] text-amber-700">Retsepti yoki xom-ashyo narxi yo&apos;q mahsulotlar tushumi ({fmtNum(p.uncostedRevenue)}) jamiga kirmadi.</p>}

      <div className="mt-6">
          <Table maxHeight="80vh">
            <thead>
              <tr>
                <Th>Guruh</Th><Th>Mahsulot</Th><Th>O&apos;lchov</Th><Th right>Sotildi</Th><Th right>Tushum, so&apos;m</Th><Th right>O&apos;rtacha narx</Th>
                <Th right>Tannarx (1 birlik)</Th><Th right>Jami tannarx</Th><Th right>Foyda, so&apos;m</Th><Th right>Marja</Th><Th right>1 birlikdan foyda</Th>
              </tr>
            </thead>
            <tbody>
              {p.items.length === 0 && <Empty text="Shu oyda sotuv yo'q" icon={Coins} />}
              {p.items.map((i) => (
                <Tr key={i.productId}>
                  <Td className="whitespace-nowrap text-slate-500">{i.group}</Td>
                  <Td className="whitespace-nowrap">{i.name}</Td>
                  <Td className="text-slate-500">{i.unit}</Td>
                  <Td right>{fmtNum(i.sold, 2)}</Td>
                  <Td right>{fmtNum(i.revenue)}</Td>
                  <Td right><N v={i.price} /></Td>
                  <Td right><N v={i.unitCost} /></Td>
                  <Td right><N v={i.unitCost !== null ? i.unitCost * i.sold : null} /></Td>
                  <Td right className={cn("font-bold", i.profit !== null && i.profit < 0 && "text-red-600")}><N v={i.profit !== null ? i.profit * i.sold : null} /></Td>
                  <Td right><Margin v={i.margin} /></Td>
                  <Td right><N v={i.profit} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
      </div>
      <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title="Guruhlar" />
            <Table>
              <thead><tr><Th>Guruh</Th><Th right>Tushum</Th><Th right>Foyda</Th><Th right>Marja</Th></tr></thead>
              <tbody>
                {p.groups.map((g) => <Tr key={g.group}><Td>{g.group}</Td><Td right>{fmtNum(g.revenue)}</Td><Td right>{fmtNum(g.profit)}</Td><Td right><Margin v={g.margin} /></Td></Tr>)}
                {p.groups.length > 0 && <Tr className="bg-slate-50 font-semibold"><Td>Jami</Td><Td right>{fmtNum(p.revenue)}</Td><Td right>{fmtNum(p.profit)}</Td><Td right>{p.margin !== null ? pct(p.margin) : "—"}</Td></Tr>}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Sozlamalar" icon={Settings2} description="Koeffitsiyent = haqiqatda kelgan ÷ norma bo'yicha kerak («Tannarx hisobi»)" />
            {canWrite ? (
              <CostMonthForm month={p.month} groups={COEF_GROUPS} coefs={prm.coefs} manualCoefs={prm.manual.coefs} autoCoefs={prm.autoCoefs} overheadPct={prm.overheadPct} autoPct={prm.autoPct} manualPct={prm.manual.overheadPct} />
            ) : (
              <dl className="divide-y divide-slate-100 text-sm">
                {COEF_GROUPS.map((g) => <div key={g} className="flex justify-between py-1.5"><dt className="text-slate-600">{g}</dt><dd className="tabular">{fmtNum(prm.coefs[g] ?? 1, 3)}</dd></div>)}
                <div className="flex justify-between py-1.5"><dt className="text-slate-600">Ishlab chiqarish xarajatlari</dt><dd className="tabular">{pct(prm.overheadPct)}</dd></div>
              </dl>
            )}
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
              <div className="text-[13px] font-medium text-slate-700">Brigada ish haqi (mahsulotda «sdelka» narxi bo&apos;lmasa)</div>
              {p.wageGroups.map((w) => canWrite
                ? <GroupWageForm key={w.id} groupId={w.id} name={w.name} value={w.pieceRate} />
                : <div key={w.id} className="flex justify-between text-sm"><span className="text-slate-600">{w.name}</span><span className="tabular">{w.pieceRate != null ? fmtNum(w.pieceRate) : "—"}</span></div>)}
            </div>
            <p className="mt-3 text-[12px] text-slate-400"><Link href={`/bi-tahlil/moliya/tannarx?oy=${prm.source}`} className="underline">Tannarx hisobi</Link> sahifasida koeffitsiyent qanday chiqqani ko&apos;rinadi.</p>
          </Card>
      </div>
    </div>
  );
}
