"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus, X } from "lucide-react";
import { saveTeam, setTeamActive } from "./team-actions";
import { Button, Field, FormError, FormSuccess, IconButton, Input, Select } from "@/components/ui";

type Emp = { id: string; fullName: string; position: string; teamName?: string | null };
export type TeamData = { id: string; name: string; leaderId: string | null; phone: string | null; note: string | null; memberIds: string[] };

/** Komanda ochish / tahrirlash: nom, brigadir, a'zolar (qidiruvli belgilash ro'yxati). */
export function TeamForm({ team, employees, onDone }: { team?: TeamData; employees: Emp[]; onDone?: () => void }) {
  const [state, act, pending] = useActionState(saveTeam.bind(null, team?.id ?? null), undefined);
  const [picked, setPicked] = useState<string[]>(team?.memberIds ?? []);
  const [q, setQ] = useState("");
  const [n, setN] = useState(0);
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return;
    router.refresh();
    if (onDone) onDone(); else { setPicked([]); setQ(""); setN((x) => x + 1); }
  }, [state, router, onDone]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? employees.filter((e) => `${e.fullName} ${e.position}`.toLowerCase().includes(t)) : employees;
    // Tanlanganlar tepada
    return [...list].sort((a, b) => Number(picked.includes(b.id)) - Number(picked.includes(a.id)));
  }, [employees, q, picked]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <form key={n} action={act} className="space-y-3">
      <FormError error={state?.error} />
      {state?.ok && !onDone && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Komanda nomi *"><Input name="name" required maxLength={80} defaultValue={team?.name} placeholder="Masalan: Svarshiklar" autoComplete="off" /></Field>
        <Field label="Brigadir">
          <Select name="leaderId" defaultValue={team?.leaderId ?? ""}>
            <option value="">— tanlanmagan —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.position}</option>)}
          </Select>
        </Field>
        <Field label="Telefon"><Input name="phone" maxLength={40} defaultValue={team?.phone ?? ""} placeholder="90 123 45 67" /></Field>
        <Field label="Izoh"><Input name="note" maxLength={300} defaultValue={team?.note ?? ""} placeholder="ixtiyoriy" /></Field>
      </div>
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-700">A&apos;zolar — {picked.length} ta tanlandi</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodimni qidirish…" className="h-8 max-w-60" />
        </div>
        {picked.map((id) => <input key={id} type="hidden" name="memberIds" value={id} />)}
        <div className="grid max-h-64 grid-cols-1 gap-x-4 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((e) => (
            <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={picked.includes(e.id)} onChange={() => toggle(e.id)} className="h-4 w-4 accent-brand-600" />
              <span className="min-w-0 truncate">{e.fullName} <span className="text-slate-400">· {e.position}{e.teamName && e.teamName !== team?.name ? ` · ${e.teamName}` : ""}</span></span>
            </label>
          ))}
          {!shown.length && <div className="px-1.5 py-2 text-sm text-slate-400">Xodim topilmadi</div>}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onDone && <Button type="button" variant="secondary" onClick={onDone}>Bekor qilish</Button>}
        <Button disabled={pending}><Plus size={15} /> {pending ? "Saqlanmoqda…" : team ? "Saqlash" : "Komanda ochish"}</Button>
      </div>
    </form>
  );
}

/** Komanda qatoridagi qalam (tahrir oynasi shu joyda ochiladi) va yopish / qayta ochish. */
export function TeamTools({ team, employees, active }: { team: TeamData; employees: Emp[]; active: boolean }) {
  const [edit, setEdit] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | undefined>();
  const router = useRouter();
  const flip = () => start(async () => { const r = await setTeamActive(team.id, !active); setErr(r?.error); router.refresh(); });
  return (
    <div>
      <div className="flex justify-end gap-1">
        {active && <IconButton type="button" icon={edit ? X : Pencil} label={edit ? "Yopish" : "Tahrirlash"} onClick={() => setEdit((v) => !v)} />}
        <IconButton type="button" icon={active ? Archive : ArchiveRestore} label={active ? "Komandani yopish" : "Qayta ochish"} disabled={pending} onClick={flip} />
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {edit && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left">
          <TeamForm team={team} employees={employees} onDone={() => setEdit(false)} />
        </div>
      )}
    </div>
  );
}
