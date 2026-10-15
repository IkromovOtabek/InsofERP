"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const CHUNK = 8 * 1024 * 1024;
const MAX_MB = 300;
type Job = { name: string; pct: number; error?: string; done?: boolean };

const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Sudrab tashlash yoki tanlash; katta video 8 MB bo'laklarda yuklanadi (nginx chegarasidan o'tadi) */
export function Uploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);
  const busy = jobs.some((j) => !j.done && !j.error);

  async function uploadOne(file: File, idx: number) {
    const patch = (p: Partial<Job>) => setJobs((js) => js.map((j, i) => (i === idx ? { ...j, ...p } : j)));
    if (file.size > MAX_MB * 1024 * 1024) { patch({ error: `${MAX_MB} MB dan katta` }); return; }
    const id = rid();
    const total = Math.max(1, Math.ceil(file.size / CHUNK));
    for (let i = 0; i < total; i++) {
      const part = file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK));
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const res = await fetch(`/api/marketing/media/upload?u=${id}&i=${i}&n=${total}&name=${encodeURIComponent(file.name)}`, { method: "POST", body: part, headers: { "Content-Type": "application/octet-stream" } });
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) { patch({ error: j.error ?? `Xato (${res.status})` }); return; }
          ok = true;
        } catch { /* tarmoq uzildi — qayta urinish */ }
      }
      if (!ok) { patch({ error: "Tarmoq xatosi — qayta yuklang" }); return; }
      patch({ pct: Math.round(((i + 1) / total) * 100) });
    }
    patch({ done: true });
  }

  async function start(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 20);
    if (!list.length) return;
    const base = jobs.length;
    setJobs((js) => [...js, ...list.map((f) => ({ name: f.name, pct: 0 }))]);
    for (let k = 0; k < list.length; k++) await uploadOne(list[k]!, base + k);
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void start(e.dataTransfer.files); }}
        className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition",
          over ? "border-fuchsia-500 bg-fuchsia-50" : "border-slate-300 bg-white hover:border-slate-500")}
      >
        {busy ? <Loader2 className="animate-spin text-slate-500" /> : <CloudUpload className="text-slate-400" size={30} />}
        <span className="font-medium">Rasm va videolarni shu yerga tashlang yoki tanlang</span>
        <span className="text-xs text-slate-500">JPG, PNG, WEBP · MP4, MOV (Reels) · {MAX_MB} MB gacha · bir martada 20 ta</span>
      </button>
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="hidden" onChange={(e) => { if (e.target.files) void start(e.target.files); e.target.value = ""; }} />
      {jobs.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {jobs.map((j, i) => (
            <li key={i} className="text-sm">
              <div className="flex justify-between gap-3"><span className="truncate">{j.name}</span><span className={cn("shrink-0 tabular", j.error ? "text-red-600" : j.done ? "text-emerald-600" : "text-slate-500")}>{j.error ?? (j.done ? "Yuklandi" : `${j.pct}%`)}</span></div>
              {!j.error && <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${j.pct}%` }} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
