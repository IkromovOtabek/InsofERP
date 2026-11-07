"use client";

import { useActionState, useState } from "react";
import { Save } from "lucide-react";
import { Button, FormError, FormSuccess, Table, Td, Th, Tr } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { money } from "@/lib/format";
import { saveMonthEndBalances } from "../actions";

export type MonthEndRow = {
  id: string; name: string; bank: boolean;
  /** Tizimdagi qoldiq tanlangan oy oxirida */
  atDay: number;
  /** Hozirgi qoldiq */
  now: number;
  /** Hisobning faol boshlang'ich qoldig'i (bo'lsa) */
  opening: { date: string; amount: number } | null;
};

/**
 * Har hisob qatorida Exceldagi qoldiq kiritiladi; yonida — oy oxiridagi tizim qoldig'i qanchaga o'zgarishi.
 * Bo'sh qoldirilgan hisobga tegilmaydi.
 */
export function MonthEndForm({ oy, day, rows }: { oy: string; day: string; rows: MonthEndRow[] }) {
  const [state, action, pending] = useActionState(saveMonthEndBalances, undefined);
  const [vals, setVals] = useState<Record<string, string>>({});
  const filled = rows.filter((r) => (vals[r.id] ?? "") !== "");

  return (
    <form action={action}>
      <input type="hidden" name="oy" value={oy} />
      <p className="mb-2 text-sm text-slate-600">Qoldiqlar <b className="text-slate-900">{day}</b> kuni oxiri holatiga: «Tizimda» — hozir tizimda, «Excelda» — kiritiladigan qoldiq.</p>
      <Table>
        <thead>
          <tr>
            <Th>Hisob</Th>
            <Th right>Tizimda</Th>
            <Th right>Boshlang&apos;ich qoldiq</Th>
            <Th>Excelda</Th>
            <Th right>O&apos;zgaradi</Th>
            <Th right>Hozir</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = vals[r.id] ?? "";
            const diff = v === "" ? null : Math.round((Number(v) - r.atDay) * 100) / 100;
            return (
              <Tr key={r.id}>
                <Td>
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span className="block text-xs text-slate-500">{r.bank ? "bank" : "naqd"}</span>
                </Td>
                <Td right className={r.atDay < 0 ? "font-semibold text-red-600" : "font-semibold text-slate-900"}>{money(r.atDay)}</Td>
                <Td right className="text-slate-600">
                  {r.opening ? <>{money(r.opening.amount)}<span className="block text-xs text-slate-500">{r.opening.date} holatiga</span></> : "—"}
                </Td>
                <Td>
                  <div className="w-44">
                    <MoneyInput
                      name={`bal_${r.id}`} value={v} onChange={(x) => setVals((p) => ({ ...p, [r.id]: x }))}
                      ariaLabel={`${r.name}: ${day} holatiga qoldiq`}
                    />
                  </div>
                </Td>
                <Td right className={diff === null ? "text-slate-400" : Math.abs(diff) < 0.005 ? "text-emerald-700" : diff > 0 ? "text-emerald-700" : "text-red-600"}>
                  {diff === null ? "—" : Math.abs(diff) < 0.005 ? "farq yo'q" : `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`}
                </Td>
                <Td right className={r.now < 0 ? "text-red-600" : "text-slate-700"}>{money(r.now)}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={pending || filled.length === 0}><Save size={15} /> Qoldiqlarni saqlash{filled.length ? ` (${filled.length})` : ""}</Button>
        <span className="text-xs text-slate-500">Bo&apos;sh qoldirilgan hisob o&apos;zgarmaydi. «O&apos;zgaradi» — saqlangach hisob qoldig&apos;i shuncha o&apos;zgaradi.</span>
      </div>
      <div className="mt-2"><FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} /></div>
    </form>
  );
}
