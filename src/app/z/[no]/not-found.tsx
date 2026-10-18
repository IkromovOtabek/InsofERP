import { ShieldAlert } from "lucide-react";

/** `/z/[no]` — zayavka topilmadi yoki kalit mos emas (HTTP 404). Raqam mavjudligi oshkor qilinmaydi. */
export default function OrderNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-red-600"><ShieldAlert size={22} /><h1 className="text-xl font-semibold">Hujjat tasdiqlanmadi</h1></div>
        <p className="mt-2 text-sm text-slate-700">Zayavka topilmadi. QR kodni qayta skanerlang yoki havolani to&apos;liq oching — hujjat soxta bo&apos;lishi mumkin.</p>
        <p className="mt-2 text-sm text-slate-500">Заявка не найдена. Отсканируйте QR-код ещё раз — документ может быть поддельным.</p>
      </div>
    </main>
  );
}
