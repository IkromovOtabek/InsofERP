"use client";

import { startTransition, useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutList, ListTree, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "@/lib/nav-groups";
import { Badge, Button, Field, FormError, FormSuccess, IconButton, Select } from "@/components/ui";
import { saveMenuPrefs } from "./actions";

type Item = { href: string; label: string; group: string };

/**
 * «Kabinetim»: xodim chap menyusini o'zi sozlaydi — bo'limli yoki bo'limsiz ko'rinish, bandlarni yashirish va tartiblash,
 * kirgandan keyin ochiladigan sahifa. `items` — saqlangan tartibda (yashirilganlari ham), `defaultOrder` va `flatDefault` —
 * rol bo'yicha sukut («Sukut holatiga qaytarish» shularni qo'yadi, Saqlash bilan kuchga kiradi). `lib/menu-prefs.ts`.
 */
export function MenuPrefsForm({ items, hidden: hidden0, flat: flat0, home: home0, showHome, defaultOrder, flatDefault }:
  { items: Item[]; hidden: string[]; flat: boolean; home: string | null; showHome: boolean; defaultOrder: string[]; flatDefault: boolean }) {
  const [state, action, pending] = useActionState(saveMenuPrefs, undefined);
  const [flat, setFlat] = useState(flat0);
  const [order, setOrder] = useState(items.map((i) => i.href));
  const [hidden, setHidden] = useState(() => new Set(hidden0));
  const [home, setHome] = useState(home0 ?? "");
  const isDefault = flat === flatDefault && !hidden.size && !home && order.join("|") === defaultOrder.join("|");
  const resetAll = () => { setFlat(flatDefault); setOrder(defaultOrder); setHidden(new Set()); setHome(""); };
  const byHref = new Map(items.map((i) => [i.href, i]));
  const shownCount = order.length - hidden.size;

  // Bo'limli ko'rinishda band faqat o'z bo'limi ichida suriladi (menyuda ham bo'lim ichida tartiblanadi)
  const move = (href: string, dir: -1 | 1) => setOrder((o) => {
    const at = o.indexOf(href);
    let k = at + dir;
    while (!flat && k >= 0 && k < o.length && byHref.get(o[k])?.group !== byHref.get(href)?.group) k += dir;
    if (k < 0 || k >= o.length) return o;
    const n = [...o];
    [n[at], n[k]] = [n[k], n[at]];
    return n;
  });
  const toggle = (href: string) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(href)) n.delete(href); else n.add(href);
    return n;
  });

  const row = (href: string, idx: number, list: string[]) => {
    const it = byHref.get(href)!;
    const off = hidden.has(href);
    return (
      <li key={href} className={cn("flex items-center gap-2 px-3 py-1.5", off && "bg-slate-50")}>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm pointer-coarse:min-h-11">
          <input type="checkbox" checked={!off} onChange={() => toggle(href)} className="h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-900 pointer-coarse:h-5 pointer-coarse:w-5" />
          <span className={cn("truncate", off ? "text-slate-400 line-through" : "text-slate-900")}>{it.label}</span>
          {flat && it.group !== "Asosiy" && <span className="hidden shrink-0 sm:inline"><Badge dot={false}>{it.group}</Badge></span>}
        </label>
        {off ? <EyeOff size={15} className="shrink-0 text-slate-400" aria-label="Yashirilgan" /> : <Eye size={15} className="shrink-0 text-slate-300" aria-hidden />}
        <IconButton type="button" icon={ArrowUp} label="Yuqoriga" disabled={idx === 0} onClick={() => move(href, -1)} className="disabled:opacity-30" />
        <IconButton type="button" icon={ArrowDown} label="Pastga" disabled={idx === list.length - 1} onClick={() => move(href, 1)} className="disabled:opacity-30" />
      </li>
    );
  };

  const groups = NAV_GROUPS.map((g) => ({ g, list: order.filter((h) => byHref.get(h)?.group === g) })).filter((x) => x.list.length);
  const views = [
    { key: false, icon: ListTree, title: "Bo'limlar bilan", text: "Sotuv, Logistika… sarlavhalari; bosilganda bo'lim bandlari ochiladi" },
    { key: true, icon: LayoutList, title: "Bo'limlarsiz", text: "Barcha bandlar bitta ro'yxatda, ikonkasi bilan — bo'lim ochish shart emas" },
  ];

  return (
    <div className="space-y-4">
      {/* onSubmit: `action={…}` bo'lsa React yuborilgach formani tozalaydi va tanlangan kirish sahifasi ko'rinishda sukutga qaytadi */}
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="space-y-4">
        <input type="hidden" name="view" value={flat ? "flat" : "groups"} />
        {order.map((h) => <input key={h} type="hidden" name="order" value={h} />)}
        {[...hidden].map((h) => <input key={h} type="hidden" name="hidden" value={h} />)}

        <div>
          <div className="mb-1.5 text-[13px] font-medium text-slate-700">Menyu ko&apos;rinishi</div>
          <div role="radiogroup" aria-label="Menyu ko'rinishi" className="grid gap-2 sm:grid-cols-2">
            {views.map((v) => (
              <button key={v.title} type="button" role="radio" aria-checked={flat === v.key} onClick={() => setFlat(v.key)}
                className={cn("flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                  flat === v.key ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/25" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50")}>
                <v.icon size={18} className={cn("mt-0.5 shrink-0", flat === v.key ? "text-brand-600" : "text-slate-400")} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{v.title}</span>
                  <span className="block text-xs text-slate-500">{v.text}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-medium text-slate-700">Menyu bandlari</span>
            <span className="text-xs text-slate-500">
              {shownCount} ta ko&apos;rinadi{hidden.size > 0 && <> · {hidden.size} ta yashirilgan · <button type="button" onClick={() => setHidden(new Set())} className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900">hammasini ko&apos;rsatish</button></>}
            </span>
          </div>
          <p className="mb-2 text-xs text-slate-500">Belgini olib tashlasangiz band menyudan yashirinadi — sahifa va ruxsatlaringiz o&apos;zgarmaydi. Strelkalar bilan tartibni o&apos;zgartiring.</p>
          <div className="max-h-[440px] overflow-y-auto rounded-lg border border-slate-200">
            {flat
              ? <ul className="divide-y divide-slate-100">{order.map((h, i) => row(h, i, order))}</ul>
              : groups.map(({ g, list }) => (
                <div key={g}>
                  <div className="sticky top-0 z-[1] border-b border-slate-100 bg-slate-50/95 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">{g}</div>
                  <ul className="divide-y divide-slate-100">{list.map((h, i) => row(h, i, list))}</ul>
                </div>
              ))}
          </div>
        </div>

        {showHome && (
          <Field label="Kirgandan keyin ochiladigan sahifa" hint="Tizimga kirganingizda shu bo'lim birinchi ochiladi" className="max-w-sm">
            <Select name="home" value={home} onChange={(e) => setHome(e.target.value)}>
              <option value="">Bosh sahifa (sukut)</option>
              {order.filter((h) => h !== "/dashboard").map((h) => <option key={h} value={h}>{byHref.get(h)!.label}</option>)}
            </Select>
          </Field>
        )}

        <FormError error={state?.error} />
        <FormSuccess text={state?.ok ? state.note : undefined} />
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Button disabled={pending || shownCount === 0}><Save size={16} /> Saqlash</Button>
          <Button type="button" variant="ghost" disabled={isDefault} onClick={resetAll}><RotateCcw size={15} /> Sukut holatiga qaytarish</Button>
        </div>
      </form>
    </div>
  );
}
