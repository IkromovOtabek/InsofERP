"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Plus, X, Save, CheckCircle2 } from "lucide-react";
import { Button, Callout, Card, Input, LinkButton } from "@/components/ui";
import { scriptCleaner } from "@/components/script-guard";
import { fmtNum, isoDate, numText, dateRu } from "@/lib/format";
import { ndsOf } from "@/lib/nds";
import { cn } from "@/lib/utils";
import { saveOrderGrid } from "./actions";

export type GridCustomer = { id: string; name: string; aliases: string[]; sites: string[] };
export type GridProduct = { id: string; code: string; name: string; unit: string; price: number };

type Section = "bank" | "cash";
type Row = { key: string; customer: string; product: string; qty: string; price: string; fee: string; receiver: string; phone: string; site: string; time: string; error?: string };
type Field = Exclude<keyof Row, "key" | "error">;

/**
 * Varaq ustunlari Excel'dagi «Zayavka realizatsiya» tartibida: joylashtirish (paste) shu tartib bo'yicha tushadi,
 * hisoblanadigan ustunlar (birlik, summalar) o'tkazib yuboriladi — Excel'dan butun qatorni ko'chirsa ham to'g'ri tushadi.
 */
const COLS: { f: Field | null; label: string; w: string; yellow?: boolean; num?: boolean }[] = [
  { f: "customer", label: "Kimga", w: "min-w-[190px]" },
  { f: "product", label: "Mahsulot nomi", w: "min-w-[230px]" },
  { f: null, label: "O'lchov birligi", w: "min-w-[60px]" },
  { f: "qty", label: "Soni", w: "min-w-[70px]", num: true },
  { f: "price", label: "Narxi", w: "min-w-[110px]", num: true },
  { f: "fee", label: "Dastavka summasi", w: "min-w-[100px]", num: true },
  { f: null, label: "Summa QQS'siz", w: "min-w-[110px]" },
  { f: null, label: "QQS 12%", w: "min-w-[96px]" },
  { f: null, label: "Jami", w: "min-w-[110px]" },
  { f: "receiver", label: "Qabul qiluvchi shaxs", w: "min-w-[130px]", yellow: true },
  { f: "phone", label: "Telefon raqami", w: "min-w-[120px]", yellow: true },
  { f: "site", label: "Obyekt joyi", w: "min-w-[140px]", yellow: true },
  { f: "time", label: "Vaqti", w: "min-w-[64px]", yellow: true },
];
const EDITABLE = COLS.map((c) => c.f).filter((f): f is Field => !!f);
const LETTERS = "ABCDEFGHIJKLMN";
const START_ROWS = 6;

/** Tanlangan ko'rinishni eslab qoladi — keyingi «Yangi zayavka» shu ko'rinishda ochiladi (`orders/new`). */
export function RememberView({ cookie, view }: { cookie: string; view: "tizim" | "excel" }) {
  useEffect(() => { document.cookie = `${cookie}=${view}; path=/orders; max-age=31536000; samesite=lax`; }, [cookie, view]);
  return null;
}

let seq = 0;
const blank = (): Row => ({ key: `r${Date.now().toString(36)}${(seq++).toString(36)}`, customer: "", product: "", qty: "", price: "", fee: "", receiver: "", phone: "", site: "", time: "" });
const filled = (r: Row) => EDITABLE.some((f) => r[f].trim() !== "");
const n = (v: string) => { const x = Number(numText(v)); return Number.isFinite(x) ? x : 0; };
/** Son katagi Excel'dagidek guruhlanadi: 1205357,14 → «1 205 357,14»; o'qilmasa — o'zicha qoladi (serverda xato bo'lmasin, ko'rinsin) */
const numCell = (f: Field, v: string) => {
  const t = v.trim(), x = Number(numText(t));
  return t && Number.isFinite(x) ? fmtNum(x, f === "qty" ? 3 : 2) : t;
};
/** Server bilan bir xil nom taqqoslash (`lib/excel.ts` → `flatName`) */
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яёўқғҳ]+/gi, "");

/**
 * Yangi zayavka — «Excel ko'rinish»: kunlik «Zayavka realizatsiya» varag'i. Ikki bo'lim — Perechisleniye (QQS 12%
 * narx ustiga) va Naqd. Katakdan katakka Enter/strelka bilan o'tiladi, Excel'dan bir nechta katak joylashtiriladi.
 * Saqlanganda bo'lim + mijoz + obyekt + soat bo'yicha qoralama zayavkalar ochiladi (`lib/orders-grid.ts`).
 */
export function OrderGrid({ customers, products, scripts }: { customers: GridCustomer[]; products: GridProduct[]; /** Ruxsat berilgan yozuvlar (`writeScripts`) */ scripts: string[] }) {
  const [date, setDate] = useState(() => isoDate(new Date(Date.now() + 86400000)));
  const [rows, setRows] = useState<Record<Section, Row[]>>(() => ({ bank: Array.from({ length: START_ROWS }, blank), cash: Array.from({ length: START_ROWS }, blank) }));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; orderNo: string; customer: string }[]>([]);
  const tableRef = useRef<HTMLDivElement>(null);
  const clean = useMemo(() => scriptCleaner(scripts), [scripts]);

  const byCustomer = useMemo(() => {
    const m = new Map<string, GridCustomer>();
    for (const c of customers) { const k = flat(c.name); if (k && !m.has(k)) m.set(k, c); }
    for (const c of customers) for (const a of c.aliases) { const k = flat(a); if (k && !m.has(k)) m.set(k, c); }
    return m;
  }, [customers]);
  const byProduct = useMemo(() => {
    const m = new Map<string, GridProduct>();
    for (const p of products) { m.set(flat(p.code), p); m.set(flat(p.name), p); }
    return m;
  }, [products]);
  const customerOf = (r: Row) => (r.customer.trim() ? byCustomer.get(flat(r.customer)) ?? null : null);
  const productOf = (r: Row) => (r.product.trim() ? byProduct.get(flat(r.product)) ?? null : null);

  const lineOf = (sec: Section, r: Row) => {
    const q = n(r.qty), p = n(r.price), f = n(r.fee);
    const sum = q * p + f;
    const vat = sec === "bank" ? q * ndsOf(p) + ndsOf(f) : 0;
    return { sum, vat, total: sum + vat };
  };

  // Saqlanmagan qatorlar bor — sahifadan chiqishda brauzer so'raydi
  const dirty = rows.bank.some(filled) || rows.cash.some(filled);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  /** Katakni o'zgartirish. Mahsulot almashsa narx uning narxi bilan to'ladi (narx bo'sh yoki eski mahsulot narxi bo'lsa). */
  const patch = (sec: Section, key: string, f: Field, v: string) =>
    setRows((all) => {
      const list = all[sec].map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, [f]: v, error: undefined };
        if (f === "product") {
          const was = productOf(r), now = productOf(next);
          if (now && now.id !== was?.id && (!r.price.trim() || (was && n(r.price) === was.price))) next.price = now.price ? fmtNum(now.price, 2) : "";
        }
        return next;
      });
      // Oxirgi qator to'ldirilsa — pastga yangi bo'sh qator (Excel'dagidek varaq tugamaydi)
      if (filled(list[list.length - 1]!)) list.push(blank());
      return { ...all, [sec]: list };
    });

  const focusCell = (sec: Section, row: number, col: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-sec="${sec}"][data-row="${row}"][data-col="${col}"]`);
    if (el) { el.focus(); el.select(); }
  };

  /** Enter / Shift+Enter — pastga/tepaga; ↑↓ — ro'yxatsiz kataklarda; ←→ — kursor katak chetida bo'lsa. */
  const onKey = (sec: Section, row: number, col: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (e.nativeEvent.isComposing) return;
    const listed = !!el.getAttribute("list"); // datalist ochiq bo'lishi mumkin — strelkalar unga qoladi
    const len = rows[sec].length;
    const go = (r: number, c: number) => { e.preventDefault(); focusCell(sec, Math.max(0, Math.min(len - 1, r)), Math.max(0, Math.min(EDITABLE.length - 1, c))); };
    // Katakka strelka/Enter bilan kelganda matn butunlay belgilangan — Excel'dagidek ←→ keyingi katakka o'tadi
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    if (e.key === "Enter") go(row + (e.shiftKey ? -1 : 1), col);
    else if (e.key === "ArrowDown" && !listed) go(row + 1, col);
    else if (e.key === "ArrowUp" && !listed) go(row - 1, col);
    else if (e.key === "ArrowLeft" && (all || el.selectionEnd === 0) && col > 0) go(row, col - 1);
    else if (e.key === "ArrowRight" && (all || el.selectionStart === el.value.length) && col < EDITABLE.length - 1) go(row, col + 1);
  };

  /** Excel'dan bir nechta katak (tab va qator bilan) — joriy katakdan boshlab yoyiladi; bitta qiymat — oddiy paste. */
  const onPaste = (sec: Section, row: number, f: Field, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
    e.preventDefault();
    const grid = clean(text).replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const startCol = COLS.findIndex((c) => c.f === f);
    setRows((all) => {
      const list = [...all[sec]];
      grid.forEach((cells, i) => {
        const at = row + i;
        while (list.length <= at) list.push(blank());
        const next = { ...list[at]!, error: undefined };
        cells.forEach((v, j) => {
          const col = COLS[startCol + j];
          if (col?.f) next[col.f] = col.num ? numCell(col.f, v) : v.trim();
        });
        const p = productOf(next);
        if (p && !next.price.trim()) next.price = p.price ? fmtNum(p.price, 2) : "";
        list[at] = next;
      });
      if (filled(list[list.length - 1]!)) list.push(blank());
      return { ...all, [sec]: list };
    });
  };

  /** Katakdan chiqqanda son Excel'dagidek guruhlanadi: 1205357,14 → «1 205 357,14» */
  const onBlurNum = (sec: Section, key: string, f: Field, v: string) => {
    const t = numCell(f, v);
    if (t !== v) patch(sec, key, f, t);
  };

  const addRows = (sec: Section) => setRows((all) => ({ ...all, [sec]: [...all[sec], ...Array.from({ length: 5 }, blank)] }));
  const removeRow = (sec: Section, key: string) => setRows((all) => {
    const list = all[sec].filter((r) => r.key !== key);
    return { ...all, [sec]: list.length ? list : [blank()] };
  });

  const save = () => {
    setError(null);
    const payload = (["bank", "cash"] as const).flatMap((sec) => rows[sec].filter(filled).map((r) => ({
      key: r.key, section: sec,
      customer: r.customer, customerId: customerOf(r)?.id ?? null,
      product: r.product, productId: productOf(r)?.id ?? null,
      qty: n(r.qty), price: n(r.price), fee: n(r.fee),
      receiver: r.receiver, phone: r.phone, site: r.site, time: r.time,
    })));
    if (!payload.length) { setError("Jadval bo'sh — kamida bitta qatorni to'ldiring"); return; }
    start(async () => {
      const res = await saveOrderGrid({ date, rows: payload });
      if ("error" in res) { setError(res.error); return; }
      const done = new Set(res.created.flatMap((c) => c.keys));
      const errs = new Map(res.failed.flatMap((x) => x.keys.map((k) => [k, x.error] as const)));
      setRows((all) => {
        const keep = (list: Row[]) => {
          const l = list.filter((r) => !done.has(r.key)).map((r) => (errs.has(r.key) ? { ...r, error: errs.get(r.key) } : r));
          return l.length && !filled(l[l.length - 1]!) ? l : [...l, blank()];
        };
        return { bank: keep(all.bank), cash: keep(all.cash) };
      });
      setSaved((s) => [...res.created.map(({ id, orderNo, customer }) => ({ id, orderNo, customer })), ...s]);
      if (res.failed.length) setError(`${res.failed.length} ta zayavka ochilmadi — qizil qatorlarni tekshiring: ${res.failed.slice(0, 3).map((x) => `${x.customer} — ${x.error}`).join("; ")}${res.failed.length > 3 ? "…" : ""}`);
    });
  };

  // Mijozning obyektlari — «Obyekt joyi» katagida taklif (faqat jadvaldagi mijozlarniki)
  const siteLists = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of [...rows.bank, ...rows.cash]) { const c = byCustomer.get(flat(r.customer)); if (c?.sites.length) m.set(c.id, c.sites); }
    return m;
  }, [rows, byCustomer]);

  const cell = "border border-slate-300 p-0";
  const inp = "h-8 w-full min-w-0 bg-transparent px-1.5 text-[13px] text-slate-900 outline-none placeholder:text-slate-300 focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-500";
  const ro = "border border-slate-300 bg-slate-50/70 px-1.5 text-right text-[13px] tabular-nums text-slate-700 whitespace-nowrap";

  const totals = (sec: Section) => rows[sec].reduce((a, r) => { const l = lineOf(sec, r); return { sum: a.sum + l.sum, vat: a.vat + l.vat, total: a.total + l.total }; }, { sum: 0, vat: 0, total: 0 });
  const grand = { bank: totals("bank"), cash: totals("cash") };

  const section = (sec: Section, title: string) => {
    const t = grand[sec];
    return (
      <Fragment key={sec}>
        <tr>
          <td className="border border-slate-300 bg-slate-100" />
          <td className={cell} />
          <td className="border border-slate-300 bg-emerald-200/70 py-1 text-center text-sm font-bold text-slate-900" colSpan={3}>{title}</td>
          <td className={cell} colSpan={COLS.length - 4} />
        </tr>
        {rows[sec].map((r, i) => {
          const c = customerOf(r), p = productOf(r), l = lineOf(sec, r);
          const has = filled(r);
          return (
            <tr key={r.key} className={cn("group", r.error && "bg-red-50")} title={r.error}>
              <td className={cn("relative w-9 border border-slate-300 bg-slate-100 text-center text-[11px] text-slate-500", r.error && "bg-red-200 text-red-800")}>
                <span className="group-hover:invisible">{i + 1}</span>
                <button type="button" onClick={() => removeRow(sec, r.key)} aria-label="Qatorni o'chirish" className="invisible absolute inset-0 flex items-center justify-center text-slate-400 hover:text-red-600 group-hover:visible"><X size={13} /></button>
              </td>
              {COLS.map((col, ci) => {
                if (!col.f) {
                  const v = ci === 2 ? p?.unit ?? "" : ci === 6 ? l.sum : ci === 7 ? (sec === "bank" ? l.vat : null) : l.total;
                  return <td key={ci} className={cn(ro, ci === 2 && "text-center", ci === 8 && "font-semibold")}>{typeof v === "number" ? (has ? fmtNum(v) : "") : v}</td>;
                }
                const f = col.f, ei = EDITABLE.indexOf(f);
                const list = f === "customer" ? "og-customers" : f === "product" ? "og-products" : f === "site" && c && siteLists.has(c.id) ? `og-sites-${c.id}` : undefined;
                const unknownProduct = f === "product" && r.product.trim() && !p;
                const newCustomer = f === "customer" && r.customer.trim() && !c;
                return (
                  <td key={ci} className={cn(cell, "relative", col.w)}>
                    <input
                      value={r[f]} list={list} autoComplete="off" aria-label={`${title}, ${i + 1}-qator: ${col.label}`}
                      data-sec={sec} data-row={i} data-col={ei}
                      inputMode={col.num ? "decimal" : f === "phone" ? "tel" : undefined}
                      placeholder={f === "time" && i === 0 ? "9:00" : undefined}
                      onChange={(e) => patch(sec, r.key, f, e.target.value)}
                      onBlur={col.num ? (e) => onBlurNum(sec, r.key, f, e.target.value) : undefined}
                      onKeyDown={(e) => onKey(sec, i, ei, e)}
                      onPaste={(e) => onPaste(sec, i, f, e)}
                      className={cn(inp, col.num && "text-right tabular-nums", unknownProduct && "text-red-600", newCustomer && "pr-11")}
                      title={unknownProduct ? "Bunday mahsulot ro'yxatda yo'q" : newCustomer ? "Ro'yxatda yo'q — saqlanganda yangi mijoz ochiladi" : undefined}
                    />
                    {newCustomer && <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">yangi</span>}
                  </td>
                );
              })}
            </tr>
          );
        })}
        <tr>
          <td className="border border-slate-300 bg-slate-100" />
          <td className={cell} colSpan={6}>
            <button type="button" onClick={() => addRows(sec)} className="inline-flex items-center gap-1 px-1.5 py-1 text-xs font-medium text-sky-700 hover:underline"><Plus size={13} /> 5 qator qo&apos;shish</button>
          </td>
          <td className={cn(ro, "font-bold text-slate-900")}>{fmtNum(t.sum)}</td>
          <td className={cn(ro, "font-bold text-slate-900")}>{sec === "bank" ? fmtNum(t.vat) : ""}</td>
          <td className={cn(ro, "font-bold text-slate-900")}>{fmtNum(t.total)}</td>
          <td className={cell} colSpan={4} />
        </tr>
      </Fragment>
    );
  };

  return (
    <div className="space-y-4">
      {saved.length > 0 && (
        <Callout tone="success" title={`${saved.length} ta zayavka qoralama bo'lib ochildi — sotuv qabul qiladi`}>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {saved.map((s) => <Link key={s.id} href={`/orders/${s.id}`} className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"><CheckCircle2 size={13} /> {s.orderNo} · {s.customer}</Link>)}
          </div>
        </Callout>
      )}
      {error && <Callout tone="danger">{error}</Callout>}

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
            Zayavka realizatsiya
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={isoDate(new Date(Date.now() - 86400000))} aria-label="Yetkazish sanasi" className="h-8 w-auto" />
            <span className="font-normal text-slate-500">— {date ? dateRu(new Date(`${date}T00:00:00`)) : ""}</span>
          </div>
          <p className="text-xs text-slate-500">Enter — pastga, Tab — o&apos;ngga. Excel&apos;dan bir nechta katakni ko&apos;chirib joylashtirsa bo&apos;ladi.</p>
        </div>

        <div ref={tableRef} className="overflow-x-auto">
          <table className="w-full min-w-[1480px] border-collapse">
            <thead>
              <tr>
                <th className="w-9 border border-slate-300 bg-slate-100" />
                {COLS.map((c, i) => <th key={i} className="border border-slate-300 bg-slate-100 py-0.5 text-center text-[10px] font-normal text-slate-400">{LETTERS[i]}</th>)}
              </tr>
              <tr>
                <th className="border border-slate-300 bg-slate-100" />
                {COLS.map((c, i) => (
                  <th key={i} className={cn("border border-slate-300 px-1.5 py-1.5 text-center text-xs font-bold leading-tight text-slate-800", c.w, c.yellow ? "bg-amber-100" : "bg-white")}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section("bank", "Perechisleniye")}
              {section("cash", "Naqd")}
              <tr>
                <td className="border border-slate-300 bg-slate-100" />
                <td className={cn(ro, "bg-slate-100 text-left font-bold text-slate-900")} colSpan={6}>Jami (perechisleniye + naqd)</td>
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{fmtNum(grand.bank.sum + grand.cash.sum)}</td>
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{fmtNum(grand.bank.vat)}</td>
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{fmtNum(grand.bank.total + grand.cash.total)}</td>
                <td className={cn(cell, "bg-slate-100")} colSpan={4} />
              </tr>
            </tbody>
          </table>
        </div>

        <datalist id="og-customers">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <datalist id="og-products">{products.map((p) => <option key={p.id} value={p.name}>{p.unit}</option>)}</datalist>
        {[...siteLists].map(([id, sites]) => <datalist key={id} id={`og-sites-${id}`}>{sites.map((s) => <option key={s} value={s} />)}</datalist>)}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
          <Button type="button" onClick={save} disabled={pending || !dirty}><Save size={16} /> {pending ? "Saqlanmoqda…" : "Saqlash (qoralama)"}</Button>
          <LinkButton href="/orders" variant="secondary">Zayavkalar</LinkButton>
          <p className="text-xs text-slate-500">
            Bir mijozning bir obyekt va vaqtdagi qatorlari — bitta zayavka. Perechisleniyeda QQS 12% narx va dastavka ustiga qo&apos;shiladi.
            Qabul qiluvchi va telefon zayavka izohiga yoziladi; ro&apos;yxatda yo&apos;q mijoz yangi ochiladi.
          </p>
        </div>
      </Card>
    </div>
  );
}
