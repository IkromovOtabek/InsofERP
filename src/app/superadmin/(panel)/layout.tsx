import os from "node:os";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/control/auth";
import { LiveMonitorProvider } from "./_monitor/live";
import { PanelNav, PanelTabBar, PanelTop } from "./_monitor/nav";

// Rejim (INSOF_MODE) va sessiya ishga tushganda aniqlanadi — build vaqtida statik qotib qolmasin
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { default: "IT panel", template: "%s · IT panel" }, robots: { index: false, follow: false } };

/**
 * Markaziy panel qobig'i — faqat INSOF_MODE=control jarayonida va superadmin sessiyasi bilan.
 * Monitoring jonli oqimi (SSE) shu yerda bitta ochiladi — menyu va barcha sahifalar bo'lishadi.
 * «Status Board»: kompyuterda ikonli tor yon menyu + katta soatli shapka; telefonda (≤ 760px) pastki tab bar.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const a = await requireAdmin();
  return (
    <LiveMonitorProvider>
      <div className="sa-app">
        <PanelNav />
        <div className="sa-main">
          <PanelTop fullName={a.fullName} login={a.login} hostname={os.hostname()} />
          <main id="sa-main" className="sa-content">{children}</main>
        </div>
      </div>
      <PanelTabBar />
    </LiveMonitorProvider>
  );
}
