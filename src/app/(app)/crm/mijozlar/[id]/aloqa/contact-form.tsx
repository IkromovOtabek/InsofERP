"use client";

import { startTransition, useActionState, useMemo, useRef, useState } from "react";
import { AlertTriangle, ClipboardPlus, MoreHorizontal } from "lucide-react";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/action";
import type { CrmNextRule, CrmResultGroup } from "@/generated/prisma";
import { addDaysIso, addMonthsIso, defaultNext, isSunday, shortIso } from "@/lib/crm/dates";
import { RESULT_SECTIONS, T } from "@/lib/crm/labels";
import { saveContactAction } from "../../../actions";

export type ResultOpt = { id: string; label: string; group: CrmResultGroup; nextRule: CrmNextRule; defaultDays: number | null };
type Opt = { id: string; label: string };

const chip = "min-h-11 min-w-0 break-words rounded-xl border px-3 py-2 text-left text-sm font-medium leading-tight transition active:scale-[0.98]";

/**
 * Aloqa yozish (CRM_SPEC 5.4) — eng ko'p ishlatiladigan forma. Oddiy holat: natija → (sana o'zi to'ladi) → Saqlash.
 * Natija — chip-tugmalar, guruhlab; keyingi aloqa sanasi natija standartidan, tezkor tugmalar bilan.
 */
export function ContactForm({ customerId, today, results, channels, products, sources, back }: {
  customerId: string; today: string; results: ResultOpt[]; channels: Opt[]; products: Opt[]; sources: Opt[]; back: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveContactAction, undefined);
  // Ikki marta bosilsa / tarmoq qayta yuborsa — bitta aloqa (serverda clientToken unikal). Birinchi yuborishda yaratiladi
  const token = useRef<string | null>(null);
  const [resultId, setResultId] = useState("");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [otherChannel, setOtherChannel] = useState(false);
  const [next, setNext] = useState("");
  const [productId, setProductId] = useState("");
  const result = results.find((r) => r.id === resultId);
  const main = channels.slice(0, 3);
  const rest = channels.slice(3);
  const err = (f: string) => (state?.field === f ? state.error : undefined);

  const sections = useMemo(() => RESULT_SECTIONS.map((s) => ({ ...s, items: results.filter((r) => s.groups.includes(r.group)) })).filter((s) => s.items.length), [results]);

  const pick = (r: ResultOpt) => {
    setResultId(r.id);
    setNext(r.nextRule === "NONE" ? "" : defaultNext(r.defaultDays, today) ?? "");
  };
  const quick = (days: number) => setNext(days === 30 ? addMonthsIso(today, 1) : addDaysIso(today, days));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        token.current ??= crypto.randomUUID();
        fd.set("clientToken", token.current);
        startTransition(() => action(fd));
      }}
      className="grid min-w-0 grid-cols-1 gap-5"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="resultId" value={resultId} />
      <input type="hidden" name="channelId" value={channelId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="back" value={back} />

      {/* Aloqa turi — 3 segment (+ boshqalari) */}
      <div>
        <div className="mb-1.5 text-[13px] font-medium text-slate-700">{T.contact.channel}</div>
        <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1" role="radiogroup" aria-label={T.contact.channel}>
          {main.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={channelId === c.id && !otherChannel}
              onClick={() => { setChannelId(c.id); setOtherChannel(false); }}
              className={cn("min-h-10 min-w-0 flex-1 truncate rounded-lg px-1 text-[12.5px] font-medium tracking-tight transition sm:text-[13px]", channelId === c.id && !otherChannel ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}>
              {c.label}
            </button>
          ))}
          {rest.length > 0 && (
            <button type="button" role="radio" aria-checked={otherChannel} onClick={() => { setOtherChannel(true); setChannelId(rest[0].id); }}
              aria-label={T.contact.other} title={T.contact.other}
              className={cn("flex min-h-10 w-10 shrink-0 items-center justify-center rounded-lg transition", otherChannel ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}>
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>
        {otherChannel && (
          <Select aria-label={T.contact.channel} className="mt-2" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {rest.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        )}
      </div>

      {/* Natija — chip-tugmalar, guruhlab */}
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-[13px] font-medium text-slate-700">{T.contact.result} *</legend>
        <div className="grid gap-3">
          {sections.map((s) => (
            <div key={s.label}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.label}</div>
              <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
                {s.items.map((r) => {
                  const on = r.id === resultId;
                  const tone = r.group === "WIN" ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : r.group === "REFUSAL" || r.group === "LOSS" ? "border-red-200 bg-white text-red-700"
                    : r.group === "WAITING" ? "border-violet-200 bg-white text-violet-700"
                    : r.group === "NO_ANSWER" ? "border-slate-200 bg-white text-slate-600"
                    : "border-blue-200 bg-white text-blue-800";
                  return (
                    <button key={r.id} type="button" aria-pressed={on} onClick={() => pick(r)}
                      className={cn(chip, on ? "border-slate-900 bg-slate-900 text-white shadow" : tone, r.group === "WIN" && "col-span-2")}>
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {err("resultId") && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{err("resultId")}</p>}
      </fieldset>

      {/* Keyingi aloqa sanasi */}
      {result && result.nextRule !== "NONE" && (
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">
            {T.contact.next}{result.nextRule === "REQUIRED" ? " *" : <span className="font-normal text-slate-400"> ({T.contact.nextOptional})</span>}
          </div>
          <div className="mb-2 grid grid-cols-4 gap-2">
            {T.contact.quick.map(([label, days]) => {
              const v = days === 30 ? addMonthsIso(today, 1) : addDaysIso(today, days);
              return (
                <button key={label} type="button" onClick={() => quick(days)}
                  className={cn("min-h-11 rounded-lg border text-[13px] font-medium", next === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700")}>
                  {label}
                </button>
              );
            })}
          </div>
          <Input type="date" name="nextContactDate" value={next} min={today} onChange={(e) => setNext(e.target.value)} aria-invalid={!!err("nextContactDate")} aria-label={T.contact.next} />
          {next && isSunday(next) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle size={15} /> {T.contact.sunday}
              <button type="button" onClick={() => setNext(addDaysIso(next, 1))} className="font-semibold underline">{T.contact.toMonday} ({shortIso(addDaysIso(next, 1), today)})</button>
            </div>
          )}
          {err("nextContactDate") && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{err("nextContactDate")}</p>}
        </div>
      )}
      {result?.nextRule === "NONE" && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          {result.group === "WIN" ? <><ClipboardPlus size={15} className="text-emerald-600" /> {T.contact.win}</> : T.contact.nextNone}
        </p>
      )}

      <Field label={T.contact.note}>
        <Textarea name="note" rows={2} placeholder={T.contact.notePh} />
      </Field>

      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer select-none text-sm font-medium text-slate-700 pointer-coarse:py-2">{T.contact.more}</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label={T.contact.date} error={err("date")}>
            <Input type="date" name="date" defaultValue={today} max={today} required />
          </Field>
          <Field label={T.contact.price}>
            <Input type="number" name="offeredPrice" inputMode="decimal" />
          </Field>
          <div className="sm:col-span-2">
            <div className="mb-1.5 text-[13px] font-medium text-slate-700">{T.contact.product}</div>
            <div className="flex flex-wrap gap-2">
              {products.map((p) => (
                <button key={p.id} type="button" aria-pressed={productId === p.id} onClick={() => setProductId(productId === p.id ? "" : p.id)}
                  className={cn("min-h-10 rounded-full border px-4 text-sm", productId === p.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700")}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <Field label={T.contact.objectName}><Input name="objectName" /></Field>
          <Field label={T.contact.objectArea}><Input name="objectArea" /></Field>
          <Field label={T.contact.leadSource} className="sm:col-span-2">
            <Select name="leadSourceId" defaultValue="">
              <option value="">— mijoz manbasi —</option>
              {sources.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
          </Field>
        </div>
      </details>

      <FormError error={state?.error && !["resultId", "nextContactDate", "date"].includes(state.field ?? "") ? state.error : undefined} />

      {/* Saqlash — telefonda pastki menyu ustida yopishib turadi */}
      <div className="sticky bottom-16 z-20 -mx-1 bg-gradient-to-t from-white via-white to-white/0 px-1 pb-1 pt-3 lg:bottom-0">
        <button type="submit" disabled={pending || !resultId}
          className="flex min-h-14 w-full items-center justify-center rounded-xl bg-slate-900 text-base font-semibold text-white shadow-lg transition disabled:bg-slate-300 disabled:shadow-none">
          {pending ? T.contact.saving : resultId ? T.contact.save : T.contact.pickResult}
        </button>
      </div>
    </form>
  );
}
