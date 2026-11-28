import { Button, Input } from "@/components/ui";

/** «O'zim tanlayman»: sanadan — sanagacha (oddiy GET forma) */
export function PeriodForm({ from, to, xodim, keep }: { from: string; to: string; xodim?: string; keep?: Record<string, string | undefined> }) {
  return (
    <form className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="davr" value="tanlov" />
      {xodim && <input type="hidden" name="xodim" value={xodim} />}
      {Object.entries(keep ?? {}).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <Input type="date" name="dan" defaultValue={from} aria-label="Sanadan" className="w-auto" />
      <span className="pb-2 text-slate-400">—</span>
      <Input type="date" name="gacha" defaultValue={to} aria-label="Sanagacha" className="w-auto" />
      <Button type="submit" variant="secondary">Ko'rsatish</Button>
    </form>
  );
}
