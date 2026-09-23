"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { pickProduct } from "./lead-bus";

export type CatalogProduct = {
  id: string;
  code: string;
  name: string;
  unit: string;
  strengthClass: string | null;
  price: string;
  groupId: string;
  groupName: string;
};

export type CatalogGroup = { id: string; name: string; count: number };

/**
 * Mahsulot katalogi — kartalar emas, zavod ro'yxati ko'rinishida.
 *
 * Qurilishchi mahsulotni suratdan emas, kod va sinf bo'yicha qidiradi: shuning
 * uchun ma'lumot zich jadvalda, mono shriftda beriladi. Papka bo'yicha filtr
 * sahifani yangilamaydi, "So'rash" esa formaga shu mahsulotni olib o'tadi.
 */
export function Catalog({ products, groups, showPrices }: { products: CatalogProduct[]; groups: CatalogGroup[]; showPrices: boolean }) {
  const [group, setGroup] = useState<string>("all");

  const rows = useMemo(() => (group === "all" ? products : products.filter((p) => p.groupId === group)), [products, group]);

  const request = (id: string) => {
    pickProduct(id);
    document.getElementById("ariza")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div>
      {groups.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Chip label="Hammasi" count={products.length} active={group === "all"} onClick={() => setGroup("all")} />
          {groups.map((g) => (
            <Chip key={g.id} label={g.name} count={g.count} active={group === g.id} onClick={() => setGroup(g.id)} />
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-beton-200 bg-white">
        {/* Jadval sarlavhasi — faqat ish stolida; telefonda qator o'zi ikki satrga bo'linadi */}
        <div className="hidden grid-cols-[7rem_minmax(0,1fr)_6rem_4.5rem_10rem] gap-4 border-b border-beton-200 bg-beton-100 px-6 py-3 font-mono text-[10px] tracking-[0.16em] text-beton-600 uppercase lg:grid">
          <span>Kod</span>
          <span>Nomi</span>
          <span>Sinf</span>
          <span>Birlik</span>
          <span className="text-right">Narx</span>
        </div>

        {rows.map((p, i) => {
          // "Hammasi" tanlanganda papka nomi jadval ichida ajratgich qator bo'lib turadi
          const newGroup = group === "all" && (i === 0 || rows[i - 1].groupName !== p.groupName);
          return (
            <div key={p.id}>
              {newGroup && (
                <div className="border-b border-beton-200 bg-beton-50 px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-beton-600 uppercase lg:px-6">
                  {p.groupName}
                </div>
              )}
              <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-beton-200 px-4 py-4 transition-colors hover:bg-beton-50 lg:grid-cols-[7rem_minmax(0,1fr)_5.5rem_4rem_12rem] lg:px-6">
                <span className="hidden font-mono text-xs text-beton-700 lg:block">{p.code}</span>

                <div className="min-w-0">
                  <div className="truncate font-medium text-beton-900">{p.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-beton-500 lg:hidden">
                    {p.code}
                    {p.strengthClass ? ` · ${p.strengthClass}` : ""} · {unitLabel(p.unit)}
                  </div>
                </div>

                <span className="hidden font-mono text-xs text-beton-600 lg:block">{p.strengthClass ?? "—"}</span>
                <span className="hidden font-mono text-xs text-beton-600 lg:block">{unitLabel(p.unit)}</span>

                <div className="flex items-center justify-end gap-5">
                  {showPrices && Number(p.price) > 0 ? (
                    <span className="hidden font-mono text-xs whitespace-nowrap text-beton-900 tabular-nums lg:inline">
                      {fmtNum(p.price)}<span className="text-beton-500"> so&apos;m</span>
                    </span>
                  ) : (
                    <span className="hidden font-mono text-[11px] whitespace-nowrap text-beton-500 lg:inline">So&apos;rov bo&apos;yicha</span>
                  )}
                  <button
                    type="button"
                    onClick={() => request(p.id)}
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-insof-600 transition-colors hover:text-signal-dim"
                  >
                    So&apos;rash <ArrowUpRight size={13} className="transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 font-mono text-[11px] text-beton-500">
        Narx hajm, marka va obyekt masofasiga qarab hisoblanadi — shuning uchun ro&apos;yxatda ko&apos;rsatilmaydi.
      </p>
    </div>
  );
}

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-baseline gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
        active ? "bg-insof-900 text-white" : "bg-white text-beton-600 ring-1 ring-beton-200 hover:text-beton-900"
      }`}
    >
      {label}
      <span className={active ? "text-signal" : "text-beton-400"}>{count}</span>
    </button>
  );
}
