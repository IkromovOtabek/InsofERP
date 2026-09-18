import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
      <SearchX size={40} className="text-slate-400" />
      <h1 className="text-2xl font-semibold">Sahifa topilmadi</h1>
      <p className="text-sm text-slate-500">Bunday manzil tizimda yo'q yoki o'chirilgan.</p>
      <Link href="/" className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Bosh sahifaga</Link>
    </main>
  );
}
