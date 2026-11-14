import Link from "next/link";
import { AlarmClock, ArrowRight, Boxes, Factory, FlaskConical, PackageCheck, TriangleAlert, Wallet, Warehouse } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { productionOverview } from "@/lib/overview/production";
import { STOCK_LEVEL_LABEL } from "@/lib/production-report";
import { dueLabel } from "@/lib/production";
import { date, fmtNum, isoDate, moneyShort, pct, qty } from "@/lib/format";
import { fmtUnitTotals, unitLabel } from "@/lib/unit";
import { DayRangeBar, parseDayRange } from "@/app/(app)/bi-tahlil/month-bar";
import { Badge, Empty, PageHeader, Progress, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";

export const dynamic = "force-dynamic";

const BASE = "/production/umumiy";
/** Brigada puli (fond, brak summasi) — ishlab chiqarish rollari va direktor; sahifa ruxsat bilan boshqaga berilsa, summalar ko'rinmaydi */
const PAY_ROLES = ["DIRECTOR", "SUPERVISOR", "PRODUCTION"];
const more = (href: string, text = "Batafsil") => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">{text} <ArrowRight size={14} /></Link>
);
const units = (rows: { unit: string; qty: number }[]) => (rows.some((r) => Math.abs(r.qty) > 0.0005) ? fmtUnitTotals(rows) : "—");
const LEVEL_COLOR = { short: "red", low: "amber", ok: "green" } as const;

/**
 * Ishlab chiqarish — umumiy ko'rinish: bo'limning muhim raqamlari bir joyda (`lib/overview/production.ts`).
 * Tepada hozirgi holat (bugun, kerak, topshiriqlar, xomashyo) va davr kartalari, pastda har blok o'z sahifasiga havola bilan.
 * Faqat ko'rish — hech qanday amal yo'q.
 */
export default async function ProductionOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePage("/production/umumiy");
  const period = parseDayRange(await searchParams);
  const showPay = PAY_ROLES.includes(s.role);
  const o = await productionOverview(period.from, period.to);
  const d = o.day;

  const toIncl = new Date(period.to); toIncl.setDate(toIncl.getDate() - 1);
  const yardHref = `/stock?bolim=hovli&from=${isoDate(period.from)}&to=${isoDate(toIncl)}`;
  const ym = isoDate(period.from).slice(0, 7);
  const producedToday = units(d.produced.filter((r) => r.day > 0).map((r) => ({ unit: r.product.unit, qty: r.day })));
  const behind = d.plan.rows.filter((p) => p.behind > 0).length;
  const dona = o.byProduct.filter((r) => r.unit !== "m3");
  const betonM3 = o.byProduct.filter((r) => r.unit === "m3").reduce((x, r) => x + r.qty, 0);
  const volM3 = o.byProduct.reduce((x, r) => x + (r.m3 ?? 0), 0);
  const volApprox = o.byProduct.some((r) => r.approx);
  const brakText = units(o.brak.rows);
  const yardText = units(o.yard.map((r) => ({ unit: r.unit, qty: r.total })));
  // Bugun: plan qatorlari + plansiz ishlab chiqarilganlar (kunlik hisobotdagidek)
  const planIds = new Set(d.plan.rows.map((p) => p.product.id));
  const unplanned = d.produced.filter((r) => !planIds.has(r.product.id) && (r.day > 0 || r.month > 0));
  const tone = (v: number) => (v >= 100 ? "success" : v >= 70 ? "warning" : "danger");

  return (
    <div className="min-w-0">
      <PageHeader back={{ href: "/production", label: "Ishlab chiqarish" }} eyebrow="Ishlab chiqarish"
        title="Ishlab chiqarish — umumiy ko'rinish"
        info="Bo'limning muhim raqamlari bir joyda: bugungi plan, davrdagi ishlab chiqarish, brigadalar, brak, xomashyo va hovli. Har blokdan to'liq sahifaga o'tiladi." />
      <DayRangeBar base={BASE} range={period} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Bugun ishlab chiqarildi" value={producedToday} icon={Factory} tone="brand" href={`/dashboard/hisobot?kun=${d.iso}`}
          hint={`${d.producedM3.day.m3 > 0 ? `${d.producedM3.day.approx ? "≈" : ""}${fmtNum(d.producedM3.day.m3, 2)} m³ · ` : ""}${d.plan.rows.length ? (behind ? `${behind} mahsulot plandan orqada` : "plan bo'yicha") : "plan belgilanmagan"}`} />
        <StatCard label="Ishlab chiqarish kerak" value={units(o.matrix.need)} icon={Boxes} tone={o.matrix.need.length ? "warning" : "success"} href="/production"
          hint={`${o.matrix.needKinds} xil mahsulot · ${o.matrix.unassigned} zayavka brigada kutmoqda`} />
        <StatCard label="Ochiq topshiriqlar" value={fmtNum(o.tasks.open)} icon={AlarmClock} tone={o.tasks.late ? "danger" : "info"} href="/tasks"
          hint={o.tasks.late ? `${o.tasks.late} tasi kechikkan · ${o.matrix.late} zayavka muddati o'tgan` : "kechikkan topshiriq yo'q"} />
        <StatCard label="Xomashyo xavfi" value={`${o.materialRisk} xil`} icon={FlaskConical} href="/stock?bolim=holat"
          tone={o.materials.some((m) => m.level === "short") ? "danger" : o.materialRisk ? "warning" : "success"} hint="kam qolgan yoki zayavkalarga yetmaydi" />
        <StatCard label="Davrda ishlab chiqarildi" value={units(dona.map((r) => ({ unit: r.unit, qty: r.qty })))} icon={PackageCheck} tone="brand" href={yardHref}
          hint={`beton ${qty(betonM3)} m³${volM3 > 0 ? ` · jami ${volApprox ? "≈" : ""}${fmtNum(volM3, 1)} m³ hajmda` : ""}`} />
        <StatCard label="Brak (davr)" value={brakText === "—" ? "0" : brakText} icon={TriangleAlert} tone={o.brak.count ? "danger" : "default"} href="/dashboard/brak"
          hint={`${o.brak.count} ta yozuv${showPay ? ` · ${moneyShort(o.brak.amount)} so'm` : ""}`} />
        {showPay && <StatCard label="Brigada oyligi (fond − brak)" value={moneyShort(o.pay.net)} icon={Wallet} tone={o.pay.net < 0 ? "danger" : "default"} href={`/brigades?tab=oylik&oy=${ym}`}
          hint={`fond ${moneyShort(o.pay.fund)} − brak ${moneyShort(o.pay.brak)} so'm · davr`} />}
        <StatCard label="Hovlida tayyor mahsulot" value={yardText} icon={Warehouse} href={yardHref} hint={`${o.yard.length} xil · umumiy hovli va brigada omborlari`} />
      </div>

      <Section title={`Bugun — plan va bajarilish (${date(new Date())})`} action={more(`/dashboard/hisobot?kun=${d.iso}`, "Kunlik hisobot")}>
        <Table>
          <thead><tr><Th>Mahsulot</Th><Th className="w-52">Bugun / kunlik plan</Th><Th className="w-52">Oy / oylik plan</Th><Th right>Orqada</Th><Th right>Brak (oy)</Th></tr></thead>
          <tbody>
            {d.plan.rows.length + unplanned.length === 0 && <Empty text="Bu oyga plan belgilanmagan va bugun ishlab chiqarish qayd qilinmagan" icon={Factory} />}
            {d.plan.rows.map((p) => {
              const un = unitLabel(p.product.unit);
              return (
                <Tr key={p.id}>
                  <Td className="font-medium">{p.product.name}</Td>
                  <Td>
                    <div className="mb-1 flex justify-between gap-2 text-xs"><span className="tabular">{qty(p.factDay)} / {qty(p.dayQty)} {un}</span><span className="text-slate-500">{pct(p.dayPct, 0)}</span></div>
                    <Progress value={Math.min(p.dayPct, 100)} max={100} tone={tone(p.dayPct)} />
                  </Td>
                  <Td>
                    <div className="mb-1 flex justify-between gap-2 text-xs"><span className="tabular">{qty(p.factMonth)} / {qty(p.monthQty)} {un}</span><span className="text-slate-500">{pct(p.monthPct, 0)}</span></div>
                    <Progress value={Math.min(p.monthPct, 100)} max={100} tone={p.behind > 0 ? "warning" : "success"} />
                  </Td>
                  <Td right className={p.behind > 0 ? "font-semibold text-red-600" : "text-emerald-700"}>{p.behind > 0 ? `${qty(p.behind)} ${un}` : "rejada"}</Td>
                  <Td right className={p.defectMonth > 0 ? "text-red-600" : "text-slate-400"}>{p.defectMonth > 0 ? `${qty(p.defectMonth)} ${un}` : "—"}</Td>
                </Tr>
              );
            })}
            {unplanned.map((r) => (
              <Tr key={r.product.id}>
                <Td className="font-medium">{r.product.name} <span className="text-xs font-normal text-slate-400">plansiz</span></Td>
                <Td className="tabular">{qty(r.day)} {unitLabel(r.product.unit)}</Td>
                <Td className="tabular">{qty(r.month)} {unitLabel(r.product.unit)}</Td>
                <Td right className="text-slate-400">—</Td>
                <Td right className={r.defectMonth > 0 ? "text-red-600" : "text-slate-400"}>{r.defectMonth > 0 ? `${qty(r.defectMonth)} ${unitLabel(r.product.unit)}` : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Section title="Mahsulot bo'yicha ishlab chiqarish (davr)" action={more(yardHref, "Hovli harakati")}>
          <Table maxHeight="26rem">
            <thead><tr><Th>Mahsulot</Th><Th right>Ishlab chiqarildi</Th><Th right>Hajm, m³</Th><Th right>Brak</Th><Th right>Brak ulushi</Th></tr></thead>
            <tbody>
              {o.byProduct.length === 0 && <Empty text="Bu davrda ishlab chiqarish qayd qilinmagan" icon={PackageCheck} />}
              {o.byProduct.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td right>{qty(r.qty)} {unitLabel(r.unit)}</Td>
                  <Td right className="text-slate-500">{r.m3 === null ? "—" : `${r.approx ? "≈" : ""}${fmtNum(r.m3, 2)}`}</Td>
                  <Td right className={r.defect > 0 ? "text-red-600" : "text-slate-400"}>{r.defect > 0 ? `${qty(r.defect)} ${unitLabel(r.unit)}` : "—"}</Td>
                  <Td right className="text-slate-500">{r.qty > 0 && r.defect > 0 ? pct((r.defect / r.qty) * 100) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Brigadalar (davr)" action={more(`/brigades?tab=oylik&oy=${ym}`, "Brigadalar")}>
          <Table maxHeight="26rem">
            <thead><tr><Th>Brigada</Th><Th right>Bajardi</Th><Th right>Ochiq / kechikkan</Th>{showPay && <><Th right>Fond</Th><Th right>Brak</Th><Th right>Oylik</Th></>}</tr></thead>
            <tbody>
              {o.brigades.length === 0 && <Empty text="Faol brigada yo'q" />}
              {o.brigades.map((b) => (
                <Tr key={b.id} className={b.isActive ? undefined : "opacity-70"}>
                  <Td className="font-medium">{b.name}{!b.isActive && <span className="text-xs font-normal text-slate-400"> · nofaol</span>}</Td>
                  <Td right>{units(b.units)}</Td>
                  <Td right>{b.open}{b.late > 0 && <span className="text-red-600"> / {b.late}</span>}</Td>
                  {showPay && <><Td right>{fmtNum(b.fund)}</Td><Td right className={b.brak > 0 ? "text-red-600" : "text-slate-400"}>{b.brak > 0 ? fmtNum(b.brak) : "—"}</Td><Td right className={b.net < 0 ? "font-semibold text-red-600" : "font-semibold"}>{fmtNum(b.net)}</Td></>}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Kechikkan topshiriqlar" action={more("/tasks", "Topshiriqlar")}>
          <Table>
            <thead><tr><Th>Topshiriq</Th><Th>Brigada</Th><Th>Mahsulot</Th><Th right>Qoldi</Th><Th right>Muddat</Th></tr></thead>
            <tbody>
              {o.tasks.lateList.length === 0 && <Empty text="Muddati o'tgan topshiriq yo'q" icon={AlarmClock} />}
              {o.tasks.lateList.map((t) => (
                <Tr key={t.id}>
                  <Td><Link href={`/orders/${t.order.id}`} className="font-medium hover:underline">{t.taskNo}</Link><div className="text-xs text-slate-400">{t.order.orderNo}</div></Td>
                  <Td>{t.brigade.name}</Td>
                  <Td>{t.orderItem.product.name}</Td>
                  <Td right className="font-semibold">{qty(t.left)} {unitLabel(t.orderItem.product.unit)}</Td>
                  <Td right><div>{date(t.dueDate)}</div><div className="text-xs text-red-600">{dueLabel(t.dueDate)}</div></Td>
                </Tr>
              ))}
              {o.tasks.late > o.tasks.lateList.length && <Tr><Td colSpan={5} className="text-xs text-slate-500">Yana {o.tasks.late - o.tasks.lateList.length} ta — «Topshiriqlar» sahifasida</Td></Tr>}
            </tbody>
          </Table>
        </Section>

        <Section title="Ishlab chiqarilishi kerak" action={more("/production", "Matritsa")}>
          <Table maxHeight="26rem">
            <thead><tr><Th>Mahsulot</Th><Th right>Zayavkalarda</Th><Th right>Skladda</Th><Th right>Kerak</Th></tr></thead>
            <tbody>
              {o.matrix.needList.length === 0 && <Empty text="Hammasi skladdan yopiladi — ishlab chiqarish kerak emas" icon={Boxes} />}
              {o.matrix.needList.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td right className="text-slate-500">{qty(p.band)} {unitLabel(p.unit)}</Td>
                  <Td right className="text-slate-500">{qty(Math.max(0, p.stock))} {unitLabel(p.unit)}</Td>
                  <Td right className="font-semibold text-amber-700">{qty(p.need)} {unitLabel(p.unit)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Xomashyo: sarf va yetishmovchilik xavfi" action={more("/stock?bolim=holat", "Sklad holati")}>
          <Table maxHeight="26rem">
            <thead><tr><Th>Xomashyo</Th><Th right>Sarf (davr)</Th><Th right>Qoldiq</Th><Th right>Yetadi</Th><Th right>Kerak</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {o.materials.length === 0 && <Empty text="Bu davrda sarf yo'q, xomashyo yetarli" icon={FlaskConical} />}
              {o.materials.map((m) => (
                <Tr key={m.id}>
                  <Td className="font-medium">{m.name}</Td>
                  <Td right>{m.used > 0 ? `${fmtNum(m.used, 1)} ${unitLabel(m.unit)}` : "—"}</Td>
                  <Td right className={m.balance < 0 ? "text-red-600" : undefined}>{fmtNum(m.balance, 1)} {unitLabel(m.unit)}</Td>
                  <Td right className="text-slate-500">{m.days === null ? "—" : `${fmtNum(m.days, 0)} kun`}</Td>
                  <Td right className={m.need > 0 ? "font-semibold text-amber-700" : "text-slate-400"}>{m.need > 0 ? `${fmtNum(m.need, 1)} ${unitLabel(m.unit)}` : "—"}</Td>
                  <Td><Badge color={LEVEL_COLOR[m.level]}>{STOCK_LEVEL_LABEL[m.level]}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Hovlidagi tayyor mahsulot" action={more(yardHref, "Hovli")}>
          <Table maxHeight="26rem">
            <thead><tr><Th>Mahsulot</Th><Th right>Jami</Th><Th right>Umumiy hovli</Th><Th right>Brigadalarda</Th></tr></thead>
            <tbody>
              {o.yard.length === 0 && <Empty text="Hovlida tayyor mahsulot yo'q" icon={Warehouse} />}
              {o.yard.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td right className="font-semibold">{qty(r.total)} {unitLabel(r.unit)}</Td>
                  <Td right className="text-slate-500">{qty(r.common)}</Td>
                  <Td right className="text-slate-500">{qty(Math.round((r.total - r.common) * 1000) / 1000)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      </div>
    </div>
  );
}
