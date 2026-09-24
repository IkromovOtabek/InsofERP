import type { Metadata } from "next";
import { getCompany } from "@/lib/company";
import { Deck } from "./deck";
import { isLang, type Lang } from "./matn";

/**
 * Taqdimot sahifasi — INSOF.pptx ning veb ko'rinishi (23 slayd).
 * Aloqa ma'lumotlari ERP sozlamalaridan olinadi — zavod rekvizitlari o'zgarsa
 * taqdimot ham o'zi yangilanadi. Quvvat raqamlari taqdimotning o'zidan.
 *
 * Til `?lang=uz|ru|en` bilan keladi (standart — o'zbekcha); slaydlar matni
 * `matn.ts` da, tanlov ko'rgichning o'zida almashadi.
 */

type Params = { searchParams: Promise<{ lang?: string }> };

const META: Record<Lang, { title: string; description: string; og: string; locale: string }> = {
  uz: {
    title: "INSOF TEMIR BETON — taqdimot",
    description: "INSOF temir-beton mahsulotlari taqdimoti: ishlab chiqarish bazasi, mahsulotlar katalogi, sifat nazorati va hamkorlik shartlari.",
    og: "26 yillik tajriba, M100-M600 tovar beton, to'liq temir-beton nomenklaturasi.",
    locale: "uz_UZ",
  },
  ru: {
    title: "INSOF TEMIR BETON — презентация",
    description: "Презентация железобетонной продукции INSOF: производственная база, каталог продукции, контроль качества и условия сотрудничества.",
    og: "26 лет опыта, товарный бетон M100-M600, полная номенклатура ЖБИ.",
    locale: "ru_RU",
  },
  en: {
    title: "INSOF TEMIR BETON — presentation",
    description: "INSOF reinforced concrete products presentation: production base, product catalogue, quality control and partnership terms.",
    og: "26 years of experience, M100-M600 ready-mix concrete, a complete precast product range.",
    locale: "en_US",
  },
};

async function langOf({ searchParams }: Params): Promise<Lang | null> {
  const { lang } = await searchParams;
  return isLang(lang) ? lang : null;
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const m = META[(await langOf(props)) ?? "uz"];
  return {
    title: { absolute: m.title },
    description: m.description,
    openGraph: { title: m.title, description: m.og, images: ["/taqdimot/ombor.jpg"], locale: m.locale },
  };
}

export default async function TaqdimotPage(props: Params) {
  const [c, initialLang] = await Promise.all([getCompany(), langOf(props)]);

  return (
    <Deck
      initialLang={initialLang}
      company={{
        phone: c.phone?.trim() || null,
        phone2: c.phone2?.trim() || null,
        email: c.email?.trim() || null,
        address: c.address?.trim() || null,
      }}
    />
  );
}
