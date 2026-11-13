"use client";

import { useState, useTransition } from "react";
import { Merge, Search, TriangleAlert } from "lucide-react";
import { Badge, Button, FormError, Input } from "@/components/ui";
import { ConfirmButton } from "../../payments/confirm-button";
import { findMergeTargets, mergeCustomerAction, previewCustomerMerge } from "../merge-actions";
import type { MergePreview, MergeTarget } from "@/lib/customer-merge";

/**
 * Mijoz kartasidagi «Boshqa mijozga birlashtirish» (faqat direktor): takror kartani asosiy kartaga qo'shish.
 * Izlash → maqsadni tanlash → nima ko'chishini ko'rish → sabab bilan tasdiqlash. Manba karta o'chadi, shuning uchun
 * muvaffaqiyatdan keyin maqsad kartasiga o'tiladi. Qoida — `lib/customer-merge.ts`.
 */
export function MergePanel({ sourceId, sourceName }: { sourceId: string; sourceName: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MergeTarget[] | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [loading, startPreview] = useTransition();

  const search = () => startSearch(async () => {
    setError(null); setPreview(null);
    if (q.trim().length < 2) { setItems(null); setError("Kamida 2 ta belgi yozing"); return; }
    try { setItems(await findMergeTargets(sourceId, q)); } catch { setError("Izlab bo'lmadi — sahifani yangilab qayta urining"); }
  });

  const pick = (t: MergeTarget) => startPreview(async () => {
    setError(null);
    try { setPreview(await previewCustomerMerge(sourceId, t.id)); } catch { setError("Tekshirib bo'lmadi — sahifani yangilab qayta urining"); }
  });

  return (
    <details className="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
      <summary className="cursor-pointer text-slate-600"><Merge size={14} className="mr-1.5 inline align-[-2px]" />Boshqa mijozga birlashtirish (takror karta)</summary>
      <div className="space-y-3 pt-3">
        <p className="text-slate-600">
          Takror ochilgan karta uchun: shu kartadagi zayavka, obyekt, schyot, to&apos;lov, realizatsiya, boshlang&apos;ich qoldiq, ariza va takliflar
          tanlangan mijozga ko&apos;chadi, «<span data-no-translit>{sourceName}</span>» nomi uning boshqa nomlariga qo&apos;shiladi, bu karta o&apos;chiriladi.
          Kredit limiti tanlangan mijozniki qoladi. Qaytarib bo&apos;lmaydi.
        </p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Asosiy mijoz: nomi, INN yoki telefon" maxLength={100} />
          <Button type="submit" variant="secondary" disabled={searching}><Search size={14} /> {searching ? "Izlanmoqda…" : "Izlash"}</Button>
        </form>
        <FormError error={error ?? undefined} />
        {items && items.length === 0 && <div className="text-xs text-slate-500">Topilmadi — boshqa nom, INN yoki telefon bilan izlang.</div>}
        {items && items.length > 0 && !preview && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <span className="font-medium text-slate-900" data-no-translit>{t.name}</span>
                  {!t.isActive && <span className="ml-2"><Badge color="slate">nofaol</Badge></span>}
                  <div className="text-xs text-slate-500">{[t.inn && `INN ${t.inn}`, t.phone].filter(Boolean).join(" · ") || "INN va telefon yo'q"}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => pick(t)} disabled={loading}>Tanlash</Button>
              </li>
            ))}
          </ul>
        )}
        {loading && <div className="text-xs text-slate-500">Tekshirilmoqda…</div>}
        {preview && !preview.ok && (
          <div className="space-y-2">
            <FormError error={preview.error} />
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Boshqa mijozni tanlash</Button>
          </div>
        )}
        {preview && preview.ok && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <div className="flex items-center gap-2 font-medium text-slate-900">
              <Merge size={16} className="text-amber-700" />
              <span data-no-translit>«{sourceName}»</span> → <span data-no-translit>«{preview.target.name}»</span>
            </div>
            <div className="text-xs text-slate-600">
              {[preview.target.inn && `INN ${preview.target.inn}`, preview.target.phone].filter(Boolean).join(" · ")}
              {(preview.target.inn || preview.target.phone) && " · "}Ko&apos;chadi: {preview.counts}
            </div>
            {preview.appLinked && (
              <div className="flex items-start gap-1.5 text-xs text-amber-800">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                Bu kartaning Insof ECO ilova hisobi bor: ilovadagi a&apos;zolar eski (nofaol bo&apos;ladigan) tashkilotda qoladi — ECO tomonda qo&apos;lda ko&apos;chirish kerak.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <ConfirmButton
                action={(why) => mergeCustomerAction(sourceId, preview.target.id, why)}
                label="Birlashtirish"
                icon={<Merge size={16} />}
                question={`«${sourceName}» «${preview.target.name}» ga birlashtirilsinmi? Bu karta o'chiriladi.`}
                reason="required"
                okText="Birlashtirildi"
                goTo={`/customers/${preview.target.id}`}
                className="h-9 px-3"
              />
              <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Bekor</Button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
