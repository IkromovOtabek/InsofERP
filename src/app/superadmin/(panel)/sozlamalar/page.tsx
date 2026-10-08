import { requireAdmin } from "@/lib/control/auth";
import { DEFAULT_UI_PREFS, type UiPrefs } from "@/lib/control/ui-prefs";
import { loadUiPrefs } from "@/lib/control/ui-prefs-db";
import { PageHeader } from "../../_ui";
import { ThemeForm } from "./theme-form";
import { PageHelp } from "../_help/help";

export const metadata = { title: "Sozlamalar" };
export const dynamic = "force-dynamic";

/** Sozlamalar → Mavzu: har admin o'zi uchun (barcha qurilmalarida) telefon ko'rinishi va rang rejimi. */
export default async function SettingsPage() {
  const me = await requireAdmin();
  let prefs: UiPrefs = DEFAULT_UI_PREFS;
  try { prefs = await loadUiPrefs(me.id); } catch { /* migratsiya qo'llanmagan */ }
  return (
    <div className="grid gap-(--gap)">
      <PageHeader title={<>Sozlamalar <PageHelp topic="page:sozlamalar" /></>} subtitle="Faqat sizning hisobingiz uchun — tanlov bazada saqlanadi va barcha qurilmalaringizda amal qiladi." />
      <ThemeForm initial={prefs} />
    </div>
  );
}
