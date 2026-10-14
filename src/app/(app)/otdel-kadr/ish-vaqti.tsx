"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock } from "lucide-react";
import { setEmployeeSchedule, setScheduleBulk } from "./actions";
import { Badge, Button, Card, CardHeader, Checkbox, Empty, Field, FormError, FormSuccess, Input, Select, Table, Td, Th, Tr } from "@/components/ui";

export type IshVaqtiRow = { id: string; fullName: string; position: string; start: string | null; end: string | null; note: string };

/**
 * Otdel kadr → Ish vaqti: xodimlar smenasi (nechidan nechigacha). Davomatda kechikish va erta ketish
 * shu vaqtdan hisoblanadi; belgilanmagan xodimga zavod standarti (`std`) qo'llanadi.
 */
export function IshVaqti({ rows, std }: { rows: IshVaqtiRow[]; std: { start: string; end: string } }) {
  const [filter, setFilter] = useState("");
  const positions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.position, (m.get(r.position) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const shown = filter ? rows.filter((r) => r.position === filter) : rows;
  const set = rows.filter((r) => r.start).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Ish vaqtini belgilash"
          description={`Lavozim bo'yicha yoki barcha faol xodimlarga birdan. Belgilanmagan xodimga zavod standarti ${std.start}–${std.end} qo'llanadi; kechikish va erta ketish davomatda shu vaqtdan hisoblanadi.`}
          icon={Clock}
        />
        <BulkForm positions={positions} std={std} />
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Xodimlar ish vaqti</h2>
            <p className="text-xs text-slate-500">{set} ta xodimda belgilangan, {rows.length - set} tasida standart. Bitta xodimni shu yerda yoki kartasida o&apos;zgartirasiz.</p>
          </div>
          <Select aria-label="Lavozim bo'yicha" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto min-w-48">
            <option value="">Barcha lavozimlar</option>
            {positions.map(([p, n]) => <option key={p} value={p}>{p} ({n})</option>)}
          </Select>
        </div>
        <Table>
          <thead><tr><Th>Xodim</Th><Th>Boshlanishi</Th><Th>Tugashi</Th><Th>Grafik</Th><Th></Th></tr></thead>
          <tbody>
            {shown.length === 0 && <Empty text="Faol xodim yo'q" />}
            {shown.map((r) => <Row key={`${r.id}:${r.start}:${r.end}:${r.note}`} r={r} std={std} />)}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function BulkForm({ positions, std }: { positions: [string, number][]; std: { start: string; end: string } }) {
  const [state, action, pending] = useActionState(setScheduleBulk, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Kimga">
          <Select name="position" defaultValue="">
            <option value="">Barcha faol xodimlar</option>
            {positions.map(([p, n]) => <option key={p} value={p}>{p} ({n})</option>)}
          </Select>
        </Field>
        <Field label="Ish boshlanishi *"><Input name="start" type="time" defaultValue={std.start} required /></Field>
        <Field label="Ish tugashi *" hint="Kechasi tugasa — tungi smena"><Input name="end" type="time" defaultValue={std.end} required /></Field>
        <Field label="Grafik" hint="Bo'sh — xodimdagi izoh saqlanadi"><Input name="note" placeholder="5/2, 2/2" autoComplete="off" /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button disabled={pending}><Check size={16} /> Belgilash</Button>
        <Checkbox name="onlyEmpty" label="Faqat ish vaqti belgilanmaganlarga" />
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note ?? "Saqlandi" : undefined} />
    </form>
  );
}

/** Jadval qatori: inputlar katakchalarda, forma esa oxirgi katakda (`form` atributi bilan bog'lanadi). */
function Row({ r, std }: { r: IshVaqtiRow; std: { start: string; end: string } }) {
  const [state, action, pending] = useActionState(setEmployeeSchedule.bind(null, r.id), undefined);
  const fid = `ish-vaqti-${r.id}`;
  return (
    <Tr>
      <Td className="font-medium">
        <Link href={`/employees/${r.id}`} className="hover:underline">{r.fullName}</Link>
        <div className="text-xs font-normal text-slate-500">{r.position}</div>
      </Td>
      <Td><Input form={fid} name="start" type="time" defaultValue={r.start ?? ""} aria-label="Ish boshlanishi" className="w-28" /></Td>
      <Td><Input form={fid} name="end" type="time" defaultValue={r.end ?? ""} aria-label="Ish tugashi" className="w-28" /></Td>
      <Td><Input form={fid} name="note" defaultValue={r.note} placeholder="5/2" aria-label="Grafik" className="w-28" autoComplete="off" /></Td>
      <Td>
        <form id={fid} action={action} className="flex flex-wrap items-center justify-end gap-2">
          {!r.start && <Badge>standart {std.start}–{std.end}</Badge>}
          <Button size="sm" variant="secondary" disabled={pending}>Saqlash</Button>
          {state?.ok && <Check size={16} className="text-emerald-600" aria-label="Saqlandi" />}
        </form>
        {state?.error && <p role="alert" className="mt-1 text-right text-xs font-medium text-red-600">{state.error}</p>}
      </Td>
    </Tr>
  );
}
