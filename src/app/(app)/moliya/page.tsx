import { redirect } from "next/navigation";
import { requirePage } from "@/lib/page-guard";

/** Moliya bo'limi endi faqat «Kreditlar va qarzlar» — hisobotlar (PNL, DDS, balans) Tahlil → Moliya da. */
export default async function MoliyaPage() {
  await requirePage("/moliya");
  redirect("/moliya/kreditlar");
}
