"use client";

import { useMemo, useState } from "react";
import { BarChart3, Boxes, Check, ChevronRight, Factory, Languages, Layers, Lock, Megaphone, Minus, RotateCcw, Search, ShoppingCart, Truck, Users, Wallet, type LucideIcon } from "lucide-react";
import type { PermModule } from "@/lib/perm-modules";
import { SCRIPT_PERM, WRITE_SCRIPTS } from "@/lib/permissions";

/**
 * Ruxsatlar daraxti (1-variant): bo'lim (menyu guruhi) → tugma (oyna) → amal, uch holatli belgilar bilan.
 * Formaga avvalgidek `perm.<modul>` va `act.<modul>` bo'lib ketadi (`permsFromForm` o'qiydi): oyna — `@kalit`.
 * Tegilmagan modul o'z qiymatini saqlaydi; o'zgargani rolning odatiy holatiga teng bo'lsa — "rol bo'yicha" ga qaytadi.
 * Bitta xodim, lavozim login shabloni va bir nechta xodimga birdan tahrirlash shu bittasidan foydalanadi.
 */

type Val = string | string[];
type St = "none" | "some" | "all";
type ModState = { kind: "orig" } | { kind: "role" } | { kind: "set"; set: string[] };
type Mode = "all" | "granted" | "diff" | "explicit";

const W = (k: string) => "@" + k;
const GROUP_ICON: Record<string, LucideIcon> = {
  Sotuv: ShoppingCart, Marketing: Megaphone, "Ishlab chiqarish": Factory, Logistika: Truck, Sklad: Boxes,
  Moliya: Wallet, "Otdel kadr": Users, Boshqaruv: Users, Tahlil: BarChart3,
};
const MODES: [Mode, string][] = [["all", "Hammasi"], ["granted", "Berilganlar"], ["diff", "Roldan farqi"], ["explicit", "Alohida beriladiganlar"]];

const roleSet = (m: PermModule) => (m.role ? [...m.role.buttons.map(W), ...m.role.actions] : null);
const windowsOf = (m: PermModule) => m.buttons.filter((b) => b.window).map((b) => W(b.key));

/** Saqlangan qiymat → daraxtdagi belgilar (oynalar va amallar). `undefined` — rol bo'yicha. */
function setFromValue(m: PermModule, v: Val | undefined): string[] {
  if (v === undefined || v === "") return roleSet(m) ?? [];
  if (v === "none") return [];
  if (v === "view") return windowsOf(m);
  if (v === "write") return [...windowsOf(m), ...m.actions.filter((a) => !a.explicit).map((a) => a.key)];
  if (Array.isArray(v)) return v.some((x) => x.startsWith("@")) ? v : [...windowsOf(m), ...v]; // eski ro'yxat — hamma oyna ochiq
  return [];
}

function levelOf(v: Val | undefined): string {
  if (Array.isArray(v)) return "custom";
  return v === "none" || v === "view" || v === "write" ? v : "";
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const stOf = (items: { on: boolean; explicit: boolean }[]): St => {
  if (!items.some((i) => i.on)) return "none";
  return items.filter((i) => !i.explicit).every((i) => i.on) ? "all" : "some";
};

function Tri({ st, small }: { st: St; small?: boolean }) {
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-[5px] border-[1.5px] ${small ? "h-4 w-4" : "h-[18px] w-[18px]"} ${st === "none" ? "border-slate-500 bg-white" : "border-slate-900 bg-slate-900 text-white"}`}>
      {st === "all" ? <Check size={11} strokeWidth={3.5} /> : st === "some" ? <Minus size={11} strokeWidth={3.5} /> : null}
    </span>
  );
}

const aria = (st: St) => (st === "all" ? "true" : st === "some" ? "mixed" : "false") as "true" | "mixed" | "false";
const Tag = ({ tone, children }: { tone: "slate" | "green" | "red" | "amber"; children: React.ReactNode }) => (
  <span className={`whitespace-nowrap rounded-md px-1.5 text-[11px] font-semibold ${{ slate: "bg-slate-100 text-slate-600", green: "bg-emerald-50 text-emerald-700", red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-700" }[tone]}`}>{children}</span>
);
const Pill = ({ tone, children }: { tone: "slate" | "green" | "red"; children: React.ReactNode }) => (
  <span className={`whitespace-nowrap rounded-full px-2 text-xs font-semibold tabular ${{ slate: "bg-slate-100 text-slate-600", green: "bg-emerald-50 text-emerald-700", red: "bg-red-50 text-red-700" }[tone]}`}>{children}</span>
);

export function PermsTree({ modules, current, onChange, footer }: {
  modules: PermModule[];
  current: Record<string, Val>;
  onChange?: () => void;
  /** Pastki panel: `reset` — hammasini "rol bo'yicha" ga qaytaradi. */
  footer?: (reset: () => void) => React.ReactNode;
}) {
  const [states, setStates] = useState<Record<string, ModState>>({});
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("all");
  const [openG, setOpenG] = useState<Set<string>>(() => new Set(modules.filter((m) => current[m.key] !== undefined).map((m) => m.group)));
  const [openB, setOpenB] = useState<Set<string>>(new Set());
  const hasRole = modules.some((m) => m.role);
  // Yozish tili (`perms.til`): lotin doim, qo'shimcha yozuvlar shu yerda — modul emas, daraxtdan tashqarida
  const [til, setTil] = useState<string[]>(() => { const v = current[SCRIPT_PERM]; return Array.isArray(v) ? v : []; });
  const toggleTil = (k: string) => { setTil((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k])); onChange?.(); };

  const stOfMod = (m: PermModule): ModState => states[m.key] ?? { kind: "orig" };
  const roleMode = (m: PermModule) => { const k = stOfMod(m).kind; return k === "role" || (k === "orig" && current[m.key] === undefined); };
  const display = (m: PermModule): string[] => {
    const s = stOfMod(m);
    return s.kind === "set" ? s.set : s.kind === "role" ? roleSet(m) ?? [] : setFromValue(m, current[m.key]);
  };
  const update = (m: PermModule, fn: (set: string[]) => string[]) => {
    setStates((p) => ({ ...p, [m.key]: { kind: "set", set: [...new Set(fn(display(m)))] } }));
    onChange?.();
  };
  const reset = () => { setStates(Object.fromEntries(modules.map((m) => [m.key, { kind: "role" } as ModState]))); setTil([]); onChange?.(); };
  const resetModule = (m: PermModule) => { setStates((p) => ({ ...p, [m.key]: { kind: "role" } })); onChange?.(); };

  // Daraxt: bo'lim → modul → tugma → amal, joriy belgilar va roldan farqi bilan
  const tree = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const groups = [...new Set(modules.map((m) => m.group))];
    return groups.map((g) => {
      const mods = modules.filter((m) => m.group === g).map((m) => {
        // Belgilar rolning odatiy holatiga qaytgan bo'lsa ham "rol bo'yicha" (saqlanganda ham shunday ketadi)
        const set = display(m), base = m.role ? roleSet(m) ?? [] : null, rm = roleMode(m) || (!!base && sameSet(set, base));
        const label = (k: string) => m.actions.find((a) => a.key === k);
        const buttons = m.buttons.map((b) => {
          const items = [
            ...(b.window ? [{ key: W(b.key), label: "Ko'rish — oyna ochiladi", hint: undefined as string | undefined, explicit: false, view: true }] : []),
            ...b.actions.flatMap((k) => { const a = label(k); return a ? [{ key: k, label: a.label, hint: a.hint, explicit: !!a.explicit, view: false }] : []; }),
          ].map((i) => {
            const on = set.includes(i.key), inRole = !!base?.includes(i.key);
            return { ...i, on, role: inRole, added: !!base && !rm && on && !inRole, removed: !!base && !rm && !on && inRole };
          });
          const locked = m.locked.filter((a) => b.actions.includes(a.key));
          const text = `${g} ${m.label} ${b.label} ${items.map((i) => i.label).join(" ")}`.toLowerCase();
          return {
            ...b, id: `${m.key}.${b.key}`, items, locked, st: stOf(items), n: items.filter((i) => i.on).length,
            visible: !b.window || set.includes(W(b.key)), added: items.filter((i) => i.added).length, removed: items.filter((i) => i.removed).length,
            match: !needle || text.includes(needle),
          };
        });
        const all = buttons.flatMap((b) => b.items);
        const shown = buttons.filter((b) => b.match && (mode === "all" || (mode === "granted" && b.n > 0) || (mode === "diff" && (b.added || b.removed)) || (mode === "explicit" && (b.items.some((i) => i.explicit) || b.locked.length > 0))));
        return { m, set, rm, buttons, shown, st: stOf(all), n: all.filter((i) => i.on).length, total: all.length, added: all.filter((i) => i.added).length, removed: all.filter((i) => i.removed).length };
      });
      const all = mods.flatMap((x) => x.buttons.flatMap((b) => b.items));
      const wins = mods.flatMap((x) => x.buttons.filter((b) => b.window));
      return {
        g, mods, shown: mods.some((x) => x.shown.length > 0), st: stOf(all), n: all.filter((i) => i.on).length, total: all.length,
        winOpen: wins.filter((b) => b.visible).length, winTotal: wins.length,
        added: mods.reduce((s, x) => s + x.added, 0), removed: mods.reduce((s, x) => s + x.removed, 0),
      };
    });
    // display/roleMode `states` va `current` dan hisoblanadi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules, current, states, q, mode]);

  type T = (typeof tree)[number];
  type TB = T["mods"][number]["buttons"][number];

  /** Tugmani to'liq berish (alohida amallar o'zgarmaydi) yoki butunlay olish */
  const fill = (set: string[], b: TB, on: boolean) => on
    ? [...set, ...b.items.filter((i) => !i.explicit).map((i) => i.key)]
    : set.filter((k) => !b.items.some((i) => i.key === k));
  const toggleGroup = (g: T) => g.mods.forEach((x) => update(x.m, (set) => x.buttons.reduce((s, b) => fill(s, b, g.st !== "all"), set)));
  const toggleButton = (m: PermModule, b: TB) => update(m, (set) => fill(set, b, b.st !== "all"));
  const toggleItem = (m: PermModule, b: TB, key: string) => update(m, (set) => {
    if (set.includes(key)) return key.startsWith("@") ? set.filter((k) => k !== key && !b.actions.includes(k)) : set.filter((k) => k !== key);
    return b.window ? [...set, key, W(b.key)] : [...set, key];
  });
  const flip = (s: Set<string>, k: string) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const forced = !!q.trim() || mode !== "all";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3">
          <Search size={15} className="text-slate-500" aria-hidden />
          <span className="sr-only">Tugma yoki amalni qidirish</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tugma yoki amal: «storno», «Kirim»…" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <div role="group" aria-label="Ko'rinish" className="flex flex-wrap gap-1">
          {MODES.filter(([k]) => hasRole || k !== "diff").map(([k, l]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}
              className={`h-10 rounded-lg border px-3 text-xs font-semibold transition ${mode === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><Tri st="all" small /> berilgan</span>
        <span className="inline-flex items-center gap-1.5"><Tri st="some" small /> qisman</span>
        {hasRole && <span className="inline-flex items-center gap-1.5"><Tag tone="slate">rol</Tag> rolda odatda bor</span>}
        <span className="inline-flex items-center gap-1.5"><Tag tone="amber">alohida</Tag> «hammasi» bilan berilmaydi</span>
        <span className="inline-flex items-center gap-1.5"><Lock size={12} /> faqat direktor</span>
      </div>

      {tree.filter((g) => g.shown).map((g) => {
        const open = forced || openG.has(g.g);
        const Icon = GROUP_ICON[g.g] ?? Layers;
        return (
          <section key={g.g} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-1 py-1 pl-1 pr-3">
              <button type="button" role="checkbox" aria-checked={aria(g.st)} aria-label={`${g.g} — butun bo'lim`} onClick={() => toggleGroup(g)} className="flex h-11 w-11 shrink-0 items-center justify-center"><Tri st={g.st} /></button>
              <button type="button" aria-expanded={open} onClick={() => setOpenG((s) => flip(s, g.g))} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-1 text-left">
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon size={17} /></span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block font-semibold">{g.g}</span>
                    <span className="block text-xs text-slate-500">{g.winOpen} / {g.winTotal} oyna ochiq · {g.n} / {g.total} belgi</span>
                  </span>
                  {g.added > 0 && <Pill tone="green">+{g.added}</Pill>}
                  {g.removed > 0 && <Pill tone="red">−{g.removed}</Pill>}
                  <span aria-hidden className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-slate-200 sm:block"><span className="block h-full rounded-full bg-slate-900" style={{ width: `${g.total ? Math.round((g.n / g.total) * 100) : 0}%` }} /></span>
                </span>
                <ChevronRight size={16} aria-hidden className={`shrink-0 text-slate-500 transition ${open ? "rotate-90" : ""}`} />
              </button>
            </div>

            {open && g.mods.filter((x) => x.shown.length > 0).map((x) => (
              <div key={x.m.key} className="border-t border-slate-100 pb-1">
                <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-2.5 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-slate-500">{x.m.label}</span>
                  {x.rm ? <Tag tone="slate">{x.m.role ? "rol bo'yicha" : "har kim o'z roli bo'yicha"}</Tag> : x.n === 0 ? <Tag tone="red">yopiq</Tag> : <Tag tone="amber">o&apos;zgartirilgan</Tag>}
                  <span className="text-slate-500 tabular">{x.n} / {x.total}</span>
                  {!x.rm && <button type="button" onClick={() => resetModule(x.m)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 font-medium text-slate-600 hover:bg-slate-100"><RotateCcw size={12} /> Rol bo&apos;yicha</button>}
                </div>
                {x.shown.map((b) => {
                  const bOpen = forced || openB.has(b.id);
                  return (
                    <div key={b.id} className="px-3 sm:pl-6">
                      <div className="flex items-center gap-1 border-t border-slate-50">
                        <button type="button" role="checkbox" aria-checked={aria(b.st)} aria-label={`${b.label} — tugma va barcha amallari`} onClick={() => toggleButton(x.m, b)} className="flex h-11 w-11 shrink-0 items-center justify-center"><Tri st={b.st} small /></button>
                        <button type="button" aria-expanded={bOpen} onClick={() => setOpenB((s) => flip(s, b.id))} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                            <span className={`text-sm font-medium ${b.visible ? "text-slate-900" : "text-slate-500"}`}>{b.label}</span>
                            <Pill tone="slate">{b.n} / {b.items.length}</Pill>
                            {b.window && !b.visible && <span className="text-xs text-slate-500">oyna yopiq</span>}
                            {!b.window && <span className="text-xs text-slate-500">boshqa oynada</span>}
                            {b.added > 0 && <Pill tone="green">+{b.added}</Pill>}
                            {b.removed > 0 && <Pill tone="red">−{b.removed}</Pill>}
                          </span>
                          <ChevronRight size={15} aria-hidden className={`shrink-0 text-slate-500 transition ${bOpen ? "rotate-90" : ""}`} />
                        </button>
                      </div>
                      {bOpen && (
                        <div className="grid gap-1.5 pb-3 pl-2 sm:grid-cols-2 sm:pl-11">
                          {b.items.map((i) => (
                            <button key={i.key} type="button" role="checkbox" aria-checked={i.on} onClick={() => toggleItem(x.m, b, i.key)}
                              className={`flex min-h-11 items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${i.on ? "border-slate-300 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                              <span className="mt-0.5"><Tri st={i.on ? "all" : "none"} small /></span>
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className={`text-sm ${i.view ? "font-semibold" : "font-medium"}`}>{i.label}</span>
                                  {i.role && <Tag tone="slate">rol</Tag>}
                                  {i.added && <Tag tone="green">+ qo&apos;shimcha</Tag>}
                                  {i.removed && <Tag tone="red">− olingan</Tag>}
                                  {i.explicit && <Tag tone="amber">alohida</Tag>}
                                </span>
                                {i.view && <span className="mt-0.5 block text-xs text-slate-500">O&apos;chirilsa, tugma va uning amallari yopiladi</span>}
                                {i.hint && <span className="mt-0.5 block text-xs text-slate-500">{i.hint}</span>}
                              </span>
                            </button>
                          ))}
                          {b.locked.map((a) => (
                            <div key={a.key} className="flex min-h-11 items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-slate-500">
                              <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
                              <span className="min-w-0 flex-1 text-sm">{a.label} <Tag tone="slate">faqat direktor</Tag>{a.hint && <span className="mt-0.5 block text-xs">{a.hint}</span>}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        );
      })}
      {!tree.some((g) => g.shown) && <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">Mos tugma yoki amal topilmadi</p>}

      <section className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Languages size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Yozish tili</span>
            <span className="block text-xs text-slate-500">Maydonlarga faqat lotin yozuvida yoziladi. Boshqa yozuvda yozishi kerak bo&apos;lsa — belgilang</span>
          </span>
        </div>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
          <div className="flex min-h-11 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm text-slate-500"><Tri st="all" small /> Lotin <Tag tone="slate">doim</Tag></div>
          {WRITE_SCRIPTS.map((sc) => {
            const on = til.includes(sc.key);
            return (
              <button key={sc.key} type="button" role="checkbox" aria-checked={on} onClick={() => toggleTil(sc.key)}
                className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition ${on ? "border-slate-300 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                <Tri st={on ? "all" : "none"} small />{sc.label}
              </button>
            );
          })}
        </div>
        {til.map((k) => <input key={k} type="hidden" name={SCRIPT_PERM} value={k} />)}
      </section>

      {modules.map((m) => {
        const s = stOfMod(m);
        let level = levelOf(current[m.key]);
        let acts = Array.isArray(current[m.key]) ? (current[m.key] as string[]) : [];
        if (s.kind === "role") { level = ""; acts = []; }
        if (s.kind === "set") {
          const base = roleSet(m);
          if (base && sameSet(s.set, base)) { level = ""; acts = []; }
          else if (s.set.length === 0) { level = "none"; acts = []; }
          else { level = "custom"; acts = s.set; }
        }
        return (
          <span key={m.key} hidden>
            <input type="hidden" name={`perm.${m.key}`} value={level} />
            {level === "custom" && acts.map((a) => <input key={a} type="hidden" name={`act.${m.key}`} value={a} />)}
          </span>
        );
      })}
      {footer?.(reset)}
    </div>
  );
}
