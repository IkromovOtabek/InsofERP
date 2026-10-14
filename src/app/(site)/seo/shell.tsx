import Link from "next/link";
import { Phone } from "lucide-react";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { Logo } from "@/components/logo";
import { PRODUCTS } from "@/lib/seo-content/products";
import { articlePath, productPath, type Lang } from "@/lib/seo-content/lang";
import { LeadForm } from "../lead-form";

const UI = {
  uz: { home: "Bosh sahifa", products: "Mahsulotlar", articles: "Maqolalar", calc: "Kalkulyator", contacts: "Aloqa", leadTitle: "Obyektingizni hisoblaymiz", leadText: "Hajm va manzilni yozing — menejer narx va yetkazish muddatini aytadi.", rights: "Barcha huquqlar himoyalangan." },
  ru: { home: "Главная", products: "Продукция", articles: "Статьи", calc: "Калькулятор", contacts: "Контакты", leadTitle: "Посчитаем ваш объект", leadText: "Напишите объём и адрес — менеджер назовёт цену и срок доставки.", rights: "Все права защищены." },
};

/**
 * SEO sahifalar (mahsulot, maqola) qobig'i: ixcham tepa panel, til almashtirgich (juft sahifaga),
 * pastda ariza formasi (`#ariza`) — bosh sahifadagi forma bilan bir xil (`submitLead`, UTM bilan).
 */
export async function SeoShell({ lang, alt, children }: { lang: Lang; alt: string; children: React.ReactNode }) {
  const [company, products] = await Promise.all([
    getCompany(),
    db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }),
  ]);
  const t = UI[lang];
  const phone = company.phone?.trim() || null;
  // Ildiz <html lang="uz"> — ruscha sahifa matni to'g'ri til bilan belgilansin (qidiruv, ekran o'quvchi)
  return (
    <div lang={lang}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-insof-900/95 text-white backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label={company.name} className="shrink-0"><Logo className="h-8" tagline={false} /></Link>
          <nav className="hidden items-center gap-6 text-sm text-white/70 md:flex">
            <Link href="/#mahsulotlar" className="hover:text-white">{t.products}</Link>
            <Link href={articlePath(lang)} className="hover:text-white">{t.articles}</Link>
            <Link href="/#kalkulyator" className="hover:text-white">{t.calc}</Link>
            <Link href="/#aloqa" className="hover:text-white">{t.contacts}</Link>
          </nav>
          <div className="flex items-center gap-3">
            <div className="flex rounded-full p-0.5 font-mono text-[11px] ring-1 ring-white/20">
              {(["uz", "ru"] as const).map((l) => (
                <Link key={l} href={l === lang ? "#" : alt} hrefLang={l} aria-current={l === lang ? "true" : undefined}
                  className={`rounded-full px-2.5 py-1 uppercase ${l === lang ? "bg-white text-insof-900" : "text-white/60 hover:text-white"}`}>{l}</Link>
              ))}
            </div>
            {phone && <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="hidden items-center gap-2 font-mono text-sm hover:text-signal sm:flex"><Phone size={15} className="text-signal" />{phone}</a>}
          </div>
        </div>
      </header>

      <main>{children}</main>

      <section className="bg-white py-16 lg:py-20">
        <div className="mx-auto grid max-w-[1680px] gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:px-8">
          <div>
            <h2 className="font-display text-3xl font-bold text-beton-900">{t.leadTitle}</h2>
            <p className="mt-4 text-lg text-beton-600">{t.leadText}</p>
            {phone && <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="mt-8 inline-block font-display text-3xl font-semibold text-insof-700 hover:text-signal">{phone}</a>}
          </div>
          <div id="ariza" className="scroll-mt-24 rounded-3xl bg-white p-6 ring-1 ring-beton-200 sm:p-8">
            <LeadForm products={products} />
          </div>
        </div>
      </section>

      <footer className="bg-insof-900 py-10 text-white/60">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-6 px-4 sm:px-6 lg:flex-row lg:justify-between lg:px-8">
          <div>
            <Logo className="h-8" tagline={false} />
            {company.address && <p className="mt-4 text-sm">{company.address}</p>}
          </div>
          <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            {PRODUCTS.map((p) => <li key={p.slug}><Link href={productPath(lang, p.slug)} className="hover:text-white">{p.name[lang]}</Link></li>)}
            <li><Link href={articlePath(lang)} className="hover:text-white">{t.articles}</Link></li>
          </ul>
        </div>
        <p className="mx-auto mt-8 max-w-[1680px] px-4 font-mono text-[11px] sm:px-6 lg:px-8">© {new Date().getFullYear()} {company.legalName || company.name}. {t.rights}</p>
      </footer>
    </div>
  );
}
