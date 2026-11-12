import Link from "next/link";
import { randomUUID } from "crypto";
import { FileSpreadsheet, PenLine, Receipt, Search, Truck, Undo2, Wallet } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { pathAllowed } from "@/lib/nav";
import { canDo } from "@/lib/permissions";
import { dateRu, fmtNum, isoDate, opAt } from "@/lib/format";
import { LINE_CELLS, realizationLog, realizationOptions, type AutoCell, type LogRow, type LogSource } from "@/lib/realization-log";
import { PAY_GROUPS, type PayGroupKey } from "@/lib/order-day-sheet";
import { Button, Callout, Input, LinkButton, PageHeader, Select, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr, StatCard, Tabs } from "@/components/ui";
import { ExcelButton } from "../excel-button";
import { ConfirmButton } from "../../payments/confirm-button";
import { cancelRealizationAction } from "./actions";
import { CellEdit, EntryButton, NoteButton, OptionsProvider, type CellList } from "./forms";
import { cn } from "@/lib/utils";

/**
 * Logistika → «Realizatsiya» (dispetcher): jo'natmalar reestri Google varag'idagi ustunlar bilan. Reys (TTN) qatorlari
 * zayavkadan o'zi tushadi — dispetcher ortilgan joy, manzil, izohni to'ldiradi (`logistika.real_auto`); tizimga tushmagan
 * jo'natma qo'lda qo'shiladi (`logistika.real_manual`). Faqat reestr — qarz va kassaga ta'sir qilmaydi. Hisob — `lib/realization-log.ts`.
 */
type SP = { from?: string; to?: string; tur?: string; guruh?: string; manba?: string; joy?: string; q?: string; import?: string };

const PAY_COLOR: Record<PayGroupKey, string> = { BANK: "text-blue-700", CASH: "text-emerald-700", DEBT: "text-red-700" };
const SOURCES: { key: LogSource; label: string }[] = [{ key: "AUTO", label: "Reysdan" }, { key: "MANUAL", label: "Qo'lda" }];
const NO_PLACE = "—";

const n0 = (v: number) => (v ? fmtNum(v, 0) : "");
const nq = (v: number) => fmtNum(v, 3);
const parse = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : null);

export default async function LogistikaRealizatsiyaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requirePage("/logistika/realizatsiya");
  const sp = await searchParams;
  const now = new Date();
  let from = parse(sp.from) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  let to = parse(sp.to) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (from > to) [from, to] = [to, from];

  const canAuto = canDo(s, "logistika", "real_auto");
  const canManual = canDo(s, "logistika", "real_manual");
  // TTN reysning o'zida — reys ochuvchi yoki reestrni yurituvchi dispetcher yozadi
  const canTtn = canAuto || canDo(s, "trips", "create");
  const [all, options] = await Promise.all([realizationLog(from, to), canAuto || canManual || canTtn ? realizationOptions() : null]);
  const orderLink = pathAllowed("/orders", s.role, s.perms);
  const tripLink = pathAllowed("/trips", s.role, s.perms);

  const tur = PAY_GROUPS.some((g) => g.key === sp.tur) ? (sp.tur as PayGroupKey) : null;
  const manba = SOURCES.some((x) => x.key === sp.manba) ? (sp.manba as LogSource) : null;
  const groups = [...new Set(all.map((r) => r.group))].sort((a, b) => a.localeCompare(b, "uz"));
  const guruh = sp.guruh && groups.includes(sp.guruh) ? sp.guruh : null;
  const places = [...new Set(all.map((r) => r.loadPlace || NO_PLACE))].sort((a, b) => a.localeCompare(b, "uz", { numeric: true }));
  const joy = sp.joy && places.includes(sp.joy) ? sp.joy : null;
  const needle = sp.q?.trim().toLowerCase() ?? "";
  const match = (r: LogRow) => !needle || [r.customer, r.refName, r.ttn, r.vehicle, r.seller, r.product, r.destination, r.note].some((v) => v?.toLowerCase().includes(needle));
  // Tab sonlari — boshqa filtrlar qo'llangan holda
  const base = all.filter((r) => (!guruh || r.group === guruh) && (!joy || (r.loadPlace || NO_PLACE) === joy) && match(r));
  const bySource = base.filter((r) => !manba || r.source === manba);
  const rows = bySource.filter((r) => !tur || r.pay === tur);

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const v: SP = { from: isoDate(from), to: isoDate(to), tur: tur ?? undefined, guruh: guruh ?? undefined, manba: manba ?? undefined, joy: joy ?? undefined, q: sp.q || undefined, ...patch };
    for (const [k, x] of Object.entries(v)) if (x) p.set(k, x);
    return `/logistika/realizatsiya?${p}`;
  };

  const sum = (f: (r: LogRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const byUnit = new Map<string, number>();
  for (const r of rows) if (r.unit) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + r.qty);
  const qtyText = [...byUnit].map(([u, q]) => `${nq(q)} ${u}`).join(" · ") || "0";
  const trips = new Set(rows.map((r) => r.tripId).filter(Boolean)).size;
  const manual = rows.filter((r) => r.source === "MANUAL").length;
  const period = `${dateRu(from)} — ${dateRu(to)}`;
  // Excel importdan qaytganda: «qo'shildi-o'tkazib yuborildi[-o'lchovi nomidan qo'yilgan[-yangi mahsulot[-yangi mijoz]]]»
  const imported = /^(\d+)-(\d+)(?:-(\d+))?(?:-(\d+))?(?:-(\d+))?$/.exec(sp.import ?? "");

  // Excel — varaqdagi ustunlar tartibida
  const excelRows = rows.map((r) => ({
    "Sana": dateRu(r.date), "To'lov turi": r.payLabel, "Sotuvchi": r.seller, "Xaridor": r.customer, "Mahsulot": r.product,
    "TTN №": r.ttn, "Mashina (raqami)": r.vehicle, "O'lchov": r.unit, "Miqdor": r.qty, "Narx (QQSsiz)": r.price, "Dostavka (so'm)": r.delivery || null,
    "Summa (QQSsiz)": r.net, "QQS 12%": r.vat || null, "Jami": r.total, "Guruh": r.group, "Ortilgan joy (BSU / Sklad)": r.loadPlace,
    "Boradigan manzil": r.destination, "Izoh (TTN, mashina, telefon)": r.note, "Xaridor (spravka nomi)": r.refName,
    "Manba": r.source === "MANUAL" ? "Qo'lda" : "Reysdan",
  }));

  const sheet = (
    <Sheet lang="uz" maxHeight="75vh" className="[&_table]:min-w-[1900px] [&_table]:text-[11.5px] [&_td]:px-1.5 [&_th]:px-1.5 [&_th]:text-[11px] [&_th]:whitespace-normal">
      <SheetHead>
        <tr>
          <SheetTh tone="green">Sana</SheetTh><SheetTh tone="green">To&apos;lov turi</SheetTh><SheetTh tone="green">Sotuvchi</SheetTh>
          <SheetTh tone="green">Xaridor</SheetTh><SheetTh tone="green">Mahsulot</SheetTh><SheetTh tone="green">TTN №</SheetTh>
          <SheetTh tone="green">Mashina (raqami)</SheetTh><SheetTh tone="green">O&apos;lchov</SheetTh><SheetTh tone="green" right>Miqdor</SheetTh>
          <SheetTh tone="green" right>Narx (QQSsiz)</SheetTh><SheetTh tone="yellow" right>Dostavka (so&apos;m)</SheetTh><SheetTh tone="green" right>Summa (QQSsiz)</SheetTh>
          <SheetTh tone="green" right>QQS 12%</SheetTh><SheetTh tone="green">Guruh</SheetTh><SheetTh tone="green">Ortilgan joy (BSU / Sklad)</SheetTh>
          <SheetTh tone="green">Boradigan manzil</SheetTh><SheetTh tone="green">Izoh (TTN, mashina, telefon)</SheetTh><SheetTh tone="green">Xaridor (spravka nomi)</SheetTh>
          {(canAuto || canManual) && <SheetTh tone="green"><span className="sr-only">Amal</span></SheetTh>}
        </tr>
      </SheetHead>
      <tbody>
        {rows.length === 0 && <SheetTr><SheetTd colSpan={19} center muted className="py-8">Bu davrda jo&apos;natma yo&apos;q</SheetTd></SheetTr>}
        {rows.map((r) => {
          const auto = r.source === "AUTO";
          // Reysdan qatorda to'ldirilmagan maydon — taklif, kulrang
          const hint = (k: "loadPlace" | "destination" | "note" | "refName") => auto && !r.filled?.[k] && "text-slate-400";
          // Har katakda qalamcha: qo'lda qatorda hamma ustun; reysdan qatorda xaridordan boshqasi — faqat reestrda tuzatiladi
          // (reys bo'yicha «a:», mahsulot qatori bo'yicha «l:»), bo'shatilsa zayavkadagi qiymat qaytadi
          const manual = !auto && canManual ? `m:${r.ref}` : null;
          const target = (field: string) => manual ?? (auto && canAuto && r.line ? ((LINE_CELLS as readonly string[]).includes(field) ? `l:${r.line}` : `a:${r.ref}`) : null);
          type Opt = { kind?: "text" | "number" | "date" | "pay" | "unit"; list?: CellList; placeholder?: string; right?: boolean };
          const edit = (field: string, label: string, value: string, node: React.ReactNode, o: Opt = {}) => {
            const t = target(field);
            if (!t) return node;
            // Tuzatilgan qiymat — sariq nuqtali tagchiziq, ustida asl qiymat
            const was = r.orig[field as AutoCell];
            const shown = was === undefined ? node : <span title={`Tuzatilgan. Zayavkada: ${was}`} className="underline decoration-amber-500 decoration-dotted decoration-2 underline-offset-2">{node}</span>;
            return <CellEdit target={t} field={field} label={label} value={value} {...(was !== undefined && (!o.kind || o.kind === "number") ? { placeholder: was } : {})} {...o}>{shown}</CellEdit>;
          };
          // Ortilgan joy, manzil, izoh, spravka nomi: reysdan — bo'sh qoldirilsa taklif qaytadi
          const extra = (field: "loadPlace" | "destination" | "note" | "refName", label: string, node: React.ReactNode, list?: CellList) =>
            auto
              ? canAuto && r.filled && r.suggest
                ? <CellEdit target={`a:${r.ref}`} field={field} label={label} value={r.filled[field] ?? ""} placeholder={r.suggest[field] ?? ""} list={list}>{node}</CellEdit>
                : node
              : edit(field, label, field === "refName" && r.refName === r.customer ? "" : r[field], node, { list, placeholder: field === "refName" ? r.customer : undefined });
          const ttnNode = r.tripId && tripLink ? <Link href={`/trips/${r.tripId}`} className="font-medium hover:underline">{r.ttn}</Link> : r.ttn;
          return (
            <SheetTr key={r.key} className={cn(!auto && "bg-amber-50/40")}>
              <SheetTd className="whitespace-nowrap tabular">
                {edit("date", "Sana", isoDate(r.date), <>
                  {opAt(r.date, r.at, dateRu)}
                  {!auto && <span className="block text-[10px] font-semibold text-amber-700" title="Qo'lda kiritilgan qator">qo&apos;lda</span>}
                </>, { kind: "date" })}
              </SheetTd>
              <SheetTd className={cn("font-medium whitespace-nowrap", PAY_COLOR[r.pay])}>{edit("payGroup", "To'lov turi", r.pay, r.payLabel, { kind: "pay" })}</SheetTd>
              <SheetTd>{edit("seller", "Sotuvchi", r.seller, r.seller, { list: "sellers" })}</SheetTd>
              {/* Xaridor reysdan qatorda tuzatilmaydi — u zayavkada */}
              <SheetTd>{auto
                ? orderLink && r.orderId ? <Link href={`/orders/${r.orderId}`} className="font-medium text-slate-900 hover:underline">{r.customer}</Link> : <span className="font-medium text-slate-900">{r.customer}</span>
                : edit("customerName", "Xaridor", r.customer, <span className="font-medium text-slate-900">{r.customer}</span>, { list: "customers" })}</SheetTd>
              <SheetTd>{edit("productName", "Mahsulot", r.product, r.product, { list: "products" })}</SheetTd>
              <SheetTd className="whitespace-nowrap tabular">
                {auto && r.tripId
                  ? canTtn
                    ? <CellEdit target={`t:${r.tripId}`} field="ttn" label="TTN" value={r.tripTtn ?? ""} placeholder={r.ttn ?? ""}>{ttnNode}</CellEdit>
                    : ttnNode
                  : edit("ttn", "TTN", r.ttn ?? "", r.ttn)}
              </SheetTd>
              <SheetTd className="whitespace-nowrap tabular">{edit("vehicle", "Mashina", r.vehicle ?? "", r.vehicle, { list: "vehicles" })}</SheetTd>
              <SheetTd>{edit("unit", "O'lchov", r.unitKey, r.unit, { kind: "unit" })}</SheetTd>
              <SheetTd right strong>{edit("qty", "Miqdor", String(r.qty), nq(r.qty), { kind: "number", right: true })}</SheetTd>
              <SheetTd right>{edit("price", "Narx", r.price ? String(r.price) : "", n0(r.price), { kind: "number", right: true })}</SheetTd>
              <SheetTd right tone="yellow">{edit("delivery", "Dostavka", r.delivery ? String(r.delivery) : "", n0(r.delivery), { kind: "number", right: true })}</SheetTd>
              <SheetTd right>{n0(r.net)}</SheetTd>
              <SheetTd right muted={!r.vat}>{r.vat ? n0(r.vat) : "—"}</SheetTd>
              <SheetTd>{edit("groupName", "Guruh", r.group, r.group, { list: "groups" })}</SheetTd>
              <SheetTd className={cn(hint("loadPlace"))}>{extra("loadPlace", "Ortilgan joy", r.loadPlace, "loadPlaces")}</SheetTd>
              <SheetTd className={cn(hint("destination"))}>{extra("destination", "Boradigan manzil", <span className="line-clamp-2" title={r.destination}>{r.destination}</span>, "destinations")}</SheetTd>
              <SheetTd className={cn(hint("note"))}>{extra("note", "Izoh", <span className="line-clamp-2" title={r.note}>{r.note}</span>)}</SheetTd>
              <SheetTd className={cn(hint("refName"))}>{extra("refName", "Spravka nomi", r.refName)}</SheetTd>
              {(canAuto || canManual) && (
                <SheetTd className="whitespace-nowrap">
                  {auto && canAuto && r.filled && r.suggest && (
                    <NoteButton refKey={r.ref} title={`TTN ${r.ttn ?? "—"} · ${r.customer}`} filled={r.filled} suggest={r.suggest} />
                  )}
                  {!auto && canManual && (
                    <span className="inline-flex items-center gap-0.5">
                      <EntryButton entry={{
                        id: r.ref, date: isoDate(r.date), payGroup: r.pay, seller: r.seller, customerName: r.customer, productName: r.product, groupName: r.group,
                        unit: r.unitKey, ttn: r.ttn ?? "", vehicle: r.vehicle ?? "", qty: r.qty, price: r.price, delivery: r.delivery,
                        loadPlace: r.loadPlace, destination: r.destination, note: r.note, refName: r.refName === r.customer ? "" : r.refName,
                      }} />
                      <ConfirmButton action={cancelRealizationAction.bind(null, r.ref)} reason="required" label="" title="Bekor qilish" icon={<Undo2 size={14} />}
                        question={`${dateRu(r.date)} · ${r.customer} · ${r.product} qatori bekor qilinsinmi?`} okText="Bekor qilindi" className="h-7 px-1.5" />
                    </span>
                  )}
                </SheetTd>
              )}
            </SheetTr>
          );
        })}
      </tbody>
      {rows.length > 0 && (
        <SheetFoot>
          <tr>
            <SheetTd colSpan={8}>Jami: {rows.length} qator</SheetTd>
            <SheetTd right className="whitespace-normal">{qtyText}</SheetTd>
            <SheetTd />
            <SheetTd right>{fmtNum(sum((r) => r.delivery), 0)}</SheetTd>
            <SheetTd right>{fmtNum(sum((r) => r.net), 0)}</SheetTd>
            <SheetTd right>{fmtNum(sum((r) => r.vat), 0)}</SheetTd>
            <SheetTd colSpan={canAuto || canManual ? 6 : 5} />
          </tr>
        </SheetFoot>
      )}
    </Sheet>
  );

  const body = (
    <div>
      <PageHeader
        title="Realizatsiya"
        subtitle={`${period} · ${trips} ta reys (TTN) · ${rows.length} qator`}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            {canManual && <LinkButton href="/logistika/realizatsiya/import" variant="secondary"><FileSpreadsheet size={16} /> Excel&apos;dan import</LinkButton>}
            {canManual && <EntryButton clientToken={randomUUID()} />}
            <ExcelButton file={`Realizatsiya ${period}`} sheets={[{ name: "Realizatsiya", rows: excelRows }]} />
          </div>
        )}
      />

      {imported && (
        <Callout tone="success" title="Excel'dan import qilindi">
          {imported[1]} ta qator «Qo&apos;lda» bo&apos;lib qo&apos;shildi{Number(imported[2]) > 0 && `, ${imported[2]} tasi reestrda bor edi — o'tkazib yuborildi`}.
          {Number(imported[4]) > 0 && ` Katalogga ${imported[4]} ta yangi mahsulot qo'shildi (narxi 0).`}
          {Number(imported[5]) > 0 && ` Mijozlar ro'yxatiga ${imported[5]} ta yangi xaridor qo'shildi.`}
          {Number(imported[3]) > 0 && ` ${imported[3]} tasida o'lchov ko'rsatilmagan yoki tanilmadi — mahsulot nomidan qo'yildi (m³ yoki dona), kerak bo'lsa mahsulotlar katalogida tuzating.`}
        </Callout>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Jo'natildi" value={qtyText} hint={`${trips} ta reys`} icon={Truck} />
        <StatCard label="Summa (QQSsiz)" value={fmtNum(sum((r) => r.net), 0)} hint={`dastavka ${fmtNum(sum((r) => r.delivery), 0)}`} icon={Receipt} />
        <StatCard label="Jami (QQS bilan)" value={fmtNum(sum((r) => r.total), 0)} hint={`QQS 12%: ${fmtNum(sum((r) => r.vat), 0)}`} icon={Wallet} tone="success" />
        <StatCard label="Qo'lda qatorlar" value={`${manual} ta`} hint="tizimga reys bo'lib tushmagan" icon={PenLine} href={manual ? qs({ manba: "MANUAL" }) : undefined} />
      </div>

      <form className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {tur && <input type="hidden" name="tur" value={tur} />}
        {guruh && <input type="hidden" name="guruh" value={guruh} />}
        {manba && <input type="hidden" name="manba" value={manba} />}
        <Input name="from" type="date" defaultValue={isoDate(from)} className="h-9 w-40" aria-label="Davr boshi" />
        <span className="text-slate-400">—</span>
        <Input name="to" type="date" defaultValue={isoDate(to)} className="h-9 w-40" aria-label="Davr oxiri" />
        <Select name="joy" defaultValue={joy ?? ""} className="h-9 w-44" aria-label="Ortilgan joy">
          <option value="">Barcha ortilgan joy</option>
          {places.map((p) => <option key={p} value={p}>{p === NO_PLACE ? "Ortilgan joy yo'q" : p}</option>)}
        </Select>
        <label className="relative">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <Input name="q" defaultValue={sp.q} placeholder="Xaridor, TTN, mashina, manzil…" aria-label="Qidirish" className="h-9 w-72 pl-9" />
        </label>
        <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
        {(sp.from || sp.to || sp.q || guruh || tur || manba || joy) && <Link href="/logistika/realizatsiya" className="text-xs text-slate-500 hover:underline">tozalash (joriy oy)</Link>}
      </form>

      <div className="flex flex-wrap items-start gap-x-3">
        <Tabs current={manba ?? ""} items={[
          { key: "", label: "Hammasi", href: qs({ manba: undefined }), count: base.length },
          ...SOURCES.map((x) => ({ key: x.key, label: x.label, href: qs({ manba: x.key }), count: base.filter((r) => r.source === x.key).length })),
        ]} />
        <Tabs current={tur ?? ""} items={[
          { key: "", label: "Barcha to'lov", href: qs({ tur: undefined }), count: bySource.length },
          ...PAY_GROUPS.map((g) => ({ key: g.key, label: g.label, href: qs({ tur: g.key }), count: bySource.filter((r) => r.pay === g.key).length })),
        ]} />
        {groups.length > 1 && (
          <Tabs current={guruh ?? ""} items={[{ key: "", label: "Barcha guruh", href: qs({ guruh: undefined }) }, ...groups.map((g) => ({ key: g, label: g, href: qs({ guruh: g }) }))]} />
        )}
      </div>

      {sheet}
      {canAuto && (
        <p className="mt-2 text-xs text-slate-500">
          Reysdan tushgan qatorda xaridordan boshqa ustunlar katakdagi qalamcha bilan tuzatiladi — faqat shu reestrda (zayavka, mijoz qarzi, kassa va sklad o&apos;zgarmaydi).
          Tuzatilgan qiymat <span className="underline decoration-amber-500 decoration-dotted decoration-2 underline-offset-2">sariq tagchiziqli</span>, ustiga olib borilsa zayavkadagi qiymat ko&apos;rinadi; katak bo&apos;shatilsa o&apos;shanga qaytadi.
        </p>
      )}
    </div>
  );
  return options ? <OptionsProvider options={options}>{body}</OptionsProvider> : body;
}
