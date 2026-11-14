import Link from "next/link";
import { randomUUID } from "crypto";
import { FileSpreadsheet, PenLine, Receipt, Search, Truck, Undo2, Wallet } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { pathAllowed } from "@/lib/nav";
import { canDo } from "@/lib/permissions";
import { dateRu, fmtNum, fmtTiyin, isoDate, opAt } from "@/lib/format";
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
/** Varaqda qisqa (to'liq nomi — ustiga olib borilsa) */
const PAY_SHORT: Record<PayGroupKey, string> = { BANK: "Perech.", CASH: "Naqd", DEBT: "Qarz" };
const SOURCES: { key: LogSource; label: string }[] = [{ key: "AUTO", label: "Reysdan" }, { key: "MANUAL", label: "Qo'lda" }];
const NO_PLACE = "—";

/** Summa 3 xonali kasr bilan («1 000 000.000»), nol — bo'sh katak */
const n0 = (v: number) => (v ? fmtTiyin(v) : "");
/** Varaqda kun.oy (yil — davr sarlavhasida, to'liq sana — ustiga olib borilsa) */
const dayMonth = (d: Date) => dateRu(d).slice(0, 5);
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
  const [log, options] = await Promise.all([realizationLog(from, to), canAuto || canManual || canTtn ? realizationOptions() : null]);
  // Eng yangi kun tepada (bugun, bo'lmasa oxirgi jo'natma kuni); kun ichida varaqdagi tartib (TTN) qoladi — sort barqaror
  const all = log.sort((a, b) => isoDate(b.date).localeCompare(isoDate(a.date)));
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

  // Ixcham varaq: ustun mazmun kengligida, uzun matn bir qatorda kesiladi (to'liq matni — ustiga olib borilsa).
  // Sarlavhalar qisqa, to'liq nomi `title` da; Excel eksportida to'liq nomlar qoladi.
  const clip = (text: string | null | undefined, width: string, node?: React.ReactNode) =>
    <span className={cn("block truncate", width)} title={text ?? undefined}>{node ?? text}</span>;
  const sheet = (
    <Sheet lang="uz" maxHeight="75vh" className="[&_td]:px-1 [&_td]:py-0.5 [&_td]:leading-5 [&_th]:px-1 [&_th]:py-1">
      <SheetHead>
        <tr>
          <SheetTh tone="green">Sana</SheetTh><SheetTh tone="green" title="To'lov turi">To&apos;lov</SheetTh><SheetTh tone="green">Sotuvchi</SheetTh>
          <SheetTh tone="green">Xaridor</SheetTh><SheetTh tone="green">Mahsulot</SheetTh><SheetTh tone="green" title="TTN №">TTN</SheetTh>
          <SheetTh tone="green" title="Mashina (raqami)">Mashina</SheetTh><SheetTh tone="green" title="O'lchov birligi">Birlik</SheetTh><SheetTh tone="green" right>Miqdor</SheetTh>
          <SheetTh tone="green" right title="Narx (QQSsiz)">Narx</SheetTh><SheetTh tone="yellow" right title="Dostavka (so'm)">Dost.</SheetTh><SheetTh tone="green" right title="Summa (QQSsiz)">Summa</SheetTh>
          <SheetTh tone="green" right title="QQS 12%">QQS</SheetTh><SheetTh tone="green" right title="Jami (QQS bilan)">Jami</SheetTh><SheetTh tone="green">Guruh</SheetTh><SheetTh tone="green" title="Ortilgan joy (BSU / Sklad)">Ortilgan</SheetTh>
          <SheetTh tone="green" title="Boradigan manzil">Manzil</SheetTh><SheetTh tone="green" title="Izoh (TTN, mashina, telefon)">Izoh</SheetTh><SheetTh tone="green" title="Xaridor (spravka nomi)">Spravka</SheetTh>
          {(canAuto || canManual) && <SheetTh tone="green"><span className="sr-only">Amal</span></SheetTh>}
        </tr>
      </SheetHead>
      <tbody>
        {rows.length === 0 && <SheetTr><SheetTd colSpan={20} center muted className="py-8">Bu davrda jo&apos;natma yo&apos;q</SheetTd></SheetTr>}
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
              {/* Qo'lda qator — chap chetida sariq chiziq (alohida yozuv qatorni balandlatmasin) */}
              <SheetTd className={cn("whitespace-nowrap tabular", !auto && "shadow-[inset_3px_0_0_var(--color-amber-400)]")}>
                <span title={`${dateRu(r.date)}${auto ? "" : " · qo'lda kiritilgan qator"}`}>{edit("date", "Sana", isoDate(r.date), opAt(r.date, r.at, dayMonth), { kind: "date" })}</span>
              </SheetTd>
              <SheetTd className={cn("font-medium whitespace-nowrap", PAY_COLOR[r.pay])}>{edit("payGroup", "To'lov turi", r.pay, <span title={r.payLabel}>{PAY_SHORT[r.pay]}</span>, { kind: "pay" })}</SheetTd>
              <SheetTd>{edit("seller", "Sotuvchi", r.seller, clip(r.seller, "max-w-24"), { list: "sellers" })}</SheetTd>
              {/* Xaridor reysdan qatorda tuzatilmaydi — u zayavkada */}
              <SheetTd className="font-medium text-slate-900">{auto
                ? clip(r.customer, "max-w-36", orderLink && r.orderId ? <Link href={`/orders/${r.orderId}`} className="hover:underline">{r.customer}</Link> : undefined)
                : edit("customerName", "Xaridor", r.customer, clip(r.customer, "max-w-36"), { list: "customers" })}</SheetTd>
              <SheetTd>{edit("productName", "Mahsulot", r.product, clip(r.product, "max-w-28"), { list: "products" })}</SheetTd>
              <SheetTd className="whitespace-nowrap tabular">
                {auto && r.tripId
                  ? canTtn
                    ? <CellEdit target={`t:${r.tripId}`} field="ttn" label="TTN" value={r.tripTtn ?? ""} placeholder={r.ttn ?? ""}>{ttnNode}</CellEdit>
                    : ttnNode
                  : edit("ttn", "TTN", r.ttn ?? "", r.ttn)}
              </SheetTd>
              <SheetTd className="whitespace-nowrap tabular">{edit("vehicle", "Mashina", r.vehicle ?? "", clip(r.vehicle, "max-w-24"), { list: "vehicles" })}</SheetTd>
              <SheetTd className="whitespace-nowrap">{edit("unit", "O'lchov", r.unitKey, r.unit, { kind: "unit" })}</SheetTd>
              <SheetTd right strong>{edit("qty", "Miqdor", String(r.qty), nq(r.qty), { kind: "number", right: true })}</SheetTd>
              <SheetTd right>{edit("price", "Narx", r.price ? String(r.price) : "", n0(r.price), { kind: "number", right: true })}</SheetTd>
              <SheetTd right tone="yellow">{edit("delivery", "Dostavka", r.delivery ? String(r.delivery) : "", n0(r.delivery), { kind: "number", right: true })}</SheetTd>
              <SheetTd right>{n0(r.net)}</SheetTd>
              <SheetTd right muted={!r.vat}>{r.vat ? n0(r.vat) : "—"}</SheetTd>
              <SheetTd right strong>{n0(r.total)}</SheetTd>
              <SheetTd>{edit("groupName", "Guruh", r.group, clip(r.group, "max-w-24"), { list: "groups" })}</SheetTd>
              <SheetTd className={cn(hint("loadPlace"))}>{extra("loadPlace", "Ortilgan joy", clip(r.loadPlace, "max-w-20"), "loadPlaces")}</SheetTd>
              <SheetTd className={cn(hint("destination"))}>{extra("destination", "Boradigan manzil", clip(r.destination, "max-w-32"), "destinations")}</SheetTd>
              <SheetTd className={cn(hint("note"))}>{extra("note", "Izoh", clip(r.note, "max-w-32"))}</SheetTd>
              <SheetTd className={cn(hint("refName"))}>{extra("refName", "Spravka nomi", clip(r.refName, "max-w-28"))}</SheetTd>
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
                        question={`${dateRu(r.date)} · ${r.customer} · ${r.product} qatori bekor qilinsinmi?`} okText="Bekor qilindi" className="h-6 px-1" />
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
            <SheetTd right>{fmtTiyin(sum((r) => r.delivery))}</SheetTd>
            <SheetTd right>{fmtTiyin(sum((r) => r.net))}</SheetTd>
            <SheetTd right>{fmtTiyin(sum((r) => r.vat))}</SheetTd>
            <SheetTd right>{fmtTiyin(sum((r) => r.total))}</SheetTd>
            <SheetTd colSpan={canAuto || canManual ? 6 : 5} />
          </tr>
        </SheetFoot>
      )}
    </Sheet>
  );

  // `data-wide` — qobiqning 1400px cheklovi olinadi, varaq ekranning ikki yoniga yoyiladi
  const body = (
    <div data-wide>
      <PageHeader
        title="Realizatsiya"
        subtitle={`${period} · ${trips} ta reys (TTN) · ${rows.length} qator`}
        info={canAuto ? <>
          <p>Reysdan tushgan qatorda xaridordan boshqa ustunlar katakdagi qalamcha bilan tuzatiladi (qalamcha katak ustiga olib borilganda chiqadi) — faqat shu reestrda (zayavka, mijoz qarzi, kassa va sklad o&apos;zgarmaydi).</p>
          <p>Qo&apos;lda kiritilgan qator — sariq fonda, chap chetida sariq chiziq.</p>
          <p>Tuzatilgan qiymat <span className="underline decoration-amber-500 decoration-dotted decoration-2 underline-offset-2">sariq tagchiziqli</span>, ustiga olib borilsa zayavkadagi qiymat ko&apos;rinadi; katak bo&apos;shatilsa o&apos;shanga qaytadi.</p>
        </> : undefined}
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
        <StatCard label="Summa (QQSsiz)" value={fmtTiyin(sum((r) => r.net))} hint={`dastavka ${fmtTiyin(sum((r) => r.delivery))}`} icon={Receipt} />
        <StatCard label="Jami (QQS bilan)" value={fmtTiyin(sum((r) => r.total))} hint={`QQS 12%: ${fmtTiyin(sum((r) => r.vat))}`} icon={Wallet} tone="success" />
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
    </div>
  );
  return options ? <OptionsProvider options={options}>{body}</OptionsProvider> : body;
}
