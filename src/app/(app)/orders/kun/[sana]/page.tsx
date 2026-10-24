import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { dateRu, fmtNum, isoDate } from "@/lib/format";
import { orderDaySheet, type DaySheetGroup, type DaySheetTotals } from "@/lib/order-day-sheet";
import { PageHeader, Sheet, SheetHead, SheetTh, SheetTd, SheetTr, SheetFoot, type SheetTone } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";

/**
 * Kunlik «Realizatsiya zayavkasi» — foydalanuvchining Excel varag'i ko'rinishida: to'lov turi bo'yicha
 * bloklar (Perechisleniye / Naqd / Qarz), har birida «Jami», pastda mahsulot bo'yicha va umumiy JAMI.
 * Zayavka sahifasidagi haftalik ish tartibida kun kartasini 2 marta bosganda ochiladi. Hisob — `lib/order-day-sheet.ts`.
 */
const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const GROUP_TONE: Record<string, SheetTone> = { BANK: "blue", CASH: "green", DEBT: "red" };

/** Uch blokning ustunlari bir-birining tagida tursin (Excel'dagidek) — bir xil kenglik, matn bo'linmaydi. */
const COL_W = [116, 200, 190, 64, 80, 100, 100, 130, 110, 130, 130, 140, 220, 70];

const n0 = (v: number) => (v ? fmtNum(v, 0) : "");
const nq = (v: number) => fmtNum(v, 3);

export default async function OrderDayPage({ params }: { params: Promise<{ sana: string }> }) {
  await requirePage("/orders");
  const { sana } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sana)) notFound();
  const day = new Date(`${sana}T00:00:00`);
  if (Number.isNaN(day.getTime()) || isoDate(day) !== sana) notFound();

  const sheet = await orderDaySheet(day);
  const shift = (n: number) => { const d = new Date(day); d.setDate(d.getDate() + n); return isoDate(d); };
  const title = `${dateRu(day)}`;

  // Excel: varaqdagi ustunlar bilan bir xil, blok nomi alohida ustunda
  const excelRows = sheet.groups.flatMap((g) => g.rows.map((r) => ({
    "To'lov turi": g.label, "Zayavka": r.orderNo, "Kimga": r.customer, "Mahsulot": r.product, "Birlik": r.unit,
    "Soni": r.qty, "Narx": r.price, "Dastavka": r.delivery || null, "QQSsiz summa": r.net, "QQS 12%": r.vat || null,
    "Jami": r.total, "Qabul qiluvchi": r.receiver, "Telefon": r.phone, "Obyekt": r.site, "Vaqt": r.time,
  })));

  return (
    <div>
      <PageHeader
        back={{ href: "/orders", label: "Zayavkalar" }}
        title={<>Realizatsiya zayavkasi · {title}</>}
        subtitle={`${WEEKDAYS[day.getDay()]} · ${sheet.orderCount} ta zayavka`}
        action={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
              <Link href={`/orders/kun/${shift(-1)}`} aria-label="Oldingi kun" className="grid h-9 w-9 place-items-center text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronLeft size={16} /></Link>
              <span className="border-x border-slate-200 px-3 text-[13px] font-semibold tabular text-slate-900">{title}</span>
              <Link href={`/orders/kun/${shift(1)}`} aria-label="Keyingi kun" className="grid h-9 w-9 place-items-center text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronRight size={16} /></Link>
            </div>
            <ExcelButton file={`Realizatsiya ${title}`} sheets={[{ name: title, rows: excelRows }]} />
            <PrintButton />
          </div>
        }
      />

      <div className="space-y-4">
        {sheet.groups.map((g) => <GroupSheet key={g.key} g={g} />)}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
          <Sheet lang="uz" maxHeight="none">
            <SheetHead>
              <tr><SheetTh tone="green">Mahsulot bo&apos;yicha</SheetTh><SheetTh tone="green">Birlik</SheetTh><SheetTh tone="green" right>Soni</SheetTh></tr>
            </SheetHead>
            <tbody>
              {sheet.products.length === 0 ? (
                <SheetTr><SheetTd colSpan={3} center muted>Bu kunga mahsulot yo&apos;q</SheetTd></SheetTr>
              ) : sheet.products.map((p) => (
                <SheetTr key={`${p.name}|${p.unit}`}>
                  <SheetTd tone="green">{p.name}</SheetTd><SheetTd center>{p.unit}</SheetTd><SheetTd right strong>{nq(p.qty)}</SheetTd>
                </SheetTr>
              ))}
            </tbody>
          </Sheet>
          <GrandTotal t={sheet.grand} />
        </div>
      </div>
    </div>
  );
}

function GroupSheet({ g }: { g: DaySheetGroup }) {
  const tone = GROUP_TONE[g.key];
  return (
    <Sheet lang="uz" maxHeight="none" className="[&_td]:whitespace-nowrap">
      <colgroup>{COL_W.map((w, i) => <col key={i} style={{ width: w, minWidth: w }} />)}</colgroup>
      <SheetHead>
        <tr>
          <SheetTh tone={tone} colSpan={14} className="text-left">
            {g.label}
            <span className="ml-2 font-normal text-slate-600">· {g.rows.length} qator{g.qtyText && ` · ${g.qtyText}`}</span>
          </SheetTh>
        </tr>
        <tr>
          <SheetTh tone="plain">№</SheetTh><SheetTh tone="plain">Kimga</SheetTh><SheetTh tone="plain">Mahsulot</SheetTh><SheetTh tone="plain">Birlik</SheetTh>
          <SheetTh tone="plain" right>Soni</SheetTh><SheetTh tone="plain" right>Narx</SheetTh><SheetTh tone="plain" right>Dastavka</SheetTh>
          <SheetTh tone="plain" right>QQSsiz summa</SheetTh><SheetTh tone="plain" right>QQS 12%</SheetTh><SheetTh tone="plain" right>Jami</SheetTh>
          <SheetTh tone="yellow">Qabul qiluvchi</SheetTh><SheetTh tone="yellow">Telefon</SheetTh><SheetTh tone="yellow">Obyekt</SheetTh><SheetTh tone="yellow">Vaqt</SheetTh>
        </tr>
      </SheetHead>
      <tbody>
        {g.rows.length === 0 ? (
          <SheetTr><SheetTd colSpan={14} center muted>zayavka yo&apos;q</SheetTd></SheetTr>
        ) : g.rows.map((r, i) => {
          // Bir zayavkaning keyingi qatorlarida № va mijoz takrorlanmaydi (Excel'dagi birlashgan katak kabi)
          const same = i > 0 && g.rows[i - 1].orderId === r.orderId;
          return (
            <SheetTr key={`${r.orderId}-${i}`}>
              <SheetTd className="whitespace-nowrap">{same ? "" : <Link href={`/orders/${r.orderId}`} className="font-medium text-slate-900 hover:underline">{r.orderNo}</Link>}</SheetTd>
              <SheetTd className={cn(!same && "font-medium text-slate-900")}>{same ? "" : r.customer}</SheetTd>
              <SheetTd>{r.product}</SheetTd>
              <SheetTd center>{r.unit}</SheetTd>
              <SheetTd right strong>{r.qty ? nq(r.qty) : ""}</SheetTd>
              <SheetTd right>{n0(r.price)}</SheetTd>
              <SheetTd right>{n0(r.delivery)}</SheetTd>
              <SheetTd right>{n0(r.net)}</SheetTd>
              <SheetTd right muted={!r.vat}>{r.vat ? n0(r.vat) : "0"}</SheetTd>
              <SheetTd right strong>{n0(r.total)}</SheetTd>
              <SheetTd tone="yellow">{r.receiver ?? "—"}</SheetTd>
              <SheetTd tone="yellow" className="whitespace-nowrap">{r.phone ?? "—"}</SheetTd>
              <SheetTd tone="yellow">{r.site}</SheetTd>
              <SheetTd tone="yellow" center>{r.time ?? "—"}</SheetTd>
            </SheetTr>
          );
        })}
      </tbody>
      <SheetFoot>
        <tr>
          <SheetTd colSpan={4}>Jami: {g.label}</SheetTd>
          <SheetTd right>{g.qtyText || "0"}</SheetTd>
          <SheetTd />
          <SheetTd right>{fmtNum(g.totals.delivery, 0)}</SheetTd>
          <SheetTd right>{fmtNum(g.totals.net, 0)}</SheetTd>
          <SheetTd right>{fmtNum(g.totals.vat, 0)}</SheetTd>
          <SheetTd right>{fmtNum(g.totals.total, 0)}</SheetTd>
          <SheetTd colSpan={4} />
        </tr>
      </SheetFoot>
    </Sheet>
  );
}

function GrandTotal({ t }: { t: DaySheetTotals }) {
  const cell = (label: string, v: number, strong?: boolean) => (
    <div className="min-w-0">
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className={cn("tabular text-slate-900", strong ? "text-xl font-semibold" : "text-base font-medium")}>{fmtNum(v, 0)}</div>
    </div>
  );
  return (
    <div className="rounded-(--radius-card) border border-brand-300 bg-brand-50 p-4 shadow-(--shadow-card)">
      <div className="mb-3 text-[13px] font-semibold text-slate-900">JAMI (barcha to&apos;lov turlari)</div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cell("Dastavka", t.delivery)}
        {cell("QQSsiz summa", t.net)}
        {cell("QQS 12%", t.vat)}
        {cell("Jami, so'm", t.total, true)}
      </div>
    </div>
  );
}
