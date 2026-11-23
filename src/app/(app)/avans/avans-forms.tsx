"use client";

import { Fragment, useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCheck, FilePlus2, HandCoins, Loader2, RefreshCw, Save, Search, Send, Undo2, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum, money, numText } from "@/lib/format";
import type { ActionState } from "@/lib/action";
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { ConfirmButton } from "../payments/confirm-button";
import {
  closeAdvanceSheetAction, createAdvanceSheetAction, giveAdvanceAction, recallAdvanceSheetAction, refreshAdvanceSheetAction,
  saveAdvanceAmountsAction, sendAdvanceSheetAction, ungiveAdvanceAction,
} from "./actions";

/** Varaqa qatori (sahifadan): sanalar serverda matn qilib beriladi — server va brauzer bir xil ko'rsatsin. */
export type AdvLine = {
  id: string; fullName: string; position: string; groupLabel: string;
  earned: number; suggested: number; amount: number;
  given: string | null; givenBy: string | null; canUndo: boolean;
};

const toNum = (v: string) => { const t = numText(v.trim()); const n = t ? Number(t) : 0; return Number.isFinite(n) ? n : 0; };
/** Guruh sarlavhasi bilan qatorlar (Excel'dagi bo'limlar kabi). */
const withGroups = <T extends { groupLabel: string }>(rows: T[]) => rows.map((r, i) => ({ r, head: i === 0 || rows[i - 1]!.groupLabel !== r.groupLabel }));

// ───────────────────────── Yangi varaqa ─────────────────────────

export function NewAdvanceForm({ groups }: { groups: { key: string; label: string }[] }) {
  const [state, act, pending] = useActionState(createAdvanceSheetAction, undefined);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <Field label="Kimlar uchun" className="min-w-64">
        <Select name="group" defaultValue="">
          <option value="">Barcha xodimlar</option>
          {groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </Select>
      </Field>
      <Button disabled={pending}><FilePlus2 size={15} /> {pending ? "Hisoblanmoqda…" : "Yangi avans varaqasi"}</Button>
      <FormError error={state?.error} />
    </form>
  );
}

// ───────────────────────── Bitta tugmali amallar ─────────────────────────

export function RunButton({ run, label, icon: Icon, variant = "secondary", confirm }: { run: () => Promise<ActionState>; label: string; icon: LucideIcon; variant?: "primary" | "secondary" | "success" | "ghost"; confirm?: string }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant={variant} size="sm" disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => { const r = await run(); setState(r); if (r?.ok) router.refresh(); });
      }}><Icon size={14} /> {pending ? "…" : label}</Button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </span>
  );
}

export function SheetButtons({ id, can }: { id: string; can: { refresh?: boolean; recall?: boolean; close?: boolean } }) {
  return (
    <>
      {can.refresh && <RunButton run={() => refreshAdvanceSheetAction(id)} label="Bugungi holatga yangilash" icon={RefreshCw} />}
      {can.recall && <RunButton run={() => recallAdvanceSheetAction(id)} label="Qaytarib olish (tahrir uchun)" icon={Undo2} confirm="Varaqa qoralamaga qaytadi — qabul qiluvchi uni ko'rmaydi. Davom etilsinmi?" />}
      {can.close && <RunButton run={() => closeAdvanceSheetAction(id)} label="Varaqani yopish" icon={CheckCheck} confirm="Berilmagan xodimlarga avans berilmaydi, varaqa yopiladi. Davom etilsinmi?" />}
    </>
  );
}

// ───────────────────────── Qoralama: avansni yozish, saqlash, jo'natish ─────────────────────────

export function AdvanceEditor({ id, lines, recipients }: { id: string; lines: AdvLine[]; recipients: { id: string; fullName: string; role: string }[] }) {
  const router = useRouter();
  const init = useMemo(() => Object.fromEntries(lines.map((l) => [l.id, l.amount ? String(l.amount) : ""])), [lines]);
  const [vals, setVals] = useState<Record<string, string>>(init);
  const [q, setQ] = useState("");
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();
  const [sendOpen, setSendOpen] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => { setVals(init); }, [init]);

  const dirty = lines.some((l) => (vals[l.id] ?? "") !== init[l.id]);
  const items = () => lines.map((l) => ({ lineId: l.id, amount: vals[l.id] ?? "" }));
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return lines.filter((l) => !t || l.fullName.toLowerCase().includes(t) || l.groupLabel.toLowerCase().includes(t) || l.position.toLowerCase().includes(t));
  }, [lines, q]);
  const total = lines.reduce((s, l) => s + toNum(vals[l.id] ?? ""), 0);
  const count = lines.filter((l) => toNum(vals[l.id] ?? "") > 0).length;
  const fillSuggested = () => setVals((p) => { const o = { ...p }; for (const l of rows) if (!(o[l.id] ?? "").trim() && l.suggested > 0) o[l.id] = String(l.suggested); return o; });

  // Qatorlararo: Enter / ↓ — pastga, ↑ — tepaga
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    const d = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" || e.key === "Enter" ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-i="${i + d}"]`);
    if (el) { el.focus(); el.select(); }
  };
  // Excel'dan ustun nusxasi (bir nechta qator) — pastga qarab joylanadi
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, i: number) => {
    const text = e.clipboardData.getData("text/plain").replace(/\r/g, "").replace(/\n$/, "");
    if (!text.includes("\n")) return;
    e.preventDefault();
    const next: Record<string, string> = {};
    text.split("\n").forEach((v, j) => { const r = rows[i + j]; if (r) next[r.id] = v.split("\t")[0]!.trim(); });
    setVals((p) => ({ ...p, ...next }));
  };

  const save = () => start(async () => { const r = await saveAdvanceAmountsAction(id, items()); setState(r); if (r?.ok) router.refresh(); });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim, guruh yoki lavozim" className="h-9 w-64 pl-8" />
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={fillSuggested}><CheckCheck size={14} /> Bo&apos;sh kataklarga tavsiyani qo&apos;yish</Button>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">{count} xodim · <b className="text-slate-900">{money(total)}</b>{dirty && <span className="ml-2 text-amber-700">· saqlanmagan</span>}</span>
          <Button type="button" variant="secondary" size="sm" disabled={pending || !dirty} onClick={save}><Save size={14} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
          <Button type="button" size="sm" disabled={pending || total <= 0} onClick={() => setSendOpen(true)}><Send size={14} /> Jo&apos;natish</Button>
        </span>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
      <div className="relative max-w-full overflow-auto overscroll-contain rounded-(--radius-card) border border-slate-300/80 bg-white shadow-(--shadow-card)" style={{ maxHeight: "calc(100dvh - 330px)", minHeight: 260 }}>
        <table ref={tableRef} className="w-full border-separate border-spacing-0 text-[13px] tabular text-slate-800">
          <thead className="sticky top-0 z-20">
            <tr>
              <th className="w-10 border-r border-b border-slate-300 bg-slate-100 px-1 py-2 text-center font-semibold">№</th>
              <th className="min-w-60 border-r border-b border-slate-300 bg-slate-100 px-2 py-2 text-left font-semibold">F.I.O.</th>
              <th className="min-w-36 border-r border-b border-slate-300 bg-slate-100 px-2 py-2 text-right font-semibold">Ishlagan (oy boshidan)</th>
              <th className="min-w-32 border-r border-b border-slate-300 bg-slate-100 px-2 py-2 text-right font-semibold">Tavsiya</th>
              <th className="min-w-36 border-b border-slate-300 bg-emerald-50 px-2 py-2 text-right font-semibold">Avans</th>
            </tr>
          </thead>
          <tbody>
            {withGroups(rows).map(({ r, head }, i) => (
              <Fragment key={r.id}>
                {head && <tr><td colSpan={5} className="border-b border-slate-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">{r.groupLabel}</td></tr>}
                <tr className="group">
                  <td className="border-r border-b border-slate-200 px-1 text-center text-slate-500">{i + 1}</td>
                  <td className="border-r border-b border-slate-200 px-2 py-0.5"><div className="truncate font-medium text-slate-900">{r.fullName}</div><div className="truncate text-[11px] text-slate-500">{r.position}</div></td>
                  <td className="border-r border-b border-slate-200 px-2 text-right">{r.earned ? fmtNum(r.earned) : "—"}</td>
                  <td className="border-r border-b border-slate-200 px-2 text-right">
                    {r.suggested > 0
                      ? <button type="button" className="text-sky-700 hover:underline" title="Avans katagiga qo'yish" onClick={() => setVals((p) => ({ ...p, [r.id]: String(r.suggested) }))}>{fmtNum(r.suggested)}</button>
                      : <span className="text-slate-400">0</span>}
                  </td>
                  <td className="border-b border-slate-200 p-0">
                    <input data-i={i} value={vals[r.id] ?? ""} inputMode="decimal" autoComplete="off" aria-label={`${r.fullName} — avans`}
                      placeholder={r.suggested > 0 ? fmtNum(r.suggested) : ""}
                      onChange={(e) => setVals((p) => ({ ...p, [r.id]: e.target.value }))}
                      onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => onKey(e, i)} onPaste={(e) => onPaste(e, i)}
                      className="h-9 w-full bg-transparent px-2 text-right font-medium outline-none placeholder:font-normal placeholder:text-slate-300 placeholder:italic focus:bg-brand-50 focus:ring-2 focus:ring-brand-500 focus:ring-inset" />
                  </td>
                </tr>
              </Fragment>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Xodim topilmadi</td></tr>}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 font-semibold text-slate-900">
            <tr>
              <td className="border-t-2 border-r border-slate-300 bg-slate-100" />
              <td className="border-t-2 border-r border-slate-300 bg-slate-100 px-2 py-1.5">Jami ({count} xodim)</td>
              <td className="border-t-2 border-r border-slate-300 bg-slate-100 px-2 text-right">{fmtNum(lines.reduce((s, l) => s + l.earned, 0))}</td>
              <td className="border-t-2 border-r border-slate-300 bg-slate-100 px-2 text-right">{fmtNum(lines.reduce((s, l) => s + l.suggested, 0))}</td>
              <td className="border-t-2 border-slate-300 bg-emerald-50 px-2 text-right">{fmtNum(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {sendOpen && (
        <SendDialog recipients={recipients} count={count} total={total} onClose={() => setSendOpen(false)}
          onSend={async (recipientId, note) => {
            const r = await sendAdvanceSheetAction(id, recipientId, items(), note);
            if (r?.error) return r.error;
            setSendOpen(false); setState(r); router.refresh();
            return null;
          }} />
      )}
    </div>
  );
}

function SendDialog({ recipients, count, total, onClose, onSend }: {
  recipients: { id: string; fullName: string; role: string }[]; count: number; total: number; onClose: () => void;
  onSend: (recipientId: string, note: string) => Promise<string | null>;
}) {
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [pending, run] = useTransition();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <form role="dialog" aria-label="Avansni jo'natish" onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (!to) { setErr("Kimga jo'natilishini tanlang"); return; } run(async () => { const r = await onSend(to, note); if (r) setErr(r); }); }}
        className="w-full max-w-md space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Avansni jo&apos;natish</h2>
            <p className="text-sm text-slate-600">{count} xodim · <b className="text-slate-900">{money(total)}</b> — saqlanadi va jo&apos;natiladi</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>
        <Field label="Kimga (avansni beradigan xodim)" hint="Ro'yxatda — kassadan pul bera oladigan xodimlar. Unga bildirishnoma boradi, u har xodimga «Berildi» belgilaydi">
          <Select value={to} onChange={(e) => setTo(e.target.value)} required autoFocus>
            <option value="" disabled>— xodimni tanlang —</option>
            {recipients.map((u) => <option key={u.id} value={u.id}>{u.fullName} · {u.role}</option>)}
          </Select>
        </Field>
        <Field label="Izoh (ixtiyoriy)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Masalan: 15-noyabr avansi" /></Field>
        {!recipients.length && <p className="text-sm text-amber-700">Kassa huquqi bor faol xodim topilmadi — direktor Ruxsatlarda kassir / kirim-chiqim huquqini bersin.</p>}
        <FormError error={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button disabled={pending || !recipients.length}><Send size={16} /> {pending ? "Jo'natilmoqda…" : "Jo'natish"}</Button>
        </div>
      </form>
    </div>
  ), document.body);
}

// ───────────────────────── Jo'natilgan: «Berildi» (kassa) va ko'rish ─────────────────────────

export function AdvanceLines({ id, lines, accounts, canGive }: {
  id: string; lines: AdvLine[]; canGive: boolean;
  accounts: { id: string; name: string; type: string; balance: number }[];
}) {
  const router = useRouter();
  const act = lines.filter((l) => l.amount > 0);
  const open = act.filter((l) => !l.given);
  const [acc, setAcc] = useState(accounts.find((a) => a.type === "CASH")?.id ?? accounts[0]?.id ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<ActionState>(undefined);
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return act.filter((l) => !t || l.fullName.toLowerCase().includes(t) || l.groupLabel.toLowerCase().includes(t));
  }, [act, q]);
  const give = async (ids: string[] | null, key: string) => {
    if (!acc) { setState({ error: "Qaysi kassadan berilishini tanlang" }); return; }
    setBusy(key);
    const r = await giveAdvanceAction(id, acc, ids);
    setBusy(null); setState(r);
    if (r?.ok) { setPicked(new Set()); router.refresh(); }
  };
  const sel = open.filter((l) => picked.has(l.id));
  const selSum = (picked.size ? sel : open).reduce((s, l) => s + l.amount, 0);
  const balance = accounts.find((a) => a.id === acc)?.balance;

  return (
    <div className="space-y-2">
      {canGive && open.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <Field label="Qaysi kassadan" className="min-w-72">
            <Select value={acc} onChange={(e) => setAcc(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.type === "CASH" ? "naqd" : "bank"} · qoldiq {money(a.balance)}</option>)}
            </Select>
          </Field>
          <Button type="button" variant="success" disabled={!!busy} onClick={() => give(picked.size ? [...picked] : null, "all")}>
            {busy === "all" ? <Loader2 size={15} className="animate-spin" /> : <HandCoins size={15} />} {picked.size ? `${picked.size} xodimga berildi` : `Hammasiga berildi (${open.length})`} · {money(selSum)}
          </Button>
          {balance != null && selSum > balance && <span className="text-xs text-red-600">Kassada yetarli pul yo&apos;q</span>}
          <span className="text-xs text-slate-500">Har xodimga kassadan alohida «Ish haqi» chiqimi yoziladi</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim yoki guruh" className="h-9 w-64 pl-8" />
        </label>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
      <div className="relative max-w-full overflow-auto overscroll-contain rounded-(--radius-card) border border-slate-300/80 bg-white shadow-(--shadow-card)" style={{ maxHeight: "calc(100dvh - 330px)", minHeight: 220 }}>
        <table className="w-full border-separate border-spacing-0 text-[13px] tabular text-slate-800">
          <thead className="sticky top-0 z-20">
            <tr>
              {canGive && <th className="w-9 border-r border-b border-slate-300 bg-slate-100 px-1 py-2">
                <input type="checkbox" aria-label="Hammasini belgilash" checked={open.length > 0 && open.every((l) => picked.has(l.id))}
                  onChange={(e) => setPicked(e.target.checked ? new Set(open.map((l) => l.id)) : new Set())} className="h-4 w-4 rounded border-slate-300" />
              </th>}
              <th className="w-10 border-r border-b border-slate-300 bg-slate-100 px-1 py-2 text-center font-semibold">№</th>
              <th className="min-w-60 border-r border-b border-slate-300 bg-slate-100 px-2 py-2 text-left font-semibold">F.I.O.</th>
              <th className="min-w-32 border-r border-b border-slate-300 bg-slate-100 px-2 py-2 text-right font-semibold">Ishlagan</th>
              <th className="min-w-32 border-r border-b border-slate-300 bg-emerald-50 px-2 py-2 text-right font-semibold">Avans</th>
              <th className="min-w-56 border-b border-slate-300 bg-slate-100 px-2 py-2 text-left font-semibold">Holat</th>
            </tr>
          </thead>
          <tbody>
            {withGroups(rows).map(({ r, head }, i) => (
              <Fragment key={r.id}>
                {head && <tr><td colSpan={canGive ? 6 : 5} className="border-b border-slate-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">{r.groupLabel}</td></tr>}
                <tr className={cn(r.given && "bg-emerald-50/40")}>
                  {canGive && <td className="border-r border-b border-slate-200 px-1 text-center">
                    {!r.given && <input type="checkbox" aria-label={`${r.fullName} — belgilash`} checked={picked.has(r.id)} className="h-4 w-4 rounded border-slate-300"
                      onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />}
                  </td>}
                  <td className="border-r border-b border-slate-200 px-1 text-center text-slate-500">{i + 1}</td>
                  <td className="border-r border-b border-slate-200 px-2 py-1"><div className="truncate font-medium text-slate-900">{r.fullName}</div><div className="truncate text-[11px] text-slate-500">{r.position}</div></td>
                  <td className="border-r border-b border-slate-200 px-2 text-right">{r.earned ? fmtNum(r.earned) : "—"}</td>
                  <td className="border-r border-b border-slate-200 px-2 text-right font-semibold">{fmtNum(r.amount)}</td>
                  <td className="border-b border-slate-200 px-2 py-1">
                    {r.given
                      ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-emerald-700"><b>Berildi</b> · {r.given}{r.givenBy ? ` · ${r.givenBy}` : ""}</span>
                          {r.canUndo && <ConfirmButton action={(why) => ungiveAdvanceAction(id, r.id, why)} label="Qaytarish" reason="required" question="Avans qaytariladi: kassa chiqimi bekor qilinadi, qator yana berilmagan bo'ladi. Sababi?" className="text-xs" />}
                        </div>
                      )
                      : canGive
                        ? <Button type="button" size="sm" variant="secondary" disabled={!!busy} onClick={() => give([r.id], r.id)}>{busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <HandCoins size={13} />} Berildi</Button>
                        : <span className="text-slate-500">Berilmagan</span>}
                  </td>
                </tr>
              </Fragment>
            ))}
            {rows.length === 0 && <tr><td colSpan={canGive ? 6 : 5} className="px-3 py-8 text-center text-slate-500">Avans yozilgan xodim yo&apos;q</td></tr>}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 font-semibold text-slate-900">
            <tr>
              {canGive && <td className="border-t-2 border-r border-slate-300 bg-slate-100" />}
              <td className="border-t-2 border-r border-slate-300 bg-slate-100" />
              <td className="border-t-2 border-r border-slate-300 bg-slate-100 px-2 py-1.5">Jami ({act.length})</td>
              <td className="border-t-2 border-r border-slate-300 bg-slate-100 px-2 text-right">{fmtNum(act.reduce((s, l) => s + l.earned, 0))}</td>
              <td className="border-t-2 border-r border-slate-300 bg-emerald-50 px-2 text-right">{fmtNum(act.reduce((s, l) => s + l.amount, 0))}</td>
              <td className="border-t-2 border-slate-300 bg-slate-100 px-2 text-emerald-700">berildi {fmtNum(act.filter((l) => l.given).reduce((s, l) => s + l.amount, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
