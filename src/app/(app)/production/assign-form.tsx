"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { createPortal } from "react-dom";
import { Gauge, Send, TriangleAlert, X } from "lucide-react";
import { assignBrigades } from "./assign-actions";
import { Button, FormError, FormSuccess, Input, Select, Td, Th, Tr } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/** `left` — hali hech bir brigadaga berilmagan qismi; `tasks` — shu qatorga berilgan topshiriqlar (bir nechta brigada bo'lishi mumkin). */
type Item = { id: string; product: string; productId: string; qty: string; qtyNum: number; unit: string; left: number; tasks: { taskNo: string; brigade: string; qty: string; status: string }[] };
type Brigade = { id: string; name: string; leader: string | null };
export type BrigadeCap = {
  canMake: number;
  limiting: string | null;
  items: { name: string; unit: string; perUnit: number; have: number }[]; // retsept normasi va brigadadagi qoldiq
};
/** Mahsulot → brigada → shu brigadaning imkoni. */
export type Capacity = Record<string, Record<string, BrigadeCap>>;

/** To'lish chizig'i (zaryadka kabi): 0% qizil → 100% yashil. */
function Bar({ pct, className }: { pct: number; className?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  const tone = p >= 99.5 ? "bg-emerald-500" : p >= 60 ? "bg-lime-500" : p >= 30 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-100", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${p}%` }} />
    </div>
  );
}

/**
 * «Brigadalar imkoni» oynasi: tanlanayotgan mahsulot uchun har bir brigada
 * qo'lidagi xomashyo bilan qanchasini chiqara olishi — to'lish chiziqlari bilan.
 */
function CapacityModal({ open, onClose, item, brigades, capacity, onPick }: {
  open: boolean; onClose: () => void; item: Item | null;
  brigades: Brigade[]; capacity: Capacity; onPick: (brigadeId: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !mounted || !item) return null;

  const need = item.left;
  const rows = brigades
    .map((b) => ({ b, cap: capacity[item.productId]?.[b.id] ?? null }))
    .sort((x, y) => (y.cap?.canMake ?? 0) - (x.cap?.canMake ?? 0));

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-(--radius-card) border border-slate-200 bg-white shadow-(--shadow-pop)"
        onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Brigadalar imkoni">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Brigadalar imkoni</h2>
            <p className="text-sm text-slate-500">{item.product} · tayinlanmagan {fmtNum(item.left, 3)} {item.unit} (jami {item.qty})</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Yopish" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-5">
          {rows.length === 0 && <p className="text-sm text-slate-500">Faol brigada yo&apos;q.</p>}
          {rows.map(({ b, cap }) => {
            const can = cap?.canMake ?? 0;
            const pct = need > 0 ? (can / need) * 100 : can > 0 ? 100 : 0;
            const enough = can >= need - 0.0005;
            return (
              <div key={b.id} className={cn("rounded-xl border p-4", enough ? "border-emerald-200 bg-emerald-50/40" : can > 0 ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white")}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{b.name}</div>
                    <div className="text-xs text-slate-500">{b.leader ?? "brigadirsiz"}</div>
                  </div>
                  <div className="text-right">
                    <div className={cn("text-sm font-semibold", enough ? "text-emerald-700" : can > 0 ? "text-amber-700" : "text-red-600")}>
                      {fmtNum(can, 2)} {item.unit} chiqara oladi
                    </div>
                    <div className="text-xs text-slate-500">{fmtNum(Math.min(100, pct), 0)}% · kerak {fmtNum(need, 3)} {item.unit}</div>
                  </div>
                </div>
                <Bar pct={pct} className="mb-3 h-2.5" />

                {cap && cap.items.length > 0 ? (
                  <ul className="space-y-1.5">
                    {cap.items.map((m) => {
                      const needQty = m.perUnit * need;
                      const p = needQty > 0 ? (m.have / needQty) * 100 : 100;
                      return (
                        <li key={m.name} className="grid grid-cols-[minmax(110px,1fr)_minmax(90px,2fr)_auto] items-center gap-3 text-xs">
                          <span className="truncate text-slate-600">{m.name}</span>
                          <Bar pct={p} />
                          <span className={cn("shrink-0 tabular", p >= 99.5 ? "text-emerald-700" : p > 0 ? "text-amber-700" : "text-red-600")}>
                            {fmtNum(m.have, 2)} / {fmtNum(needQty, 2)} {m.unit}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">Mahsulotning faol retsepti yo&apos;q — imkoniyat hisoblanmaydi.</p>
                )}

                <div className="mt-3 flex justify-end">
                  <Button type="button" size="sm" variant={enough ? "success" : "secondary"} onClick={() => { onPick(b.id); onClose(); }}>
                    Shu brigadani tanlash
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-slate-200 px-5 py-2.5 text-xs text-slate-500">
          To&apos;lish chizig&apos;i — brigada qo&apos;lidagi xomashyoning shu zayavkaga yetishi. Yetmasa <b>Sklad → Brigadalar</b> bo&apos;limidan berasiz.
        </div>
      </div>
    </div>
  ), document.body);
}

/**
 * Brigada tayinlash. Har qatorda brigadalar "qancha ishlab chiqara oladi" bo'yicha tartiblanadi;
 * «Imkonini ko'rish» tugmasi butun ro'yxatni to'lish chiziqlari bilan ochadi.
 * Qatorning hammasini yoki bir qismini (miqdor maydoni) bir brigadaga berish mumkin — qolgani keyin boshqa brigadaga.
 * `focus` — matritsada bosilgan qator: ajratib ko'rsatiladi va ko'rinadigan joyga suriladi.
 */
export function AssignForm({ orderId, items, brigades, capacity, focus }: { orderId: string; items: Item[]; brigades: Brigade[]; capacity: Capacity; focus?: string }) {
  const [state, action, pending] = useActionState(assignBrigades.bind(null, orderId), undefined);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [modalFor, setModalFor] = useState<Item | null>(null);
  const focusRow = useRef<HTMLSpanElement>(null);
  useEffect(() => { focusRow.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focus]);
  const open = items.filter((i) => i.left > 0.0005);

  const capOf = (productId: string, brigadeId: string) => capacity[productId]?.[brigadeId] ?? null;
  const sorted = (productId: string) => [...brigades].sort((a, b) => (capOf(productId, b.id)?.canMake ?? 0) - (capOf(productId, a.id)?.canMake ?? 0));
  const num = (v: string | undefined, d: number) => { const n = Number(String(v ?? "").replace(/\s+/g, "").replace(",", ".")); return v === undefined || v === "" || !Number.isFinite(n) ? d : n; };
  // Brigada tanlangan qatorda miqdor: bo'sh / 0 / tayinlanmagan qismidan ko'p / dona uchun kasr — yuborib bo'lmaydi
  const amountErr = (i: Item): string | null => {
    if (!picked[i.id]) return null;
    const raw = String(amount[i.id] ?? +i.left.toFixed(3)).replace(/\s+/g, "").replace(",", ".");
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "Miqdorni kiriting — 0 dan katta son";
    if (n > i.left + 0.0005) return `Ko'pi bilan ${fmtNum(i.left, 3)} ${i.unit} — tayinlanmagan qismidan ko'p berib bo'lmaydi`;
    if (i.unit !== "m³" && !Number.isInteger(n)) return "Dona mahsulot miqdori butun son bo'lsin";
    return null;
  };
  const hasErr = items.some((i) => amountErr(i) !== null);

  return (
    <form action={action}>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text="Topshiriqlar brigadalarga yuborildi" />}
      {/* Telefonda (390px) jadval sahifani kengaytirmasin — o'zi yonga suriladi */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr><Th>Mahsulot</Th><Th right>Miqdor</Th><Th>Brigada va miqdor</Th><Th>Brigada imkoni</Th></tr></thead>
        <tbody>
          {items.map((i) => {
            const sel = picked[i.id] ?? "";
            const give = Math.min(i.left, Math.max(0, num(amount[i.id], i.left)));
            const cap = sel ? capOf(i.productId, sel) : null;
            const enough = cap ? cap.canMake >= give - 0.0005 : null;
            const pct = cap && give > 0 ? (cap.canMake / give) * 100 : 0;
            const isFocus = focus === i.id;
            return (
              <Tr key={i.id} className={cn(isFocus && "bg-brand-50/70 ring-2 ring-brand-400 ring-inset")}>
                <Td className="font-medium">{isFocus && <span ref={focusRow} />}{i.product}</Td>
                <Td right className="whitespace-nowrap">
                  {i.qty} {i.unit}
                  {i.tasks.length > 0 && <div className={cn("text-[11px]", i.left > 0.0005 ? "font-medium text-amber-700" : "text-emerald-700")}>{i.left > 0.0005 ? `tayinlanmagan ${fmtNum(i.left, 3)}` : "hammasi berilgan"}</div>}
                </Td>
                <Td>
                  {i.tasks.map((t) => (
                    <div key={t.taskNo} className="mb-1 text-xs text-slate-600"><span className="font-medium text-slate-800">{t.brigade}</span> · {t.qty} {i.unit} · {t.taskNo}{t.status === "DONE" ? " · bajarildi" : ""}</div>
                  ))}
                  {i.left > 0.0005 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Select name={`brigade_${i.id}`} value={sel} className="h-9 max-w-60 text-sm"
                        onChange={(e) => setPicked((p) => ({ ...p, [i.id]: e.target.value }))}>
                        <option value="">Tanlang…</option>
                        {sorted(i.productId).map((b) => {
                          const c = capOf(i.productId, b.id);
                          const can = c?.canMake ?? 0;
                          return <option key={b.id} value={b.id}>{b.name}{b.leader ? ` · ${b.leader}` : ""} — {can > 0 ? `${fmtNum(can, 2)} ${i.unit} chiqara oladi` : "xomashyosi yo'q"}</option>;
                        })}
                      </Select>
                      <label className="relative">
                        <span className="sr-only">Miqdor</span>
                        <Input name={`qty_${i.id}`} inputMode="decimal" value={amount[i.id] ?? String(+i.left.toFixed(3))} disabled={!sel}
                          onChange={(e) => setAmount((a) => ({ ...a, [i.id]: e.target.value }))}
                          aria-label={`${i.product} — brigadaga beriladigan miqdor`} aria-invalid={amountErr(i) ? true : undefined} className="h-9 w-32 pr-12 text-right tabular" />
                        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400">{i.unit}</span>
                      </label>
                      <Button type="button" variant="secondary" size="sm" title="Brigadalar imkonini ko'rish" onClick={() => setModalFor(i)}>
                        <Gauge size={15} /> Imkoni
                      </Button>
                      {amountErr(i) && <span role="alert" className="w-full text-xs font-medium text-red-600">{amountErr(i)}</span>}
                      {sel && !amountErr(i) && give < i.left - 0.0005 && give > 0 && <span className="w-full text-xs text-slate-500">Qolgan {fmtNum(i.left - give, 3)} {i.unit} keyin boshqa brigadaga beriladi</span>}
                    </div>
                  )}
                </Td>
                <Td className="min-w-48 text-xs">
                  {i.left <= 0.0005 ? <span className="text-slate-400">—</span>
                    : !sel ? <span className="text-slate-400">Brigada tanlang yoki «Imkoni» tugmasini bosing</span>
                    : (
                      <div className="space-y-1">
                        <Bar pct={pct} />
                        {enough
                          ? <span className="font-medium text-emerald-700">Yetadi · {fmtNum(cap?.canMake ?? 0, 2)} {i.unit} chiqara oladi</span>
                          : (
                            <span className="inline-flex items-start gap-1 font-medium text-amber-700">
                              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                              <span>
                                Faqat {fmtNum(cap?.canMake ?? 0, 2)} {i.unit} chiqadi ({fmtNum(Math.max(0, give - (cap?.canMake ?? 0)), 2)} {i.unit} yetmaydi)
                                {cap?.limiting ? <span className="block font-normal text-slate-500">Cheklovchi: {cap.limiting}</span> : null}
                              </span>
                            </span>
                          )}
                      </div>
                    )}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {open.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-4">
          <span className="text-xs text-slate-500">Xomashyo yetmasa ham tayinlash mumkin — skladdan <b>Sklad → Brigadalar</b> bo&apos;limi orqali berasiz</span>
          {hasErr && <span className="text-xs font-medium text-red-600">Miqdorni tuzating — keyin yuborish mumkin</span>}
          <Button disabled={pending || brigades.length === 0 || hasErr} variant="success"><Send size={16} /> {pending ? "Yuborilmoqda…" : "Tasdiqlash — brigadalarga yuborish"}</Button>
        </div>
      )}
      <CapacityModal open={!!modalFor} item={modalFor} brigades={brigades} capacity={capacity}
        onClose={() => setModalFor(null)} onPick={(bid) => modalFor && setPicked((p) => ({ ...p, [modalFor.id]: bid }))} />
    </form>
  );
}
