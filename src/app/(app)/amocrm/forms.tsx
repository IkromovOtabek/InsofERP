"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { KeyRound, Link2, RefreshCw, RotateCcw, Unplug, X } from "lucide-react";
import { Button, Checkbox, Field, FormActions, FormError, FormSuccess, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import {
  connectOAuthAction, connectTokenAction, disconnectAction, dismissAction, restoreAction, saveStagesAction, syncNowAction, webhookAction,
} from "./actions";

/** Ulash: uzoq muddatli token (oddiy yo'l) yoki OAuth (client_id + secret → ruxsat oynasi) */
export function ConnectForm({ domain, redirectUri }: { domain: string; redirectUri: string }) {
  const [mode, setMode] = useState<"token" | "oauth">("token");
  const [tState, tAction, tPending] = useActionState(connectTokenAction, undefined);
  const [oState, oAction, oPending] = useActionState(connectOAuthAction, undefined);
  // Kalitlar saqlandi — ruxsat oynasiga to'liq sahifa navigatsiyasi (state cookie brauzerga yozilsin)
  useEffect(() => { if (oState?.ok) window.location.assign("/api/amocrm/oauth"); }, [oState]);
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-slate-200 p-1 text-sm">
        <button type="button" onClick={() => setMode("token")} className={`rounded-md px-3 py-1.5 ${mode === "token" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Uzoq muddatli token</button>
        <button type="button" onClick={() => setMode("oauth")} className={`rounded-md px-3 py-1.5 ${mode === "oauth" ? "bg-slate-900 text-white" : "text-slate-600"}`}>OAuth (client_id)</button>
      </div>
      {mode === "token" ? (
        <form action={tAction} className="space-y-3">
          <Field label="Hisob manzili *" hint="Masalan: insof.amocrm.ru"><Input name="domain" defaultValue={domain} required autoComplete="off" placeholder="kompaniya.amocrm.ru" /></Field>
          <Field label="Uzoq muddatli token *" hint="amoCRM → Sozlamalar → Integratsiyalar → shaxsiy integratsiya → «Kalitlar va ruxsatlar» → «Uzoq muddatli token»">
            <Input name="token" type="password" required autoComplete="off" />
          </Field>
          <FormError error={tState?.error} />
          <FormSuccess text={tState?.note} />
          <FormActions><Button disabled={tPending}><KeyRound size={15} /> Ulash</Button></FormActions>
        </form>
      ) : (
        <form action={oAction} className="space-y-3">
          <Field label="Hisob manzili *"><Input name="domain" defaultValue={domain} required autoComplete="off" placeholder="kompaniya.amocrm.ru" /></Field>
          <Field label="Integratsiya ID (client_id) *"><Input name="clientId" required autoComplete="off" /></Field>
          <Field label="Maxfiy kalit (client_secret) *"><Input name="clientSecret" type="password" required autoComplete="off" /></Field>
          <p className="text-xs text-slate-500">Integratsiyadagi «Redirect URI» aynan shu bo&apos;lsin: <span className="font-mono text-slate-700">{redirectUri}</span></p>
          <FormError error={oState?.error} />
          <FormSuccess text={oState?.note} />
          <FormActions><Button disabled={oPending || !!oState?.ok}><Link2 size={15} /> amoCRM orqali ruxsat berish</Button></FormActions>
        </form>
      )}
    </div>
  );
}

export type StageOpt = { id: number; name: string };
export type PipelineOpt = { id: number; name: string; statuses: StageOpt[] };
export type StageValues = {
  pipelineId: number | null; stageNewLead: number | null; stageToErp: number | null; stageConfirmed: number | null;
  stageDelivered: number | null; stageClosed: number | null; stageCancelled: number | null; pushLeads: boolean;
};

const STAGE_FIELDS: { key: keyof StageValues; label: string; hint: string; required?: boolean }[] = [
  { key: "stageNewLead", label: "Sayt arizasi tushadigan bosqich", hint: "Bo'sh — voronkaning birinchi bosqichi" },
  { key: "stageToErp", label: "ERP'ga tushadigan bosqich *", hint: "Sdelka shu bosqichga o'tsa — ERP'da mijoz va «zayavka kutmoqda»", required: true },
  { key: "stageConfirmed", label: "Zayavka qabul qilinganda", hint: "Ishlab chiqarishga tushdi" },
  { key: "stageDelivered", label: "Hammasi yetkazilganda", hint: "" },
  { key: "stageClosed", label: "To'lov yopilganda", hint: "Odatda «Muvaffaqiyatli realizatsiya»" },
  { key: "stageCancelled", label: "Zayavka bekor qilinganda", hint: "Bo'sh — sdelka siljimaydi" },
];

export function StagesForm({ pipelines, values }: { pipelines: PipelineOpt[]; values: StageValues }) {
  const [state, action, pending] = useActionState(saveStagesAction, undefined);
  const [pid, setPid] = useState<number | null>(values.pipelineId ?? pipelines[0]?.id ?? null);
  const statuses = pipelines.find((p) => p.id === pid)?.statuses ?? [];
  // Voronka almashsa — eski bosqichlar boshqa voronkaniki, tanlov bo'shatiladi
  const keep = pid === values.pipelineId;
  return (
    <form action={action} className="space-y-3">
      <Field label="Voronka *">
        <Select name="pipelineId" value={pid ?? ""} onChange={(e) => setPid(Number(e.target.value) || null)} required>
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {STAGE_FIELDS.map((f) => (
          <Field key={`${pid}-${f.key}`} label={f.label} hint={f.hint || undefined}>
            <Select name={f.key} defaultValue={keep ? String(values[f.key] ?? "") : ""} required={f.required}>
              <option value="">{f.required ? "— tanlang —" : "— siljitilmaydi —"}</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        ))}
      </div>
      <Checkbox name="pushLeads" label="Sayt arizalarini amoCRM'ga yuborish" defaultChecked={values.pushLeads} />
      <FormError error={state?.error} />
      <FormSuccess text={state?.note} />
      <FormActions><Button disabled={pending}>Saqlash</Button></FormActions>
    </form>
  );
}

/** Bir tugmali amal (natija tugma yonida chiqadi) */
function ActionButton({ run, label, icon: Icon, variant = "secondary", confirm }: {
  run: () => Promise<ActionState>; label: string; icon: typeof X; variant?: "primary" | "secondary" | "ghost" | "danger"; confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<ActionState>(undefined);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={variant} disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => { try { setRes(await run()); } catch { setRes({ error: "Bajarilmadi — sahifani yangilab qayta urining" }); } });
      }}>
        <Icon size={14} className={pending && Icon === RefreshCw ? "animate-spin" : undefined} /> {label}
      </Button>
      {res?.error && <span role="alert" className="text-xs text-red-600">{res.error}</span>}
      {res?.note && <span className="text-xs text-emerald-700">{res.note}</span>}
    </span>
  );
}

export const SyncNowButton = () => <ActionButton run={syncNowAction} label="Hozir sinxronlash" icon={RefreshCw} />;
export const WebhookButton = () => <ActionButton run={webhookAction} label="Webhook'ni qayta o'rnatish" icon={Link2} variant="ghost" />;
export const DisconnectButton = () => <ActionButton run={disconnectAction} label="Uzish" icon={Unplug} variant="danger" confirm="amoCRM uzilsinmi? Sayt arizalari yuborilmaydi, zayavka holatlari sdelkaga qaytmaydi." />;
export const DismissButton = ({ id }: { id: string }) => <ActionButton run={() => dismissAction(id)} label="Kerak emas" icon={X} variant="ghost" confirm="Bu kelishuv ERP ro'yxatidan olib tashlansinmi? amoCRM'dagi sdelka o'zgarmaydi." />;
export const RestoreButton = ({ id }: { id: string }) => <ActionButton run={() => restoreAction(id)} label="Qaytarish" icon={RotateCcw} variant="ghost" />;
