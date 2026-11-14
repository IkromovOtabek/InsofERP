import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileText, HandCoins, Scale, ShoppingCart, Wallet } from "lucide-react";
import type { Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { canDo } from "@/lib/permissions";
import { pathAllowed } from "@/lib/nav";
import { customerAkt, parseAktRange, supplierAkt } from "@/lib/fin-report/akt";
import { customerLedger, supplierLedger, type Ledger, type LedgerLine } from "@/lib/fin-report/ledger";
import { categoryOptions } from "@/lib/fin-report/categories";
import { DEBT_EPOCH, isDebtEpoch } from "@/lib/fin-report/debts";
import { dateRu, dateShort, fmtFixed, fmtNum, isoDate, moneyShort } from "@/lib/format";
import { Badge, Empty, Input, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { BackLink } from "@/components/ui/back-link";
import { PrintButton } from "@/components/print-button";
import { AktSverkaDoc } from "@/components/akt-sverka";
import { CashRow } from "@/app/(app)/payments/cash-detail";
import { CashEditProvider } from "@/app/(app)/payments/cash-edit";
import { cancelOpeningAction } from "@/app/(app)/settings/boshlangich-qoldiq/actions";
import { cancelRealizationAction } from "@/app/(app)/sales/realizatsiya/actions";
import { cancelDebtTransferAction } from "./actions";
import { DebtFixButton, DebtTransferButton, ReasonButton } from "./debt-dialogs";
import { canEnterDebts, debtEntryHref } from "./kiritish";
import { AktStats } from "./qarz";
import { cn } from "@/lib/utils";

/**
 * Qarz varag'idagi qator tafsiloti (Tahlil → Mijozlar → xaridor / ta'minotchi): davr boshi, sotib olgan (mahsulot, sana,
 * miqdor, narx, TTN), to'lagan (kassa, bank, boshqa mijoz), boshlang'ich qoldiq yozuvlari va akt sverka — bitta sahifada,
 * tablar bilan (`tab` = sotuv | tolov | qoldiq | akt). Har yozuv yonida manbasiga qarab tahrir / o'chirish:
 * kassa va to'lov — kassa tafsiloti oynasi, qarz o'tkazmasi va qoldiq — shu yerda, reys — zayavka sahifasi.
 * Raqamlar `lib/customer-ledger.ts` / `fin-report/ledger.ts` dan — varaqdagi qator bilan bir xil.
 */

type Tab = "sotuv" | "tolov" | "qoldiq" | "akt";
const TABS: Tab[] = ["sotuv", "tolov", "qoldiq", "akt"];
const qs = (o: Record<string, string | undefined>) => { const s = new URLSearchParams(Object.entries(o).filter((kv): kv is [string, string] => !!kv[1])).toString(); return s ? `?${s}` : ""; };
const side = (v: number) => (v > 0.005 ? "qarzdorlik — bizga qarz" : v < -0.005 ? "haqdorlik — biz qarzmiz" : "qarz yo'q");

export async function LedgerPage({ who, id, sp, session }: { who: "customer" | "supplier"; id: string; sp: { dan?: string; gacha?: string; tab?: string }; session: Session }) {
  const sup = who === "supplier";
  const base = sup ? "/bi-tahlil/mijozlar/taminotchilar" : "/bi-tahlil/mijozlar/xaridorlar";
  // Davr: varaqdan kelgan `dan` (boshidan — 2000-01-01) … `gacha`; to'g'ridan-to'g'ri ochilsa — boshidan bugungacha
  const range = parseAktRange(sp.dan ?? isoDate(DEBT_EPOCH), sp.gacha);
  const { from, to } = range;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "akt";
  const canFix = canEnterDebts(session);
  const [l, company] = await Promise.all([sup ? supplierLedger(id, from, to) : customerLedger(id, from, to), getCompany()]);
  if (!l) notFound();
  const allTime = isDebtEpoch(from);
  // Akt sverka «boshidan» — birinchi yozuv kunidan (hujjatda 01.01.2000 chiqmasin; undan oldin qoldiq yo'q)
  const aktFrom = allTime ? (l.lines[0]?.date ?? to) : from;
  const akt = tab === "akt" ? await (sup ? supplierAkt(id, aktFrom, to) : customerAkt(id, aktFrom, to)) : null;
  const keep = { dan: isoDate(from), gacha: isoDate(to) };
  const href = (t: Tab) => `${base}/${id}${qs({ ...keep, tab: t })}`;
  const back = `${base}${qs({ dan: allTime ? undefined : isoDate(from), sana: isoDate(to) })}`;
  const sold = l.lines.filter((x) => x.col === "sold"), paid = l.lines.filter((x) => x.col === "paid"), open = l.lines.filter((x) => x.col === "open");
  const owes = (v: number) => (sup ? -v : v); // qarzdorlik ishorasi: + ular bizga qarz
  const period = allTime ? `boshidan ${dateRu(to)} gacha` : `${dateRu(from)} – ${dateRu(to)}`;

  // Kassa tafsiloti oynasi (tahrir) uchun ro'yxatlar — faqat tahrir huquqi bo'lsa
  const canCashEdit = pathAllowed("/payments", session.role, session.perms) && canDo(session, "cashflow", "edit");
  const editOptions = canCashEdit && tab === "tolov"
    ? await Promise.all([
      db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
      categoryOptions("INCOME"), categoryOptions("EXPENSE"),
      db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]).then(([accounts, income, expense, customers]) => ({ accounts, income, expense, customers }))
    : null;
  const customers = !sup && canFix && (tab === "tolov" || tab === "sotuv")
    ? editOptions?.customers ?? await db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  const transfers = !sup && canFix ? await db.customerDebtTransfer.findMany({ where: { id: { in: paid.flatMap((x) => (x.ref?.kind === "transfer" ? [x.ref.id] : [])) } }, select: { id: true, docNo: true, date: true, debtorId: true, payerId: true, amount: true, note: true } }) : [];
  const trOf = new Map(transfers.map((t) => [t.id, t]));
  const canEntry = canDo(session, "logistika", "real_manual");

  return (
    <div className="space-y-5 p-1 sm:p-4 print:p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">{sup ? "Ta'minotchi" : "Xaridor"} · {period}</div>
          <h1 className="truncate text-[22px] font-bold text-slate-900">{l.name}</h1>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="tab" value={tab} />
            <label className="flex flex-col text-xs text-slate-500">Davr boshi<Input name="dan" type="date" defaultValue={allTime ? "" : isoDate(from)} max={isoDate(new Date())} className="h-9 w-40" /></label>
            <label className="flex flex-col text-xs text-slate-500">Davr oxiri<Input name="gacha" type="date" defaultValue={isoDate(to)} max={isoDate(new Date())} className="h-9 w-40" /></label>
            <button className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50">Ko&apos;rsatish</button>
          </form>
          {canFix && <DebtFixButton who={who} id={id} name={l.name} day={isoDate(to)} now={owes(l.closing)} label="Qoldiqni tuzatish" />}
          {!sup && canFix && <DebtTransferButton customers={customers.length ? customers : [{ id, name: l.name }]} debtorId={id} />}
          {!sup && <Link href={`/customers/${id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Mijoz kartasi</Link>}
          <BackLink href={back} label={sup ? "Ta'minotchilar qarzdorligi" : "Xaridorlar qarzdorligi"} />
          {tab === "akt" && <PrintButton />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 print:hidden">
        <StatCard label={allTime ? "Boshlang'ich qoldiq" : `Davr boshi, ${dateShort(from)}`} value={moneyShort(Math.abs(owes(l.open)))} hint={side(owes(l.open))} icon={Scale} href={href("qoldiq")} />
        <StatCard label={sup ? "Bizga bergan (kirim)" : "Sotib olgan"} value={moneyShort(l.sold)} hint={`${sold.length} ta hujjat`} icon={ShoppingCart} tone="brand" href={href("sotuv")} />
        <StatCard label={sup ? "Biz to'lagan" : "To'lagan"} value={moneyShort(l.paid)} hint={`${paid.length} ta yozuv`} icon={Wallet} tone="success" href={href("tolov")} />
        <StatCard label={`Davr oxiri, ${dateShort(to)}`} value={moneyShort(Math.abs(owes(l.closing)))} hint={side(owes(l.closing))} icon={HandCoins} tone={owes(l.closing) > 0.005 ? "danger" : owes(l.closing) < -0.005 ? "info" : "success"} href={href("akt")} />
      </div>

      <Tabs current={tab} className="print:hidden" items={[
        { key: "sotuv", label: sup ? "Bizga bergan" : "Sotib olgan", href: href("sotuv"), count: sold.length, icon: ShoppingCart },
        { key: "tolov", label: sup ? "Biz to'lagan" : "To'lagan", href: href("tolov"), count: paid.length, icon: Wallet },
        { key: "qoldiq", label: "Boshlang'ich qoldiq", href: href("qoldiq"), count: open.length, icon: Scale },
        { key: "akt", label: "Akt sverka", href: href("akt"), icon: FileText },
      ]} />

      {tab === "sotuv" && <SoldTable l={l} lines={sold} canEntry={canEntry} />}
      {tab === "tolov" && (() => {
        const table = <PaidTable l={l} lines={paid} canFix={canFix} customers={customers} trOf={trOf} cashRows={pathAllowed("/payments", session.role, session.perms)} />;
        return editOptions ? <CashEditProvider options={editOptions}>{table}</CashEditProvider> : table;
      })()}
      {tab === "qoldiq" && <OpenTable l={l} lines={open} canFix={canFix} entryHref={canFix ? debtEntryHref(who) : undefined} />}
      {tab === "akt" && akt && (
        <>
          <AktStats akt={akt} />
          <AktSverkaDoc akt={akt} company={company} />
        </>
      )}
    </div>
  );
}

const Money = ({ v, className }: { v: number; className?: string }) => <span className={cn("tabular", className)}>{fmtFixed(v)}</span>;

function SoldTable({ l, lines, canEntry }: { l: Ledger; lines: LedgerLine[]; canEntry: boolean }) {
  const sup = l.who === "supplier";
  const total = lines.reduce((s, x) => s + x.amount, 0);
  // Dastavka / QQS ustuni — davrda bittasida bo'lsagina (jadval ekranga sig'sin)
  const hasDel = lines.some((x) => x.items?.some((i) => i.delivery));
  const hasVat = lines.some((x) => x.items?.some((i) => i.vat));
  const lead = 5 + (hasDel ? 1 : 0) + (hasVat ? 1 : 0);
  return (
    <Table maxHeight="65vh">
      <thead>
        <tr>
          <Th>Sana</Th><Th>Hujjat</Th><Th>{sup ? "Material" : "Mahsulot"}</Th><Th right>Miqdor</Th><Th right>Narx</Th>{hasDel && <Th right>Dastavka</Th>}{hasVat && <Th right>QQS</Th>}<Th right>Summa</Th>
          {!sup && <Th>TTN · mashina · manzil</Th>}
          <Th>Kim</Th><Th className="w-40" />
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 && <Empty text={sup ? "Bu davrda kirim yo'q" : "Bu davrda qarzga sotuv yo'q (naqd va perechisleniye sotuv qarzga tushmaydi)"} />}
        {lines.map((x) => {
          const items = x.items?.length ? x.items : [{ name: x.doc, unit: "", qty: 0, price: 0, delivery: 0, vat: 0, total: x.amount }];
          return (
            <Tr key={x.key} className="align-top">
              <Td className="whitespace-nowrap">{dateRu(x.date)}</Td>
              <Td className="min-w-28">
                <div className="font-medium text-slate-900">{x.doc}</div>
                {(x.no || x.pay) && <div className="text-[12px] text-slate-500">{[x.no, x.pay].filter(Boolean).join(" · ")}</div>}
              </Td>
              <Td className="min-w-44">{items.map((i, k) => <div key={k} className="truncate">{i.name}</div>)}</Td>
              <Td right className="whitespace-nowrap">{items.map((i, k) => <div key={k}>{i.qty ? `${fmtNum(i.qty, 3)} ${i.unit}` : ""}</div>)}</Td>
              <Td right className="whitespace-nowrap">{items.map((i, k) => <div key={k}>{i.price ? fmtFixed(i.price) : ""}</div>)}</Td>
              {hasDel && <Td right className="whitespace-nowrap">{items.map((i, k) => <div key={k}>{i.delivery ? fmtFixed(i.delivery) : ""}</div>)}</Td>}
              {hasVat && <Td right className="whitespace-nowrap">{items.map((i, k) => <div key={k}>{i.vat ? fmtFixed(i.vat) : ""}</div>)}</Td>}
              <Td right className="whitespace-nowrap font-semibold text-slate-900"><Money v={x.amount} /></Td>
              {!sup && <Td className="min-w-40 text-[13px] text-slate-600">{[x.ttn && `TTN ${x.ttn}`, x.vehicle, x.address].filter(Boolean).join(" · ") || <span className="text-slate-300">—</span>}{x.note && <div className="text-[12px] text-slate-500">{x.note}</div>}</Td>}
              <Td className="whitespace-nowrap text-[13px] text-slate-600">{x.seller ?? x.by ?? ""}</Td>
              <Td className="whitespace-nowrap">
                <div className="flex flex-col items-start gap-0.5">
                  {x.href && <Link href={x.href} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"><ExternalLink size={13} /> {x.ref?.kind === "receipt" ? "Kirim hujjati" : "Zayavka"}</Link>}
                  {x.ref?.kind === "entry" && (
                    <>
                      <Link href={`/sales/realizatsiya${qs({ from: isoDate(x.date), to: isoDate(x.date), q: l.name })}`} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"><ExternalLink size={13} /> Realizatsiyada tahrirlash</Link>
                      {canEntry && <ReasonButton run={cancelRealizationAction.bind(null, x.ref.id)} label="O'chirish" confirm="Qo'lda kiritilgan realizatsiya qatori bekor qilinadi (AuditLog'da qoladi)" />}
                    </>
                  )}
                  {x.ref?.kind === "invoice" && <Link href="/invoices" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"><ExternalLink size={13} /> Schyotlar</Link>}
                </div>
              </Td>
            </Tr>
          );
        })}
      </tbody>
      {lines.length > 0 && (
        <tfoot>
          <tr className="font-bold"><Td colSpan={lead}>Jami</Td><Td right><Money v={total} /></Td><Td colSpan={sup ? 2 : 3} /></tr>
        </tfoot>
      )}
    </Table>
  );
}

function PaidTable({ l, lines, canFix, customers, trOf, cashRows }: {
  l: Ledger; lines: LedgerLine[]; canFix: boolean; customers: { id: string; name: string }[];
  trOf: Map<string, { id: string; docNo: string; date: Date; debtorId: string; payerId: string; amount: unknown; note: string | null }>;
  /** Kassa / bank tafsiloti oynasi ochiladimi (`/payments` huquqi) */
  cashRows: boolean;
}) {
  const sup = l.who === "supplier";
  // Varaqdagi «To'lagan» — sof: to'lov (+), qaytarilgan pul va boshqaga o'tkazilgan (−)
  const shown = (x: LedgerLine) => (sup ? x.amount : -x.amount);
  const total = lines.reduce((s, x) => s + shown(x), 0);
  const cells = (x: LedgerLine) => (
    <>
      <Td className="whitespace-nowrap">{dateRu(x.date)}</Td>
      <Td className="min-w-40">
        <div className="font-medium text-slate-900">{x.doc}</div>
        {x.no && <div className="text-[12px] text-slate-500">{x.no}</div>}
      </Td>
      <Td className="whitespace-nowrap">{x.account ?? <span className="text-slate-300">—</span>}</Td>
      <Td className="min-w-40 text-[13px] text-slate-600">{[x.counterparty && x.kind !== "TRANSFER" ? `kimdan: ${x.counterparty}` : null, x.note].filter(Boolean).join(" · ") || <span className="text-slate-300">—</span>}</Td>
      <Td className="whitespace-nowrap text-[13px] text-slate-600">{x.by ?? ""}</Td>
      <Td right className={cn("whitespace-nowrap font-semibold", shown(x) < 0 ? "text-red-700" : "text-emerald-700")}><Money v={shown(x)} /></Td>
    </>
  );
  return (
    <Table maxHeight="65vh">
      <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Hisob</Th><Th>Kimdan · izoh</Th><Th>Kiritdi</Th><Th right>Summa</Th><Th className="w-44" /></tr></thead>
      <tbody>
        {lines.length === 0 && <Empty text="Bu davrda to'lov yo'q" />}
        {lines.map((x) => {
          if (cashRows && (x.ref?.kind === "pay" || x.ref?.kind === "tx")) {
            return (
              <CashRow key={x.key} kind={x.ref.kind} id={x.ref.id}>
                {cells(x)}
                <Td className="whitespace-nowrap text-xs text-slate-500">bosing — tahrirlash / o&apos;chirish</Td>
              </CashRow>
            );
          }
          const t = x.ref?.kind === "transfer" ? trOf.get(x.ref.id) : undefined;
          return (
            <Tr key={x.key}>
              {cells(x)}
              <Td className="whitespace-nowrap">
                {t && canFix ? (
                  <div className="flex flex-col items-start gap-0.5">
                    <DebtTransferButton customers={customers} edit={{ id: t.id, docNo: t.docNo, date: isoDate(t.date), debtorId: t.debtorId, payerId: t.payerId, amount: Number(t.amount), note: t.note ?? "" }} />
                    <ReasonButton run={cancelDebtTransferAction.bind(null, t.id)} label="O'chirish" confirm={`${t.docNo} bekor qilinadi — ikkala mijoz qarzi qaytadi`} />
                  </div>
                ) : x.kind === "TRANSFER" ? <Badge color="slate" dot={false}>qarz o&apos;tkazmasi</Badge> : null}
              </Td>
            </Tr>
          );
        })}
      </tbody>
      {lines.length > 0 && (
        <tfoot><tr className="font-bold"><Td colSpan={5}>Jami</Td><Td right><Money v={total} /></Td><Td /></tr></tfoot>
      )}
    </Table>
  );
}

function OpenTable({ l, lines, canFix, entryHref }: { l: Ledger; lines: LedgerLine[]; canFix: boolean; entryHref?: string }) {
  const sup = l.who === "supplier";
  const owes = (v: number) => (sup ? -v : v);
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
        Davr boshidagi qoldiq: <b className="tabular text-slate-900">{fmtFixed(Math.abs(owes(l.start)))}</b> ({side(owes(l.start))}).
        Quyida — shu davrda kiritilgan boshlang&apos;ich qoldiq / tuzatish yozuvlari (Excel yoki qo&apos;lda).
        {entryHref && <> Summani o&apos;zgartirish — <Link href={entryHref} className="font-medium text-slate-900 underline">Qarzlarni kiritish</Link> sahifasida yoki «Qoldiqni tuzatish» tugmasi bilan.</>}
      </div>
      <Table>
        <thead><tr><Th>Sana</Th><Th>Hujjat</Th><Th>Izoh</Th><Th right>Qarzdorlik</Th><Th right>Haqdorlik</Th><Th className="w-44" /></tr></thead>
        <tbody>
          {lines.length === 0 && <Empty text="Bu davrda boshlang'ich qoldiq yozuvi yo'q" />}
          {lines.map((x) => {
            const v = owes(x.amount);
            return (
              <Tr key={x.key}>
                <Td className="whitespace-nowrap">{dateRu(x.date)}</Td>
                <Td className="whitespace-nowrap">{x.doc}{x.no ? ` · ${x.no}` : ""}</Td>
                <Td className="text-[13px] text-slate-600">{x.note ?? ""}</Td>
                <Td right className="whitespace-nowrap">{v > 0 ? <Money v={v} className="font-semibold text-red-700" /> : ""}</Td>
                <Td right className="whitespace-nowrap">{v < 0 ? <Money v={-v} className="font-semibold text-emerald-700" /> : ""}</Td>
                <Td className="whitespace-nowrap">
                  {canFix && x.ref?.kind === "opening" && <ReasonButton run={cancelOpeningAction.bind(null, x.ref.id)} label="O'chirish" confirm="Qoldiq yozuvi bekor qilinadi (AuditLog'da qoladi)" />}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
