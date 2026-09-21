"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronRight, CornerLeftUp, Folder, FolderPlus, Minus, MousePointerClick, Plus, Search, X } from "lucide-react";
import { createCatalogProduct, createProductGroup } from "./catalog-actions";
import { PRODUCT_UNITS } from "@/lib/unit";
import { PRODUCT_KINDS } from "@/lib/catalog";
import { MoneyInput } from "@/components/money-input";
import { Button, Field, FormError, Input, inputCls, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

export type CatalogProduct = { id: string; code: string; name: string; kind: string | null; unit: string; price: string; groupId: string | null };
export type CatalogGroup = { id: string; code: string; name: string; parentId: string | null };

type RowItem =
  | { type: "group"; id: string; name: string; kind: string; code: string }
  | { type: "product"; id: string; name: string; kind: string; code: string };

/**
 * Mahsulot spravochnigi — 1C dagi "TOVARLAR" oynasiga o'xshash tanlagich.
 * Papkalar ichiga kiriladi, qidiruv butun ro'yxat bo'yicha ishlaydi,
 * "Yangi" bilan ochiq papkaga mahsulot yoki papka qo'shiladi.
 */
export function ProductPicker({ open, products, groups, onPick, onClose, canCreate, hint }: {
  open: boolean;
  products: CatalogProduct[];
  groups: CatalogGroup[];
  onPick: (productId: string) => void;
  onClose: () => void;
  canCreate: boolean;
  hint?: (p: CatalogProduct) => string | null;
}) {
  const router = useRouter();
  const [path, setPath] = useState<CatalogGroup[]>([]); // ochilgan papkalar zanjiri
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<RowItem | null>(null);
  const [creating, setCreating] = useState<"product" | "group" | null>(null);
  const [mounted, setMounted] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Oyna zayavka formasi ichida emas, <body> da chiziladi — aks holda forma forma ichiga tushadi
  useEffect(() => setMounted(true), []);

  const current = path.at(-1) ?? null;
  const currentId = current?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setCreating(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const rows: RowItem[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term) {
      // Qidiruvda papkalar bo'ylab yurilmaydi — butun ro'yxatdan mos kelganlari chiqadi
      return products
        .filter((p) => p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term))
        .map((p) => ({ type: "product" as const, id: p.id, name: p.name, kind: p.kind ?? "", code: p.code }));
    }
    const gs = groups
      .filter((g) => g.parentId === currentId)
      .map((g) => ({ type: "group" as const, id: g.id, name: g.name, kind: "", code: g.code }));
    const ps = products
      .filter((p) => (p.groupId ?? null) === currentId)
      .map((p) => ({ type: "product" as const, id: p.id, name: p.name, kind: p.kind ?? "", code: p.code }));
    return [...gs, ...ps];
  }, [q, currentId, groups, products]);

  if (!open || !mounted) return null;

  const openGroup = (id: string) => {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    setPath((p) => [...p, g]);
    setQ("");
    setSel(null);
  };
  const pick = (id: string) => { onPick(id); onClose(); };
  const confirm = () => {
    if (!sel) return;
    if (sel.type === "group") openGroup(sel.id);
    else pick(sel.id);
  };
  const afterCreate = () => { setCreating(null); router.refresh(); };

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-(--radius-card) border border-slate-200 bg-white shadow-(--shadow-pop)"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Mahsulot tanlash"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-base font-semibold tracking-tight">MAHSULOTLAR</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>

        {/* Asboblar qatori: Tanlash · Yangi · qidiruv */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <Button type="button" size="sm" disabled={!sel} onClick={confirm}>
            <MousePointerClick size={15} /> Tanlash
          </Button>
          {canCreate && (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(creating === "product" ? null : "product")}>
                <Plus size={15} /> Yangi
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(creating === "group" ? null : "group")} title="Yangi papka">
                <FolderPlus size={15} /> Papka
              </Button>
            </>
          )}
          <div className="relative min-w-52 flex-1">
            <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <input ref={searchRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="Qidirish (nomi yoki kodi)" className={cn(inputCls, "pr-8 pl-8")} />
            {q && <button type="button" onClick={() => setQ("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Tozalash"><X size={15} /></button>}
          </div>
        </div>

        {creating && (
          <div className="border-b border-slate-200 bg-blue-50/60 px-4 py-3">
            {creating === "group"
              ? <NewGroupForm parentId={currentId} parentName={current?.name ?? null} onDone={afterCreate} onCancel={() => setCreating(null)} />
              : <NewProductForm groupId={currentId} groupName={current?.name ?? null} onDone={afterCreate} onCancel={() => setCreating(null)} />}
          </div>
        )}

        {/* Papka zanjiri */}
        {!q && path.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-4 py-2 text-[13px]">
            <button type="button" onClick={() => { setPath([]); setSel(null); }} className="text-slate-500 hover:text-slate-900 hover:underline">Barchasi</button>
            {path.map((g, i) => (
              <span key={g.id} className="inline-flex items-center gap-1">
                <ChevronRight size={13} className="text-slate-400" />
                <button type="button" onClick={() => { setPath((p) => p.slice(0, i + 1)); setSel(null); }} className={cn(i === path.length - 1 ? "font-medium text-slate-900" : "text-slate-500 hover:underline")}>{g.name}</button>
              </span>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2">Mahsulot nomi</th>
                <th className="px-4 py-2">Turi</th>
                <th className="w-24 px-4 py-2 text-right">Kod</th>
              </tr>
            </thead>
            <tbody>
              {!q && path.length > 0 && (
                <tr className="cursor-pointer border-b border-slate-100 text-slate-500 hover:bg-slate-50" onClick={() => { setPath((p) => p.slice(0, -1)); setSel(null); }}>
                  <td className="px-4 py-1.5" colSpan={3}><span className="inline-flex items-center gap-2"><CornerLeftUp size={14} /> Yuqoriga</span></td>
                </tr>
              )}
              {rows.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">{q ? "Mos mahsulot topilmadi" : "Bu papka bo'sh"}</td></tr>
              )}
              {rows.map((r) => {
                const active = sel?.type === r.type && sel.id === r.id;
                const p = r.type === "product" ? products.find((x) => x.id === r.id) : undefined;
                const extra = p && hint ? hint(p) : null;
                return (
                  <tr
                    key={`${r.type}-${r.id}`}
                    onClick={() => setSel(r)}
                    onDoubleClick={() => (r.type === "group" ? openGroup(r.id) : pick(r.id))}
                    className={cn("cursor-pointer border-b border-slate-100", active ? "bg-slate-900 text-white" : "hover:bg-slate-50")}
                  >
                    <td className="px-4 py-1.5">
                      <span className="inline-flex items-center gap-2">
                        {r.type === "group"
                          ? <Folder size={15} className={active ? "text-amber-300" : "text-amber-500"} />
                          : <Minus size={15} className={active ? "text-slate-300" : "text-slate-400"} />}
                        <span className={r.type === "group" ? "font-medium" : undefined}>{r.name}</span>
                        {extra && <span className={cn("text-xs", active ? "text-slate-300" : "text-slate-500")}>· {extra}</span>}
                      </span>
                    </td>
                    <td className={cn("px-4 py-1.5", active ? "text-slate-200" : "text-slate-600")}>{r.kind || "—"}</td>
                    <td className={cn("px-4 py-1.5 text-right tabular", active ? "text-slate-200" : "text-slate-500")}>{r.code}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          <span>Papkani ochish yoki mahsulotni tanlash — ikki marta bosing</span>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Yopish</Button>
        </div>
      </div>
    </div>
  ), document.body);
}

function NewGroupForm({ parentId, parentName, onDone, onCancel }: { parentId: string | null; parentName: string | null; onDone: () => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createProductGroup, undefined);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="parentId" value={parentId ?? ""} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Papka nomi *" className="min-w-52 flex-1"><Input name="name" required autoComplete="off" placeholder="Masalan: Plita" /></Field>
        <Field label="Kod" hint="bo'sh qoldirsangiz — avtomatik" className="w-28"><Input name="code" autoComplete="off" /></Field>
        <Button size="sm" disabled={pending}><FolderPlus size={15} /> Qo&apos;shish</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>
      </div>
      <p className="text-xs text-slate-600">Joylashuvi: <b>{parentName ?? "Ro'yxat ildizi"}</b></p>
      <FormError error={state?.error} />
    </form>
  );
}

function NewProductForm({ groupId, groupName, onDone, onCancel }: { groupId: string | null; groupName: string | null; onDone: () => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(createCatalogProduct, undefined);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId ?? ""} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Kod" hint="avtomatik" className="sm:col-span-1"><Input name="code" autoComplete="off" placeholder="0" /></Field>
        <Field label="Mahsulot nomi *" className="sm:col-span-3"><Input name="name" required autoComplete="off" placeholder="Masalan: PK 71-12-8 A 400" /></Field>
        <Field label="Tovar turi">
          <Select name="kind" defaultValue={PRODUCT_KINDS[1]}>
            {PRODUCT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
        <Field label="O'lchov birligi *">
          <Select name="unit" defaultValue="dona">{PRODUCT_UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="Sotuv narxi"><MoneyInput name="price" defaultValue="0" /></Field>
        <Field label="Papka"><Input value={groupName ?? "Ro'yxat ildizi"} readOnly /></Field>
        <Field label="Izoh" className="sm:col-span-4"><Textarea name="note" rows={2} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending}><Plus size={15} /> Saqlash</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>
        <span className="text-xs text-slate-600">Beton markasi bo&apos;lsa retseptni <b>Retseptlar</b> bo&apos;limidan kiriting.</span>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}
