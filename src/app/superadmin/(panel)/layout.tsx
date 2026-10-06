import os from "node:os";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/control/auth";
import { DEFAULT_UI_PREFS, type UiPrefs } from "@/lib/control/ui-prefs";
import { loadUiPrefs } from "@/lib/control/ui-prefs-db";
import { LiveMonitorProvider } from "./_monitor/live";
import { PanelNav, PanelShell, PanelTabBar, PanelTop } from "./_monitor/nav";

// Rejim (INSOF_MODE) va sessiya ishga tushganda aniqlanadi — build vaqtida statik qotib qolmasin
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { default: "IT panel", template: "%s · IT panel" }, robots: { index: false, follow: false } };

/**
 * Markaziy panel qobig'i — faqat INSOF_MODE=control jarayonida va superadmin sessiyasi bilan.
 * Monitoring jonli oqimi (SSE) shu yerda bitta ochiladi — menyu va barcha sahifalar bo'lishadi.
 * Kompyuter: «Status Board» (ikonli tor yon menyu + katta soatli shapka). Telefon (≤ 760px): admin prefs'i bo'yicha
 * «Vidjetlar» (shapka + pastki dock) yoki «Zich Pro» (host/LIVE/soat + segment), Sozlamalar → Mavzu.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const a = await requireAdmin();
  let prefs: UiPrefs = DEFAULT_UI_PREFS;
  try { prefs = await loadUiPrefs(a.id); } catch { /* migratsiya qo'llanmagan — standart */ }
  return (
    <LiveMonitorProvider>
      <PanelShell prefs={prefs}>
        <div className="sa-app">
          <PanelNav />
          <div className="sa-main">
            <PanelTop fullName={a.fullName} login={a.login} hostname={os.hostname()} />
            <main id="sa-main" className="sa-content">{children}</main>
          </div>
        </div>
        <PanelTabBar />
      </PanelShell>
    </LiveMonitorProvider>
  );
}
