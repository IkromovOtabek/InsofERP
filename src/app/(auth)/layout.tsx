import type { Metadata } from "next";
import { headers } from "next/headers";
import { ScriptToggle } from "@/components/script-toggle";
import { isArendaHost } from "@/lib/arenda-host";
import { AuthBack } from "./auth-back";
import { ArendaBrandProvider } from "./brand-panel";

/** Arenda domenida sarlavha «Insof Arenda» (lib/arenda-host.ts) */
export async function generateMetadata(): Promise<Metadata> {
  return isArendaHost(await headers()) ? { title: { absolute: "Insof Arenda", template: "%s · Insof Arenda" } } : {};
}

/** Kirish, ro'yxatdan o'tish va parol tiklash sahifalari — yuqori chapda «Ortga», o'ngda yozuv almashtirgichi */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const arenda = isArendaHost(await headers());
  return (
    <ArendaBrandProvider arenda={arenda}>
      <AuthBack />
      <ScriptToggle className="fixed right-4 top-4 z-30" />
      {children}
    </ArendaBrandProvider>
  );
}
