"use client";

import { useActionState, useState } from "react";
import { Check, UserPlus, X } from "lucide-react";
import { approveAccess, rejectAccess } from "./access-actions";
import { Badge, Button, Card, CardHeader, FormError, Input, Select } from "@/components/ui";
import { formatPhone } from "@/lib/phone";

export type AccessRow = {
  id: string; fullName: string; phone: string; position: string; login: string; note: string | null;
  createdAt: string; suggestedRole: string | null;
  employee: { fullName: string; position: string } | null;
  existingLogin: string | null;
};

/** Kirish sahifasidan kelgan "Ro'yxatdan o'tish" arizalari — Otdel kadr / direktor tasdiqlaydi. */
export function AccessRequests({ rows, roles }: { rows: AccessRow[]; roles: { value: string; label: string }[] }) {
  return (
    <Card className="mb-4">
      <CardHeader icon={UserPlus} title={`Kirish arizalari · ${rows.length}`} description="Xodim o'zi login va parol tanlagan, telefonini kod bilan tasdiqlagan. Tasdiqlasangiz login ochiladi." />
      <div className="mt-3 divide-y divide-slate-100">
        {rows.map((r) => <Row key={r.id} r={r} roles={roles} />)}
      </div>
    </Card>
  );
}

function Row({ r, roles }: { r: AccessRow; roles: { value: string; label: string }[] }) {
  const [ok, approve, approving] = useActionState(approveAccess.bind(null, r.id), undefined);
  const [no, reject, rejecting] = useActionState(rejectAccess.bind(null, r.id), undefined);
  const [rejectOpen, setRejectOpen] = useState(false);
  if (ok?.ok || no?.ok) return <p className="py-3 text-sm text-emerald-700">{r.fullName} — {ok?.note ?? no?.note}</p>;

  return (
    <div className="grid gap-3 py-3 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="min-w-0 text-sm">
        <div className="font-medium text-slate-900">{r.fullName}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>{formatPhone(r.phone)}</span>
          <span>· {r.position}</span>
          <span>· login <code className="rounded bg-slate-100 px-1">{r.login}</code></span>
          <span>· {r.createdAt}</span>
          {r.existingLogin
            ? <Badge color="red">Bu raqamda login bor: {r.existingLogin}</Badge>
            : r.employee
            ? <Badge color="green">Kartasi bor: {r.employee.fullName} · {r.employee.position}</Badge>
            : <Badge>Yangi xodim kartasi ochiladi</Badge>}
        </div>
        {r.note && <div className="mt-1 text-xs text-slate-600">«{r.note}»</div>}
        <FormError error={ok?.error ?? no?.error} />
      </div>

      {rejectOpen ? (
        <form action={reject} className="flex flex-wrap items-center gap-2">
          <Input name="reason" placeholder="Sabab (ixtiyoriy)" className="w-56" maxLength={300} autoFocus />
          <Button variant="danger" disabled={rejecting}><X size={15} /> Rad etish</Button>
          <Button type="button" variant="ghost" onClick={() => setRejectOpen(false)}>Bekor</Button>
        </form>
      ) : (
        <form action={approve} className="flex flex-wrap items-center gap-2">
          <Select name="role" defaultValue={r.suggestedRole ?? ""} className="w-48" aria-label="Bo'lim (tizim huquqi)" required>
            <option value="">Bo&apos;lim…</option>
            {roles.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Button disabled={approving}><Check size={15} /> Tasdiqlash</Button>
          <Button type="button" variant="secondary" onClick={() => setRejectOpen(true)}><X size={15} /> Rad etish</Button>
        </form>
      )}
    </div>
  );
}
