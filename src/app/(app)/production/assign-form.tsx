"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { createPortal } from "react-dom";
import { Gauge, Plus, Send, TriangleAlert, X } from "lucide-react";
import { assignBrigades } from "./assign-actions";
import { Button, FormError, FormSuccess, Input, Select, Td, Th, Tr } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/** `left` — hali hech bir brigadaga berilmagan qismi; `tasks` — shu qatorga berilgan topshiriqlar (bir nechta brigada bo'lishi mumkin). */
type Item = { id: string; product: string; productId: string; qty: string; qtyNum: number; unit: string; left: number; tasks: { id: string; brigade: string; qty: string; status: string }[] };
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
function CapacityModal({ open, onClose, item, need: needFor, brigades, capacity, onPick }: {
  open: boolean; onClose: () => void; item: Item | null;
  /** Tanlanayotgan qismning miqdori (qator bir nechta brigadaga bo'linganda); berilmasa — tayinlanmagan qismi */
  need?: number;
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

  const need = needFor ?? item.left;
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
            <p className="text-sm text-slate-500">{item.product} · shu brigadaga {fmtNum(need, 3)} {item.unit} · tayinlanmagan {fmtNum(item.left, 3)} (jami {item.qty})</p>
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

/** Qatorning bir brigadaga beriladigan qismi: brigada va miqdor. */
type Part = { key: number; brigade: string; qty: string };

/** Miqdor yozuvi: dona — «2 ta», boshqa birlik — «2,5 m²». */
const amt = (n: number, unit: string) => `${fmtNum(n, 3)} ${unit === "dona" ? "ta" : unit}`;
const parseNum = (v: string) => { const raw = v.replace(/\s+/g, "").replace(",", "."); return raw === "" ? NaN : Number(raw); };

/**
 * Brigada tayinlash. Har qatorda brigadalar "qancha ishlab chiqara oladi" bo'yicha tartiblanadi;
 * «Imkoni» tugmasi butun ro'yxatni to'lish chiziqlari bilan ochadi.
 * Qatorni bir nechta brigadaga bo'lish: miqdorni kamaytirasiz (10 dan 8 ta) — yonida «2 ta qoldi» chiqadi,
 * «Qator qo'shish» qolganini (2 ta) yangi qismga qo'yadi va boshqa brigadani tanlaysiz. Hammasi bitta «Tasdiqlash» bilan
 * yuboriladi — har qismga alohida topshiriq. Tayinlanmagan qism keyin ham beriladi.
 * `focus` — matritsada bosilgan qator: ajratib ko'rsatiladi va ko'rinadigan joyga suriladi.
 */
export function AssignForm({ orderId, items, brigades, capacity, focus }: { orderId: string; items: Item[]; brigades: Brigade[]; capacity: Capacity; focus?: string }) {
  const [state, action, pending] = useActionState(assignBrigades.bind(null, orderId), undefined);
  const [parts, setParts] = useState<Record<string, Part[]>>({});
  const [modalFor, setModalFor] = useState<{ item: Item; key: number; need: number } | null>(null);
  // Yuborilgach sahifa yangi qoldiq bilan qayta chiziladi — eski qismlar tozalanadi
  const [seen, setSeen] = useState(state);
  if (seen !== state) { setSeen(state); if (state?.ok) setParts({}); }
  const focusRow = useRef<HTMLSpanElement>(null);
  useEffect(() => { focusRow.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focus]);
  const open = items.filter((i) => i.left > 0.0005);

  const capOf = (productId: string, brigadeId: string) => capacity[productId]?.[brigadeId] ?? null;
  const sorted = (productId: string) => [...brigades].sort((a, b) => (capOf(productId, b.id)?.canMake ?? 0) - (capOf(productId, a.id)?.canMake ?? 0));
  // Sukut: bitta qism — tayinlanmagan qismining hammasi
  const partsOf = (i: Item): Part[] => parts[i.id] ?? [{ key: 0, brigade: "", qty: String(+i.left.toFixed(3)) }];
  const setItem = (i: Item, list: Part[]) => setParts((p) => ({ ...p, [i.id]: list }));
  const patch = (i: Item, key: number, x: Partial<Part>) => setItem(i, partsOf(i).map((r) => (r.key === key ? { ...r, ...x } : r)));
  /** Brigada tanlangan qismlarda berilayotgani: birinchi `count` qism bo'yicha (sukut — hammasi) */
  const given = (i: Item, count?: number) => partsOf(i).slice(0, count).filter((r) => r.brigade)
    .reduce((s, r) => s + (Number.isFinite(parseNum(r.qty)) ? Math.max(0, parseNum(r.qty)) : 0), 0);
  /** Tayinlanmay qolayotgani: birinchi `count` qismdan keyin (sukut — hammasidan keyin) */
  const rest = (i: Item, count?: number) => i.left - given(i, count);
  const addPart = (i: Item) => {
    const r = rest(i);
    setItem(i, [...partsOf(i), { key: Date.now(), brigade: "", qty: r > 0.0005 ? String(+r.toFixed(3)) : "" }]);
  };
  // Brigada tanlangan qismda miqdor: bo'sh / 0 / dona uchun kasr — yuborib bo'lmaydi
  const partErr = (i: Item, r: Part): string | null => {
    if (!r.brigade) return null;
    const n = parseNum(r.qty);
    if (!Number.isFinite(n) || n <= 0) return "Miqdorni kiriting — 0 dan katta son";
    if (i.unit !== "m³" && !Number.isInteger(n)) return "Dona mahsulot miqdori butun son bo'lsin";
    return null;
  };
  // Qism(lar) jami tayinlanmagan qismidan oshmasin
  const itemErr = (i: Item): string | null => {
    const over = -rest(i);
    if (over <= 0.0005) return null;
    return partsOf(i).filter((r) => r.brigade).length > 1
      ? `Brigadalarga jami ${amt(given(i), i.unit)} — tayinlanmagan qismi ${amt(i.left, i.unit)}, ${amt(over, i.unit)} ortiqcha`
      : `Ko'pi bilan ${amt(i.left, i.unit)} — tayinlanmagan qismidan ko'p berib bo'lmaydi`;
  };
  const hasErr = open.some((i) => itemErr(i) !== null || partsOf(i).some((r) => partErr(i, r) !== null));

  return (
    <form action={action}>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text="Topshiriqlar brigadalarga yuborildi" />}
      {/* Telefonda (390px) jadval sahifani kengaytirmasin — o'zi yonga suriladi */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr><Th>Mahsulot</Th><Th right>Miqdor</Th><Th>Brigada, miqdor va imkoni</Th></tr></thead>
        <tbody>
          {items.map((i) => {
            const isFocus = focus === i.id;
            const list = partsOf(i);
            const left = rest(i), ierr = itemErr(i);
            const allPicked = list.every((r) => r.brigade);
            return (
              <Tr key={i.id} className={cn(isFocus && "bg-brand-50/70 ring-2 ring-brand-400 ring-inset")}>
                <Td className="align-top font-medium">{isFocus && <span ref={focusRow} />}{i.product}</Td>
                <Td right className="align-top whitespace-nowrap">
                  {i.qty} {i.unit}
                  {i.tasks.length > 0 && <div className={cn("text-[11px]", i.left > 0.0005 ? "font-medium text-amber-700" : "text-emerald-700")}>{i.left > 0.0005 ? `tayinlanmagan ${fmtNum(i.left, 3)}` : "hammasi berilgan"}</div>}
                </Td>
                <Td>
                  {i.tasks.map((t) => (
                    <div key={t.id} className="mb-1 text-xs text-slate-600"><span className="font-medium text-slate-800">{t.brigade}</span> · {t.qty} {i.unit}{t.status === "DONE" ? " · bajarildi" : ""}</div>
                  ))}
                  {i.left > 0.0005 && (
                    <div className="space-y-2">
                      {list.map((r, n) => {
                        const cap = r.brigade ? capOf(i.productId, r.brigade) : null;
                        const give = Math.max(0, Number.isFinite(parseNum(r.qty)) ? parseNum(r.qty) : 0);
                        const enough = cap ? cap.canMake >= give - 0.0005 : null;
                        const pct = cap && give > 0 ? (cap.canMake / give) * 100 : 0;
                        const before = rest(i, n), after = rest(i, n + 1), perr = partErr(i, r);
                        // Shu qatorning boshqa qismida tanlangan brigada qayta tanlanmaydi
                        const taken = new Set(list.filter((x) => x.key !== r.key && x.brigade).map((x) => x.brigade));
                        return (
                          <div key={r.key} className={cn("space-y-1", n > 0 && "border-t border-dashed border-slate-200 pt-2")}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Select name={`brigade.${n}.${i.id}`} value={r.brigade} className="h-9 max-w-64 text-sm"
                                aria-label={`${i.product} — ${n + 1}-qism brigadasi`}
                                onChange={(e) => patch(i, r.key, { brigade: e.target.value })}>
                                <option value="">Brigada tanlang · {amt(Math.max(0, before), i.unit)} qoldi</option>
                                {sorted(i.productId).map((b) => {
                                  const can = capOf(i.productId, b.id)?.canMake ?? 0;
                                  return <option key={b.id} value={b.id} disabled={taken.has(b.id)}>{b.name}{b.leader ? ` · ${b.leader}` : ""} — {can > 0 ? `${fmtNum(can, 2)} ${i.unit} chiqara oladi` : "xomashyosi yo'q"}</option>;
                                })}
                              </Select>
                              <label className="relative">
                                <span className="sr-only">Miqdor</span>
                                <Input name={`qty.${n}.${i.id}`} inputMode="decimal" value={r.qty}
                                  onChange={(e) => patch(i, r.key, { qty: e.target.value })}
                                  aria-label={`${i.product} — brigadaga beriladigan miqdor`} aria-invalid={perr || ierr ? true : undefined} className="h-9 w-32 pr-12 text-right tabular" />
                                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400">{i.unit}</span>
                              </label>
                              <Button type="button" variant="secondary" size="sm" title="Brigadalar imkonini ko'rish" onClick={() => setModalFor({ item: i, key: r.key, need: give > 0 ? give : Math.max(0, after) })}>
                                <Gauge size={15} /> Imkoni
                              </Button>
                              {/* Qoldiq: shu qismdan keyin qancha tayinlanmay qoladi */}
                              {r.brigade && !perr && (
                                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular",
                                  after > 0.0005 ? "bg-amber-50 text-amber-800" : after < -0.0005 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
                                  {after > 0.0005 ? `${amt(after, i.unit)} qoldi` : after < -0.0005 ? `${amt(-after, i.unit)} ortiqcha` : "hammasi taqsimlandi"}
                                </span>
                              )}
                              {list.length > 1 && (
                                <button type="button" onClick={() => setItem(i, list.filter((x) => x.key !== r.key))} aria-label="Qismni olib tashlash"
                                  className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-red-600"><X size={15} /></button>
                              )}
                            </div>
                            {perr && <span role="alert" className="block text-xs font-medium text-red-600">{perr}</span>}
                            {cap && give > 0 && !perr && (
                              <div className="max-w-md space-y-1 text-xs">
                                <Bar pct={pct} />
                                {enough
                                  ? <span className="font-medium text-emerald-700">Yetadi · {fmtNum(cap.canMake, 2)} {i.unit} chiqara oladi</span>
                                  : (
                                    <span className="inline-flex items-start gap-1 font-medium text-amber-700">
                                      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                                      <span>
                                        Faqat {fmtNum(cap.canMake, 2)} {i.unit} chiqadi ({fmtNum(Math.max(0, give - cap.canMake), 2)} {i.unit} yetmaydi)
                                        {cap.limiting ? <span className="block font-normal text-slate-500">Cheklovchi: {cap.limiting}</span> : null}
                                      </span>
                                    </span>
                                  )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {ierr && <span role="alert" className="block text-xs font-medium text-red-600">{ierr}</span>}
                      {left > 0.0005 && allPicked && !ierr && (
                        <button type="button" onClick={() => addPart(i)} className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline">
                          <Plus size={14} /> Qator qo&apos;shish — qolgan {amt(left, i.unit)} boshqa brigadaga
                        </button>
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
      <CapacityModal open={!!modalFor} item={modalFor?.item ?? null} need={modalFor?.need} brigades={brigades} capacity={capacity}
        onClose={() => setModalFor(null)}
        onPick={(bid) => { if (modalFor && !partsOf(modalFor.item).some((x) => x.key !== modalFor.key && x.brigade === bid)) patch(modalFor.item, modalFor.key, { brigade: bid }); }} />
    </form>
  );
}
