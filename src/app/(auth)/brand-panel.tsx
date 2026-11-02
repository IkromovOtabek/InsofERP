"use client";

import { createContext, useContext } from "react";
import { BellRing, FileText, FlaskConical, ShieldCheck, Store, Truck } from "lucide-react";
import { Logo } from "@/components/logo";

/** Arenda domeni (lib/arenda-host.ts) — kirish sahifalari «Insof Arenda» ko'rinishida. Qiymatni (auth)/layout beradi */
const ArendaBrand = createContext(false);

export function ArendaBrandProvider({ arenda, children }: { arenda: boolean; children: React.ReactNode }) {
  return <ArendaBrand.Provider value={arenda}>{children}</ArendaBrand.Provider>;
}

export const useArendaBrand = () => useContext(ArendaBrand);

const ERP_TEXT = {
  title: "Zayavkadan to'lovgacha — bitta tizimda",
  lead: "Sotuv, ishlab chiqarish, sklad, logistika va moliya bir-biri bilan gaplashadi. Ma'lumot bir marta kiritiladi.",
  points: [
    { icon: ShieldCheck, text: "Kredit limit va ruxsatlar nazorati" },
    { icon: FlaskConical, text: "Retsept bo'yicha avtomatik xomashyo hisobi" },
    { icon: Truck, text: "QR-nakladnoy va reyslar kuzatuvi" },
  ],
  product: "Insof ERP",
};

const ARENDA_TEXT = {
  title: "Ijara hisobi — bitta kabinetda",
  lead: "Do'konlar, shartnomalar, oylik hisob, to'lovlar va svet. Excel jadvallarisiz, qarzdorlar o'zi ko'rinadi.",
  points: [
    { icon: Store, text: "Do'konlar, ijarachilar va bo'sh joylar" },
    { icon: FileText, text: "Shartnoma, QR kvitansiya va akt-sverka" },
    { icon: BellRing, text: "Qarzdorlarga Telegram orqali eslatma" },
  ],
  product: "Insof Arenda",
};

/** Kirish va parol tiklash sahifalaridagi chap panel — ikkalasida bir xil. */
export function BrandPanel() {
  const t = useArendaBrand() ? ARENDA_TEXT : ERP_TEXT;
  return (
    <section className="on-dark relative hidden overflow-hidden bg-ink-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="bg-grid absolute inset-0" />
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative">
        <Logo className="h-14" />
      </div>
      <div className="relative max-w-md">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight">{t.title}</h1>
        <p className="mt-4 text-slate-300">{t.lead}</p>
        <ul className="mt-8 space-y-3 text-sm text-slate-300">
          {t.points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3"><Icon size={18} className="text-brand-400" /> {text}</li>
          ))}
        </ul>
      </div>
      <div className="relative text-xs text-slate-500">© {new Date().getFullYear()} {t.product}</div>
    </section>
  );
}
