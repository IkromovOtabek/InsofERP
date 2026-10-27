import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { publicOrigin } from "@/lib/public-url";
import { orderPublicPath } from "@/lib/order-qr";
import { date, fmtNum } from "@/lib/format";
import { OFFER_DEFAULT_INTRO, OFFER_DEFAULT_TERMS } from "@/lib/offers";
import { asOfferLang, offerT } from "@/lib/offer-i18n";
import { ndsPart } from "@/lib/nds";
import { soleUnit, unitLabel } from "@/lib/unit";
import { PrintHeaderArt, brandTitle } from "@/components/print-header-art";
import { PrintButton } from "@/components/print-button";
import { AutoPrint } from "@/components/auto-print";
import { BackLink } from "@/components/ui";

/**
 * Zayavka — mijozga beriladigan A4 hujjat (brauzerda Ctrl+P → PDF). Ko'rinishi tijorat taklifi bilan bir xil:
 * rekvizitlar, kirish matni, mijoz bloki, QQS ustunli jadval, avans/qoldiq va shartlar. Tili `?lang=uz|ru`.
 * Narx `OrderItem.price` da: NDS belgilangan qatorda soliq qo'shilgan — QQS shundan ajratib ko'rsatiladi.
 */
export default async function OrderPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string; print?: string }> }) {
  await requirePage("/orders");
  const { id } = await params;
  const sp = await searchParams;
  const [o, company, { origin, fromEnv }] = await Promise.all([
    db.order.findUnique({
      where: { id },
      include: {
        customer: true,
        createdBy: { select: { fullName: true, employee: { select: { phone: true } } } },
        items: { include: { product: true } },
        invoices: { where: { status: { not: "CANCELLED" } }, include: { payments: true } },
        payments: true,
      },
    }),
    getCompany(),
    publicOrigin(),
  ]);
  if (!o || o.kind === "STOCK") notFound();
  const lang = asOfferLang(sp.lang);
  const T = offerT(lang);
  // QR — ommaviy `/z/<raqam>?k=` sahifasi (raqam faqat havolada, hujjat matnida ko'rsatilmaydi): kim skanerlasa ham hujjat haqiqiyligi va zayavka holatini ko'radi
  const url = `${origin}${orderPublicPath(o.orderNo, lang)}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 2, width: 120, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });

  const lines = o.items.map((i) => {
    const q = Number(i.qtyM3);
    const gross = Number(i.price);
    const vat = i.nds ? ndsPart(gross) : 0;
    return { name: i.product.name, unit: i.product.unit, qty: q, price: gross - vat, vat, gross, total: q * gross };
  });
  // Dastavka — alohida qator (miqdorsiz); jami unga ham qo'shiladi
  const fee = Number(o.deliveryFee);
  if (fee > 0) lines.push({ name: T.deliveryFee, unit: "", qty: 0, price: fee, vat: 0, gross: fee, total: fee });
  const withVat = o.items.some((i) => i.nds);
  const total = lines.reduce((s, l) => s + l.total, 0);
  const unit = soleUnit(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })));
  const totalQty = unit ? lines.reduce((s, l) => s + l.qty, 0) : null;
  // To'langan: avans + schyot to'lovlari (bir to'lov ikkala joyda bo'lishi mumkin — id bo'yicha bir marta)
  const paidMap = new Map<string, number>();
  for (const i of o.invoices) for (const x of i.payments) paidMap.set(x.id, Number(x.amount));
  for (const x of o.payments) paidMap.set(x.id, Number(x.amount));
  const paid = [...paidMap.values()].reduce((a, b) => a + b, 0);

  const intro = company.offerIntro ?? OFFER_DEFAULT_INTRO;
  const terms = (company.offerTerms ?? OFFER_DEFAULT_TERMS).split("\n").map((l) => l.trim()).filter(Boolean);
  const phones = [company.phone, company.phone2].filter(Boolean) as string[];
  const managerPhone = o.createdBy.employee?.phone ?? null;
  const deadline = o.dateUnknown ? "" : `${date(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""}`;
  const cols = withVat ? 8 : 6;
  const cell = "border border-slate-800 px-2 py-1";

  return (
    <div className="paper mx-auto max-w-[210mm] bg-white p-8 text-[12px] leading-snug text-black print:max-w-none print:p-0">
      <AutoPrint enabled={sp.print === "1"} />
      <style>{`@media print { @page { size: A4 portrait; margin: 12mm } aside, nav, header { display: none } body { background: #fff } }`}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={`/orders/${id}`} label="Zayavka" />
        <div className="flex items-center gap-2">
          <a href={`/orders/${id}/print?lang=${lang === "ru" ? "uz" : "ru"}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">{lang === "ru" ? "O'zbekcha ko'rinish" : "Русская версия"}</a>
          <PrintButton />
        </div>
      </div>
      {!fromEnv && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:hidden">QR havolasi <b>{origin}</b> ga ishora qiladi — telefon ocha olmasligi mumkin. <code>.env</code> da <code>APP_URL</code> ni tashqi manzil qiling.</div>}
      {o.status === "DRAFT" && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:hidden">Diqqat: zayavka hali <b>qoralama</b> — qabul qilinmagan.</div>}
      {o.status === "CANCELLED" && <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-[11px] text-red-800 print:hidden">Diqqat: zayavka <b>bekor qilingan</b>.</div>}

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
          <div className="text-[15px] font-bold uppercase tracking-wide">{T.orderTitle}</div>
          <div className="text-[13px] font-semibold">{date(o.date)}</div>
        </div>
        <table className="text-[11.5px]">
          <tbody>
            <tr><td className="pr-3 text-right font-semibold italic">{T.client}:</td><td className="min-w-[200px] border-b border-slate-400 px-1">{o.customer.name}{o.customer.inn ? ` (${T.inn} ${o.customer.inn})` : ""}</td></tr>
            <tr><td className="pr-3 text-right font-semibold italic">{T.phone}:</td><td className="border-b border-slate-400 px-1">{o.customer.phone ?? " "}</td></tr>
            <tr><td className="pr-3 text-right font-semibold italic">{T.object}:</td><td className="border-b border-slate-400 px-1">{o.deliveryAddress || " "}</td></tr>
            <tr><td className="pr-3 text-right font-semibold italic">{T.deadline}:</td><td className="border-b border-slate-400 px-1">{deadline || " "}</td></tr>
            <tr><td className="pr-3 text-right font-semibold italic">{T.manager}:</td><td className="border-b border-slate-400 px-1">{o.createdBy.fullName}{managerPhone ? ` · ${managerPhone}` : ""}</td></tr>
          </tbody>
        </table>
      </div>

      {/* ── Jadval ── */}
      <table className="mt-4 w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="bg-slate-100 text-center font-bold italic text-black">
            <th className={`${cell} w-8`}>{T.colNo}</th>
            <th className={`${cell} text-left`}>{T.colName}</th>
            <th className={`${cell} w-16`}>{T.colUnit}</th>
            <th className={`${cell} w-14`}>{T.colQty}</th>
            <th className={`${cell} w-24`}>{T.colPrice}</th>
            {withVat && <th className={`${cell} w-20`}>{T.colVat}</th>}
            {withVat && <th className={`${cell} w-24`}>{T.colPriceVat}</th>}
            <th className={`${cell} w-28`}>{withVat ? T.colTotal : T.colTotalNoVat}</th>
          </tr>
        </thead>
        <tbody className="italic text-black">
          {lines.map((l, i) => (
            <tr key={i}>
              <td className={`${cell} text-center`}>{i + 1}</td>
              <td className={cell}>{l.name}</td>
              <td className={`${cell} text-center`}>{unitLabel(l.unit)}</td>
              <td className={`${cell} text-right tabular-nums`}>{l.qty ? fmtNum(l.qty, 3) : ""}</td>
              <td className={`${cell} text-right tabular-nums`}>{fmtNum(l.price)}</td>
              {withVat && <td className={`${cell} text-right tabular-nums`}>{l.vat ? fmtNum(l.vat) : ""}</td>}
              {withVat && <td className={`${cell} text-right tabular-nums`}>{fmtNum(l.gross)}</td>}
              <td className={`${cell} text-right font-semibold tabular-nums`}>{fmtNum(l.total)}</td>
            </tr>
          ))}
          {/* bo'sh qator — qo'lda qo'shimcha uchun, asl shaklda bo'lgani kabi */}
          <tr><td className={`${cell} text-center`}>{lines.length + 1}</td><td className={cell}>&nbsp;</td><td className={cell} /><td className={cell} /><td className={cell} />{withVat && <td className={cell} />}{withVat && <td className={cell} />}<td className={cell} /></tr>
        </tbody>
        <tfoot className="italic text-black">
          <tr className="font-bold">
            <td className={`${cell} text-right`} colSpan={3}>{T.total}</td>
            <td className={`${cell} text-right tabular-nums`}>{totalQty != null ? fmtNum(totalQty, 3) : ""}</td>
            <td className={cell} colSpan={cols - 5} />
            <td className={`${cell} text-right tabular-nums`}>{fmtNum(total)}</td>
          </tr>
          <tr>
            <td className="px-2 py-0.5 text-right" colSpan={cols - 1}>{T.advance}</td>
            <td className="px-2 py-0.5 text-right tabular-nums">{paid > 0 ? fmtNum(paid) : ""}</td>
          </tr>
          <tr className="font-bold">
            <td className="px-2 py-0.5 text-right" colSpan={cols - 1}>{T.rest}</td>
            <td className="px-2 py-0.5 text-right tabular-nums">{fmtNum(Math.max(0, total - paid))}</td>
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
          {/* Bosilsa — mijoz QR orqali ko'radigan sahifa yangi oynada ochiladi */}
          <a href={url} target="_blank" rel="noopener" title="Mijoz ko'radigan sahifani ochish" className="bg-white" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="max-w-[150px] text-center text-[9px] leading-tight text-slate-600">{T.orderScanHint}</div>
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between gap-6 text-[11px]">
        <div>{T.signManager}: <span className="inline-block w-40 border-b border-slate-800 align-baseline" /> {o.createdBy.fullName}</div>
        <div className="text-slate-500">{T.stamp}</div>
      </div>
      <div className="mt-3 border-t border-slate-300 pt-1 text-[9px] text-slate-500">{T.registered} · {origin.replace(/^https?:\/\//, "")}</div>
    </div>
  );
}
