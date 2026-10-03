import { ScriptToggle } from "@/components/script-toggle";

/** Kirish, ro'yxatdan o'tish va parol tiklash sahifalari — yuqori o'ngda yozuv almashtirgichi */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ScriptToggle className="fixed right-4 top-4 z-30" />
      {children}
    </>
  );
}
