import Link from "next/link";
import { Boxes, Factory, Package, Recycle, Scale, Search, TriangleAlert } from "lucide-react";
import type { FinishedReport, RawBalance, RawRow } from "@/lib/fin-report/sklad";
import type { SP } from "../shell";
import { fmtNum, isoDate, moneyShort, pct } from "@/lib/format";
import { Badge, Card, CardHeader, Input, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { MonthBar, monthTitle } from "../month-bar";

/** Tahlil → Ombor: «Insof 2026» sklad varaqlari (`lib/fin-report/sklad.ts`). */
const N = ({ v, frac = 0, className }: { v: number | null; frac?: number; className?: string }) =>
  v == null || Math.abs(v) < (frac ? 0.0005 : 0.5) ? <span className="text-slate-300">—</span> : <span className={className}>{fmtNum(v, frac)}</span>;
const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
/** «YYYY-MM» oyining oxirgi kuni (YYYY-MM-DD). */
const monthEnd = (m: string) => isoDate(new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0));
const qs = (o: Record<string, string | undefined>) => { const s = new URLSearchParams(Object.entries(o).filter((kv): kv is [string, string] => !!kv[1])).toString(); return s ? `?${s}` : ""; };

// ───────────────────── Xom-ashyo balansi ─────────────────────

const diffCls = (r: Pick<RawRow, "diff" | "diffPct">) => (r.diffPct == null || Math.abs(r.diffPct) < 2 ? "" : r.diff > 0 ? "font-semibold text-red-600" : "font-semibold text-amber-700");
/** Holat filtri (`holat`): normadan ortiq / kam sarf (±2% — `diffCls` bilan bir xil chegara). */
const RAW_STATE = { ortiq: "Normadan ortiq", kam: "Normadan kam", norma: "Normada" } as const;
type RawState = keyof typeof RAW_STATE;
const rawState = (x: RawRow): RawState => (x.diffPct == null || Math.abs(x.diffPct) < 2 ? "norma" : x.diff > 0 ? "ortiq" : "kam");

const filterChip = (on: boolean, href: string, label: string, count?: number) => (
  <Link key={label} href={href} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
    {label}{count != null && <span className={cn("tabular text-xs", on ? "text-white/70" : "text-slate-400")}>{count}</span>}
  </Link>
);

export function RawBalanceView({ r, sp, base }: { r: RawBalance; sp: SP; base: string }) {
  const close = new Date(r.to.getTime() - 1);
  const d1 = dm(r.from), d2 = dm(close.getTime() > Date.now() ? new Date() : close);
  const scrapKg = Math.max(0, Number(sp.otxod) || 0);
  // Otxod (metallom) — armatura guruhiga; armatura bo'lmasa birinchi jami qatorli guruhga
  const scrapGroup = r.groups.find((g) => g.total && /armatura/i.test(g.group)) ?? r.groups.find((g) => g.total) ?? null;
  const st = scrapGroup?.total ?? null;
  const scrapPrice = scrapGroup ? (() => { const ps = scrapGroup.rows.map((x) => x.price).filter((p): p is number => p != null); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null; })() : null;
  const unexplainedKg = st ? st.diff - scrapKg : 0;
  // Filtrlar: guruh va holat (Tayyor mahsulot sahifasidagi kabi chiplar)
  const groupNames = r.groups.map((g) => g.group);
  const group = sp.guruh && groupNames.includes(sp.guruh) ? sp.guruh : undefined;
  const state = sp.holat && sp.holat in RAW_STATE ? (sp.holat as RawState) : undefined;
  const q = sp.q?.trim().toLowerCase();
  const keepRow = (x: RawRow) => (!group || x.group === group) && (!state || rawState(x) === state) && (!q || x.name.toLowerCase().includes(q));
  const groups = r.groups.filter((g) => !group || g.group === group).map((g) => ({ ...g, rows: g.rows.filter(keepRow), total: state || q ? null : g.total })).filter((g) => g.rows.length > 0);
  const rows = groups.flatMap((g) => g.rows);
  const filtered = !!(group || state || q);
  const diffSum = filtered ? rows.reduce((a, x) => a + (x.diffSum ?? 0), 0) : r.diffSum;
  const inGroup = r.rows.filter((x) => !group || x.group === group);
  const href = (o: Record<string, string | undefined>) => `${base}${qs({ oy: sp.oy, otxod: sp.otxod, guruh: group, holat: state, q: sp.q, ...o })}`;
  const worst = [...rows].filter((x) => x.diffSum != null && Math.abs(x.diffSum) >= 1).sort((a, b) => Math.abs(b.diffSum!) - Math.abs(a.diffSum!))[0];
  const sheet = (x: Omit<RawRow, "id" | "price"> & { price: number | null }) => ({
    Material: x.name, Birlik: x.unit, [`Oy boshi qoldiq (${d1})`]: x.open, "Kirim (oy davomida)": x.received, [`Oy oxiri qoldiq (${d2})`]: x.close, "Haqiqiy sarf": x.fact,
    "Norma: sotilganga": x.normSold, "Norma: omborda qolgan": x.normStock, "Norma jami": x.norm, "Qolishi kerak edi": x.shouldRemain,
    "Farq: normadan ortiq sarf": x.diff, "Farq, %": x.diffPct != null ? Math.round(x.diffPct * 10) / 10 : null, "Narx, so'm": x.price, "Farq, so'm": x.diffSum,
  });
  const line = (x: RawRow | (Omit<RawRow, "id" | "price"> & { price: null }), total = false) => (
    <Tr key={total ? `t:${x.name}` : (x as RawRow).id} className={total ? "bg-violet-50/70 font-semibold [&>td]:text-slate-900" : undefined}>
      <Td className="min-w-40">{x.name}</Td>
      <Td>{x.unit}</Td>
      <Td right><N v={x.open} /></Td>
      <Td right className="bg-amber-50/60"><N v={x.received} /></Td>
      <Td right><N v={x.close} /></Td>
      <Td right className="font-semibold text-slate-900"><N v={x.fact} /></Td>
      <Td right><N v={x.normSold} /></Td>
      <Td right><N v={x.normStock} /></Td>
      <Td right className="font-semibold text-slate-900"><N v={x.norm} /></Td>
      <Td right><N v={x.shouldRemain} /></Td>
      <Td right><N v={x.diff} className={diffCls(x)} /></Td>
      <Td right>{x.diffPct == null ? <span className="text-slate-300">—</span> : <span className={diffCls(x)}>{pct(x.diffPct)}</span>}</Td>
      <Td right><N v={x.price} /></Td>
      <Td right><N v={x.diffSum} className={cn("font-semibold", x.diffSum != null && x.diffSum > 0 ? "text-red-600" : "text-amber-700")} /></Td>
    </Tr>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold text-slate-900">Xom-ashyo balansi — {monthTitle(r.month)}</h2>
        <span className="text-[13px] text-slate-500">Haqiqiy sarf = oy boshi + kirim − oy oxiri · Norma = retsept bo&apos;yicha</span>
      </div>
      <MonthBar base={base} month={r.month} keep={{ otxod: sp.otxod, guruh: group, holat: state, q: sp.q }}>
        <ExcelButton file={`Xom-ashyo balansi ${r.month}`} sheets={[{ name: "Xom-ashyo balansi", rows: groups.flatMap((g) => [...g.rows.map(sheet), ...(g.total ? [sheet(g.total)] : [])]) }]} />
      </MonthBar>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Normadan farq, so'm" value={moneyShort(diffSum)} hint={diffSum > 0 ? "normadan ortiq sarflangan" : "normadan kam sarflangan"} icon={TriangleAlert} tone={diffSum > 0 ? "danger" : "success"} href={href({ holat: diffSum > 0 ? "ortiq" : "kam" })} />
        <StatCard label="Eng katta farq" value={worst ? moneyShort(worst.diffSum!) : "—"} hint={worst ? `${worst.name} · ${worst.diffPct != null ? pct(worst.diffPct) : "—"}` : undefined} icon={Scale} tone={worst && worst.diffSum! > 0 ? "warning" : "default"} href={worst ? `/stock?tab=moves&material=${worst.id}` : undefined} />
        <StatCard label="Materiallar" value={fmtNum(rows.length)} hint={`normadan 5% dan ortiq: ${rows.filter((x) => (x.diffPct ?? 0) > 5).length}`} icon={Boxes} href="/stock?tab=balance" />
        <StatCard label="Metallom sotuvidan tushum" value={moneyShort(r.scrap.income)} hint={r.scrap.incomeCount ? `${r.scrap.incomeCount} ta kirim («metallom» yozilgan)` : "izohida «metallom» deb yozilgan kirim yo'q"} icon={Recycle} tone="info" href={`/cashflow?tab=INCOME&from=${r.month}-01&to=${monthEnd(r.month)}`} />
      </div>

      <div className="space-y-2">
        <form method="get" action={base} className="flex flex-wrap items-center gap-2">
          {Object.entries({ oy: sp.oy, otxod: sp.otxod, guruh: group, holat: state }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <label className="relative min-w-52 flex-1 sm:max-w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input name="q" defaultValue={sp.q ?? ""} placeholder="Material nomi…" className="h-9 pl-9" />
          </label>
          {filtered && <Link href={`${base}${qs({ oy: sp.oy, otxod: sp.otxod })}`} className="text-[13px] font-medium text-slate-600 underline">Filtrni tozalash</Link>}
        </form>
        {groupNames.length > 1 && <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs font-medium text-slate-500">Guruh:</span>{filterChip(!group, href({ guruh: undefined }), "Hammasi", r.rows.length)}{r.groups.map((g) => filterChip(group === g.group, href({ guruh: g.group }), g.group, g.rows.length))}</div>}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-slate-500">Holat:</span>
          {filterChip(!state, href({ holat: undefined }), "Hammasi", inGroup.length)}
          {(Object.keys(RAW_STATE) as RawState[]).map((k) => filterChip(state === k, href({ holat: k }), RAW_STATE[k], inGroup.filter((x) => rawState(x) === k).length))}
        </div>
      </div>

      <Table maxHeight="70vh">
        <thead>
          <tr>
            <Th>Material</Th><Th>Birlik</Th><Th right>Oy boshi qoldiq ({d1})</Th><Th right className="text-amber-700">Kirim (oy davomida)</Th><Th right>Oy oxiri qoldiq ({d2})</Th>
            <Th right>Haqiqiy sarf</Th><Th right>Norma: sotilganga</Th><Th right>Norma: omborda qolgan</Th><Th right>Norma jami</Th><Th right>Qolishi kerak edi</Th>
            <Th right>Farq: normadan ortiq sarf</Th><Th right>Farq, %</Th><Th right>Narx, so&apos;m</Th><Th right>Farq, so&apos;m</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => [...g.rows.map((x) => line(x)), ...(g.total ? [line(g.total, true)] : [])])}
          {rows.length === 0 && <tr><td colSpan={14} className="px-4 py-10 text-center text-sm text-slate-500">{filtered ? "Filtr bo'yicha material topilmadi" : "Retseptdagi materiallar bo'yicha harakat yo'q"}</td></tr>}
        </tbody>
      </Table>

      {st && (
        <Card>
          <CardHeader title={`${scrapGroup!.group} otxodi (metallom)`} icon={Recycle} description="Oyda chiqqan otxod normadan ortiq sarfning bir qismini izohlaydi — qolgani izohlanmagan farq" />
          <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="oy" value={r.month} />
            <label className="text-xs text-slate-500">Otxod, {st.unit} (oy uchun)
              <Input type="number" name="otxod" min={0} step="any" defaultValue={sp.otxod ?? ""} placeholder="masalan, 9000" className="mt-1 h-9 w-44" />
            </label>
            <button className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Hisoblash</button>
          </form>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Normadan ortiq sarf", `${fmtNum(st.diff)} ${st.unit}`, ""],
              ["Otxodsiz ortiq sarf", `${fmtNum(unexplainedKg)} ${st.unit}`, unexplainedKg > 0 ? "text-red-600" : ""],
              ["Otxodsiz ortiq sarf, %", st.norm > 0 ? pct((unexplainedKg / st.norm) * 100) : "—", unexplainedKg > 0 ? "text-red-600" : ""],
              ["Izohlanmagan farq, so'm", scrapPrice != null ? fmtNum(unexplainedKg * scrapPrice) : "—", unexplainedKg > 0 ? "text-red-600" : ""],
            ].map(([k, v, c]) => (
              <div key={k} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className={cn("mt-0.5 text-[17px] font-bold tabular text-slate-900", c)}>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <ul className="space-y-1 text-[13px] text-slate-500">
        <li>Norma: sotilganga — retsept × sotilgan beton (zameslar) va jo&apos;natilgan buyumlar; omborda qolgan — retsept × (ishlab chiqarilgan − jo&apos;natilgan) buyumlar.</li>
        <li>Narx — kirimlar bo&apos;yicha o&apos;rtacha tannarx (sklad bilan bir xil). Kirim va qoldiqlar Sklad aylanmasidan olinadi.</li>
      </ul>
    </div>
  );
}

// ───────────────────── Tayyor mahsulot ─────────────────────

export function FinishedView({ r, sp, base }: { r: FinishedReport; sp: SP; base: string }) {
  const group = sp.guruh && r.groups.includes(sp.guruh) ? sp.guruh : undefined;
  const brigade = sp.brigada && r.brigades.includes(sp.brigada) ? sp.brigada : undefined;
  const rows = r.rows.filter((x) => (!group || x.group === group) && (!brigade || x.brigades.some((b) => b.name === brigade)));
  const s = (f: (x: (typeof rows)[number]) => number) => rows.reduce((a, x) => a + f(x), 0);
  const t = { open: s((x) => x.open), produced: s((x) => x.produced), shipped: s((x) => x.shipped), other: s((x) => x.other), close: s((x) => x.close), valueCost: s((x) => x.valueCost), valuePrice: s((x) => x.valuePrice) };
  const hasOther = rows.some((x) => Math.abs(x.other) > 0.0005);
  const chip = (on: boolean, href: string, label: string) => (
    <Link key={label} href={href} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>{label}</Link>
  );
  const href = (o: Record<string, string | undefined>) => `${base}${qs({ oy: sp.oy, guruh: group, brigada: brigade, ...o })}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold text-slate-900">Tayyor mahsulot — {monthTitle(r.month)}</h2>
        <span className="text-[13px] text-slate-500">Oy boshi + ishlab chiqarildi − jo&apos;natildi = oy oxiri</span>
      </div>
      <MonthBar base={base} month={r.month} keep={{ guruh: group, brigada: brigade }}>
        <ExcelButton file={`Tayyor mahsulot ${r.month}`} sheets={[{ name: "Tayyor mahsulot", rows: rows.map((x) => ({
          Mahsulot: x.name, Brigada: x.brigades.map((b) => b.name).join(", "), Guruh: x.group, "Oy boshi qoldiq": x.open, "Ishlab chiqarildi": x.produced, "Jo'natildi": x.shipped,
          "Brak / tuzatish": x.other || null, "Oy oxiri qoldiq": x.close, "Tannarx narxi (1 dona)": x.cost, "Sotuv narxi (1 dona)": x.price, "Qiymati (tannarxda)": x.valueCost, "Qiymati (sotuv narxida)": x.valuePrice,
        })) }]} />
      </MonthBar>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Oy oxiri qoldiq" value={`${fmtNum(t.close)} dona`} hint={`oy boshida ${fmtNum(t.open)} dona`} icon={Package} href="#tayyor" />
        <StatCard label="Ishlab chiqarildi / jo'natildi" value={`${fmtNum(t.produced)} / ${fmtNum(t.shipped)}`} hint="dona, oy davomida" icon={Factory} tone="brand" href={`/bi-tahlil/ishlab-chiqarish?from=${r.month}-01&to=${monthEnd(r.month)}`} />
        <StatCard label="Qiymati (tannarxda)" value={moneyShort(t.valueCost)} hint={fmtNum(t.valueCost)} icon={Boxes} href="#tayyor" />
        <StatCard label="Qiymati (sotuv narxida)" value={moneyShort(t.valuePrice)} hint={t.valueCost ? `ustama ${moneyShort(t.valuePrice - t.valueCost)}` : fmtNum(t.valuePrice)} icon={Boxes} tone="success" href="#tayyor" />
      </div>

      {(r.groups.length > 1 || r.brigades.length > 0) && (
        <div className="space-y-2">
          {r.groups.length > 1 && <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs font-medium text-slate-500">Guruh:</span>{chip(!group, href({ guruh: undefined }), "Hammasi")}{r.groups.map((g) => chip(group === g, href({ guruh: g }), g))}</div>}
          {r.brigades.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-xs font-medium text-slate-500">Brigada:</span>{chip(!brigade, href({ brigada: undefined }), "Hammasi")}{r.brigades.map((b) => chip(brigade === b, href({ brigada: b }), b))}</div>}
        </div>
      )}

      <div id="tayyor" className="scroll-mt-20">
        <Table maxHeight="70vh">
          <thead>
            <tr>
              <Th>Mahsulot</Th><Th>Brigada</Th><Th>Guruh</Th><Th right>Oy boshi qoldiq</Th><Th right className="text-emerald-700">Ishlab chiqarildi</Th><Th right className="text-sky-700">Jo&apos;natildi</Th>
              {hasOther && <Th right>Brak / tuzatish</Th>}
              <Th right>Oy oxiri qoldiq</Th><Th right>Tannarx (1 dona)</Th><Th right>Sotuv narxi (1 dona)</Th><Th right>Qiymati (tannarxda)</Th><Th right>Qiymati (sotuv narxida)</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <Tr key={x.id}>
                <Td className="min-w-44"><Link href={`/stock/products/${x.id}`} className="hover:underline">{x.name}</Link></Td>
                <Td>{x.brigades.length ? <div className="flex flex-wrap gap-1">{x.brigades.map((b) => <Badge key={b.name} color="slate" dot={false}>{b.name} · {fmtNum(b.qty)}</Badge>)}</div> : <span className="text-slate-300">—</span>}</Td>
                <Td className="whitespace-nowrap text-slate-600">{x.group}</Td>
                <Td right><N v={x.open} /></Td>
                <Td right className="bg-emerald-50/50"><N v={x.produced} /></Td>
                <Td right className="bg-sky-50/50"><N v={x.shipped} /></Td>
                {hasOther && <Td right><N v={x.other} className="text-amber-700" /></Td>}
                <Td right className={cn("font-semibold", x.close < 0 ? "text-red-600" : "text-slate-900")}><N v={x.close} /></Td>
                <Td right>{x.cost != null ? fmtNum(x.cost) : <span className="text-xs text-amber-700">tannarx yo&apos;q</span>}</Td>
                <Td right><N v={x.price} /></Td>
                <Td right><N v={x.valueCost} /></Td>
                <Td right><N v={x.valuePrice} /></Td>
              </Tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={12} className="px-4 py-10 text-center text-sm text-slate-500">Tayyor mahsulot harakati yo&apos;q</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-bold text-slate-900 [&>td]:whitespace-nowrap [&>td]:border-t-2 [&>td]:border-slate-200 [&>td]:px-4 [&>td]:py-3 [&>td]:tabular">
                <td colSpan={3}>Jami</td>
                <td className="text-right">{fmtNum(t.open)}</td><td className="text-right">{fmtNum(t.produced)}</td><td className="text-right">{fmtNum(t.shipped)}</td>
                {hasOther && <td className="text-right">{fmtNum(t.other)}</td>}
                <td className="text-right">{fmtNum(t.close)}</td><td /><td /><td className="text-right">{fmtNum(t.valueCost)}</td><td className="text-right">{fmtNum(t.valuePrice)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </div>
      <p className="text-[13px] text-slate-500">Dona mahsulot (beton omborda turmaydi). Brigada — oy davomida shu mahsulot bo&apos;yicha bajarilgan topshiriqlar (miqdori bilan). Tannarx — kirim narxi, bo&apos;lmasa retsept tannarxi.</p>
    </div>
  );
}
