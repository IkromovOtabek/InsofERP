import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { requireRoles } from "@/lib/page-guard";
import { customerStatement } from "@/lib/invoices";
import { date, fmtNum, isoDate } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

/**
 * Akt sverki — mijoz bilan o'zaro hisob-kitoblarni solishtirish dalolatnomasi (chop etish uchun).
 * Davr sukut bo'yicha: joriy yil boshidan bugungacha. Debet — schyotlar, kredit — to'lovlar.
 */
export default async function AktSverki({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireRoles(["SALES", "ACCOUNTING", "FINANCE"], { module: "customers" });
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.customer.findUnique({ where: { id }, select: { id: true, name: true, inn: true, address: true } });
  if (!c) notFound();
  const now = new Date();
  const parsed = (v?: string) => { const d = v ? new Date(v) : null; return d && Number.isFinite(d.getTime()) ? d : null; };
  const from = parsed(sp.from) ?? new Date(now.getFullYear(), 0, 1);
  const to = parsed(sp.to) ?? new Date(now); to.setHours(23, 59, 59, 999);
  const [company, st] = await Promise.all([getCompany(), customerStatement(id, from, to)]);
  const n = (v: number) => (Math.abs(v) < 0.005 ? "" : fmtNum(v, 2));
  const side = (v: number) => (v > 0.005 ? "mijoz qarzi" : v < -0.005 ? "mijoz avansi (bizning qarzimiz)" : "qoldiq yo'q");
  const companyName = company.legalName ?? company.name;

  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-[13px] leading-relaxed text-black print:p-2">
      <style>{`@media print { @page { size: A4; margin: 12mm } aside, nav, header { display: none } body { background: #fff } }`}</style>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col text-xs text-slate-500">Davr boshi<input name="from" type="date" defaultValue={isoDate(from)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-900" /></label>
          <label className="flex flex-col text-xs text-slate-500">Davr oxiri<input name="to" type="date" defaultValue={isoDate(to)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-900" /></label>
          <button className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50">Ko&apos;rsatish</button>
        </form>
        <div className="flex items-center gap-3">
          <Link href={`/customers/${id}`} className="text-sm text-slate-500 hover:underline">← Mijoz kartasi</Link>
          <PrintButton />
        </div>
      </div>

      <h1 className="text-center text-lg font-bold uppercase">Akt sverki</h1>
      <div className="text-center text-[12px] text-slate-700">
        o&apos;zaro hisob-kitoblarni solishtirish dalolatnomasi · {date(from)} — {date(to)}
      </div>
      <p className="mt-4 text-justify">
        Biz, quyida imzo chekuvchilar, <b>{companyName}</b>{company.inn ? ` (INN ${company.inn})` : ""} va <b>{c.name}</b>{c.inn ? ` (INN ${c.inn})` : ""}
        {" "}o&apos;rtasidagi o&apos;zaro hisob-kitoblar holatini solishtirib, ushbu dalolatnomani tuzdik.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12px]">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-400 px-2 py-1 text-left">Sana</th>
              <th className="border border-slate-400 px-2 py-1 text-left">Hujjat</th>
              <th className="border border-slate-400 px-2 py-1 text-left">Izoh</th>
              <th className="border border-slate-400 px-2 py-1 text-right">Debet (schyot)</th>
              <th className="border border-slate-400 px-2 py-1 text-right">Kredit (to&apos;lov)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-semibold">
              <td className="border border-slate-400 px-2 py-1" colSpan={3}>Boshlang&apos;ich qoldiq ({date(from)} holatiga) — {side(st.opening)}</td>
              <td className="border border-slate-400 px-2 py-1 text-right tabular-nums">{st.opening > 0 ? n(st.opening) : ""}</td>
              <td className="border border-slate-400 px-2 py-1 text-right tabular-nums">{st.opening < 0 ? n(-st.opening) : ""}</td>
            </tr>
            {st.lines.length === 0 && (
              <tr><td colSpan={5} className="border border-slate-400 px-2 py-3 text-center text-slate-500">Davrda schyot va to&apos;lov yo&apos;q</td></tr>
            )}
            {st.lines.map((l, i) => (
              <tr key={i}>
                <td className="border border-slate-400 px-2 py-1 whitespace-nowrap">{date(l.date)}</td>
                <td className="border border-slate-400 px-2 py-1">{l.href ? <Link href={l.href} className="hover:underline print:no-underline">{l.doc}</Link> : l.doc}</td>
                <td className="border border-slate-400 px-2 py-1 text-slate-600">{l.note ?? ""}</td>
                <td className="border border-slate-400 px-2 py-1 text-right tabular-nums">{n(l.debit)}</td>
                <td className="border border-slate-400 px-2 py-1 text-right tabular-nums">{n(l.credit)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="border border-slate-400 px-2 py-1" colSpan={3}>Davr aylanmasi</td>
              <td className="border border-slate-400 px-2 py-1 text-right tabular-nums">{fmtNum(st.debit, 2)}</td>
              <td className="border border-slate-400 px-2 py-1 text-right tabular-nums">{fmtNum(st.credit, 2)}</td>
            </tr>
            <tr className="bg-slate-50 font-bold">
              <td className="border border-slate-400 px-2 py-1" colSpan={3}>Yakuniy qoldiq ({date(to)} holatiga) — {side(st.closing)}</td>
              <td className="border border-slate-400 px-2 py-1 text-right tabular-nums">{st.closing > 0 ? n(st.closing) : ""}</td>
              <td className="border border-slate-400 px-2 py-1 text-right tabular-nums">{st.closing < 0 ? n(-st.closing) : ""}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3">
        {date(to)} holatiga {st.closing > 0.005
          ? <><b>{c.name}</b> ning <b>{companyName}</b> oldidagi qarzi <b>{fmtNum(st.closing, 2)} so&apos;m</b>.</>
          : st.closing < -0.005
            ? <><b>{companyName}</b> ning <b>{c.name}</b> oldidagi qarzi (olingan avans) <b>{fmtNum(-st.closing, 2)} so&apos;m</b>.</>
            : <>tomonlar o&apos;rtasida qarz yo&apos;q.</>}
      </p>
      <p className="mt-1 text-[11px] text-slate-500 print:hidden">Realizatsiya jurnali (Excel importi) yozuvlari va bekor qilingan schyotlar aktga kirmaydi — qarz hisobi bilan bir xil qoida.</p>

      <div className="mt-10 grid grid-cols-2 gap-10 text-[12px]">
        <div>
          <div className="font-semibold">{companyName}</div>
          <div className="mt-8 border-b border-black" />
          <div className="mt-1 text-slate-600">imzo, M.O.</div>
        </div>
        <div>
          <div className="font-semibold">{c.name}</div>
          <div className="mt-8 border-b border-black" />
          <div className="mt-1 text-slate-600">imzo, M.O.</div>
        </div>
      </div>
    </div>
  );
}
