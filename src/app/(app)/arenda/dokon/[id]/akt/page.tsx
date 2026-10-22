import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { date, fmtNum } from "@/lib/format";
import { RENT_METHOD_LABEL, currentLeases, currentMonth, monthKey, monthLabel, parseMonth, shiftMonth } from "@/lib/rent";
import { receiptNo } from "@/lib/rent-receipt";
import { PrintButton } from "@/components/print-button";
import { BackLink } from "@/components/ui";

/**
 * Akt-sverka — ijarachi bilan o'zaro hisob-kitobni solishtirish dalolatnomasi (chop etish uchun).
 * Davr — oylar bo'yicha (sukut: yil boshidan joriy oygacha). Debet — oylik ijara hisobi, kredit — shu oylar
 * uchun tushgan to'lov (kvitansiyalar). To'lov qaysi oy uchun yozilgan bo'lsa o'sha oyga tushadi — ijarachi
 * kartasidagi qarz bilan bir xil qoida. Bekor qilingan to'lovlar kirmaydi.
 */
export default async function RentAktPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string; lease?: string }> }) {
  await requirePage("/arenda");
  const { id } = await params;
  const sp = await searchParams;
  const shop = await db.rentShop.findUnique({ where: { id } });
  if (!shop) notFound();
  // Akt — bitta ijarachi (shartnoma) bilan: `?lease=`, berilmasa — joriy shartnoma
  const leaseId = sp.lease ?? (await currentLeases([id])).get(id)?.id ?? null;
  const lease = leaseId ? await db.rentLease.findUnique({ where: { id: leaseId } }) : null;
  if (!lease || lease.shopId !== id) notFound();
  const now = currentMonth();
  let from = parseMonth(sp.from) ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  let to = parseMonth(sp.to) ?? now;
  if (from > to) [from, to] = [to, from];
  const end = shiftMonth(to, 1);

  const [company, before, charges, paidBefore, payments] = await Promise.all([
    getCompany(),
    db.rentCharge.aggregate({ where: { leaseId: lease.id, month: { lt: from } }, _sum: { bankDue: true, cashDue: true, elecDue: true } }),
    db.rentCharge.findMany({ where: { leaseId: lease.id, month: { gte: from, lt: end } }, orderBy: { month: "asc" } }),
    db.rentTx.aggregate({ where: { leaseId: lease.id, type: "INCOME", cancelledAt: null, month: { lt: from } }, _sum: { amount: true } }),
    db.rentTx.findMany({ where: { leaseId: lease.id, type: "INCOME", cancelledAt: null, month: { gte: from, lt: end } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
  ]);
  const opening = Number(before._sum.bankDue ?? 0) + Number(before._sum.cashDue ?? 0) + Number(before._sum.elecDue ?? 0) - Number(paidBefore._sum.amount ?? 0);
  const nos = await Promise.all(payments.map((p) => receiptNo(p)));

  type Line = { date: Date; doc: string; note: string; debit: number; credit: number };
  const lines: Line[] = [];
  for (let m = from; m < end; m = shiftMonth(m, 1)) {
    const key = monthKey(m);
    const c = charges.find((x) => monthKey(x.month) === key);
    if (c) {
      const bank = Number(c.bankDue), cash = Number(c.cashDue), elec = Number(c.elecDue);
      if (bank + cash + elec > 0) lines.push({ date: m, doc: `Ijara hisobi — ${monthLabel(m)}`, note: [bank && `perechisleniye ${fmtNum(bank)}`, cash && `naqd ${fmtNum(cash)}`, elec && `svet ${fmtNum(elec)}`].filter(Boolean).join(", "), debit: bank + cash + elec, credit: 0 });
    }
    payments.forEach((p, i) => {
      if (p.month && monthKey(p.month) === key) lines.push({ date: p.date, doc: `Kvitansiya ${nos[i]}`, note: `${RENT_METHOD_LABEL[p.method].toLowerCase()}, ${monthLabel(m)} uchun`, debit: 0, credit: Number(p.amount) });
    });
  }
  const debit = lines.reduce((s, l) => s + l.debit, 0), credit = lines.reduce((s, l) => s + l.credit, 0);
  const closing = opening + debit - credit;
  const n = (v: number) => (Math.abs(v) < 0.005 ? "" : fmtNum(v, 2));
  const side = (v: number) => (v > 0.005 ? "ijarachi qarzi" : v < -0.005 ? "ijarachi avansi" : "qoldiq yo'q");
  const companyName = company.legalName ?? company.name;
  const tenant = lease.tenantName ?? shop.name;
  const tenantInn = lease.inn;
  const periodEnd = new Date(end.getTime() - 86_400_000);
  const td = "border border-slate-400 px-2 py-1";

  return (
    <div className="paper mx-auto max-w-4xl bg-white p-6 text-[13px] leading-relaxed text-black print:p-2">
      <style>{`@media print { @page { size: A4; margin: 12mm } aside, nav, header { display: none } body { background: #fff } }`}</style>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="lease" value={lease.id} />
          <label className="flex flex-col text-xs text-slate-500">Davr boshi (oy)<input name="from" type="month" defaultValue={monthKey(from)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-900" /></label>
          <label className="flex flex-col text-xs text-slate-500">Davr oxiri (oy)<input name="to" type="month" defaultValue={monthKey(to)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-900" /></label>
          <button className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50">Ko&apos;rsatish</button>
        </form>
        <div className="flex items-center gap-3">
          <BackLink href={`/arenda/dokon/${id}`} label={shop.name} />
          <PrintButton />
        </div>
      </div>

      <h1 className="text-center text-lg font-bold uppercase">Akt-sverka</h1>
      <div className="text-center text-[12px] text-slate-700">ijara bo&apos;yicha o&apos;zaro hisob-kitoblarni solishtirish dalolatnomasi · {monthLabel(from)} — {monthLabel(to)}</div>
      <p className="mt-4 text-justify">
        Biz, quyida imzo chekuvchilar, ijaraga beruvchi <b>{companyName}</b>{company.inn ? ` (INN ${company.inn})` : ""} va ijarachi <b>{tenant}</b>{tenantInn ? ` (INN ${tenantInn})` : ""}
        {" "}— «{shop.name}», {shop.location} — o&apos;rtasidagi ijara to&apos;lovlari bo&apos;yicha hisob-kitoblar holatini solishtirib, ushbu dalolatnomani tuzdik.
      </p>

      <table className="mt-4 w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-slate-100">
            <th className={`${td} text-left`}>Sana</th>
            <th className={`${td} text-left`}>Hujjat</th>
            <th className={`${td} text-left`}>Izoh</th>
            <th className={`${td} text-right`}>Debet (hisoblandi)</th>
            <th className={`${td} text-right`}>Kredit (to&apos;landi)</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-semibold">
            <td className={td} colSpan={3}>Boshlang&apos;ich qoldiq ({date(from)} holatiga) — {side(opening)}</td>
            <td className={`${td} text-right tabular-nums`}>{opening > 0 ? n(opening) : ""}</td>
            <td className={`${td} text-right tabular-nums`}>{opening < 0 ? n(-opening) : ""}</td>
          </tr>
          {lines.length === 0 && <tr><td colSpan={5} className={`${td} py-3 text-center text-slate-500`}>Davrda hisob va to&apos;lov yo&apos;q</td></tr>}
          {lines.map((l, i) => (
            <tr key={i}>
              <td className={`${td} whitespace-nowrap`}>{date(l.date)}</td>
              <td className={td}>{l.doc}</td>
              <td className={`${td} text-slate-600`}>{l.note}</td>
              <td className={`${td} text-right tabular-nums`}>{n(l.debit)}</td>
              <td className={`${td} text-right tabular-nums`}>{n(l.credit)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className={td} colSpan={3}>Davr aylanmasi</td>
            <td className={`${td} text-right tabular-nums`}>{fmtNum(debit, 2)}</td>
            <td className={`${td} text-right tabular-nums`}>{fmtNum(credit, 2)}</td>
          </tr>
          <tr className="bg-slate-50 font-bold">
            <td className={td} colSpan={3}>Yakuniy qoldiq ({date(periodEnd)} holatiga) — {side(closing)}</td>
            <td className={`${td} text-right tabular-nums`}>{closing > 0 ? n(closing) : ""}</td>
            <td className={`${td} text-right tabular-nums`}>{closing < 0 ? n(-closing) : ""}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-3">
        {date(periodEnd)} holatiga {closing > 0.005
          ? <><b>{tenant}</b> ning <b>{companyName}</b> oldidagi ijara qarzi <b>{fmtNum(closing, 2)} so&apos;m</b>.</>
          : closing < -0.005
            ? <><b>{tenant}</b> tomonidan oldindan to&apos;langan (avans) summa <b>{fmtNum(-closing, 2)} so&apos;m</b>.</>
            : <>tomonlar o&apos;rtasida qarz yo&apos;q.</>}
      </p>
      <p className="mt-1 text-[11px] text-slate-500 print:hidden">To&apos;lov qaysi oy uchun yozilgan bo&apos;lsa o&apos;sha oyda ko&apos;rinadi. Svet faqat ijarachidan undirilsa (do&apos;konda belgilangan) kiradi, soliq — kirmaydi. Bekor qilingan to&apos;lovlar hisobga olinmaydi.</p>

      <div className="mt-10 grid grid-cols-2 gap-10 text-[12px]">
        <div>
          <div className="text-slate-600">Ijaraga beruvchi</div>
          <div className="font-semibold">{companyName}</div>
          <div className="mt-8 border-b border-black" />
          <div className="mt-1 text-slate-600">imzo, M.O&apos;.</div>
        </div>
        <div>
          <div className="text-slate-600">Ijarachi</div>
          <div className="font-semibold">{tenant}</div>
          <div className="mt-8 border-b border-black" />
          <div className="mt-1 text-slate-600">imzo</div>
        </div>
      </div>
    </div>
  );
}
