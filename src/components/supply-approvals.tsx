import Link from "next/link";
import { Clock, ClipboardCheck, RefreshCw, Truck, TrendingUp, TrendingDown } from "lucide-react";
import { db } from "@/lib/db";
import { supplyList, lastPurchasePrices, priceDelta, priceKey, totalPlanned, plannedSum, SUPPLY_LABEL } from "@/lib/supply";
import { money, fmtNum, date } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Card, CardHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ApprovePanel, FundPanel } from "@/components/supply-panels";

/**
 * Ta'minot zayavkasini tasdiqlash kartasi. Ikki joyda turadi:
 *  · `mode="sales"` — Zayavkalar oynasida (ma'sul xodim narxni tasdiqlaydi);
 *  · `mode="finance"` — Kirim-Chiqimda (moliya pul ajratadi, soat ikonkasi bilan).
 * Ta'minot zayavkalari bo'limida tasdiq tugmasi ko'rsatilmaydi — u faqat kuzatuv ro'yxati.
 */
export async function SupplyApprovals({ mode }: { mode: "sales" | "finance" }) {
  const rows = await supplyList(mode === "sales" ? ["PRICED"] : ["APPROVED"]);
  if (rows.length === 0) return null;
  const accounts = mode === "finance"
    ? await db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } })
    : [];
  // "O'tgan safar necha edi" — aynan shu mahsulotning oxirgi xarid narxi (boshqa mahsulot bilan taqqoslanmaydi)
  const last = await lastPurchasePrices(rows.flatMap((r) => r.items.map((i) => ({ materialId: i.materialId, name: i.name }))));

  return (
    <Card className={cn("mb-6", mode === "finance" ? "border-amber-200" : "border-brand-500/40")}>
      <CardHeader
        icon={mode === "finance" ? Clock : ClipboardCheck}
        title={mode === "finance" ? `Ta'minot to'lovlari — tasdiq kutilmoqda: ${rows.length} ta` : `Ta'minot zayavkalari — tasdiqingizni kutmoqda: ${rows.length} ta`}
        description={mode === "finance"
          ? "Sotuv bo'limi tasdiqlagan zayavkalar. Tasdiqlasangiz summa shu jurnalga chiqim bo'lib tushadi va snabjeniye sotib oladi."
          : "Snabjeniye narx qo'ygan zayavkalar. Tasdiqlasangiz Moliya bo'limiga (Kirim-Chiqim) tushadi."} />
      <div className="space-y-2">
        {rows.map((r) => {
          const goods = plannedSum(r.items);
          const total = totalPlanned(r);
          const dearer = r.items.filter((i) => {
            const l = last.get(priceKey(i));
            return l && Number(i.price) > l.price + 0.5;
          }).length;
          return (
            <details key={r.id} className={cn("rounded-lg border px-4 py-2.5", mode === "finance" ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50/70")}>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                <span className={cn("inline-flex flex-wrap items-center gap-2 font-medium", mode === "finance" ? "text-amber-900" : "text-slate-900")}>
                  {mode === "finance" && <Clock size={14} className="shrink-0" />}
                  {r.docNo} · {r.warehouse.name} · {r.items.length} qator
                  <span className="text-xs font-normal text-slate-500">{r.createdBy.fullName} so&apos;ragan{r.supplier ? ` · ${r.supplier.name}` : ""}</span>
                  {r.recheck > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                      <RefreshCw size={11} /> Narx o&apos;zgardi — qayta tasdiq
                    </span>
                  )}
                  {dearer > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      <TrendingUp size={11} /> {dearer} ta mahsulot oldingi narxdan qimmat
                    </span>
                  )}
                </span>
                <span className="inline-flex items-center gap-3"><b className="tabular">{money(total)}</b><span className="text-xs text-slate-500">▸ batafsil</span></span>
              </summary>

              <div className="mt-3 space-y-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="py-1">Nomi</th><th className="py-1 text-right">Miqdor</th><th className="py-1 text-right">Hozirgi narx</th>
                      <th className="py-1 text-right">O&apos;tgan safar</th><th className="py-1 text-right">Farq</th><th className="py-1 text-right">Summa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((i) => {
                      const price = Number(i.price);
                      const l = last.get(priceKey(i)); // aynan shu mahsulotning oxirgi xaridi
                      // Farq: avval shu zayavkadagi o'zgarish (qabulda narx oshgan bo'lsa), bo'lmasa oldingi xarid
                      const inDoc = i.prevPrice != null;
                      const was = inDoc ? Number(i.prevPrice) : l?.price;
                      const d = was != null ? priceDelta(price, was) : null;
                      const up = d != null && d > 0.5;
                      return (
                        <tr key={i.id} className={cn("border-t border-slate-200/70", up && "bg-red-50/50")}>
                          <td className="py-1.5">{i.name}{i.note ? <span className="text-xs text-slate-500"> · {i.note}</span> : null}</td>
                          <td className="py-1.5 text-right tabular">{fmtNum(Number(i.qty), 3)} {unitLabel(i.unit)}</td>
                          <td className="py-1.5 text-right tabular font-medium">{money(price)}</td>
                          <td className="py-1.5 text-right tabular text-slate-500">
                            {inDoc ? <>{money(Number(i.prevPrice))}<div className="text-[11px] text-red-600">shu zayavkada o&apos;zgardi</div></>
                              : l ? <>{money(l.price)}<div className="text-[11px] text-slate-400">{date(l.date)} · {l.supplier}</div></>
                              : <span className="text-slate-400">birinchi marta olinmoqda</span>}
                          </td>
                          <td className={cn("py-1.5 text-right text-xs font-medium", d == null ? "text-slate-400" : up ? "text-red-600" : d < -0.5 ? "text-emerald-700" : "text-slate-500")}>
                            {d == null ? "—" : Math.abs(d) < 0.5 ? "narx o'zgarmagan" : (
                              <span className="inline-flex flex-col items-end">
                                <span className="inline-flex items-center gap-0.5">{up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{up ? "+" : ""}{fmtNum(d, 1)}% {up ? "qimmat" : "arzon"}</span>
                                <span className="text-[11px] font-normal">{money(Math.abs(price - (was ?? 0)))} {up ? "ko'p" : "kam"} · qatorga {money(Math.abs((price - (was ?? 0)) * Number(i.qty)))}</span>
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular font-medium">{money(Number(i.qty) * price)}</td>
                        </tr>
                      );
                    })}
                    {Number(r.deliveryCost) > 0 && (
                      <tr className="border-t border-slate-200/70">
                        <td className="py-1.5" colSpan={5}>
                          <span className="inline-flex items-center gap-1.5 text-slate-700"><Truck size={13} className="text-slate-400" /> Dostavka xizmati{r.deliveryKind ? ` · ${r.deliveryKind}` : ""}{r.deliveryProvider ? ` · ${r.deliveryProvider}` : ""}</span>
                        </td>
                        <td className="py-1.5 text-right tabular font-medium">{money(Number(r.deliveryCost))}</td>
                      </tr>
                    )}
                    <tr className="border-t border-slate-300">
                      <td className="py-1.5 font-semibold" colSpan={5}>Jami{Number(r.deliveryCost) > 0 ? ` (mahsulot ${money(goods)} + dostavka)` : ""}</td>
                      <td className="py-1.5 text-right text-base font-semibold tabular">{money(total)}</td>
                    </tr>
                  </tbody>
                </table>

                {mode === "sales"
                  ? <ApprovePanel id={r.id} total={total} compact />
                  : <FundPanel id={r.id} total={total} accounts={accounts} compact />}
                <Link href={`/taminot/${r.id}`} className="inline-block text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline">To&apos;liq hujjatni ochish →</Link>
              </div>
            </details>
          );
        })}
      </div>
      {rows.some((r) => r.status !== (mode === "sales" ? "PRICED" : "APPROVED")) && (
        <p className="mt-2 text-xs text-slate-500">Holat: {SUPPLY_LABEL[rows[0].status]}</p>
      )}
    </Card>
  );
}
