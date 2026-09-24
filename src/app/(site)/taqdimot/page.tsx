import type { Metadata } from "next";
import { getCompany } from "@/lib/company";
import { Deck } from "./deck";

/**
 * Taqdimot sahifasi — INSOF.pptx ning veb ko'rinishi (23 slayd).
 * Aloqa ma'lumotlari ERP sozlamalaridan olinadi — zavod rekvizitlari o'zgarsa
 * taqdimot ham o'zi yangilanadi. Quvvat raqamlari taqdimotning o'zidan.
 */
export const metadata: Metadata = {
  title: { absolute: "INSOF TEMIR BETON — taqdimot" },
  description: "INSOF temir-beton mahsulotlari taqdimoti: ishlab chiqarish bazasi, mahsulotlar katalogi, sifat nazorati va hamkorlik shartlari.",
  openGraph: {
    title: "INSOF TEMIR BETON — taqdimot",
    description: "26 yillik tajriba, M100-M600 tovar beton, to'liq temir-beton nomenklaturasi.",
    images: ["/taqdimot/ombor.jpg"],
    locale: "uz_UZ",
  },
};

export default async function TaqdimotPage() {
  const c = await getCompany();

  return (
    <Deck
      company={{
        phone: c.phone?.trim() || null,
        phone2: c.phone2?.trim() || null,
        email: c.email?.trim() || null,
        address: c.address?.trim() || null,
      }}
    />
  );
}
