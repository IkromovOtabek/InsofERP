import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { Ban, Check, Phone, Send } from "lucide-react";
import { getCompany } from "@/lib/company";
import { date, dateTime, fmtNum } from "@/lib/format";
import { findPublicOffer, offerPublicPath, offerState, offerToday, offerTotals, offerUnitLabel } from "@/lib/offers";
import { asOfferLang, offerT } from "@/lib/offer-i18n";
import { QrScreen, QrField, QrFooter, QrItemTile, QrLangLink, qrCard, qrCaption, qrUp, qrBtnAmber, qrBtnLight, qrBtnTelegram, telegramUrl, telHref } from "@/components/qr-screen";
import { ReplyForm } from "./reply-form";
import { ViewPing } from "./view-ping";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Muddat halqasi: r=32 → aylana 201; to'liq halqa — 14 kun va undan ko'p */
const ARC = 201;

/**
 * Ommaviy sahifa — mijoz hujjatdagi QR ni skanerlaydi (login yo'q). Raqam ketma-ket, shuning uchun
 * havolada tasodifiy kalit (`?k=`) bor: mos kelmasa haqiqiy 404 (raqam mavjudligi ham oshkor bo'lmaydi).
 *
 * Ko'rinish — artifakt «QR ochilish ekrani» (binafsha): amal qiladi (necha kun qolgani halqada, narxlar,
 * «Qabul qilaman»), muddati o'tgan (eski narxlar, «Yangilangan narx so'rash»), qabul qilingan (keyingi qadamlar),
 * bekor qilingan (qizil, «narxlar amal qilmaydi»). Ochilgani ERP'da «mijoz ko'rdi» deb hisoblanadi
 * (`ViewPing` → /api/public/taklif-view).
 */
export default async function PublicOfferPage({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ k?: string; lang?: string }> }) {
  const { no } = await params;
  const { k, lang: langQ } = await searchParams;
  const o = await findPublicOffer(decodeURIComponent(no), k);
  if (!o) notFound();
  const company = await getCompany();
  const now = new Date();

  const lang = asOfferLang(langQ, asOfferLang(o.lang));
  const T = offerT(lang);
  const st = offerState(o);
  const t = offerTotals(o.items.map((i) => ({ name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })), o.withVat, Number(o.advance));
  const daysLeft = Math.max(0, Math.round((new Date(o.validUntil.toISOString().slice(0, 10)).getTime() - new Date(offerToday()).getTime()) / 86_400_000));
  const managerPhone = o.manager.employee?.phone ?? company.phone ?? null;
  const telegram = telegramUrl(company.telegram);
  const otherLang = lang === "ru" ? "uz" : "ru";
  const self = `${offerPublicPath(o)}${langQ === "ru" || langQ === "uz" ? `&lang=${langQ}` : ""}`;
  const active = st === "ACTIVE", expired = st === "EXPIRED", accepted = st === "ACCEPTED", cancelled = st === "CANCELLED";
  const initial = o.manager.fullName.trim().charAt(0).toUpperCase();

  const head = cancelled
    ? { tone: "red" as const, title: T.pubCancelled, sub: T.qrCancelledSub, badge: "x" as const, effect: undefined }
    : expired
      ? { tone: "violet" as const, title: T.pubExpired, sub: T.qrExpiredSub, badge: "hourglass" as const, effect: undefined }
      : accepted
        ? { tone: "violet" as const, title: T.qrAcceptedTitle, sub: T.qrAcceptedSub, badge: "check" as const, effect: "confetti" as const }
        : { tone: "violet" as const, title: T.qrActiveTitle, sub: T.qrActiveSub, badge: "check" as const, effect: "sparks" as const };

  // Narxlar: amal qilayotgan/qabul qilingan — binafsha plitka, eskirgan/bekor — kulrang
  const prices = (
    <section className={`${qrUp(cancelled || expired ? 3 : 4)} flex flex-col gap-3 ${qrCard}`}>
      {expired
        ? <div className="flex items-baseline justify-between gap-3"><span className={qrCaption}>{T.qrOldPrices}</span><span className="text-[12px] text-[#5f7088]">{T.qrAsOf(date(o.date))}</span></div>
        : !cancelled && <span className={qrCaption}>{o.withVat ? T.qrPricesVat : T.qrPrices}</span>}
      {t.lines.map((l, i) => (
        <div key={i} className="vf-row flex items-center gap-3" style={{ animationDelay: `${1 + i * 0.15}s` }}>
          <QrItemTile name={l.name} tone={cancelled || expired ? "gray" : "violet"} />
          <div className="flex min-w-0 flex-1 flex-col"><span className="text-[14px] font-bold">{l.name}</span><span className="text-[12.5px] text-[#5f7088] tabular-nums">{fmtNum(l.qty, 3)} {offerUnitLabel(l.unit)} × {fmtNum(l.grossUnit)}</span></div>
          <span className="shrink-0 text-[14px] font-bold tabular-nums">{fmtNum(l.gross)}</span>
        </div>
      ))}
      <div className="h-px bg-[#f1f5f9]" />
      {o.withVat && active && <div className="flex justify-between gap-3 text-[13px] text-[#5f7088]"><span>{T.qrVatIncl}</span><span className="tabular-nums">{fmtNum(t.vat)}</span></div>}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-semibold">{accepted && o.withVat ? `${T.total} · ${T.colVat.replace(/ \d+%$/, "")}` : T.total}</span>
        <span className={`text-[26px] font-extrabold tracking-[-.02em] tabular-nums ${cancelled ? "vf-strike text-[#5f7088]" : ""}`}>{fmtNum(t.gross)} <span className="text-[14px] font-semibold text-[#5f7088]">{T.sum}</span></span>
      </div>
      {t.advance > 0 && active && (
        <div className="flex justify-between gap-3 text-[13px] font-semibold"><span className="text-[#5f7088]">{T.advance} {fmtNum(t.advance)}</span><span>{T.rest} {fmtNum(t.rest)}</span></div>
      )}
      {o.terms && active && (
        <ul className="m-0 flex list-none flex-col gap-1 border-t border-[#f1f5f9] p-0 pt-3 text-[12.5px] leading-[18px] text-[#5f7088]">
          {o.terms.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => <li key={i}>• {l}</li>)}
        </ul>
      )}
    </section>
  );

  const replyT = { pubAccept: T.pubAccept, pubAsk: T.pubAsk, pubName: T.pubName, pubPhone: T.pubPhone, pubNote: T.pubNote, pubNoteAccept: T.pubNoteAccept, pubNoteAsk: T.pubNoteAsk, pubSend: T.pubSend, pubCancelBtn: T.pubCancelBtn, pubPrint: T.pubPrint, qrAskNew: T.qrAskNew, qrAskNewOffer: T.qrAskNewOffer };

  return (
    <QrScreen lang={lang} head={{
      ...head, brand: company.legalName ?? company.name, brandSub: T.subtitle, eyebrow: `${T.qrEyebrow} · ${o.offerNo}`,
      badgeLabel: head.title,
      corner: <QrLangLink href={`${offerPublicPath(o)}&lang=${otherLang}`} label={otherLang === "ru" ? "Рус" : "O'zb"} dark />,
    }}>
      <ViewPing no={o.offerNo} k={o.verifyToken} />

      {(active || expired) && (
        <section className={`${qrUp(2)} flex items-center gap-4 ${qrCard}`}>
          <div className="relative h-[84px] w-[84px] shrink-0">
            <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
              <circle cx="42" cy="42" r="32" fill="none" stroke={expired ? "#f1f5f9" : "#f5f3ff"} strokeWidth="9" />
              <circle className={expired ? "vf-drain" : "vf-arc"} cx="42" cy="42" r="32" fill="none" stroke={expired ? "#cad5e2" : "#7c3aed"} strokeWidth="9" strokeLinecap="round" transform="rotate(-90 42 42)"
                style={{ "--arc-end": ARC - ARC * Math.min(1, Math.max(0.04, daysLeft / 14)) } as CSSProperties} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-[24px] leading-[26px] font-extrabold ${expired ? "text-[#45556c]" : "text-[#6d28d9]"}`}>{daysLeft}</span>
              <span className="text-[11px] font-bold text-[#5f7088]">{T.qrDays}</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-[3px]">
            <span className="text-[17px] font-extrabold">{expired ? T.qrEndedOn(date(o.validUntil)) : T.pubActive}</span>
            <span className="text-[13.5px] text-[#314158]">{expired ? T.qrNoAccept : T.qrValidTill(date(o.validUntil))}</span>
          </div>
        </section>
      )}

      {cancelled && (
        <section className={`${qrUp(2)} flex items-start gap-3 rounded-[18px] bg-[#fef2f2] px-[18px] py-4 shadow-[inset_0_0_0_1.5px_#ffc9c9]`}>
          <Ban size={22} className="mt-px shrink-0 text-[#c10007]" aria-hidden />
          <div className="flex flex-col gap-0.5 text-[#82181a]"><span className="text-[14px] font-bold">{T.qrNotValid}</span><span className="text-[13px] leading-[19px]">{T.qrNotValidHint}</span></div>
        </section>
      )}

      {accepted && (
        <section className={`${qrUp(2)} flex flex-col gap-1 ${qrCard}`}>
          <span className={`${qrCaption} mb-2`}>{T.qrNext}</span>
          <div className="relative flex flex-col gap-3.5">
            <div className="absolute bottom-3.5 left-[17px] top-3.5 w-[3px] rounded-sm bg-[#e2e8f0]" />
            <div className="vf-line absolute left-[17px] top-3.5 h-[52px] w-[3px] rounded-sm bg-[#7c3aed]" />
            {[
              { title: T.qrStepAccepted, hint: o.acceptedAt ? dateTime(o.acceptedAt) : "", done: true },
              { title: T.qrStepCall, hint: T.qrStepCallHint, cur: true },
              { title: T.qrStepContract, hint: T.qrStepContractHint },
              { title: T.qrStepDelivery, hint: T.qrStepDeliveryHint },
            ].map((s, i) => (
              <div key={i} className="relative flex items-center gap-3">
                <span className={`grid h-[37px] w-[37px] shrink-0 place-items-center rounded-full text-[13px] font-extrabold ${s.done ? "bg-[#7c3aed] text-[#ffffff]" : s.cur ? "vf-dotc bg-[#ffffff] text-[#6d28d9] shadow-[inset_0_0_0_2.5px_#7c3aed] [--pc:rgba(124,58,237,.55)]" : "bg-[#f1f5f9] text-[#5f7088]"}`}>
                  {s.done ? <Check size={17} strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <div className="flex min-w-0 flex-col"><span className={`text-[14px] font-bold ${s.done || s.cur ? "" : "text-[#5f7088]"}`}>{s.title}</span>{s.hint && <span className="text-[12.5px] text-[#5f7088]">{s.hint}</span>}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(active || cancelled) && (
        <section className={`${qrUp(cancelled ? 4 : 3)} grid grid-cols-2 gap-x-3 gap-y-3.5 ${qrCard} ${cancelled ? "opacity-85" : ""}`}>
          <QrField label={T.client} value={o.clientName} />
          {cancelled
            ? <QrField label={T.qrCancelledOn} value={dateTime(o.cancelledAt ?? o.updatedAt)} />
            : <>{o.clientInn && <QrField label={T.inn} value={o.clientInn} />}{o.objectName && <QrField label={T.object} value={o.objectName} />}<QrField label={T.date} value={date(o.date)} />{o.deadline && <QrField label={T.deadline} value={o.deadline} />}</>}
        </section>
      )}

      {prices}

      {expired && (
        <section className={`${qrUp(4)} grid grid-cols-2 gap-x-3 gap-y-3.5 ${qrCard}`}>
          <QrField label={T.client} value={o.clientName} />
          {o.objectName ? <QrField label={T.object} value={o.objectName} /> : <QrField label={T.date} value={date(o.date)} />}
        </section>
      )}

      {!accepted && (
        <div className={`${qrUp(5)} vf-noprint flex flex-col gap-2.5`}>
          <ReplyForm offerNo={o.offerNo} k={o.verifyToken} variant={active ? "active" : expired ? "expired" : "cancelled"} t={replyT} />
          {expired && managerPhone && <a href={telHref(managerPhone)} className={qrBtnLight}><Phone size={18} aria-hidden />{T.qrCallManager}</a>}
        </div>
      )}

      {active && (
        <section className={`${qrUp(6)} vf-noprint flex items-center gap-3 rounded-[18px] bg-[#0f172b] px-[18px] py-4 text-[#ffffff]`}>
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#7c3aed] text-[15px] font-extrabold">{initial}</div>
          <div className="flex min-w-0 flex-1 flex-col"><span className="text-[15px] font-bold">{T.pubManager}</span><span className="truncate text-[13px] opacity-75">{[o.manager.fullName, managerPhone].filter(Boolean).join(" · ")}</span></div>
          {managerPhone && <a href={telHref(managerPhone)} aria-label={T.qrCallManager} className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-[#f59e0b] text-[#0f172b]"><Phone size={20} aria-hidden /></a>}
        </section>
      )}

      {accepted && (
        <section className={`${qrUp(4)} vf-noprint flex flex-col gap-3.5 rounded-[18px] bg-[#0f172b] p-[18px] text-[#ffffff]`}>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#7c3aed] text-[15px] font-extrabold">{initial}</div>
            <div className="flex min-w-0 flex-col"><span className="text-[15px] font-bold">{T.qrWait}</span><span className="truncate text-[13px] opacity-75">{[o.manager.fullName, managerPhone].filter(Boolean).join(" · ")}</span></div>
          </div>
          {(managerPhone || telegram) && (
            <div className={`grid gap-2.5 ${managerPhone && telegram ? "grid-cols-2" : "grid-cols-1"}`}>
              {managerPhone && <a href={telHref(managerPhone)} className={qrBtnAmber}><Phone size={18} aria-hidden />{T.qrCallShort}</a>}
              {telegram && <a href={telegram} target="_blank" rel="noopener" className={qrBtnTelegram}><Send size={18} aria-hidden />Telegram</a>}
            </div>
          )}
        </section>
      )}

      <QrFooter checked={`${T.qrChecked} ${dateTime(now)}`} refresh={T.qrRefresh} href={self} color={cancelled ? "#c10007" : "#6d28d9"} staff={{ href: `/takliflar/${o.id}`, label: T.qrStaff }} />
    </QrScreen>
  );
}
