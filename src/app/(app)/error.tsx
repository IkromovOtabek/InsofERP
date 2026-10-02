"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Copy, Home, Lock, RotateCcw } from "lucide-react";
import { Button, LinkButton } from "@/components/ui";

/**
 * Ilova ichidagi xato sahifasi.
 * Production build'da server xatosining `message` i yashiriladi (Next.js uni umumiy
 * inglizcha matnga almashtiradi) — shuning uchun foydalanuvchiga xom matn emas, tushunarli
 * o'zbekcha izoh va xatoning `digest` kodi ko'rsatiladi: administrator shu kod bo'yicha
 * server logidan aniq sababni topadi.
 */
const KNOWN: Record<string, { title: string; text: string; lock?: boolean }> = {
  FORBIDDEN: { title: "Ruxsat yo'q", text: "Bu bo'lim yoki amal sizning lavozimingiz uchun yopiq. Kerak bo'lsa rahbaringiz yoki administratorga murojaat qiling.", lock: true },
  UNAUTHENTICATED: { title: "Sessiya tugagan", text: "Xavfsizlik uchun tizimdan chiqarildingiz. Qaytadan kiring — kiritgan ma'lumotlaringiz saqlangan.", lock: true },
};

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const code = Object.keys(KNOWN).find((k) => error.message === k || error.message?.includes(k));
  const known = code ? KNOWN[code] : null;
  // Dev rejimida asl matn foydali — productionda u baribir yashirin
  const devMessage = process.env.NODE_ENV !== "production" && !known ? error.message : null;

  useEffect(() => { console.error(error); }, [error]);

  const copy = async () => {
    if (!error.digest) return;
    try { await navigator.clipboard.writeText(error.digest); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard yopiq bo'lishi mumkin */ }
  };

  const Icon = known?.lock ? Lock : AlertTriangle;
  return (
    <div className="mx-auto mt-6 max-w-lg animate-fade-up sm:mt-14">
      <div className="overflow-hidden rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
        {/* Ogohlantirish lentasi — xavfsizlik belgisidagi sariq-qora chiziq */}
        <div aria-hidden className="h-1.5 bg-[repeating-linear-gradient(-45deg,var(--color-brand-500)_0_10px,#111418_10px_20px)]" />
        <div className="p-6 sm:p-7">
          <div className={known?.lock ? "flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700" : "flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600"}>
            <Icon size={24} />
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">{known?.title ?? "Sahifani ochib bo'lmadi"}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
            {known?.text ?? "Tizimda kutilmagan xatolik yuz berdi. Kiritilgan ma'lumotlar saqlangan — qayta urinib ko'ring. Xato takrorlansa, quyidagi kodni administratorga yuboring."}
          </p>
          {devMessage && (
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs whitespace-pre-wrap text-red-700">{devMessage}</pre>
          )}
          {error.digest && !known && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Xato kodi</div>
                <div className="truncate font-mono text-sm text-slate-900">{error.digest}</div>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={copy} aria-label="Kodni nusxalash">
                {copied ? <><Check size={14} /> Nusxalandi</> : <><Copy size={14} /> Nusxalash</>}
              </Button>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            {code === "UNAUTHENTICATED" ? (
              <form action="/api/logout" method="post"><Button>Qaytadan kirish</Button></form>
            ) : !known && (
              <Button type="button" onClick={() => reset()}><RotateCcw size={16} /> Qayta urinish</Button>
            )}
            <Button type="button" variant="secondary" onClick={() => router.back()}><ArrowLeft size={16} /> Orqaga</Button>
            <LinkButton href="/" variant="ghost"><Home size={16} /> Bosh sahifa</LinkButton>
          </div>
        </div>
      </div>
    </div>
  );
}
