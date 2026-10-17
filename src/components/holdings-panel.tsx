"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, HardHat, Search, User, Users } from "lucide-react";
import { Badge, Input } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { unitShort } from "@/lib/unit";
import { cn } from "@/lib/utils";
import type { Holding } from "@/lib/holdings";

const KIND = {
  brigade: { label: "Brigada", icon: HardHat, color: "amber" as const, note: "qo'lida" },
  employee: { label: "Xodim", icon: User, color: "blue" as const, note: "shu oy olgan" },
  recipient: { label: "Oluvchi", icon: Users, color: "slate" as const, note: "shu oy olgan" },
};
type Filter = "all" | Holding["kind"];

function Items({ h, max }: { h: Holding; max?: number }) {
  if (!h.items.length) return <p className="text-sm text-slate-400">{h.kind === "brigade" ? "Qo'lida xomashyo yo'q" : "Hech narsa olmagan"}</p>;
  const list = max ? h.items.slice(0, max) : h.items;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {list.map((x) => (
        <li key={x.materialId} className="flex items-baseline justify-between gap-3 py-1">
          <span className="min-w-0 truncate text-slate-700">{x.name}</span>
          <span className="shrink-0 tabular whitespace-nowrap">
            <b className="font-semibold text-slate-900">{`${fmtNum(x.qty, 3)} ${unitShort(x.unit)}`}</b>
            {h.kind !== "brigade" && x.total > x.qty && <span className="ml-1.5 text-xs text-slate-400">{`jami ${fmtNum(x.total, 3)}`}</span>}
          </span>
        </li>
      ))}
      {max && h.items.length > max && <li className="pt-1 text-xs text-slate-500">{`yana ${h.items.length - max} xil…`}</li>}
    </ul>
  );
}

/** Formada tanlangan «Kimga» da hozir nima borligi (brigada — qo'lidagi qoldiq, xodim/oluvchi — shu oy olgani). */
export function TargetHoldings({ holdings, targetKey }: { holdings: Holding[]; targetKey: string }) {
  if (!targetKey) return null;
  const h = holdings.find((x) => x.key === targetKey);
  const k = /^([ber]):/.exec(targetKey)?.[1];
  const kind = k === "b" ? "brigade" : k === "e" ? "employee" : "recipient";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{`${h?.name ?? "Tanlangan oluvchi"} — ${KIND[kind].note}${kind === "brigade" ? "" : " (yonida — barcha vaqt jami)"}`}</span>
        {h && <Link href={h.href} className="font-medium text-slate-700 underline hover:text-slate-900">Kartasi</Link>}
      </div>
      {h ? <Items h={h} max={12} /> : <p className="text-sm text-slate-400">{kind === "brigade" ? "Qo'lida xomashyo yo'q" : "Hali hech narsa olmagan"}</p>}
    </div>
  );
}

/**
 * «Kimda nima bor» — barcha brigadalar, xodimlar va oluvchilar: qidiruv (ism yoki tovar) va tur filtri.
 * `collapsible` — formalarda yig'ilgan holda turadi, bosilganda ochiladi.
 */
export function HoldingsPanel({ holdings, collapsible = false }: { holdings: Holding[]; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return holdings.filter((h) => (filter === "all" || h.kind === filter) && (!t || h.name.toLowerCase().includes(t) || h.items.some((x) => x.name.toLowerCase().includes(t))));
  }, [holdings, q, filter]);
  const count = (k: Filter) => (k === "all" ? holdings.length : holdings.filter((h) => h.kind === k).length);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => collapsible && setOpen((o) => !o)} aria-expanded={open}
        className={cn("flex w-full items-center justify-between gap-3 px-4 py-3 text-left", collapsible && "hover:bg-slate-50")}>
        <span>
          <span className="block text-sm font-semibold text-slate-900">Kimda nima bor</span>
          <span className="block text-xs text-slate-500">Brigada — qo&apos;lidagi qoldiq; xodim va oluvchi — shu oyda olgani (yonida barcha vaqt jami)</span>
        </span>
        {collapsible && <ChevronDown size={18} className={cn("shrink-0 text-slate-400 transition", open && "rotate-180")} />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism yoki tovar nomi" className="pl-9" aria-label="Kimda nima bor — qidiruv" />
            </div>
            {(["all", "brigade", "employee", "recipient"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition",
                  filter === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500")}>
                {k === "all" ? "Hammasi" : k === "brigade" ? "Brigadalar" : k === "employee" ? "Xodimlar" : "Oluvchilar"}
                <span className={cn("ml-1 tabular", filter === k ? "text-white/70" : "text-slate-400")}>{count(k)}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Hech narsa topilmadi</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((h) => {
                const K = KIND[h.kind];
                return (
                  <div key={h.key} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <Link href={h.href} className="min-w-0 font-medium text-slate-900 hover:underline">
                        <span className="block truncate">{h.name}</span>
                        {h.sub && <span className="block truncate text-xs font-normal text-slate-500">{h.sub}</span>}
                      </Link>
                      <Badge color={K.color}>{K.label}</Badge>
                    </div>
                    <Items h={h} max={8} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
