"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, EyeOff, Eye, Plus, Repeat, Save } from "lucide-react";
import { fillShiftPattern, saveShiftGrid, saveShiftTemplate, toggleShiftTemplate } from "./hr-actions";
import { Badge, Button, Card, CardHeader, Empty, Field, FormError, FormSuccess, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";

export type ShiftTpl = { id: string; name: string; start: string; end: string; color: string | null; isActive: boolean };
export type GridDay = { iso: string; label: string; weekday: string; weekend: boolean; isToday: boolean };
/** Katak: `value` — saqlangan qiymat ("" — kartadagi smena), `fallback` — katak bo'sh bo'lsa nima ishlaydi. */
export type GridRow = { id: string; fullName: string; position: string; cells: Record<string, { value: string; fallback: string }> };

const COLOR: Record<string, string> = {
  slate: "bg-slate-50 text-slate-700", sky: "bg-sky-50 text-sky-800", emerald: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800", violet: "bg-violet-50 text-violet-800", rose: "bg-rose-50 text-rose-800",
};
const PATTERNS = ["5/2", "6/1", "2/2", "1/2", "1/3", "4/4"];

/**
 * Haftalik smena grafigi — har katakda smena shabloni yoki "Dam". Bo'sh katak — xodim kartasidagi ish grafigi
 * (yakshanba — dam). Saqlanganda faqat o'zgargan kataklar yuboriladi; kechikish va oy normasi shu grafikdan.
 */
export function ShiftGrid({ days, rows, templates, prevHref, nextHref, title }: {
  days: GridDay[]; rows: GridRow[]; templates: ShiftTpl[]; prevHref: string; nextHref: string; title: string;
}) {
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(rows.flatMap((r) => days.map((d) => [`${r.id}|${d.iso}`, r.cells[d.iso]?.value ?? ""]))), [rows, days]);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [prev, setPrev] = useState(initial);
  if (prev !== initial) { setPrev(initial); setVals(initial); }
  const changed = Object.entries(vals).filter(([k, v]) => initial[k] !== v);
  const [state, act, pending] = useActionState(saveShiftGrid, undefined);
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const active = templates.filter((t) => t.isActive);

  const cellCls = (v: string) => {
    if (v === "off") return "bg-slate-100 text-slate-500";
    const t = v.startsWith("t:") ? tplById.get(v.slice(2)) : null;
    return t ? COLOR[t.color ?? "slate"] ?? COLOR.slate : "";
  };

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-1">
          <Link href={prevHref} aria-label="Oldingi hafta" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronLeft size={16} /></Link>
          <h2 className="text-sm font-semibold">{title}</h2>
          <Link href={nextHref} aria-label="Keyingi hafta" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronRight size={16} /></Link>
        </div>
        <form action={act} className="flex items-center gap-2">
          <input type="hidden" name="cells" value={JSON.stringify(changed.map(([k, value]) => { const [employeeId, date] = k.split("|"); return { employeeId, date, value }; }))} />
          {changed.length > 0 && <span className="text-xs text-amber-700">{changed.length} ta katak o&apos;zgardi</span>}
          <Button size="sm" disabled={pending || changed.length === 0}><Save size={14} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        </form>
      </div>
      <div className="px-4 pt-2"><FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} /></div>
      <Table>
        <thead>
          <tr>
            <Th>Xodim</Th>
            {days.map((d) => (
              <Th key={d.iso} className={cn("min-w-[120px] text-center", d.isToday && "text-brand-700")}>
                {d.weekday}<div className={cn("text-[11px] font-normal", d.weekend ? "text-red-500" : "text-slate-400")}>{d.label}</div>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <Empty text="Faol xodim yo'q" />}
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="whitespace-nowrap font-medium">{r.fullName}<div className="text-xs font-normal text-slate-500">{r.position}</div></Td>
              {days.map((d) => {
                const k = `${r.id}|${d.iso}`;
                const v = vals[k] ?? "";
                const known = v === "" || v === "off" || (v.startsWith("t:") && tplById.has(v.slice(2)));
                return (
                  <Td key={d.iso} className="p-1">
                    <Select
                      aria-label={`${r.fullName}, ${d.label}`} value={v}
                      onChange={(e) => setVals((x) => ({ ...x, [k]: e.target.value }))}
                      className={cn("h-8 px-1.5 text-xs", cellCls(v), initial[k] !== v && "ring-2 ring-amber-300")}
                    >
                      <option value="">{r.cells[d.iso]?.fallback ?? "Kartadagi"}</option>
                      <option value="off">Dam</option>
                      {active.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.name} {t.start}–{t.end}</option>)}
                      {!known && <option value={v}>{v.startsWith("t:") ? "Yashirilgan smena" : v}</option>}
                      {v.startsWith("t:") && tplById.get(v.slice(2))?.isActive === false && <option value={v}>{tplById.get(v.slice(2))!.name} (yashirilgan)</option>}
                    </Select>
                  </Td>
                );
              })}
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="px-4 py-3 text-xs text-slate-500">Bo&apos;sh katak — xodim kartasidagi ish grafigi (yakshanba — dam). Kechikish, oyning norma kunlari va ish haqi shu grafik bo&apos;yicha hisoblanadi.</p>
    </Card>
  );
}

/** Naqsh bilan to'ldirish: belgilangan xodimlarga 5/2, 2/2… */
export function PatternFill({ employees, templates, from, to }: { employees: { id: string; fullName: string; position: string }[]; templates: ShiftTpl[]; from: string; to: string }) {
  const router = useRouter();
  const [state, act, pending] = useActionState(fillShiftPattern, undefined);
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  const [q, setQ] = useState("");
  const list = employees.filter((e) => !q || `${e.fullName} ${e.position}`.toLowerCase().includes(q.toLowerCase()));
  const active = templates.filter((t) => t.isActive);
  if (!active.length) return <Card><CardHeader title="Naqsh bilan to'ldirish" icon={Repeat} description="Avval pastda kamida bitta smena qo'shing" /></Card>;
  return (
    <Card>
      <CardHeader title="Naqsh bilan to'ldirish" icon={Repeat} description="Belgilangan xodimlarga davr bo'yicha: masalan 2/2 — ikki kun ish, ikki kun dam" />
      <form action={act} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Smena"><Select name="templateId" defaultValue={active[0]!.id}>{active.map((t) => <option key={t.id} value={t.id}>{t.name} {t.start}–{t.end}</option>)}</Select></Field>
          <Field label="Naqsh" hint="ish/dam kunlari"><Select name="pattern" defaultValue="5/2">{PATTERNS.map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="Boshlanishi"><Input type="date" name="from" defaultValue={from} required /></Field>
          <Field label="Tugashi"><Input type="date" name="to" defaultValue={to} required /></Field>
        </div>
        <Input placeholder="Xodimni qidirish…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((e) => (
            <label key={e.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
              <input type="checkbox" name="emp" value={e.id} className="h-4 w-4 rounded border-slate-300" />
              <span className="truncate">{e.fullName} <span className="text-xs text-slate-500">· {e.position}</span></span>
            </label>
          ))}
        </div>
        <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
        <Button disabled={pending}><Repeat size={14} /> {pending ? "Qo'yilmoqda…" : "Grafikka qo'yish"}</Button>
      </form>
    </Card>
  );
}

/** Smena shablonlari: qo'shish, tahrirlash, yashirish. */
export function ShiftTemplates({ templates }: { templates: ShiftTpl[] }) {
  return (
    <Card padded={false}>
      <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Smenalar</h2><p className="text-xs text-slate-500">Grafik kataklariga qo&apos;yiladigan smenalar. Tugashi boshlanishidan oldin bo&apos;lsa — tungi smena</p></div>
      <Table>
        <thead><tr><Th>Nomi</Th><Th>Vaqti</Th><Th>Rangi</Th><Th right>Amal</Th></tr></thead>
        <tbody>
          {templates.length === 0 && <Empty text="Smena hali qo'shilmagan" />}
          {templates.map((t) => <TemplateRow key={t.id} t={t} />)}
        </tbody>
      </Table>
      <div className="border-t border-slate-100 p-4"><TemplateForm /></div>
    </Card>
  );
}

function TemplateRow({ t }: { t: ShiftTpl }) {
  const [edit, setEdit] = useState(false);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  if (edit) return <Tr><Td colSpan={4}><TemplateForm t={t} onDone={() => setEdit(false)} /></Td></Tr>;
  return (
    <Tr className={cn(!t.isActive && "opacity-50")}>
      <Td className="font-medium">{t.name}{!t.isActive && <span className="ml-2"><Badge>yashirilgan</Badge></span>}</Td>
      <Td>{t.start}–{t.end}{t.end < t.start && <span className="ml-2 text-xs text-violet-700">tungi</span>}</Td>
      <Td><span className={cn("rounded px-2 py-0.5 text-xs", COLOR[t.color ?? "slate"])}>{t.color ?? "slate"}</span></Td>
      <Td right>
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEdit(true)}>Tahrirlash</Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={async () => { setPending(true); await toggleShiftTemplate(t.id); setPending(false); router.refresh(); }}>
            {t.isActive ? <><EyeOff size={14} /> Yashirish</> : <><Eye size={14} /> Qaytarish</>}
          </Button>
        </div>
      </Td>
    </Tr>
  );
}

function TemplateForm({ t, onDone }: { t?: ShiftTpl; onDone?: () => void }) {
  const [state, act, pending] = useActionState(saveShiftTemplate.bind(null, t?.id ?? null), undefined);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) { router.refresh(); if (onDone) onDone(); else ref.current?.reset(); } }, [state, router, onDone]);
  return (
    <form ref={ref} action={act} className="space-y-2">
      <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_120px_120px_140px_auto]">
        <Field label="Nomi"><Input name="name" required defaultValue={t?.name} placeholder="Kunduzgi" /></Field>
        <Field label="Boshlanishi"><Input type="time" name="start" required defaultValue={t?.start ?? "08:00"} /></Field>
        <Field label="Tugashi"><Input type="time" name="end" required defaultValue={t?.end ?? "17:00"} /></Field>
        <Field label="Rangi">
          <Select name="color" defaultValue={t?.color ?? "sky"}>{Object.keys(COLOR).map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
        <div className="flex gap-1">
          <Button disabled={pending}>{t ? "Saqlash" : <><Plus size={14} /> Qo&apos;shish</>}</Button>
          {onDone && <Button type="button" variant="ghost" onClick={onDone}>Bekor</Button>}
        </div>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}
