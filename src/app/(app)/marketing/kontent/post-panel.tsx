"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Crosshair, ExternalLink, RotateCw, Send, ShieldCheck, X } from "lucide-react";
import type { SmmApproval, SmmBoostObjective, SmmChannel, SmmPublicationStatus } from "@/generated/prisma";
import { APPROVAL, BOOST_OBJECTIVE, CHANNEL_LABEL, PUB_STATUS } from "@/lib/smm/labels";
import { Badge, Button, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { approveContent, publishNow, rejectContent, submitForApproval } from "./actions";
import { requestBoostAction } from "../target/actions";

type Pub = { channel: SmmChannel; status: SmmPublicationStatus; permalink: string | null; error: string | null; views: number | null; likes: number | null; comments: number | null };

/** Tasdiqlash oqimi + tarmoqlardagi nashr holati */
export function ApprovalPanel({ id, version, approval, note, approvedBy, canSubmit, canPublish, scheduled, pubs }: {
  id: string; version: string; approval: SmmApproval; note: string | null; approvedBy: string | null; canSubmit: boolean; canPublish: boolean; scheduled: string | null; pubs: Pub[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; note?: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejState, rejAction, rejPending] = useActionState(rejectContent.bind(null, id), undefined);
  const run = (fn: () => Promise<{ error?: string; note?: string; ok?: boolean } | undefined>) => start(async () => {
    setMsg(null);
    try { const r = await fn(); setMsg(r?.error ? { error: r.error } : { note: r?.note ?? "Bajarildi" }); }
    catch { setMsg({ error: "Amal bajarilmadi — sahifani yangilab qayta urinib ko'ring" }); }
  });
  const a = APPROVAL[approval];
  const hasFailed = pubs.some((p) => p.status === "FAILED");
  // Hamma tarmoqqa chiqib bo'lgan post qayta chiqarilmaydi va rad etilmaydi
  const allOut = pubs.length > 0 && pubs.every((p) => p.status === "PUBLISHED" || p.status === "SIMULATED");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-slate-400" /> Tasdiqlash</span>
          <Badge color={a.color}>{a.label}</Badge>
        </div>
        {approvedBy && approval === "APPROVED" && <p className="mt-2 text-xs text-slate-500">Tasdiqladi: {approvedBy}{scheduled ? ` · chiqadi: ${scheduled}` : ""}</p>}
        {note && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{note}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {canSubmit && (approval === "DRAFT" || approval === "REJECTED") && (
            <Button size="sm" disabled={pending} onClick={() => run(() => submitForApproval(id))}><Send size={14} /> Tasdiqlashga yuborish</Button>
          )}
          {canPublish && (approval === "PENDING" || approval === "DRAFT") && (
            <Button size="sm" variant="success" disabled={pending} onClick={() => run(() => approveContent(id, version))}><Check size={14} /> Tasdiqlash</Button>
          )}
          {canPublish && (approval === "PENDING" || (approval === "APPROVED" && !allOut)) && !rejecting && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRejecting(true)}><X size={14} /> Rad etish</Button>
          )}
          {canPublish && approval === "APPROVED" && !allOut && (
            <Button size="sm" variant="brand" disabled={pending} onClick={() => run(() => publishNow(id))}>
              {hasFailed ? <><RotateCw size={14} /> Qayta yuborish</> : <><Send size={14} /> Hozir chiqarish</>}
            </Button>
          )}
        </div>
        {rejecting && (
          <form action={rejAction} className="mt-3 space-y-2">
            <Textarea name="note" rows={2} placeholder="Nimani tuzatish kerak?" required />
            <div className="flex gap-2"><Button size="sm" variant="danger" disabled={rejPending}>Rad etish</Button><Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>Bekor</Button></div>
            <FormError error={rejState?.error} />
          </form>
        )}
        {msg?.error && <p role="alert" className="mt-3 text-xs text-red-600">{msg.error}</p>}
        {msg?.note && <p className="mt-3 text-xs text-emerald-700">{msg.note}</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold">Tarmoqlarda</p>
        {pubs.length === 0 ? <p className="mt-2 text-xs text-slate-500">Hali chiqarilmagan</p> : (
          <ul className="mt-2 space-y-2">
            {pubs.map((p) => (
              <li key={p.channel} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>{CHANNEL_LABEL[p.channel]}</span>
                  <span className="flex items-center gap-2">
                    {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-900" aria-label="Ochish"><ExternalLink size={14} /></a>}
                    <Badge color={PUB_STATUS[p.status].color}>{PUB_STATUS[p.status].label}</Badge>
                  </span>
                </div>
                {(p.views != null || p.likes != null) && <p className="text-xs text-slate-500 tabular">ko&apos;rish {p.views ?? "—"} · layk {p.likes ?? "—"} · izoh {p.comments ?? "—"}</p>}
                {p.error && <p className="text-xs text-slate-500">{p.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Target so'rovi (chiqqan Instagram postidan). Pul faqat direktor tasdiqlagach sarflanadi. */
export function BoostRequest({ contentId, audiences, currency, dailyCap }: {
  contentId: string; audiences: { key: string; label: string; hint: string }[]; currency: string; dailyCap: number;
}) {
  const [state, action, pending] = useActionState(requestBoostAction.bind(null, contentId), undefined);
  const [daily, setDaily] = useState("5");
  const [days, setDays] = useState("5");
  const total = (Number(daily.replace(",", ".")) || 0) * (Number(days) || 0);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="inline-flex items-center gap-2 text-sm font-semibold"><Crosshair size={16} className="text-fuchsia-600" /> Target qilish</p>
      <Field label="Maqsad">
        <Select name="objective" defaultValue="REACH">{(Object.keys(BOOST_OBJECTIVE) as SmmBoostObjective[]).map((k) => <option key={k} value={k}>{BOOST_OBJECTIVE[k].label}</option>)}</Select>
      </Field>
      <Field label="Auditoriya">
        <Select name="audience" defaultValue={audiences[0]?.key}>{audiences.map((a) => <option key={a.key} value={a.key}>{a.label} — {a.hint}</option>)}</Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Kunlik, ${currency}`} hint={`limit ${dailyCap}`}><Input name="dailyBudget" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} /></Field>
        <Field label="Kun (1–30)"><Input name="days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      </div>
      <p className="text-xs text-slate-500">Jami: <span className="font-semibold text-slate-800 tabular">{total.toFixed(2)} {currency}</span> · direktor tasdiqlagach ishga tushadi</p>
      <Field label="Izoh"><Input name="note" placeholder="Nega shu post? (ixtiyoriy)" /></Field>
      <Button size="sm" disabled={pending}><Crosshair size={14} /> So&apos;rov yuborish</Button>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "So'rov yuborildi — Target sahifasida ko'rinadi" : undefined} />
    </form>
  );
}
