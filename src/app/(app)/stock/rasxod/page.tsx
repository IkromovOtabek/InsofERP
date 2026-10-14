import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { canSeeRasxod } from "@/lib/stock-journal-access";
import { companyVatPayer } from "@/lib/receipt-vat";
import { dateRu, fmtNum } from "@/lib/format";
import { unitLabelRu } from "@/lib/unit";
import { rasxodJournal, rasxodTotals, type RasxodRow } from "@/lib/stock-issue";
import { recipientList } from "@/lib/stock-recipients";
import { stockPeriod, StockPeriodBar } from "@/components/stock-period";
import { Badge, Callout, Card, CardHeader, LinkButton, PageHeader, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr, StatCard, type SheetTone } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { RasxodFilters } from "./rasxod-filters";
import { RecipientsManager } from "./recipients-manager";
import { StornoButton } from "./storno-button";
import { cancelRasxod } from "./actions";

/**
 * Sklad → «Расход» — skladdan chiqim jurnali, foydalanuvchi Excel'idagi ustunlar bilan (ekran ruscha):
 * Число | Наименование | Ед Изм | К-во | От Кого | Кому | Деньги | Доставка | Цена | Общие Сумма | НДС | Итого Сумма
 * (Excel'da yana «Ставка НДС»: 0, 6 yoki 12% — oxirgi kirimdan; «Деньги» to'liq: Перечисление / Наличные).
 * Manba — StockMove (`rasxodJournal`): oluvchilarga va brigadalarga berish, qaytishlar, zames (kunlik, ko'k qator),
 * spisanie, inventarizatsiya kamomadi. Narx — harakatdagi «Дона сўм» snapshot.
 * Kim ko'radi — `canSeeRasxod` (lib/stock-journal-access): jurnalda narxlar va summalar bor. НДС — faqat korxona QQS
 * to'lovchisi bo'lsa (aks holda narx QQS ichida, НДС 0). Storno — `stock` → `issue_storno` (direktor yoki ruxsat berilgan).
 */

const money = (v: number) => `${fmtNum(v, 0)} сум`;
const PAY: Record<"BANK" | "CASH", { label: string; color: "blue" | "amber"; title: string }> = {
  BANK: { label: "П-р", color: "blue", title: "Перечисление (банк) — по последнему приходу" },
  CASH: { label: "Н-к", color: "amber", title: "Наличные — по последнему приходу" },
};
/** Excel'da «Деньги» to'liq yoziladi — naqd yoki perechisleniye ekani qisqartmasiz ham tushunarli bo'lsin. */
const PAY_EXCEL: Record<"BANK" | "CASH", string> = { BANK: "Перечисление (П-р)", CASH: "Наличные (Н-к)" };

export default async function RasxodPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; wh?: string; komu?: string; saved?: string }> }) {
  const s = await requirePage("/stock");
  // Narx va summalar — /stock ni ko'radigan hamma rolga emas (sotuv, logistika, mexanik — Sklad sahifasiga qaytadi)
  if (!canSeeRasxod(s)) redirect("/stock");
  const sp = await searchParams;
  const period = stockPeriod(sp);
  const canIssue = canDo(s, "stock", "issue");
  const canStorno = canDo(s, "stock", "issue_storno");

  const [warehouses, recipients, brigades, vatPayer] = await Promise.all([
    db.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } }),
    recipientList(),
    db.brigade.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } }),
    companyVatPayer(),
  ]);
  const wh = warehouses.some((w) => w.id === sp.wh) ? sp.wh! : null;
  const komu = sp.komu && /^(r:.+|b:.+|prod|writeoff|inventory)$/.test(sp.komu) ? sp.komu : null;
  const rows = await rasxodJournal({ from: period.from, to: period.to, warehouseId: wh, to_: komu });
  const t = rasxodTotals(rows);
  const saved = Number(sp.saved);
  // Storno tugmasi — har Расход hujjatining (ref) birinchi ko'rinadigan qatorida, bir marta; storno qilinganida yo'q
  const refRows = new Map<string, RasxodRow[]>();
  for (const r of rows) if (r.ref && (r.kind === "issue" || r.kind === "brigade")) refRows.set(r.ref, [...(refRows.get(r.ref) ?? []), r]);
  const stornoAt = new Map<string, RasxodRow[]>(); // qator id → shu hujjat qatorlari (tugma shu qatorda)
  if (canStorno) for (const list of refRows.values()) if (!list[0].cancelled) stornoAt.set(list[0].id, list);
  const cols = canStorno ? 13 : 12;

  const hidden: Record<string, string> = {};
  if (wh) hidden.wh = wh;
  if (komu) hidden.komu = komu;

  const excelRows: Record<string, string | number | null>[] = rows.map((r) => ({
    "Число": dateRu(r.date),
    "Наименование": r.material,
    "Ед Изм": unitLabelRu(r.unit),
    "К-во": r.qty,
    "От Кого": r.from,
    "Кому": `${r.to}${r.auto ? " (авто)" : ""}${r.cancelled ? " (отменён)" : ""}${r.kind === "storno" && r.note ? ` · ${r.note}` : ""}`,
    "Деньги": r.payment ? PAY_EXCEL[r.payment] : "Не указано",
    "Доставка": r.delivery,
    "Цена": r.price,
    "Общие Сумма": r.sum,
    "Ставка НДС": `${r.vatRate}%`,
    "НДС": r.vat,
    "Итого Сумма": r.total,
  }));
  if (rows.length) {
    excelRows.push({ "Число": "Итого", "Наименование": "", "Ед Изм": "", "К-во": null, "От Кого": "", "Кому": "", "Деньги": "", "Доставка": t.delivery, "Цена": null, "Общие Сумма": t.sum, "Ставка НДС": "", "НДС": t.vat, "Итого Сумма": t.total });
  }

  return (
    <div lang="ru">
      <PageHeader
        back={{ href: "/stock", label: "Склад" }}
        title="Расход"
        subtitle="Выдача сырья со склада: кому, сколько и по какой цене (Дона сўм). Замесы — одной строкой за день."
        action={
          <>
            <ExcelButton file={`Расход ${period.fromStr} — ${period.toStr}`} sheets={[{ name: "Расход", rows: excelRows }]} />
            {canIssue && <LinkButton href="/stock/rasxod/new"><Plus size={16} /> Новый расход</LinkButton>}
          </>
        }
      />

      {saved > 0 && <div className="mb-4"><Callout tone="success" title="Расход записан">Строк: {saved}. Остаток склада уменьшен.</Callout></div>}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <StockPeriodBar base="/stock/rasxod" period={period} hidden={hidden} />
        <RasxodFilters
          warehouses={warehouses.map((w) => ({ id: w.id, name: w.isActive ? w.name : `${w.name} (закрыт)` }))}
          recipients={recipients.map((r) => ({ id: r.id, name: r.isActive ? r.name : `${r.name} (скрыт)` }))}
          brigades={brigades.map((b) => ({ id: b.id, name: b.isActive ? b.name : `${b.name} (неактивна)` }))}
          wh={wh} komu={komu} from={period.fromStr} to={period.toStr}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Строк" value={fmtNum(t.count)} hint={period.label} />
        <StatCard label="Сумма" value={money(t.sum)} hint="К-во × Цена" />
        <StatCard label="НДС" value={money(t.vat)} hint={vatPayer ? "по ставке последнего прихода" : "0 — не плательщик НДС, цена с НДС"} />
        <StatCard label="Итого" value={money(t.total)} tone="brand" hint="Сумма + НДС" />
      </div>

      <Sheet>
        <SheetHead>
          <tr>
            <SheetTh>Число</SheetTh>
            <SheetTh>Наименование</SheetTh>
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
            {canStorno && <SheetTh title="Сторно — отменить расход (директор или по разрешению)" />}
          </tr>
        </SheetHead>
        <tbody>
          {rows.length === 0 && (
            <tr><SheetTd colSpan={cols} center muted className="py-10">За выбранный период расходов нет</SheetTd></tr>
          )}
          {rows.map((r) => {
            const docRows = stornoAt.get(r.id);
            return (
              <Row key={r.id} r={r} storno={canStorno ? (docRows
                ? <StornoButton action={cancelRasxod.bind(null, docRows[0].ref!)} question={stornoQuestion(docRows)} />
                : null) : undefined} />
            );
          })}
        </tbody>
        {rows.length > 0 && (
          <SheetFoot>
            <tr>
              <SheetTd colSpan={7}>Итого · {fmtNum(t.count)} строк</SheetTd>
              <SheetTd right>{t.delivery ? fmtNum(t.delivery) : "—"}</SheetTd>
              <SheetTd />
              <SheetTd right>{fmtNum(t.sum)}</SheetTd>
              <SheetTd right>{fmtNum(t.vat)}</SheetTd>
              <SheetTd right>{fmtNum(t.total)}</SheetTd>
              {canStorno && <SheetTd />}
            </tr>
          </SheetFoot>
        )}
      </Sheet>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 rounded-sm border border-blue-300 bg-blue-100" /> Производство (замес) — расход сырья по замесам за день</span>
        <span><b className="text-slate-700">≈</b> — цена не была зафиксирована, показана текущая «Дона сўм»</span>
        <span><b className="text-slate-700">авто</b> — выдано бригаде автоматически по заданию</span>
        <span>Деньги и НДС — по последнему приходу этого сырья</span>
        {!vatPayer && <span>НДС 0: предприятие не плательщик НДС — цена (себестоимость, «Дона сўм») уже включает НДС</span>}
        <span><b className="text-slate-700">Сторно</b> — отмена расхода: строка с минусом, сырьё вернулось на склад</span>
      </div>

      {canIssue && (
        <Card className="mt-8">
          <div id="recipients" className="scroll-mt-20">
            <CardHeader title="Получатели (Кому)" description="Кому выдаётся сырьё: шофёры, столбовщики, сварщики и т. д. Бригады из раздела «Бригады» есть в списке «Кому» автоматически. Получатель не удаляется — его можно скрыть." />
            <RecipientsManager list={recipients} />
          </div>
        </Card>
      )}
    </div>
  );
}

/** Storno savoli: sana, kimga, qancha qator. */
function stornoQuestion(list: RasxodRow[]): string {
  const r = list[0];
  return `Отменить расход от ${dateRu(r.date)} — ${r.to}${list.length > 1 ? ` (${list.length} строк)` : ""}? Сырьё вернётся на склад`;
}

/** `storno`: undefined — ustun yo'q (ruxsat yo'q); null — bo'sh katak; element — tugma. */
function Row({ r, storno }: { r: RasxodRow; storno?: React.ReactNode }) {
  const tone: SheetTone | undefined = r.kind === "prod" ? "blue" : undefined;
  const neg = r.qty < 0;
  const reason = r.kind === "storno" && r.note ? r.note.replace(/^Сторно:\s*/, "") : null;
  return (
    <SheetTr className={cn((r.kind === "return" || r.kind === "storno" || r.cancelled) && "text-slate-500")}>
      <SheetTd tone={tone} className="whitespace-nowrap">{dateRu(r.date)}</SheetTd>
      <SheetTd tone={tone} strong>{r.material}</SheetTd>
      <SheetTd tone={tone} center>{unitLabelRu(r.unit)}</SheetTd>
      <SheetTd tone={tone} right strong className={cn(neg && "text-slate-500")}>{fmtNum(r.qty, 3)}</SheetTd>
      <SheetTd tone={tone} className="whitespace-nowrap">{r.from}</SheetTd>
      <SheetTd tone={tone} className={cn(r.kind === "prod" && "font-medium text-blue-800", (r.kind === "writeoff" || r.kind === "inventory") && "text-amber-800")}>
        <span title={r.note ?? undefined} className={r.kind === "storno" ? "font-medium text-red-700" : undefined}>{r.to}</span>
        {r.auto && <span className="ml-1.5 rounded bg-slate-100 px-1 py-px text-[11px] font-medium text-slate-600" title="Выдано автоматически: на задание не хватило у бригады">авто</span>}
        {r.cancelled && <span className="ml-1.5 rounded bg-red-50 px-1 py-px text-[11px] font-medium text-red-700" title="По этому расходу сделано сторно — см. строку «Сторно» с минусом">отменён</span>}
        {reason && <span className="block text-[11px] text-slate-500">Причина: {reason}</span>}
      </SheetTd>
      <SheetTd tone={tone} center>
        {r.payment ? <span title={PAY[r.payment].title}><Badge color={PAY[r.payment].color} dot={false}>{PAY[r.payment].label}</Badge></span> : <span className="text-slate-400">—</span>}
      </SheetTd>
      <SheetTd tone={tone} right muted={!r.delivery}>{r.delivery ? fmtNum(r.delivery) : "—"}</SheetTd>
      <SheetTd tone={tone} right>
        {r.price == null
          ? <span className="text-amber-700" title="Нет цены: «Дона сўм» не задана и прихода не было">нет цены</span>
          : <span title={r.priceApprox ? "Цена не была зафиксирована — текущая «Дона сўм»" : undefined}>{r.priceApprox && <span className="mr-0.5 text-slate-400">≈</span>}{fmtNum(r.price, 2)}</span>}
      </SheetTd>
      <SheetTd tone={tone} right>{fmtNum(r.sum)}</SheetTd>
      <SheetTd tone={tone} right muted={!r.vat}>{r.vat ? fmtNum(r.vat) : "0"}{r.vatRate > 0 && <span className="ml-1 text-[11px] text-slate-400">{r.vatRate}%</span>}</SheetTd>
      <SheetTd tone={tone} right strong>{fmtNum(r.total)}</SheetTd>
      {storno !== undefined && <SheetTd tone={tone} center>{storno}</SheetTd>}
    </SheetTr>
  );
}
