import { db } from "@/lib/db";
import { qty, date } from "@/lib/format";
import { getCompany } from "@/lib/company";
import { unitLabel, soleUnit } from "@/lib/unit";

const LABEL: Record<string, string> = { PLANNED: "Rejalashtirilgan", LOADED: "Yuklangan", ON_ROAD: "Yo'lda", DELIVERED: "Yetkazilgan", CANCELLED: "BEKOR QILINGAN" };

/** Ommaviy sahifa — mijoz QR orqali nakladnoy haqiqiyligini tekshiradi. Login shart emas. */
export default async function VerifyPage({ params }: { params: Promise<{ noteNo: string }> }) {
  const { noteNo } = await params;
  const company = await getCompany();
  const t = await db.trip.findUnique({ where: { deliveryNoteNo: noteNo }, include: { order: { include: { customer: true, items: { include: { product: true } } } }, vehicle: true } });
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <div className="text-sm text-slate-500">{company.name}</div>
        {!t ? (
          <><h1 className="mt-2 text-xl font-semibold text-red-600">Nakladnoy topilmadi</h1><p className="mt-1 text-sm">№ {noteNo} tizimda yo'q. Hujjat soxta bo'lishi mumkin.</p></>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-semibold">Nakladnoy {t.deliveryNoteNo}</h1>
            <div className={`mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium ${t.status === "CANCELLED" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{LABEL[t.status]}</div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Mijoz</dt><dd className="font-medium">{t.order.customer.name}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Mahsulot</dt><dd>{t.order.items[0]?.product.name}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Hajm</dt><dd>{qty(t.qtyM3)} {unitLabel(soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) ?? t.order.items[0]?.product.unit ?? "m3")}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Transport</dt><dd>{t.vehicle.plate}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Sana</dt><dd>{date(t.loadedAt ?? t.createdAt)}</dd></div>
            </dl>
          </>
        )}
      </div>
    </main>
  );
}
