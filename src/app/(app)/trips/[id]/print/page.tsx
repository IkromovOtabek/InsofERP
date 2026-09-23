import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { qty, date, money } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { getCompany } from "@/lib/company";
import { publicOrigin } from "@/lib/public-url";

/** Chop etish uchun nakladnoy (A5 landshaft / A4 yarim). Brauzerda Ctrl+P → PDF. */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await db.trip.findUnique({ where: { id }, include: { order: { include: { customer: true, items: { include: { product: true } } } }, vehicle: true, driver: true } });
  if (!t) notFound();
  const company = await getCompany();
  const { origin, fromEnv } = await publicOrigin();
  const verifyUrl = `${origin}/verify/${encodeURIComponent(t.deliveryNoteNo)}`;
  // Skaner ishlashi uchun QR atrofida "tinch zona" (margin) bo'lishi shart; M darajali xato tuzatish
  // qog'oz g'ijimlansa ham o'qishga yordam beradi. Ranglar qat'iy qora/oq — dark rejimga bog'liq emas.
  const qr = await QRCode.toString(verifyUrl, { type: "svg", margin: 2, width: 128, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  const item = t.order.items[0];
  const sum = item ? Number(t.qtyM3) * Number(item.price) : 0;

  return (
    <div className="paper mx-auto max-w-3xl rounded-sm bg-white p-8 text-[13px] text-black print:max-w-none print:rounded-none print:p-4 print:shadow-none">
      <style>{`@media print { @page { size: A4; margin: 12mm } aside, nav { display: none } body { background: #fff } }`}</style>
      {!fromEnv && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:hidden">
          QR havolasi <b>{origin}</b> ga ishora qiladi — telefon bu manzilni ocha olmasligi mumkin. <code>.env</code> da <code>APP_URL</code> ni serverning tashqi manzili (masalan, <code>http://192.168.1.10:3000</code> yoki domen) qilib bering.
        </div>
      )}
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <div className="text-xl font-bold">TOVAR-TRANSPORT NAKLADNOYI</div>
          <div className="text-lg font-semibold">№ {t.deliveryNoteNo}</div>
          <div className="mt-1">Sana: {date(t.loadedAt ?? t.createdAt)} · Zayavka {t.order.orderNo}</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="bg-white" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="mt-1 text-[10px] text-slate-600">Tekshirish uchun skanerlang</div>
          <div className="text-[9px] text-slate-500">{verifyUrl.replace(/^https?:\/\//, "")}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1">
        <div><span className="text-slate-600">Yuk jo'natuvchi:</span> <b>{company.legalName ?? company.name}</b>{company.inn && ` (INN ${company.inn})`}{company.phone && ` · ${company.phone}`}</div>
        <div><span className="text-slate-600">Yuk oluvchi:</span> <b>{t.order.customer.name}</b>{t.order.customer.inn && ` (INN ${t.order.customer.inn})`}</div>
        <div><span className="text-slate-600">Yukni olgani joyi:</span> {t.pickupAddress ?? company.address ?? "—"}</div>
        <div><span className="text-slate-600">Yetkazish manzili:</span> {t.order.deliveryAddress}</div>
        <div><span className="text-slate-600">Transport:</span> {t.vehicle.plate}</div>
        <div><span className="text-slate-600">Haydovchi:</span> {t.driver.fullName}</div>
        <div><span className="text-slate-600">Mijoz tel:</span> {t.order.customer.phone ?? "—"}</div>
      </div>

      <table className="mt-5 w-full border-collapse border border-black">
        <thead><tr className="bg-slate-100">
          <th className="border border-black px-2 py-1 text-left">№</th>
          <th className="border border-black px-2 py-1 text-left">Mahsulot</th>
          <th className="border border-black px-2 py-1 text-left">Klass</th>
          <th className="border border-black px-2 py-1 text-right">Miqdor, m³</th>
          <th className="border border-black px-2 py-1 text-right">Narx</th>
          <th className="border border-black px-2 py-1 text-right">Summa</th>
        </tr></thead>
        <tbody><tr>
          <td className="border border-black px-2 py-1">1</td>
          <td className="border border-black px-2 py-1">{item?.product.name}</td>
          <td className="border border-black px-2 py-1">{item?.product.strengthClass ?? "—"}</td>
          <td className="border border-black px-2 py-1 text-right">{qty(t.qtyM3)}</td>
          <td className="border border-black px-2 py-1 text-right">{item ? money(item.price) : "—"}</td>
          <td className="border border-black px-2 py-1 text-right font-semibold">{money(sum)}</td>
        </tr></tbody>
      </table>

      <div className="mt-8 grid grid-cols-3 gap-6">
        {["Yukladi (zavod)", "Haydovchi", "Qabul qildi (obyekt)"].map((l) => (
          <div key={l}><div className="text-slate-600">{l}</div><div className="mt-8 border-t border-black pt-1 text-[11px]">F.I.O. / imzo{l.includes("Qabul") && t.receiverName ? `: ${t.receiverName}` : ""}</div></div>
        ))}
      </div>
      <div className="mt-6 text-[10px] text-slate-500">Beton yetkazilgandan keyin 2 soat ichida ishlatilishi shart. Da'volar qabul qilish paytida bildiriladi.</div>
      <div className="mt-6 flex justify-end print:hidden"><PrintButton /></div>
    </div>
  );
}
