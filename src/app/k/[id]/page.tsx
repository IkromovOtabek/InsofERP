import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ban, Clock, LogIn, MapPin, Phone, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import { getCompany } from "@/lib/company";
import { date, dateTime, fmtNum } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { RENT_METHOD_LABEL } from "@/lib/rent";
import { rentReceipt, rentReceiptValid } from "@/lib/rent-receipt";
import { LogoMark } from "@/components/logo";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Ommaviy sahifa — arenda kvitansiyasidagi QR (login yo'q). Ijarachi yoki uning buxgalteri ko'radi: to'lov
 * haqiqiymi (bekor qilinmaganmi), qog'ozdagi summa bilan bir xilmi va hozir qancha qarz qolgan. Kalit mos
 * kelmasa — 404. Ichki narsalar (kassa qoldig'i, boshqa ijarachilar, kim bekor qilgani) chiqmaydi.
 */
export default async function PublicRentReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const { id } = await params;
  const { k } = await searchParams;
  if (!rentReceiptValid(id, k)) notFound();
  const r = await rentReceipt(id);
  if (!r) notFound();
  const company = await getCompany();
  const cancelled = !!r.tx.cancelledAt;
  const phones = [company.phone, company.phone2].filter(Boolean) as string[];
  const telegram = company.telegram ? (company.telegram.startsWith("http") ? company.telegram : `https://t.me/${company.telegram.replace(/^@/, "")}`) : null;
  const mapUrl = company.lat != null && company.lng != null ? `https://maps.google.com/?q=${company.lat},${company.lng}` : null;
  const row = "flex justify-between gap-3 border-b border-slate-100 py-1.5";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <header className="flex items-center gap-3">
          <LogoMark className="h-11 w-11" />
          <div>
            <div className="text-base font-semibold leading-tight">{company.legalName ?? company.name}</div>
            <div className="text-xs text-slate-500">Ijara to&apos;lovi kvitansiyasi</div>
          </div>
        </header>

        <section className={`flex items-start gap-3 rounded-2xl border p-4 ${cancelled ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          {cancelled ? <Ban size={28} className="mt-0.5 shrink-0" /> : <ShieldCheck size={28} className="mt-0.5 shrink-0" />}
          <div>
            <div className="text-lg font-semibold leading-tight">{cancelled ? "To'lov bekor qilingan" : "Haqiqiy to'lov"}</div>
            <div className="mt-0.5 text-sm opacity-90">{cancelled ? "Bu kvitansiya amal qilmaydi — savol bo'lsa korxonaga qo'ng'iroq qiling." : "To'lov korxona tizimida ro'yxatga olingan va qabul qilingan."}</div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-bold tracking-tight">Kvitansiya № {r.no}</h1>
          <dl className="mt-3 text-sm">
            <div className={row}><dt className="text-slate-500">Sana</dt><dd>{date(r.tx.date)}</dd></div>
            <div className={row}><dt className="text-slate-500">Do&apos;kon</dt><dd className="text-right font-medium">{r.shop.name} · {r.shop.location}</dd></div>
            <div className={row}><dt className="text-slate-500">Ijarachi</dt><dd className="text-right">{r.payer.name}</dd></div>
            {r.forLabel && <div className={row}><dt className="text-slate-500">{r.forLabel.label}</dt><dd className="text-right">{r.forLabel.value}</dd></div>}
            <div className={row}><dt className="text-slate-500">To&apos;lov usuli</dt><dd>{RENT_METHOD_LABEL[r.tx.method]}</dd></div>
            <div className="flex items-baseline justify-between gap-3 py-2"><dt className="text-slate-500">Summa</dt><dd className={`text-2xl font-bold tabular-nums ${cancelled ? "line-through text-slate-400" : ""}`}>{fmtNum(r.amount)} <span className="text-sm font-medium text-slate-500">so&apos;m</span></dd></div>
          </dl>
          <p className="mt-2 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><ShieldAlert size={15} className="mt-0.5 shrink-0 text-slate-500" /> Qog&apos;ozdagi kvitansiya raqami va summa shu sahifadagi bilan bir xil bo&apos;lishi kerak. Farq bo&apos;lsa — hujjat o&apos;zgartirilgan bo&apos;lishi mumkin.</p>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Hozirgi holat</h2>
          <div className={`mt-2 text-2xl font-bold tabular-nums ${r.debt > 1 ? "text-red-600" : "text-emerald-700"}`}>
            {r.debt > 1 ? <>Qarz: {fmtNum(r.debt)} so&apos;m</> : r.debt < -1 ? <>Avans: {fmtNum(-r.debt)} so&apos;m</> : "Qarz yo'q"}
          </div>
          {r.ledger.unpaid.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {r.ledger.unpaid.slice(0, 12).map((m) => (
                <li key={m.key} className="flex justify-between py-1.5"><span>{m.label}</span><span className="font-semibold tabular-nums text-red-600">{fmtNum(m.left)}</span></li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400"><Clock size={12} /> {dateTime(new Date())} holatiga</div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Bog&apos;lanish</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {phones[0] && <a href={`tel:${phones[0].replace(/[^\d+]/g, "")}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"><Phone size={16} /> {formatPhone(phones[0])}</a>}
            {telegram && <a href={telegram} target="_blank" rel="noopener" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800"><Send size={16} /> Telegram</a>}
            {mapUrl && <a href={mapUrl} target="_blank" rel="noopener" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800"><MapPin size={16} /> Xaritada</a>}
          </div>
          {company.address && <div className="mt-3 flex items-start gap-1.5 text-xs text-slate-500"><MapPin size={13} className="mt-0.5 shrink-0" /> {company.address}</div>}
        </section>

        <footer className="pb-4 text-center text-[11px] text-slate-400">
          {/* Xodim uchun — login talab qilinadi, ruxsat sahifa himoyasida tekshiriladi */}
          <a href={`/arenda/dokon/${r.shop.id}`} className="inline-flex items-center gap-1 text-slate-500 underline"><LogIn size={12} /> Korxona xodimimisiz? ERP&apos;da ochish</a>
        </footer>
      </div>
    </main>
  );
}
