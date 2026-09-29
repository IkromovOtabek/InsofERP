import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { productionDay, PRODUCTION_HOME_ROLES } from "@/lib/production-day";
import { dayTitle, monthTitle, shiftDay, today, validDay, markOf } from "@/lib/davomat";
import { qty, pct, dateTime } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { PrintButton } from "@/components/print-button";

const H = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <h2 className="mb-2 mt-6 border-b border-black/20 pb-1 text-[14px] font-semibold">{n}. {children}</h2>
);
const th = "border border-black/20 bg-slate-50 px-2 py-1 text-left font-semibold print:bg-transparent";
const td = "border border-black/20 px-2 py-1 align-top";
const tdr = `${td} text-right tabular`;

/**
 * Direktorga kunlik ishlab chiqarish hisoboti — bitta varaq, chop etish / PDF uchun.
 * Raqamlar bosh sahifadagi bilan bir manbadan (`productionDay`).
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ kun?: string }> }) {
  const s = await getSession();
  if (!s || !(s.role === "DIRECTOR" || (PRODUCTION_HOME_ROLES as readonly string[]).includes(s.role))) redirect("/dashboard?denied=1");
  const iso = validDay((await searchParams).kun) ?? today();
  const [d, company] = await Promise.all([productionDay(iso), getCompany()]);
  const isToday = iso === today();

  const worked = d.brigades.filter((b) => b.today.length);
  const lagging = d.plan.rows.filter((p) => p.behind > 0);
  const loadLeft = d.load.orders.filter((o) => o.left > 0);

  return (
    <div className="paper mx-auto max-w-4xl rounded-sm bg-white p-8 text-[12.5px] text-black print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <style>{`@media print { @page { size: A4; margin: 12mm } aside, nav, header { display: none } body { background: #fff } }`}</style>

      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-900">← Bosh sahifa</Link>
        <div className="flex items-center gap-1 text-sm">
          <Link href={`?kun=${shiftDay(iso, -1)}`} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Oldingi kun"><ChevronLeft size={16} /></Link>
          <span className="px-2 font-medium">{dayTitle(iso)}</span>
          {!isToday && <Link href={`?kun=${shiftDay(iso, 1)}`} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Keyingi kun"><ChevronRight size={16} /></Link>}
        </div>
        <PrintButton />
      </div>

      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-600">{company.name}</div>
          <h1 className="text-[18px] font-bold">Ishlab chiqarish — kunlik hisobot</h1>
        </div>
        <div className="text-right text-[12px]">
          <div className="font-semibold">{dayTitle(iso)}, {iso.slice(0, 4)}</div>
          <div className="text-slate-600">Tuzildi: {dateTime(new Date())} · {s.fullName}</div>
        </div>
      </div>

      {/* Qisqa xulosa — direktor birinchi shu qatorlarni o'qiydi */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        {[
          ["Ishda", `${d.attendance.present.length} / ${d.staff.total} kishi`],
          ["Ishlagan brigada", `${worked.length} / ${d.brigades.length}`],
          ["Yuklash", `${d.load.orders.length} zayavka${loadLeft.length ? ` · ${loadLeft.length} tasi to'liq emas` : ""}`],
          ["Brak", d.defects.today.length ? `${d.defects.today.length} ta yozuv` : "yo'q"],
        ].map(([k, v]) => (
          <div key={k}><div className="text-[11px] text-slate-600">{k}</div><div className="font-semibold">{v}</div></div>
        ))}
      </div>
      {lagging.length > 0 && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 print:bg-transparent">
          <b>Plandan orqada:</b> {lagging.map((p) => `${p.product.code} — ${qty(p.behind)} ${unitLabel(p.product.unit)}`).join("; ")}
        </p>
      )}

      <H n={1}>Ishlab chiqarildi va plan ({monthTitle(d.ym)}, {d.plan.elapsed}/{d.plan.workDays} ish kuni)</H>
      {d.produced.length === 0 && d.plan.rows.length === 0 ? <p className="text-slate-600">Bu oyda ishlab chiqarish qayd qilinmagan va plan yo&apos;q.</p> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Mahsulot</th><th className={th}>Bugun</th><th className={th}>Kunlik plan</th><th className={th}>Oy fakti</th><th className={th}>Oylik plan</th><th className={th}>Bajarildi</th><th className={th}>Orqada</th><th className={th}>Brak (bugun / oy)</th></tr></thead>
          <tbody>
            {[...new Set([...d.plan.rows.map((p) => p.product.id), ...d.produced.map((r) => r.product.id)])].map((id) => {
              const p = d.plan.rows.find((x) => x.product.id === id);
              const r = d.produced.find((x) => x.product.id === id);
              const prod = p?.product ?? r!.product;
              const un = unitLabel(prod.unit);
              return (
                <tr key={id}>
                  <td className={td}><b>{prod.code}</b> {prod.name}</td>
                  <td className={tdr}>{qty(r?.day ?? 0)} {un}</td>
                  <td className={tdr}>{p ? `${qty(p.dayQty)} ${un}` : "—"}</td>
                  <td className={tdr}>{qty(r?.month ?? 0)} {un}</td>
                  <td className={tdr}>{p ? `${qty(p.monthQty)} ${un}` : "—"}</td>
                  <td className={tdr}>{p ? pct(p.monthPct, 0) : "—"}</td>
                  <td className={`${tdr} ${p && p.behind > 0 ? "font-semibold text-red-700" : ""}`}>{p ? (p.behind > 0 ? `${qty(p.behind)} ${un}` : "—") : ""}</td>
                  <td className={tdr}>{qty(r?.defectDay ?? 0)} / {qty(r?.defectMonth ?? 0)} {un}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <H n={2}>Yuklash (yetkazish sanasi — shu kun)</H>
      {d.load.orders.length === 0 ? <p className="text-slate-600">Zayavka yo&apos;q.</p> : (
        <>
          <p className="mb-2"><b>Jami:</b> {d.load.products.map((p) => `${p.code} ${qty(p.need)} ${unitLabel(p.unit)}`).join(" · ")}</p>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>№</th><th className={th}>Vaqt</th><th className={th}>Mijoz</th><th className={th}>Mahsulot</th><th className={th}>Jo&apos;natildi</th><th className={th}>Qoldi</th></tr></thead>
            <tbody>
              {d.load.orders.map((o) => (
                <tr key={o.id}>
                  <td className={td}>{o.orderNo}</td><td className={td}>{o.time ?? "—"}</td><td className={td}>{o.customer}</td>
                  <td className={td}>{o.items.map((i) => `${i.code} ${qty(i.qty)} ${unitLabel(i.unit)}`).join(", ")}</td>
                  <td className={tdr}>{qty(o.shipped)}</td>
                  <td className={`${tdr} ${o.left > 0 ? "font-semibold" : ""}`}>{o.left > 0 ? qty(o.left) : "✓"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <H n={3}>Brigadalar ishi</H>
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>Brigada</th><th className={th}>Brigadir</th><th className={th}>Shu kuni bajardi</th><th className={th}>Oy boshidan</th><th className={th}>Ochiq / kechikkan</th></tr></thead>
        <tbody>
          {d.brigades.map((b) => (
            <tr key={b.id}>
              <td className={td}><b>{b.name}</b></td><td className={td}>{b.leader ?? "—"}</td>
              <td className={td}>{b.today.length ? b.today.map((t) => `${t.product} ${qty(t.qty)} ${unitLabel(t.unit)}`).join("; ") : <span className="text-slate-500">qayd yo&apos;q</span>}</td>
              <td className={tdr}>{b.monthText}</td>
              <td className={tdr}>{b.openCount} / {b.overdue}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <H n={4}>Brak</H>
      {d.defects.today.length === 0 ? <p className="text-slate-600">Shu kuni brak qayd qilinmagan.</p> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Vaqt</th><th className={th}>Mahsulot</th><th className={th}>Miqdor</th><th className={th}>Sabab</th><th className={th}>Brigada</th><th className={th}>Kim yozdi</th></tr></thead>
          <tbody>
            {d.defects.today.map((r) => (
              <tr key={r.id}>
                <td className={td}>{dateTime(r.date).slice(-5)}</td><td className={td}>{r.product.code}</td>
                <td className={tdr}>{qty(r.qty)} {unitLabel(r.product.unit)}</td>
                <td className={td}>{r.reason}{r.note ? ` · ${r.note}` : ""}</td><td className={td}>{r.brigade ?? "—"}</td><td className={td}>{r.by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <H n={5}>Davomat</H>
      <p>
        Jami xodim: <b>{d.staff.total}</b> · keldi <b>{d.attendance.present.length}</b>
        {d.attendance.absent > 0 && <> · kelmadi <b>{d.attendance.absent}</b></>}
        {d.attendance.sick > 0 && <> · kasal <b>{d.attendance.sick}</b></>}
        {d.attendance.leave > 0 && <> · ta&apos;til <b>{d.attendance.leave}</b></>}
        {d.attendance.notMarked.length > 0 && <> · belgilanmagan <b>{d.attendance.notMarked.length}</b></>}
      </p>
      {d.attendance.away.length > 0 && (
        <p className="mt-1 text-slate-700">Ishda emas: {d.attendance.away.map((e) => `${e.fullName} (${markOf(e.status).label.toLowerCase()})`).join(", ")}</p>
      )}

      <div className="mt-10 grid grid-cols-2 gap-10 text-[12px]">
        <div className="border-t border-black pt-1">Ishlab chiqarish boshlig&apos;i (imzo)</div>
        <div className="border-t border-black pt-1">Direktor (imzo)</div>
      </div>
    </div>
  );
}
