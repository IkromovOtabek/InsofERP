"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { DeleteButton } from "@/components/delete-button";
import { deleteCatalogProduct } from "@/lib/catalog-actions";
import { cn } from "@/lib/utils";

export type RecipeRow = { id: string; name: string; version: number | null; summary: string };

/**
 * Retseptlar ro'yxati — 1C dagi spravochnik ro'yxati kabi: bitta bosish qatorni
 * belgilaydi, ikki marta bosish (yoki "Ochish →") retsept sahifasini ochadi.
 */
export function RecipesTable({ products, canDelete }: { products: RecipeRow[]; canDelete: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(null);
  const open = (id: string) => router.push(`/recipes/${id}`);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="overflow-x-auto rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
            <th className="px-4 py-2.5">Mahsulot</th>
            <th className="px-4 py-2.5">Versiya</th>
            <th className="px-4 py-2.5">Tarkib (1 birlik)</th>
            <th className="px-4 py-2.5" />
            {canDelete && <th className="px-4 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const active = sel === p.id;
            return (
              <tr
                key={p.id}
                onClick={() => setSel(p.id)}
                onDoubleClick={() => open(p.id)}
                className={cn("cursor-pointer border-b border-slate-100 transition-colors", active ? "bg-slate-900 text-white" : "hover:bg-slate-50/70")}
              >
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">
                  {p.version ? <Badge color="green">v{p.version}</Badge> : <Badge color="red">Retsept yo&apos;q</Badge>}
                </td>
                <td className={cn("px-4 py-3", active ? "text-slate-200" : "text-slate-600")}>{p.summary || "—"}</td>
                <td className="px-4 py-3" onClick={stop} onDoubleClick={stop}>
                  <Link href={`/recipes/${p.id}`} className={cn("text-sm hover:underline", active ? "text-white" : "text-slate-700")}>Ochish →</Link>
                </td>
                {canDelete && (
                  <td className="px-4 py-3" onClick={stop} onDoubleClick={stop}>
                    <DeleteButton action={deleteCatalogProduct} id={p.id} name={p.name} title="Mahsulotni o'chirish" />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
