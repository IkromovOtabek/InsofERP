import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { publicOrigin } from "@/lib/public-url";
import { date, fmtNum } from "@/lib/format";
import { OFFER_DEFAULT_INTRO, OFFER_DEFAULT_TERMS, offerPublicPath, offerState, offerTotals, offerUnitLabel } from "@/lib/offers";
import { asOfferLang, offerT } from "@/lib/offer-i18n";
import { PrintHeaderArt, brandTitle } from "@/components/print-header-art";
import { PrintButton } from "@/components/print-button";
import { AutoPrint } from "@/components/auto-print";
import { BackLink } from "@/components/ui";

/**
 * Tijorat taklifi — rasmiy A4 hujjat (brauzerda Ctrl+P → PDF). Tili hujjatniki (`lang`), `?lang=` bilan
 * almashtiriladi. Pastda QR: mijoz skanerlab haqiqiyligini tekshiradi, savol beradi yoki qabul qiladi.
 */
export default async function OfferPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string; print?: string }> }) {
  await requirePage("/takliflar");
  const { id } = await params;
  const sp = await searchParams;
  const [o, company, { origin, fromEnv }] = await Promise.all([
    db.commercialOffer.findUnique({ where: { id }, include: { items: { orderBy: { sort: "asc" } }, manager: { select: { fullName: true, employee: { select: { phone: true } } } } } }),
    getCompany(),
    publicOrigin(),
  ]);
  if (!o) notFound();
  const lang = asOfferLang(sp.lang, asOfferLang(o.lang));
  const T = offerT(lang);
  const st = offerState(o);
  const t = offerTotals(o.items.map((i) => ({ name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })), o.withVat, Number(o.advance));
  const url = `${origin}${offerPublicPath(o)}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 2, width: 120, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  const intro = o.intro ?? company.offerIntro ?? OFFER_DEFAULT_INTRO;
  const terms = (o.terms ?? company.offerTerms ?? OFFER_DEFAULT_TERMS).split("\n").map((l) => l.trim()).filter(Boolean);
  const phones = [company.phone, company.phone2].filter(Boolean) as string[];
  const managerPhone = o.manager.employee?.phone ?? null;
  const cols = o.withVat ? 8 : 6;
  const cell = "border border-slate-800 px-2 py-1";

  return (
    <div className="paper mx-auto max-w-[210mm] bg-white p-8 text-[12px] leading-snug text-black print:max-w-none print:p-0">
      <AutoPrint enabled={sp.print === "1"} />
      <style>{`@media print { @page { size: A4 portrait; margin: 12mm } aside, nav, header { display: none } body { background: #fff } }`}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={`/takliflar/${id}`} label={`Taklif ${o.offerNo}`} />
        <div className="flex items-center gap-2">
          <a href={`/takliflar/${id}/print?lang=${lang === "ru" ? "uz" : "ru"}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">{lang === "ru" ? "O'zbekcha ko'rinish" : "Русская версия"}</a>
          <PrintButton />
        </div>
      </div>
      {st !== "ACTIVE" && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:hidden">Diqqat: bu taklif holati — <b>{st === "EXPIRED" ? "muddati o'tgan" : st === "ACCEPTED" ? "qabul qilingan" : "bekor qilingan"}</b>. Mijoz QR orqali shuni ko&apos;radi.</div>}
      {!fromEnv && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:hidden">QR havolasi <b>{origin}</b> ga ishora qiladi — telefon ocha olmasligi mumkin. <code>.env</code> da <code>APP_URL</code> ni tashqi manzil qiling.</div>}

      {/* ── Sarlavha: nom, kran-bino rasmi + rekvizitlar (eski Excel blankasi kabi) ── */}
      <div className="border-b-2 border-slate-900 pb-3">
        <div className="text-center font-serif italic text-[#2f6fc9]">
          <div className="text-[30px] font-bold leading-none tracking-wide">{brandTitle(company)}</div>
          <div className="mt-1 text-[17px] font-semibold">{T.subtitle}</div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-6">
          <PrintHeaderArt className="h-auto w-[44%] shrink-0" />
          <div className="flex-1 text-center text-[12px] italic leading-relaxed text-slate-900">
            {company.address && <div>{company.address}</div>}
            {company.bankAccount && <div>{T.account} № {company.bankAccount}</div>}
            {company.bankName && <div>{company.bankName}</div>}
            <div className="flex flex-wrap justify-center gap-x-4">
              {company.mfo && <span>{T.mfo}: {company.mfo}</span>}
              {company.inn && <span>{T.inn}: {company.inn}</span>}
              {company.oked && <span>{T.oked}: {company.oked}</span>}
            </div>
            {company.vatRegNo && <div>{T.vatReg} {company.vatRegNo}</div>}
            {phones.map((p) => <div key={p}>{T.phone}: {p}</div>)}
            {company.email && <div>{company.email}</div>}
          </div>
        </div>
      </div>

      {/* ── Kirish matni ── */}
      {intro && <p className="mt-3 text-center text-[11.5px] italic leading-relaxed text-slate-800">{intro}</p>}

      {/* ── Mijoz bloki va sarlavha ── */}
      <div className="mt-4 flex items-end justify-between gap-6">
        <div>
          <div className="text-[15px] font-bold uppercase tracking-wide">{T.title}</div>
          <div className="text-[13px] font-semibold">{T.no} {o.offerNo} · {date(o.date)}</div>
          <div className="mt-0.5 text-[11px] text-slate-700">{T.validUntil}: <b>{date(o.validUntil)}</b></div>
        </div>
        <table className="text-[11.5px]">
          <tbody>
            <tr><td className="pr-3 text-right font-semibold italic">{T.client}:</td><td className="min-w-[200px] border-b border-slate-400 px-1">{o.clientName}{o.clientInn ? ` (${T.inn} ${o.clientInn})` : ""}</td></tr>
            <tr><td className="pr-3 text-right font-semibold italic">{T.phone}:</td><td className="border-b border-slate-400 px-1">{o.clientPhone ?? " "}</td></tr>
            <tr><td className="pr-3 text-right font-semibold italic">{T.object}:</td><td className="border-b border-slate-400 px-1">{o.objectName ?? " "}</td></tr>
            <tr><td className="pr-3 text-right font-semibold italic">{T.deadline}:</td><td className="border-b border-slate-400 px-1">{o.deadline ?? " "}</td></tr>
            <tr><td className="pr-3 text-right font-semibold italic">{T.manager}:</td><td className="border-b border-slate-400 px-1">{o.manager.fullName}{managerPhone ? ` · ${managerPhone}` : ""}</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── Jadval ── */}
      <table className="mt-4 w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="bg-slate-100 text-center font-semibold italic text-sky-800">
            <th className={`${cell} w-8`}>{T.colNo}</th>
            <th className={`${cell} text-left`}>{T.colName}</th>
            <th className={`${cell} w-16`}>{T.colUnit}</th>
            <th className={`${cell} w-14`}>{T.colQty}</th>
            <th className={`${cell} w-24`}>{T.colPrice}</th>
            {o.withVat && <th className={`${cell} w-20`}>{T.colVat}</th>}
            {o.withVat && <th className={`${cell} w-24`}>{T.colPriceVat}</th>}
            <th className={`${cell} w-28`}>{o.withVat ? T.colTotal : T.colTotalNoVat}</th>
          </tr>
        </thead>
        <tbody className="italic">
          {t.lines.map((l, i) => (
            <tr key={i}>
              <td className={`${cell} text-center`}>{i + 1}</td>
              <td className={cell}>{l.name}</td>
              <td className={`${cell} text-center`}>{offerUnitLabel(l.unit)}</td>
              <td className={`${cell} text-right tabular-nums`}>{fmtNum(l.qty, 3)}</td>
              <td className={`${cell} text-right tabular-nums`}>{fmtNum(l.price)}</td>
              {o.withVat && <td className={`${cell} text-right tabular-nums`}>{fmtNum(l.vatUnit)}</td>}
              {o.withVat && <td className={`${cell} text-right tabular-nums`}>{fmtNum(l.grossUnit)}</td>}
              <td className={`${cell} text-right font-semibold tabular-nums`}>{fmtNum(l.gross)}</td>
            </tr>
          ))}
          {/* bo'sh qator — qo'lda qo'shimcha uchun, asl shaklda bo'lgani kabi */}
          <tr><td className={`${cell} text-center`}>{t.lines.length + 1}</td><td className={cell}>&nbsp;</td><td className={cell} /><td className={cell} /><td className={cell} />{o.withVat && <td className={cell} />}{o.withVat && <td className={cell} />}<td className={cell} /></tr>
        </tbody>
        <tfoot className="italic">
          <tr className="font-bold">
            <td className={`${cell} text-right`} colSpan={3}>{T.total}</td>
            <td className={`${cell} text-right tabular-nums`}>{fmtNum(t.qty, 3)}</td>
            <td className={cell} colSpan={cols - 5} />
            <td className={`${cell} text-right tabular-nums`}>{fmtNum(t.gross)}</td>
          </tr>
          <tr>
            <td className="px-2 py-0.5 text-right" colSpan={cols - 1}>{T.advance}</td>
            <td className="px-2 py-0.5 text-right tabular-nums">{t.advance > 0 ? fmtNum(t.advance) : ""}</td>
          </tr>
          <tr className="font-bold">
            <td className="px-2 py-0.5 text-right" colSpan={cols - 1}>{T.rest}</td>
            <td className="px-2 py-0.5 text-right tabular-nums">{fmtNum(t.rest)}</td>
          </tr>
        </tfoot>
      </table>

      {/* ── Shartlar + QR + imzo ── */}
      <div className="mt-4 flex items-start justify-between gap-6">
        <ul className="flex-1 space-y-0.5 text-center text-[11px] italic leading-relaxed text-slate-800">
          {terms.map((line, i) => <li key={i} className={i >= terms.length - 2 ? "font-semibold" : ""}>{line}</li>)}
          {phones.length > 0 && <li className="pt-1">{T.contactFooter}: {phones.join(", ")}</li>}
        </ul>
        <div className="flex shrink-0 flex-col items-center">
          <div className="bg-white" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="max-w-[150px] text-center text-[9px] leading-tight text-slate-600">{T.scanHint}</div>
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between gap-6 text-[11px]">
        <div>{T.signManager}: <span className="inline-block w-40 border-b border-slate-800 align-baseline" /> {o.manager.fullName}</div>
        <div className="text-slate-500">{T.stamp}</div>
      </div>
      <div className="mt-3 border-t border-slate-300 pt-1 text-[9px] text-slate-500">{T.registered} · {o.offerNo} · {url.replace(/^https?:\/\//, "")}</div>
    </div>
  );
}
