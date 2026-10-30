import Link from "next/link";
import { ArrowRight, Boxes, CalendarCheck, ClipboardList, Factory, FileText, HardHat, ShieldCheck, Target, TriangleAlert, Truck } from "lucide-react";
import { canDo } from "@/lib/permissions";
import { pendingApprovalWhere } from "@/lib/driver-trip-pay";
import { productionDay } from "@/lib/production-day";
import { monthTitle, dayTitle, today as todayIso } from "@/lib/davomat";
import { customerMarks } from "@/lib/finance";
import { db } from "@/lib/db";
import { CustomerName } from "@/components/customer-name";
import { qty, pct, dateTime, fmtNum } from "@/lib/format";
import { reportHistory } from "@/lib/production-report";
import { unitLabel, fmtUnitTotals } from "@/lib/unit";
import { productionMatrix } from "@/lib/production-matrix";
import { brigadeProducts } from "@/lib/brigade-pay";
import { BrigadeProductsView } from "../brigades/brigade-products";
import { Badge, Card, Empty, LinkButton, Progress, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { MobileFold } from "./mobile-fold";
import { OrderStatusBadge } from "../orders/status";
import { DeletePlanButton, PlanForm, SaveReportForm } from "./production-forms";
import type { Session } from "@/lib/auth";

const more = (href: string, text: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">{text} <ArrowRight size={14} /></Link>
);
const time = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Ishlab chiqarish bo'limining bosh sahifasi: xodimlar, davomat, sklad, brigadalar ishi,
 * bugungi yuklash, plan, brak va direktorga kunlik hisobot — bir ekranda.
 * Yuqorida sex xodimlari kartasi o'rniga «Ishlab chiqarish kerak» (m³ / dona); ish boshqaruvchida davomat bo'limi ham yo'q — uni sex boshlig'i yuritadi.
 */
export async function ProductionHome({ s }: { s: Session }) {
  const iso = todayIso();
  // Ish boshqaruvchi: tasdiq kutayotgan reys haqi va mexanik / usta puli so'rovlari — vebda bildirishnoma markazi yo'q,
  // xabar faqat ilovaga boradi; bosh sahifada ko'rinib tursin
  const approver = canDo(s, "logistika", "pay_approve");
  const isSupervisor = s.role === "SUPERVISOR";
  const [d, reports, payWait, mechWait, matrix, brigadeWork] = await Promise.all([
    productionDay(iso),
    reportHistory(5),
    approver ? db.trip.aggregate({ where: pendingApprovalWhere(), _count: true, _sum: { payAmount: true } }) : null,
    approver ? db.mechanicRequest.aggregate({ where: { status: "NEW" }, _count: true, _sum: { amount: true } }) : null,
    productionMatrix(),
    brigadeProducts({ activeOnly: true }),
  ]);
  const needBeton = matrix.summary.need.filter((u) => u.unit === "m3");
  const needDona = matrix.summary.need.filter((u) => u.unit !== "m3");
  const todayReports = reports.filter((r) => r.iso === iso);
  const marks = await customerMarks(d.load.orders.map((o) => o.customerId));
  const isDirector = s.role === "DIRECTOR";
  // Plan — odatda direktor; Ruxsatlarda «Ishlab chiqarish → plan» bilan boshqaga beriladi
  const canPlan = canDo(s, "production", "plan");

  const producedToday = fmtUnitTotals(d.produced.filter((r) => r.day > 0).map((r) => ({ unit: r.product.unit, qty: r.day })));
  const defectToday = fmtUnitTotals(d.defects.today.map((r) => ({ unit: r.product.unit, qty: r.qty })));
  const loadNeed = fmtUnitTotals(d.load.products.map((p) => ({ unit: p.unit, qty: p.need })));
  const presentCount = d.attendance.present.length;

  return (
    <div className="min-w-0 space-y-8">
      {(payWait?._count || mechWait?._count) ? (
        <div className="space-y-2">
          {payWait?._count ? (
            <Link href="/logistika/tabel?bolim=tasdiq" className="flex items-center justify-between gap-3 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900 hover:bg-blue-100">
              <span className="flex items-center gap-2 font-medium"><ShieldCheck size={16} /> Reys haqi tasdig&apos;i kutmoqda: {payWait._count} ta · {fmtNum(Number(payWait._sum.payAmount ?? 0))} so&apos;m</span>
              <span className="inline-flex items-center gap-1">Tasdiqlash <ArrowRight size={14} /></span>
            </Link>
          ) : null}
          {mechWait?._count ? (
            <Link href="/mexanik-sorovlar?tab=NEW" className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
              <span className="flex items-center gap-2 font-medium"><ShieldCheck size={16} /> Mexanik va usta puli so&apos;rovlari: {mechWait._count} ta · {fmtNum(Number(mechWait._sum.amount ?? 0))} so&apos;m</span>
              <span className="inline-flex items-center gap-1">Tasdiqlash <ArrowRight size={14} /></span>
            </Link>
          ) : null}
        </div>
      ) : null}
      <div data-tour="stats" className={`grid grid-cols-2 gap-3 ${isSupervisor ? "xl:grid-cols-5" : "xl:grid-cols-6"} [&>*]:min-w-0`}>
        {/* Sex xodimlari kartasi o'rniga — ishlab chiqarish kerak (davomat sex boshlig'ida «Ishga keldi» bilan qoladi) */}
        <StatCard label="Quyish kerak — beton" value={needBeton.length ? fmtUnitTotals(needBeton) : "—"} hint={`${matrix.needList.filter((x) => x.unit === "m3").length} xil marka`} icon={Factory} tone={needBeton.length ? "warning" : "success"} href="#ishlab-chiqarish-kerak" />
        <StatCard label="Ishlab chiqarish kerak — dona" value={needDona.length ? fmtUnitTotals(needDona) : "—"} hint={`${matrix.needList.filter((x) => x.unit !== "m3").length} xil mahsulot · ${matrix.summary.orders} zayavka`} icon={Boxes} tone={needDona.length ? "warning" : "success"} href="#ishlab-chiqarish-kerak" />
        {!isSupervisor && <StatCard label="Ishga keldi" value={`${presentCount} / ${d.staff.total}`} hint={d.attendance.notMarked.length ? `${d.attendance.notMarked.length} kishi belgilanmagan` : "hammasi belgilangan"} icon={CalendarCheck} tone={d.attendance.notMarked.length ? "warning" : "success"} href="/dashboard/sex" />}
        <StatCard label="Bugun yuklash" value={`${d.load.orders.length} zayavka`} hint={d.load.orders.length ? loadNeed : "yuklash yo'q"} icon={Truck} tone="info" href="/trips" />
        <StatCard label="Ishlab chiqarildi" value={producedToday === "0" ? "—" : producedToday} hint="bugun" icon={Factory} tone="brand" href="/production" />
        <StatCard label="Brak" value={d.defects.today.length ? defectToday : "0"} hint={`bugun · oyda ${d.defects.month.length} ta yozuv`} icon={TriangleAlert} tone={d.defects.today.length ? "danger" : "default"} href="/dashboard/brak" />
      </div>

      {/* ── 5. Bugun yuklanadigan mahsulot ── */}
      <Section title="Bugun yuklanadigan mahsulot" className="mt-0" action={more("/orders", "Zayavkalar")}>
        {d.load.orders.length === 0 ? (
          <Card className="text-sm text-slate-500">Bugunga yetkazish sanasi qo&apos;yilgan qabul qilingan zayavka yo&apos;q.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] [&>*]:min-w-0">
            <Table>
              <thead><tr><Th>Mahsulot</Th><Th right>Jami</Th><Th right>Zayavka</Th></tr></thead>
              <tbody>
                {d.load.products.map((p) => (
                  <Tr key={p.id}>
                    <Td><span className="font-medium">{p.code}</span> <span className="text-slate-500">{p.name}</span></Td>
                    <Td right className="font-semibold">{qty(p.need)} {unitLabel(p.unit)}</Td>
                    <Td right className="text-slate-500">{p.orders}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Table>
              <thead><tr><Th>Vaqt</Th><Th>Mijoz</Th><Th>Mahsulot</Th><Th right>Jo&apos;natildi</Th><Th right>Qoldi</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {d.load.orders.map((o) => {
                  const one = o.items.length === 1 ? unitLabel(o.items[0].unit) : "";
                  return (
                    <Tr key={o.id}>
                      <Td className="tabular">{o.time ?? "—"}</Td>
                      <Td><CustomerName name={o.customer} href={`/orders/${o.id}`} blacklisted={marks.black.has(o.customerId)} contracted={marks.contract.has(o.customerId)} short /></Td>
                      <Td>{o.items.map((i) => `${i.code} ${qty(i.qty)} ${unitLabel(i.unit)}`).join(", ")}{o.pickup && <span className="text-slate-400"> · o&apos;zi oladi</span>}</Td>
                      <Td right className="tabular">{qty(o.shipped)} {one}</Td>
                      <Td right className={o.left > 0 ? "font-semibold text-amber-700" : "text-emerald-700"}>{o.left > 0 ? `${qty(o.left)} ${one}` : "✓"}</Td>
                      <Td><OrderStatusBadge status={o.status} /></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Section>

      {/* ── 6. Plan holati ── */}
      <Section title={`Plan holati — ${monthTitle(d.ym)}`} action={<span className="text-xs text-slate-500">{d.plan.elapsed} / {d.plan.workDays} ish kuni o&apos;tdi</span>}>
        <MobileFold label="Plan jadvali">
        <Card padded={false}>
          {d.plan.rows.length === 0 ? (
            <div className="px-5 py-4 text-sm text-slate-500">{canPlan ? "Bu oyga plan belgilanmagan — pastdagi formadan mahsulot bo'yicha oylik plan qo'ying." : "Bu oyga plan belgilanmagan. Planni direktor belgilaydi."}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr><Th>Mahsulot</Th><Th className="w-56">Bugun (kunlik plan)</Th><Th className="w-56">Oy (oylik plan)</Th><Th right>Orqada</Th><Th right>Brak (oy)</Th>{canPlan && <Th />}</tr></thead>
                <tbody>
                  {d.plan.rows.map((p) => {
                    const un = unitLabel(p.product.unit);
                    const tone = (v: number) => (v >= 100 ? "success" : v >= 70 ? "warning" : "danger");
                    return (
                      <Tr key={p.id}>
                        <Td><span className="font-medium">{p.product.code}</span> <span className="text-slate-500">{p.product.name}</span>{p.note && <div className="text-xs text-slate-400">{p.note}</div>}</Td>
                        <Td>
                          <div className="mb-1 flex justify-between text-xs"><span className="tabular">{qty(p.factDay)} / {qty(p.dayQty)} {un}</span><span className="text-slate-500">{pct(p.dayPct, 0)}</span></div>
                          <Progress value={Math.min(p.dayPct, 100)} max={100} tone={tone(p.dayPct)} />
                        </Td>
                        <Td>
                          <div className="mb-1 flex justify-between text-xs"><span className="tabular">{qty(p.factMonth)} / {qty(p.monthQty)} {un}</span><span className="text-slate-500">{pct(p.monthPct, 0)}</span></div>
                          <Progress value={Math.min(p.monthPct, 100)} max={100} tone={p.behind > 0 ? "warning" : "success"} />
                        </Td>
                        <Td right className={p.behind > 0 ? "font-semibold text-red-600" : "text-emerald-700"}>{p.behind > 0 ? `${qty(p.behind)} ${un}` : "rejada"}</Td>
                        <Td right className={p.defectMonth > 0 ? "text-red-600" : "text-slate-400"}>{p.defectMonth > 0 ? `${qty(p.defectMonth)} ${un}` : "—"}</Td>
                        {canPlan && <Td right><DeletePlanButton id={p.id} /></Td>}
                      </Tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {canPlan && (
            <div className="border-t border-slate-100 px-5 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Target size={15} className="text-brand-600" /> Plan belgilash — {monthTitle(d.ym)}</div>
              <PlanForm month={d.ym} products={d.products} plans={d.plan.rows.map((p) => ({ productId: p.product.id, monthQty: p.monthQty, dayQty: p.dayQtyManual ? p.dayQty : null, note: p.note }))} />
            </div>
          )}
        </Card>
        </MobileFold>
      </Section>

      {/* ── 4. Brigadirlar ishi ── */}
      <Section title="Brigadalar bugun nima qildi" action={more("/tasks", "Topshiriqlar")}>
        <MobileFold label="Brigadalar kartalari">
        {d.brigades.length === 0 ? (
          <Card className="text-sm text-slate-500">Faol brigada yo&apos;q.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {d.brigades.map((b) => (
              <Card key={b.id} className={b.today.length ? "" : "opacity-90"}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><HardHat size={15} /></div>
                    <div><div className="font-semibold">{b.name}</div><div className="text-xs text-slate-500">{b.leader ?? "brigadir yo'q"}</div></div>
                  </div>
                  {b.today.length ? <Badge color="green">{b.todayText}</Badge> : <Badge color="slate">bugun qayd yo&apos;q</Badge>}
                </div>
                {b.today.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {b.today.map((t, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate text-slate-600"><span className="tabular text-slate-400">{time(t.at)}</span> {t.product}</span>
                        <span className="shrink-0 font-medium tabular">{qty(t.qty)} {unitLabel(t.unit)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                  <span>Oyda: <span className="tabular text-slate-700">{b.monthText || "—"}</span></span>
                  <span>{b.openCount} ochiq topshiriq{b.overdue > 0 && <span className="text-red-600"> · {b.overdue} kechikkan</span>}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
        </MobileFold>
      </Section>

      {/* ── Brigadalardagi mahsulot va uning puli ── */}
      <Section title="Brigadalardagi mahsulotlar" action={more("/brigades?tab=mahsulotlar", "Brigadalar")}>
        <MobileFold label="Brigada × mahsulot jadvali">
          <BrigadeProductsView data={brigadeWork} compact />
        </MobileFold>
      </Section>

      {/* ── Ishlab chiqarilishi kerak (sex xodimlari kartasi o'rniga) ── */}
      {(
        <Section id="ishlab-chiqarish-kerak" title="Ishlab chiqarilishi kerak" action={more("/production", "Matritsa")}>
          <MobileFold label="Ishlab chiqarish kerak jadvali">
            <Card padded={false}>
              <p className="px-5 pt-4 text-xs text-slate-500">Tasdiqlangan zayavkalardagi jo&apos;natilmagan qism − skladdagi qoldiq (beton — zamesda quyilgani ayiriladi).</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead><tr><Th>Mahsulot</Th><Th right>Zayavkalarda</Th><Th right>Skladda</Th><Th right>Ishlab chiqarish kerak</Th></tr></thead>
                  <tbody>
                    {matrix.needList.length === 0 && <Empty text="Hammasi skladdan yopiladi — ishlab chiqarish kerak emas" icon={Boxes} />}
                    {matrix.needList.map((p) => (
                      <Tr key={p.id}>
                        <Td><span className="font-medium">{p.code}</span> <span className="text-slate-500">{p.name}</span></Td>
                        <Td right className="tabular text-slate-500">{qty(p.band)} {unitLabel(p.unit)}</Td>
                        <Td right className="tabular text-slate-500">{p.unit === "m3" ? "—" : `${qty(Math.max(0, p.stock))} ${unitLabel(p.unit)}`}</Td>
                        <Td right className="font-semibold tabular text-amber-700">{qty(p.need)} {unitLabel(p.unit)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </MobileFold>
        </Section>
      )}




      {/* ── 8. Direktorga kunlik hisobot: ko'rish → "Qayd etish" → direktor kabineti ── */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><FileText size={18} /></div>
            <div>
              <div className="font-semibold">Kunlik hisobot — elektron varaq</div>
              <div className="text-sm text-slate-500">
                {todayReports.length ? <>Bugun qayd etilgan: {dateTime(todayReports[0].createdAt)} · {todayReports[0].seenAt ? "direktor ko'rdi" : "direktor hali ochmagan"}</> : "Bugun hali qayd etilmagan — tekshirib «Qayd etish» ni bosing, hisobot direktor kabinetiga tushadi"}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href={`/dashboard/hisobot?kun=${iso}`} variant="secondary"><ClipboardList size={15} /> Hisobotni ko&apos;rish</LinkButton>
            {!isDirector && <SaveReportForm iso={iso} compact />}
          </div>
        </div>
        {reports.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/dashboard/hisobot/${r.id}`} className="min-w-0 truncate hover:underline"><span className="font-medium">{dayTitle(r.iso)}</span> <span className="text-slate-500">· {r.summary}</span></Link>
                <span className="shrink-0 text-xs text-slate-400">{dateTime(r.createdAt)} · {r.seenAt ? <span className="text-emerald-700">ko&apos;rildi</span> : <span className="text-amber-700">yangi</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
