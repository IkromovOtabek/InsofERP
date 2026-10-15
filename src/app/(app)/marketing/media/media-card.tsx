"use client";

import { useActionState, useState, useTransition } from "react";
import { Clapperboard, Pencil, Trash2 } from "lucide-react";
import { Button, FormError, Input } from "@/components/ui";
import { deleteMedia, updateMedia } from "./actions";

export type MediaCardT = { id: string; kind: "IMAGE" | "VIDEO"; title: string; tags: string[]; sizeMb: string; used: number; by: string | null };

export function MediaCard({ m, canEdit }: { m: MediaCardT; canEdit: boolean }) {
  const [edit, setEdit] = useState(false);
  const [state, action, pending] = useActionState(updateMedia.bind(null, m.id), undefined);
  const [delPending, startDel] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <figure className="group overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="relative aspect-[9/16] bg-slate-900">
        {m.kind === "VIDEO"
          ? <video src={`/api/marketing/media/${m.id}`} controls preload="metadata" playsInline className="h-full w-full object-cover" />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={`/api/marketing/media/${m.id}`} alt={m.title} loading="lazy" className="h-full w-full object-cover" />}
        {m.kind === "VIDEO" && <Clapperboard size={15} className="pointer-events-none absolute top-2 left-2 text-white drop-shadow" />}
        {m.used > 0 && <span className="absolute top-2 right-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">{m.used} postda</span>}
      </div>
      <figcaption className="space-y-1.5 p-2.5">
        {edit ? (
          <form action={action} className="space-y-1.5">
            <Input name="title" defaultValue={m.title} className="!h-8 text-xs" />
            <Input name="tags" defaultValue={m.tags.join(", ")} placeholder="teglar: zavod, fbs, kran" className="!h-8 text-xs" />
            <div className="flex gap-1.5"><Button size="sm" disabled={pending}>Saqlash</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEdit(false)}>Yopish</Button></div>
            <FormError error={state?.error} />
          </form>
        ) : (
          <>
            <p className="truncate text-sm font-medium" title={m.title}>{m.title}</p>
            <p className="truncate text-[11px] text-slate-500">{m.sizeMb} MB{m.by ? ` · ${m.by}` : ""}</p>
            {m.tags.length > 0 && <p className="flex flex-wrap gap-1">{m.tags.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">#{t}</span>)}</p>}
            {canEdit && (
              <div className="flex gap-1 pt-1">
                <button type="button" onClick={() => setEdit(true)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Tahrirlash"><Pencil size={13} /></button>
                <button type="button" disabled={delPending} onClick={() => { if (confirm("Faylni o'chirasizmi?")) startDel(async () => { const r = await deleteMedia(m.id); setErr(r?.error ?? null); }); }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label="O'chirish"><Trash2 size={13} /></button>
              </div>
            )}
            {err && <p role="alert" className="text-[11px] text-red-600">{err}</p>}
          </>
        )}
      </figcaption>
    </figure>
  );
}
