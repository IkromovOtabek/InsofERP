"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageMinus, Search } from "lucide-react";
import { saveWriteOff } from "../adjust-actions";
import { WRITE_OFF_REASONS } from "../adjust-const";
import { Button, Field, FormError, FormSuccess, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import { fmtNum, money } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { cn } from "@/lib/utils";

type Mat = { id: string; name: string; code: string; unit: string; balance: number; cost: number };

/** Skladdagi xomashyo jadvali — chiqariladigan miqdor qoldiqdan oshsa qator qizaradi va tugma yopiladi. */
export function WriteOffForm({ warehouses, warehouseId, materials }: { warehouses: { id: string; name: string }[]; warehouseId: string; materials: Mat[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveWriteOff, undefined);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  useEffect(() => { if (state?.ok) setPicks({}); }, [state]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? materials.filter((m) => m.name.toLowerCase().includes(t) || m.code.toLowerCase().includes(t)) : materials;
  }, [materials, q]);
  const rows = materials
    .map((m) => ({ ...m, qty: Number(String(picks[m.id] ?? "").replace(",", ".")) || 0 }))
    .filter((m) => m.qty > 0);
  const over = rows.filter((m) => m.qty > m.balance + 0.0005);
  const sum = rows.reduce((s, m) => s + m.qty * m.cost, 0);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <input type="hidden" name="rows" value={JSON.stringify(rows.map((m) => ({ materialId: m.id, qty: m.qty })))} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Sklad">
          <Select value={warehouseId} onChange={(e) => router.push(`/stock/spisanie?wh=${e.target.value}`)} className="w-56">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <label className="relative block min-w-52 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Qidirish</span>
          <Search size={15} className="absolute bottom-3 left-2.5 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nomi yoki kodi" className="pl-8" autoComplete="off" />
        </label>
      </div>

      <div className="max-h-[480px] overflow-y-auto">
        <Table>
          <thead><tr><Th>Xomashyo</Th><Th right>Skladda</Th><Th right>Chiqariladi</Th><Th right>Summa</Th><Th right>Qoladi</Th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">Bu skladda qoldig&apos;i bor xomashyo yo&apos;q</td></tr>}
            {list.map((m) => {
              const v = Number(String(picks[m.id] ?? "").replace(",", ".")) || 0;
              const bad = v > m.balance + 0.0005;
              return (
                <Tr key={m.id} className={cn(v > 0 && !bad && "bg-amber-50/50", bad && "bg-red-50/60")}>
                  <Td className="font-medium">{m.name}<span className="ml-2 text-xs text-slate-400">{m.code}</span></Td>
                  <Td right className="tabular">{fmtNum(m.balance, 3)} {unitLabel(m.unit)}</Td>
                  <Td right className="w-40">
                    <Input value={picks[m.id] ?? ""} inputMode="decimal" placeholder="0" className={cn("h-9 text-right", bad && "border-red-300 text-red-700")}
                      onChange={(e) => setPicks((p) => ({ ...p, [m.id]: e.target.value }))} />
                  </Td>
                  <Td right className="tabular text-slate-600">{v > 0 ? money(v * m.cost) : "—"}</Td>
                  <Td right className={cn("tabular", bad ? "font-semibold text-red-600" : "text-slate-500")}>{v > 0 ? fmtNum(m.balance - v, 3) : "—"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Sabab *">
          <Select name="kind" defaultValue={WRITE_OFF_REASONS[0]}>{WRITE_OFF_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
        </Field>
        <Field label="Izoh *" className="sm:col-span-2">
          <Input name="note" required placeholder="Nima bo'ldi, kim aniqladi, dalolatnoma raqami" autoComplete="off" />
        </Field>
      </div>
      {over.length > 0 && <p className="text-sm text-red-600">Qoldiqdan ko&apos;p: {over.map((m) => m.name).join(", ")}</p>}
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-slate-500">{rows.length} ta xomashyo · <b className="text-slate-900">{money(sum)}</b></span>
        <Button variant="danger" disabled={pending || rows.length === 0 || over.length > 0}><PackageMinus size={16} /> {pending ? "Yozilmoqda…" : "Hisobdan chiqarish"}</Button>
      </div>
    </form>
  );
}
