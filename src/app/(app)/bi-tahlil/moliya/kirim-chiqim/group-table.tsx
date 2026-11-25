"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Table, Td, Th, Tr } from "@/components/ui";
import { fmtJami, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { KcGroup } from "@/lib/fin-report/kirim-chiqim";

/**
 * Kirim yoki chiqim jadvali: manba qatori bosilsa ichidagi sub manbalar ochiladi.
 * «→» — shu manbaning yozuvlari Kirim-Chiqim jurnalida (davr va hisob filtri bilan).
 */
export function GroupTable({ groups, total, months, monthLabels, tone, hrefOf }: {
  groups: KcGroup[]; total: number; months: string[]; monthLabels: string[]; tone: "in" | "out";
  hrefOf: Record<string, string>;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const allOpen = groups.length > 0 && open.size === groups.length;
  const toggle = (name: string) => setOpen((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const share = (v: number) => (total > 0 ? pct((v / total) * 100) : "–");
  const bar = tone === "in" ? "bg-emerald-500" : "bg-red-500";

  return (
    <Table>
      <thead>
        <tr>
          <Th>
            <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.name)))} className="inline-flex items-center gap-1 uppercase hover:text-brand-700">
              {allOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Manba
            </button>
          </Th>
          {monthLabels.map((m) => <Th key={m} right>{m}</Th>)}
          <Th right>Jami</Th>
          <Th right>Ulush</Th>
          <Th right>Yozuv</Th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const isOpen = open.has(g.name);
          return (
            <Fragment key={g.name}>
              <Tr className="cursor-pointer bg-slate-50/60 hover:bg-slate-100/70" onClick={() => toggle(g.name)}>
                <Td className="whitespace-nowrap font-semibold text-slate-900">
                  <span className="inline-flex items-center gap-1.5">
                    {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                    {g.name}
                    {hrefOf[g.name] && <Link href={hrefOf[g.name]!} onClick={(e) => e.stopPropagation()} className="text-xs font-normal text-slate-400 hover:text-brand-700" title="Yozuvlarni jurnalda ko'rish">→</Link>}
                  </span>
                </Td>
                {months.map((_, i) => <Td key={i} right className="font-medium">{g.months[i] ? fmtJami(g.months[i]!) : "–"}</Td>)}
                <Td right className="font-semibold text-slate-900">{fmtJami(g.total)}</Td>
                <Td right>
                  <span className="inline-flex items-center gap-2">
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 sm:inline-block"><span className={cn("block h-full rounded-full", bar)} style={{ width: `${total > 0 ? Math.min(100, (g.total / total) * 100) : 0}%` }} /></span>
                    {share(g.total)}
                  </span>
                </Td>
                <Td right className="text-slate-500">{g.count}</Td>
              </Tr>
              {isOpen && g.subs.map((s) => (
                <Tr key={`${g.name}/${s.name}`}>
                  <Td className="whitespace-nowrap pl-10 text-slate-600">{s.name}</Td>
                  {months.map((_, i) => <Td key={i} right className="text-slate-600">{s.months[i] ? fmtJami(s.months[i]!) : "–"}</Td>)}
                  <Td right className="text-slate-700">{fmtJami(s.total)}</Td>
                  <Td right className="text-slate-500">{share(s.total)}</Td>
                  <Td right className="text-slate-400">{s.count}</Td>
                </Tr>
              ))}
            </Fragment>
          );
        })}
        <Tr className="border-t-2 border-slate-200 bg-brand-50/60">
          <Td className="font-bold text-slate-900">Jami {tone === "in" ? "kirim" : "chiqim"}</Td>
          {months.map((_, i) => { const v = groups.reduce((s, g) => s + (g.months[i] ?? 0), 0); return <Td key={i} right className="font-bold">{v ? fmtJami(v) : "–"}</Td>; })}
          <Td right className={cn("font-bold", tone === "in" ? "text-emerald-700" : "text-red-700")}>{fmtJami(total)}</Td>
          <Td right className="font-semibold">{total > 0 ? "100%" : "–"}</Td>
          <Td right className="font-semibold text-slate-500">{groups.reduce((s, g) => s + g.count, 0)}</Td>
        </Tr>
      </tbody>
    </Table>
  );
}
