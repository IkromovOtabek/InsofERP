import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Rows3, Wallet, Percent, Sigma, Search } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { canSeePrixod } from "@/lib/stock-journal-access";
import { pathAllowed } from "@/lib/nav";
import { dateRu, fmtNum } from "@/lib/format";
import { unitLabelRu } from "@/lib/unit";
import { cn } from "@/lib/utils";
import { prixodJournal, prixodTotals, type PrixodPayment, type PrixodRow } from "@/lib/receipts";
import { stockPeriod, StockPeriodBar } from "@/components/stock-period";
import { Badge, Button, Callout, Empty, Input, LinkButton, PageHeader, Select, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr, StatCard } from "@/components/ui";
import { ExcelButton } from "../../logistika/excel-button";

/** Sahifada ko'rinadigan qatorlar chegarasi (jami va Excel — hamma qatorlardan). */
const MAX_ROWS = 2000;
const PAY_LABEL: Record<PrixodPayment, string> = { BANK: "П-р", CASH: "Н-к" };
/** Excel'da «Деньги» to'liq: naqd yoki perechisleniye ekani qisqartmasiz ham tushunarli bo'lsin. */
const PAY_EXCEL: Record<PrixodPayment, string> = { BANK: "Перечисление (П-р)", CASH: "Наличные (Н-к)" };

const money = (v: number) => fmtNum(v, 2);
/** Kartalardagi jami summalar — Расход jurnalidagi kabi butun so'mda («… сум»). */
const sumRu = (v: number) => `${fmtNum(v, 0)} сум`;

function PayChip({ p }: { p: PrixodPayment | null }) {
  if (!p) return <span className="text-slate-400">—</span>;
  return <Badge color={p === "BANK" ? "blue" : "amber"} dot={false}>{PAY_LABEL[p]}</Badge>;
}

/** Uzun matn (Адрес, Почему) — bir qatorda, to'liq matn sichqoncha ostida. */
function Clip({ text, w = "max-w-[200px]" }: { text: string | null; w?: string }) {
  if (!text) return <span className="text-slate-400">—</span>;
  return <div className={`${w} truncate`} title={text}>{text}</div>;
}

/** «Документ» (Excel): storno qatori — «Сторно K-…», storno qilingan asl qator — «K-… (сторно)». */
const docLabel = (r: PrixodRow) => (r.storno ? `Сторно ${r.docNo}` : r.cancelled ? `${r.docNo} (сторно)` : r.docNo);

/**
 * Sklad → «Приход»: kirim jurnali foydalanuvchi Excel'idagi ustunlar bilan (ruscha). Har qator — kirim hujjatining
 * bitta qatori. Storno qilingan kirim o'z sanasida ustidan chizilgan, storno sanasida — manfiy «Сторно» qatori
 * (jami «Остатки» dagi «Приход» bilan bir xil). Ma'lumot `lib/receipts.ts#prixodJournal` dan, yangi kirim — /stock/prixod/new.
 * Ko'rish ruxsati — `lib/stock-journal-access.ts#canSeePrixod`.
 */
export default async function PrixodPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; q?: string; wh?: string; saved?: string }> }) {
  const s = await requirePage("/stock");
  // Xarid narxlari, yetkazuvchilar va QQS — /stock ni ko'radigan hamma rolga emas (`lib/stock-journal-access.ts`)
  if (!canSeePrixod(s)) redirect("/stock");
  const sp = await searchParams;
  const period = stockPeriod(sp);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const saved = sp.saved && /^[A-Za-z0-9-]{1,40}$/.test(sp.saved) ? sp.saved : null;
  const warehouses = await db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const wh = warehouses.find((w) => w.id === sp.wh)?.id ?? null;
  const [rows, savedRec] = await Promise.all([
    prixodJournal({ from: period.from, to: period.to, warehouseId: wh, q }),
    saved ? db.goodsReceipt.findUnique({ where: { docNo: saved }, select: { id: true, docNo: true } }) : Promise.resolve(null),
  ]);
  const tot = prixodTotals(rows);
  const shown = rows.slice(0, MAX_ROWS);
  const canCreate = canDo(s, "stock", "receipt");
  // Kirim hujjati sahifasi (/receipts) hamma Sklad rollariga ochiq emas — havola faqat ochiladigan bo'lsa
  const canOpen = pathAllowed("/receipts", s.role, s.perms);
  const keep: Record<string, string> = { ...(q ? { q } : {}), ...(wh ? { wh } : {}) };

  const excel = [
    ...rows.map((r) => ({
      "Число": dateRu(r.date), "Документ": docLabel(r), "Наименование": r.material, "ТТН": r.waybillNo ?? "", "Ед Изм": unitLabelRu(r.unit), "К-во": r.qty,
      "От Кого": r.supplier, "Кому": r.recipient, "Деньги": r.payment ? PAY_EXCEL[r.payment] : "Не указано", "Доставка": r.delivery, "Цена": r.price,
      "Общие Сумма": r.sum, "Ставка НДС": `${r.vatRate}%`, "НДС": r.vat, "Итого Сумма": r.total, "Адрес": r.address ?? "", "Снабженец": r.buyer ?? "", "Почему": r.purpose ?? "",
    })),
    ...(rows.length ? [{ "Число": "Итого", "Документ": "", "Наименование": "", "ТТН": "", "Ед Изм": "", "К-во": null, "От Кого": "", "Кому": "", "Деньги": "", "Доставка": tot.delivery, "Цена": null, "Общие Сумма": tot.sum, "Ставка НДС": "", "НДС": tot.vat, "Итого Сумма": tot.total, "Адрес": "", "Снабженец": "", "Почему": "" }] : []),
  ];

  return (
    <div lang="ru">
      <PageHeader
        back={{ href: "/stock", label: "Склад" }}
        title="Приход"
        subtitle={`${period.label} · поступления на склад`}
        action={<>
          <ExcelButton file={`prixod_${period.fromStr}_${period.toStr}`} sheets={[{ name: "Приход", rows: excel }]} />
          {canCreate && <LinkButton href="/stock/prixod/new"><Plus size={16} /> Новый приход</LinkButton>}
        </>}
      />

      {saved && (
        <Callout tone="success" title="Приход сохранён">
          Документ {savedRec && canOpen ? <Link href={`/receipts/${savedRec.id}`} className="font-semibold underline">{savedRec.docNo}</Link> : <b>{saved}</b>} — остаток на складе увеличен.
        </Callout>
      )}

      <div className="mb-4 space-y-3">
        <StockPeriodBar base="/stock/prixod" period={period} hidden={keep} />
        <form action="/stock/prixod" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="from" value={period.fromStr} />
          <input type="hidden" name="to" value={period.toStr} />
          <div className="relative w-full sm:w-80">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Наименование или поставщик" aria-label="Поиск" className="pl-9" />
          </div>
          {warehouses.length > 1 && (
            <Select name="wh" defaultValue={wh ?? ""} aria-label="Склад" className="w-auto min-w-44">
              <option value="">Все склады</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          )}
          <Button type="submit" variant="secondary">Найти</Button>
          {(q || wh) && <Link href={`/stock/prixod?from=${period.fromStr}&to=${period.toStr}`} className="text-sm text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline">Сбросить</Link>}
        </form>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Строк" value={fmtNum(tot.rows)} icon={Rows3} hint={`${new Set(rows.map((r) => r.receiptId)).size} документов`} />
        <StatCard label="Общие сумма" value={sumRu(tot.sum)} icon={Wallet} hint={tot.delivery > 0 ? `в т.ч. доставка ${sumRu(tot.delivery)}` : "без НДС"} />
        <StatCard label="НДС" value={sumRu(tot.vat)} icon={Percent} tone="info" />
        <StatCard label="Итого сумма" value={sumRu(tot.total)} icon={Sigma} tone="success" hint="с НДС и доставкой" />
      </div>

      {rows.some((r) => r.cancelled || r.storno) && (
        <p className="mb-3 text-xs text-slate-500">
          Отменённый (сторно) приход остаётся в своей дате зачёркнутым, а в дату отмены — строка «Сторно» с минусом. Итоги — с учётом сторно, как «Приход» в «Остатки».
        </p>
      )}

      {rows.length > shown.length && (
        <Callout tone="warning">Показаны первые {fmtNum(shown.length)} из {fmtNum(rows.length)} строк — сузьте период или поиск. Итоги и Excel — по всем строкам.</Callout>
      )}

      <Sheet>
        <SheetHead>
          <tr>
            <SheetTh>Число</SheetTh>
            <SheetTh className="sticky left-0 z-20 min-w-[180px] text-left">Наименование</SheetTh>
            <SheetTh>ТТН</SheetTh>
            <SheetTh>Ед Изм</SheetTh>
            <SheetTh right>К-во</SheetTh>
            <SheetTh>От Кого</SheetTh>
            <SheetTh>Кому</SheetTh>
            <SheetTh>Деньги</SheetTh>
            <SheetTh right>Доставка</SheetTh>
            <SheetTh right>Цена</SheetTh>
            <SheetTh right>Общие Сумма</SheetTh>
            <SheetTh right>НДС</SheetTh>
            <SheetTh right>Итого Сумма</SheetTh>
            <SheetTh>Адрес</SheetTh>
            <SheetTh>Снабженец</SheetTh>
            <SheetTh>Почему</SheetTh>
          </tr>
        </SheetHead>
        <tbody>
          {shown.length === 0 && <Empty text={q || wh ? "Ничего не найдено — измените поиск или период" : "За выбранный период приходов нет"} />}
          {shown.map((r) => <Row key={r.id} r={r} canOpen={canOpen} />)}
        </tbody>
        {rows.length > 0 && (
          <SheetFoot>
            <tr>
              <SheetTd colSpan={8}>Итого · {fmtNum(tot.rows)} строк</SheetTd>
              <SheetTd right>{money(tot.delivery)}</SheetTd>
              <SheetTd />
              <SheetTd right>{money(tot.sum)}</SheetTd>
              <SheetTd right>{money(tot.vat)}</SheetTd>
              <SheetTd right>{money(tot.total)}</SheetTd>
              <SheetTd colSpan={3} />
            </tr>
          </SheetFoot>
        )}
      </Sheet>
    </div>
  );
}

function Row({ r, canOpen }: { r: PrixodRow; canOpen: boolean }) {
  // Storno qilingan asl qator — kulrang, ustidan chizilgan; storno qatori (manfiy) — och qizil fon, qizil matn
  const tone = r.storno ? ("red" as const) : undefined;
  return (
    <SheetTr className={cn("group", r.cancelled && "[&>td]:text-slate-400 [&>td]:line-through", r.storno && "[&>td]:text-red-700")}>
      <SheetTd tone={tone} className="whitespace-nowrap">
        {canOpen ? <Link href={`/receipts/${r.receiptId}`} title={`Открыть ${r.docNo}`} className="font-medium hover:underline">{dateRu(r.date)}</Link> : <span className="font-medium">{dateRu(r.date)}</span>}
        {r.storno
          ? <span className="ml-1.5 text-[11px] font-semibold">{`Сторно ${r.docNo}`}</span>
          : <span className="ml-1.5 text-[11px] text-slate-400">{r.docNo}</span>}
        {r.cancelled && <span className="ml-1.5" title="Приход отменён (сторно)"><Badge color="red" dot={false}>сторно</Badge></span>}
      </SheetTd>
      <SheetTd tone={tone} className="sticky left-0 z-[1] min-w-[180px] bg-white font-medium text-slate-900 group-hover:bg-slate-50">{r.material}</SheetTd>
      <SheetTd tone={tone} center className="whitespace-nowrap">{r.waybillNo ?? <span className="text-slate-400">—</span>}</SheetTd>
      <SheetTd tone={tone} center>{unitLabelRu(r.unit)}</SheetTd>
      <SheetTd tone={tone} right>{fmtNum(r.qty, 3)}</SheetTd>
      <SheetTd tone={tone} className="whitespace-nowrap">{r.supplier}</SheetTd>
      <SheetTd tone={tone} className="whitespace-nowrap">{r.recipient}</SheetTd>
      <SheetTd tone={tone} center><PayChip p={r.payment} /></SheetTd>
      <SheetTd tone={tone} right muted={!r.delivery}>{r.delivery ? money(r.delivery) : "—"}</SheetTd>
      <SheetTd tone={tone} right>{money(r.price)}</SheetTd>
      <SheetTd tone={tone} right>{money(r.sum)}</SheetTd>
      <SheetTd tone={tone} right muted={!r.vat}>{money(r.vat)}{r.vatRate > 0 && <span className="ml-1 text-[11px] text-slate-400">{r.vatRate}%</span>}</SheetTd>
      <SheetTd tone={tone} right strong>{money(r.total)}</SheetTd>
      <SheetTd tone={tone}><Clip text={r.address} /></SheetTd>
      <SheetTd tone={tone} className="whitespace-nowrap">{r.buyer ?? <span className="text-slate-400">—</span>}</SheetTd>
      <SheetTd tone={tone}><Clip text={r.purpose} w="max-w-[240px]" /></SheetTd>
    </SheetTr>
  );
}
