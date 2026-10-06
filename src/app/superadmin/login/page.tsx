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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <AdminLoginForm eco={adminEcoEnabled()} />
      </div>
    </div>
  );
}
