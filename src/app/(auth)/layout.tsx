import { ScriptToggle } from "@/components/script-toggle";
import { AuthBack } from "./auth-back";

/** Kirish, ro'yxatdan o'tish va parol tiklash sahifalari — yuqori chapda «Ortga», o'ngda yozuv almashtirgichi */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthBack />
      <ScriptToggle className="fixed right-4 top-4 z-30" />
      {children}
    </>
  );
}
