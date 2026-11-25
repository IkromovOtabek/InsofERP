"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Check, Clock, Loader2, Package, Pencil, Trash2, UserRound, Warehouse, X } from "lucide-react";
import { Badge, FormError } from "@/components/ui";
import { cn } from "@/lib/utils";
import { dateRu, dateTime, qty } from "@/lib/format";
import { isAccessDenied } from "@/lib/access-denied";
import type { YardDir, YardEdit, YardMoveRow, YardMoves } from "@/lib/yard-moves";

/** Oynani ochish uchun so'rov: qaysi mahsulot, qaysi ombor (brigada id / "" umumiy / "*" butun sklad), yo'nalish, davr */
export type YardMovesQuery = { productId: string; owner: string; dir: YardDir; from?: string; to?: string };
type Load = (q: YardMovesQuery) => Promise<{ data?: YardMoves; error?: string }>;
type Done = Promise<{ ok?: true; error?: string }>;
/** Yozuvni tahrirlash / o'chirish (Sklad → Tayyor mahsulotlar); huquq — `data.can` (server beradi) */
export type YardMoveEditors = { edit?: (id: string, input: YardEdit) => Done; remove?: (id: string) => Done };

const DIR_TITLE: Record<YardDir, string> = { in: "Kirim", out: "Chiqim", all: "Harakatlar" };
const DENIED = "Bu ma'lumotni ko'rishga ruxsatingiz yo'q — direktordan ruxsat so'rang";

/**
 * Hovli katagi (yoki zayavkadagi brigada ombori) bosilganda — kassa/bank tafsilot oynasi uslubida: har harakat qaysi kunga
 * yozilgani, kim kiritgani va soat nechada, hujjati (reys, topshiriq, qo'lda kirim, ko'chirish). Ma'lumot oyna ochilganda
 * serverdan o'qiladi (`lib/yard-moves.ts`) — sahifaga oldindan yuborilmaydi.
 */
export function YardMovesDialog({ query, load, onClose, periodLabel, editors }: { query: YardMovesQuery; load: Load; onClose: () => void; periodLabel?: string | null; editors?: YardMoveEditors }) {
  const [data, setData] = useState<YardMoves | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tahrir/o'chirishdan keyin oyna qayta o'qiladi, orqadagi jadval yangilanadi
  const [version, setVersion] = useState(0);
  const router = useRouter();
  const changed = useCallback(() => { setVersion((v) => v + 1); router.refresh(); }, [router]);

  useEffect(() => {
    let alive = true;
    load(query)
      .then((r) => { if (!alive) return; if (r.data) setData(r.data); else setError(r.error ?? "Ma'lumot o'qilmadi"); })
      .catch((e) => { if (alive) setError(isAccessDenied(e) ? DENIED : "Ma'lumot o'qilmadi — sahifani yangilab qayta urining"); });
    return () => { alive = false; };
  }, [load, query, version]);

  useEffect(() => {
    // Tahrirlanayotgan qatorda Escape — faqat tahrirni bekor qiladi (qatorning o'zi ushlaydi)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof Element && e.target.closest("[data-editing]"))) { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const unit = data?.product.unit ?? "";
  const canEdit = !!(editors?.edit && data?.can?.edit), canDel = !!(editors?.remove && data?.can?.del);
  const title = data ? `${data.product.name} — ${data.ownerName}` : DIR_TITLE[query.dir];

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-5xl space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              <Badge color={query.dir === "in" ? "green" : query.dir === "out" ? "red" : "slate"} dot={false}>{DIR_TITLE[query.dir]}</Badge>
            </div>
            {periodLabel && <p className="mt-0.5 text-xs text-slate-500">{periodLabel}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>

        {!data && !error && <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Yuklanmoqda…</div>}
        {error && <FormError error={error} />}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {query.dir !== "out" && <Stat icon={ArrowDownToLine} k="Kirim" v={`${data.sumIn > 0 ? "+" : ""}${qty(data.sumIn)} ${unit}`} tone={data.sumIn > 0 ? "text-emerald-700" : "text-slate-900"} />}
              {query.dir !== "in" && <Stat icon={ArrowUpFromLine} k="Chiqim" v={`${data.sumOut > 0 ? "−" : ""}${qty(data.sumOut)} ${unit}`} tone={data.sumOut > 0 ? "text-red-600" : "text-slate-900"} />}
              <Stat icon={Package} k="Yozuvlar" v={`${data.count} ta`} tone="text-slate-900" />
              <Stat icon={Warehouse} k="Hozirgi qoldiq" v={`${qty(data.balance)} ${unit}`} tone={data.balance < 0 ? "text-red-600" : "text-slate-900"} />
            </div>

            {data.rows.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">Bu davrda harakat yo&apos;q</p>
            ) : (
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[760px] border-collapse text-[13px]">
                  <thead className="sticky top-0 z-[1] bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Sana</th>
                      <th className="px-3 py-2 font-medium">Amal</th>
                      <th className="px-3 py-2 text-right font-medium">Miqdor</th>
                      {query.owner === "*" && <th className="px-3 py-2 font-medium">Ombor</th>}
                      <th className="px-3 py-2 font-medium">Hujjat</th>
                      <th className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-1"><UserRound size={13} /> Kim kiritdi</span></th>
                      <th className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-1"><Clock size={13} /> Kiritilgan vaqt</span></th>
                      {(canEdit || canDel) && <th className="px-3 py-2"><span className="sr-only">Amal</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <MoveRow key={r.id} r={r} unit={unit} all={query.owner === "*"} canEdit={canEdit} canDel={canDel} editors={editors} onChanged={changed} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.count > data.rows.length && <p className="text-xs text-slate-500">Oxirgi {data.rows.length} ta yozuv ko&apos;rsatildi (jami {data.count} ta) — davrni qisqartiring.</p>}
            <div className="flex justify-end border-t border-slate-100 pt-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Yopish</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}

/** Bitta harakat qatori: ko'rinish, tahrir (miqdor, sana, izoh) yoki o'chirishni tasdiqlash. */
function MoveRow({ r, unit, all, canEdit, canDel, editors, onChanged }: {
  r: YardMoveRow; unit: string; all: boolean; canEdit: boolean; canDel: boolean; editors?: YardMoveEditors; onChanged: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "del">("view");
  const [draft, setDraft] = useState({ qty: "", date: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const local = new Date(r.date);
  const dayStr = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  const open = () => { setDraft({ qty: String(Math.abs(r.qty)), date: dayStr, note: r.rawNote ?? "" }); setErr(null); setMode("edit"); };
  const cancel = () => { setErr(null); setMode("view"); };
  const finish = (p: Done) => start(async () => {
    try {
      const res = await p;
      if (res.error) setErr(res.error);
      else { setMode("view"); onChanged(); }
    } catch (e) {
      setErr(isAccessDenied(e) ? "Bu amal uchun ruxsatingiz yo'q — direktordan so'rang" : "Saqlanmadi — qayta urining");
    }
  });
  const save = () => {
    const q = Number(draft.qty.replace(",", "."));
    if (!Number.isFinite(q) || q <= 0) { setErr("Miqdor 0 dan katta bo'lsin"); return; }
    finish(editors!.edit!(r.id, { qty: q, date: draft.date, note: draft.note }));
  };
  const inp = "h-8 rounded-md border border-slate-300 bg-white px-2 text-[13px] outline-none focus:border-slate-900";
  const editing = mode === "edit";
  return (
    <tr data-editing={mode !== "view" || undefined} className={cn("border-t border-slate-100 align-top", r.storno && "text-slate-400", mode !== "view" && "bg-amber-50/60")}>
      <td className="px-3 py-2 whitespace-nowrap tabular">
        {editing ? <input type="date" aria-label="Sana" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={cn(inp, "w-36")} /> : dateRu(local)}
      </td>
      <td className="px-3 py-2">
        <div className="font-medium text-slate-900">{r.kind}{r.storno && <span className="ml-1.5 align-middle"><Badge dot={false}>bekor qilish</Badge></span>}</div>
        {editing
          ? <input aria-label="Izoh" value={draft.note} maxLength={300} placeholder="Izoh" onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={cn(inp, "mt-1 w-full min-w-48")} />
          : r.note && <div className="mt-0.5 max-w-80 text-xs text-slate-500 [overflow-wrap:anywhere]">{r.note}</div>}
        {err && <div role="alert" className="mt-1 text-xs font-medium text-red-600">{err}</div>}
        {mode === "del" && !err && <div className="mt-1 text-xs font-medium text-red-700">Yozuv skladdan butunlay o&apos;chadi — qoldiq qayta hisoblanadi.</div>}
      </td>
      <td className={cn("px-3 py-2 text-right font-semibold whitespace-nowrap tabular", r.qty > 0 ? "text-emerald-700" : "text-red-600")}>
        {editing
          ? <span className="inline-flex items-center gap-1">{r.qty > 0 ? "+" : "−"}<input inputMode="decimal" aria-label="Miqdor" value={draft.qty} autoFocus onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); } }}
              className={cn(inp, "w-24 text-right tabular")} /></span>
          : <>{r.qty > 0 ? "+" : "−"}{qty(Math.abs(r.qty))} <span className="font-normal text-slate-400">{unit}</span></>}
      </td>
      {all && <td className="px-3 py-2 text-slate-600">{r.owner}</td>}
      <td className="px-3 py-2 text-slate-600">
        {r.doc ? (r.doc.href ? <Link href={r.doc.href} className="hover:underline">{r.doc.label}</Link> : r.doc.label) : "—"}
        {r.warehouse && <div className="text-[11px] text-slate-400">{r.warehouse}</div>}
      </td>
      <td className="px-3 py-2 font-medium text-slate-900">{r.who ?? "noma'lum"}</td>
      <td className="px-3 py-2 whitespace-nowrap text-slate-600 tabular">{dateTime(new Date(r.createdAt))}</td>
      {(canEdit || canDel) && (
        <td className="px-2 py-1.5 whitespace-nowrap">
          {mode === "view" && (
            <span className="inline-flex gap-0.5">
              {canEdit && <IconBtn label="Tahrirlash" onClick={open}><Pencil size={14} /></IconBtn>}
              {canDel && <IconBtn label="O'chirish" danger onClick={() => { setErr(null); setMode("del"); }}><Trash2 size={14} /></IconBtn>}
            </span>
          )}
          {editing && (
            <span className="inline-flex gap-0.5">
              <IconBtn label="Saqlash" onClick={save} disabled={pending}>{pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}</IconBtn>
              <IconBtn label="Bekor" onClick={cancel} disabled={pending}><X size={14} /></IconBtn>
            </span>
          )}
          {mode === "del" && (
            <span className="inline-flex items-center gap-1">
              <button type="button" disabled={pending} onClick={() => finish(editors!.remove!(r.id))}
                className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">{pending ? "O'chirilmoqda…" : "O'chirish"}</button>
              <button type="button" disabled={pending} onClick={cancel} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Yo&apos;q</button>
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

function IconBtn({ label, onClick, children, danger, disabled }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={cn("rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50", danger ? "hover:text-red-600" : "hover:text-slate-900")}>
      {children}
    </button>
  );
}

function Stat({ icon: Icon, k, v, tone }: { icon: React.ComponentType<{ size?: number; className?: string }>; k: string; v: string; tone: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-slate-500"><Icon size={13} className="text-slate-400" /> {k}</div>
      <div className={cn("mt-0.5 text-lg font-bold tabular", tone)}>{v}</div>
    </div>
  );
}

/**
 * Jadvaldagi kataklar uchun bitta umumiy oyna: katak ichidagi `<button data-ym-p="<mahsulot>" data-ym-o="<ombor>" data-ym-d="in|out|all">`
 * bosilganda (hodisa delegatsiyasi) shu oyna ochiladi. Har katak alohida klient komponent emas — katta jadval yengil qoladi.
 */
export function YardMovesHost({ children, load, from, to, periodLabel, balanceLabel, edit, remove }: {
  children: React.ReactNode; load: Load; from?: string; to?: string; periodLabel?: string | null;
  /** Qoldiq katagi (`all`) sarlavhasi: qoldiq — davr oxirigacha barcha harakatlar, davr boshidan oldingilari ham */
  balanceLabel?: string | null;
} & YardMoveEditors) {
  const [q, setQ] = useState<YardMovesQuery | null>(null);
  const close = useCallback(() => setQ(null), []);
  return (
    <div onClick={(e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-ym-p]");
      if (!el || !e.currentTarget.contains(el)) return;
      e.preventDefault();
      const d = el.dataset.ymD;
      const dir: YardDir = d === "in" || d === "out" ? d : "all";
      // Qoldiq = davr oxirigacha hamma harakat yig'indisi — oynada ham davr boshidan oldingi yozuvlar (boshlang'ich qoldiq) ko'rinsin
      setQ({ productId: el.dataset.ymP!, owner: el.dataset.ymO ?? "", dir, from: dir === "all" ? undefined : from, to });
    }}>
      {children}
      {q && <YardMovesDialog query={q} load={load} onClose={close} periodLabel={q.dir === "all" ? (balanceLabel ?? periodLabel) : periodLabel} editors={{ edit, remove }} />}
    </div>
  );
}
