import { dayTitle, monthTitle } from "@/lib/davomat";
import { qty, pct, fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { STOCK_LEVEL_LABEL, type ReportSnapshot } from "@/lib/production-report";

const H = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <h2 className="mb-2 mt-6 border-b border-black/20 pb-1 text-[14px] font-semibold">{n}. {children}</h2>
);
const th = "border border-black/20 bg-slate-50 px-2 py-1 text-left font-semibold print:bg-transparent";
const td = "border border-black/20 px-2 py-1 align-top";
const tdr = `${td} text-right tabular`;

/**
 * Kunlik ishlab chiqarish hisobotining varag'i — jonli (`/dashboard/hisobot`) va saqlangan
 * (`/dashboard/hisobot/[id]`) nusxa shu bitta komponentdan chiziladi.
 */
export function ReportSheet({ r, company, stamp }: { r: ReportSnapshot; company: string; stamp: React.ReactNode }) {
  const worked = r.brigades.filter((b) => b.today);
  const lagging = r.plan.rows.filter((p) => (p.behind ?? 0) > 0);
  const loadLeft = r.load.orders.filter((o) => o.left > 0);
  const lowStock = r.stock.filter((s) => s.level !== "ok");

  return (
    <>
      <div className="flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-600">{company}</div>
          <h1 className="text-[18px] font-bold">Ishlab chiqarish — kunlik hisobot</h1>
        </div>
        <div className="text-right text-[12px]">
          <div className="font-semibold">{dayTitle(r.iso)}, {r.iso.slice(0, 4)}</div>
          <div className="text-slate-600">{stamp}</div>
        </div>
      </div>

      {/* Qisqa xulosa — direktor birinchi shu qatorlarni o'qiydi */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-5">
        {[
          ["Ishda", `${r.staff.present} / ${r.staff.total} kishi`],
          ["Ishlab chiqarildi", r.producedToday && r.producedToday !== "0" ? r.producedToday : "—"],
          ["Ishlagan brigada", `${worked.length} / ${r.brigades.length}`],
          ["Yuklash", `${r.load.orders.length} zayavka${loadLeft.length ? ` · ${loadLeft.length} tasi to'liq emas` : ""}`],
          ["Brak", r.defects.length ? `${r.defects.length} ta yozuv` : "yo'q"],
        ].map(([k, v]) => (
          <div key={k}><div className="text-[11px] text-slate-600">{k}</div><div className="font-semibold">{v}</div></div>
        ))}
      </div>
      {lagging.length > 0 && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 print:bg-transparent">
          <b>Plandan orqada:</b> {lagging.map((p) => `${p.code} — ${qty(p.behind ?? 0)} ${unitLabel(p.unit)}`).join("; ")}
        </p>
      )}
      {lowStock.length > 0 && (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 print:bg-transparent">
          <b>Xomashyo kam:</b> {lowStock.map((s) => `${s.name}${s.need > 0 ? ` — ${qty(s.need)} ${s.unit} kerak` : ""}`).join("; ")}
        </p>
      )}

      <H n={1}>Ishlab chiqarildi va plan ({monthTitle(r.ym)}, {r.plan.elapsed}/{r.plan.workDays} ish kuni)</H>
      {r.plan.rows.length === 0 ? <p className="text-slate-600">Bu oyda ishlab chiqarish qayd qilinmagan va plan yo&apos;q.</p> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Mahsulot</th><th className={th}>Bugun</th><th className={th}>Kunlik plan</th><th className={th}>Oy fakti</th><th className={th}>Oylik plan</th><th className={th}>Bajarildi</th><th className={th}>Orqada</th><th className={th}>Brak (bugun / oy)</th></tr></thead>
          <tbody>
            {r.plan.rows.map((p) => {
              const un = unitLabel(p.unit);
              return (
                <tr key={p.code}>
                  <td className={td}><b>{p.code}</b> {p.name}</td>
                  <td className={tdr}>{qty(p.day)} {un}</td>
                  <td className={tdr}>{p.dayPlan !== null ? `${qty(p.dayPlan)} ${un}` : "—"}</td>
                  <td className={tdr}>{qty(p.month)} {un}</td>
                  <td className={tdr}>{p.monthPlan !== null ? `${qty(p.monthPlan)} ${un}` : "—"}</td>
                  <td className={tdr}>{p.monthPct !== null ? pct(p.monthPct, 0) : "—"}</td>
                  <td className={`${tdr} ${(p.behind ?? 0) > 0 ? "font-semibold text-red-700" : ""}`}>{p.behind !== null ? (p.behind > 0 ? `${qty(p.behind)} ${un}` : "—") : ""}</td>
                  <td className={tdr}>{qty(p.defectDay)} / {qty(p.defectMonth)} {un}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <H n={2}>Yuklash (yetkazish sanasi — shu kun)</H>
      {r.load.orders.length === 0 ? <p className="text-slate-600">Zayavka yo&apos;q.</p> : (
        <>
          <p className="mb-2"><b>Jami:</b> {r.load.total}</p>
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>№</th><th className={th}>Vaqt</th><th className={th}>Mijoz</th><th className={th}>Mahsulot</th><th className={th}>Jo&apos;natildi</th><th className={th}>Qoldi</th></tr></thead>
            <tbody>
              {r.load.orders.map((o) => (
                <tr key={o.orderNo}>
                  <td className={td}>{o.orderNo}</td><td className={td}>{o.time ?? "—"}</td><td className={td}>{o.customer}</td>
                  <td className={td}>{o.items}</td>
                  <td className={tdr}>{qty(o.shipped)}</td>
                  <td className={`${tdr} ${o.left > 0 ? "font-semibold" : ""}`}>{o.left > 0 ? qty(o.left) : "✓"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <H n={3}>Brigadalar ishi</H>
      {r.brigades.length === 0 ? <p className="text-slate-600">Faol brigada yo&apos;q.</p> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Brigada</th><th className={th}>Brigadir</th><th className={th}>Shu kuni bajardi</th><th className={th}>Oy boshidan</th><th className={th}>Ochiq / kechikkan</th></tr></thead>
          <tbody>
            {r.brigades.map((b) => (
              <tr key={b.name}>
                <td className={td}><b>{b.name}</b></td><td className={td}>{b.leader ?? "—"}</td>
                <td className={td}>{b.today || <span className="text-slate-500">qayd yo&apos;q</span>}</td>
                <td className={tdr}>{b.month}</td>
                <td className={tdr}>{b.open} / {b.overdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <H n={4}>Brak</H>
      {r.defects.length === 0 ? <p className="text-slate-600">Shu kuni brak qayd qilinmagan.</p> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Vaqt</th><th className={th}>Mahsulot</th><th className={th}>Miqdor</th><th className={th}>Sabab</th><th className={th}>Brigada</th><th className={th}>Kim yozdi</th></tr></thead>
          <tbody>
            {r.defects.map((x, i) => (
              <tr key={i}>
                <td className={td}>{x.time}</td><td className={td}>{x.code}</td>
                <td className={tdr}>{qty(x.qty)} {unitLabel(x.unit)}</td>
                <td className={td}>{x.reason}</td><td className={td}>{x.brigade ?? "—"}</td><td className={td}>{x.by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <H n={5}>Sex xodimlari va davomat</H>
      <p>
        Sexda: <b>{r.staff.total}</b> · keldi <b>{r.staff.present}</b>
        {r.staff.absent > 0 && <> · kelmadi <b>{r.staff.absent}</b></>}
        {r.staff.sick > 0 && <> · kasal <b>{r.staff.sick}</b></>}
        {r.staff.leave > 0 && <> · ta&apos;til <b>{r.staff.leave}</b></>}
        {r.staff.dayoff > 0 && <> · dam olish <b>{r.staff.dayoff}</b></>}
        {r.staff.notMarked > 0 && <> · belgilanmagan <b>{r.staff.notMarked}</b></>}
      </p>
      {r.staff.groups.length > 0 && (
        <p className="mt-1">{r.staff.groups.map((g) => `${g.name}: ${g.present}/${g.total}`).join(" · ")}</p>
      )}
      {r.staff.away.length > 0 && (
        <p className="mt-1 text-slate-700">Ishda emas: {r.staff.away.map((e) => `${e.name} (${e.status.toLowerCase()})`).join(", ")}</p>
      )}

      <H n={6}>Sklad — xomashyo holati</H>
      {r.stock.length === 0 ? <p className="text-slate-600">Xomashyo kiritilmagan.</p> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Xomashyo</th><th className={th}>Qoldiq</th><th className={th}>Kunlik sarf</th><th className={th}>Yetadi</th><th className={th}>Zayavkalarga kerak</th><th className={th}>Olib kelish kerak</th><th className={th}>Holat</th></tr></thead>
          <tbody>
            {r.stock.map((s) => (
              <tr key={s.name} className={s.level === "short" ? "text-red-700" : ""}>
                <td className={td}><b>{s.name}</b></td>
                <td className={tdr}>{qty(s.balance)} {s.unit}</td>
                <td className={tdr}>{s.perDay > 0 ? `${fmtNum(s.perDay, 1)} ${s.unit}` : "—"}</td>
                <td className={tdr}>{s.days === null ? "—" : s.days > 999 ? ">999 kun" : `${fmtNum(s.days, 1)} kun`}</td>
                <td className={tdr}>{s.planned > 0 ? `${qty(s.planned)} ${s.unit}` : "—"}</td>
                <td className={`${tdr} ${s.need > 0 ? "font-semibold" : ""}`}>{s.need > 0 ? `${qty(s.need)} ${s.unit}` : "—"}</td>
                <td className={td}>{STOCK_LEVEL_LABEL[s.level]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-10 grid grid-cols-2 gap-10 text-[12px]">
        <div className="border-t border-black pt-1">Ishlab chiqarish boshlig&apos;i (imzo)</div>
        <div className="border-t border-black pt-1">Direktor (imzo)</div>
      </div>
    </>
  );
}
