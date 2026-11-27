import { redirect } from "next/navigation";
import { requirePage } from "@/lib/page-guard";

/** «Bugun» ekrani 3-bosqichda — hozircha Mijozlar ro'yxati. */
export default async function CrmHome() {
  await requirePage("/crm");
  redirect("/crm/mijozlar");
}
