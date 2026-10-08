"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui";
import { CHECK_KEY_EXAMPLES, HELP, HELP_GROUPS, helpForCheckKey, type HelpGroup, type HelpTopic } from "@/lib/control/help-content";
import { HelpBody, Rich } from "../_help/help";

type Entry = { id: string; t: HelpTopic; hay: string };

const norm = (s: string) => s.toLowerCase().replace(/[`'’ʻʼ‘]/g, "");

function haystack(id: string, t: HelpTopic) {
  return norm([id, t.title, t.what, t.why, t.normal, t.keywords, ...(t.steps ?? []), t.action?.does, t.action?.risk, t.action?.use].filter(Boolean).join(" "));
}

/** Qidiruvli lug'at: barcha mavzular guruhlab, har biri ochiladigan blok. */
export function HelpGlossary() {
  const [q, setQ] = useState("");
  const all = useMemo<Entry[]>(() => [
    ...Object.entries(HELP).map(([id, t]) => ({ id, t, hay: haystack(id, t) })),
    ...CHECK_KEY_EXAMPLES.map((k) => {
      const t = helpForCheckKey(k);
      return { id: k, t: { ...t, title: `${t.title} — \`${k}\`` }, hay: haystack(k, t) };
    }),
  ], []);
  const words = norm(q).split(/\s+/).filter(Boolean);
  const shown = words.length ? all.filter((e) => words.every((w) => e.hay.includes(w))) : all;
  const groups = (Object.keys(HELP_GROUPS) as HelpGroup[])
    .map((g) => ({ g, list: shown.filter((e) => e.t.group === g) }))
    .filter((x) => x.list.length > 0);

  return (
    <div className="space-y-5">
      <label className="relative block max-w-xl">
        <span className="sr-only">Yordamdan qidirish</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish: disk, SSL, bloklash, agent…" className="pl-9" autoFocus />
      </label>
      <p className="text-xs text-slate-500" role="status">{shown.length} ta mavzu</p>
      {groups.length === 0 && <p className="text-sm text-slate-500">Hech narsa topilmadi — boshqa so&apos;z bilan qidiring.</p>}
      {groups.map(({ g, list }) => (
        <section key={g} aria-labelledby={`g-${g}`}>
          <h2 id={`g-${g}`} className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">{HELP_GROUPS[g]} · {list.length}</h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
            {list.map((e) => (
              <details key={e.id} id={`h-${e.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`} open={words.length > 0 && shown.length <= 3} className="group px-4 py-3">
                <summary className="cursor-pointer select-none text-sm font-medium text-slate-900 marker:text-slate-400"><Rich text={e.t.title} /></summary>
                <div className="mt-3"><HelpBody t={e.t} /></div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
