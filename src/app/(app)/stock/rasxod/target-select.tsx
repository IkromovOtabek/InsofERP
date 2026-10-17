"use client";

import { useState } from "react";
import { Select } from "@/components/ui";
import { RecipientAddDialog } from "@/components/quick-add";
import { NEW_RECIPIENT, brigadeLabel, type TargetGroups } from "@/lib/issue-target";

/**
 * Chiqimdagi «Kimga» — tartib: 1) bizning brigadalar (brigadir ismi bilan, "b:<id>"), 2) barcha xodimlar ("e:<id>"),
 * 3) tizimda yo'q nomlar — oluvchilar ("r:<id>"), 4) eng pastda «Qo'lda kiritish…» — yangi oluvchi oynasi ochiladi,
 * yozilgan nom darhol tanlanadi (brigada va xodim o'z bo'limlarida ochiladi).
 */
export function TargetSelect({ targets, value, onChange, invalid, canAdd = true, name = "to", required = true, emptyLabel = "— tanlang —" }: {
  targets: TargetGroups; value: string; onChange: (v: string) => void; invalid?: boolean; canAdd?: boolean;
  /** Kirim formasida: `autoIssueKey`, majburiy emas, bo'sh — «Skladga (chiqimsiz)» */
  name?: string; required?: boolean; emptyLabel?: string;
}) {
  const [recipients, setRecipients] = useState(targets.recipients);
  const [open, setOpen] = useState(false);
  const pick = (v: string) => {
    if (v === NEW_RECIPIENT) { setOpen(true); return; } // tanlov o'zgarmaydi — oyna yopilsa avvalgi qiymat qoladi
    onChange(v);
  };
  return (
    <>
      <Select name={name} value={value} onChange={(e) => pick(e.target.value)} required={required} aria-invalid={invalid || undefined}>
        <option value="">{emptyLabel}</option>
        {targets.brigades.length > 0 && (
          <optgroup label="Bizning brigadalar">
            {targets.brigades.map((b) => <option key={b.id} value={`b:${b.id}`}>{brigadeLabel(b)}</option>)}
          </optgroup>
        )}
        {targets.employees.length > 0 && (
          <optgroup label="Xodimlar">
            {targets.employees.map((e) => <option key={e.id} value={`e:${e.id}`}>{`${e.name} · ${e.position}`}</option>)}
          </optgroup>
        )}
        {recipients.length > 0 && (
          <optgroup label="Boshqa oluvchilar">
            {recipients.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}
          </optgroup>
        )}
        {canAdd && (
          <optgroup label="Ro'yxatda yo'q">
            <option value={NEW_RECIPIENT}>+ Qo'lda kiritish — yangi oluvchi…</option>
          </optgroup>
        )}
      </Select>
      {canAdd && (
        <RecipientAddDialog open={open} onClose={() => setOpen(false)}
          onCreated={(x) => { setRecipients((l) => [...l, { id: x.id, name: x.name }]); onChange(`r:${x.id}`); }} />
      )}
    </>
  );
}

/** Excel chiqimi sahifasi uchun: holatni o'zi saqlaydi (server sahifada `useState` yo'q). */
export function TargetField({ targets }: { targets: TargetGroups }) {
  const [to, setTo] = useState("");
  return <TargetSelect targets={targets} value={to} onChange={setTo} />;
}
