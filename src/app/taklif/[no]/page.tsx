import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck, Clock, Hourglass, CheckCircle2, Ban, Phone, Send, MapPin, UserRound } from "lucide-react";
import { getCompany } from "@/lib/company";
import { date, fmtNum } from "@/lib/format";
import { findPublicOffer, isExpired, offerState, offerToday, offerTotals, offerUnitLabel } from "@/lib/offers";
import { asOfferLang, offerT } from "@/lib/offer-i18n";
import { LogoMark } from "@/components/logo";
import { ReplyForm } from "./reply-form";
import { ViewPing } from "./view-ping";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Ommaviy sahifa — mijoz hujjatdagi QR ni skanerlaydi (login yo'q). Raqam ketma-ket, shuning uchun
 * havolada tasodifiy kalit (`?k=`) bor: mos kelmasa haqiqiy 404 (raqam mavjudligi ham oshkor bo'lmaydi).
 *
 * Mijoz ko'radi: hujjat haqiqiyligi va muddati, mahsulotlar/summa, menejer bilan bog'lanish,
 * «Qabul qilaman» / «Savol berish». Ochilgani ERP'da «mijoz ko'rdi» deb hisoblanadi (`ViewPing` → /api/public/taklif-view).
 */
export default async function PublicOfferPage({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ k?: string; lang?: string }> }) {
  const { no } = await params;
  const { k, lang: langQ } = await searchParams;
  const o = await findPublicOffer(decodeURIComponent(no), k);
  if (!o) notFound();
  const company = await getCompany();

  const lang = asOfferLang(langQ, asOfferLang(o.lang));
  const T = offerT(lang);
  const st = offerState(o);
  const t = offerTotals(o.items.map((i) => ({ name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })), o.withVat, Number(o.advance));
  const daysLeft = Math.max(0, Math.round((new Date(o.validUntil.toISOString().slice(0, 10)).getTime() - new Date(offerToday()).getTime()) / 86_400_000));
  const managerPhone = o.manager.employee?.phone ?? company.phone ?? null;
  const telegram = company.telegram ? (company.telegram.startsWith("http") ? company.telegram : `https://t.me/${company.telegram.replace(/^@/, "")}`) : null;
  const mapUrl = company.lat != null && company.lng != null ? `https://maps.google.com/?q=${company.lat},${company.lng}` : null;

  const STATE = {
    ACTIVE: { icon: ShieldCheck, cls: "bg-emerald-50 border-emerald-200 text-emerald-900", title: T.pubGenuine, text: `${T.pubGenuineHint}. ${T.pubActive}: ${date(o.validUntil)} (${T.pubDaysLeft(daysLeft)})` },
    EXPIRED: { icon: Hourglass, cls: "bg-amber-50 border-amber-200 text-amber-900", title: T.pubExpired, text: T.pubExpiredHint },
    ACCEPTED: { icon: CheckCircle2, cls: "bg-sky-50 border-sky-200 text-sky-900", title: T.pubAccepted, text: T.pubAcceptedHint },
    CANCELLED: { icon: Ban, cls: "bg-red-50 border-red-200 text-red-900", title: T.pubCancelled, text: T.pubCancelledHint },
  }[st];
  const otherLang = lang === "ru" ? "uz" : "ru";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 print:bg-white print:p-0">
      <style>{`@media print { @page { size: A4; margin: 12mm } }`}</style>
      <ViewPing no={o.offerNo} k={o.verifyToken} />
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {/* Sarlavha */}
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <LogoMark className="h-11 w-11" />
            <div>
              <div className="text-base font-semibold leading-tight">{company.legalName ?? company.name}</div>
              <div className="text-xs text-slate-500">{T.subtitle}</div>
            </div>
          </div>
          <a href={`/taklif/${encodeURIComponent(o.offerNo)}?k=${o.verifyToken}&lang=${otherLang}`} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 print:hidden">{otherLang === "ru" ? "Рус" : "O'zb"}</a>
        </header>

        {/* Holat */}
        <section className={`flex items-start gap-3 rounded-2xl border p-4 ${STATE.cls}`}>
          <STATE.icon size={28} className="mt-0.5 shrink-0" />
          <div>
            <div className="text-lg font-semibold leading-tight">{STATE.title}</div>
            <div className="mt-0.5 text-sm opacity-90">{STATE.text}</div>
          </div>
        </section>

        {/* Hujjat */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-xl font-bold tracking-tight">{T.title}</h1>
            <div className="text-sm text-slate-600">{T.no} <b className="text-slate-900">{o.offerNo}</b> · {date(o.date)}</div>
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-500">{T.client}</dt><dd className="text-right font-medium">{o.clientName}</dd></div>
            {o.clientInn && <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-500">{T.inn}</dt><dd>{o.clientInn}</dd></div>}
            {o.objectName && <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-500">{T.object}</dt><dd className="text-right">{o.objectName}</dd></div>}
            {o.deadline && <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-500">{T.deadline}</dt><dd className="text-right">{o.deadline}</dd></div>}
            <div className="flex justify-between gap-3 border-b border-slate-100 py-1"><dt className="text-slate-500">{T.validUntil}</dt><dd className={isExpired(o.validUntil) ? "font-medium text-amber-700" : "font-medium"}>{date(o.validUntil)}</dd></div>
          </dl>

          <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">{T.pubItems}</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1.5 pr-2 font-medium">{T.colName}</th><th className="py-1.5 pr-2 text-right font-medium">{T.colQty}</th><th className="py-1.5 pr-2 text-right font-medium">{o.withVat ? T.colPriceVat : T.colPrice}</th><th className="py-1.5 text-right font-medium">{T.total}</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {t.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-2 font-medium">{l.name}</td>
                    <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{fmtNum(l.qty, 3)} {offerUnitLabel(l.unit)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{fmtNum(l.grossUnit)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{fmtNum(l.gross)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {o.withVat && <tr><td colSpan={3} className="pt-3 text-right text-xs text-slate-500">{T.colVat}</td><td className="pt-3 text-right text-xs tabular-nums text-slate-500">{fmtNum(t.vat)}</td></tr>}
                <tr><td colSpan={3} className="py-1 text-right font-semibold">{T.total}</td><td className="py-1 text-right text-lg font-bold tabular-nums">{fmtNum(t.gross)} <span className="text-sm font-medium text-slate-500">{T.sum}</span></td></tr>
                {t.advance > 0 && <>
                  <tr><td colSpan={3} className="py-0.5 text-right text-slate-600">{T.advance}</td><td className="py-0.5 text-right tabular-nums">{fmtNum(t.advance)}</td></tr>
                  <tr><td colSpan={3} className="py-0.5 text-right font-semibold">{T.rest}</td><td className="py-0.5 text-right font-semibold tabular-nums">{fmtNum(t.rest)}</td></tr>
                </>}
              </tfoot>
            </table>
          </div>
          {o.terms && (
            <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
              {o.terms.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => <li key={i}>• {l}</li>)}
            </ul>
          )}
        </section>

        {/* Javob */}
        <ReplyForm offerNo={o.offerNo} k={o.verifyToken} canAccept={st === "ACTIVE"} t={{ pubAccept: T.pubAccept, pubAsk: T.pubAsk, pubName: T.pubName, pubPhone: T.pubPhone, pubNote: T.pubNote, pubNoteAccept: T.pubNoteAccept, pubNoteAsk: T.pubNoteAsk, pubSend: T.pubSend, pubCancelBtn: T.pubCancelBtn, pubPrint: T.pubPrint }} />

        {/* Menejer va bog'lanish */}
        <section className="rounded-2xl bg-white p-5 shadow-sm print:hidden">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{T.pubManager}</h2>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600"><UserRound size={22} /></div>
            <div>
              <div className="font-semibold">{o.manager.fullName}</div>
              {managerPhone && <div className="text-sm text-slate-600">{managerPhone}</div>}
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {managerPhone && <a href={`tel:${managerPhone.replace(/[^\d+]/g, "")}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"><Phone size={16} /> {T.pubCall}</a>}
            {telegram && <a href={telegram} target="_blank" rel="noopener" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800"><Send size={16} /> {T.pubTelegram}</a>}
            {mapUrl && <a href={mapUrl} target="_blank" rel="noopener" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800"><MapPin size={16} /> {T.pubMap}</a>}
          </div>
          {company.address && <div className="mt-3 flex items-start gap-1.5 text-xs text-slate-500"><MapPin size={13} className="mt-0.5 shrink-0" /> {company.address}</div>}
        </section>

        <footer className="flex items-center justify-center gap-1.5 pb-4 text-center text-[11px] text-slate-400"><Clock size={12} /> {T.registered} · {o.offerNo}</footer>
      </div>
    </main>
  );
}
