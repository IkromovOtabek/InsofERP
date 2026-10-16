"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { HardHat, Plus, Search, Undo2, X } from "lucide-react";
import { distributeToBrigade, returnToStock } from "./brigade-actions";
import { Button, FormError, FormSuccess, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { cn } from "@/lib/utils";

/** `byWh` — sklad bo'yicha joriy qoldiq: berish AYNAN tanlangan skladdan yechiladi (`issueToBrigade`). */
export type StockRow = { id: string; name: string; code: string; unit: string; byWh: Record<string, number> };
type Brigade = { id: string; name: string; leader: string | null };
type Split = { qty: string; brigadeId: string };
/** Kirim hujjatidan ochilganda: shu kirim skladi, izoh va qatorlari (miqdor — kelgani, sklad qoldig'idan oshmaydi). */
export type DistributeInitial = { warehouseId: string; note: string; qty: Record<string, number> };

const EPS = 0.0005;
const emptySplit: Split = { qty: "", brigadeId: "" };

/**
 * Skladdagi mahsulotlar jadvali — har qatorda miqdor va brigada tanlanadi; «+» bilan bitta mahsulot
 * bir necha brigadaga bo'linadi. «Qoladi» ustuni tanlangan sklad qoldig'idan jonli kamayadi.
 * Skladdagidan ko'p yoki brigadasiz miqdor yozilsa — tugma bloklanadi.
 */
export function BrigadeDistributeForm({ brigades, warehouses, materials, initial }: {
  brigades: Brigade[];
  warehouses: { id: string; name: string }[];
  materials: StockRow[];
  initial?: DistributeInitial;
}) {
  const [state, action, pending] = useActionState(distributeToBrigade, undefined);
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? warehouses[0]?.id ?? "");
  const [picks, setPicks] = useState<Record<string, Split[]>>(() =>
    Object.fromEntries(Object.entries(initial?.qty ?? {}).map(([id, q]) => [id, [{ qty: String(q), brigadeId: "" }]])));
  const [q, setQ] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(!!initial && Object.keys(initial.qty).length > 0);
  // Berilgandan keyin jadval tozalanadi — bir miqdor ikki marta yuborilib ketmasin
  useEffect(() => { if (state?.ok) { setPicks({}); setOnlyPicked(false); } }, [state]);

  const balanceOf = (m: StockRow) => m.byWh[warehouseId] ?? 0;
  const splitsOf = (id: string) => picks[id]?.length ? picks[id] : [emptySplit];
  const setSplit = (id: string, i: number, patch: Partial<Split>) =>
    setPicks((p) => {
      const list = [...(p[id]?.length ? p[id] : [emptySplit])];
      list[i] = { ...list[i], ...patch };
      return { ...p, [id]: list };
    });
  const addSplit = (id: string) => setPicks((p) => ({ ...p, [id]: [...(p[id]?.length ? p[id] : [emptySplit]), emptySplit] }));
  const removeSplit = (id: string, i: number) =>
    setPicks((p) => { const list = (p[id] ?? []).filter((_, k) => k !== i); return { ...p, [id]: list }; });
  const given = (id: string) => (picks[id] ?? []).reduce((a, x) => a + (Number(x.qty) || 0), 0);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return materials
      .filter((m) => (m.byWh[warehouseId] ?? 0) > EPS || (picks[m.id] ?? []).some((x) => Number(x.qty) > 0))
      .filter((m) => (onlyPicked ? (picks[m.id] ?? []).some((x) => Number(x.qty) > 0) : true))
      .filter((m) => !t || m.name.toLowerCase().includes(t) || m.code.toLowerCase().includes(t));
  }, [materials, q, onlyPicked, picks, warehouseId]);

  const filled = Object.entries(picks).flatMap(([materialId, l]) => l.map((v) => ({ materialId, qty: Number(v.qty) || 0, brigadeId: v.brigadeId }))).filter((r) => r.qty > 0);
  const payload = filled.filter((r) => r.brigadeId);
  const noBrigade = filled.length - payload.length;
  const byId = new Map(materials.map((m) => [m.id, m]));
  const over = [...new Set(filled.map((r) => r.materialId))].filter((id) => given(id) > (byId.get(id) ? balanceOf(byId.get(id)!) : 0) + EPS);
  const brigadeCount = new Set(payload.map((r) => r.brigadeId)).size;
  // Belgilangan, lekin brigadasi tanlanmagan qatorlarga bitta brigadani birdan qo'yish (kirim bitta brigadaga ketganda)
  const fillBrigade = (brigadeId: string) =>
    setPicks((p) => Object.fromEntries(Object.entries(p).map(([id, l]) => [id, l.map((x) => (Number(x.qty) > 0 && !x.brigadeId ? { ...x, brigadeId } : x))])));

  const error = state?.error
    ?? (over.length ? `Skladda yetmaydi: ${over.map((id) => byId.get(id)?.name ?? "?").join(", ")}` : undefined)
    ?? (noBrigade ? `${noBrigade} ta qatorda brigada tanlanmagan` : undefined);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Sklad</span>
          <Select name="warehouseId" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="h-9 w-48 text-sm">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Izoh</span>
          <Input name="note" defaultValue={initial?.note} placeholder="Qaysi ish uchun" className="h-9 w-56 text-sm" autoComplete="off" />
        </label>
        <label className="relative block flex-1 min-w-52">
          <span className="mb-1 block text-xs font-medium text-slate-600">Qidirish</span>
          <Search size={15} className="absolute bottom-2.5 left-2.5 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mahsulot nomi yoki kodi" className="h-9 pl-8 text-sm" autoComplete="off" />
        </label>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOnlyPicked((v) => !v)}>
          {onlyPicked ? "Hammasini ko'rsatish" : `Faqat belgilanganlar (${filled.length})`}
        </Button>
        {noBrigade > 0 && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Brigadasizlarga</span>
            <Select value="" onChange={(e) => e.target.value && fillBrigade(e.target.value)} className="h-9 w-52 text-sm">
              <option value="">Bitta brigada qo&apos;yish…</option>
              {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </label>
        )}
      </div>

      <div className="max-h-[480px] overflow-y-auto">
        <Table>
          <thead><tr><Th>Mahsulot</Th><Th right>Skladda</Th><Th right>Beriladigan miqdor</Th><Th>Brigada</Th><Th right>Qoladi</Th><Th></Th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">Bu skladda mos mahsulot yo&apos;q</td></tr>}
            {list.flatMap((m) => {
              const bal = balanceOf(m);
              const give = given(m.id);
              const left = bal - give;
              const bad = give > bal + EPS;
              const splits = splitsOf(m.id);
              return splits.map((v, i) => {
                const n = Number(v.qty) || 0;
                return (
                  <Tr key={`${m.id}:${i}`} className={cn(n > 0 && !bad && (v.brigadeId ? "bg-emerald-50/50" : "bg-amber-50/60"), bad && "bg-red-50/60", i > 0 && "[&>td]:border-t-0")}>
                    <Td className="font-medium">
                      {i === 0 ? <>{m.name}<div className="text-xs text-slate-500">{m.code}</div></> : <span className="pl-3 text-xs font-normal text-slate-400">↳ {m.name}</span>}
                    </Td>
                    <Td right className="text-slate-600">{i === 0 ? `${fmtNum(bal, 3)} ${unitLabel(m.unit)}` : ""}</Td>
                    <Td right className="w-40">
                      <Input value={v.qty} onChange={(e) => setSplit(m.id, i, { qty: e.target.value })} type="number" step="0.001" min="0" max={bal}
                        placeholder="0" inputMode="decimal" className={cn("h-9 text-right", bad && n > 0 && "border-red-400 text-red-700")} />
                    </Td>
                    <Td className="w-56">
                      <Select value={v.brigadeId} onChange={(e) => setSplit(m.id, i, { brigadeId: e.target.value })} className={cn("h-9 text-sm", n > 0 && !v.brigadeId && "border-amber-400")}>
                        <option value="">Brigada tanlang…</option>
                        {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}{b.leader ? ` · ${b.leader}` : ""}</option>)}
                      </Select>
                    </Td>
                    <Td right className={cn("font-semibold tabular", bad ? "text-red-600" : left <= EPS ? "text-slate-400" : "text-slate-800")}>
                      {i === splits.length - 1 ? (bad ? "yetmaydi" : `${fmtNum(Math.max(0, left), 3)} ${unitLabel(m.unit)}`) : ""}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        {i === splits.length - 1 && n > 0 && left > EPS && (
                          <button type="button" onClick={() => addSplit(m.id)} title="Boshqa brigadaga ham bo'lish" aria-label="Boshqa brigadaga ham bo'lish" className="text-slate-400 hover:text-emerald-700"><Plus size={15} /></button>
                        )}
                        {(splits.length > 1 || n > 0) && (
                          <button type="button" onClick={() => (splits.length > 1 ? removeSplit(m.id, i) : setSplit(m.id, 0, { qty: "" }))} aria-label="Olib tashlash" className="text-slate-400 hover:text-red-600"><X size={15} /></button>
                        )}
                      </span>
                    </Td>
                  </Tr>
                );
              });
            })}
          </tbody>
        </Table>
      </div>

      <FormError error={error} />
      {state?.ok && <FormSuccess text={state.note ?? "Berildi"} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-500">{payload.length > 0 ? `${payload.length} ta qator · ${brigadeCount} brigadaga` : "Jadvaldan miqdor yozing va brigadani tanlang; «+» bilan bir nechta brigadaga bo'lasiz"}</span>
        <Button disabled={pending || payload.length === 0 || over.length > 0 || noBrigade > 0}><HardHat size={16} /> {pending ? "Berilmoqda…" : "Brigadalarga berish"}</Button>
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
