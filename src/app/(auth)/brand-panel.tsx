import { ShieldCheck, Truck, FlaskConical } from "lucide-react";
import { Logo } from "@/components/logo";

/** Kirish va parol tiklash sahifalaridagi chap panel — ikkalasida bir xil. */
export function BrandPanel() {
  return (
    <section className="on-dark relative hidden overflow-hidden bg-ink-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="bg-grid absolute inset-0" />
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative">
        <Logo className="h-14" />
      </div>
      <div className="relative max-w-md">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight">Zayavkadan to&apos;lovgacha — bitta tizimda</h1>
        <p className="mt-4 text-slate-300">Sotuv, ishlab chiqarish, sklad, logistika va moliya bir-biri bilan gaplashadi. Ma&apos;lumot bir marta kiritiladi.</p>
        <ul className="mt-8 space-y-3 text-sm text-slate-300">
          <li className="flex items-center gap-3"><ShieldCheck size={18} className="text-brand-400" /> Kredit limit va ruxsatlar nazorati</li>
          <li className="flex items-center gap-3"><FlaskConical size={18} className="text-brand-400" /> Retsept bo&apos;yicha avtomatik xomashyo hisobi</li>
          <li className="flex items-center gap-3"><Truck size={18} className="text-brand-400" /> QR-nakladnoy va reyslar kuzatuvi</li>
        </ul>
      </div>
      <div className="relative text-xs text-slate-500">© {new Date().getFullYear()} Insof ERP</div>
    </section>
  );
}
