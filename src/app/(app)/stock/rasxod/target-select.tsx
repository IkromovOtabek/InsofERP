"use client";

import { useState } from "react";
import { Select } from "@/components/ui";
import { RecipientAdd, WithAdd } from "@/components/quick-add";

type Opt = { id: string; name: string };

/**
 * Chiqimdagi «Kimga»: oluvchilar ("r:<id>") va brigadalar ("b:<id>"). Ichidagi «+» — yangi oluvchini shu yerda qo'shib,
 * darhol tanlash (brigada esa Brigadalar bo'limida ochiladi: unda a'zolar va ish haqi bor).
 */
export function TargetSelect({ recipients: init, brigades, value, onChange, invalid }: {
  recipients: Opt[]; brigades: Opt[]; value: string; onChange: (v: string) => void; invalid?: boolean;
}) {
  const [recipients, setRecipients] = useState(init);
  return (
    <WithAdd add={<RecipientAdd onCreated={(x) => { setRecipients((l) => [...l, { id: x.id, name: x.name }]); onChange(`r:${x.id}`); }} />}>
      <Select name="to" value={value} onChange={(e) => onChange(e.target.value)} required aria-invalid={invalid || undefined}>
        <option value="">— tanlang —</option>
        {recipients.length > 0 && (
          <optgroup label="Oluvchilar">
            {recipients.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}
          </optgroup>
        )}
        {brigades.length > 0 && (
          <optgroup label="Brigadalar">
            {brigades.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.name}</option>)}
          </optgroup>
        )}
      </Select>
    </WithAdd>
  );
}

/** Excel chiqimi sahifasi uchun: holatni o'zi saqlaydi (server sahifada `useState` yo'q). */
export function TargetField({ recipients, brigades }: { recipients: Opt[]; brigades: Opt[] }) {
  const [to, setTo] = useState("");
  return <TargetSelect recipients={recipients} brigades={brigades} value={to} onChange={setTo} />;
}
