import { Home, Lock } from "lucide-react";
import { LinkButton } from "@/components/ui";

/**
 * 403 — ruxsat yo'q (`AccessDenied`, lib/access-denied.ts). Masalan, kassir zayavka ochish amalini, sklad
 * kirimni storno qilishni chaqirsa. Ilgari bu holat 500 "kutilmagan xatolik" sahifasi bo'lib ko'rinardi.
 */
export default function Forbidden() {
  return (
    <div className="mx-auto mt-6 max-w-lg animate-fade-up sm:mt-14">
      <div className="overflow-hidden rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
        <div aria-hidden className="h-1.5 bg-[repeating-linear-gradient(-45deg,var(--color-brand-500)_0_10px,#111418_10px_20px)]" />
        <div className="p-6 sm:p-7">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Lock size={24} /></div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">Ruxsat yo&apos;q</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
            Bu bo&apos;lim yoki amal sizning lavozimingiz uchun yopiq. Kerak bo&apos;lsa direktordan ruxsat so&apos;rang — u Sozlamalar → Ruxsatlar bo&apos;limida beradi.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <LinkButton href="/" variant="secondary"><Home size={16} /> Bosh sahifa</LinkButton>
          </div>
        </div>
      </div>
    </div>
  );
}
