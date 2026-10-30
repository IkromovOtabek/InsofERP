import Link from "next/link";
import { Search, Truck, Wallet, Receipt, FileWarning } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { dateRu, fmtNum, isoDate } from "@/lib/format";
import { realizationRows, type RealizationRow } from "@/lib/realization";
import { PAY_GROUPS, type PayGroupKey } from "@/lib/order-day-sheet";
import { Button, Input, PageHeader, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr, StatCard, Tabs } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";

/**
 * Sotuv → «Realizatsiya»: reys (TTN) bo'yicha jo'natmalar reestri — buxgalteriyaning «Realizatsiya» varag'i ko'rinishida.
 * Ekranda ustunlar ixchamlangan (TTN va mashina, shartnoma va schyot-faktura bitta katakda) — jadval ekranga sig'adi;
 * Excel'da varaqdagi barcha ustunlar alohida. Hisob `lib/realization.ts` da.
 */
type SP = { from?: string; to?: string; tur?: string; guruh?: string; q?: string; hujjat?: string };

const PAY_COLOR: Record<PayGroupKey, string> = { BANK: "text-blue-700", CASH: "text-emerald-700", DEBT: "text-red-700" };
/** Jadvaldagi qisqa nom (ustun tor); to'liq nomi — sarlavha (title) va Excel'da */
const PAY_SHORT: Record<PayGroupKey, string> = { BANK: "Perech.", CASH: "Naqd", DEBT: "Qarz" };
/** Ustun kengliklari, % (`table-fixed`): Sana, To'lov, Sotuvchi, Xaridor, Mahsulot, TTN/mashina, Miqdor, Narx, Dastavka, Summa, QQS, Jami, Manzil, Hujjatlar */
const COL_W = [6.2, 4.8, 6.4, 7.9, 6.9, 7.7, 5.3, 8, 8, 9.1, 6.4, 9.1, 6, 8.2];

const n0 = (v: number) => (v ? fmtNum(v, 0) : "");
const nq = (v: number) => fmtNum(v, 3);
/** «N-2026-00161» → «161» (varaqdagidek qisqa); to'liq raqam — sarlavhada va Excel'da */
const shortTtn = (v: string | null) => (v ? v.replace(/^.*-0*(?=\d)/, "") : "");
const parse = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : null);

export default async function RealizatsiyaPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("/sales/realizatsiya");
  const sp = await searchParams;
  const now = new Date();
  let from = parse(sp.from) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  let to = parse(sp.to) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (from > to) [from, to] = [to, from];

  const all = await realizationRows(from, to);
  const tur = PAY_GROUPS.some((g) => g.key === sp.tur) ? (sp.tur as PayGroupKey) : null;
  const groups = [...new Set(all.map((r) => r.group))].sort((a, b) => a.localeCompare(b, "uz"));
  const guruh = sp.guruh && groups.includes(sp.guruh) ? sp.guruh : null;
  const needle = sp.q?.trim().toLowerCase() ?? "";
  const onlyMissing = sp.hujjat === "yoq";
  const match = (r: RealizationRow) => !needle || [r.customer, r.ttn, r.vehicle, r.seller, r.product, r.address].some((v) => v?.toLowerCase().includes(needle));
  // To'lov turi tablari soni — boshqa filtrlar qo'llangan holda
  const base = all.filter((r) => (!guruh || r.group === guruh) && match(r) && (!onlyMissing || r.missing.length > 0));
  const rows = base.filter((r) => !tur || r.pay === tur);

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const v: SP = { from: isoDate(from), to: isoDate(to), tur: tur ?? undefined, guruh: guruh ?? undefined, q: sp.q || undefined, hujjat: onlyMissing ? "yoq" : undefined, ...patch };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    return `/sales/realizatsiya?${p}`;
  };

  const sum = (f: (r: RealizationRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const byUnit = new Map<string, number>();
  for (const r of rows) if (r.unit) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + r.qty);
  const qtyText = [...byUnit].map(([u, q]) => `${nq(q)} ${u}`).join(" · ") || "0";
  const trips = new Set(rows.map((r) => r.tripId).filter(Boolean)).size;
  const missingCount = new Set(all.filter((r) => r.missing.length).map((r) => r.orderId)).size;
  const period = `${dateRu(from)} — ${dateRu(to)}`;

  // Excel — varaqdagi ustunlar to'liq
  const excelRows = rows.map((r) => ({
    "Sana": dateRu(r.date), "To'lov turi": r.payLabel, "Sotuvchi": r.seller, "Xaridor": r.customer, "Mahsulot": r.product,
    "TTN №": r.ttn, "Mashina": r.vehicle, "O'lchov": r.unit, "Miqdor": r.qty, "Narx (QQSsiz)": r.price, "Dostavka": r.delivery || null,
    "Summa (QQSsiz)": r.net, "QQS 12%": r.vat || null, "Jami": r.total, "Guruh": r.group, "Manzil": r.address,
    "Izoh": [r.ttn && `TTN ${r.ttn}`, r.vehicle && `mash. ${r.vehicle}`, r.phone].filter(Boolean).join("; "),
    "Shartnoma №": r.contractNo, "Sch-faktura": r.invoiceNo, "Hujjatlar": r.missing.length ? `yo'q: ${r.missing.join(", ")}` : "",
  }));

  return (
    <div>
      <PageHeader
        back={{ href: "/sales", label: "Sotuv" }}
        title="Realizatsiya"
        subtitle={`${period} · ${trips} ta reys (TTN) · ${rows.length} qator`}
        action={<ExcelButton file={`Realizatsiya ${period}`} sheets={[{ name: "Realizatsiya", rows: excelRows }]} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Jo'natildi" value={qtyText} hint={`${trips} ta reys`} icon={Truck} />
        <StatCard label="Summa (QQSsiz)" value={fmtNum(sum((r) => r.net), 0)} hint={`dastavka ${fmtNum(sum((r) => r.delivery), 0)}`} icon={Receipt} />
        <StatCard label="Jami (QQS bilan)" value={fmtNum(sum((r) => r.total), 0)} hint={`QQS 12%: ${fmtNum(sum((r) => r.vat), 0)}`} icon={Wallet} tone="success" />
        <StatCard label="Hujjati to'liq emas" value={`${missingCount} ta`} hint="perechisleniye: shartnoma yoki sch-faktura yo'q" icon={FileWarning} tone={missingCount ? "warning" : "default"} href={missingCount ? qs({ hujjat: "yoq" }) : undefined} />
      </div>

      <form className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {tur && <input type="hidden" name="tur" value={tur} />}
        {guruh && <input type="hidden" name="guruh" value={guruh} />}
        {onlyMissing && <input type="hidden" name="hujjat" value="yoq" />}
        <Input name="from" type="date" defaultValue={isoDate(from)} className="h-9 w-40" aria-label="Davr boshi" />
        <span className="text-slate-400">—</span>
        <Input name="to" type="date" defaultValue={isoDate(to)} className="h-9 w-40" aria-label="Davr oxiri" />
        <label className="relative">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <Input name="q" defaultValue={sp.q} placeholder="Xaridor, TTN, mashina, sotuvchi…" aria-label="Qidirish" className="h-9 w-72 pl-9" />
        </label>
        <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
        {(sp.from || sp.to || sp.q || guruh || tur || onlyMissing) && <Link href="/sales/realizatsiya" className="text-xs text-slate-500 hover:underline">tozalash (joriy oy)</Link>}
      </form>

      <div className="flex flex-wrap items-start gap-x-3">
        <Tabs current={tur ?? ""} items={[
          { key: "", label: "Hammasi", href: qs({ tur: undefined }), count: base.length },
          ...PAY_GROUPS.map((g) => ({ key: g.key, label: g.label, href: qs({ tur: g.key }), count: base.filter((r) => r.pay === g.key).length })),
        ]} />
        {groups.length > 1 && (
          <Tabs current={guruh ?? ""} items={[{ key: "", label: "Barcha guruh", href: qs({ guruh: undefined }) }, ...groups.map((g) => ({ key: g, label: g, href: qs({ guruh: g }) }))]} />
        )}
        {onlyMissing && (
          <Link href={qs({ hujjat: undefined })} className="mb-4 inline-flex h-10 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-800 hover:bg-amber-100">
            Faqat hujjati to&apos;liq emaslar <span aria-hidden>×</span>
          </Link>
        )}
      </div>

      <Sheet lang="uz" maxHeight="75vh" className="[&_table]:min-w-[1040px] [&_table]:table-fixed [&_table]:text-[11.5px] [&_td]:px-1 [&_td]:break-words [&_th]:px-1 [&_th]:text-[11px] [&_th]:whitespace-normal">
        <colgroup>{COL_W.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
        <SheetHead>
          <tr>
            <SheetTh tone="green">Sana</SheetTh><SheetTh tone="green">To&apos;lov turi</SheetTh><SheetTh tone="green">Sotuvchi</SheetTh>
            <SheetTh tone="green">Xaridor</SheetTh><SheetTh tone="green">Mahsulot</SheetTh><SheetTh tone="green">TTN / mashina</SheetTh>
            <SheetTh tone="green" right>Miqdor</SheetTh><SheetTh tone="green" right>Narx (QQSsiz)</SheetTh><SheetTh tone="green" right>Dostavka</SheetTh>
            <SheetTh tone="green" right>Summa (QQSsiz)</SheetTh><SheetTh tone="green" right>QQS 12%</SheetTh><SheetTh tone="green" right>Jami</SheetTh>
            <SheetTh tone="green">Manzil</SheetTh><SheetTh tone="yellow" title="Buxgalter uchun: shartnoma va schyot-faktura">Hujjatlar</SheetTh>
          </tr>
        </SheetHead>
        <tbody>
          {rows.length === 0 && <SheetTr><SheetTd colSpan={14} center muted className="py-8">Bu davrda jo&apos;natma yo&apos;q</SheetTd></SheetTr>}
          {rows.map((r) => (
            <SheetTr key={r.key}>
              <SheetTd className="tabular">{dateRu(r.date)}</SheetTd>
              <SheetTd className={cn("font-medium", PAY_COLOR[r.pay])}><span title={r.payLabel}>{PAY_SHORT[r.pay]}</span></SheetTd>
              <SheetTd>{r.seller}</SheetTd>
              <SheetTd><Link href={`/orders/${r.orderId}`} className="font-medium text-slate-900 hover:underline">{r.customer}</Link></SheetTd>
              <SheetTd>{r.product}<span className="block text-[11px] text-slate-500">{r.group}</span></SheetTd>
              <SheetTd>
                {r.tripId ? <Link href={`/trips/${r.tripId}`} title={r.ttn ?? undefined} className="font-medium whitespace-nowrap tabular hover:underline">{shortTtn(r.ttn)}</Link> : <span className="text-slate-400">—</span>}
                <span className="block text-[11px] text-slate-500 tabular">{r.vehicle}</span>
              </SheetTd>
              <SheetTd right strong className="whitespace-normal">{nq(r.qty)} <span className="font-normal text-slate-500">{r.unit}</span></SheetTd>
              <SheetTd right>{n0(r.price)}</SheetTd>
              <SheetTd right tone={r.delivery ? "yellow" : undefined}>{n0(r.delivery)}</SheetTd>
              <SheetTd right>{n0(r.net)}</SheetTd>
              <SheetTd right muted={!r.vat}>{r.vat ? n0(r.vat) : "—"}</SheetTd>
              <SheetTd right strong>{n0(r.total)}</SheetTd>
              <SheetTd><span className="line-clamp-2" title={r.address}>{r.address}</span></SheetTd>
              <SheetTd tone="yellow">
                {(r.contractNo || r.invoiceNo) && (
                  <span className="block text-[11px] text-slate-600">{[r.contractNo && `Shartnoma ${r.contractNo}`, r.invoiceNo && `SF ${r.invoiceNo}`].filter(Boolean).join(" · ")}</span>
                )}
                {r.missing.length > 0 ? <span className="block text-[11px] font-semibold text-red-700">yo&apos;q: {r.missing.join(", ")}</span>
                  : r.pay === "BANK" ? <span className="text-[11px] font-semibold text-emerald-700">to&apos;liq</span> : null}
              </SheetTd>
            </SheetTr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <SheetFoot>
            <tr>
              <SheetTd colSpan={6}>Jami: {rows.length} qator</SheetTd>
              <SheetTd right className="whitespace-normal">{qtyText}</SheetTd>
              <SheetTd />
              <SheetTd right className="whitespace-normal">{fmtNum(sum((r) => r.delivery), 0)}</SheetTd>
              <SheetTd right className="whitespace-normal">{fmtNum(sum((r) => r.net), 0)}</SheetTd>
              <SheetTd right className="whitespace-normal">{fmtNum(sum((r) => r.vat), 0)}</SheetTd>
              <SheetTd right className="whitespace-normal">{fmtNum(sum((r) => r.total), 0)}</SheetTd>
              <SheetTd colSpan={2} />
            </tr>
          </SheetFoot>
        )}
      </Sheet>
    </div>
  );
}
