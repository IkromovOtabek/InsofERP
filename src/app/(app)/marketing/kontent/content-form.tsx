"use client";

import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Clapperboard, Facebook, Hash, Heart, Instagram, Languages, Loader2, MapPin, MessageCircle, Plus, Save, Send, Sparkles, Upload, X } from "lucide-react";
import type { MarketingContentStatus, MarketingContentType, SmmChannel } from "@/generated/prisma";
import { CONTENT_STATUS, CONTENT_TYPE } from "@/lib/marketing-labels";
import { Button, Field, FormActions, FormError, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import { aiWrite, saveContent } from "./actions";

export type MediaItem = { id: string; kind: "IMAGE" | "VIDEO"; title: string };
export type PlaceItem = { name: string; locationId?: string | null };

export type ContentValues = {
  title: string; type: MarketingContentType; rubric: string; status: MarketingContentStatus; scheduledAt: string;
  channels: SmmChannel[]; media: MediaItem[];
  hook: string; script: string; caption: string; captionUz: string; hashtags: string; url: string; location: string;
  views: number; likes: number; saves: number; leads: number;
};

export const EMPTY_CONTENT: ContentValues = {
  title: "", type: "REELS", rubric: "", status: "IDEA", scheduledAt: "", channels: ["INSTAGRAM", "TELEGRAM"], media: [],
  hook: "", script: "", caption: "", captionUz: "", hashtags: "", url: "", location: "", views: 0, likes: 0, saves: 0, leads: 0,
};

const CH: { key: SmmChannel; label: string; icon: typeof Instagram; tone: string }[] = [
  { key: "INSTAGRAM", label: "Instagram", icon: Instagram, tone: "peer-checked:bg-linear-to-br peer-checked:from-fuchsia-500 peer-checked:to-amber-400 peer-checked:text-white" },
  { key: "TELEGRAM", label: "Telegram", icon: Send, tone: "peer-checked:bg-sky-500 peer-checked:text-white" },
  { key: "FACEBOOK", label: "Facebook", icon: Facebook, tone: "peer-checked:bg-blue-600 peer-checked:text-white" },
];

function Thumb({ m, className }: { m: MediaItem; className?: string }) {
  return m.kind === "VIDEO"
    ? <video src={`/api/marketing/media/${m.id}`} muted playsInline preload="metadata" className={cn("h-full w-full object-cover", className)} />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={`/api/marketing/media/${m.id}`} alt={m.title} loading="lazy" className={cn("h-full w-full object-cover", className)} />;
}

/** Post muharriri: matn, media, tarmoqlar, vaqt + AI yordamchi va jonli Instagram ko'rinishi */
export function ContentForm({ id, v, canEdit, canAi, library, brand, places = [], defaultTags = "" }: {
  id: string | null; v: ContentValues; canEdit: boolean; canAi: boolean; library: MediaItem[]; brand: string; places?: PlaceItem[]; defaultTags?: string;
}) {
  const [state, action, pending] = useActionState(saveContent.bind(null, id), undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [media, setMedia] = useState<MediaItem[]>(v.media);
  const [picker, setPicker] = useState(false);
  const [caption, setCaption] = useState(v.caption);
  const [captionUz, setCaptionUz] = useState(v.captionUz);
  const [hashtags, setHashtags] = useState(v.hashtags);
  const [aiBusy, startAi] = useTransition();
  const [aiMsg, setAiMsg] = useState<{ error?: string; ok?: string } | null>(null);

  const val = (name: string) => (formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
  const set = (name: string, value: string) => {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) el.value = value;
  };

  const runAi = (kind: "script" | "caption" | "translate") => startAi(async () => {
    setAiMsg(null);
    const r = await aiWrite(kind, { title: val("title"), type: val("type"), rubric: val("rubric"), hook: val("hook"), script: val("script"), caption });
    if (!r || r.error) { setAiMsg({ error: r?.error ?? "AI xatosi" }); return; }
    if (r.hook) set("hook", r.hook);
    if (r.script) set("script", r.script);
    if (r.caption) setCaption(r.caption);
    if (r.captionUz) setCaptionUz(r.captionUz);
    if (r.hashtags) setHashtags(r.hashtags);
    setAiMsg({ ok: "AI natijasi formaga qo'yildi — tekshirib, saqlang" });
  });

  const available = useMemo(() => library.filter((m) => !media.some((x) => x.id === m.id)), [library, media]);
  const previewText = [caption, hashtags].filter(Boolean).join("\n\n");
  // Instagram chegarasi butun matnga: ikkala izoh + heshteglar + doimiy heshteglar (server ham shunday tekshiradi)
  const fullText = [caption.trim(), captionUz.trim(), [hashtags, defaultTags].filter(Boolean).join(" ").trim()].filter(Boolean).join("\n\n");
  const tagTotal = (fullText.match(/#[^\s#]+/g) ?? []).length;
  const [place, setPlace] = useState(v.location);
  const placeId = places.find((p) => p.name === place)?.locationId ?? "";

  return (
    <form ref={formRef} action={action} className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
            <Field label="Sarlavha / g'oya *"><Input name="title" defaultValue={v.title} required maxLength={160} placeholder="Masalan: Plita qanday tug'iladi" /></Field>
            <Field label="Turi">
              <Select name="type" defaultValue={v.type}>{(Object.keys(CONTENT_TYPE) as MarketingContentType[]).map((k) => <option key={k} value={k}>{CONTENT_TYPE[k]}</option>)}</Select>
            </Field>
            <Field label="Ish holati">
              <Select name="status" defaultValue={v.status}>{(Object.keys(CONTENT_STATUS) as MarketingContentStatus[]).map((k) => <option key={k} value={k}>{CONTENT_STATUS[k].label}</option>)}</Select>
            </Field>
          </div>

          {/* Tarmoqlar va vaqt */}
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Qayerga chiqadi</span>
              <div className="flex flex-wrap gap-2">
                {CH.map((c) => (
                  <label key={c.key} className="cursor-pointer">
                    <input type="checkbox" name="channels[]" value={c.key} defaultChecked={v.channels.includes(c.key)} className="peer sr-only" />
                    <span className={cn("inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm transition peer-focus-visible:ring-3 peer-focus-visible:ring-brand-500/30", c.tone)}>
                      <c.icon size={15} /> {c.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <Field label="Chiqish vaqti"><Input type="datetime-local" name="scheduledAt" defaultValue={v.scheduledAt} /></Field>
          </div>
          {(places.length > 0 || v.location) && (
            <Field label="Joylashuv" hint="Instagram postida manzil ko'rinadi (joylar — Sozlamalar'da)">
              <div className="relative max-w-sm">
                <MapPin size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                <Select name="locationName" value={place} onChange={(e) => setPlace(e.target.value)} className="pl-8">
                  <option value="">Joylashuvsiz</option>
                  {v.location && !places.some((p) => p.name === v.location) && <option value={v.location}>{v.location}</option>}
                  {places.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </Select>
                <input type="hidden" name="locationId" value={placeId} />
              </div>
            </Field>
          )}

          {/* Media */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-medium text-slate-700">Media ({media.length}/10)</span>
              <Link href="/marketing/media" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><Upload size={13} /> Yangi yuklash</Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {media.map((m, i) => (
                <div key={m.id} className="group relative h-28 w-20 overflow-hidden rounded-lg bg-slate-900 ring-1 ring-slate-200">
                  <input type="hidden" name="media[]" value={m.id} />
                  <Thumb m={m} />
                  {m.kind === "VIDEO" && <Clapperboard size={14} className="absolute top-1.5 left-1.5 text-white drop-shadow" />}
                  <span className="absolute bottom-1 left-1.5 text-[10px] font-semibold text-white drop-shadow">{i + 1}</span>
                  {canEdit && (
                    <button type="button" onClick={() => setMedia(media.filter((x) => x.id !== m.id))} aria-label="Olib tashlash"
                      className="absolute top-1 right-1 hidden h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex pointer-coarse:flex"><X size={13} /></button>
                  )}
                </div>
              ))}
              {canEdit && media.length < 10 && (
                <button type="button" onClick={() => setPicker(!picker)} className="flex h-28 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-slate-500">
                  <Plus size={18} /> Qo&apos;shish
                </button>
              )}
            </div>
            {picker && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                {available.length === 0 ? (
                  <p className="text-sm text-slate-500">Kutubxonada tanlanmagan media yo&apos;q. <Link href="/marketing/media" className="underline">Yuklash</Link></p>
                ) : (
                  <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6 lg:grid-cols-8">
                    {available.map((m) => (
                      <button key={m.id} type="button" title={m.title} onClick={() => { setMedia([...media, m].slice(0, 10)); }} className="relative aspect-[9/16] overflow-hidden rounded-md bg-slate-900 ring-1 ring-slate-200 hover:ring-2 hover:ring-brand-500">
                        <Thumb m={m} />
                        {m.kind === "VIDEO" && <Clapperboard size={12} className="absolute top-1 left-1 text-white drop-shadow" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* AI yordamchi */}
          {canAi && canEdit && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-linear-to-r from-violet-50 to-fuchsia-50 p-3 ring-1 ring-violet-100">
              <Sparkles size={16} className="text-violet-600" />
              <span className="mr-1 text-sm font-medium text-violet-900">AI yordamchi</span>
              <Button type="button" size="sm" variant="secondary" disabled={aiBusy} onClick={() => runAi("script")}><Clapperboard size={14} /> Ssenariy yozish</Button>
              <Button type="button" size="sm" variant="secondary" disabled={aiBusy} onClick={() => runAi("caption")}><Hash size={14} /> Izoh + heshteg</Button>
              <Button type="button" size="sm" variant="secondary" disabled={aiBusy} onClick={() => runAi("translate")}><Languages size={14} /> RU → UZ</Button>
              {aiBusy && <span className="inline-flex items-center gap-1.5 text-xs text-violet-700"><Loader2 size={13} className="animate-spin" /> yozmoqda…</span>}
              {aiMsg?.error && <span role="alert" className="text-xs text-red-600">{aiMsg.error}</span>}
              {aiMsg?.ok && <span className="text-xs text-emerald-700">{aiMsg.ok}</span>}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Field label="Rubrika"><Input name="rubric" defaultValue={v.rubric} placeholder="Zavod ichidan" /></Field>
            <Field label="Hook (birinchi 2 soniya)"><Input name="hook" defaultValue={v.hook} /></Field>
          </div>
          <Field label="Ssenariy (kadrlar, ovoz, ekrandagi matn)"><Textarea name="script" rows={10} defaultValue={v.script} className="font-mono text-[13px] leading-relaxed" /></Field>
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label={`Izoh — ruscha (${caption.length}/2200)`}><Textarea name="caption" rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} /></Field>
            <Field label={`Izoh — o'zbekcha (${captionUz.length}/2200)`}><Textarea name="captionUz" rows={6} value={captionUz} onChange={(e) => setCaptionUz(e.target.value)} /></Field>
          </div>
          <Field label="Heshteglar"><Input name="hashtags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#плитыперекрытия #фбс #beton #qurilish" /></Field>

          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Natijalar (qo&apos;lda; tarmoqdan o&apos;zi ham tortiladi)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
              <Field label="Havola"><Input name="url" defaultValue={v.url} placeholder="https://instagram.com/reel/…" /></Field>
              <Field label="Ko'rishlar"><Input name="views" inputMode="numeric" defaultValue={v.views} /></Field>
              <Field label="Layklar"><Input name="likes" inputMode="numeric" defaultValue={v.likes} /></Field>
              <Field label="Saqlashlar"><Input name="saves" inputMode="numeric" defaultValue={v.saves} /></Field>
              <Field label="Lidlar"><Input name="leads" inputMode="numeric" defaultValue={v.leads} /></Field>
            </div>
          </details>
        </fieldset>
        <FormError error={state?.error} />
        {canEdit && <FormActions><Button disabled={pending}><Save size={15} /> {id ? "Saqlash" : "Qoralama yaratish"}</Button></FormActions>}
      </div>

      {/* Jonli ko'rinish — telefondagi Instagram posti */}
      <aside className="xl:sticky xl:top-20 xl:self-start">
        <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Ko&apos;rinishi</p>
        <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-[2rem] border-8 border-slate-900 bg-white shadow-xl">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-fuchsia-500 to-amber-400 p-[2px]"><span className="h-full w-full rounded-full bg-slate-900" /></span>
            <span className="text-sm font-semibold">{brand}</span>
          </div>
          <div className="relative aspect-[4/5] bg-slate-100">
            {media[0] ? <Thumb m={media[0]} /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">Media tanlanmagan</div>}
            {media.length > 1 && <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">1/{media.length}</span>}
          </div>
          <div className="flex gap-3 px-3 pt-2.5 text-slate-800"><Heart size={20} /><MessageCircle size={20} /><Send size={20} /></div>
          <p className="max-h-48 overflow-y-auto px-3 pt-1.5 pb-3 text-[13px] leading-snug whitespace-pre-wrap">
            <span className="font-semibold">{brand}</span> {previewText || <span className="text-slate-400">Izoh shu yerda ko&apos;rinadi</span>}
          </p>
        </div>
        <ul className="mx-auto mt-3 max-w-[320px] space-y-1 text-xs text-slate-500">
          <li className="flex items-center gap-1.5"><Check size={12} className={fullText.length <= 2200 ? "text-emerald-600" : "text-red-600"} /> Instagram matni ≤ 2200 belgi ({fullText.length}: ikkala izoh va heshteglar)</li>
          <li className="flex items-center gap-1.5"><Check size={12} className={tagTotal <= 30 ? "text-emerald-600" : "text-red-600"} /> Heshteglar ≤ 30 ({tagTotal}, doimiylari bilan)</li>
          <li className="flex items-center gap-1.5"><Check size={12} className={media.length ? "text-emerald-600" : "text-amber-500"} /> Instagram/Facebook uchun media kerak</li>
        </ul>
      </aside>
    </form>
  );
}
