"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { HardHat, Search, Undo2, X } from "lucide-react";
import { distributeToBrigade, returnToStock } from "./brigade-actions";
import { Button, FormError, FormSuccess, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { cn } from "@/lib/utils";

export type StockRow = { id: string; name: string; code: string; unit: string; balance: number };
type Brigade = { id: string; name: string; leader: string | null };

/**
 * Skladdagi mahsulotlar jadvali — har qatorda miqdor va brigada tanlanadi.
 * «Qoladi» ustuni jonli kamayadi: butun hajm berilsa 0 bo'ladi va qator so'nadi.
 * Skladdagidan ko'p yozib bo'lmaydi (tugma ham bloklanadi).
 */
export function BrigadeDistributeForm({ brigades, warehouses, materials }: {
  brigades: Brigade[];
  warehouses: { id: string; name: string }[];
  materials: StockRow[];
}) {
  const [state, action, pending] = useActionState(distributeToBrigade, undefined);
  const [picks, setPicks] = useState<Record<string, { qty: string; brigadeId: string }>>({});
  const [q, setQ] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);
  // Berilgandan keyin jadval tozalanadi — bir miqdor ikki marta yuborilib ketmasin
  useEffect(() => { if (state?.ok) { setPicks({}); setOnlyPicked(false); } }, [state]);

  const set = (id: string, patch: Partial<{ qty: string; brigadeId: string }>) =>
    setPicks((p) => ({ ...p, [id]: { qty: p[id]?.qty ?? "", brigadeId: p[id]?.brigadeId ?? brigades[0]?.id ?? "", ...patch } }));

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return materials
      .filter((m) => (onlyPicked ? Number(picks[m.id]?.qty) > 0 : true))
      .filter((m) => !t || m.name.toLowerCase().includes(t) || m.code.toLowerCase().includes(t));
  }, [materials, q, onlyPicked, picks]);

  const payload = Object.entries(picks)
    .map(([materialId, v]) => ({ materialId, qty: Number(v.qty) || 0, brigadeId: v.brigadeId }))
    .filter((r) => r.qty > 0 && r.brigadeId);
  const over = payload.filter((r) => r.qty > (materials.find((m) => m.id === r.materialId)?.balance ?? 0) + 0.0005);
  const brigadeCount = new Set(payload.map((r) => r.brigadeId)).size;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Sklad</span>
          <Select name="warehouseId" defaultValue={warehouses[0]?.id} className="h-9 w-48 text-sm">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Izoh</span>
          <Input name="note" placeholder="Qaysi ish uchun" className="h-9 w-56 text-sm" autoComplete="off" />
        </label>
        <label className="relative block flex-1 min-w-52">
          <span className="mb-1 block text-xs font-medium text-slate-600">Qidirish</span>
          <Search size={15} className="absolute bottom-2.5 left-2.5 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mahsulot nomi yoki kodi" className="h-9 pl-8 text-sm" autoComplete="off" />
        </label>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOnlyPicked((v) => !v)}>
          {onlyPicked ? "Hammasini ko'rsatish" : `Faqat belgilanganlar (${payload.length})`}
        </Button>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        <Table>
          <thead><tr><Th>Mahsulot</Th><Th right>Skladda</Th><Th right>Beriladigan miqdor</Th><Th>Brigada</Th><Th right>Qoladi</Th><Th></Th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">Mos mahsulot yo&apos;q</td></tr>}
            {list.map((m) => {
              const v = picks[m.id];
              const give = Number(v?.qty) || 0;
              const left = m.balance - give;
              const bad = give > m.balance + 0.0005;
              return (
                <Tr key={m.id} className={cn(give > 0 && !bad && "bg-emerald-50/50", bad && "bg-red-50/60")}>
                  <Td className="font-medium">{m.name}<div className="text-xs text-slate-500">{m.code}</div></Td>
                  <Td right className="text-slate-600">{fmtNum(m.balance, 3)} {unitLabel(m.unit)}</Td>
                  <Td right className="w-40">
                    <Input value={v?.qty ?? ""} onChange={(e) => set(m.id, { qty: e.target.value })} type="number" step="0.001" min="0" max={m.balance}
                      placeholder="0" inputMode="decimal" className={cn("h-9 text-right", bad && "border-red-400 text-red-700")} />
                  </Td>
                  <Td className="w-56">
                    <Select value={v?.brigadeId ?? ""} onChange={(e) => set(m.id, { brigadeId: e.target.value })} className="h-9 text-sm">
                      <option value="">Brigada tanlang…</option>
                      {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}{b.leader ? ` · ${b.leader}` : ""}</option>)}
                    </Select>
                  </Td>
                  <Td right className={cn("font-semibold tabular", bad ? "text-red-600" : left <= 0.0005 ? "text-slate-400" : "text-slate-800")}>
                    {bad ? "yetmaydi" : `${fmtNum(Math.max(0, left), 3)} ${unitLabel(m.unit)}`}
                  </Td>
                  <Td>{give > 0 && <button type="button" onClick={() => set(m.id, { qty: "" })} aria-label="Tozalash" className="text-slate-400 hover:text-red-600"><X size={15} /></button>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      <FormError error={state?.error ?? (over.length ? `Skladda yetmaydi: ${over.map((r) => materials.find((m) => m.id === r.materialId)?.name).join(", ")}` : undefined)} />
      {state?.ok && <FormSuccess text={state.note ?? "Berildi"} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-500">{payload.length > 0 ? `${payload.length} ta mahsulot · ${brigadeCount} brigadaga` : "Jadvaldan miqdor yozing va brigadani tanlang"}</span>
        <Button disabled={pending || payload.length === 0 || over.length > 0}><HardHat size={16} /> {pending ? "Berilmoqda…" : "Brigadalarga berish"}</Button>
      </div>
    </form>
  );
}

/** Brigada kartasidagi kichik forma: ishlatilmagan xomashyoni skladga qaytarish. */
export function BrigadeReturnForm({ brigadeId, materials, warehouseId }: {
  brigadeId: string;
  materials: { materialId: string; name: string; unit: string; qty: number }[];
  warehouseId: string;
}) {
  const [state, action, pending] = useActionState(returnToStock.bind(null, brigadeId), undefined);
  const [materialId, setMaterialId] = useState("");
  const have = materials.find((m) => m.materialId === materialId);

  return (
    <form action={action} className="mt-3 border-t border-slate-100 pt-3">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <div className="flex flex-wrap items-end gap-2">
        <Select name="materialId" value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="h-9 min-w-44 flex-1 text-sm">
          <option value="">Skladga qaytarish…</option>
          {materials.map((m) => <option key={m.materialId} value={m.materialId}>{m.name} ({fmtNum(m.qty, 3)} {unitLabel(m.unit)})</option>)}
        </Select>
        <Input name="qty" type="number" step="0.001" min="0" max={have?.qty} placeholder="Miqdor" className="h-9 w-28 text-sm text-right" />
        <Button variant="secondary" size="sm" disabled={pending || !materialId}><Undo2 size={15} /> Qaytarish</Button>
      </div>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Qaytarildi"} />}
    </form>
  );
}
