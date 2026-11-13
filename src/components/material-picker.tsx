"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Pencil, Save } from "lucide-react";
import { deleteCatalogMaterial, deleteMaterialGroup, renameMaterialGroup, updateCatalogMaterial } from "@/lib/material-actions";
import { FolderPicker, type PickerGroup } from "@/components/folder-picker";
import { DeleteButton } from "@/components/delete-button";
import { MaterialPanelBody, MaterialTools, type MaterialPanel } from "@/components/catalog-tools";
import type { ActionState } from "@/lib/action";
import { fmtNum } from "@/lib/format";
import { MATERIAL_UNITS, unitLabel } from "@/lib/unit";
import { Button, Field, FormError, IconButton, Input, Select, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { MaterialCategory } from "@/generated/prisma";

export type MaterialRow = {
  /** `groupId` berilmasa (undefined) — papka noma'lum: tahrirlash oynasida «Papka» maydoni chiqmaydi */
  id: string; name: string; code: string; unit: string; price?: number; balance?: number; groupId?: string | null;
  /** Chiqim formasi: shu skladga jami kirim va jami chiqim — ro'yxatda «Kirim · Chiqim · Qoldi» bo'lib ko'rinadi */
  received?: number; issued?: number;
  /** Kirim formasi: qatorda kategoriya ko'rsatiladi va o'zgartiriladi */
  category?: MaterialCategory;
  /** Tahrirlash oynasi: minimal qoldiq — berilmasa maydon chiqmaydi (qiymat o'zgarmaydi) */
  minStock?: number;
};
export type MaterialGroup = PickerGroup;

/** Papkalar to'liq yo'li bilan («Inertlar / Qum») — tahrirlash oynasidagi «Papka» tanlovi uchun. */
function folderOptions(groups: MaterialGroup[]) {
  const by = new Map(groups.map((g) => [g.id, g]));
  const path = (g: MaterialGroup) => {
    const parts = [g.name];
    for (let p = g.parentId ? by.get(g.parentId) : undefined, i = 0; p && i < 20; p = p.parentId ? by.get(p.parentId) : undefined, i++) parts.unshift(p.name);
    return parts.join(" / ");
  };
  return groups.map((g) => ({ id: g.id, label: path(g) })).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Xomashyo kartasini tahrirlash (nomi, birligi, minimal qoldig'i, papkasi) — spravochnik oynasidagi va
 * Sklad → Qoldiqlar qatoridagi qalam (`updateCatalogMaterial`). Noma'lum maydon (`minStock`, `groupId` berilmagan)
 * formada chiqmaydi — server uni tegmaydi. `unitLocked` — sklad harakati bor: birlik maydoni o'chiq (yuborilmaydi).
 */
export function EditMaterialForm({ material, groups, unitLocked = false, onDone, onCancel }: {
  material: Pick<MaterialRow, "id" | "name" | "code" | "unit" | "minStock" | "groupId">;
  groups: MaterialGroup[];
  unitLocked?: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(updateCatalogMaterial.bind(null, material.id), undefined);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  const folders = useMemo(() => folderOptions(groups), [groups]);
  const units: string[] = (MATERIAL_UNITS as readonly string[]).includes(material.unit) ? [...MATERIAL_UNITS] : [material.unit, ...MATERIAL_UNITS];
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Xomashyo nomi *" hint={`Kod: ${material.code}`} className="sm:col-span-4">
          <Input name="name" required autoComplete="off" maxLength={200} defaultValue={material.name} autoFocus />
        </Field>
        <Field label="O'lchov birligi" hint={unitLocked ? "sklad harakati bor — o'zgarmaydi" : "harakat yoki retsept bo'lsa o'zgarmaydi"}>
          <Select name="unit" defaultValue={material.unit} disabled={unitLocked}>{units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</Select>
        </Field>
        {material.minStock !== undefined && (
          <Field label="Minimal qoldiq" hint="kam qolsa signal"><Input name="minStock" type="number" step="0.001" min="0" defaultValue={String(material.minStock)} /></Field>
        )}
        {material.groupId !== undefined && (
          <Field label="Papka" className="sm:col-span-2">
            <Select name="groupId" defaultValue={material.groupId ?? ""}>
              <option value="">Ro&apos;yxat ildizi</option>
              {/* Joriy papka yopilgan (ro'yxatda yo'q) bo'lsa ham tanlovda qolsin — saqlanganda jimgina ildizga tushmasin */}
              {material.groupId && !folders.some((f) => f.id === material.groupId) && <option value={material.groupId}>Joriy papka</option>}
              {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending}><Save size={15} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>
        <span className="text-xs text-slate-600">Yangi nom eski kirim, chiqim va hisobotlarda ham ko&apos;rinadi (hujjatlar xomashyoga bog&apos;langan, nomga emas).</span>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}

/**
 * Papka nomini tuzatish — spravochnik oynasidagi papka qatorining qalami. `action` — papka turi bo'yicha
 * (`renameMaterialGroup`, mahsulot papkasi uchun `renameProductGroup`).
 */
export function RenameFolderForm({ group, action: save, onDone, onCancel }: {
  group: { id: string; name: string };
  action: (id: string, prev: ActionState, fd: FormData) => Promise<ActionState>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(save.bind(null, group.id), undefined);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Papka nomi *" className="min-w-52 flex-1"><Input name="name" required autoComplete="off" maxLength={120} defaultValue={group.name} autoFocus /></Field>
        <Button size="sm" disabled={pending}><Save size={15} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}

/** Nom yoki kod bo'yicha filtr: avval nomi shu harflar bilan boshlanadiganlar. */
function filterMaterials(list: MaterialRow[], term: string) {
  const t = term.trim().toLowerCase();
  if (!t) return list;
  const starts = list.filter((m) => m.name.toLowerCase().startsWith(t));
  const rest = list.filter((m) => !m.name.toLowerCase().startsWith(t) && (m.name.toLowerCase().includes(t) || m.code.toLowerCase().includes(t)));
  return [...starts, ...rest];
}

/**
 * Xomashyo spravochnigi — mahsulot spravochnigi bilan bir xil 1C uslubidagi oyna
 * (umumiy `FolderPicker`): papkalar, qidiruv, "Tanlash".
 * `canCreate` bo'lsa shu oynadan yangi xomashyo va papka qo'shiladi.
 * Yozilgan nom ro'yxatda bo'lmasa — shu nom bilan qatorga yozish taklif qilinadi (`onCreate`).
 */
export function MaterialPicker({ open, materials, groups = [], canCreate = false, initialQuery, onPick, onCreate, onClose }: {
  open: boolean;
  materials: MaterialRow[];
  groups?: MaterialGroup[];
  canCreate?: boolean;
  initialQuery?: string;
  onPick: (m: MaterialRow) => void;
  onCreate?: (name: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<MaterialPanel>(null);
  // Qatordagi qalam: xomashyo kartasi yoki papka nomi tahrirlanmoqda (panel o'rnida chiqadi)
  const [editing, setEditing] = useState<{ kind: "item"; m: MaterialRow } | { kind: "group"; g: MaterialGroup } | null>(null);
  useEffect(() => { if (!open) { setPanel(null); setEditing(null); } }, [open]);

  const toggle = (p: MaterialPanel) => { setEditing(null); setPanel((cur) => (cur === p ? null : p)); };
  const afterCreate = () => { setPanel(null); router.refresh(); };
  const afterEdit = () => { setEditing(null); router.refresh(); };
  /** Qidiruvga yozilgan nom ro'yxatda bormi — bo'lmasa "«X» ni yangi qo'shish" taklif qilinadi. */
  const isNew = (name: string) => !!name && !materials.some((m) => m.name.trim().toLowerCase() === name.toLowerCase());
  const flow = materials.some((m) => m.received != null);

  return (
    <FolderPicker
      open={open}
      title="XOMASHYO"
      ariaLabel="Xomashyo tanlash"
      nameLabel="Nomi"
      cols={[
        { label: "Birlik", className: "w-24" },
        ...(flow ? [{ label: "Kirim", className: "w-28", right: true }, { label: "Chiqim", className: "w-28", right: true }] : []),
        { label: "Qoldiq", className: "w-32", right: true },
        { label: "Kod", className: "w-32", right: true },
      ]}
      items={materials.map((m) => ({
        id: m.id, name: m.name, code: m.code, groupId: m.groupId ?? null,
        cells: [
          unitLabel(m.unit),
          ...(flow ? [fmtNum(m.received ?? 0, 3), fmtNum(m.issued ?? 0, 3)] : []),
          m.balance != null ? fmtNum(m.balance, 3) : "—", m.code,
        ],
      }))}
      groups={groups}
      initialQuery={initialQuery}
      emptyText={materials.length === 0 ? "Skladda hali xomashyo yo'q" : "Bu papka bo'sh"}
      noMatchText="Mos xomashyo topilmadi"
      footerHint="Papkani ochish yoki xomashyoni tanlash — ikki marta bosing"
      onPick={(id) => { const m = materials.find((x) => x.id === id); if (m) onPick(m); }}
      onClose={onClose}
      /* Qalam — xomashyo kartasi / papka nomini tahrirlash. O'chirish: hujjatlarda ishlatilmagan xomashyo butunlay o'chadi,
         ishlatilgani arxivga olinadi */
      rowAction={canCreate ? (row) => {
        const m = row.kind === "item" ? materials.find((x) => x.id === row.id) : undefined;
        const g = row.kind === "group" ? groups.find((x) => x.id === row.id) : undefined;
        return (
          <span className="inline-flex items-center gap-0.5">
            {(m || g) && (
              <IconButton icon={Pencil} type="button" label={m ? `${row.name} — tahrirlash` : `${row.name} — papka nomini tahrirlash`}
                onClick={() => { setPanel(null); setEditing(m ? { kind: "item", m } : { kind: "group", g: g! }); }}
                className="h-7 w-7 text-slate-400" />
            )}
            <DeleteButton
              action={row.kind === "group" ? deleteMaterialGroup : deleteCatalogMaterial}
              id={row.id}
              name={row.name}
              title={row.kind === "group" ? "Papkani o'chirish" : "Xomashyoni o'chirish"}
            />
          </span>
        );
      } : undefined}
      tools={(ctx) => (
        <>
          {canCreate && <MaterialTools toggle={toggle} />}
          {/* Qatorga yozilgan nom ro'yxatda yo'q — shu nom bilan davom etish (qo'shilishi saqlashda bo'ladi) */}
          {onCreate && isNew(ctx.query) && (
            <Button type="button" size="sm" variant="ghost" onClick={() => { onCreate(ctx.query); onClose(); }}>
              «{ctx.query}» ni yangi qo&apos;shish
            </Button>
          )}
        </>
      )}
      panel={(ctx) => (editing?.kind === "item"
        ? <EditMaterialForm key={editing.m.id} material={editing.m} groups={groups} onDone={afterEdit} onCancel={() => setEditing(null)} />
        : editing?.kind === "group"
          ? <RenameFolderForm key={editing.g.id} group={editing.g} action={renameMaterialGroup} onDone={afterEdit} onCancel={() => setEditing(null)} />
          : canCreate ? <MaterialPanelBody panel={panel} ctx={ctx} onDone={afterCreate} onCancel={() => setPanel(null)} /> : null)}
    />
  );
}

/**
 * Xomashyo maydoni: yozilgan har bir harf bo'yicha ro'yxat qisqaradi,
 * oxiridagi "…" tugmasi to'liq spravochnikni (papkalari bilan) ochadi.
 */
export function MaterialField({ materials, groups, canCreate, value, onPick, placeholder }: {
  materials: MaterialRow[];
  groups?: MaterialGroup[];
  canCreate?: boolean;
  value: string; // tanlangan xomashyo id'si
  onPick: (m: MaterialRow) => void;
  placeholder?: string;
}) {
  const selected = materials.find((m) => m.id === value) ?? null;
  const [q, setQ] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => filterMaterials(materials, q ?? "").slice(0, 50), [materials, q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setQ(null); } };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  const choose = (m: MaterialRow) => { onPick(m); setOpen(false); setQ(null); };

  return (
    <div ref={boxRef} className="relative flex">
      <input
        value={q ?? (selected ? `${selected.name} (${selected.code})` : "")}
        placeholder={placeholder ?? "Xomashyo nomi yoki kodi"}
        autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setCursor(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && open && matches[cursor]) { e.preventDefault(); choose(matches[cursor]); }
          else if (e.key === "Escape") { setOpen(false); setQ(null); }
        }}
        className={cn(inputCls, "rounded-r-none")}
      />
      <button type="button" onClick={() => { setOpen(false); setModal(true); }} title="Ro'yxatdan tanlash" aria-label="Xomashyo tanlash"
        className="-ml-px flex h-10 w-10 shrink-0 items-center justify-center rounded-r-lg border border-slate-200 bg-slate-50 pb-1 text-base leading-none font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900">
        …
      </button>

      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 min-w-[min(20rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-(--shadow-pop)">
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Mos xomashyo topilmadi</div>}
          {matches.map((m, i) => (
            <button key={m.id} type="button" onMouseEnter={() => setCursor(i)} onClick={() => choose(m)}
              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === cursor ? "bg-slate-100" : "hover:bg-slate-50")}>
              <Minus size={14} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{m.name}</span>
                {/* Chiqim formasi: kirim qilingan, berilgan va hali skladda qolgan (chiqim qilinadigan) miqdor */}
                {m.received != null && (
                  <span className="block text-xs text-slate-500 tabular">
                    {`Kirim ${fmtNum(m.received, 3)} · Chiqim ${fmtNum(m.issued ?? 0, 3)} · `}
                    <b className={cn("font-semibold", (m.balance ?? 0) > 0 ? "text-emerald-700" : "text-red-600")}>{`Qoldi ${fmtNum(Math.max(0, m.balance ?? 0), 3)}`}</b>
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-slate-500">{unitLabel(m.unit)}</span>
              <span data-no-translit className="shrink-0 text-xs text-slate-400 tabular">{m.code}</span>
            </button>
          ))}
        </div>
      )}

      <MaterialPicker open={modal} materials={materials} groups={groups} canCreate={canCreate} initialQuery={q ?? ""} onPick={choose} onClose={() => setModal(false)} />
    </div>
  );
}
