import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { PRODUCTS } from "@/lib/seo-content/products";
import { ARTICLES } from "@/lib/seo-content/articles";
import { articlePath, productPath, type Lang } from "@/lib/seo-content/lang";

/** Mahsulot va maqola sahifalari ikki tilda — har biriga juft havola (hreflang) */
function pair(path: (l: Lang) => string, priority: number): MetadataRoute.Sitemap {
  const languages = { "uz-UZ": `${SITE_URL}${path("uz")}`, "ru-UZ": `${SITE_URL}${path("ru")}` };
  return (["uz", "ru"] as const).map((l) => ({ url: `${SITE_URL}${path(l)}`, lastModified: new Date(), changeFrequency: "monthly" as const, priority, alternates: { languages } }));
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    ...PRODUCTS.flatMap((p) => pair((l) => productPath(l, p.slug), 0.8)),
    ...pair((l) => articlePath(l), 0.6),
    ...ARTICLES.flatMap((a) => pair((l) => articlePath(l, a.slug), 0.6)),
    { url: `${SITE_URL}/maxfiylik`, lastModified: new Date("2026-09-28"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/maxfiylik/hisobni-ochirish`, lastModified: new Date("2026-09-28"), changeFrequency: "yearly", priority: 0.2 },
  ];
}
