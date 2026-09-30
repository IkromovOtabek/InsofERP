import Link from "next/link";
import { ArrowRight, CalendarCheck, ClipboardList, Factory, FileText, HardHat, Layers, ScanFace, Target, TriangleAlert, Truck, Users, UserCog } from "lucide-react";
import { productionDay, DEFECT_REASONS } from "@/lib/production-day";
import { markOf, monthTitle, dayTitle, today as todayIso } from "@/lib/davomat";
import { customerMarks } from "@/lib/finance";
import { db } from "@/lib/db";
import { CustomerName } from "@/components/customer-name";
import { StockSnapshotCard } from "@/components/stock-snapshot";
import { qty, pct, dateTime, fmtNum } from "@/lib/format";
import { reportHistory, stockHighlights, stockStatus, STOCK_LEVEL_LABEL } from "@/lib/production-report";
import { unitLabel, fmtUnitTotals } from "@/lib/unit";
import { Badge, Card, Empty, LinkButton, Progress, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { OrderStatusBadge } from "../orders/status";
import { DefectForm, DeleteDefectButton, DeletePlanButton, MarkAllButton, PlanForm, SaveReportForm, StaffMark } from "./production-forms";
import type { Session } from "@/lib/auth";

const more = (href: string, text: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">{text} <ArrowRight size={14} /></Link>
);
const time = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Ishlab chiqarish bo'limining bosh sahifasi: xodimlar, davomat, sklad, brigadalar ishi,
 * bugungi yuklash, plan, brak va direktorga kunlik hisobot — bir ekranda.
 */
export async function ProductionHome({ s }: { s: Session }) {
  const iso = todayIso();
  const [d, brigades, stock, reports] = await Promise.all([
    productionDay(iso),
    db.brigade.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    stockStatus(),
    reportHistory(5),
  ]);
  const { low: lowStock, ok: okStock, rest: restStock } = stockHighlights(stock, 8);
  const todayReports = reports.filter((r) => r.iso === iso);
  const marks = await customerMarks(d.load.orders.map((o) => o.customerId));
  const isDirector = s.role === "DIRECTOR";

  const producedToday = fmtUnitTotals(d.produced.filter((r) => r.day > 0).map((r) => ({ unit: r.product.unit, qty: r.day })));
  const defectToday = fmtUnitTotals(d.defects.today.map((r) => ({ unit: r.product.unit, qty: r.qty })));
  const loadNeed = fmtUnitTotals(d.load.products.map((p) => ({ unit: p.unit, qty: p.need })));
  const presentCount = d.attendance.present.length;

  return (
    <div className="space-y-8">
      <div data-tour="stats" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Sex xodimlari" value={String(d.staff.total)} hint={d.staff.unassigned ? `${d.staff.unassigned} kishi taqsimlanmagan` : `${d.staff.groups.filter((g) => g.id).length} brigadaga taqsimlangan`} icon={Users} tone={d.staff.unassigned ? "warning" : "default"} href={isDirector ? "/dashboard/xodimlar" : "#davomat"} />
        <StatCard label="Ishga keldi" value={`${presentCount} / ${d.staff.total}`} hint={d.attendance.notMarked.length ? `${d.attendance.notMarked.length} kishi belgilanmagan` : "hammasi belgilangan"} icon={CalendarCheck} tone={d.attendance.notMarked.length ? "warning" : "success"} href="#davomat" />
        <StatCard label="Bugun yuklash" value={`${d.load.orders.length} zayavka`} hint={d.load.orders.length ? loadNeed : "yuklash yo'q"} icon={Truck} tone="info" href="/trips" />
        <StatCard label="Ishlab chiqarildi" value={producedToday === "0" ? "—" : producedToday} hint="bugun" icon={Factory} tone="brand" href="/production" />
        <StatCard label="Brak" value={d.defects.today.length ? defectToday : "0"} hint={`bugun · oyda ${d.defects.month.length} ta yozuv`} icon={TriangleAlert} tone={d.defects.today.length ? "danger" : "default"} />
      </div>

      {/* ── 5. Bugun yuklanadigan mahsulot ── */}
      <Section title="Bugun yuklanadigan mahsulot" className="mt-0" action={more("/orders", "Zayavkalar")}>
        {d.load.orders.length === 0 ? (
          <Card className="text-sm text-slate-500">Bugunga yetkazish sanasi qo&apos;yilgan qabul qilingan zayavka yo&apos;q.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
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
              <thead><tr><Th>№</Th><Th>Vaqt</Th><Th>Mijoz</Th><Th>Mahsulot</Th><Th right>Jo&apos;natildi</Th><Th right>Qoldi</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {d.load.orders.map((o) => {
                  const one = o.items.length === 1 ? unitLabel(o.items[0].unit) : "";
                  return (
                    <Tr key={o.id}>
                      <Td><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link></Td>
                      <Td className="tabular">{o.time ?? "—"}</Td>
                      <Td><CustomerName name={o.customer} blacklisted={marks.black.has(o.customerId)} contracted={marks.contract.has(o.customerId)} short /></Td>
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
        <Card padded={false}>
          {d.plan.rows.length === 0 ? (
            <div className="px-5 py-4 text-sm text-slate-500">{isDirector ? "Bu oyga plan belgilanmagan — pastdagi formadan mahsulot bo'yicha oylik plan qo'ying." : "Bu oyga plan belgilanmagan. Planni direktor belgilaydi."}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><Th>Mahsulot</Th><Th className="w-56">Bugun (kunlik plan)</Th><Th className="w-56">Oy (oylik plan)</Th><Th right>Orqada</Th><Th right>Brak (oy)</Th>{isDirector && <Th />}</tr></thead>
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
                        {isDirector && <Td right><DeletePlanButton id={p.id} /></Td>}
                      </Tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {isDirector && (
            <div className="border-t border-slate-100 px-5 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Target size={15} className="text-brand-600" /> Plan belgilash — {monthTitle(d.ym)}</div>
              <PlanForm month={d.ym} products={d.products} plans={d.plan.rows.map((p) => ({ productId: p.product.id, monthQty: p.monthQty, dayQty: p.dayQtyManual ? p.dayQty : null, note: p.note }))} />
            </div>
          )}
        </Card>
      </Section>

      {/* ── 4. Brigadirlar ishi ── */}
      <Section title="Brigadalar bugun nima qildi" action={more("/tasks", "Topshiriqlar")}>
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
      </Section>

      {/* ── 1–2. Sex xodimlari va davomat ── */}
      <div id="davomat" className="scroll-mt-20" />
      <Section title="Sex xodimlari va davomat" action={isDirector ? <LinkButton href="/dashboard/xodimlar" variant="secondary" size="sm"><UserCog size={14} /> Xodimlarni taqsimlash</LinkButton> : <MarkAllButton left={d.attendance.notMarked.length} />}>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card>
            <div className="flex items-center gap-2 text-sm font-medium"><HardHat size={15} className="text-slate-400" /> Brigadalar bo&apos;yicha · keldi / jami</div>
            <ul className="mt-3 space-y-2 text-sm">
              {d.staff.groups.map((g) => (
                <li key={g.id ?? "none"}>
                  <div className="flex justify-between"><span className={g.id ? "text-slate-600" : "text-amber-700"}>{g.name}</span><span className="font-medium tabular">{g.present} / {g.total}</span></div>
                  <Progress value={g.present} max={Math.max(g.total, 1)} tone={g.total && g.present === g.total ? "success" : "default"} />
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-between border-t border-slate-100 pt-2 text-sm font-semibold"><span>Jami sexda</span><span className="tabular">{presentCount} / {d.staff.total}</span></div>
            {d.staff.unassigned > 0 && (
              <p className="mt-2 text-xs text-amber-700">{d.staff.unassigned} kishi brigadaga taqsimlanmagan{isDirector ? " — «Xodimlarni taqsimlash» dan biriktiring." : " — direktor taqsimlaydi."}</p>
            )}
            <div className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Lavozim bo&apos;yicha</div>
            <ul className="mt-2 space-y-1 text-sm">
              {d.staff.byPosition.map(([pos, n]) => (
                <li key={pos} className="flex justify-between"><span className="text-slate-600">{pos}</span><span className="tabular">{n}</span></li>
              ))}
            </ul>
          </Card>
          <Card className="xl:col-span-2" padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
              <div className="flex items-center gap-2 text-sm font-medium"><ScanFace size={15} className="text-slate-400" /> Bugungi davomat · {dayTitle(iso)}</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge color="green">Keldi {presentCount}</Badge>
                {d.attendance.absent > 0 && <Badge color="red">Kelmadi {d.attendance.absent}</Badge>}
                {d.attendance.sick > 0 && <Badge color="amber">Kasal {d.attendance.sick}</Badge>}
                {d.attendance.leave > 0 && <Badge color="blue">Ta&apos;til {d.attendance.leave}</Badge>}
                {d.attendance.notMarked.length > 0 && <Badge color="slate">Belgilanmagan {d.attendance.notMarked.length}</Badge>}
              </div>
            </div>
            <p className="px-5 pt-1 text-xs text-slate-400">{isDirector ? "Davomatni sex boshlig'i belgilaydi — otdel kadr tabeliga ham shu yozuv tushadi." : "Belgi bosilsa darhol saqlanadi (Keldi — hozirgi soat bilan). Otdel kadr tabeliga ham tushadi."}</p>
            <div className="mt-2 max-h-[28rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead><tr><Th>Xodim</Th><Th>Brigada</Th><Th>Holat</Th><Th right>Keldi</Th><Th right>Ketdi</Th>{!isDirector && <Th right>Belgilash</Th>}</tr></thead>
                <tbody>
                  {[...d.attendance.notMarked, ...d.attendance.present, ...d.attendance.away].map((e) => {
                    const m = e.status ? markOf(e.status) : null;
                    return (
                      <Tr key={e.id}>
                        <Td className={m ? "font-medium" : "text-slate-500"}>{e.fullName}<div className="text-xs font-normal text-slate-400">{e.position}</div></Td>
                        <Td className={e.brigade ? "text-slate-500" : "text-amber-700"}>{e.brigade ?? "taqsimlanmagan"}</Td>
                        <Td>{m ? <Badge color={m.color}>{m.label}</Badge> : <span className="text-xs text-slate-400">belgilanmagan</span>}</Td>
                        <Td right className="tabular">{e.checkIn ?? "—"}</Td>
                        <Td right className="tabular text-slate-500">{e.checkOut ?? "—"}</Td>
                        {!isDirector && <Td right><StaffMark employeeId={e.id} status={e.status} checkedOut={!!e.checkOut} /></Td>}
                      </Tr>
                    );
                  })}
                  {d.staff.total === 0 && <Empty text={isDirector ? "Sexga xodim taqsimlanmagan — «Xodimlarni taqsimlash» ni oching" : "Sexga xodim taqsimlanmagan — direktorga ayting"} icon={Users} />}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </Section>

      {/* ── 7. Brak ── */}
      <Section title="Brak" action={<span className="text-xs text-slate-500">oyda {d.defects.month.length} ta yozuv</span>}>
        <Card padded={false}>
          <div className="px-5 py-4">
            <DefectForm products={d.products} brigades={brigades} reasons={DEFECT_REASONS} />
          </div>
          {d.defects.month.length > 0 && (
            <div className="grid grid-cols-1 border-t border-slate-100 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:divide-x xl:divide-slate-100">
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr><Th>Vaqt</Th><Th>Mahsulot</Th><Th right>Miqdor</Th><Th>Sabab</Th><Th>Brigada</Th><Th>Kim</Th><Th /></tr></thead>
                  <tbody>
                    {d.defects.month.map((r) => {
                      const canDelete = isDirector || (r.createdById === s.userId && r.date >= d.from);
                      return (
                        <Tr key={r.id}>
                          <Td className="whitespace-nowrap tabular text-slate-500">{dateTime(r.date)}</Td>
                          <Td><span className="font-medium">{r.product.code}</span></Td>
                          <Td right className="font-medium text-red-600">{qty(r.qty)} {unitLabel(r.product.unit)}</Td>
                          <Td>{r.reason}{r.note && <div className="text-xs text-slate-400">{r.note}</div>}</Td>
                          <Td className="text-slate-500">{r.brigade ?? "—"}</Td>
                          <Td className="text-slate-500">{r.by}</Td>
                          <Td right>{canDelete && <DeleteDefectButton id={r.id} />}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-4 text-sm">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Oy bo&apos;yicha brak ulushi</div>
                <ul className="space-y-1.5">
                  {d.produced.filter((r) => r.defectMonth > 0).map((r) => (
                    <li key={r.product.id} className="flex justify-between gap-2">
                      <span>{r.product.code}</span>
                      <span className="tabular"><span className="text-red-600">{qty(r.defectMonth)}</span> / {qty(r.month)} {unitLabel(r.product.unit)} · <b>{r.month > 0 ? pct((r.defectMonth / r.month) * 100) : "—"}</b></span>
                    </li>
                  ))}
                </ul>
                <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Sabablar</div>
                <ul className="space-y-1">
                  {d.defects.byReason.map(([r, n]) => <li key={r} className="flex justify-between"><span className="text-slate-600">{r}</span><span className="tabular">{n}</span></li>)}
                </ul>
              </div>
            </div>
          )}
        </Card>
      </Section>

      {/* ── 3. Sklad: xomashyo — nima kerak, nima kam ── */}
      <Section title="Sklad holati — xomashyo" action={<span className="inline-flex items-center gap-3">{lowStock.length > 0 ? <Badge color="red">{lowStock.length} ta kam qoldi</Badge> : <Badge color="green">hammasi yetarli</Badge>}{more("/stock", "Sklad")}</span>}>
        <Card padded={false}>
          <div className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">Kunlik sarf — so&apos;nggi 30 kun o&apos;rtachasi. «Olib kelish kerak» — tasdiqlangan zayavkalarga va minimal qoldiqqa yetishi uchun yetishmayotgan miqdor.</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
                      <Td right className="text-slate-500">{m.planned > 0 ? `${qty(m.planned)} ${m.unit}` : "—"}</Td>
                      <Td right className={m.need > 0 ? "font-semibold text-red-600" : "text-slate-400"}>{m.need > 0 ? `${qty(m.need)} ${m.unit}` : "—"}</Td>
                      <Td><Badge color={tone === "danger" ? "red" : tone === "warning" ? "amber" : "green"}>{STOCK_LEVEL_LABEL[m.level]}</Badge></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {restStock > 0 && <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">Yana {restStock} ta xomashyo yetarli — to&apos;liq ro&apos;yxat <Link href="/stock" className="font-medium text-slate-700 hover:underline">Skladda</Link>.</div>}
        </Card>
      </Section>
      <StockSnapshotCard layout="grid" title="Hovli va tayyor mahsulot" />

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
