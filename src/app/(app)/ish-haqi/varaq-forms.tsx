"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button, Field, FormActions, FormError, Input, Select } from "@/components/ui";
import { uploadWorkbookAction } from "./varaq-actions";

/* Oylik varaqlari — Excel yuklash formasi va kitob tanlash. */

const MONTH_WORDS: [RegExp, number][] = [
  [/январ|yanvar|january/i, 1], [/феврал|fevral|february/i, 2], [/март|mart|march/i, 3], [/апрел|aprel|april/i, 4],
  [/\bма[йя]|\bmay\b|\bmay[^a-z]/i, 5], [/июн|iyun|june/i, 6], [/июл|iyul|july/i, 7], [/август|avgust|august/i, 8],
  [/сентябр|sentabr|sentyabr|september/i, 9], [/октябр|oktabr|oktyabr|october/i, 10], [/ноябр|noyabr|november/i, 11], [/декабр|dekabr|december/i, 12],
];

/** Fayl nomidan oy: «Иш Хаки октябрь 2026.xlsx» → «2026-10». */
function monthFromName(name: string): string | null {
  const y = /(20\d{2})/.exec(name)?.[1];
  const m = MONTH_WORDS.find(([re]) => re.test(name))?.[1];
  return y && m ? `${y}-${String(m).padStart(2, "0")}` : null;
}

export function WorkbookUploadForm({ months, defMonth }: { months: { key: string; label: string }[]; defMonth: string }) {
  const [state, action, pending] = useActionState(uploadWorkbookAction, undefined);
  const [month, setMonth] = useState(defMonth);
  const [title, setTitle] = useState("");
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_1fr]">
        <Field label="Excel fayli (.xlsx) *" hint="Barcha varaqlari (yashirinlari ham) formulalari bilan olinadi">
          <Input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required className="pt-1.5"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (!f) return;
              const m = monthFromName(f.name);
              if (m && months.some((x) => x.key === m)) setMonth(m);
              setTitle(f.name.replace(/\.xlsx$/i, ""));
            }} />
        </Field>
        <Field label="Qaysi oy *">
          <Select name="month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Nomi" hint="Bo'sh bo'lsa — fayl nomi">
          <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
      </div>
      <FormActions><Button disabled={pending}><Upload size={15} /> {pending ? "Yuklanmoqda…" : "Yuklash"}</Button></FormActions>
    </form>
  );
}

/** Kitob tanlash — tanlansa shu kitob ochiladi. */
export function WorkbookPicker({ items, current }: { items: { id: string; label: string }[]; current: string }) {
  const router = useRouter();
  return (
    <Select value={current} onChange={(e) => router.push(`/ish-haqi?tab=varaqlar&kitob=${e.target.value}`)} className="h-9 w-auto min-w-64 max-w-full" aria-label="Kitob">
      {items.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
    </Select>
  );
}
