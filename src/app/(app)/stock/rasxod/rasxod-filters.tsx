"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";

type Opt = { id: string; name: string };

/** Chiqim jurnali filtrlari: Sklad va «Kimga» (tanlanishi bilan sahifa yangilanadi, davr saqlanadi). */
export function RasxodFilters({ warehouses, recipients, brigades, wh, komu, from, to }: {
  warehouses: Opt[]; recipients: Opt[]; brigades: Opt[];
  wh: string | null; komu: string | null; from: string; to: string;
}) {
  const router = useRouter();
  const go = (patch: { wh?: string; komu?: string }) => {
    const p = new URLSearchParams({ from, to });
    const nextWh = patch.wh !== undefined ? patch.wh : wh ?? "";
    const nextKomu = patch.komu !== undefined ? patch.komu : komu ?? "";
    if (nextWh) p.set("wh", nextWh);
    if (nextKomu) p.set("komu", nextKomu);
    router.push(`/stock/rasxod?${p.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      {warehouses.length > 1 && (
        <label className="text-xs text-slate-500">Sklad
          <Select aria-label="Sklad" value={wh ?? ""} onChange={(e) => go({ wh: e.target.value })} className="mt-0.5 h-9 w-48">
            <option value="">Barcha skladlar</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </label>
      )}
      <label className="text-xs text-slate-500">Kimga
        <Select aria-label="Kimga" value={komu ?? ""} onChange={(e) => go({ komu: e.target.value })} className="mt-0.5 h-9 w-60">
          <option value="">Barchasi</option>
          {recipients.length > 0 && (
            <optgroup label="Oluvchilar">
              {recipients.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}
            </optgroup>
          )}
          {brigades.length > 0 && (
            <optgroup label="Brigadalar">
              {brigades.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.name}</option>)}
            </optgroup>
          )}
          <optgroup label="Boshqa">
            <option value="prod">Ishlab chiqarish (zames)</option>
            <option value="writeoff">Hisobdan chiqarish</option>
            <option value="inventory">Inventarizatsiya (kamomad)</option>
          </optgroup>
        </Select>
      </label>
    </div>
  );
}
