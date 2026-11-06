import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ban, Phone, Send, ShieldCheck } from "lucide-react";
import { getCompany } from "@/lib/company";
import { date, dateTime, fmtNum } from "@/lib/format";
import { RENT_METHOD_LABEL } from "@/lib/rent";
import { rentReceipt, rentReceiptPath, rentReceiptValid } from "@/lib/rent-receipt";
import { QrScreen, QrField, QrFooter, qrCard, qrBtnDark, qrBtnTelegram, telegramUrl, telHref } from "@/components/qr-screen";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** «2026-yil oktyabr» → «Oktyabr» (oy chiziqlari ostida) */
const monthName = (label: string) => {
  const m = label.split(" ").pop() ?? label;
  return m.charAt(0).toUpperCase() + m.slice(1);
};

/**
 * Ommaviy sahifa — arenda kvitansiyasidagi QR (login yo'q). Ijarachi yoki uning buxgalteri ko'radi: to'lov
 * haqiqiymi (bekor qilinmaganmi), qog'ozdagi summa bilan bir xilmi va hozir qancha qarz qolgan. Kalit mos
 * kelmasa — 404. Ichki narsalar (kassa qoldig'i, boshqa ijarachilar, kim bekor qilgani) chiqmaydi.
 * Ko'rinish — artifakt «QR ochilish ekrani» (yashil): «chop etilgan» kvitansiya, TO'LANDI / BEKOR muhri,
 * hozirgi qarz va oxirgi oylar to'lovi.
 */
export default async function PublicRentReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const { id } = await params;
  const { k } = await searchParams;
  if (!rentReceiptValid(id, k)) notFound();
  const r = await rentReceipt(id);
  if (!r) notFound();
  const company = await getCompany();
  const now = new Date();
  const cancelled = !!r.tx.cancelledAt;
  const phone = company.phone ?? company.phone2 ?? null;
  const telegram = telegramUrl(company.telegram);
  // Oxirgi 3 oy (eskisidan yangisiga) — svet kvitansiyasida oylik ijara chiziqlari ko'rsatilmaydi
  const months = r.elec ? [] : r.ledger.months.filter((m) => m.due > 0 || m.paid > 0).slice(0, 3).reverse();

  return (
    <QrScreen head={{
      tone: cancelled ? "red" : "green", brand: company.legalName ?? company.name, brandSub: "Ijara bo'limi",
      eyebrow: r.elec ? "SVET TO'LOVI KVITANSIYASI" : "IJARA TO'LOVI KVITANSIYASI",
      title: cancelled ? "To'lov bekor qilingan" : "To'lov qabul qilindi",
      sub: cancelled ? "Bu kvitansiya kuchga ega emas." : r.tx.method === "CASH" ? "Pul korxona kassasiga tushgan va tizimda yozilgan." : "Pul korxona hisobiga tushgan va tizimda yozilgan.",
      badge: cancelled ? "x" : "check", badgeLabel: cancelled ? "Bekor qilingan" : "To'landi",
      effect: cancelled ? undefined : "sparks",
    }}>
      {/* «Chop etilgan» kvitansiya — pastki qirrasi tishli */}
      <div className="vf-print flex flex-col drop-shadow-[0_6px_14px_rgba(15,23,42,.10)]">
        <section className="relative flex flex-col gap-3.5 rounded-t-[18px] bg-[#ffffff] px-5 pb-[18px] pt-5">
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex flex-col"><span className="text-[12px] font-medium text-[#5f7088]">Kvitansiya</span><span className="text-[20px] font-extrabold">{r.no}</span></div>
            <span className="text-[13px] font-bold text-[#314158]">{date(r.tx.date)}</span>
          </div>
          <div className="flex flex-col gap-0.5 border-y-[1.5px] border-dashed border-[#e2e8f0] py-4">
            <span className="text-[12px] font-medium text-[#5f7088]">Summa</span>
            <span className={`font-extrabold tracking-[-.03em] tabular-nums ${fmtNum(r.amount).length > 11 ? "text-[28px] leading-8" : "text-[40px] leading-[44px]"} ${cancelled ? "vf-strike self-start text-[#5f7088]" : ""}`}>{fmtNum(r.amount)} <span className="text-[16px] font-bold text-[#5f7088]">so&apos;m</span></span>
            <span className="text-[13px] text-[#5f7088]">{RENT_METHOD_LABEL[r.tx.method]}{r.count > 1 ? `, ${r.count} oy uchun` : ""}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <QrField label="Do'kon" value={`${r.shop.name} · ${r.shop.location}`} />
            {r.forLabel ? <QrField label={r.forLabel.label} value={r.forLabel.value} /> : <QrField label="To'lov" value={r.purpose} />}
            <QrField label="Ijarachi" value={r.payer.name} />
            <QrField label="To'lov usuli" value={RENT_METHOD_LABEL[r.tx.method]} />
          </div>
          <div className={`vf-stamp absolute right-[18px] top-[82px] rounded-[10px] border-[3.5px] px-3 pb-1 pt-1.5 text-[20px] font-extrabold tracking-[.1em] ${cancelled ? "border-[#e7000b] bg-[rgba(254,242,242,.75)] text-[#e7000b]" : "border-[#009966] bg-[rgba(236,253,245,.7)] text-[#009966]"}`}>{cancelled ? "BEKOR" : "TO'LANDI"}</div>
        </section>
        <div className="vf-zig" />
      </div>

      {cancelled && (
        <section className="vf-up vf-d4 flex items-start gap-3 rounded-[18px] bg-[#fef2f2] px-[18px] py-4 shadow-[inset_0_0_0_1.5px_#ffc9c9]">
          <Ban size={22} className="mt-px shrink-0 text-[#c10007]" aria-hidden />
          <div className="flex flex-col gap-0.5 text-[#82181a]"><span className="text-[14px] font-bold">Bu to&apos;lov hisobingizga kirmagan</span><span className="text-[13px] leading-[19px]">Pul to&apos;lagan bo&apos;lsangiz, sekretarga murojaat qiling — yangi kvitansiya beriladi.</span></div>
        </section>
      )}

      <section className={`vf-up vf-d5 flex flex-col gap-3 ${qrCard}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[17px] font-bold">Hozirgi holat</span>
          <span className={`rounded-full px-[11px] py-[5px] text-[12px] font-bold ${r.debt > 1 ? "bg-[#fef2f2] text-[#c10007]" : "bg-[#ecfdf5] text-[#007a55]"}`}>{r.debt > 1 ? `${r.elec ? "Svet qarzi" : "Qarz"} bor` : "Qarz yo'q"}</span>
        </div>
        {(r.debt > 1 || r.debt < -1) && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] text-[#5f7088]">{r.debt > 1 ? "Qarz" : "Avans"}</span>
            <span className={`text-[24px] font-extrabold tabular-nums ${r.debt > 1 ? "text-[#c10007]" : "text-[#007a55]"}`}>{fmtNum(Math.abs(r.debt))} so&apos;m</span>
          </div>
        )}
        {months.length > 0 && (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map((m) => {
              const pct = m.due > 0 ? Math.min(100, (m.paid / m.due) * 100) : 100;
              return (
                <div key={m.key} className="flex flex-col gap-1.5 text-[12px] font-semibold">
                  <div className="relative h-2 overflow-hidden rounded-full bg-[#f1f5f9]"><div className={`vf-fill absolute inset-y-0 left-0 ${m.left > 1 ? "bg-[#f59e0b]" : "bg-[#009966]"}`} style={{ width: `${Math.round(pct)}%` }} /></div>
                  {monthName(m.label)}
                </div>
              );
            })}
          </div>
        )}
        {r.ledger.unpaid.length > 0 && r.debt > 1 && (
          <ul className="m-0 flex list-none flex-col divide-y divide-[#f1f5f9] p-0 text-[13px]">
            {r.ledger.unpaid.slice(0, 6).map((m) => <li key={m.key} className="flex justify-between py-1.5"><span>{m.label}</span><span className="font-bold tabular-nums text-[#c10007]">{fmtNum(m.left)}</span></li>)}
          </ul>
        )}
      </section>

      {!cancelled && (
        <section className="vf-up vf-d6 flex items-start gap-3 rounded-[18px] bg-[#fffbeb] px-[18px] py-4">
          <ShieldCheck size={22} className="mt-px shrink-0 text-[#bb4d00]" aria-hidden />
          <p className="m-0 text-[13.5px] leading-5 font-medium text-[#7c2d12]">Qog&apos;ozdagi kvitansiya raqami va summa shu ekrandagi bilan bir xil bo&apos;lishi kerak.</p>
        </section>
      )}

      {(phone || telegram) && (
        <section className={`vf-up vf-d6 vf-noprint grid gap-2.5 ${phone && telegram && !cancelled ? "grid-cols-2" : "grid-cols-1"}`}>
          {telegram && !cancelled && <a href={telegram} target="_blank" rel="noopener" className={`${qrBtnTelegram} min-h-[52px]`}><Send size={18} aria-hidden />Telegram</a>}
          {phone && <a href={telHref(phone)} className={`${qrBtnDark} min-h-[52px]`}><Phone size={18} aria-hidden />{cancelled ? "Sekretarga qo'ng'iroq" : "Qo'ng'iroq"}</a>}
        </section>
      )}

      <QrFooter checked={`Tekshirildi ${dateTime(now)}`} refresh="Qayta tekshirish" href={rentReceiptPath(id)} color={cancelled ? "#c10007" : "#007a55"} staff={{ href: `/arenda/dokon/${r.shop.id}`, label: "Korxona xodimimisiz? ERP'da ochish" }} />
    </QrScreen>
  );
}
