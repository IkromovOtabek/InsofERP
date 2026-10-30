import Link from "next/link";
import { Layers } from "lucide-react";
import { fmtNum, orderLabel, qty } from "@/lib/format";
import { stockHighlights, stockStatus, STOCK_LEVEL_LABEL } from "@/lib/production-report";
import { Badge, Card, Empty, Progress, Section, Td, Th, Tr } from "@/components/ui";
import { MobileFold } from "@/app/(app)/dashboard/mobile-fold";

/**
 * Xomashyo holati — nima kerak, nima kam: qoldiq, kunlik sarf (30 kun o'rtachasi), necha kunga yetadi,
 * tasdiqlangan zayavkalarga va minimal qoldiqqa yetmaydigani (`lib/production-report.ts` → `stockStatus`).
 * Sklad → «Qoldiqlar» sahifasining tepasida turadi (avval ishlab chiqarish bosh sahifasida edi).
 */
export async function RawStockStatus() {
  const stock = await stockStatus();
  const { low: lowStock, ok: okStock, rest: restStock } = stockHighlights(stock, 8);
  const orderGap = stock.filter((m) => m.orderGap > 0);
  const stockNeed = stock.filter((m) => m.need > 0).sort((a, b) => b.orderGap - a.orderGap);
  return (
    <Section title="Sklad holati — xomashyo" action={<span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 [&>*]:max-w-full [&>*]:whitespace-normal">{orderGap.length > 0 ? <Badge color="red">zayavkaga yetmaydi: {orderGap.map((m) => m.name).slice(0, 3).join(", ")}{orderGap.length > 3 ? ` +${orderGap.length - 3}` : ""}</Badge> : lowStock.length > 0 ? <Badge color="amber">kam qoldi</Badge> : <Badge color="green">hammasi yetarli</Badge>}</span>}>
      <MobileFold label="Xomashyo jadvali">
      <Card padded={false}>
        {/* Son emas — nima, qancha va qaysi zayavkaga yetmaydi */}
        {stockNeed.length > 0 && (
          <div className="space-y-1.5 border-b border-slate-100 px-5 py-3 text-sm">
            {orderGap.map((m) => (
              <div key={m.id}>
                <b className="text-red-700">{m.name} — {qty(m.orderGap)} {m.unit} kam</b>
                <span className="text-slate-500"> (skladda {qty(m.balance)}, zayavkalarga {qty(m.planned)} {m.unit}): </span>
                {m.orders.map((o, i) => (
                  <span key={o.id}>{i > 0 && ", "}<Link href={`/orders/${o.id}`} className="hover:underline">{orderLabel(o.customer, o.date)}</Link> <span className="text-slate-500">{qty(o.qty)}</span></span>
                ))}
              </div>
            ))}
            {stockNeed.filter((m) => m.orderGap <= 0).length > 0 && (
              <div className="text-amber-700">
                <b>Minimal qoldiqqa yetmaydi:</b> {stockNeed.filter((m) => m.orderGap <= 0).map((m) => `${m.name} ${qty(m.need)} ${m.unit}`).join(", ")}
              </div>
            )}
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
