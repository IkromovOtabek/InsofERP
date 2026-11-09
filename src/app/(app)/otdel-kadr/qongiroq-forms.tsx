"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { History, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { deleteCallLog, lookupCallPhone, saveCallLog, setCallStatus } from "./qongiroq-actions";
import { Badge, Button, Field, FormError, FormSuccess, IconButton, Input, Select, Td, Tr } from "@/components/ui";
import { CALL_STATUSES, CALL_STATUS_BADGE, CALL_STATUS_LABEL } from "@/lib/hr/labels";
import { formatPhone } from "@/lib/phone";
import { date } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HrCallStatus } from "@/generated/prisma";

/** Jurnal qatori (sanalar — "YYYY-MM-DD"). */
export type CallRowData = {
  id: string; date: string; position: string; phone: string | null; fullName: string | null; address: string | null;
  age: number | null; status: HrCallStatus; visitDate: string | null; reason: string | null;
  /** Yozilgan soat ("14:32") — shu kuni kiritilgan bo'lsa; orqa sana / import — null */
  time?: string | null;
};

/** "YYYY-MM-DD" → 25/07/2025 (mahalliy yarim tun — kun siljimasin). */
const day = (iso: string) => date(new Date(`${iso}T00:00:00`));
/** Jurnalda raqam Excel'dagidek mahalliy ko'rinishda: 90 123 45 67. */
const localPhone = (p: string) => formatPhone(p).replace(/^\+998 /, "");

type Prev = Awaited<ReturnType<typeof lookupCallPhone>>;

/**
 * Qo'ng'iroqni yozish / tahrirlash. Yangi yozuvda telefon kiritilgach oldingi qo'ng'iroqlari ko'rsatiladi
 * va bo'sh qolgan ism, manzil, yosh shulardan to'ldiriladi.
 */
export function CallForm({ row, positions, today, onDone }: { row?: CallRowData; positions: string[]; today: string; onDone?: () => void }) {
  const [state, act, pending] = useActionState(saveCallLog.bind(null, row?.id ?? null), undefined);
  const [status, setStatus] = useState<HrCallStatus>(row?.status ?? "WAITING");
  const [prev, setPrev] = useState<Prev>([]);
  // Oldingi qo'ng'iroqdan to'ldirilgan qiymatlar: maydonlar `key` bilan qayta chiziladi (yosh maydoni o'z holatini yuritadi)
  const [auto, setAuto] = useState<{ n: number; fullName?: string; address?: string; age?: string }>({ n: 0 });
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return;
    router.refresh();
    if (onDone) onDone();
    else { ref.current?.reset(); setStatus("WAITING"); setPrev([]); setAuto((a) => ({ n: a.n + 1 })); }
  }, [state, router, onDone]);

  async function checkPhone(v: string) {
    if (row || v.replace(/\D/g, "").length < 9) { setPrev([]); return; }
    const list = await lookupCallPhone(v);
    setPrev(list);
    const last = list[0], form = ref.current;
    if (!last || !form) return;
    // Foydalanuvchi yozgani qoladi, bo'sh maydon oxirgi qo'ng'iroqdan olinadi
    const cur = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
    const pick = (name: string, value: string | number | null) => cur(name) || (value == null ? "" : String(value));
    setAuto((a) => ({ n: a.n + 1, fullName: pick("fullName", last.fullName), address: pick("address", last.address), age: pick("age", last.age) }));
  }

  return (
    <form ref={ref} action={act} className="space-y-3">
      <datalist id="call-positions">{positions.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[150px_1.2fr_1fr_1.2fr]">
        <Field label="Sana *"><Input type="date" name="date" required defaultValue={row?.date ?? today} max={today} /></Field>
        <Field label="Lavozim *"><Input name="position" required list="call-positions" defaultValue={row?.position} placeholder="Beton qoliplovchi" autoComplete="off" /></Field>
        <Field label="Telefon *"><Input type="tel" name="phone" required defaultValue={row?.phone ?? ""} placeholder="90 123 45 67" autoComplete="off" onBlur={(e) => checkPhone(e.currentTarget.value)} /></Field>
        <Field label="Ismi"><Input key={`n${auto.n}`} name="fullName" defaultValue={auto.fullName ?? row?.fullName ?? ""} autoComplete="off" /></Field>
      </div>
      {prev.length > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><History size={13} /> Bu raqam oldin {prev.length === 5 ? "5 martadan ko'p" : `${prev.length} marta`} qo&apos;ng&apos;iroq qilgan</div>
          {prev.map((p) => (
            <div key={p.id}>{day(p.date)} · {p.position}{p.fullName ? ` · ${p.fullName}` : ""} — {CALL_STATUS_LABEL[p.status]}{p.reason ? ` (${p.reason})` : ""}</div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[1.4fr_90px_170px_160px_1.6fr]">
        <Field label="Yashash manzili"><Input key={`a${auto.n}`} name="address" defaultValue={auto.address ?? row?.address ?? ""} placeholder="Mahalla, ko'cha" /></Field>
        <Field label="Yoshi"><Input key={`y${auto.n}`} type="number" name="age" min={14} max={90} defaultValue={auto.age ?? row?.age ?? undefined} /></Field>
        <Field label="Suhbat">
          <Select name="status" value={status} onChange={(e) => setStatus(e.target.value as HrCallStatus)}>
            {CALL_STATUSES.map((k) => <option key={k} value={k}>{CALL_STATUS_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Qachon keladi" hint={status === "WAITING" ? undefined : "Faqat «Keladi» uchun"}>
          <Input type="date" name="visitDate" defaultValue={row?.visitDate ?? ""} disabled={status !== "WAITING"} />
        </Field>
        <Field label="Sababi / izoh" className="sm:col-span-2 xl:col-span-1"><Input name="reason" maxLength={300} defaultValue={row?.reason ?? ""} placeholder="Masalan: maosh to'g'ri kelmadi" /></Field>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok && !onDone ? state.note : undefined} />
      <div className="flex gap-2">
        <Button disabled={pending}>{row ? "Saqlash" : <><Plus size={14} /> Jurnalga yozish</>}</Button>
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Bekor</Button>}
      </div>
    </form>
  );
}

/** Jadvaldagi holat: ruxsati borga tanlov (darhol saqlanadi), qolganlarga yorliq. */
function StatusCell({ row, editable, today }: { row: CallRowData; editable: boolean; today: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const router = useRouter();
  const visit = row.status === "WAITING" && row.visitDate;
  return (
    <div className="min-w-[130px]">
      {editable ? (
        <select
          aria-label="Suhbat holati"
          value={row.status}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value as HrCallStatus;
            start(async () => { const r = await setCallStatus(row.id, v); setErr(r?.error ?? ""); router.refresh(); });
          }}
          className={cn("select-caret h-8 w-full appearance-none rounded-md border border-slate-200 bg-white pl-2 pr-7 text-xs font-medium focus:border-brand-500 focus:outline-none", pending && "opacity-60")}
        >
          {CALL_STATUSES.map((k) => <option key={k} value={k}>{CALL_STATUS_LABEL[k]}</option>)}
        </select>
      ) : <Badge color={CALL_STATUS_BADGE[row.status]}>{CALL_STATUS_LABEL[row.status]}</Badge>}
      {visit && (
        <div className={cn("mt-1 text-xs", row.visitDate === today ? "font-medium text-amber-700" : row.visitDate! < today ? "text-red-600" : "text-slate-500")}>
          {row.visitDate === today ? "Bugun keladi" : `${day(row.visitDate!)} ga va'da`}
        </div>
      )}
      {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
    </div>
  );
}

/**
 * Jurnal qatori. Sana guruhning birinchi qatorida (Excel'dagi birlashtirilgan katakdek), № — shu kun ichida.
 * `times` — shu telefon necha marta qo'ng'iroq qilgani (shu qatorgacha).
 */
export function CallRow({ row, no, first, times, cols, editable, canHire, positions, today }: {
  row: CallRowData; no: number; first: boolean; times: number; cols: number;
  editable: boolean; canHire: boolean; positions: string[]; today: string;
}) {
  const [edit, setEdit] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  // Ixcham katak; kun guruhi qalin chiziqdan boshlanadi (Excel'dagi bo'sh qator o'rniga)
  const cell = cn("px-3", first && "border-t-2 border-t-slate-200");
  return (
    <>
      <Tr className={cn(row.status === "HIRED" && "bg-emerald-50/50")}>
        <Td className={cn("whitespace-nowrap align-top", cell)}>{first ? day(row.date) : ""}{row.time && <span className={cn("text-xs text-slate-500 tabular", first && "ml-1.5")}>{row.time}</span>}</Td>
        <Td className={cn("align-top", cell)}>{row.position}</Td>
        <Td right className={cn("align-top text-slate-500", cell)}>{no}</Td>
        <Td className={cn("whitespace-nowrap align-top", cell)}>
          {row.phone ? <a href={`tel:${row.phone}`} className="tabular hover:underline">{localPhone(row.phone)}</a> : "—"}
          {times > 1 && <div className="mt-0.5"><Badge color="violet">{times}-marta</Badge></div>}
        </Td>
        <Td className={cn("align-top font-medium text-slate-900", cell)}>{row.fullName ?? <span className="font-normal text-slate-400">—</span>}</Td>
        <Td className={cn("align-top", cell)}>{row.address ?? <span className="text-slate-400">—</span>}</Td>
        <Td right className={cn("align-top", cell)}>{row.age ?? "—"}</Td>
        <Td className={cn("align-top", cell)}><StatusCell row={row} editable={editable} today={today} /></Td>
        <Td className={cn("align-top text-sm", cell)}>
          {row.reason ?? <span className="text-slate-400">—</span>}
          {row.status === "HIRED" && canHire && (
            <div className="mt-1">
              <Link href={`/otdel-kadr/yangi?qongiroq=${row.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><UserPlus size={13} /> Xodim kartasini ochish</Link>
            </div>
          )}
        </Td>
        {editable && (
          <Td right className={cn("align-top", cell)}>
            <span className="flex justify-end gap-1">
              <IconButton icon={Pencil} label="Tahrirlash" type="button" onClick={() => setEdit((v) => !v)} />
              <IconButton
                icon={Trash2}
                label="O'chirish"
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`${row.fullName ?? (row.phone ? formatPhone(row.phone) : "Yozuv")} — jurnaldan o'chirilsinmi?`)) return;
                  start(async () => { await deleteCallLog(row.id); router.refresh(); });
                }}
              />
            </span>
          </Td>
        )}
      </Tr>
      {edit && (
        <tr>
          <td colSpan={cols} className="border-t border-slate-100 bg-slate-50/70 px-4 py-4">
            <CallForm row={row} positions={positions} today={today} onDone={() => setEdit(false)} />
          </td>
        </tr>
      )}
    </>
  );
}
