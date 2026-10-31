import Link from "next/link";
import { AlertTriangle, Layers, PackageX } from "lucide-react";
import { date, fmtNum, qty } from "@/lib/format";
import { stockHighlights, stockStatus, STOCK_LEVEL_LABEL } from "@/lib/production-report";
import { Badge, Card, Empty, Progress, Section, Td, Th, Tr } from "@/components/ui";
import { MobileFold } from "@/app/(app)/dashboard/mobile-fold";

/**
 * Xomashyo holati — nima kerak, nima kam: qoldiq, kunlik sarf (30 kun o'rtachasi), necha kunga yetadi,
 * tasdiqlangan zayavkalarga va minimal qoldiqqa yetmaydigani (`lib/production-report.ts` → `stockStatus`).
 * Sklad → «Qoldiqlar» sahifasining tepasida turadi (avval ishlab chiqarish bosh sahifasida edi).
 */
/** Kartada shuncha zayavka ko'rinadi, qolgani «yana N ta» ichida (JS'siz, `<details>`) */
const SHOW_ORDERS = 4;

type Gap = Awaited<ReturnType<typeof stockStatus>>[number];

/** Zayavka chipi: mijoz, yetkazish sanasi (o'tgani qizil) va shu zayavkaga kerak miqdor. */
function OrderChip({ o, unit, today }: { o: Gap["orders"][number]; unit: string; today: number }) {
  const late = !!o.date && o.date.getTime() < today;
  return (
    <Link href={`/orders/${o.id}`} title={`${o.customer} — ${qty(o.qty)} ${unit}${late ? " (muddati o'tgan)" : ""}`}
      className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] transition hover:border-slate-300 hover:bg-slate-50">
      <span className="min-w-0 truncate font-medium text-slate-800">{o.customer}</span>
      <span className="flex shrink-0 items-center gap-2 tabular">
        {o.date && <span className={late ? "font-medium text-red-600" : "text-slate-400"}>{date(o.date).slice(0, 5)}</span>}
        <span className="font-semibold text-slate-900">{qty(o.qty)}</span>
      </span>
    </Link>
  );
}

/** Zayavkaga yetmaydigan xomashyo kartasi: qancha kam, skladdagi qism qanchasini qoplaydi, qaysi zayavkalar kutmoqda. */
function GapCard({ m, today }: { m: Gap; today: number }) {
  const cover = m.planned > 0 ? Math.max(0, Math.min(1, m.balance / m.planned)) : 1;
  const orders = [...m.orders].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  const shown = orders.slice(0, SHOW_ORDERS), more = orders.slice(SHOW_ORDERS);
  return (
    <Card className="flex min-w-0 flex-col gap-3 border-red-200/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-slate-900">{m.name}</div>
          <div className="text-xs text-slate-500">{orders.length} ta zayavka kutmoqda</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] font-medium uppercase tracking-wide text-red-500">kam</div>
          <div className="text-lg leading-tight font-bold text-red-600 tabular">−{qty(m.orderGap)} <span className="text-xs font-medium">{m.unit}</span></div>
        </div>
      </div>
      <div className="space-y-1.5">
        {/* Yashil — skladdagi qoldiq, qizil — yetishmayotgani (zayavkalarga kerak = 100%) */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-red-100" role="img" aria-label={`Skladdagi qoldiq ${Math.round(cover * 100)}% ni qoplaydi`}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${cover * 100}%` }} />
        </div>
        <div className="flex justify-between text-[11.5px] tabular">
          <span className="text-emerald-700">skladda {qty(m.balance)} · {Math.round(cover * 100)}%</span>
          <span className="text-slate-500">kerak {qty(m.planned)} {m.unit}</span>
        </div>
      </div>
      <div className="grid min-w-0 gap-1.5">
        {shown.map((o) => <OrderChip key={o.id} o={o} unit={m.unit} today={today} />)}
        {more.length > 0 && (
          <details className="group/more min-w-0">
            <summary className="cursor-pointer list-none rounded-lg px-2.5 py-1 text-[12.5px] font-medium text-slate-500 hover:text-slate-900 [&::-webkit-details-marker]:hidden">
              <span className="group-open/more:hidden">Yana {more.length} ta zayavka</span><span className="hidden group-open/more:inline">Yig&apos;ish</span>
            </summary>
            <div className="mt-1.5 grid min-w-0 gap-1.5">{more.map((o) => <OrderChip key={o.id} o={o} unit={m.unit} today={today} />)}</div>
          </details>
        )}
      </div>
    </Card>
  );
}

export async function RawStockStatus() {
  const stock = await stockStatus();
  const { low: lowStock, ok: okStock, rest: restStock } = stockHighlights(stock, 8);
  const orderGap = stock.filter((m) => m.orderGap > 0);
  const stockNeed = stock.filter((m) => m.need > 0).sort((a, b) => b.orderGap - a.orderGap);
  const minGap = stockNeed.filter((m) => m.orderGap <= 0);
  // Eng ko'p qoplanmagani (foiz bo'yicha) birinchi — qaysi xomashyo eng shoshilinch
  const gaps = [...orderGap].sort((a, b) => a.balance / a.planned - b.balance / b.planned);
  const today = new Date().setHours(0, 0, 0, 0);
  return (
    <Section title="Sklad holati — xomashyo" action={<span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 [&>*]:max-w-full [&>*]:whitespace-normal">{orderGap.length > 0 ? <Badge color="red">zayavkaga yetmaydi: {orderGap.map((m) => m.name).slice(0, 3).join(", ")}{orderGap.length > 3 ? ` +${orderGap.length - 3}` : ""}</Badge> : lowStock.length > 0 ? <Badge color="amber">kam qoldi</Badge> : <Badge color="green">hammasi yetarli</Badge>}</span>}>
      <MobileFold label="Xomashyo jadvali">
      <Card padded={false}>
        {/* Son emas — nima, qancha va qaysi zayavkaga yetmaydi: har xomashyo o'z kartasida */}
        {gaps.length > 0 && (
          <div className="border-b border-slate-100 bg-red-50/40 px-5 py-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <PackageX size={16} className="text-red-600" />
              <b className="text-slate-900">Zayavkalarga yetmaydi — {gaps.length} ta xomashyo</b>
              <span className="text-slate-500">· yashil chiziq — skladdagi qoldiq qancha qismini qoplashi</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {gaps.map((m) => <GapCard key={m.id} m={m} today={today} />)}
            </div>
          </div>
        )}
        {minGap.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-5 py-3 text-sm">
            <span className="mr-1 inline-flex items-center gap-1.5 font-semibold text-amber-700"><AlertTriangle size={15} /> Minimal qoldiqqa yetmaydi:</span>
            {minGap.map((m) => <Badge key={m.id} color="amber">{m.name} · {qty(m.need)} {m.unit}</Badge>)}
          </div>
        )}
        <div className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">Kunlik sarf — so&apos;nggi 30 kun o&apos;rtachasi. «Olib kelish kerak» — tasdiqlangan zayavkalarga va minimal qoldiqqa yetishi uchun yetishmayotgan miqdor.</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr><Th>Xomashyo</Th><Th right>Qoldiq</Th><Th right>Kunlik sarf</Th><Th className="w-40">Yetadi</Th><Th right>Zayavkalarga kerak</Th><Th right>Olib kelish kerak</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {stock.length === 0 && <Empty text="Xomashyo kiritilmagan" icon={Layers} />}
              {[...lowStock, ...okStock].map((m) => {
                const tone = m.level === "short" ? "danger" : m.level === "low" ? "warning" : "success";
                return (
                  <Tr key={m.id}>
                    <Td><span className="inline-flex items-center gap-2"><Layers size={14} className="text-slate-400" />{m.name}</span></Td>
                    <Td right>{qty(m.balance)} <span className="text-slate-400">{m.unit}</span></Td>
                    <Td right className="text-slate-500">{m.perDay > 0 ? `${fmtNum(m.perDay, 1)} ${m.unit}` : "—"}</Td>
                    <Td>
                      {m.days === null ? <span className="text-slate-400">—</span> : (
                        <div className="space-y-1">
                          <div className={`text-[13px] font-semibold tabular ${tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-600" : "text-slate-900"}`}>{m.days > 999 ? ">999" : fmtNum(m.days, 1)} kun</div>
                          <Progress value={Math.min(m.days, 30)} max={30} tone={tone} />
                        </div>
                      )}
                    </Td>
                    <Td right className="text-slate-500">{m.planned > 0 ? <>{qty(m.planned)} {m.unit}<div className="text-[11px] text-slate-400">{m.orders.length} zayavka</div></> : "—"}</Td>
                    <Td right className={m.need > 0 ? "font-semibold text-red-600" : "text-slate-400"}>{m.need > 0 ? `${qty(m.need)} ${m.unit}` : "—"}</Td>
                    <Td><Badge color={tone === "danger" ? "red" : tone === "warning" ? "amber" : "green"}>{STOCK_LEVEL_LABEL[m.level]}</Badge></Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {restStock > 0 && <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">Yana {restStock} ta xomashyo yetarli — to&apos;liq ro&apos;yxat pastdagi «Xomashyo qoldiqlari» jadvalida.</div>}
      </Card>
      </MobileFold>
    </Section>
  );
}
