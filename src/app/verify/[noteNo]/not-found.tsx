/** `/verify/[noteNo]` — nakladnoy topilmadi yoki kalit mos emas (HTTP 404). */
export default function VerifyNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-red-600">Nakladnoy topilmadi</h1>
        <p className="mt-1 text-sm">Nakladnoy tasdiqlanmadi. QR kodni qayta skanerlang — hujjat soxta bo&apos;lishi mumkin.</p>
      </div>
    </main>
  );
}
