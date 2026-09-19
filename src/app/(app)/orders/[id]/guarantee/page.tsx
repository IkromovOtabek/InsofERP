import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { customerCredit } from "@/lib/finance";
import { money, qty, date, fmtNum, deliveryAt } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { PrintButton } from "@/components/print-button";

/** Bo'sh katak — mijoz qo'lda to'ldiradi. Qiymat bo'lsa chiziq ustida ko'rsatiladi. */
function Blank({ value, w = "w-56" }: { value?: string | null; w?: string }) {
  return <span className={`inline-block ${w} border-b border-black px-1 align-baseline`}>{value ?? " "}</span>;
}

/**
 * Kafolat xati (garantiynoye pismo) — qarzga beriladigan zayavka uchun.
 * Mijoz rekvizitlari bazadan to'ldiriladi, qolgan kataklarni mijoz qo'lda yozib, imzo va muhr qo'yadi.
 */
export default async function GuaranteePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await db.order.findUnique({ where: { id }, include: { customer: true, items: { include: { product: true } } } });
  if (!o) notFound();
  const [company, credit] = await Promise.all([getCompany(), customerCredit(o.customerId)]);
  const total = o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
  const c = o.customer;

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-[13px] leading-relaxed text-black print:p-4">
      {credit.blacklisted && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 print:hidden"><b>Diqqat: mijoz qora ro'yxatda.</b> Kredit limiti to'liq ishlatilgan — kafolat xatini berishdan oldin direktor bilan kelishing.</div>
      )}
      <style>{`@media print { @page { size: A4; margin: 15mm } aside, nav, header { display: none } body { background: #fff } }`}</style>

      <div className="grid grid-cols-2 gap-6">
        <div className="text-[12px]">
          <div className="font-semibold">Kafolat beruvchi (mijoz):</div>
          <div>Nomi: <Blank value={c.name} w="w-full" /></div>
          <div className="mt-1">INN: <Blank value={c.inn} w="w-40" /></div>
          <div className="mt-1">Manzil: <Blank value={c.address} w="w-full" /></div>
          <div className="mt-1">Telefon: <Blank value={c.phone} w="w-40" /></div>
          <div className="mt-1">Bank / h/r: <Blank w="w-full" /></div>
        </div>
        <div className="text-right text-[12px]">
          <div className="font-semibold">{company.legalName ?? company.name}</div>
          <div>direktori {company.directorName ? `${company.directorName}ga` : "________________ga"}</div>
          {company.inn && <div>INN {company.inn}</div>}
          {company.address && <div>{company.address}</div>}
          <div className="mt-3">№ <Blank w="w-16" /> &nbsp; «<Blank w="w-8" />» <Blank w="w-24" /> 20<Blank w="w-8" /> y.</div>
        </div>
      </div>

      <h1 className="mt-8 text-center text-xl font-bold uppercase tracking-wide">Kafolat xati</h1>
      <div className="text-center text-[12px] text-slate-600">(Гарантийное письмо) · Zayavka {o.orderNo} dan {date(o.date)}</div>

      <p className="mt-6 text-justify">
        Biz, <b>{c.name}</b>{c.inn ? ` (INN ${c.inn})` : ""}, <b>{company.legalName ?? company.name}</b> tomonidan
        {" "}{o.orderNo}-sonli zayavka bo&apos;yicha yetkazib beriladigan quyidagi mahsulotlar uchun jami
        {" "}<b>{money(total)}</b> ({fmtNum(total)} so&apos;m) miqdoridagi to&apos;lovni
        {" "}«<Blank w="w-8" />» <Blank w="w-24" /> 20<Blank w="w-8" /> yilgacha
        {" "}to&apos;liq amalga oshirishga kafolat beramiz.
      </p>

      <table className="mt-5 w-full border-collapse border border-black">
        <thead><tr className="bg-slate-100">
          <th className="border border-black px-2 py-1 text-left">№</th>
          <th className="border border-black px-2 py-1 text-left">Mahsulot</th>
          <th className="border border-black px-2 py-1 text-right">Miqdor</th>
          <th className="border border-black px-2 py-1 text-right">Narx</th>
          <th className="border border-black px-2 py-1 text-right">Summa</th>
        </tr></thead>
        <tbody>
          {o.items.map((i, n) => (
            <tr key={i.id}>
              <td className="border border-black px-2 py-1">{n + 1}</td>
              <td className="border border-black px-2 py-1">{i.product.name}</td>
              <td className="border border-black px-2 py-1 text-right">{qty(i.qtyM3)} {unitLabel(i.product.unit)}</td>
              <td className="border border-black px-2 py-1 text-right">{money(i.price)}</td>
              <td className="border border-black px-2 py-1 text-right">{money(Number(i.qtyM3) * Number(i.price))}</td>
            </tr>
          ))}
          <tr className="font-semibold"><td colSpan={4} className="border border-black px-2 py-1 text-right">Jami</td><td className="border border-black px-2 py-1 text-right">{money(total)}</td></tr>
        </tbody>
      </table>

      <p className="mt-5 text-justify">
        To&apos;lov muddati buzilgan taqdirda, har bir kechiktirilgan kun uchun qarz summasining <Blank w="w-12" /> % miqdorida penya to&apos;lashga
        rozimiz. Ushbu xat {company.legalName ?? company.name} bilan tuzilgan shartnoma / zayavkaning ajralmas qismi hisoblanadi.
      </p>
      <p className="mt-3 text-justify">
        Yetkazib berish manzili: <b>{o.deliveryAddress}</b>. Yetkazish vaqti: <b>{deliveryAt(o.deliveryDate, o.deliveryTime)}</b>.
        Mahsulotni qabul qilishga vakolatli shaxs: <Blank w="w-64" />
      </p>

      <div className="mt-10 grid grid-cols-2 gap-10">
        <div>
          <div className="text-[12px] text-slate-600">Mijoz rahbari (F.I.O.)</div>
          <div className="mt-8 border-t border-black pt-1 text-[11px]">F.I.O. / imzo</div>
          <div className="mt-6 text-[11px] text-slate-600">M.O&apos;. (muhr)</div>
        </div>
        <div>
          <div className="text-[12px] text-slate-600">Bosh buxgalter (F.I.O.)</div>
          <div className="mt-8 border-t border-black pt-1 text-[11px]">F.I.O. / imzo</div>
          <div className="mt-6 text-[11px] text-slate-600">Sana: «<Blank w="w-8" />» <Blank w="w-24" /> 20<Blank w="w-8" /> y.</div>
        </div>
      </div>

      <div className="mt-8 border-t border-dashed border-slate-400 pt-3 text-[11px] text-slate-500">
        Zavod uchun: qabul qildi <Blank w="w-40" /> sana <Blank w="w-24" /> · Sotuv xodimi: <Blank w="w-40" />
      </div>
      <div className="mt-6 flex justify-end print:hidden"><PrintButton /></div>
    </div>
  );
}
