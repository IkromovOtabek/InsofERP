import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { qty, date, dateTime } from "@/lib/format";
import { getCompany } from "@/lib/company";
import { unitLabel, soleUnit } from "@/lib/unit";
import { tripLine } from "@/lib/trips";

const LABEL: Record<string, string> = { PLANNED: "Hali yetkazilmagan (rejada)", LOADED: "Hali yetkazilmagan (yuklangan)", ON_ROAD: "Hali yetkazilmagan (yo'lda)", DELIVERED: "Yetkazilgan", CANCELLED: "BEKOR QILINGAN" };
const TONE: Record<string, string> = { DELIVERED: "bg-emerald-50 text-emerald-700", CANCELLED: "bg-red-50 text-red-700" };

/** "Toshkent Qurilish MChJ" → "Tosh*** Q*** M***" — eski (kalitsiz) QR'da mijoz nomi to'liq ochilmaydi. */
function maskName(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w, i) => (i === 0 ? `${w.slice(0, Math.min(4, Math.max(1, w.length - 2)))}***` : `${w[0]}***`)).join(" ");
}

/**
 * Ommaviy sahifa — mijoz QR orqali nakladnoy haqiqiyligini tekshiradi. Login shart emas.
 *
 * Nakladnoy raqami ketma-ket (N-000123), shuning uchun raqamning o'zi kalit bo'lolmaydi: yangi
 * reyslarda QR havolasida tasodifiy kalit (`?k=`) bor va u mos kelmasa — "topilmadi" (raqam
 * mavjudligi ham oshkor qilinmaydi). Kalitsiz eski nakladnoylarda mijoz nomi qisman yashiriladi.
 */
export default async function VerifyPage({ params, searchParams }: { params: Promise<{ noteNo: string }>; searchParams: Promise<{ k?: string }> }) {
  const { noteNo } = await params;
  const { k } = await searchParams;
  const company = await getCompany();
  const found = await db.trip.findUnique({ where: { deliveryNoteNo: noteNo }, include: { order: { include: { customer: true, items: { include: { product: true } } } }, vehicle: true } });
  const t = found && (!found.verifyToken || found.verifyToken === k) ? found : null;
  // Haqiqiy 404 (200 emas): skanerlar/qidiruv tizimlari "topilmadi" sahifasini mavjud hujjat deb hisoblamasin.
  // Kalit mos kelmasa ham xuddi shu javob — raqam mavjudligi oshkor bo'lmaydi (`./not-found.tsx`).
  if (!t) notFound();
  const line = t ? tripLine(t.order.items, t.vehicle.type) : null;
  const product = t && line && !("error" in line) ? t.order.items.find((i) => i.productId === line.productId)?.product : t?.order.items[0]?.product;
  const unit = unitLabel(line && !("error" in line) ? line.unit : (t ? soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) : null) ?? product?.unit ?? "m3");
  const customer = t ? (t.verifyToken ? t.order.customer.name : maskName(t.order.customer.name)) : "";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-sm text-slate-500">{company.name}</div>
        {!t ? (
          <><h1 className="mt-2 text-xl font-semibold text-red-600">Nakladnoy topilmadi</h1><p className="mt-1 text-sm">№ {noteNo} tasdiqlanmadi. QR kodni qayta skanerlang — hujjat soxta bo&apos;lishi mumkin.</p></>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-semibold">Nakladnoy {t.deliveryNoteNo}</h1>
            <div className={`mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium ${TONE[t.status] ?? "bg-amber-50 text-amber-800"}`}>{LABEL[t.status] ?? t.status}</div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Mijoz</dt><dd className="text-right font-medium">{customer}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Mahsulot</dt><dd className="text-right">{product?.name ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Yuklangan</dt><dd>{qty(t.qtyM3)} {unit}</dd></div>
              {t.status === "DELIVERED" && (
                <>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Qabul qilingan</dt><dd>{t.acceptedQty != null ? `${qty(t.acceptedQty)} ${unit}` : `${qty(t.qtyM3)} ${unit}`}</dd></div>
                  {t.returnedQty != null && Number(t.returnedQty) > 0 && <div className="flex justify-between gap-3"><dt className="text-slate-500">Qaytarilgan</dt><dd>{qty(t.returnedQty)} {unit}</dd></div>}
                  {t.deliveredAt && <div className="flex justify-between gap-3"><dt className="text-slate-500">Yetkazilgan</dt><dd>{dateTime(t.deliveredAt)}</dd></div>}
                </>
              )}
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Transport</dt><dd>{t.vehicle.plate}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{t.loadedAt ? "Yuklangan vaqti" : "Sana"}</dt><dd>{t.loadedAt ? dateTime(t.loadedAt) : date(t.createdAt)}</dd></div>
            </dl>
          </>
        )}
      </div>
    </main>
  );
}
