"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Ban, Clock, Loader2, Pencil, Trash2, UserRound, X } from "lucide-react";
import { Badge, Button, DL, FormError, Input } from "@/components/ui";
import { ActivityLog } from "@/components/activity-log";
import { cn } from "@/lib/utils";
import { dateTime, money } from "@/lib/format";
import { isAccessDenied } from "@/lib/access-denied";
import { cancelCashRow, cashRowInfo, deleteCashRow } from "./actions";
import { CashEditDialog } from "./cash-edit";
import { RegisterDialog } from "./register-edit";
import type { CashRowDetail, CashRowKind, RowBtn } from "./row-detail";

/**
 * Kassa / bank jadvallaridagi qator (Kassa jurnali, To'lovlar, Realizatsiya jurnali): bosilsa (yoki Enter) — tafsilot
 * oynasi. Qator ichidagi havola, tugma va maydonlar o'z ishini qiladi; matn belgilanayotganda oyna ochilmaydi.
 */
export function CashRow({ kind, id, className, children }: { kind: CashRowKind; id: string; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <tr
        tabIndex={0}
        aria-haspopup="dialog"
        title="Batafsil — bosing"
        className={cn("ui-tr cursor-pointer focus-visible:bg-brand-50 focus-visible:outline-none", className)}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
          if (window.getSelection()?.toString()) return;
          setOpen(true);
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setOpen(true); }}
      >
        {children}
      </tr>
      {open && <CashDetail kind={kind} id={id} onClose={close} />}
    </>
  );
}

const TONE = { in: "text-emerald-700", out: "text-red-600", transfer: "text-sky-700" } as const;
const SIGN = { in: "+", out: "−", transfer: "" } as const;
const DENIED = "Bu amal uchun ruxsatingiz yo'q — direktordan ruxsat so'rang";

/**
 * Tafsilot oynasi: barcha ustunlar, kim va qachon kiritgani, amallar tarixi; pastda Tahrirlash, Bekor qilish, O'chirish
 * (server qaysi biri ruxsat etilganini va nega bosilmasligini aytadi — `row-detail.ts`). Tahrir oynasi yopilgach
 * tafsilot qayta o'qiladi (yangi qiymat va tarix bilan).
 */
function CashDetail({ kind, id, onClose }: { kind: CashRowKind; id: string; onClose: () => void }) {
  const [data, setData] = useState<CashRowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [ask, setAsk] = useState<"cancel" | "remove" | null>(null);
  const [why, setWhy] = useState("");
  const [actErr, setActErr] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    cashRowInfo(kind, id)
      .then((r) => {
        if (!alive) return;
        if (r.data) { setData(r.data); setError(null); } else setError(r.error ?? "Ma'lumot o'qilmadi");
      })
      .catch((e) => { if (alive) setError(isAccessDenied(e) ? DENIED : "Ma'lumot o'qilmadi — sahifani yangilab qayta urining"); });
    return () => { alive = false; };
  }, [kind, id, reload]);

  const backFromEdit = useCallback(() => { setEditing(false); setReload((n) => n + 1); }, []);
  const closeAsk = () => { setAsk(null); setWhy(""); setActErr(undefined); };

  useEffect(() => {
    if (editing) return; // tahrir oynasi o'zi Esc ni ushlaydi
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Sabab so'ralayotgan bo'lsa — avval shu yopiladi
      if (ask) { setAsk(null); setWhy(""); setActErr(undefined); } else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, ask, onClose]);

  const run = () => {
    const mode = ask;
    if (!mode || why.trim().length < 3) return;
    start(async () => {
      try {
        const res = mode === "cancel" ? await cancelCashRow(kind, id, why.trim()) : await deleteCashRow(kind, id, why.trim());
        if (res?.error) { setActErr(res.error); return; }
        if (mode === "remove") { onClose(); return; }
        closeAsk(); setDone(res?.note ?? "Bajarildi"); setReload((n) => n + 1);
      } catch (e) {
        setActErr(isAccessDenied(e) ? DENIED : "Amal bajarilmadi — sahifani yangilab qayta urining");
      }
    });
  };

  if (editing && data?.reg) return <RegisterDialog row={data.reg} onClose={backFromEdit} />;
  if (editing && data?.edit) return <CashEditDialog entry={data.edit} onClose={backFromEdit} />;

  const b = data?.buttons;
  const reasons = b ? ([["Tahrirlash", b.edit], ["Bekor qilish", b.cancel], ["O'chirish", b.remove]] as [string, RowBtn][]).filter((x): x is [string, string] => typeof x[1] === "string") : [];
  const title = data?.title ?? "Yozuv";

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>

        {!data && !error && <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Yuklanmoqda…</div>}
        {error && <FormError error={error} />}

        {data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={cn("text-2xl font-bold tracking-tight tabular", data.cancelled ? "text-slate-400 line-through" : TONE[data.tone])}>
                {SIGN[data.tone]}{money(data.amount)}
              </div>
              {data.cancelled && <Badge color="slate">Bekor qilingan</Badge>}
            </div>
            {data.cancelled && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Bekor qilindi: {data.cancelled}</p>}

            {/* Kim va qachon kiritgan — eng ko'p so'raladigan ma'lumot, alohida ajratilgan */}
            <div className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm sm:grid-cols-2">
              <div className="flex min-w-0 items-center gap-2">
                <UserRound size={15} className="shrink-0 text-slate-400" />
                <span className="text-slate-500">Kiritdi:</span>
                <span className="truncate font-medium text-slate-900">{data.createdBy ?? "noma'lum (eski yozuv)"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={15} className="shrink-0 text-slate-400" />
                <span className="text-slate-500">Kiritilgan vaqt:</span>
                <span className="font-medium text-slate-900 tabular">{dateTime(data.createdAt)}</span>
              </div>
            </div>

            <DL items={data.fields.map((f) => ({ k: f.label, v: f.href ? <Link href={f.href} className="hover:underline">{f.value}</Link> : f.value }))} />

            <ActivityLog rows={data.history} />

            {done && !ask && <p className="text-sm font-medium text-emerald-700">{done}</p>}

            {ask ? (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3">
                <p className="text-sm font-medium text-red-800">{ask === "cancel" ? "Yozuv bekor qilinsinmi? U jurnalda «bekor qilingan» bo'lib qoladi." : "Yozuv butunlay o'chirilsinmi? Jurnaldan olinadi, Amallar tarixida qoladi."}</p>
                <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Sabab (majburiy)" aria-label="Sabab" autoFocus maxLength={300}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(); } }} />
                <FormError error={actErr} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={closeAsk} disabled={pending}>Yo&apos;q</Button>
                  <Button type="button" variant="danger" onClick={run} disabled={pending || why.trim().length < 3}>
                    {pending ? "Bajarilmoqda…" : ask === "cancel" ? "Ha, bekor qilish" : "Ha, o'chirish"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap gap-2">
                  {b && b.edit !== false && (
                    <Button type="button" onClick={() => { setDone(undefined); setEditing(true); }} disabled={b.edit !== null || (!data.edit && !data.reg)}><Pencil size={15} /> Tahrirlash</Button>
                  )}
                  {b && b.cancel !== false && (
                    <Button type="button" variant="secondary" onClick={() => { setDone(undefined); setAsk("cancel"); }} disabled={b.cancel !== null}><Ban size={15} /> Bekor qilish</Button>
                  )}
                  {b && b.remove !== false && (
                    <Button type="button" variant="secondary" className="text-red-600 hover:text-red-700" onClick={() => { setDone(undefined); setAsk("remove"); }} disabled={b.remove !== null}><Trash2 size={15} /> O&apos;chirish</Button>
                  )}
                </div>
                <Button type="button" variant="secondary" onClick={onClose}>Yopish</Button>
              </div>
            )}

            {(reasons.length > 0 || data.notes.length > 0) && (
              <ul className="space-y-0.5 text-xs text-slate-500">
                {reasons.map(([k, v]) => <li key={k}><b className="font-medium text-amber-700">{k}:</b> {v}</li>)}
                {(b?.cancel !== false || b?.remove !== false) && data.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  ), document.body);
}
