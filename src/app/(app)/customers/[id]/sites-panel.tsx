"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Building2, Plus, Pencil, Trash2, MapPin, Phone, Clock, Wallet } from "lucide-react";
import { Badge, Button, Field, FormError, Input, Textarea, Checkbox, Empty } from "@/components/ui";
import { money } from "@/lib/format";
import type { SiteDebt } from "@/lib/customer-sites";
import { saveSite, deleteSite } from "../site-actions";

/**
 * Mijoz kartasidagi "Obyektlar" bo'limi: mijozning obyektlari ro'yxati, har biriga qo'shish/tahrirlash,
 * va har obyekt bo'yicha qarz (yozilgan schyot − to'langan + schyotsiz ochiq zayavka).
 */
export function SitesPanel({ customerId, sites, canEdit }: { customerId: string; sites: SiteDebt[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const totalDebt = sites.reduce((s, x) => s + x.debt, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          {sites.length === 0 ? "Obyekt kiritilmagan" : <>Jami obyektlar qarzi: <span className={totalDebt > 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>{money(totalDebt)}</span></>}
        </div>
        {canEdit && !adding && (
          <Button size="sm" variant="secondary" onClick={() => { setAdding(true); setEditId(null); }}><Plus size={16} /> Obyekt qo'shish</Button>
        )}
      </div>

      {adding && canEdit && (
        <SiteForm customerId={customerId} site={null} onDone={() => setAdding(false)} />
      )}

      {sites.length === 0 && !adding && <Empty text="Obyekt kiritilmagan" icon={Building2} />}

      <div className="space-y-3">
        {sites.map((s) =>
          editId && s.site?.id === editId ? (
            <SiteForm key={s.site.id} customerId={customerId} site={s} onDone={() => setEditId(null)} />
          ) : (
            <SiteRow key={s.site?.id ?? "no-site"} row={s} customerId={customerId} canEdit={canEdit} onEdit={() => { setEditId(s.site!.id); setAdding(false); }} />
          ),
        )}
      </div>
    </div>
  );
}

function SiteRow({ row, customerId, canEdit, onEdit }: { row: SiteDebt; customerId: string; canEdit: boolean; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const noSite = row.site === null;

  const onDelete = () => {
    if (!row.site) return;
    if (!confirm(`"${row.site.name}" obyekti o'chirilsinmi?`)) return;
    setError(null);
    start(async () => {
      const r = await deleteSite(customerId, row.site!.id);
      if (r?.error) setError(r.error);
    });
  };

  return (
    <div className="rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 font-medium text-slate-900">
            {noSite ? <Building2 size={16} className="text-slate-400" /> : <MapPin size={16} className="text-brand-500" />}
            <span className="truncate">{noSite ? "Obyektsiz" : row.site!.name}</span>
            {!noSite && !row.site!.isActive && <Badge color="slate" dot={false}>Faol emas</Badge>}
          </div>
          {noSite ? (
            <div className="text-sm text-slate-500">Obyektga bog'lanmagan zayavka va to'lovlar</div>
          ) : (
            <div className="space-y-0.5 text-sm text-slate-500">
              {row.site!.address && <div className="flex items-center gap-1.5"><MapPin size={13} className="shrink-0 text-slate-400" /> {row.site!.address}</div>}
              {(row.site!.contactName || row.site!.contactPhone) && <div className="flex items-center gap-1.5"><Phone size={13} className="shrink-0 text-slate-400" /> {[row.site!.contactName, row.site!.contactPhone].filter(Boolean).join(" · ")}</div>}
              {row.site!.deliveryHours && <div className="flex items-center gap-1.5"><Clock size={13} className="shrink-0 text-slate-400" /> {row.site!.deliveryHours}</div>}
              {row.site!.instructions && <div className="text-slate-400">{row.site!.instructions}</div>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <div className="text-xs text-slate-400">Qarz</div>
          <div className={`inline-flex items-center gap-1 text-base font-semibold ${row.debt > 0 ? "text-red-600" : "text-emerald-700"}`}>
            <Wallet size={15} /> {money(row.debt)}
          </div>
          {row.net < -0.005 && <div className="text-xs text-emerald-600">ortiqcha to'lov {money(-row.net)}</div>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-sm">
        <div><div className="text-xs text-slate-400">Yozilgan schyot</div><div className="font-medium text-slate-700">{money(row.invoiced)}</div></div>
        <div><div className="text-xs text-slate-400">To'langan</div><div className="font-medium text-emerald-700">{money(row.paid)}</div></div>
        <div><div className="text-xs text-slate-400">Ochiq (schyotsiz)</div><div className="font-medium text-slate-700">{money(row.open)}</div></div>
      </div>

      {!noSite && canEdit && (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onEdit}><Pencil size={14} /> Tahrirlash</Button>
          {row.canDelete ? (
            <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" disabled={pending} onClick={onDelete}><Trash2 size={14} /> O'chirish</Button>
          ) : (
            <span className="text-xs text-slate-400">{row.orders} ta zayavka — o'chirib bo'lmaydi</span>
          )}
        </div>
      )}
      {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
    </div>
  );
}

function SiteForm({ customerId, site, onDone }: { customerId: string; site: SiteDebt | null; onDone: () => void }) {
  const s = site?.site ?? null;
  const [state, action, pending] = useActionState(saveSite.bind(null, customerId, s?.id ?? null), undefined);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);

  return (
    <form action={action} className="space-y-4 rounded-(--radius-card) border border-brand-200 bg-brand-50/40 p-4">
      <div className="text-sm font-medium text-slate-700">{s ? "Obyektni tahrirlash" : "Yangi obyekt"}</div>
      <FormError error={state?.error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Obyekt nomi *"><Input name="name" defaultValue={s?.name} required placeholder="Masalan: Chilonzor 15-uy qurilishi" /></Field>
        <Field label="Aloqa shaxsi"><Input name="contactName" defaultValue={s?.contactName ?? ""} /></Field>
      </div>
      <Field label="Manzil *"><Textarea name="address" defaultValue={s?.address} required /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Telefon"><Input name="contactPhone" defaultValue={s?.contactPhone ?? ""} /></Field>
        <Field label="Ish vaqti" hint="qabul qilish vaqti, masalan 08:00–18:00"><Input name="deliveryHours" defaultValue={s?.deliveryHours ?? ""} /></Field>
      </div>
      <Field label="Maxsus ko'rsatma" hint="kirish darvozasi, nasos joyi, yo'l cheklovi..."><Textarea name="instructions" defaultValue={s?.instructions ?? ""} /></Field>
      <Checkbox name="isActive" defaultChecked={s?.isActive ?? true} label="Faol" />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button size="sm" variant="secondary" type="button" onClick={onDone}>Bekor</Button>
      </div>
    </form>
  );
}
