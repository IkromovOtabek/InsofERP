import { Lock } from "lucide-react";
import { Button } from "@/components/ui";

/** 401 — sessiya tugagan yoki bekor qilingan (`notSignedIn`, lib/access-denied.ts). */
export default function Unauthorized() {
  return (
    <div className="mx-auto mt-6 max-w-lg animate-fade-up sm:mt-14">
      <div className="overflow-hidden rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
        <div className="p-6 sm:p-7">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Lock size={24} /></div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">Sessiya tugagan</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">Xavfsizlik uchun tizimdan chiqarildingiz. Qaytadan kiring.</p>
          <form action="/api/logout" method="post" className="mt-6"><Button>Qaytadan kirish</Button></form>
        </div>
      </div>
    </div>
  );
}
