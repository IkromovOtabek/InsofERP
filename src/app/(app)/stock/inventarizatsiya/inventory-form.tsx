"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanLine, Search } from "lucide-react";
import { saveInventory } from "../adjust-actions";
import { Button, Field, FormError, FormSuccess, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import { fmtNum, money } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { cn } from "@/lib/utils";

type Row = { id: string; name: string; code: string; unit: string; book: number; cost: number };

/** Sanoq jadvali: hisobdagi qoldiq yonida haqiqiy miqdor yoziladi, farq va uning summasi jonli hisoblanadi. */
export function InventoryForm({ warehouses, warehouseId, rows }: { warehouses: { id: string; name: string }[]; warehouseId: string; rows: Row[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveInventory, undefined);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  useEffect(() => { if (state?.ok) setCounts({}); }, [state]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => r.name.toLowerCase().includes(t) || r.code.toLowerCase().includes(t)) : rows;
  }, [rows, q]);
  const filled = rows
    .filter((r) => (counts[r.id] ?? "").trim() !== "")
    .map((r) => ({ ...r, actual: Number(String(counts[r.id]).replace(",", ".")) }));
  const invalid = filled.some((r) => !Number.isFinite(r.actual) || r.actual < 0);
  const diffs = filled.filter((r) => Number.isFinite(r.actual) && Math.abs(r.actual - r.book) > 0.0005);
  const plus = diffs.filter((r) => r.actual > r.book).reduce((s, r) => s + (r.actual - r.book) * r.cost, 0);
  const minus = diffs.filter((r) => r.actual < r.book).reduce((s, r) => s + (r.book - r.actual) * r.cost, 0);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <input type="hidden" name="rows" value={JSON.stringify(filled.map((r) => ({ materialId: r.id, book: r.book, actual: r.actual })))} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Sklad">
          <Select value={warehouseId} onChange={(e) => router.push(`/stock/inventarizatsiya?wh=${e.target.value}`)} className="w-56">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <label className="relative block min-w-52 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Qidirish</span>
          <Search size={15} className="absolute bottom-3 left-2.5 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nomi yoki kodi" className="pl-8" autoComplete="off" />
        </label>
      </div>

      <div className="max-h-[520px] overflow-y-auto">
        <Table>
          <thead><tr><Th>Xomashyo</Th><Th right>Hisobda</Th><Th right>Haqiqiy (sanaldi)</Th><Th right>Farq</Th><Th right>Farq summasi</Th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">Mos xomashyo yo&apos;q</td></tr>}
            {list.map((r) => {
              const v = (counts[r.id] ?? "").trim();
              const a = Number(v.replace(",", "."));
              const d = v !== "" && Number.isFinite(a) ? a - r.book : null;
              return (
                <Tr key={r.id} className={cn(d != null && Math.abs(d) > 0.0005 && (d < 0 ? "bg-red-50/60" : "bg-emerald-50/50"))}>
                  <Td className="font-medium">{r.name}<span className="ml-2 text-xs text-slate-400">{r.code}</span></Td>
                  <Td right className={cn("tabular", r.book < 0 && "font-semibold text-red-600")}>{fmtNum(r.book, 3)} {unitLabel(r.unit)}</Td>
                  <Td right className="w-40">
                    <Input value={counts[r.id] ?? ""} inputMode="decimal" placeholder="—" className="h-9 text-right"
                      onChange={(e) => setCounts((c) => ({ ...c, [r.id]: e.target.value }))} />
                  </Td>
                  <Td right className={cn("tabular font-medium", d == null ? "text-slate-400" : d < -0.0005 ? "text-red-600" : d > 0.0005 ? "text-emerald-700" : "text-slate-500")}>
                    {d == null ? "—" : Math.abs(d) <= 0.0005 ? "to'g'ri" : `${d > 0 ? "+" : ""}${fmtNum(d, 3)}`}
                  </Td>
                  <Td right className="tabular text-slate-600">{d != null && Math.abs(d) > 0.0005 ? money(Math.abs(d) * r.cost) : "—"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Farq sababi *" hint="Har bir farq qatoriga va auditga yoziladi">
          <Input name="reason" placeholder="Masalan: oylik sanoq, tarozi xatosi, hisobga olinmagan kirim" required autoComplete="off" />
        </Field>
        <div className="self-end rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
          Sanaldi: <b>{filled.length}</b> · farq: <b>{diffs.length}</b> qator · ortiqcha <b className="text-emerald-700">{money(plus)}</b> · kam <b className="text-red-600">{money(minus)}</b>
        </div>
      </div>
      {invalid && <p className="text-sm text-red-600">Haqiqiy qoldiq manfiy bo&apos;lmagan raqam bo&apos;lsin.</p>}
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <div className="flex justify-end">
        <Button disabled={pending || filled.length === 0 || invalid}><ScanLine size={16} /> {pending ? "Yozilmoqda…" : diffs.length ? `Farqni yozish (${diffs.length} qator)` : "Sanoqni saqlash"}</Button>
      </div>
    </form>
  );
}
