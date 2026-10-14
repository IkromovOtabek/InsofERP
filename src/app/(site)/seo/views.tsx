import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check, ChevronRight, Plus } from "lucide-react";
import { getCompany } from "@/lib/company";
import { SITE_URL } from "@/lib/site";
import { PRODUCTS, getProduct } from "@/lib/seo-content/products";
import { ARTICLES, getArticle } from "@/lib/seo-content/articles";
import { articlePath, brand, code, productPath, type L, type Lang } from "@/lib/seo-content/lang";
import { SeoShell } from "./shell";
import { SeoCalculator } from "./calculator";

const UI = {
  uz: { home: "Bosh sahifa", products: "Mahsulotlar", articles: "Maqolalar", quote: "Narxini so'rash", calc: "Kalkulyator", uses: "Qayerda ishlatiladi", faq: "Ko'p beriladigan savollar", avail: "O'lcham mavjudligi va narxini menejerdan so'rang.", more: "Batafsil", read: "daqiqa o'qish", others: "Boshqa mahsulotlar", articlesH1: "Tahlil va maslahatlar", articlesLead: "Quruvchilar so'raydigan savollarga qisqa javoblar.", articlesTitle: "Beton, plita va FBS haqida maqolalar" },
  ru: { home: "Главная", products: "Продукция", articles: "Статьи", quote: "Узнать цену", calc: "Калькулятор", uses: "Где применяют", faq: "Частые вопросы", avail: "Наличие размеров и цену уточняйте у менеджера.", more: "Подробнее", read: "мин чтения", others: "Другая продукция", articlesH1: "Разборы и советы", articlesLead: "Коротко отвечаем на то, что спрашивают прорабы и застройщики.", articlesTitle: "Статьи о бетоне, плитах и ФБС" },
};

const ld = (data: unknown) => <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
const abs = (p: string) => `${SITE_URL.replace(/\/$/, "")}${p}`;

/** Juft sahifalar uchun metadata: canonical, hreflang (uz/ru/x-default), OpenGraph */
function meta(lang: Lang, paths: L, title: string, description: string, image = "/media/zavod.jpg"): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: paths[lang], languages: { "uz-UZ": paths.uz, "ru-UZ": paths.ru, "x-default": paths.uz } },
    openGraph: { title, description, url: paths[lang], type: "website", locale: lang === "uz" ? "uz_UZ" : "ru_RU", images: [image] },
  };
}

function Crumbs({ lang, items }: { lang: Lang; items: { name: string; href?: string }[] }) {
  const all = [{ name: UI[lang].home, href: "/" }, ...items];
  return (
    <>
      <nav aria-label="breadcrumbs" className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] tracking-wider text-white/50 uppercase">
        {all.map((it, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={12} />}
            {it.href && i < all.length - 1 ? <Link href={it.href} className="hover:text-white">{it.name}</Link> : <span className="text-white/80">{it.name}</span>}
          </span>
        ))}
      </nav>
      {ld({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: all.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, ...(it.href ? { item: abs(it.href) } : {}) })) })}
    </>
  );
}

function Hero({ lang, crumbs, eyebrow, title, lead, children }: { lang: Lang; crumbs: { name: string; href?: string }[]; eyebrow?: string; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <section className="grain relative isolate overflow-hidden bg-insof-900 pt-10 pb-14 text-white lg:pt-14 lg:pb-20">
      <div className="blueprint absolute inset-0 opacity-30" aria-hidden />
      <div className="relative mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
        <Crumbs lang={lang} items={crumbs} />
        <div className="mt-8 max-w-4xl">
          {eyebrow && <p className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.16em] text-white/70 uppercase"><span className="h-1.5 w-1.5 rounded-full bg-signal" />{eyebrow}</p>}
          <h1 className="mt-4 font-display text-4xl leading-[1.05] font-bold text-balance sm:text-5xl lg:text-6xl">{title}</h1>
          {lead && <p className="mt-6 max-w-2xl text-lg text-white/70">{lead}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function Faq({ lang, items }: { lang: Lang; items: { q: L; a: L }[] }) {
  return (
    <section className="py-16 lg:py-20">
      <div className="mx-auto grid max-w-[1680px] gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_2fr] lg:px-8">
        <h2 className="font-display text-3xl font-bold">{UI[lang].faq}</h2>
        <div className="divide-y divide-beton-200 border-y border-beton-200">
          {items.map((it, i) => (
            <details key={i} className="group py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-lg font-semibold">
                {it.q[lang]}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-beton-300 transition group-open:rotate-45 group-open:bg-insof-600 group-open:text-white"><Plus size={16} /></span>
              </summary>
              <p className="pr-14 pb-5 leading-relaxed text-beton-600">{it.a[lang]}</p>
            </details>
          ))}
        </div>
      </div>
      {ld({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((it) => ({ "@type": "Question", name: it.q[lang], acceptedAnswer: { "@type": "Answer", text: it.a[lang] } })) })}
    </section>
  );
}

/* ───────── Mahsulot ───────── */

export const productParams = () => PRODUCTS.map((p) => ({ slug: p.slug }));

export async function productMeta(lang: Lang, slug: string): Promise<Metadata> {
  const p = getProduct(slug);
  if (!p) return {};
  const name = (await getCompany()).name;
  return meta(lang, { uz: productPath("uz", slug), ru: productPath("ru", slug) }, brand(p.title[lang], name), brand(p.description[lang], name), p.image);
}

export async function ProductPage({ lang, slug }: { lang: Lang; slug: string }) {
  const p = getProduct(slug);
  if (!p) notFound();
  const t = UI[lang];
  const name = (await getCompany()).name;
  const calcTab = p.slug === "fbs-bloki" ? "fbs" : p.slug === "plity-perekrytiya" ? "pk" : p.slug === "beton" ? "beton" : null;
  const related = ARTICLES.filter((a) => a.product === p.slug);

  return (
    <SeoShell lang={lang} alt={productPath(lang === "uz" ? "ru" : "uz", slug)}>
      <Hero lang={lang} crumbs={[{ name: t.products, href: "/#mahsulotlar" }, { name: p.name[lang] }]} eyebrow={code(lang, p.code)} title={p.h1[lang]} lead={brand(p.intro[lang], name)}>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href="#ariza" className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-signal px-6 font-semibold text-white hover:bg-signal-600">{t.quote} <ArrowRight size={16} /></a>
          {calcTab && <a href="#kalkulyator" className="inline-flex h-12 items-center justify-center rounded-full px-6 ring-1 ring-white/30 hover:bg-white/10">{t.calc}</a>}
        </div>
        <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-white/10 ring-1 ring-white/10 lg:grid-cols-4">
          {p.facts.map((f, i) => (
            <div key={i} className="bg-insof-900/80 p-5">
              <dt className="sr-only">{f.label[lang]}</dt>
              <dd><span className="block font-display text-2xl font-bold text-signal">{code(lang, f.value)}</span><span className="mt-1 block text-sm text-white/60">{f.label[lang]}</span></dd>
            </div>
          ))}
        </dl>
      </Hero>

      <section className="py-16 lg:py-20">
        <div className="mx-auto grid max-w-[1680px] gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:px-8">
          <div className="min-w-0">
            {p.table && (
              <>
                <h2 className="font-display text-2xl font-bold sm:text-3xl">{p.table.caption[lang]}</h2>
                <div className="mt-6 overflow-x-auto rounded-3xl bg-white ring-1 ring-beton-200">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead><tr className="border-b border-beton-200 font-mono text-[11px] tracking-[0.12em] text-beton-500 uppercase">{p.table.head[lang].map((h) => <th key={h} className="px-5 py-3.5 font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {p.table.rows.map((r, i) => (
                        <tr key={i} className="border-b border-beton-100 last:border-0">
                          {r.map((c, j) => <td key={j} className={j === 0 ? "px-5 py-3.5 font-mono font-semibold text-insof-700" : "px-5 py-3.5 text-beton-700"}>{typeof c === "string" ? code(lang, c) : c[lang]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-sm text-beton-500">{t.avail}</p>
              </>
            )}
            <h2 className={`font-display text-2xl font-bold sm:text-3xl ${p.table ? "mt-12" : ""}`}>{t.uses}</h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {p.uses[lang].map((u) => <li key={u} className="flex items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-beton-200"><Check size={18} className="mt-0.5 shrink-0 text-insof-600" />{u}</li>)}
            </ul>
          </div>
          <figure className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-insof-900 lg:sticky lg:top-24">
            <Image src={p.image} alt={p.h1[lang]} fill sizes="(min-width:1024px) 45vw, 100vw" className="object-cover" />
          </figure>
        </div>
      </section>

      {calcTab && (
        <section id="kalkulyator" className="scroll-mt-20 bg-beton-100 py-16 lg:py-20">
          <div className="mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
            <h2 className="mb-8 font-display text-3xl font-bold">{t.calc}</h2>
            <SeoCalculator lang={lang} initial={calcTab} />
          </div>
        </section>
      )}

      <Faq lang={lang} items={p.faq.map((f) => ({ q: f.q, a: { uz: brand(f.a.uz, name), ru: brand(f.a.ru, name) } }))} />

      {related.map((a) => (
        <div key={a.slug} className="mx-auto max-w-[1680px] px-4 pb-10 sm:px-6 lg:px-8">
          <Link href={articlePath(lang, a.slug)} className="group flex items-center justify-between gap-6 rounded-3xl bg-insof-600 p-7 text-white transition hover:bg-insof-900">
            <span><span className="font-mono text-xs text-white/60">{t.articles} · {a.minutes} {t.read}</span><span className="mt-2 block font-display text-xl font-semibold sm:text-2xl">{a.title[lang]}</span></span>
            <ArrowRight size={26} className="shrink-0 transition group-hover:translate-x-1" />
          </Link>
        </div>
      ))}

      <section className="pb-16">
        <div className="mx-auto max-w-[1680px] px-4 sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl font-bold">{t.others}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PRODUCTS.filter((x) => x.slug !== p.slug).map((x) => (
              <Link key={x.slug} href={productPath(lang, x.slug)} className="group rounded-3xl bg-white p-6 ring-1 ring-beton-200 transition hover:-translate-y-1 hover:ring-insof-500">
                <span className="font-mono text-xs text-insof-600">{code(lang, x.code)}</span>
                <span className="mt-2 block font-display text-lg font-semibold">{x.name[lang]}</span>
                <span className="mt-2 block text-sm text-beton-600">{brand(x.short[lang], name)}</span>
                <ArrowUpRight size={20} className="mt-4 text-beton-400 transition group-hover:rotate-45 group-hover:text-insof-600" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {ld({ "@context": "https://schema.org", "@type": "Product", name: p.h1[lang], description: brand(p.description[lang], name), image: abs(p.image), brand: { "@type": "Brand", name }, url: abs(productPath(lang, p.slug)) })}
    </SeoShell>
  );
}

/* ───────── Maqolalar ───────── */

export const articleParams = () => ARTICLES.map((a) => ({ slug: a.slug }));

export async function articlesMeta(lang: Lang): Promise<Metadata> {
  const name = (await getCompany()).name;
  return meta(lang, { uz: articlePath("uz"), ru: articlePath("ru") }, `${UI[lang].articlesTitle} | ${name}`, UI[lang].articlesLead);
}

export async function ArticlesPage({ lang }: { lang: Lang }) {
  const t = UI[lang];
  return (
    <SeoShell lang={lang} alt={articlePath(lang === "uz" ? "ru" : "uz")}>
      <Hero lang={lang} crumbs={[{ name: t.articles }]} eyebrow={t.articles} title={t.articlesH1} lead={t.articlesLead} />
      <section className="py-16">
        <div className="mx-auto grid max-w-[1680px] gap-4 px-4 sm:px-6 md:grid-cols-2 lg:grid-cols-3 lg:px-8">
          {ARTICLES.map((a) => (
            <Link key={a.slug} href={articlePath(lang, a.slug)} className="group flex min-h-64 flex-col justify-between rounded-3xl bg-white p-7 ring-1 ring-beton-200 transition hover:-translate-y-1 hover:ring-insof-500">
              <span>
                <span className="font-mono text-xs text-insof-600">{a.minutes} {t.read}</span>
                <span className="mt-3 block font-display text-xl leading-snug font-semibold">{a.title[lang]}</span>
                <span className="mt-3 block text-beton-600">{a.description[lang]}</span>
              </span>
              <ArrowUpRight size={22} className="mt-6 text-beton-400 transition group-hover:rotate-45 group-hover:text-insof-600" />
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}

export async function articleMeta(lang: Lang, slug: string): Promise<Metadata> {
  const a = getArticle(slug);
  if (!a) return {};
  const name = (await getCompany()).name;
  return meta(lang, { uz: articlePath("uz", slug), ru: articlePath("ru", slug) }, `${a.title[lang]} | ${name}`, a.description[lang]);
}

export async function ArticlePage({ lang, slug }: { lang: Lang; slug: string }) {
  const a = getArticle(slug);
  if (!a) notFound();
  const t = UI[lang];
  const name = (await getCompany()).name;
  const p = getProduct(a.product)!;
  return (
    <SeoShell lang={lang} alt={articlePath(lang === "uz" ? "ru" : "uz", slug)}>
      <Hero lang={lang} crumbs={[{ name: t.articles, href: articlePath(lang) }, { name: a.title[lang] }]} eyebrow={`${a.minutes} ${t.read}`} title={a.title[lang]} lead={a.description[lang]} />
      <article className="py-16">
        <div className="mx-auto grid max-w-[1680px] gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_320px] lg:px-8">
          <div className="max-w-2xl text-lg leading-relaxed text-beton-800">
            {a.body[lang].map((b, i) =>
              "h2" in b ? <h2 key={i} className="mt-10 mb-3 font-display text-2xl font-bold text-beton-900 first:mt-0">{b.h2}</h2>
              : "ul" in b ? <ul key={i} className="my-5 space-y-2">{b.ul.map((x) => <li key={x} className="flex gap-3"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-insof-600" />{brand(x, name)}</li>)}</ul>
              : <p key={i} className="my-5">{brand(b.p, name)}</p>,
            )}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <Link href={productPath(lang, p.slug)} className="block rounded-3xl bg-insof-900 p-7 text-white transition hover:bg-insof-700">
              <span className="font-mono text-xs text-signal">{code(lang, p.code)}</span>
              <span className="mt-2 block font-display text-xl font-semibold">{p.name[lang]}</span>
              <span className="mt-2 block text-sm text-white/60">{brand(p.short[lang], name)}</span>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">{t.more} <ArrowRight size={15} /></span>
            </Link>
          </aside>
        </div>
      </article>
      {ld({ "@context": "https://schema.org", "@type": "Article", headline: a.title[lang], description: a.description[lang], datePublished: a.date, inLanguage: lang, author: { "@type": "Organization", name }, mainEntityOfPage: abs(articlePath(lang, slug)) })}
    </SeoShell>
  );
}
