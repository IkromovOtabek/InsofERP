import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAdmin } from "@/lib/control/auth";
import { adminEcoEnabled } from "@/lib/control/eco-login";
import { AdminLoginForm } from "./login-form";

// Rejim (INSOF_MODE) va sessiya ishga tushganda aniqlanadi — build vaqtida statik qotib qolmasin
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "IT panel", robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  if (process.env.INSOF_MODE !== "control") redirect("/");
  if (await getAdmin()) redirect("/superadmin");
  return (
    <main className="sa-login">
      <div className="sa-login-box">
        <div className="sa-login-status">
          <span className="flex items-center gap-3">
            <span className="sa-mark" style={{ margin: 0, background: "var(--accent)", color: "var(--accent-fg)" }} aria-hidden>I</span>
            <span><b className="block text-lg leading-tight">Insof platforma</b><span className="sa-sub">IT panel</span></span>
          </span>
          <span className="sa-pill"><span className="sa-dot" aria-hidden /> Kirish kerak</span>
        </div>
        <div className="sa-card" style={{ padding: 22 }}>
          <AdminLoginForm eco={adminEcoEnabled()} />
        </div>
      </div>
    </main>
  );
}
