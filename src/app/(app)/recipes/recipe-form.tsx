"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { useActionState, useState } from "react";
import { createRecipeVersion } from "./actions";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";
import { MaterialField, type MaterialGroup } from "@/components/material-picker";
import { cn } from "@/lib/utils";

type Material = { id: string; name: string; code: string; unit: string; groupId?: string | null };
type Row = { key: number; materialId: string; qtyPerM3: string };

/**
 * Retsept tarkibi — 1C dagi tovar kartasidagi "Тарар" jadvaliga o'xshash ko'rinish:
 * №, xomashyo nomi, birlik, soni ustunlari; qator qo'shish/o'chirish va tartibini
 * yuqoriga-pastga ko'chirish tugmalari bilan. Har saqlashda yangi versiya ochiladi,
 * eskisi tarixda qoladi.
 */
export function RecipeForm({ productId, materials, groups = [], canCreate = false, initial, unit = "m³", returnTo }: { productId: string; materials: Material[]; groups?: MaterialGroup[]; canCreate?: boolean; initial: { materialId: string; qtyPerM3: string }[]; unit?: string; returnTo?: string }) {
  const [state, action, pending] = useActionState(createRecipeVersion.bind(null, productId), undefined);
  const [rows, setRows] = useState<Row[]>(
    initial.length ? initial.map((i, k) => ({ key: k + 1, ...i })) : [{ key: 1, materialId: materials[0]?.id ?? "", qtyPerM3: "" }],
  );
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  const add = () => setRows((rs) => [...rs, { key: Date.now(), materialId: materials[0]?.id ?? "", qtyPerM3: "" }]);
  /** Qatorni bir pog'ona yuqoriga (-1) yoki pastga (+1) ko'chiradi. */
  const move = (key: number, dir: -1 | 1) => setRows((rs) => {
    const i = rs.findIndex((r) => r.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rs.length) return rs;
    const copy = [...rs];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });

  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
              <th className="w-8 px-2 py-2">№</th>
              <th className="px-2 py-2">Xomashyo nomi</th>
              <th className="w-20 px-2 py-2">Birlik</th>
              <th className="w-32 px-2 py-2 text-right">{`Soni (1 ${unit} ga)`}</th>
              <th className="w-24 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const munit = materials.find((m) => m.id === r.materialId)?.unit ?? "";
              return (
                <tr key={r.key} className="border-b border-slate-100 align-top">
                  <td className="px-2 py-1.5 pt-3.5 text-slate-400 tabular">{i + 1}</td>
                  {/* Xomashyo skladdagi bilan bir xil 1C ro'yxatidan tanlanadi: nom terib ham, «…» orqali papkalardan ham */}
                  <td className="px-2 py-1.5">
                    <input type="hidden" name="materialId[]" value={r.materialId} />
                    <MaterialField materials={materials} groups={groups} canCreate={canCreate} value={r.materialId} onPick={(m) => update(r.key, { materialId: m.id })} />
                  </td>
                  <td className="px-2 py-1.5 pt-3.5 text-slate-500">{munit || "—"}</td>
                  <td className="px-2 py-1.5">
                    <Input name="qtyPerM3[]" type="number" step="0.001" min="0" value={r.qtyPerM3} onChange={(e) => update(r.key, { qtyPerM3: e.target.value })} required className="text-right tabular" />
                  </td>
                  <td className="px-2 py-1.5 pt-3">
                    <div className="flex items-center justify-end gap-0.5">
                      <button type="button" onClick={() => move(r.key, -1)} disabled={i === 0} title="Yuqoriga ko'chirish"
                        className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"><ChevronUp size={15} /></button>
                      <button type="button" onClick={() => move(r.key, 1)} disabled={i === rows.length - 1} title="Pastga ko'chirish"
                        className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"><ChevronDown size={15} /></button>
                      <button type="button" onClick={() => remove(r.key)} disabled={rows.length === 1} title="Qatorni o'chirish"
                        className="flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" onClick={add}
          className={cn("mt-2 inline-flex items-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-500 hover:bg-slate-50")}>
          <Plus size={14} /> Qator qo&apos;shish
        </button>
      </div>

      <Field label="Izoh (nima o'zgardi)"><Textarea name="note" placeholder="Masalan: laboratoriya sinovi bo'yicha sement 380 → 390 kg" /></Field>
      <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Yangi versiya sifatida saqlash"}</Button>
    </form>
  );
}
