import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { qty, date, dateTime, money } from "@/lib/format";
import { tripLine } from "@/lib/trips";
import { DRUM_MAX_MIN } from "@/lib/logistics";
import { PrintButton } from "@/components/print-button";
import { BackLink } from "@/components/ui";
import { getCompany } from "@/lib/company";
import { publicOrigin } from "@/lib/public-url";
import { unitLabel } from "@/lib/unit";
import { requirePage } from "@/lib/page-guard";

/** Chop etish uchun nakladnoy: bitta A4 varaqda 2 nusxa (zavod va yuk oluvchi), o'rtada qirqish chizig'i. Brauzerda Ctrl+P → PDF. */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("/trips");
  const { id } = await params;
  const t = await db.trip.findUnique({ where: { id }, include: { order: { include: { customer: true, items: { include: { product: true } } } }, vehicle: true, driver: true } });
  if (!t) notFound();
  const company = await getCompany();
  const { origin, fromEnv } = await publicOrigin();
  // Yangi reyslarda tasodifiy kalit bilan — kalitsiz havola ochiq sahifada "topilmadi" beradi
  const verifyUrl = `${origin}/verify/${encodeURIComponent(t.deliveryNoteNo)}${t.verifyToken ? `?k=${t.verifyToken}` : ""}`;
  // Skaner ishlashi uchun QR atrofida "tinch zona" (margin) bo'lishi shart; M darajali xato tuzatish
  // qog'oz g'ijimlansa ham o'qishga yordam beradi. Ranglar qat'iy qora/oq — dark rejimga bog'liq emas.
  const qr = await QRCode.toString(verifyUrl, { type: "svg", margin: 2, width: 96, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  // Aralash zayavkada reys qatori texnika turidan (beton — mikser, dona — yuk mashina)
  const line = tripLine(t.order.items, t.vehicle.type);
  const item = ("error" in line ? undefined : t.order.items.find((i) => i.productId === line.productId)) ?? t.order.items[0];
  const sum = item ? Number(t.qtyM3) * Number(item.price) : 0;
  // Zames raqami: shu zayavka va mahsulot bo'yicha yuklashgacha quyilgan oxirgi zames (beton uchun)
  const batch = item && item.product.unit === "m3"
    ? await db.productionBatch.findFirst({ where: { cancelledAt: null, orderId: t.orderId, productId: item.productId, ...(t.loadedAt ? { date: { lte: t.loadedAt } } : {}) }, orderBy: { date: "desc" }, select: { batchNo: true, date: true } })
    : null;

  const no = t.ttn ?? t.deliveryNoteNo;
  const concrete = item?.product.unit === "m3";
  const cell = "border border-black px-1.5 py-0.5";

  // Bitta nusxa — A4 ning yarmi (print'da qat'iy balandlik: ikkinchisi doim pastki yarimda, qirqish chizig'i o'rtada)
  const copy = (label: string) => (
    <section className="flex flex-col print:h-[134mm] print:overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
        <div className="min-w-0">
          <div className="text-[15px] leading-tight font-bold">TOVAR-TRANSPORT NAKLADNOYI № {no}</div>
          <div className="mt-1 grid grid-cols-2 gap-x-6">
            <div>Sana: <b>{date(t.loadedAt ?? t.createdAt)}</b></div>
            <div>Yuklash vaqti: <b>{t.loadedAt ? dateTime(t.loadedAt) : "—"}</b></div>
            {concrete && <div>Zames №: <b>{batch?.batchNo ?? "—"}</b></div>}
            {/* Beton qaysi BRU (beton qorishma uzeli) dan olingani — reys ochilganda tanlanadi */}
            {(concrete || t.bru) && <div>BRU: <b>{t.bru ?? "—"}</b></div>}
            {t.ttn && <div>Tizim №: {t.deliveryNoteNo}</div>}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="text-right text-[10px] leading-tight text-slate-600">
            <div className="font-semibold text-black">{label}</div>
            <div className="mt-1">Tekshirish uchun<br />skanerlang</div>
          </div>
          <div className="bg-white" dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5">
        <div><span className="text-slate-600">Yuk jo&apos;natuvchi:</span> <b>{company.legalName ?? company.name}</b>{company.inn && ` (INN ${company.inn})`}{company.phone && ` · ${company.phone}`}</div>
        <div><span className="text-slate-600">Yuk oluvchi:</span> <b>{t.order.customer.name}</b>{t.order.customer.inn && ` (INN ${t.order.customer.inn})`}</div>
        <div><span className="text-slate-600">Yukni olgani joyi:</span> {t.pickupAddress ?? company.address ?? "—"}</div>
        <div><span className="text-slate-600">Yetkazish manzili:</span> {t.order.deliveryAddress}</div>
        <div><span className="text-slate-600">Transport:</span> {t.vehicle.plate}{t.vehicle.external && " (ko'chadan chaqirilgan)"}</div>
        <div><span className="text-slate-600">Haydovchi:</span> {t.driver.fullName}{t.vehicle.external && t.driver.phone && ` · ${t.driver.phone}`}</div>
        <div><span className="text-slate-600">Mijoz tel:</span> {t.order.customer.phone ?? "—"}</div>
      </div>

      <table className="mt-2 w-full border-collapse border border-black">
        <thead><tr className="bg-slate-100">
          <th className={`${cell} text-left`}>№</th>
          <th className={`${cell} text-left`}>Mahsulot</th>
          <th className={`${cell} text-left`}>Klass</th>
          <th className={`${cell} text-right`}>Miqdor, {unitLabel(item?.product.unit ?? "m3")}</th>
          <th className={`${cell} text-right`}>Narx</th>
          <th className={`${cell} text-right`}>Summa</th>
        </tr></thead>
        <tbody><tr>
          <td className={cell}>1</td>
          <td className={cell}>{item?.product.name}</td>
          <td className={cell}>{item?.product.strengthClass ?? "—"}</td>
          <td className={`${cell} text-right`}>{qty(t.qtyM3)}</td>
          <td className={`${cell} text-right`}>{item ? money(item.price) : "—"}</td>
          <td className={`${cell} text-right font-semibold`}>{money(sum)}</td>
        </tr></tbody>
      </table>

      <div className="mt-5 grid grid-cols-3 gap-6">
        {["Yukladi (zavod)", "Haydovchi", "Qabul qildi (obyekt)"].map((l) => (
          <div key={l}><div className="text-slate-600">{l}</div><div className="mt-6 border-t border-black pt-0.5 text-[10px]">F.I.O. / imzo{l.includes("Qabul") && t.receiverName ? `: ${t.receiverName}` : ""}</div></div>
        ))}
      </div>
      <div className="mt-auto pt-2 text-[9px] text-slate-500">{concrete ? `Beton yuklangan vaqtdan boshlab ${DRUM_MAX_MIN} daqiqa ichida quyilishi shart (yuklash vaqti yuqorida). ` : ""}Da&apos;volar qabul qilish paytida bildiriladi. {verifyUrl.replace(/^https?:\/\//, "")}</div>
    </section>
  );

  return (
    <div className="paper mx-auto max-w-[210mm] rounded-sm bg-white p-8 text-[11.5px] leading-snug text-black print:max-w-none print:rounded-none print:p-0 print:shadow-none">
      <style>{`@media print { @page { size: A4 portrait; margin: 8mm } aside, nav, header { display: none } body { background: #fff } }`}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={`/trips/${id}`} label="Reys" />
        <PrintButton />
      </div>
      {!fromEnv && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 print:hidden">
          QR havolasi <b>{origin}</b> ga ishora qiladi — telefon bu manzilni ocha olmasligi mumkin. <code>.env</code> da <code>APP_URL</code> ni serverning tashqi manzili (masalan, <code>http://192.168.1.10:3000</code> yoki domen) qilib bering.
        </div>
      )}
      {copy("Zavod nusxasi")}
      <div className="my-3 flex items-center gap-2 text-[10px] text-slate-400 print:my-0 print:h-[5mm]"><span className="flex-1 border-t border-dashed border-slate-400" />qirqish chizig&apos;i<span className="flex-1 border-t border-dashed border-slate-400" /></div>
      {copy("Yuk oluvchi nusxasi")}
    </div>
  );
}
