import Link from "next/link";
import { Crown, Hourglass, HandCoins, Scale, Search, Truck, UserRound, Users, Wallet } from "lucide-react";
import { type SP } from "../shell";
import { type AgeReport, type DebtSheet, AGE_LABELS, AGE_STATUS, CUSTOMER_KIND_LABEL } from "@/lib/fin-report/debts";
import { MONTHS_UZ } from "@/lib/bi/plans";
import { date, dateRu, dateShort, fmtFixed, fmtNum, isoDate, moneyShort } from "@/lib/format";
import { Badge, type BadgeColor, Card, Input, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";

/**
 * Tahlil → Mijozlar: tahlil va «Insof 2026» jadvalidagi qarz varaqlari. Sidebar'da «Mijozlar» ostida ham shu havolalar (`lib/nav.ts`).
 * URL: `sana` (YYYY-MM-DD, sukut — bugun), `q` (nom bo'yicha qidiruv), `tur` (CASH / BANK), `holat` (0–3),
 * `qism` (debitor / kreditor — kim kimga qarz), `dan` (qarz varaqlarida davr boshi, sukut — oy boshi).
 */

const qs = (o: Record<string, string | undefined>) => { const s = new URLSearchParams(Object.entries(o).filter((kv): kv is [string, string] => !!kv[1])).toString(); return s ? `?${s}` : ""; };


const monthName = (d: Date) => `${MONTHS_UZ[d.getMonth()]} ${d.getFullYear()} y.`;
const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
const isToday = (d: Date) => isoDate(d) === isoDate(new Date());
const Num = ({ v, className }: { v: number; className?: string }) => (Math.abs(v) < 1 ? <span className="text-slate-300">—</span> : <span className={className}>{fmtNum(v)}</span>);

/** Sana, qidiruv va Excel — har uch hisobot tepasida. */
function Toolbar({ base, day, start, sp, keep, excel, placeholder }: { base: string; day: Date; start?: Date; sp: SP; keep: Record<string, string | undefined>; excel: React.ReactNode; placeholder: string }) {
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-center gap-2">
      {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <label className="relative min-w-52 flex-1 sm:max-w-72">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input name="q" defaultValue={sp.q ?? ""} placeholder={placeholder} className="h-9 pl-9" />
      </label>
      {start && (
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">Dan
          <Input type="date" name="dan" defaultValue={isoDate(start)} max={isoDate(new Date())} className="h-9 w-40" />
        </label>
      )}
      <label className={cn("flex items-center gap-1.5 text-xs text-slate-500", !start && "ml-auto")}>{start ? "Gacha" : "Sana"}
        <Input type="date" name="sana" defaultValue={isoDate(day)} max={isoDate(new Date())} className="h-9 w-40" />
      </label>
      <button className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
      {!isToday(day) && <Link href={`${base}${qs({ ...keep, q: sp.q })}`} className="h-9 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Bugun</Link>}
      {excel}
    </form>
  );
}

function Chip({ href, on, children, count }: { href: string; on: boolean; children: React.ReactNode; count?: number }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
      {children}{count != null && <span className={cn("tabular text-xs", on ? "text-white/70" : "text-slate-400")}>{count}</span>}
    </Link>
  );
}

const filterName = <T extends { name: string }>(rows: T[], q?: string) => {
  const s = q?.trim().toLowerCase();
  return s ? rows.filter((r) => r.name.toLowerCase().includes(s)) : rows;
};

// ───────────────────── Qarz / Avans: davr boshi → davr oxiri ─────────────────────

/** Jadval ranglari — «Insof 2026» dagi «Xaridorlar qarzi» varag'idek: kulrang nom/davr boshi, yashil davr oxiri. */
const SH = {
  head: "bg-[#c8cfb6] text-slate-900 dark:bg-[#383e30]",
  headNow: "bg-[#e3ecc8] text-slate-900 dark:bg-[#33402a]",
  cell: "bg-[#ececec] dark:bg-[#1f2328]",
  cellNow: "bg-[#f4f7ea] dark:bg-[#20291c]",
  hover: "group-hover:bg-[#dfe6f2] dark:group-hover:bg-[#28334a]",
  line: "border border-[#d4d6cf] dark:border-slate-200",
  split: "border-l-2 border-l-[#6b9a3f]",
} as const;

/** «Ta'minotchilar oldidagi qarzdorlik» va «Xaridorlar qarzdorligi» — bir xil ko'rinish. Qatorni bosish — akt sverka. */
export function DebtSheetView({ who, s, sp, base, company }: { who: "supplier" | "customer"; s: DebtSheet; sp: SP; base: string; company: string }) {
  const sup = who === "supplier";
  const kind = sp.tur === "CASH" || sp.tur === "BANK" ? sp.tur : undefined;
  // Debitorka — bizga qarzdorlar (mijoz qarzi, ta'minotchiga bergan avansimiz);
  // kreditorka — biz qarzmiz (mijozdan olingan avans, ta'minotchiga qarzimiz)
  const qism = sp.qism === "debitor" || sp.qism === "kreditor" ? sp.qism : undefined;
  const isDebitor = (r: DebtSheet["rows"][number]) => (sup ? r.now.advance : r.now.debt) >= 1;
  const isKreditor = (r: DebtSheet["rows"][number]) => (sup ? r.now.debt : r.now.advance) >= 1;
  const named = filterName(s.rows, sp.q);
  const rows = named.filter((r) => !qism || (qism === "debitor" ? isDebitor(r) : isKreditor(r)));
  const d1 = dateShort(s.monthStart), d2 = dateShort(s.day);
  const dan = isoDate(s.monthStart), sana = isoDate(s.day);
  // Oy boshidan boshlangan davrda `dan` URL'da yurmaydi — sana o'zgarsa davr boshi ham o'sha oyga ko'chadi
  const danKeep = s.monthStart.getDate() === 1 && s.monthStart.getMonth() === s.day.getMonth() && s.monthStart.getFullYear() === s.day.getFullYear() ? undefined : dan;
  const t = s.total;
  const sumRows = (f: (r: DebtSheet["rows"][number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const ft = { open: { debt: sumRows((r) => r.open.debt), advance: sumRows((r) => r.open.advance) }, now: { debt: sumRows((r) => r.now.debt), advance: sumRows((r) => r.now.advance) } };
  const debitorSum = sup ? t.now.advance : t.now.debt, kreditorSum = sup ? t.now.debt : t.now.advance;
  const qismHref = (v?: string) => `${base}${qs({ dan: danKeep, sana: sp.sana, q: sp.q, tur: kind, qism: v })}`;
  const sheetTitle = sup ? "Ta'minotchilar oldidagi qarzdorlik" : "Xaridorlar qarzdorligi";
  const legend = sup ? "Qarz (kreditorka) — biz ularga qarzmiz; Avans (debitorka) — biz oldindan to'laganmiz" : "Qarz (debitorka) — mijoz bizga qarz; Avans (kreditorka) — mijoz oldindan to'lagan";
  const delta = (a: number, b: number) => (Math.abs(b - a) < 1 ? "davr boshidagidek" : `davr boshiga nisbatan ${b > a ? "+" : "−"}${moneyShort(Math.abs(b - a))}`);
  const col = sup ? "Ta'minotchi" : "Xaridor";
  const aktHref = (id: string) => `${base}/${id}${qs({ dan, gacha: sana })}`;
  const excelRows = rows.map((r) => ({
    [col]: r.name, ...(sup ? {} : { "Mijoz turi": r.kind ? CUSTOMER_KIND_LABEL[r.kind] : "" }),
    [`Qarz ${d1}`]: r.open.debt || null, [`Avans ${d1}`]: r.open.advance || null,
    [`Qarz ${d2}`]: r.now.debt || null, [`Avans ${d2}`]: r.now.advance || null, "O'zgarish": r.change || null,
  }));
  const Amt = ({ v }: { v: number }) => (Math.abs(v) < 0.005 ? null : <>{fmtFixed(v)}</>);
  const num = "whitespace-nowrap px-3 py-1.5 text-right tabular";

  return (
    <div className="space-y-5">
      <Toolbar base={base} day={s.day} start={s.monthStart} sp={sp} keep={{ tur: kind, qism }} placeholder={sup ? "Ta'minotchi nomi…" : "Xaridor nomi…"}
        excel={<ExcelButton file={`${sheetTitle} ${sana}`} sheets={[{ name: sup ? "Ta'minotchilar" : "Xaridorlar", rows: excelRows }]} />} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label={sup ? `Kreditorka (qarzimiz), ${d2}` : `Debitorka (mijozlar qarzi), ${d2}`} value={moneyShort(t.now.debt)} hint={delta(t.open.debt, t.now.debt)} icon={sup ? Truck : HandCoins} tone={t.now.debt > t.open.debt ? "danger" : "success"} href={qismHref(sup ? "kreditor" : "debitor")} />
        <StatCard label={sup ? `Debitorka (bergan avansimiz), ${d2}` : `Kreditorka (olingan avans), ${d2}`} value={moneyShort(t.now.advance)} hint={delta(t.open.advance, t.now.advance)} icon={Wallet} tone="info" href={qismHref(sup ? "debitor" : "kreditor")} />
        <StatCard label={`Sof holat, ${d2}`} value={moneyShort(t.now.debt - t.now.advance)} hint={sup ? "kreditorka − debitorka: + bo'lsa biz qarzmiz" : "debitorka − kreditorka: + bo'lsa ular qarz"} icon={Scale} tone="brand" href={qismHref()} />
        <StatCard label={sup ? "Ta'minotchilar" : "Xaridorlar"} value={fmtNum(named.length)} hint={`debitor: ${named.filter(isDebitor).length} · kreditor: ${named.filter(isKreditor).length}`} icon={sup ? Truck : UserRound} href={qismHref()} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-slate-500">Ko&apos;rinish:</span>
        <Chip href={qismHref()} on={!qism} count={named.length}>Hammasi</Chip>
        <Chip href={qismHref("debitor")} on={qism === "debitor"} count={named.filter(isDebitor).length}>Debitorka · {sup ? "bizga qarz (avans)" : "bizga qarz"} · {moneyShort(debitorSum)}</Chip>
        <Chip href={qismHref("kreditor")} on={qism === "kreditor"} count={named.filter(isKreditor).length}>Kreditorka · {sup ? "biz qarzmiz" : "biz qarzmiz (avans)"} · {moneyShort(kreditorSum)}</Chip>
      </div>

      {!sup && s.kinds && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-slate-500">Mijoz turi:</span>
          <Chip href={`${base}${qs({ dan: danKeep, sana: sp.sana, q: sp.q, qism })}`} on={!kind} count={s.kinds.ALL}>Hammasi</Chip>
          <Chip href={`${base}${qs({ dan: danKeep, sana: sp.sana, q: sp.q, qism, tur: "CASH" })}`} on={kind === "CASH"} count={s.kinds.CASH}>Naqd</Chip>
          <Chip href={`${base}${qs({ dan: danKeep, sana: sp.sana, q: sp.q, qism, tur: "BANK" })}`} on={kind === "BANK"} count={s.kinds.BANK}>Perechisleniye</Chip>
        </div>
      )}

      {/* Varaq: sarlavha bloki + jadval — jadvaldagi «Xaridorlar qarzi» varag'idek */}
      <div className="overflow-hidden rounded-xl border border-[#d4d6cf] bg-white dark:border-slate-200">
        <div className="border-b border-[#d4d6cf] px-3 py-2 dark:border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[15px] font-bold text-slate-900">
            <span>{company}</span>
            <span className="tabular">Oy: <span className="ml-2">{String(s.day.getMonth() + 1).padStart(2, "0")}.{s.day.getFullYear()}</span></span>
          </div>
          <div className="mt-1 text-[22px] font-bold leading-tight text-slate-900">{sheetTitle} — {monthName(s.day)}</div>
          <div className="mt-0.5 text-[13px] text-slate-500">Saralash: nomi bo&apos;yicha (A → Z). Qatorni bosing — {dateRu(s.monthStart)} – {dateRu(s.day)} davri uchun akt sverka ochiladi.</div>
        </div>
        <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
          <table className="w-full min-w-[760px] border-collapse text-[14px] text-slate-900">
            <thead className="sticky top-0 z-10">
              <tr>
                <th rowSpan={2} className={cn(SH.line, SH.head, "px-3 py-1.5 text-left align-top font-normal")}>{col}</th>
                <th colSpan={2} className={cn(SH.line, SH.head, "px-3 py-1.5 text-center font-normal")}>Hisob-kitob {d1} holatiga</th>
                <th colSpan={2} className={cn(SH.line, SH.headNow, SH.split, "px-3 py-1.5 text-center font-normal")}>Hisob-kitob {d2} holatiga</th>
              </tr>
              <tr>
                <th className={cn(SH.line, SH.head, "w-[17%] px-3 py-1 text-center font-normal")}>Qarz</th>
                <th className={cn(SH.line, SH.head, "w-[17%] px-3 py-1 text-center font-normal")}>Avans</th>
                <th className={cn(SH.line, SH.headNow, SH.split, "w-[17%] px-3 py-1 text-center font-normal")}>Qarz</th>
                <th className={cn(SH.line, SH.headNow, "w-[17%] px-3 py-1 text-center font-normal")}>Avans</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className={cn(SH.line, "px-4 py-10 text-center text-sm text-slate-500")}>{sp.q || qism ? "Filtr bo'yicha hech narsa topilmadi" : "Bu davrda hisob-kitob yo'q"}</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="group relative cursor-pointer">
                  <td className={cn(SH.line, SH.cell, SH.hover, "min-w-56 px-3 py-1.5")}>
                    {/* Butun qator — akt sverka havolasi (after: qatorni qoplaydi) */}
                    <Link href={aktHref(r.id)} className="after:absolute after:inset-0 after:content-['']" title={`${r.name} — akt sverka`}>{r.name}</Link>
                    {!sup && !kind && r.kind === "CASH" && <span className="ml-2 align-middle"><Badge color="green" dot={false}>naqd</Badge></span>}
                  </td>
                  <td className={cn(SH.line, SH.cell, num, SH.hover)}><Amt v={r.open.debt} /></td>
                  <td className={cn(SH.line, SH.cell, num, SH.hover)}><Amt v={r.open.advance} /></td>
                  <td className={cn(SH.line, SH.cellNow, SH.split, num, SH.hover)}><Amt v={r.now.debt} /></td>
                  <td className={cn(SH.line, SH.cellNow, num, SH.hover)}><Amt v={r.now.advance} /></td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0">
                <tr className="font-bold">
                  <td className={cn(SH.line, SH.head, "px-3 py-2")}>Jami</td>
                  <td className={cn(SH.line, SH.head, num, "py-2")}>{fmtFixed(ft.open.debt)}</td>
                  <td className={cn(SH.line, SH.head, num, "py-2")}>{fmtFixed(ft.open.advance)}</td>
                  <td className={cn(SH.line, SH.headNow, SH.split, num, "py-2")}>{fmtFixed(ft.now.debt)}</td>
                  <td className={cn(SH.line, SH.headNow, num, "py-2")}>{fmtFixed(ft.now.advance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <p className="text-[13px] text-slate-500">
        {legend}.{" "}
        {sup
          ? "Hisob: boshlang'ich qoldiq + kirim hujjatlari (QQS va dostavka bilan) − ta'minotchiga to'langan pul."
          : "Hisob: hisob-fakturalar − mijoz to'lovlari. Mijoz turi — oxirgi zayavkadagi to'lov usuli."}
      </p>
    </div>
  );
}

// ───────────────────── Mijozlar qarzi — qancha vaqtdan beri turibdi ─────────────────────

const LEVEL = [
  { bar: "bg-emerald-400", cell: "bg-emerald-50/70", badge: "green" },
  { bar: "bg-blue-400", cell: "bg-blue-50/70", badge: "blue" },
  { bar: "bg-amber-400", cell: "bg-amber-50/80", badge: "amber" },
  { bar: "bg-red-500", cell: "bg-red-50 text-red-700 font-semibold", badge: "red" },
] as const satisfies readonly { bar: string; cell: string; badge: BadgeColor }[];

export function DebtAgeView({ r, sp, base }: { r: AgeReport; sp: SP; base: string }) {
  const holat = sp.holat != null && /^[0-3]$/.test(sp.holat) ? Number(sp.holat) : null;
  const rows = filterName(r.rows, sp.q).filter((x) => holat == null || x.level === holat);
  const since = r.since ? dm(r.since) : null;
  const noPay = (x: AgeReport["rows"][number]) => (x.daysNoPay != null ? fmtNum(x.daysNoPay) : since ? `${since} dan beri to'lamagan` : "to'lamagan");
  const excelRows = rows.map((x) => ({
    Mijoz: x.name, "Jami qarz, so'm": x.debt, ...Object.fromEntries(AGE_LABELS.map((l, i) => [l, x.buckets[i] || null])),
    "Oxirgi xarid": x.lastSale ? date(x.lastSale) : "", "Oxirgi to'lov": x.lastPay ? date(x.lastPay) : "", "To'lovsiz necha kun": noPay(x), "Sotuvchi (oxirgi)": x.seller ?? "", Holat: AGE_STATUS[x.level]!,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold text-slate-900">Mijozlar qarzi — qancha vaqtdan beri turibdi</h2>
        <span className="text-[13px] text-slate-500">To&apos;lov eng eski qarzni yopadi — qolgan qarz eng oxirgi olingan tovarlar</span>
      </div>
      <Toolbar base={base} day={r.day} sp={sp} keep={{ holat: sp.holat }} placeholder="Mijoz nomi…"
        excel={<ExcelButton file={`Mijozlar qarzi ${isoDate(r.day)}`} sheets={[{ name: "Qarz yoshi", rows: excelRows }]} />} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
        <StatCard label="Jami qarz (bizga)" value={moneyShort(r.total)} hint={fmtNum(r.total)} icon={HandCoins} tone="brand" href={`${base}${qs({ sana: sp.sana, q: sp.q })}`} />
        <StatCard label="30 kundan eski" value={moneyShort(r.over30)} hint={r.total ? `${fmtNum((r.over30 / r.total) * 100, 0)}% qarz` : undefined} icon={Hourglass} tone={r.over30 ? "warning" : "success"} href={`${base}${qs({ sana: sp.sana, q: sp.q, holat: "2" })}`} />
        <StatCard label="60 kundan eski" value={moneyShort(r.over60)} hint={r.total ? `${fmtNum((r.over60 / r.total) * 100, 0)}% qarz` : undefined} icon={Hourglass} tone={r.over60 ? "danger" : "success"} href={`${base}${qs({ sana: sp.sana, q: sp.q, holat: "3" })}`} />
        <StatCard label="Qarzdorlar soni" value={fmtNum(r.debtors)} hint={`60 kundan eski: ${r.levels[3]}`} icon={Users} href={`${base}${qs({ sana: sp.sana })}`} />
        <StatCard label="Eng katta qarzdor" value={r.top ? moneyShort(r.top.debt) : "—"} hint={r.top?.name} icon={Crown} tone={r.top ? "warning" : "default"} href={r.top ? `${base}${qs({ sana: sp.sana, q: r.top.name })}` : undefined} />
      </div>

      {r.total > 0 && (
        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <div className="text-[14px] font-semibold text-slate-900">Qarz yoshi bo&apos;yicha taqsimot <span className="font-normal text-slate-400">· bosib filtrlang</span></div>
            <div className="text-xs text-slate-500">{date(r.day)} holatiga</div>
          </div>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
            {r.buckets.map((v, i) => v > 0 && <div key={i} className={LEVEL[i]!.bar} style={{ width: `${(v / r.total) * 100}%` }} title={`${AGE_LABELS[i]}: ${fmtNum(v)}`} />)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {AGE_LABELS.map((l, i) => {
              const on = holat === i;
              return (
                <Link key={l} href={`${base}${qs({ sana: sp.sana, q: sp.q, holat: on ? undefined : String(i) })}`}
                  className={cn("rounded-xl border px-3 py-2.5 transition hover:shadow-sm", on ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200")}>
                  <div className="flex items-center gap-2 text-[12px] font-medium text-slate-500"><span className={cn("h-2.5 w-2.5 rounded-full", LEVEL[i]!.bar)} />{l}</div>
                  <div className={cn("mt-1 text-[17px] font-bold tabular", i === 3 && r.buckets[i] ? "text-red-600" : "text-slate-900")}>{moneyShort(r.buckets[i]!)}</div>
                  <div className="text-[12px] text-slate-500">{r.total ? fmtNum((r.buckets[i]! / r.total) * 100, 0) : 0}% · {r.levels[i]} ta mijoz</div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {holat != null && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
          Faqat <Badge color={LEVEL[holat]!.badge}>{AGE_STATUS[holat]}</Badge> — {rows.length} ta mijoz
          <Link href={`${base}${qs({ sana: sp.sana, q: sp.q })}`} className="font-medium text-slate-900 underline">Hammasini ko&apos;rsatish</Link>
        </div>
      )}

      <Table maxHeight="70vh">
        <thead>
          <tr>
            <Th>Mijoz</Th>
            <Th right>Jami qarz, so&apos;m</Th>
            {AGE_LABELS.map((l) => <Th key={l} right>{l}</Th>)}
            <Th>Oxirgi xarid</Th>
            <Th>Oxirgi to&apos;lov</Th>
            <Th right>To&apos;lovsiz, kun</Th>
            <Th>Sotuvchi (oxirgi)</Th>
            <Th>Holat</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-500">{r.debtors ? "Filtr bo'yicha mijoz yo'q" : "Qarzdor mijoz yo'q"}</td></tr>}
          {rows.map((x) => (
            <Tr key={x.id}>
              <Td><Link href={`/customers/${x.id}`} className="block max-w-64 truncate hover:underline" title={x.name}>{x.name}</Link></Td>
              <Td right className="font-semibold text-slate-900">{fmtNum(x.debt)}</Td>
              {x.buckets.map((v, i) => <Td key={i} right className={cn(v >= 1 && LEVEL[i]!.cell)}><Num v={v} /></Td>)}
              <Td className="whitespace-nowrap">{x.lastSale ? date(x.lastSale) : <span className="text-slate-300">—</span>}</Td>
              <Td className="whitespace-nowrap">{x.lastPay ? date(x.lastPay) : <span className="text-slate-300">—</span>}</Td>
              <Td right className={cn(x.daysNoPay == null ? "text-[12px] text-red-600" : x.daysNoPay > 30 ? "font-semibold text-red-600" : "")}>{noPay(x)}</Td>
              <Td className="whitespace-nowrap text-slate-600">{x.seller ?? <span className="text-slate-300">—</span>}</Td>
              <Td><Badge color={LEVEL[x.level]!.badge}>{AGE_STATUS[x.level]}</Badge></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="text-[13px] text-slate-500">
        Naqd va perechisleniye birga. Qarz yoshi — to&apos;lanmagan schyot sanasidan {date(r.day)} gacha. Holat — mijozning eng eski to&apos;lanmagan qarzi qaysi oraliqda.
      </p>
    </div>
  );
}
