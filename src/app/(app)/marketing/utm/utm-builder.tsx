"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Kanal presetlari: Yandex/Google makroslari ({keyword}) reklama kabinetida o'rniga qo'yiladi */
const PRESETS = {
  yandex: { label: "Yandex Direct", source: "yandex", medium: "cpc", content: "{ad_id}", term: "{keyword}" },
  google: { label: "Google Ads", source: "google", medium: "cpc", content: "{creative}", term: "{keyword}" },
  instagram: { label: "Instagram reklama", source: "instagram", medium: "paid_social", content: "", term: "" },
  reels: { label: "Instagram bio / Reels", source: "instagram", medium: "social", content: "", term: "" },
  telegram: { label: "Telegram", source: "telegram", medium: "social", content: "", term: "" },
  custom: { label: "Boshqa", source: "", medium: "", content: "", term: "" },
} as const;
type PresetKey = keyof typeof PRESETS;
type Fields = { path: string; source: string; medium: string; campaign: string; content: string; term: string };

const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_\-{}]/g, "");

export function UtmBuilder({ siteUrl, campaigns }: { siteUrl: string; campaigns: string[] }) {
  const [preset, setPreset] = useState<PresetKey>("yandex");
  const [v, setV] = useState<Fields>({ path: "/", source: "yandex", medium: "cpc", campaign: campaigns[0] ?? "", content: "{ad_id}", term: "{keyword}" });
  const [copied, setCopied] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    const add = (k: string, val: string) => { const c = clean(val); if (c) p.set(k, c); };
    add("utm_source", v.source); add("utm_medium", v.medium); add("utm_campaign", v.campaign); add("utm_content", v.content); add("utm_term", v.term);
    const path = v.path.startsWith("/") ? v.path : `/${v.path}`;
    // {keyword} kabi makroslar kodlanmaydi — kabinet o'zi almashtiradi
    return `${siteUrl}${path}?${p.toString().replace(/%7B/g, "{").replace(/%7D/g, "}")}`;
  }, [v, siteUrl]);
  const ready = clean(v.source) && clean(v.medium) && clean(v.campaign);

  const choose = (k: PresetKey) => {
    const p = PRESETS[k];
    setPreset(k);
    setV((cur) => ({ ...cur, source: p.source, medium: p.medium, content: p.content, term: p.term }));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ruxsat bo'lmasa — qo'lda */ }
  };
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
          <button key={k} type="button" onClick={() => choose(k)} className={cn("rounded-full border px-3 py-1.5 text-sm transition", preset === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-400")}>
            {PRESETS[k].label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Sahifa (yo'l)"><Input value={v.path} onChange={set("path")} className="font-mono" placeholder="/" /></Field>
        <Field label="utm_source"><Input value={v.source} onChange={set("source")} className="font-mono" /></Field>
        <Field label="utm_medium"><Input value={v.medium} onChange={set("medium")} className="font-mono" /></Field>
        <Field label="utm_campaign">
          <Input value={v.campaign} onChange={set("campaign")} list="utm-campaigns" className="font-mono" placeholder="ya_search_fbs" />
          <datalist id="utm-campaigns">{campaigns.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="utm_content"><Input value={v.content} onChange={set("content")} className="font-mono" placeholder="reels_01" /></Field>
        <Field label="utm_term"><Input value={v.term} onChange={set("term")} className="font-mono" /></Field>
      </div>
      <div className="rounded-xl bg-slate-900 p-4 text-white">
        <p className="text-xs text-slate-400">Tayyor havola</p>
        <p className="mt-1.5 font-mono text-sm break-all text-brand-400">{url}</p>
        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={copy} disabled={!ready}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Nusxa olindi" : "Nusxa olish"}
        </Button>
        {!ready && <p className="mt-2 text-xs text-slate-400">source, medium va campaign to&apos;ldirilishi shart.</p>}
      </div>
    </div>
  );
}
