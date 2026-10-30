import Link from "next/link";
import { HardHat, TriangleAlert, Wallet } from "lucide-react";
import { dateTime, money, qty } from "@/lib/format";
import { dayTitle, monthTitle } from "@/lib/davomat";
import { unitLabel } from "@/lib/unit";
import type { BrigadeDefectsMonth, BrigadePayMonth } from "@/lib/brigade-pay";
import { Callout, Card, CardHeader, Empty, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { DefectAmountForm } from "./forms";

const qtyText = (q: Record<string, number>) => Object.entries(q).map(([u, n]) => `${qty(n)} ${unitLabel(u)}`).join(", ");

/** «Oylik» tabi: brigada bo'yicha sdelka fondi, brak va oylik (fond − brak). */
export function BrigadePayView({ data }: { data: BrigadePayMonth }) {
  const noRate = [...new Set(data.rows.flatMap((r) => r.noRate))];
  const noPiece = data.rows.filter((r) => r.net !== 0 && r.piece === 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={`Sdelka fondi — ${monthTitle(data.ym)}`} value={money(data.fund)} icon={Wallet} tone="brand" />
        <StatCard label="Brak (ushlanadi)" value={money(data.brak)} icon={TriangleAlert} tone={data.brak ? "danger" : "default"} href={`/brigades?tab=brak&oy=${data.ym}`} />
        <StatCard label="Brigadalar oyligi" value={money(data.net)} hint="fond − brak" icon={HardHat} tone={data.net < 0 ? "danger" : "success"} />
      </div>
      {noRate.length > 0 && <Callout tone="warning" title="Sdelka narxi qo'yilmagan">{noRate.join(", ")} — bajarilgani fondga 0 so&apos;mdan kirdi. Narx: Ish haqi → Sozlamalar → «Sdelka narxlari».</Callout>}
      {noPiece.length > 0 && <Callout tone="warning" title="Sdelkadagi a'zo yo'q">{noPiece.map((r) => r.name).join(", ")} — brigadada ish haqi turi «Sdelka» bo&apos;lgan xodim yo&apos;q, vedomostda bu pul hech kimga tushmaydi (brak ham ushlanmaydi). Xodim kartasida ish haqi turini tekshiring.</Callout>}
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr><Th>Brigada</Th><Th>Bajarilgan ish</Th><Th right>Sdelka fondi</Th><Th right>Brak</Th><Th right>Brak summasi</Th><Th right>Oylik (fond − brak)</Th><Th right>Sdelka a&apos;zolari</Th></tr></thead>
            <tbody>
              {data.rows.length === 0 && <Empty text="Brigada yo'q" icon={HardHat} />}
              {data.rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="align-top font-medium">{r.name}<div className="text-xs font-normal text-slate-500">{r.leader ?? "brigadir yo'q"}</div></Td>
                  <Td className="align-top">
                    {r.units.length === 0 ? <span className="text-xs text-slate-400">bajarilgan ish yo&apos;q</span> : (
                      <ul className="space-y-0.5 text-xs">
                        {r.units.map((u) => (
                          <li key={u.productId} className="flex justify-between gap-3">
                            <span className="truncate text-slate-600">{u.product}</span>
                            <span className="shrink-0 tabular">{qty(u.qty)} {unitLabel(u.unit)} × {u.rate > 0 ? money(u.rate) : <span className="text-amber-700">narx yo&apos;q</span>} = <b>{money(u.sum)}</b></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                  <Td right className="align-top tabular">{money(r.fund)}</Td>
                  <Td right className="align-top tabular text-slate-500">{r.brakCount ? <Link href={`/brigades?tab=brak&oy=${data.ym}&brigada=${r.id}`} className="hover:underline">{r.brakCount} ta</Link> : "—"}</Td>
                  <Td right className={`align-top tabular ${r.brak ? "text-red-600" : "text-slate-400"}`}>{r.brak ? `− ${money(r.brak)}` : "—"}</Td>
                  <Td right className={`align-top font-semibold tabular ${r.net < 0 ? "text-red-600" : ""}`}>{money(r.net)}</Td>
                  <Td right className="align-top tabular text-slate-500">{r.piece} / {r.members}</Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <td className="px-4 py-2.5" colSpan={2}>Jami</td>
                <td className="px-4 py-2.5 text-right tabular">{money(data.fund)}</td>
                <td />
                <td className="px-4 py-2.5 text-right tabular text-red-600">{data.brak ? `− ${money(data.brak)}` : "—"}</td>
                <td className="px-4 py-2.5 text-right tabular">{money(data.net)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <p className="text-xs text-slate-500">Xodimlarga bo&apos;linishi va to&apos;lov — <Link href="/ish-haqi" className="underline">Ish haqi</Link> vedomostida: fond va brak sdelkadagi a&apos;zolarga ishlagan soati bo&apos;yicha bo&apos;linadi.</p>
    </div>
  );
}

/** «Brak (kunlik)» tabi: kun × brigada summasi va yozuvlar ro'yxati (summani tahrirlash). */
export function BrigadeDefectsView({ data, month, brigadeId, canEdit }: { data: BrigadeDefectsMonth; month: string; brigadeId: string | null; canEdit: boolean }) {
  const list = brigadeId ? data.list.filter((d) => d.brigadeId === brigadeId) : data.list;
  const brigadeName = brigadeId ? data.grid.find((g) => g.id === brigadeId)?.name : null;
  // Kunlar: oy boshidan bugungacha (o'tgan oy — oxirigacha), eng yangisi tepada
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const days = data.days.filter((d) => d <= todayIso).reverse();
  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="px-5 pt-4"><CardHeader title={`Kunlik brak — ${monthTitle(month)}`} description={`Jami ${money(data.total)} · ${data.activeDays.length} kunda brak bo'lgan. Katakda — summa va miqdor`} /></div>
        {data.grid.length === 0 ? <div className="px-5 pb-4 text-sm text-slate-500">Bu oyda brak yozilmagan.</div> : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr>
                  <Th>Kun</Th>
                  {data.grid.map((g) => <Th key={g.id ?? "none"} right><Link href={`/brigades?tab=brak&oy=${month}${g.id ? `&brigada=${g.id}` : ""}`} className="hover:underline">{g.name}</Link></Th>)}
                  <Th right>Jami</Th>
                </tr>
              </thead>
              <tbody>
                {days.map((iso) => {
                  const total = data.dayTotal.get(iso) ?? 0;
                  return (
                    <Tr key={iso}>
                      <Td className={`whitespace-nowrap ${total ? "font-medium" : "text-slate-400"}`}>{dayTitle(iso)}</Td>
                      {data.grid.map((g) => {
                        const c = g.days.get(iso);
                        return <Td key={g.id ?? "none"} right className="tabular">{c ? <><span className="text-red-600">{money(c.sum)}</span><div className="text-[11px] text-slate-400">{qtyText(c.qty)}</div></> : <span className="text-slate-300">—</span>}</Td>;
                      })}
                      <Td right className={`tabular ${total ? "font-semibold text-red-600" : "text-slate-300"}`}>{total ? money(total) : "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-white">
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="px-4 py-2.5">Oy jami</td>
                  {data.grid.map((g) => <td key={g.id ?? "none"} className="px-4 py-2.5 text-right tabular text-red-600">{money(g.sum)}<div className="text-[11px] font-normal text-slate-400">{qtyText(g.qty)}</div></td>)}
                  <td className="px-4 py-2.5 text-right tabular text-red-600">{money(data.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <CardHeader title={brigadeName ? `Brak yozuvlari — ${brigadeName}` : "Brak yozuvlari"} description={canEdit ? "Summa brigada oyligidan ushlanadi — kerak bo'lsa tuzating va saqlang" : "Summani ish boshqaruvchi tahrirlaydi"} />
          {brigadeId && <Link href={`/brigades?tab=brak&oy=${month}`} className="text-[13px] font-medium text-slate-600 underline">Barcha brigadalar</Link>}
        </div>
        <Table>
          <thead><tr><Th>Vaqt</Th><Th>Brigada</Th><Th>Mahsulot</Th><Th right>Miqdor</Th><Th>Sabab</Th><Th right>Narx × miqdor</Th><Th right>Brak summasi</Th></tr></thead>
          <tbody>
            {list.length === 0 && <Empty text="Brak yozuvi yo'q" icon={TriangleAlert} />}
            {list.map((d) => {
              const auto = Math.round(d.qty * d.price);
              return (
                <Tr key={d.id}>
                  <Td className="whitespace-nowrap tabular text-slate-500">{dateTime(d.date)}<div className="text-xs">{d.createdBy.fullName}</div></Td>
                  <Td className={d.brigade ? "" : "text-amber-700"}>{d.brigade?.name ?? "brigadasiz"}</Td>
                  <Td><span className="font-medium">{d.product.code}</span> <span className="text-slate-500">{d.product.name}</span></Td>
                  <Td right className="font-medium tabular text-red-600">{qty(d.qty)} {unitLabel(d.product.unit)}</Td>
                  <Td>{d.reason}{d.note && <div className="text-xs text-slate-400">{d.note}</div>}</Td>
                  <Td right className="tabular text-slate-500">{money(auto)}</Td>
                  <Td right>{canEdit ? <DefectAmountForm id={d.id} amount={d.amount} /> : <span className={`tabular ${d.amount !== auto ? "font-semibold" : ""}`}>{money(d.amount)}</span>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
