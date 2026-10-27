import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Crown, Hourglass, HandCoins, Scale, Search, Truck, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";
import { type SP } from "../shell";
import { type AgeReport, type DebtSheet, AGE_LABELS, AGE_STATUS, CUSTOMER_KIND_LABEL } from "@/lib/fin-report/debts";
import { MONTHS_UZ } from "@/lib/bi/plans";
import { date, fmtNum, isoDate, moneyShort } from "@/lib/format";
import { Badge, type BadgeColor, Card, Input, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";

/**
 * Tahlil → Mijozlar: tahlil va «Insof 2026» jadvalidagi qarz varaqlari. Sidebar'da «Mijozlar» ostida ham shu havolalar (`lib/nav.ts`).
 * URL: `sana` (YYYY-MM-DD, sukut — bugun), `q` (nom bo'yicha qidiruv), `tur` (CASH / BANK), `holat` (0–3).
 */

const qs = (o: Record<string, string | undefined>) => { const s = new URLSearchParams(Object.entries(o).filter((kv): kv is [string, string] => !!kv[1])).toString(); return s ? `?${s}` : ""; };


const monthName = (d: Date) => `${MONTHS_UZ[d.getMonth()]} ${d.getFullYear()} y.`;
const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
const isToday = (d: Date) => isoDate(d) === isoDate(new Date());
const Num = ({ v, className }: { v: number; className?: string }) => (Math.abs(v) < 1 ? <span className="text-slate-300">—</span> : <span className={className}>{fmtNum(v)}</span>);

/** Sana, qidiruv va Excel — har uch hisobot tepasida. */
function Toolbar({ base, day, sp, keep, excel, placeholder }: { base: string; day: Date; sp: SP; keep: Record<string, string | undefined>; excel: React.ReactNode; placeholder: string }) {
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-center gap-2">
      {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <label className="relative min-w-52 flex-1 sm:max-w-72">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input name="q" defaultValue={sp.q ?? ""} placeholder={placeholder} className="h-9 pl-9" />
      </label>
      <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">Sana
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

// ───────────────────── Qarz / Avans: oy boshi → tanlangan kun ─────────────────────

/** «Ta'minotchilar oldidagi qarzdorlik» va «Xaridorlar qarzdorligi» — bir xil ko'rinish. */
export function DebtSheetView({ who, s, sp, base, linkable = true }: { who: "supplier" | "customer"; s: DebtSheet; sp: SP; base: string; linkable?: boolean }) {
  const sup = who === "supplier";
  const kind = sp.tur === "CASH" || sp.tur === "BANK" ? sp.tur : undefined;
  const rows = filterName(s.rows, sp.q);
  const d1 = dm(s.monthStart), d2 = dm(s.day);
  const t = s.total;
  const title = sup ? "Ta'minotchilar oldidagi qarzdorlik" : "Xaridorlar qarzdorligi";
  const legend = sup ? "Qarz — biz ularga qarzmiz; Avans — biz oldindan to'laganmiz" : "Qarz — mijoz bizga qarz; Avans — mijoz oldindan to'lagan";
  const delta = (a: number, b: number) => (Math.abs(b - a) < 1 ? "oy boshidagidek" : `oy boshiga nisbatan ${b > a ? "+" : "−"}${moneyShort(Math.abs(b - a))}`);
  const col = sup ? "Ta'minotchi" : "Xaridor";
  const excelRows = rows.map((r) => ({
    [col]: r.name, ...(sup ? {} : { "Mijoz turi": r.kind ? CUSTOMER_KIND_LABEL[r.kind] : "" }),
    [`Qarz ${d1}`]: r.open.debt || null, [`Avans ${d1}`]: r.open.advance || null, [`Qarz ${d2}`]: r.now.debt || null, [`Avans ${d2}`]: r.now.advance || null, "O'zgarish": r.change || null,
  }));
  const tint = "bg-emerald-50/60";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold text-slate-900">{title} — {monthName(s.day)}</h2>
        <span className="text-[13px] text-slate-500">{legend}</span>
      </div>
      <Toolbar base={base} day={s.day} sp={sp} keep={{ tur: kind }} placeholder={sup ? "Ta'minotchi nomi…" : "Xaridor nomi…"}
        excel={<ExcelButton file={`${title} ${isoDate(s.day)}`} sheets={[{ name: sup ? "Ta'minotchilar" : "Xaridorlar", rows: excelRows }]} />} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label={sup ? `Bizning qarzimiz, ${d2}` : `Mijozlar qarzi, ${d2}`} value={moneyShort(t.now.debt)} hint={delta(t.open.debt, t.now.debt)} icon={sup ? Truck : HandCoins} tone={t.now.debt > t.open.debt ? "danger" : "success"} />
        <StatCard label={sup ? `Bergan avansimiz, ${d2}` : `Olingan avans, ${d2}`} value={moneyShort(t.now.advance)} hint={delta(t.open.advance, t.now.advance)} icon={Wallet} tone="info" />
        <StatCard label={`Sof holat, ${d2}`} value={moneyShort(t.now.debt - t.now.advance)} hint={sup ? "qarz − avans: + bo'lsa biz qarzmiz" : "qarz − avans: + bo'lsa ular qarz"} icon={Scale} tone="brand" />
        <StatCard label={sup ? "Ta'minotchilar" : "Xaridorlar"} value={fmtNum(rows.length)} hint={`qarzi bor: ${rows.filter((r) => r.now.debt > 0).length} · avansi bor: ${rows.filter((r) => r.now.advance > 0).length}`} icon={sup ? Truck : UserRound} />
      </div>

      {!sup && s.kinds && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-slate-500">Mijoz turi:</span>
          <Chip href={`${base}${qs({ sana: sp.sana, q: sp.q })}`} on={!kind} count={s.kinds.ALL}>Hammasi</Chip>
          <Chip href={`${base}${qs({ sana: sp.sana, q: sp.q, tur: "CASH" })}`} on={kind === "CASH"} count={s.kinds.CASH}>Naqd</Chip>
          <Chip href={`${base}${qs({ sana: sp.sana, q: sp.q, tur: "BANK" })}`} on={kind === "BANK"} count={s.kinds.BANK}>Perechisleniye</Chip>
        </div>
      )}

      <Table maxHeight="70vh">
        <thead>
          <tr>
            <Th>{col}</Th>
            <Th right>Qarz · {d1}</Th>
            <Th right>Avans · {d1}</Th>
            <Th right className="text-emerald-700">Qarz · {d2}</Th>
            <Th right className="text-emerald-700">Avans · {d2}</Th>
            <Th right>O&apos;zgarish</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">{sp.q ? "Qidiruv bo'yicha hech narsa topilmadi" : "Bu davrda hisob-kitob yo'q"}</td></tr>}
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="min-w-52">
                {linkable ? <Link href={sup ? `/suppliers/${r.id}` : `/customers/${r.id}`} className="hover:underline">{r.name}</Link> : r.name}
                {!sup && !kind && r.kind === "CASH" && <span className="ml-2 align-middle"><Badge color="green" dot={false}>naqd</Badge></span>}
              </Td>
              <Td right><Num v={r.open.debt} /></Td>
              <Td right><Num v={r.open.advance} className="text-slate-500" /></Td>
              <Td right className={tint}><Num v={r.now.debt} className="font-semibold text-slate-900" /></Td>
              <Td right className={tint}><Num v={r.now.advance} className="text-blue-700" /></Td>
              <Td right>
                {Math.abs(r.change) < 1 ? <span className="text-slate-300">—</span> : (
                  <span className={cn("inline-flex items-center gap-0.5 font-medium", r.change > 0 ? "text-red-600" : "text-emerald-600")}>
                    {r.change > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{moneyShort(Math.abs(r.change))}
                  </span>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="bg-slate-50 font-bold text-slate-900">
              <td className="border-t-2 border-slate-200 px-4 py-3">Jami</td>
              {[t.open.debt, t.open.advance].map((v, i) => <td key={i} className="whitespace-nowrap border-t-2 border-slate-200 px-4 py-3 text-right tabular">{fmtNum(v)}</td>)}
              {[t.now.debt, t.now.advance].map((v, i) => <td key={i} className="whitespace-nowrap border-t-2 border-slate-200 bg-emerald-50 px-4 py-3 text-right tabular">{fmtNum(v)}</td>)}
              <td className="whitespace-nowrap border-t-2 border-slate-200 px-4 py-3 text-right tabular">{fmtNum((t.now.debt - t.now.advance) - (t.open.debt - t.open.advance))}</td>
            </tr>
          </tfoot>
        )}
      </Table>
      <p className="text-[13px] text-slate-500">
        {sup
          ? "Hisob: boshlang'ich qoldiq + kirim hujjatlari (QQS va dostavka bilan) − ta'minotchiga to'langan pul. O'zgarish ↑ — qarzimiz o'sdi."
          : "Hisob: schyotlar − mijoz to'lovlari. Mijoz turi — oxirgi zayavkadagi to'lov usuli. O'zgarish ↑ — mijoz qarzi o'sdi."}
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
        <StatCard label="Jami qarz (bizga)" value={moneyShort(r.total)} hint={fmtNum(r.total)} icon={HandCoins} tone="brand" />
        <StatCard label="30 kundan eski" value={moneyShort(r.over30)} hint={r.total ? `${fmtNum((r.over30 / r.total) * 100, 0)}% qarz` : undefined} icon={Hourglass} tone={r.over30 ? "warning" : "success"} />
        <StatCard label="60 kundan eski" value={moneyShort(r.over60)} hint={r.total ? `${fmtNum((r.over60 / r.total) * 100, 0)}% qarz` : undefined} icon={Hourglass} tone={r.over60 ? "danger" : "success"} />
        <StatCard label="Qarzdorlar soni" value={fmtNum(r.debtors)} hint={`60 kundan eski: ${r.levels[3]}`} icon={Users} />
        <StatCard label="Eng katta qarzdor" value={r.top ? moneyShort(r.top.debt) : "—"} hint={r.top?.name} icon={Crown} tone={r.top ? "warning" : "default"} />
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
