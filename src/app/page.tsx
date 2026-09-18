import Link from "next/link";
import { Phone, MapPin, Clock, FlaskConical, Truck, QrCode, ShieldCheck, Factory, LogIn, ArrowRight, Mail, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { fmtNum, money } from "@/lib/format";

/** Ommaviy landing — mijozlar uchun. Login shart emas. */
export default async function Landing() {
  const [company, products, session, produced, delivered, customers] = await Promise.all([
    getCompany(),
    db.product.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    getSession(),
    db.productionBatch.aggregate({ where: { product: { unit: "m3" } }, _sum: { qtyM3: true } }),
    db.trip.count({ where: { status: "DELIVERED" } }),
    db.customer.count({ where: { isActive: true } }),
  ]);
  const year = new Date().getFullYear();
  const years = company.foundedYear ? year - company.foundedYear : null;
  const producedM3 = Number(produced._sum.qtyM3 ?? 0);
  const tel = company.phone?.replace(/\s/g, "");

  const stats = [
    years !== null && years > 0 ? { v: `${years}+`, l: "yil tajriba" } : null,
    producedM3 > 0 ? { v: `${fmtNum(producedM3)} m³`, l: "ishlab chiqarilgan beton" } : null,
    delivered > 0 ? { v: fmtNum(delivered), l: "yetkazilgan reys" } : null,
    customers > 0 ? { v: fmtNum(customers), l: "doimiy mijoz" } : null,
  ].filter(Boolean) as { v: string; l: string }[];

  const quality = [
    { Icon: FlaskConical, t: "Laboratoriya nazorati", d: "Har bir partiyadan kub namuna olinadi, 7 va 28 kunlik mustahkamlik sinovidan o'tkaziladi." },
    { Icon: ShieldCheck, t: "Aniq retsept", d: "Har bir marka uchun tasdiqlangan retsept, xomashyo tarozida o'lchanadi — sement tejalmaydi." },
    { Icon: Truck, t: "O'z mikserlarimiz", d: "Betonni o'z mikserlarimizda, kelishilgan vaqtda obyektga yetkazamiz. Nasos xizmati ham bor." },
    { Icon: QrCode, t: "QR-nakladnoy", d: "Har bir nakladnoyda QR kod — mijoz skanerlab hujjat haqiqiyligini o'zi tekshiradi." },
  ];
  const steps = ["Qo'ng'iroq qilasiz — marka, hajm, manzil", "Kunni va vaqtni kelishamiz", "Retsept bo'yicha tayyorlaymiz", "Mikser obyektga yetkazadi, QR-nakladnoy bilan"];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2.5 font-semibold">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-slate-950"><Factory size={18} /></div>
            {company.name}
          </div>
          <nav className="hidden items-center gap-7 text-sm text-slate-600 md:flex">
            <a href="#mahsulot" className="hover:text-slate-900">Mahsulotlar</a>
            <a href="#sifat" className="hover:text-slate-900">Sifat</a>
            <a href="#jarayon" className="hover:text-slate-900">Qanday ishlaymiz</a>
            <a href="#aloqa" className="hover:text-slate-900">Aloqa</a>
          </nav>
          <Link href={session ? "/dashboard" : "/login"} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium shadow-xs hover:bg-slate-50">
            <LogIn size={15} /> {session ? "Tizimga o'tish" : "Xodimlar uchun"}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-ink-950 text-white">
        <div className="bg-grid absolute inset-0" />
        <div className="absolute -left-40 top-10 h-[420px] w-[420px] rounded-full bg-brand-500/15 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-20 md:grid-cols-[1.2fr_1fr] md:py-28">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-brand-300"><span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> Tayyor beton ishlab chiqarish</div>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl">{company.name}</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">{company.about ?? "Sifatli tayyor beton, aniq retsept va o'z vaqtida yetkazib berish."}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              {tel && <a href={`tel:${tel}`} className="inline-flex h-12 items-center gap-2 rounded-lg bg-brand-500 px-6 font-semibold text-slate-950 shadow-(--shadow-pop) transition hover:bg-brand-400"><Phone size={18} /> {company.phone}</a>}
              <a href="#mahsulot" className="inline-flex h-12 items-center gap-2 rounded-lg border border-white/15 px-6 font-medium transition hover:bg-white/5">Markalar <ArrowRight size={18} /></a>
            </div>
          </div>
          {stats.length > 0 && (
            <div className="grid grid-cols-2 gap-3 self-center">
              {stats.map((s, i) => (
                <div key={s.l} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="text-3xl font-semibold tracking-tight text-brand-400 tabular">{s.v}</div>
                  <div className="mt-1 text-sm text-slate-300">{s.l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Mahsulotlar */}
      <section id="mahsulot" className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Mahsulotlar</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Beton markalari</h2>
          <p className="mt-3 text-slate-600">Har bir marka tasdiqlangan retsept bo'yicha tayyorlanadi. Katta hajmlar va doimiy hamkorlik uchun narx kelishiladi.</p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {products.length === 0 && <p className="text-slate-400">Markalar ro'yxati tez orada.</p>}
          {products.map((p) => (
            <div key={p.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-(--shadow-card) transition hover:-translate-y-0.5 hover:shadow-(--shadow-pop)">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-400 to-brand-600 opacity-0 transition group-hover:opacity-100" />
              <div className="text-3xl font-semibold tracking-tight">{p.code}</div>
              <div className="mt-1 text-sm text-slate-500">{p.strengthClass ? `Klass ${p.strengthClass}` : p.name}</div>
              <div className="mt-6 border-t border-slate-100 pt-4 text-sm">
                {Number(p.price) > 0 ? <><div className="text-xs text-slate-500">1 m³ dan</div><div className="text-lg font-semibold tabular">{money(p.price)}</div></> : <span className="text-slate-500">Narx: so'rov bo'yicha</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Sifat */}
      <section id="sifat" className="bg-(--background)">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Sifat</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Nima uchun bizni tanlashadi</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {quality.map(({ Icon, t, d }) => (
              <div key={t} className="flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700"><Icon size={22} /></div>
                <div><div className="font-semibold">{t}</div><p className="mt-1.5 text-sm leading-relaxed text-slate-600">{d}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Jarayon */}
      <section id="jarayon" className="mx-auto max-w-6xl px-5 py-20">
        <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Jarayon</div>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">Qanday ishlaymiz</h2>
        <ol className="mt-10 grid gap-4 md:grid-cols-4">
          {steps.map((t, i) => (
            <li key={t} className="relative rounded-2xl border border-slate-200 p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">{i + 1}</div>
              <p className="mt-4 text-sm leading-relaxed text-slate-700">{t}</p>
              {i === steps.length - 1 && <CheckCircle2 className="absolute right-5 top-5 text-emerald-500" size={20} />}
            </li>
          ))}
        </ol>
      </section>

      {/* Aloqa */}
      <section id="aloqa" className="bg-ink-950 text-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-10 md:grid-cols-[1fr_1.2fr]">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-brand-400">Aloqa</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Buyurtma berish uchun qo'ng'iroq qiling</h2>
              <p className="mt-3 text-slate-300">Marka, hajm va manzilni ayting — narx va vaqtni darhol kelishamiz.</p>
              {tel && <a href={`tel:${tel}`} className="mt-6 inline-flex h-12 items-center gap-2 rounded-lg bg-brand-500 px-6 font-semibold text-slate-950 hover:bg-brand-400"><Phone size={18} /> {company.phone}</a>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                company.phone2 && { Icon: Phone, l: "Qo'shimcha telefon", v: company.phone2 },
                company.email && { Icon: Mail, l: "E-mail", v: company.email },
                company.address && { Icon: MapPin, l: "Manzil", v: company.address },
                company.workingHours && { Icon: Clock, l: "Ish vaqti", v: company.workingHours },
              ].filter(Boolean).map((c) => { const x = c as { Icon: typeof Phone; l: string; v: string }; return (
                <div key={x.l} className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
                  <x.Icon className="mt-0.5 shrink-0 text-brand-400" size={18} />
                  <div><div className="text-xs text-slate-400">{x.l}</div><div className="mt-0.5 font-medium">{x.v}</div></div>
                </div>
              ); })}
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-5 text-xs text-slate-400">
            <div>© {year} {company.legalName ?? company.name}{company.inn && ` · INN ${company.inn}`}</div>
            <Link href="/login" className="hover:text-white">Xodimlar uchun kirish</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
