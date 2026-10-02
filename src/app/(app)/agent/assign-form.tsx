"use client";

import { useActionState } from "react";
import { Link2, Check } from "lucide-react";
import { assignCustomerAgent } from "../employees/agent-actions";
import { Button, Field, FormError, FormSuccess, Select } from "@/components/ui";

type Agent = { id: string; fullName: string };
type Customer = { id: string; name: string; agentId: string | null };

/** Direktor/HR/sotuv: mijozni sotuv agentiga biriktiradi (yoki biriktirishni uzadi). */
export function AssignAgentForm({ agents, customers }: { agents: Agent[]; customers: Customer[] }) {
  const [state, action, pending] = useActionState(assignCustomerAgent, undefined);
  if (agents.length === 0) {
    return <p className="text-sm text-slate-500">Hali sotuv agenti yo&apos;q. Otdel kadr «Sotuv agenti» lavozimi bilan login ochsin.</p>;
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field label="Mijoz" className="min-w-[220px] grow">
        <Select name="customerId" required defaultValue="">
          <option value="" disabled>Mijozni tanlang</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Agent">
        <Select name="agentId" defaultValue="">
          <option value="">— biriktirishni uzish —</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
        </Select>
      </Field>
      <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Link2 size={16} />} Biriktirish</Button>
      <FormSuccess text={state?.note} />
      <FormError error={state?.error} />
    </form>
  );
}
