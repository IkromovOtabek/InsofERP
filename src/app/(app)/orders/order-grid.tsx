"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Save, CheckCircle2, MapPin, FileSignature } from "lucide-react";
import { Button, Callout, Card, Input, LinkButton } from "@/components/ui";
import { AddressPicker, type SavedPlace } from "@/components/address-picker";
import { scriptCleaner } from "@/components/script-guard";
import { fmtNum, isoDate, numText, dateRu } from "@/lib/format";
import { ndsOf } from "@/lib/nds";
import { cn } from "@/lib/utils";
import { saveOrderGrid } from "./actions";

/** `blacklisted` — kredit limiti yo'q/to'lgan: zayavka faqat to'liq bosh to'lov bilan ochiladi (`lib/orders.ts`) */
export type GridCustomer = { id: string; name: string; aliases: string[]; sites: SavedPlace[]; blacklisted: boolean };
export type GridProduct = { id: string; code: string; name: string; unit: string; price: number };

/** Bo'limlar tizim formasidagi to'lov turlari: Perechisleniye (QQS bilan), Naqd, Qarzga (QQS ixtiyoriy) */
type Section = "bank" | "cash" | "credit";
const SECTIONS: { sec: Section; title: string }[] = [{ sec: "bank", title: "Perechisleniye" }, { sec: "cash", title: "Naqd" }, { sec: "credit", title: "Qarzga" }];
/** `lat`/`lng` — «Obyekt joyi» oynasida xaritadan belgilangan nuqta (qo'lda yozilsa tozalanadi) */
type Row = { key: string; customer: string; product: string; qty: string; price: string; fee: string; receiver: string; phone: string; site: string; time: string; prepay: string; lat: number | null; lng: number | null; error?: string };
type Field = Exclude<keyof Row, "key" | "error" | "lat" | "lng">;
/** Bir zayavkaga tushadigan (2+ qatorli) guruhlar № katagida rangli chiziq bilan ajraladi */
const GROUP_COLORS = ["border-l-sky-500", "border-l-violet-500", "border-l-amber-500", "border-l-emerald-500", "border-l-rose-500"];

/**
 * Varaq ustunlari Excel'dagi «Zayavka realizatsiya» tartibida: joylashtirish (paste) shu tartib bo'yicha tushadi,
 * hisoblanadigan ustunlar (birlik, summalar) o'tkazib yuboriladi — Excel'dan butun qatorni ko'chirsa ham to'g'ri tushadi.
 * «Bosh to'lov» Excel'da yo'q — oxirida turadi, 13 ustunli varaq avvalgidek joylashadi.
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
  { f: "prepay", label: "Bosh to'lov", w: "min-w-[140px]", num: true },
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
const blank = (): Row => ({ key: `r${Date.now().toString(36)}${(seq++).toString(36)}`, customer: "", product: "", qty: "", price: "", fee: "", receiver: "", phone: "", site: "", time: "", prepay: "", lat: null, lng: null });
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
export function OrderGrid({ customers, products, scripts, geoSearch }: { customers: GridCustomer[]; products: GridProduct[]; /** Ruxsat berilgan yozuvlar (`writeScripts`) */ scripts: string[]; /** Xarita qidiruvi kaliti sozlanganmi (`geoSearchEnabled`) */ geoSearch: boolean }) {
  const [date, setDate] = useState(() => isoDate(new Date(Date.now() + 86400000)));
  const [rows, setRows] = useState<Record<Section, Row[]>>(() => ({ bank: Array.from({ length: START_ROWS }, blank), cash: Array.from({ length: START_ROWS }, blank), credit: Array.from({ length: 3 }, blank) }));
  // Qarzga bo'limi: QQS ixtiyoriy (tizim formasidagi «QQS 12%» tugmasi) va bosh to'lov qanday keladi
  const [creditVat, setCreditVat] = useState(false);
  const [creditPay, setCreditPay] = useState<"CASH" | "BANK">("CASH");
  const [siteFor, setSiteFor] = useState<{ sec: Section; key: string } | null>(null); // «Obyekt joyi» xarita oynasi
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; orderNo: string; customer: string; credit: boolean }[]>([]);
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

  /** QQS: perechisleniyeda doim, qarzga — «QQS 12%» yoqilsa, naqdda yo'q (tizim formasidagi kabi) */
  const vatOn = (sec: Section) => sec === "bank" || (sec === "credit" && creditVat);
  const lineOf = (sec: Section, r: Row) => {
    const q = n(r.qty), p = n(r.price), f = n(r.fee);
    const sum = q * p + f;
    const vat = vatOn(sec) ? q * ndsOf(p) + ndsOf(f) : 0;
    return { sum, vat, total: sum + vat };
  };

  // Saqlanmagan qatorlar bor — sahifadan chiqishda brauzer so'raydi
  const dirty = SECTIONS.some(({ sec }) => rows[sec].some(filled));
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
        if (f === "site") { next.lat = null; next.lng = null; } // qo'lda yozilgan joy — eski nuqta unga tegishli emas
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
          if (col?.f === "site") { next.lat = null; next.lng = null; }
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
  /**
   * «Shu mijozga yana mahsulot»: ostiga mijoz, qabul qiluvchi, telefon, obyekt (nuqtasi bilan) va vaqt ko'chirilgan qator —
   * bir xil mijoz + obyekt + vaqt bo'lgani uchun saqlanganda shu zayavkaga qo'shiladi. Kursor mahsulot katagiga o'tadi.
   */
  const addAfter = (sec: Section, i: number) => {
    const src = rows[sec][i];
    if (!src) return;
    setRows((all) => {
      const list = [...all[sec]];
      list.splice(i + 1, 0, { ...blank(), customer: src.customer, receiver: src.receiver, phone: src.phone, site: src.site, lat: src.lat, lng: src.lng, time: src.time });
      return { ...all, [sec]: list };
    });
    setTimeout(() => focusCell(sec, i + 1, EDITABLE.indexOf("product")), 0);
  };
  /** Xarita oynasidan: manzil va nuqta shu qatorga va shu mijozning eski joyi yozilgan qatorlariga (zayavka bo'linib ketmasin) */
  const applySite = (sec: Section, key: string, site: string, point: { lat: number; lng: number } | null) =>
    setRows((all) => {
      const me = all[sec].find((r) => r.key === key);
      if (!me) return all;
      const old = me.site.trim(), who = flat(me.customer);
      const list = all[sec].map((r) => (r.key === key || (old && who && flat(r.customer) === who && r.site.trim() === old)
        ? { ...r, site, lat: point?.lat ?? null, lng: point?.lng ?? null, error: undefined } : r));
      if (filled(list[list.length - 1]!)) list.push(blank());
      return { ...all, [sec]: list };
    });

  const save = () => {
    setError(null);
    const payload = SECTIONS.flatMap(({ sec }) => rows[sec].filter(filled).map((r) => ({
      key: r.key, section: sec,
      customer: r.customer, customerId: customerOf(r)?.id ?? null,
      product: r.product, productId: productOf(r)?.id ?? null,
      qty: n(r.qty), price: n(r.price), fee: n(r.fee), prepay: n(r.prepay),
      receiver: r.receiver, phone: r.phone, site: r.site, time: r.time, lat: r.lat, lng: r.lng,
    })));
    if (!payload.length) { setError("Jadval bo'sh — kamida bitta qatorni to'ldiring"); return; }
    start(async () => {
      const res = await saveOrderGrid({ date, creditVat, creditPay, rows: payload });
      if ("error" in res) { setError(res.error); return; }
      const done = new Set(res.created.flatMap((c) => c.keys));
      const errs = new Map(res.failed.flatMap((x) => x.keys.map((k) => [k, x.error] as const)));
      setRows((all) => {
        const keep = (list: Row[]) => {
          const l = list.filter((r) => !done.has(r.key)).map((r) => (errs.has(r.key) ? { ...r, error: errs.get(r.key) } : r));
          return l.length && !filled(l[l.length - 1]!) ? l : [...l, blank()];
        };
        return { bank: keep(all.bank), cash: keep(all.cash), credit: keep(all.credit) };
      });
      setSaved((s) => [...res.created.map(({ id, orderNo, customer, credit }) => ({ id, orderNo, customer, credit })), ...s]);
      if (res.failed.length) setError(`${res.failed.length} ta zayavka ochilmadi — qizil qatorlarni tekshiring: ${res.failed.slice(0, 3).map((x) => `${x.customer} — ${x.error}`).join("; ")}${res.failed.length > 3 ? "…" : ""}`);
    });
  };


  /**
   * Zayavka guruhi (serverdagi kabi: bo'lim + mijoz + obyekt + soat) bo'yicha jami va bosh to'lov — katakdagi ogohlantirish
   * va «To'liq» tugmasi uchun. Qora ro'yxatdagi mijozda bosh to'lov guruh jamisiga teng bo'lishi shart.
   */
  const groupKey = (sec: Section, r: Row) => [sec, customerOf(r)?.id ?? `new:${flat(r.customer)}`, r.site.trim().replace(/\s+/g, " ").toLowerCase(), r.time.trim()].join("|");
  const groups = new Map<string, { total: number; prepay: number; rows: number; no: number }>();
  for (const { sec } of SECTIONS) for (const r of rows[sec]) {
    if (!filled(r)) continue;
    const k = groupKey(sec, r), g = groups.get(k) ?? { total: 0, prepay: 0, rows: 0, no: groups.size + 1 };
    g.total += lineOf(sec, r).total; g.prepay += n(r.prepay); g.rows += 1;
    groups.set(k, g);
  }
  /** «To'liq»: shu qatorga guruhning qolgan summasi — guruh bosh to'lovi jamiga teng bo'ladi */
  const fillPrepay = (sec: Section, r: Row) => {
    const g = groups.get(groupKey(sec, r));
    if (g) patch(sec, r.key, "prepay", fmtNum(Math.max(0, g.total - (g.prepay - n(r.prepay))), 2));
  };

  const cell = "border border-slate-300 p-0";
  const inp = "h-8 w-full min-w-0 bg-transparent px-1.5 text-[13px] text-slate-900 outline-none placeholder:text-slate-300 focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-500";
  const ro = "border border-slate-300 bg-slate-50/70 px-1.5 text-right text-[13px] tabular-nums text-slate-700 whitespace-nowrap";

  const totals = (sec: Section) => rows[sec].reduce((a, r) => { const l = lineOf(sec, r); return { sum: a.sum + l.sum, vat: a.vat + l.vat, total: a.total + l.total, prepay: a.prepay + n(r.prepay) }; }, { sum: 0, vat: 0, total: 0, prepay: 0 });
  const grand = { bank: totals("bank"), cash: totals("cash"), credit: totals("credit") };
  const all = (k: "sum" | "vat" | "total" | "prepay") => SECTIONS.reduce((a, { sec }) => a + grand[sec][k], 0);

  const section = (sec: Section, title: string) => {
    const t = grand[sec];
    return (
      <Fragment key={sec}>
        <tr>
          <td className="border border-slate-300 bg-slate-100" />
          <td className={cell} />
          <td className={cn("border border-slate-300 py-1 text-center text-sm font-bold text-slate-900", sec === "credit" ? "bg-amber-100" : "bg-emerald-200/70")} colSpan={3}>{title}</td>
          <td className={cn(cell, "px-2")} colSpan={COLS.length - 4}>
            {sec === "credit" && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1 text-xs text-slate-600">
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" checked={creditVat} onChange={(e) => setCreditVat(e.target.checked)} className="h-3.5 w-3.5 accent-slate-900" /> QQS 12% qo&apos;shilsin
                </label>
                <span className="inline-flex items-center gap-1.5">Bosh to&apos;lov qanday keladi:
                  {(["CASH", "BANK"] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={creditPay === m} onClick={() => setCreditPay(m)}
                      className={cn("rounded px-1.5 py-0.5 font-medium", creditPay === m ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>{m === "CASH" ? "Naqd" : "Perechisleniye"}</button>
                  ))}
                </span>
                <span className="inline-flex items-center gap-1 text-amber-700"><FileSignature size={13} /> saqlangach har zayavkaga kafolat xati</span>
              </div>
            )}
          </td>
        </tr>
        {rows[sec].map((r, i) => {
          const c = customerOf(r), p = productOf(r), l = lineOf(sec, r);
          const has = filled(r);
          const grp = has ? groups.get(groupKey(sec, r)) : undefined;
          return (
            <tr key={r.key} className={cn("group", r.error && "bg-red-50")} title={r.error}>
              <td title={grp ? `${grp.no}-zayavka${grp.rows > 1 ? ` · ${grp.rows} ta mahsulot` : ""}` : undefined}
                className={cn("relative w-12 border border-slate-300 bg-slate-100 text-center text-[11px] text-slate-500", grp && grp.rows > 1 && `border-l-4 ${GROUP_COLORS[(grp.no - 1) % GROUP_COLORS.length]}`, r.error && "bg-red-200 text-red-800")}>
                <span className="group-hover:invisible">{i + 1}</span>
                <span className="invisible absolute inset-0 flex items-center justify-center gap-0.5 group-hover:visible">
                  {has && <button type="button" tabIndex={-1} onClick={() => addAfter(sec, i)} aria-label="Shu mijozga yana mahsulot" title="Shu mijozga yana mahsulot (ostiga qator)" className="rounded p-0.5 text-sky-700 hover:bg-sky-100"><Plus size={13} /></button>}
                  <button type="button" tabIndex={-1} onClick={() => removeRow(sec, r.key)} aria-label="Qatorni o'chirish" title="Qatorni o'chirish" className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><X size={13} /></button>
                </span>
              </td>
              {COLS.map((col, ci) => {
                if (!col.f) {
                  const v = ci === 2 ? p?.unit ?? "" : ci === 6 ? l.sum : ci === 7 ? (vatOn(sec) ? l.vat : null) : l.total;
                  return <td key={ci} className={cn(ro, ci === 2 && "text-center", ci === 8 && "font-semibold")}>{typeof v === "number" ? (has ? fmtNum(v) : "") : v}</td>;
                }
                const f = col.f, ei = EDITABLE.indexOf(f);
                const list = f === "customer" ? "og-customers" : f === "product" ? "og-products" : undefined;
                const unknownProduct = f === "product" && r.product.trim() && !p;
                const newCustomer = f === "customer" && r.customer.trim() && !c;
                const noCredit = f === "customer" && !!c?.blacklisted;
                const g = f === "prepay" ? grp : undefined;
                const prepayBad = !!g && (g.prepay > g.total + 0.005 || (!!c?.blacklisted && g.prepay < g.total - 0.005));
                return (
                  <td key={ci} className={cn(cell, "relative", col.w, prepayBad && "bg-red-50")}
                    title={prepayBad ? (g!.prepay > g!.total + 0.005 ? "Bosh to'lov zayavka summasidan katta" : "Kredit limiti yo'q — bosh to'lov zayavka summasiga teng bo'lsin («To'liq»)") : undefined}>
                    <input
                      value={r[f]} list={list} autoComplete="off" aria-label={`${title}, ${i + 1}-qator: ${col.label}`}
                      data-sec={sec} data-row={i} data-col={ei}
                      inputMode={col.num ? "decimal" : f === "phone" ? "tel" : undefined}
                      placeholder={f === "time" && i === 0 ? "9:00" : undefined}
                      onChange={(e) => patch(sec, r.key, f, e.target.value)}
                      onBlur={col.num ? (e) => onBlurNum(sec, r.key, f, e.target.value) : undefined}
                      onKeyDown={(e) => onKey(sec, i, ei, e)}
                      onPaste={(e) => onPaste(sec, i, f, e)}
                      onClick={f === "site" ? () => setSiteFor({ sec, key: r.key }) : undefined}
                      className={cn(inp, col.num && "text-right tabular-nums", unknownProduct && "text-red-600", newCustomer && "pr-11", noCredit && "pr-16", f === "prepay" && "pl-12", f === "site" && "cursor-pointer pr-6")}
                      title={unknownProduct ? "Bunday mahsulot ro'yxatda yo'q" : newCustomer ? "Ro'yxatda yo'q — saqlanganda yangi mijoz ochiladi" : noCredit ? "Kredit limiti yo'q — zayavka faqat to'liq bosh to'lov bilan ochiladi" : undefined}
                    />
                    {newCustomer && <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">yangi</span>}
                    {noCredit && <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded bg-red-100 px-1 text-[10px] font-medium text-red-700">limit yo&apos;q</span>}
                    {f === "site" && (
                      <button type="button" tabIndex={-1} onClick={() => setSiteFor({ sec, key: r.key })} aria-label="Xaritadan tanlash"
                        title={r.lat != null ? "Xaritada nuqta belgilangan — o'zgartirish" : "Xaritadan tanlash"}
                        className={cn("absolute right-1 top-1/2 -translate-y-1/2", r.lat != null ? "text-emerald-600" : "text-slate-400 hover:text-slate-700")}><MapPin size={14} /></button>
                    )}
                    {f === "prepay" && has && (
                      <button type="button" tabIndex={-1} onClick={() => fillPrepay(sec, r)} title="Bosh to'lov = zayavka summasi (shu mijoz, obyekt va vaqt bo'yicha)"
                        className={cn("absolute left-1 top-1/2 -translate-y-1/2 rounded px-1 text-[10px] font-medium", prepayBad ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>To&apos;liq</button>
                    )}
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
          <td className={cn(ro, "font-bold text-slate-900")}>{vatOn(sec) ? fmtNum(t.vat) : ""}</td>
          <td className={cn(ro, "font-bold text-slate-900")}>{fmtNum(t.total)}</td>
          <td className={cell} colSpan={4} />
          <td className={cn(ro, "font-bold text-slate-900")}>{t.prepay ? fmtNum(t.prepay) : ""}</td>
        </tr>
      </Fragment>
    );
  };

  return (
    <div className="space-y-4">
      {saved.length > 0 && (
        <Callout tone="success" title={`${saved.length} ta zayavka qoralama bo'lib ochildi — sotuv qabul qiladi`}>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {saved.map((s) => (
              <Link key={s.id} href={s.credit ? `/orders/${s.id}?guarantee=1` : `/orders/${s.id}`} className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
                <CheckCircle2 size={13} /> {s.orderNo} · {s.customer}{s.credit && <span className="inline-flex items-center gap-0.5 font-normal text-amber-800"><FileSignature size={12} /> kafolat xati</span>}
              </Link>
            ))}
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
          <table className="w-full min-w-[1620px] border-collapse">
            <thead>
              <tr>
                <th className="w-12 border border-slate-300 bg-slate-100" />
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
              {SECTIONS.map(({ sec, title }) => section(sec, title))}
              <tr>
                <td className="border border-slate-300 bg-slate-100" />
                <td className={cn(ro, "bg-slate-100 text-left font-bold text-slate-900")} colSpan={6}>Jami (perechisleniye + naqd + qarzga)</td>
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{fmtNum(all("sum"))}</td>
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{fmtNum(all("vat"))}</td>
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{fmtNum(all("total"))}</td>
                <td className={cn(cell, "bg-slate-100")} colSpan={4} />
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{all("prepay") ? fmtNum(all("prepay")) : ""}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <datalist id="og-customers">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <datalist id="og-products">{products.map((p) => <option key={p.id} value={p.name}>{p.unit}</option>)}</datalist>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
          <Button type="button" onClick={save} disabled={pending || !dirty}><Save size={16} /> {pending ? "Saqlanmoqda…" : "Saqlash (qoralama)"}</Button>
          <LinkButton href="/orders" variant="secondary">Zayavkalar</LinkButton>
          <p className="text-xs text-slate-500">
            Bir mijozga bir nechta mahsulot — qator raqami ustidagi «+» (mijoz, obyekt, vaqt ko&apos;chadi): bir mijoz + obyekt + vaqt qatorlari
            bitta zayavka bo&apos;ladi va chapda bir rangli chiziq bilan ko&apos;rinadi. «Obyekt joyi» bosilsa xarita ochiladi.
            Perechisleniyeda QQS 12% narx va dastavka ustiga qo&apos;shiladi, qarzga — belgilansa.
            Qabul qiluvchi va telefon zayavka izohiga yoziladi; ro&apos;yxatda yo&apos;q mijoz yangi ochiladi.
            Bosh to&apos;lov bo&apos;lsa — naqdda kassirga, perechisleniyeda buxgalterga so&apos;rov boradi; pul tushmaguncha reys ochilmaydi.
            «Limit yo&apos;q» mijozga zayavka faqat to&apos;liq bosh to&apos;lov bilan ochiladi.
          </p>
        </div>
      </Card>

      {siteFor && (() => {
        const r = rows[siteFor.sec].find((x) => x.key === siteFor.key);
        return r ? <SiteDialog row={r} customer={customerOf(r)} geoSearch={geoSearch} onClose={() => setSiteFor(null)}
          onApply={(site, point) => applySite(siteFor.sec, siteFor.key, site, point)} /> : null;
      })()}
    </div>
  );
}

const normAddr = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * «Obyekt joyi» — xarita oynasi: yozganda xaritada qidiradi, mijozning saqlangan obyektlari ro'yxati, xaritaga bosib nuqta.
 * Nuqta zayavkaga ketadi — haydovchida navigatsiya va masofa shundan (`AddressPicker`).
 */
function SiteDialog({ row, customer, geoSearch, onClose, onApply }: {
  row: Row; customer: GridCustomer | null; geoSearch: boolean; onClose: () => void;
  onApply: (site: string, point: { lat: number; lng: number } | null) => void;
}) {
  // Qatorda nuqta bo'lmasa — mijozning shu manzildagi obyekti nuqtasi
  const hit = customer?.sites.find((x) => normAddr(x.address) === normAddr(row.site) && x.lat != null && x.lng != null);
  const start = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : hit ? { lat: hit.lat!, lng: hit.lng! } : null;
  const [address, setAddress] = useState(row.site);
  const [point, setPoint] = useState(start);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const apply = () => { onApply(address.trim(), point); onClose(); };

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label="Obyekt joyi" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-(--radius-card) bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-900">Obyekt joyi</div>
            <div className="text-xs text-slate-500">{customer?.name || row.customer || "Mijoz yozilmagan"}{customer?.sites.length ? ` · ${customer.sites.length} ta saqlangan obyekt` : ""}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Yopish" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={16} /></button>
        </div>
        <AddressPicker className="" label="Manzil" name="gridSite" latName="gridLat" lngName="gridLng" searchEnabled={geoSearch}
          defaultAddress={row.site} defaultLat={start?.lat} defaultLng={start?.lng} saved={customer?.sites ?? []}
          onAddress={setAddress} onPoint={setPoint} />
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Bekor</Button>
          <Button type="button" onClick={apply} disabled={!address.trim()}><MapPin size={15} /> Tanlash</Button>
        </div>
      </div>
    </div>
  ), document.body);
}
