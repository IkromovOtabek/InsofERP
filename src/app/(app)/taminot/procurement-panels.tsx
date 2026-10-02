"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Paperclip, Plus, Save, Trash2, Truck } from "lucide-react";
import {
  addIncident, addQuote, attachDoc, chooseQuote, closeIncident, dropDoc, dropQuote, saveDelivery, saveMeta,
} from "@/lib/supply-actions";
import type { ActionState } from "@/lib/action";
import { Badge, Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { money } from "@/lib/format";
import {
  DELIVERY_LABEL, DELIVERY_MANUAL, DEPARTMENTS, DOC_KINDS, INCIDENT_KINDS, INCIDENT_LABEL, PAYMENT_TERMS, PRIORITIES, PRIORITY_LABEL,
} from "@/lib/procurement-const";
import type { SupplyDelivery, SupplyIncidentKind, SupplyPriority } from "@/generated/prisma";

/**
 * Snabjeniye TZ panellari — `/taminot/[id]` sahifasining o'ng/pastki bloklari.
 * Server tomoni `lib/procurement.ts` (mobil ilova ham o'shani chaqiradi).
 */

type Opt = { id: string; name: string };
const Done = ({ s }: { s: ActionState }) => (<><FormError error={s?.error} />{s?.ok && <FormSuccess text={s.note ?? "Saqlandi"} />}</>);

/* ═══════════ Talabnoma rekvizitlari ═══════════ */

export function MetaPanel({ id, value, people }: {
  id: string;
  value: { department: string; priority: SupplyPriority; responsibleId: string; needBy: string; contractNo: string };
  people: Opt[];
}) {
  const [state, action, pending] = useActionState(saveMeta.bind(null, id), undefined);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Bo'lim (kim so'radi)">
        <Select name="department" defaultValue={value.department}>
          <option value="">— tanlanmagan —</option>
          {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
      </Field>
      <Field label="Ustuvorlik">
        <Select name="priority" defaultValue={value.priority}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </Select>
      </Field>
      <Field label="Mas'ul xodim">
        <Select name="responsibleId" defaultValue={value.responsibleId}>
          <option value="">— biriktirilmagan —</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Qachongacha kerak"><Input type="date" name="needBy" defaultValue={value.needBy} /></Field>
      <Field label="Shartnoma raqami" className="sm:col-span-2"><Input name="contractNo" defaultValue={value.contractNo} placeholder="№ 12/2026" /></Field>
      <div className="space-y-2 sm:col-span-2">
        <Done s={state} />
        <div className="flex justify-end"><Button variant="secondary" disabled={pending}><Save size={16} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button></div>
      </div>
    </form>
  );
}

/* ═══════════ Tijorat takliflari ═══════════ */

export type QuoteRow = {
  id: string; supplierName: string; supplierId: string | null; amount: number; deliveryDays: number | null;
  paymentTerms: string | null; validUntil: string | null; note: string | null; chosen: boolean; by: string;
};

export function QuotesPanel({ id, quotes, suppliers, editable }: { id: string; quotes: QuoteRow[]; suppliers: Opt[]; editable: boolean }) {
  const [state, action, pending] = useActionState(addQuote.bind(null, id), undefined);
  const [open, setOpen] = useState(quotes.length === 0 && editable);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(undefined);
  const best = quotes.length ? Math.min(...quotes.map((q) => q.amount)) : 0;
  const run = (fn: () => Promise<ActionState>) => start(async () => setMsg(await fn()));

  return (
    <div className="space-y-3">
      {quotes.length === 0 && <p className="text-sm text-slate-500">Hali taklif yo&apos;q. Bir nechta yetkazuvchidan narx olib, eng qulayini tanlang.</p>}
      {quotes.map((q) => (
        <div key={q.id} className={`rounded-lg border p-3 text-sm ${q.chosen ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-slate-900">
              {q.supplierName}
              {q.chosen && <span className="ml-2"><Badge color="green">Tanlangan</Badge></span>}
              {!q.chosen && q.amount === best && quotes.length > 1 && <span className="ml-2"><Badge color="blue">Eng arzon</Badge></span>}
            </div>
            <div className="font-semibold tabular">{money(q.amount)}</div>
          </div>
          <div className="mt-1 text-slate-500">
            {[q.deliveryDays != null ? `${q.deliveryDays} kunda yetkazadi` : null, q.paymentTerms, q.validUntil ? `${q.validUntil} gacha amal qiladi` : null, q.note].filter(Boolean).join(" · ") || "—"}
          </div>
          <div className="mt-1 text-xs text-slate-400">{q.by}{!q.supplierId && " · spravochnikda yo'q yetkazuvchi"}</div>
          {editable && (
            <div className="mt-2 flex gap-2">
              {!q.chosen && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => run(() => chooseQuote(q.id))}><CheckCircle2 size={14} /> Tanlash</Button>}
              <Button type="button" size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" disabled={busy} onClick={() => run(() => dropQuote(q.id))}><Trash2 size={14} /> O&apos;chirish</Button>
            </div>
          )}
        </div>
      ))}
      <Done s={msg} />

      {editable && !open && <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}><Plus size={14} /> Taklif qo&apos;shish</Button>}
      {editable && open && (
        <form action={action} className="grid grid-cols-1 gap-3 rounded-lg border border-dashed border-slate-300 p-3 sm:grid-cols-2">
          <Field label="Yetkazuvchi">
            <Select name="supplierId" defaultValue="">
              <option value="">— spravochnikda yo&apos;q (nomini yozing) —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Yoki yangi yetkazuvchi nomi"><Input name="supplierName" placeholder="MChJ ..." /></Field>
          <Field label="Jami taklif summasi"><MoneyInput name="amount" required /></Field>
          <Field label="Necha kunda yetkazadi"><Input name="deliveryDays" type="number" min="0" placeholder="3" /></Field>
          <Field label="To'lov sharti">
            <Select name="paymentTerms" defaultValue="">
              <option value="">—</option>
              {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Taklif amal qiladi (sana)"><Input name="validUntil" type="date" /></Field>
          <Field label="Izoh" className="sm:col-span-2"><Input name="note" placeholder="Sifat, sertifikat, boshqa shartlar" /></Field>
          <div className="space-y-2 sm:col-span-2">
            <Done s={state} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Yopish</Button>
              <Button disabled={pending}><Plus size={16} /> {pending ? "Qo'shilmoqda…" : "Taklifni qo'shish"}</Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

/* ═══════════ Direktor: katta xarid tasdig'i ═══════════ */

// Direktor paneli umumiy komponentda — Zayavkalar oynasidagi tasdiq kartasi ham ishlatadi
export { DirectorPanel } from "@/components/supply-panels";

/* ═══════════ Yetkazib berish monitoringi ═══════════ */

export function DeliveryPanel({ id, value }: {
  id: string;
  value: { status: SupplyDelivery | null; shippedAt: string; eta: string; provider: string };
}) {
  const [state, action, pending] = useActionState(saveDelivery.bind(null, id), undefined);
  const [status, setStatus] = useState<SupplyDelivery>(value.status && value.status !== "RECEIVED" ? value.status : "PLANNED");
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Holat">
        <Select name="deliveryStatus" value={status} onChange={(e) => setStatus(e.target.value as SupplyDelivery)}>
          {DELIVERY_MANUAL.map((d) => <option key={d} value={d}>{DELIVERY_LABEL[d]}</option>)}
        </Select>
      </Field>
      <Field label="Transport / haydovchi"><Input name="deliveryProvider" defaultValue={value.provider} placeholder="01 A 123 BC · Aliyev" /></Field>
      <Field label="Jo'natilgan sana"><Input type="date" name="shippedAt" defaultValue={value.shippedAt} /></Field>
      <Field label="Kutilayotgan sana (ETA)"><Input type="date" name="eta" defaultValue={value.eta} /></Field>
      <Field label={status === "PROBLEM" ? "Muammo — nima bo'ldi" : "Izoh"} className="sm:col-span-2">
        <Input name="note" required={status === "PROBLEM"} placeholder={status === "PROBLEM" ? "Masalan: yo'lda buzildi, 2 kunga kechikadi" : ""} />
      </Field>
      <div className="space-y-2 sm:col-span-2">
        {(status === "ARRIVED" || status === "RECEIVING") && <p className="text-xs text-slate-500">Saqlansa sklad xodimiga &quot;qabul qilishni boshlang&quot; xabari ketadi.</p>}
        <Done s={state} />
        <div className="flex justify-end"><Button variant="secondary" disabled={pending}><Truck size={16} /> {pending ? "Saqlanmoqda…" : "Holatni yangilash"}</Button></div>
      </div>
    </form>
  );
}

/* ═══════════ Muammolar ═══════════ */

export type IncidentRow = { id: string; kind: SupplyIncidentKind; note: string; by: string; at: string; resolvedAt: string | null; resolution: string | null };

function ResolveForm({ incidentId, requestId }: { incidentId: string; requestId: string }) {
  const [state, action, pending] = useActionState(closeIncident.bind(null, incidentId, requestId), undefined);
  return (
    <form action={action} className="mt-2 flex flex-wrap gap-2">
      <Input name="resolution" placeholder="Qanday hal qilindi" className="h-8 min-w-48 flex-1" required />
      <Button size="sm" variant="secondary" disabled={pending}><CheckCircle2 size={14} /> Hal qilindi</Button>
      <div className="w-full"><FormError error={state?.error} /></div>
    </form>
  );
}

export function IncidentsPanel({ id, incidents, canAdd, canResolve }: { id: string; incidents: IncidentRow[]; canAdd: boolean; canResolve: boolean }) {
  const [state, action, pending] = useActionState(addIncident.bind(null, id), undefined);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      {incidents.length === 0 && <p className="text-sm text-slate-500">Muammo qayd qilinmagan.</p>}
      {incidents.map((x) => (
        <div key={x.id} className={`rounded-lg border p-3 text-sm ${x.resolvedAt ? "border-slate-200" : "border-red-200 bg-red-50/50"}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
              <AlertTriangle size={14} className={x.resolvedAt ? "text-slate-400" : "text-red-600"} /> {INCIDENT_LABEL[x.kind]}
            </span>
            <Badge color={x.resolvedAt ? "green" : "red"}>{x.resolvedAt ? "Hal qilindi" : "Ochiq"}</Badge>
          </div>
          <div className="mt-1 text-slate-700">{x.note}</div>
          <div className="mt-1 text-xs text-slate-400">{x.by} · {x.at}</div>
          {x.resolvedAt && <div className="mt-1 text-xs text-emerald-700">{x.resolution} · {x.resolvedAt}</div>}
          {!x.resolvedAt && canResolve && <ResolveForm incidentId={x.id} requestId={id} />}
        </div>
      ))}
      {canAdd && !open && <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}><AlertTriangle size={14} /> Muammo qayd qilish</Button>}
      {canAdd && open && (
        <form action={action} className="space-y-3 rounded-lg border border-dashed border-slate-300 p-3">
          <Field label="Turi">
            <Select name="kind" defaultValue="SHORTAGE">{INCIDENT_KINDS.map((k) => <option key={k} value={k}>{INCIDENT_LABEL[k]}</option>)}</Select>
          </Field>
          <Field label="Nima bo'ldi"><Input name="note" required placeholder="Masalan: sement 2 t kam keldi" /></Field>
          <Done s={state} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Yopish</Button>
            <Button variant="danger" disabled={pending}>{pending ? "Yozilmoqda…" : "Qayd qilish"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ═══════════ Hujjatlar ═══════════ */

export type DocRow = { id: string; kind: string; fileName: string; by: string; at: string };

export function DocsPanel({ id, docs, missing, canEdit, canDelete = canEdit, accept }: {
  id: string; docs: DocRow[]; missing: string[]; canEdit: boolean;
  /** Qabul qilingan zayavka hujjatini faqat direktor o'chiradi */
  canDelete?: boolean; accept: string;
}) {
  const [state, action, pending] = useActionState(attachDoc.bind(null, id), undefined);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<ActionState>(undefined);
  return (
    <div className="space-y-3">
      {missing.length > 0 && <p className="text-sm font-medium text-amber-700">Yetishmayapti: {missing.join(", ")}</p>}
      {docs.length === 0 && <p className="text-sm text-slate-500">Hujjat biriktirilmagan.</p>}
      <ul className="divide-y divide-slate-100">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center gap-2 py-2 text-sm">
            <FileText size={16} className="shrink-0 text-slate-400" />
            <a href={`/taminot/${id}/hujjat/${d.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
              <span className="font-medium text-slate-900">{d.kind}</span>
              <span className="block truncate text-xs text-slate-500">{d.fileName} · {d.by} · {d.at}</span>
            </a>
            <a href={`/taminot/${id}/hujjat/${d.id}?download=1`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900" title="Yuklab olish"><Download size={15} /></a>
            {canDelete && (
              <button type="button" disabled={busy} title="O'chirish" className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => { if (confirm(`${d.kind} o'chirilsinmi?`)) start(async () => setMsg(await dropDoc(d.id))); }}><Trash2 size={15} /></button>
            )}
          </li>
        ))}
      </ul>
      <Done s={msg} />
      {canEdit && (
        <form action={action} className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Select name="kind" defaultValue={missing[0] ?? DOC_KINDS[0]} className="w-44">{DOC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select>
            <Input type="file" name="file" accept={accept} required className="min-w-0 flex-1 py-1.5" />
          </div>
          <FormError error={state?.error} />
          {state?.ok && <FormSuccess text={state.note} />}
          <div className="flex justify-end"><Button variant="secondary" size="sm" disabled={pending}><Paperclip size={14} /> {pending ? "Yuklanmoqda…" : "Biriktirish"}</Button></div>
        </form>
      )}
    </div>
  );
}
