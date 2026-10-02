import Link from "next/link";
import { SearchX } from "lucide-react";
import { LogoMark } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-(--background) p-6 text-center">
      <LogoMark className="mb-8 h-10 w-10" />
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <SearchX size={28} />
      </div>
      <div className="mt-4 font-mono text-sm font-semibold tracking-widest text-brand-700">404</div>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">Sahifa topilmadi</h1>
      <p className="mt-2 max-w-sm text-[15px] text-slate-600">Bunday manzil tizimda yo&apos;q yoki o&apos;chirilgan. Manzilni tekshiring yoki bosh sahifadan qayta kiring.</p>
      <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-lg bg-slate-900 px-5 text-sm font-medium text-white transition hover:bg-slate-800">Bosh sahifaga</Link>
    </main>
  );
}
