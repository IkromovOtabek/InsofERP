import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { publicOrigin } from "@/lib/public-url";
import { date, dateTime, fmtNum } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { numWords } from "@/lib/num-words";
import { RENT_METHOD_LABEL } from "@/lib/rent";
import { rentReceipt, rentReceiptPath } from "@/lib/rent-receipt";
import { PrintButton } from "@/components/print-button";
import { AutoPrint } from "@/components/auto-print";
import { BackLink } from "@/components/ui";

/**
 * Arenda kvitansiyasi — ijarachidan qabul qilingan pul uchun. Bitta A4 varaqda ikki nusxa (ijarachiga va
 * korxonaga), o'rtasida qirqish chizig'i. QR — ommaviy `/k/<id>` sahifasi: to'lov haqiqiyligi va hozirgi qarz.
 */
export default async function RentReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string }> }) {
  await requirePage("/arenda");
  const { id } = await params;
  const sp = await searchParams;
  const [r, company, { origin, fromEnv }] = await Promise.all([rentReceipt(id), getCompany(), publicOrigin()]);
  if (!r) notFound();
  const url = `${origin}${rentReceiptPath(id)}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, width: 96, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  const phones = [company.phone, company.phone2].filter(Boolean).map((p) => formatPhone(p!));
  const cancelled = !!r.tx.cancelledAt;
  const words = numWords(r.amount);
  const tiyin = Math.round((r.amount % 1) * 100);

  const copy = (label: string) => (
    <section className="relative px-1 py-4">
      {cancelled && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="-rotate-12 rounded-lg border-4 border-red-600 px-6 py-2 text-3xl font-black uppercase tracking-widest text-red-600 opacity-70">Bekor qilingan</span></div>}
      <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
        <div>
          <div className="text-[15px] font-bold">{company.legalName ?? company.name}</div>
          {company.address && <div className="text-[11px]">{company.address}</div>}
          <div className="text-[11px]">{[company.inn && `INN ${company.inn}`, ...phones].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="text-right text-[11px] text-slate-600">{label}</div>
      </div>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-[16px] font-bold uppercase tracking-wide">Kvitansiya № {r.no}</h1>
          <div className="text-[12px]">{r.purpose} qabul qilingani haqida · {date(r.tx.date)}</div>
          <table className="mt-3 w-full text-[12.5px]">
            <tbody>
              <tr><td className="w-40 py-0.5 pr-2 text-slate-600">To&apos;lovchi (ijarachi)</td><td className="border-b border-slate-400 py-0.5 font-semibold">{r.payer.name}{r.payer.inn ? ` · INN ${r.payer.inn}` : ""}</td></tr>
              <tr><td className="py-0.5 pr-2 text-slate-600">Do&apos;kon, joy</td><td className="border-b border-slate-400 py-0.5">{r.shop.name} · {r.shop.location}</td></tr>
              <tr><td className="py-0.5 pr-2 text-slate-600">{r.forLabel?.label ?? "Qaysi oy uchun"}</td><td className="border-b border-slate-400 py-0.5">{r.forLabel?.value ?? "—"}</td></tr>
              <tr><td className="py-0.5 pr-2 text-slate-600">To&apos;lov usuli</td><td className="border-b border-slate-400 py-0.5">{RENT_METHOD_LABEL[r.tx.method]}</td></tr>
              <tr><td className="py-0.5 pr-2 text-slate-600">Summa</td><td className="border-b border-slate-400 py-0.5 text-[15px] font-bold tabular-nums">{fmtNum(r.amount, 2)} so&apos;m</td></tr>
              <tr><td className="py-0.5 pr-2 text-slate-600">So&apos;z bilan</td><td className="border-b border-slate-400 py-0.5 italic">{words.charAt(0).toUpperCase() + words.slice(1)} so&apos;m{tiyin ? ` ${tiyin} tiyin` : ""}</td></tr>
              {r.tx.note && <tr><td className="py-0.5 pr-2 text-slate-600">Izoh</td><td className="border-b border-slate-400 py-0.5">{r.tx.note}</td></tr>}
            </tbody>
          </table>
          <div className="mt-2 text-[11.5px]">
            Chop etilgan paytdagi holat ({dateTime(new Date())}): {r.debt > 1 ? <>qolgan qarz <b>{fmtNum(r.debt)} so&apos;m</b></> : r.debt < -1 ? <>avans <b>{fmtNum(-r.debt)} so&apos;m</b></> : <b>qarz yo&apos;q</b>}
          </div>
        </div>
        <div className="flex w-[110px] shrink-0 flex-col items-center">
          {/* Bosilsa — ijarachi QR orqali ko'radigan sahifa yangi oynada ochiladi */}
          <a href={url} target="_blank" rel="noopener" title="Ijarachi ko'radigan sahifani ochish" className="bg-white" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="text-center text-[8.5px] leading-tight text-slate-600">To&apos;lovni va qarzni tekshirish uchun skanerlang</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-8 text-[12px]">
        <div>Qabul qildi: <span className="inline-block w-32 border-b border-black align-baseline" /> {r.tx.createdBy.fullName}<div className="mt-1 text-[10px] text-slate-500">M.O&apos;.</div></div>
        <div>To&apos;lovchi: <span className="inline-block w-32 border-b border-black align-baseline" /></div>
      </div>
    </section>
  );

  return (
    <div className="paper mx-auto max-w-[210mm] bg-white p-8 text-black print:max-w-none print:p-0">
      <AutoPrint enabled={sp.print === "1"} />
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm } aside, nav, header { display: none } body { background: #fff } }`}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={`/arenda/dokon/${r.shop.id}`} label={r.shop.name} />
        <PrintButton />
      </div>
      {!fromEnv && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:hidden">QR havolasi <b>{origin}</b> ga ishora qiladi — telefon ocha olmasligi mumkin. <code>.env</code> da <code>APP_URL</code> ni tashqi manzil qiling.</div>}
      {copy("Ijarachi nusxasi")}
      <div className="my-2 flex items-center gap-2 text-[10px] text-slate-400"><span className="flex-1 border-t border-dashed border-slate-400" />qirqish chizig&apos;i<span className="flex-1 border-t border-dashed border-slate-400" /></div>
      {copy("Korxona nusxasi")}
    </div>
  );
}
