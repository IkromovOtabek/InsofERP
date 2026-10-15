"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Clock, Image as ImageIcon, Lightbulb, MapPin, Music, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Card, CardHeader, Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { generate, savePackage, type GenState } from "./actions";
import type { MediaPick } from "@/lib/smm/studio";
import type { Place } from "../sozlamalar/actions";

type Format = "REELS" | "POST" | "STORIES";
type Channel = "INSTAGRAM" | "FACEBOOK" | "TELEGRAM";
type SceneDraft = { durationSec: number; shot: string; text: string; voice: string; mediaId: string | null; useAi: boolean; aiPrompt: string; picks: MediaPick[] };

const FORMATS: { key: Format; label: string; hint: string }[] = [
  { key: "REELS", label: "Reels", hint: "15–40 soniyali vertikal video — eng ko'p ko'rish" },
  { key: "POST", label: "Post", hint: "Rasm yoki karusel" },
  { key: "STORIES", label: "Stories", hint: "24 soatlik qisqa kontent" },
];
const CH_LABEL: Record<Channel, string> = { INSTAGRAM: "Instagram", TELEGRAM: "Telegram", FACEBOOK: "Facebook" };
const WEEKDAY = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const EXAMPLES = [
  "Yangi FBS blok liniyamizni ko'rsatadigan Reels: blok qanday quyiladi, sifat nazorati, omborda tayyor mahsulot. Oxirida — buyurtma uchun qo'ng'iroq.",
  "Qishda beton quyish mumkinmi? Prorablar uchun 3 ta xato va bizning qishki qo'shimchali betonimiz.",
  "Mikser obyektga qanday yetib boradi: zavoddan chiqishdan quyishgacha 40 soniyada.",
];

export function Studio({ initialBrief, places, connected, caps }: {
  initialBrief: string; places: Place[]; connected: Channel[]; caps: { video: boolean; tts: boolean; aiVideo: boolean };
}) {
  const router = useRouter();
  const [brief, setBrief] = useState(initialBrief);
  const [format, setFormat] = useState<Format>("REELS");
  const [gen, setGen] = useState<GenState>(undefined);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // AI natijasidan tahrirlanadigan qoralama
  const [title, setTitle] = useState("");
  const [rubric, setRubric] = useState("");
  const [hook, setHook] = useState("");
  const [music, setMusic] = useState("");
  const [caption, setCaption] = useState("");
  const [captionUz, setCaptionUz] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [place, setPlace] = useState<string>("");
  const [when, setWhen] = useState("");
  const [scenes, setScenes] = useState<SceneDraft[]>([]);
  const [channels, setChannels] = useState<Channel[]>(connected);
  const [makeVideo, setMakeVideo] = useState(true);
  const [voice, setVoice] = useState(caps.tts);

  const run = () => start(async () => {
    setErr(null);
    const r = await generate({ brief, format });
    setGen(r);
    if (!r?.pkg) return;
    const p = r.pkg;
    setTitle(p.title); setRubric(p.rubric); setHook(p.hook); setMusic(p.music);
    setCaption(p.caption); setCaptionUz(p.captionUz); setHashtags(p.hashtags);
    setPlace(places.some((x) => x.name === p.location) ? p.location : places[0]?.name ?? "");
    setWhen(r.slot ?? "");
    setScenes(p.scenes.map((sc, i) => {
      const picks = r.picks?.[i] ?? [];
      return { durationSec: Math.min(15, Math.max(1, Math.round(sc.durationSec))), shot: sc.shot, text: sc.text, voice: sc.voice, mediaId: picks[0]?.id ?? null, useAi: !picks[0] && caps.aiVideo, aiPrompt: sc.aiPrompt, picks };
    }));
    setMakeVideo(format === "REELS" && caps.video);
  });

  const upd = (i: number, patch: Partial<SceneDraft>) => setScenes((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = scenes.reduce((a, s) => a + s.durationSec, 0);
  const tagCount = (hashtags.match(/#[^\s#]+/g) ?? []).length;
  const textLen = [caption, captionUz, hashtags].filter(Boolean).join("\n\n").length;

  const save = () => startSave(async () => {
    setErr(null);
    const loc = places.find((x) => x.name === place) ?? null;
    const r = await savePackage({
      brief, format, channels, title, rubric, hook, music, caption, captionUz, hashtags, location: loc, scheduledAt: when || null,
      scenes: scenes.map((sc) => ({ durationSec: sc.durationSec, shot: sc.shot, text: sc.text, voice: sc.voice, mediaId: sc.mediaId, useAi: sc.useAi, aiPrompt: sc.aiPrompt })), makeVideo: makeVideo && format === "REELS", voice,
    });
    if (r.error) { setErr(r.error); return; }
    router.push(`/marketing/kontent/${r.id}?saqlandi=1${r.video ? "&video=1" : ""}`);
  });

  const pkg = gen?.pkg;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="1. G'oya" icon={Lightbulb} description="Qanday kontent kerakligini o'z so'zingiz bilan yozing: nimani ko'rsatish, kimga, qanday natija kutasiz" />
        <div className="mb-3 flex flex-wrap gap-2">
          {FORMATS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFormat(f.key)} title={f.hint}
              className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium transition", format === f.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
              {f.label}
            </button>
          ))}
        </div>
        <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} maxLength={3000} placeholder="Masalan: yangi FBS blok liniyamizni ko'rsatadigan Reels…" />
        {!brief && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => <button key={e} type="button" onClick={() => setBrief(e)} className="rounded-full bg-slate-100 px-3 py-1 text-left text-xs text-slate-600 hover:bg-slate-200">{e.slice(0, 60)}…</button>)}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={pending || brief.trim().length < 10}>
            {pending ? <RefreshCw size={16} className="animate-spin" /> : <Wand2 size={16} />} {pending ? "AI tayyorlamoqda… (30–60 soniya)" : pkg ? "Qayta yaratish" : "AI bilan yaratish"}
          </Button>
          <FormError error={gen?.error} />
        </div>
      </Card>

      {pkg && (
        <>
          <Card>
            <CardHeader title={format === "REELS" ? `2. Ssenariy — ${scenes.length} sahna, ${total} soniya` : "2. Kadrlar"} icon={Clapperboard}
              description="Har sahnani tahrirlang va kadr tanlang: media kutubxonadan yoki AI yaratsin" />
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Field label="Sarlavha (ichki)"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></Field>
              <Field label="Hook — birinchi 2 soniya"><Input value={hook} onChange={(e) => setHook(e.target.value)} /></Field>
            </div>
            <ol className="space-y-3">
              {scenes.map((sc, i) => (
                <li key={i} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{i + 1}-sahna</span>
                    <div className="flex items-center gap-2">
                      <Input type="number" min={1} max={15} value={sc.durationSec} onChange={(e) => upd(i, { durationSec: Math.min(15, Math.max(1, Number(e.target.value) || 1)) })} className="!h-8 w-16 text-xs" aria-label="Davomiylik, soniya" />
                      <span className="text-xs text-slate-500">soniya</span>
                      {scenes.length > 1 && <button type="button" onClick={() => setScenes((xs) => xs.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label="Sahnani o'chirish"><Trash2 size={14} /></button>}
                    </div>
                  </div>
                  <p className="mb-2 text-xs text-slate-500">Kadr: {sc.shot}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Ekrandagi matn"><Input value={sc.text} onChange={(e) => upd(i, { text: e.target.value })} maxLength={140} /></Field>
                    <Field label="Ovoz matni"><Input value={sc.voice} onChange={(e) => upd(i, { voice: e.target.value })} maxLength={600} /></Field>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {sc.picks.map((m) => (
                      <button key={m.id} type="button" onClick={() => upd(i, { mediaId: m.id, useAi: false })} title={m.title}
                        className={cn("relative h-24 w-14 overflow-hidden rounded-md bg-slate-900 ring-2", sc.mediaId === m.id ? "ring-brand-500" : "ring-transparent")}>
                        {m.kind === "VIDEO"
                          ? <video src={`/api/marketing/media/${m.id}#t=0.5`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={`/api/marketing/media/${m.id}`} alt="" loading="lazy" className="h-full w-full object-cover" />}
                      </button>
                    ))}
                    {!sc.picks.length && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><ImageIcon size={13} /> Kutubxonada mos kadr topilmadi</span>}
                    {caps.aiVideo && (
                      <Checkbox label="AI yaratsin" checked={sc.useAi && !sc.mediaId} onChange={(e) => upd(i, { useAi: e.target.checked, mediaId: e.target.checked ? null : sc.picks[0]?.id ?? null })} />
                    )}
                  </div>
                  {sc.useAi && !sc.mediaId && <Textarea value={sc.aiPrompt} onChange={(e) => upd(i, { aiPrompt: e.target.value })} rows={2} className="mt-2 text-xs" aria-label="AI kadr tavsifi" />}
                </li>
              ))}
            </ol>
            <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setScenes((xs) => [...xs, { durationSec: 3, shot: "Qo'shimcha kadr", text: "", voice: "", mediaId: null, useAi: caps.aiVideo, aiPrompt: "", picks: [] }])}><Plus size={14} /> Sahna qo&apos;shish</Button>
            {music && <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-600"><Music size={13} /> Musiqa: {music} (Instagram'da qo&apos;yiladi)</p>}
            {pkg.tips.length > 0 && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                <p className="mb-1 font-medium text-slate-700">Suratga olish bo&apos;yicha maslahatlar</p>
                <ul className="list-disc space-y-0.5 pl-4">{pkg.tips.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="3. Matn, heshteg, joylashuv va vaqt" icon={Sparkles} />
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Izoh (asosiy til)"><Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={7} /></Field>
              <Field label="Izoh (ikkinchi til)"><Textarea value={captionUz} onChange={(e) => setCaptionUz(e.target.value)} rows={7} /></Field>
            </div>
            <Field label="Heshteglar" className="mt-3" hint={`${tagCount} ta heshteg · jami matn ${textLen} / 2200 belgi (Instagram)`} error={textLen > 2200 ? "Instagram uchun matn juda uzun" : tagCount > 30 ? "30 tadan ko'p heshteg bo'lmaydi" : undefined}>
              <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
            </Field>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Joylashuv" hint={places.length ? undefined : "Joylar Sozlamalar'da qo'shiladi"}>
                <div className="relative">
                  <MapPin size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                  <Select value={place} onChange={(e) => setPlace(e.target.value)} className="pl-8">
                    <option value="">Joylashuvsiz</option>
                    {places.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </Select>
                </div>
              </Field>
              <Field label="Chiqish vaqti" hint={`AI tavsiyasi: ${WEEKDAY[pkg.bestTime.weekday] ?? ""} ${pkg.bestTime.time} — ${pkg.bestTime.why}`}>
                <div className="relative">
                  <Clock size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                  <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="pl-8" />
                </div>
              </Field>
            </div>
            <div className="mt-3">
              <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Tarmoqlar</span>
              <div className="flex flex-wrap gap-4">
                {(["INSTAGRAM", "TELEGRAM", "FACEBOOK"] as const).map((c) => (
                  <Checkbox key={c} label={CH_LABEL[c]} checked={channels.includes(c)} onChange={(e) => setChannels((xs) => (e.target.checked ? [...xs, c] : xs.filter((x) => x !== c)))} />
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="4. Saqlash" description="Post qoralama bo'lib Kontent rejaga tushadi — tekshirib, tasdiqlashga yuborasiz" />
            {format === "REELS" && (
              <div className="mb-3 space-y-2">
                <Checkbox label="Videoni avtomatik montaj qilish (9:16, ekrandagi matn bilan)" checked={makeVideo} disabled={!caps.video} onChange={(e) => setMakeVideo(e.target.checked)} />
                {!caps.video && <p className="text-xs text-amber-700">Serverda video montaj dasturi o&apos;rnatilmagan — hozircha ssenariy va matn saqlanadi.</p>}
                {makeVideo && <Checkbox label={caps.tts ? "Ovoz qo'shish (AI diktor)" : "Ovoz qo'shish — AI ovoz xizmati ulanmagan"} checked={voice && caps.tts} disabled={!caps.tts} onChange={(e) => setVoice(e.target.checked)} />}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={saving || !channels.length || !title.trim()}>{saving ? "Saqlanmoqda…" : makeVideo && format === "REELS" ? "Saqlash va video yaratish" : "Postni saqlash"}</Button>
              <FormError error={err ?? undefined} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
