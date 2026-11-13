"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Plus, X, Save, CheckCircle2, MapPin, FileSignature, UserPlus, Building2, CalendarDays, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import type { DaySheetRow } from "@/lib/order-day-sheet";
import { ORDER_STATUS, OrderStatusBadge } from "./status";
import { Button, Callout, Card, Field as FormField, Input, LinkButton } from "@/components/ui";
import { AddressPicker, type SavedPlace } from "@/components/address-picker";
import { scriptCleaner } from "@/components/script-guard";
import { fmtNum, isoDate, numText, dateRu } from "@/lib/format";
import { ndsOf } from "@/lib/nds";
import { parseInn } from "@/lib/inn";
import { blockName } from "@/lib/site-blocks";
import { cn } from "@/lib/utils";
import { saveOrderGrid } from "./actions";
import { loadOrderRowFlags } from "./row-flags-action";
import type { OrderRowFlags } from "./row-flags";
import { OrderRowActions } from "./order-row-actions";

/** Mijoz obyekti va uning bloklari (A blok, B blok…) */
export type GridSite = SavedPlace & { blocks: string[] };
/** `blacklisted` — kredit limiti yo'q/to'lgan: zayavka faqat to'liq bosh to'lov bilan ochiladi (`lib/orders.ts`) */
export type GridCustomer = { id: string; name: string; aliases: string[]; phone: string | null; sites: GridSite[]; blacklisted: boolean };
export type GridProduct = { id: string; code: string; name: string; unit: string; price: number };
/** «Yangi mijoz» oynasida kiritilgan, hali bazada yo'q mijoz — zayavka bilan birga saqlanadi */
type NewCustomer = { name: string; phone: string; inn: string; address: string; /** xaritadan belgilangan nuqta */ lat: number | null; lng: number | null };

/** Bo'limlar tizim formasidagi to'lov turlari: Perechisleniye (QQS bilan), Naqd, Qarzga (QQS ixtiyoriy) */
type Section = "bank" | "cash" | "credit";
/** Varaq kuniga olingan zayavkalar (`lib/order-day-sheet.ts`) — bo'limlar bo'yicha, faqat ko'rish uchun */
export type GridExisting = Record<Section, DaySheetRow[]>;
const SECTIONS: { sec: Section; title: string }[] = [{ sec: "bank", title: "Perechisleniye" }, { sec: "cash", title: "Naqd" }, { sec: "credit", title: "Qarzga" }];
/**
 * `trips` — reys soni: «0» — dastavka yo'q (mijoz o'zi olib ketadi), 1+ — dastavka bor; bo'sh — dastavka bor, soni noma'lum.
 * `date` — «dd.mm.yyyy», «aniq emas» yoki bo'sh (varaq sanasi). `lat`/`lng` — xaritadan belgilangan nuqta.
 */
type Row = {
  key: string; customer: string; product: string; block: string; qty: string; price: string; trips: string; fee: string;
  receiver: string; phone: string; site: string; date: string; time: string; prepay: string; lat: number | null; lng: number | null; error?: string;
};
type Field = Exclude<keyof Row, "key" | "error" | "lat" | "lng">;
type Calc = "unit" | "sum" | "vat" | "total";
type Col = { f: Field | null; calc?: Calc; label: string; w: string; yellow?: boolean; num?: boolean };

/** Ko'rinish tartibi. Hisoblanadigan ustunlar (`calc`) kiritilmaydi. */
const COLS: Col[] = [
  { f: "customer", label: "Kimga", w: "min-w-[210px]" },
  { f: "product", label: "Mahsulot nomi", w: "min-w-[210px]" },
  { f: "block", label: "Blok", w: "min-w-[90px]" },
  { f: null, calc: "unit", label: "O'lchov birligi", w: "min-w-[56px]" },
  { f: "qty", label: "Soni", w: "min-w-[66px]", num: true },
  { f: "price", label: "Narxi", w: "min-w-[110px]", num: true },
  { f: "trips", label: "Reys", w: "min-w-[88px]" },
  { f: "fee", label: "Dastavka summasi", w: "min-w-[100px]", num: true },
  { f: null, calc: "sum", label: "Summa QQS'siz", w: "min-w-[110px]" },
  { f: null, calc: "vat", label: "QQS 12%", w: "min-w-[96px]" },
  { f: null, calc: "total", label: "Jami", w: "min-w-[110px]" },
  { f: "receiver", label: "Qabul qiluvchi shaxs", w: "min-w-[130px]", yellow: true },
  { f: "phone", label: "Telefon raqami", w: "min-w-[120px]", yellow: true },
  { f: "site", label: "Obyekt joyi", w: "min-w-[140px]", yellow: true },
  { f: "date", label: "Sana", w: "min-w-[112px]", yellow: true },
  { f: "time", label: "Vaqti", w: "min-w-[76px]", yellow: true },
  { f: "prepay", label: "Bosh to'lov", w: "min-w-[140px]", num: true },
];
/**
 * Joylashtirish (paste) tartibi — Excel'dagi «Zayavka realizatsiya» ustunlari (13 ta), keyin bu yerda qo'shilganlari.
 * Ko'rinish tartibidan alohida: Excel'dan butun qator ko'chirilsa ham har qiymat o'z katagiga tushadi.
 */
const PASTE: (Field | null)[] = ["customer", "product", null, "qty", "price", "fee", null, null, null, "receiver", "phone", "site", "time", "prepay", "block", "trips", "date"];
const EDITABLE = COLS.map((c) => c.f).filter((f): f is Field => !!f);
const SUM_AT = COLS.findIndex((c) => c.calc === "sum");
const TAIL = COLS.length - SUM_AT - 4; // Jami bilan Bosh to'lov orasidagi ustunlar
const LETTERS = "ABCDEFGHIJKLMNOPQRSTU";
const START_ROWS = 6;
/** Bir zayavkaga tushadigan (2+ qatorli) guruhlar № katagida rangli chiziq bilan ajraladi */
const GROUP_COLORS = ["border-l-sky-500", "border-l-violet-500", "border-l-amber-500", "border-l-emerald-500", "border-l-rose-500"];
/** Vaqt tanlagich: 06:00 dan 21:00 gacha har yarim soat */
const TIMES = Array.from({ length: 31 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const UNKNOWN = "aniq emas";

/** Tanlangan ko'rinishni eslab qoladi — keyingi «Yangi zayavka» shu ko'rinishda ochiladi (`orders/new`). */
export function RememberView({ cookie, view }: { cookie: string; view: "tizim" | "excel" }) {
  useEffect(() => { document.cookie = `${cookie}=${view}; path=/orders; max-age=31536000; samesite=lax`; }, [cookie, view]);
  return null;
}

let seq = 0;
const blank = (): Row => ({
  key: `r${Date.now().toString(36)}${(seq++).toString(36)}`,
  customer: "", product: "", block: "", qty: "", price: "", trips: "", fee: "", receiver: "", phone: "", site: "", date: "", time: "", prepay: "", lat: null, lng: null,
});
const filled = (r: Row) => EDITABLE.some((f) => r[f].trim() !== "");
const n = (v: string) => { const x = Number(numText(v)); return Number.isFinite(x) ? x : 0; };
/** Son katagi Excel'dagidek guruhlanadi: 1205357,14 → «1 205 357,14»; o'qilmasa — o'zicha qoladi (serverda xato bo'lmasin, ko'rinsin) */
const numCell = (f: Field, v: string) => {
  const t = v.trim(), x = Number(numText(t));
  return t && Number.isFinite(x) ? fmtNum(x, f === "qty" ? 3 : 2) : t;
};
/** Server bilan bir xil nom taqqoslash (`lib/excel.ts` → `flatName`) */
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яёўқғҳ]+/gi, "");
const normAddr = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const noDelivery = (r: Row) => r.trips.trim() === "0";

/** «6:30», «6.30», «0630», «15» → «06:30» / «15:00»; bo'sh — ""; noto'g'ri — null (serverdagi `gridTime` bilan bir xil) */
function normTime(v: string): string | null {
  const t = v.trim();
  if (!t) return "";
  const m = t.match(/^(\d{1,2})(?:[:.,\s-]?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  return h > 23 || min > 59 ? null : `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Sana katagi: bo'sh — varaq sanasi; «aniq emas» / «?»; «10.11», «10.11.26», «10.11.2026», «2026-11-10». Noto'g'ri — null. */
function parseDay(v: string, sheet: string): { iso: string | null; unknown: boolean } | null {
  const t = v.trim();
  if (!t) return { iso: sheet, unknown: false };
  if (/^(aniq\s*emas|\?|-)$/i.test(t)) return { iso: null, unknown: true };
  let y: number, mo: number, d: number;
  const a = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), b = t.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/);
  if (a) { y = +a[1]!; mo = +a[2]!; d = +a[3]!; }
  else if (b) { d = +b[1]!; mo = +b[2]!; y = b[3] ? (b[3].length === 2 ? 2000 + +b[3] : +b[3]) : +sheet.slice(0, 4); }
  else return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? { iso: isoDate(dt), unknown: false } : null;
}
const showDay = (iso: string) => dateRu(new Date(`${iso}T00:00:00`));

/** Mijoz ro'yxatidagi qator: mijoz o'zi yoki uning obyekt bloki («Yakasaroy — A blok») */
type CustOpt = { c: GridCustomer; site?: GridSite; block?: string };

/**
 * Yangi zayavka — «Excel ko'rinish»: kunlik «Zayavka realizatsiya» varag'i. Uch bo'lim — Perechisleniye (QQS 12%
 * narx ustiga), Naqd va Qarzga. Katakdan katakka Enter/strelka bilan o'tiladi, Excel'dan bir nechta katak joylashtiriladi.
 * Saqlanganda bo'lim + mijoz + obyekt + sana + soat bo'yicha qoralama zayavkalar ochiladi (`lib/orders-grid.ts`).
 *
 * Har bo'lim tepasida — varaq kuniga olingan barcha zayavkalar (kulrang, faqat ko'rish; mijoz nomi zayavkaga olib boradi).
 * Varaq sanasi URL'da (`?sana=`): kun almashsa server o'sha kun zayavkalarini beradi, yozilgan yangi qatorlar joyida qoladi.
 */
export function OrderGrid({ day, existing, orderCount, customers, products, scripts, geoSearch }: {
  /** Varaq kuni «YYYY-MM-DD» */ day: string; existing: GridExisting; /** Shu kunga olingan zayavkalar soni */ orderCount: number;
  customers: GridCustomer[]; products: GridProduct[]; /** Ruxsat berilgan yozuvlar (`writeScripts`) */ scripts: string[]; /** Xarita qidiruvi kaliti sozlanganmi (`geoSearchEnabled`) */ geoSearch: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(day);
  // Kun URL orqali almashsa (orqaga tugmasi ham) — varaq sanasi ham shu kunga
  const [shownDay, setShownDay] = useState(day);
  if (day !== shownDay) { setShownDay(day); setDate(day); }
  const [loading, startNav] = useTransition();
  /** Boshqa kun: sana darhol almashadi, o'sha kun zayavkalari serverdan keladi (yozilgan qatorlar saqlanib qoladi) */
  const goDay = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso === date) return;
    setDate(iso);
    const y = Number(iso.slice(0, 4));
    if (y >= 2020 && y <= 2100) startNav(() => router.replace(`/orders/new?view=excel&sana=${iso}`, { scroll: false }));
  };
  const shiftDay = (n: number) => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + n); goDay(isoDate(d)); };
  const [rows, setRows] = useState<Record<Section, Row[]>>(() => ({ bank: Array.from({ length: START_ROWS }, blank), cash: Array.from({ length: START_ROWS }, blank), credit: Array.from({ length: 3 }, blank) }));
  // Qarzga bo'limi: QQS ixtiyoriy (tizim formasidagi «QQS 12%» tugmasi) va bosh to'lov qanday keladi
  const [creditVat, setCreditVat] = useState(false);
  const [creditPay, setCreditPay] = useState<"CASH" | "BANK">("CASH");
  const [siteFor, setSiteFor] = useState<{ sec: Section; key: string } | null>(null); // «Obyekt joyi» xarita oynasi
  // Katak ostidagi tanlagich: mijozlar ro'yxati, sana, vaqt
  const [pop, setPop] = useState<{ kind: "customer" | "date" | "time"; sec: Section; key: string; el: HTMLElement } | null>(null);
  const [hi, setHi] = useState(0); // mijozlar ro'yxatida belgilangan qator (0 — «Yangi mijoz»)
  const [newCust, setNewCust] = useState<Map<string, NewCustomer>>(() => new Map());
  const [custFor, setCustFor] = useState<{ sec: Section; key: string; initial: NewCustomer } | null>(null); // «Yangi mijoz» oynasi
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; orderNo: string; customer: string; credit: boolean }[]>([]);
  const tableRef = useRef<HTMLDivElement>(null);
  const clean = useMemo(() => scriptCleaner(scripts), [scripts]);
  const closePop = useCallback(() => setPop(null), []);
  // Olingan zayavkalar qatorida qalam / «Bekor qilish»: ruxsat va zames/reys holati serverdan (kartadagi shart bilan bir xil)
  const [rowFlags, setRowFlags] = useState<Record<string, OrderRowFlags>>({});
  useEffect(() => {
    const ids = [...new Set([...existing.bank, ...existing.cash, ...existing.credit].map((x) => x.orderId))];
    let alive = true;
    (ids.length ? loadOrderRowFlags(ids) : Promise.resolve({})).then((f) => { if (alive) setRowFlags(f); }).catch(() => { if (alive) setRowFlags({}); });
    return () => { alive = false; };
  }, [existing]);

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
  /** Qatordagi obyekt: yozilgan joy bo'yicha mijoz obyekti; joy bo'sh — mijozning oxirgi obyekti (server ham shuni oladi) */
  const siteOf = (r: Row) => {
    const c = customerOf(r);
    if (!c) return null;
    return r.site.trim() ? c.sites.find((s) => normAddr(s.address) === normAddr(r.site)) ?? null : c.sites[0] ?? null;
  };

  /** QQS: perechisleniyeda doim, qarzga — «QQS 12%» yoqilsa, naqdda yo'q (tizim formasidagi kabi) */
  const vatOn = (sec: Section) => sec === "bank" || (sec === "credit" && creditVat);
  const lineOf = (sec: Section, r: Row) => {
    const q = n(r.qty), p = n(r.price), f = noDelivery(r) ? 0 : n(r.fee);
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

  /** Qatorni o'zgartirish (bir nechta katak birdan). Oxirgi qator to'ldirilsa — pastga yangi bo'sh qator (varaq tugamaydi). */
  const patchRow = (sec: Section, key: string, change: (r: Row) => Partial<Row>) =>
    setRows((all) => {
      const list = all[sec].map((r) => (r.key === key ? { ...r, ...change(r), error: undefined } : r));
      if (filled(list[list.length - 1]!)) list.push(blank());
      return { ...all, [sec]: list };
    });
  /** Katakni o'zgartirish. Mahsulot almashsa narx uning narxi bilan to'ladi (narx bo'sh yoki eski mahsulot narxi bo'lsa). */
  const patch = (sec: Section, key: string, f: Field, v: string) =>
    patchRow(sec, key, (r) => {
      const next: Partial<Row> = { [f]: v };
      if (f === "site") { next.lat = null; next.lng = null; } // qo'lda yozilgan joy — eski nuqta unga tegishli emas
      if (f === "trips" && v.trim() === "0") next.fee = ""; // reys yo'q — dastavka ham yo'q
      if (f === "product") {
        const was = productOf(r), now = productOf({ ...r, product: v });
        if (now && now.id !== was?.id && (!r.price.trim() || (was && n(r.price) === was.price))) next.price = now.price ? fmtNum(now.price, 2) : "";
      }
      return next;
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
    const go = (r: number, c: number) => { e.preventDefault(); setPop(null); focusCell(sec, Math.max(0, Math.min(len - 1, r)), Math.max(0, Math.min(EDITABLE.length - 1, c))); };
    // Katakka strelka/Enter bilan kelganda matn butunlay belgilangan — Excel'dagidek ←→ keyingi katakka o'tadi
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    if (e.key === "Tab") setPop(null); // keyingi katakka o'tildi — tanlagich eski katakda qolmasin
    else if (e.key === "Enter") go(row + (e.shiftKey ? -1 : 1), col);
    else if (e.key === "ArrowDown" && !listed) go(row + 1, col);
    else if (e.key === "ArrowUp" && !listed) go(row - 1, col);
    else if (e.key === "ArrowLeft" && (all || el.selectionEnd === 0) && col > 0) go(row, col - 1);
    else if (e.key === "ArrowRight" && (all || el.selectionStart === el.value.length) && col < EDITABLE.length - 1) go(row, col + 1);
  };

  /** Excel'dan bir nechta katak (tab va qator bilan) — joriy katakdan boshlab `PASTE` tartibida yoyiladi; bitta qiymat — oddiy paste. */
  const onPaste = (sec: Section, row: number, f: Field, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
    e.preventDefault();
    const grid = clean(text).replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const startCol = PASTE.indexOf(f);
    setRows((all) => {
      const list = [...all[sec]];
      grid.forEach((cells, i) => {
        const at = row + i;
        while (list.length <= at) list.push(blank());
        const next = { ...list[at]!, error: undefined };
        cells.forEach((v, j) => {
          const to = PASTE[startCol + j];
          if (!to) return;
          next[to] = COLS.find((c) => c.f === to)?.num ? numCell(to, v) : v.trim();
          if (to === "site") { next.lat = null; next.lng = null; }
        });
        const p = productOf(next);
        if (p && !next.price.trim()) next.price = p.price ? fmtNum(p.price, 2) : "";
        if (noDelivery(next)) next.fee = "";
        list[at] = next;
      });
      if (filled(list[list.length - 1]!)) list.push(blank());
      return { ...all, [sec]: list };
    });
  };

  /** Katakdan chiqqanda: son guruhlanadi (1205357,14 → «1 205 357,14»), vaqt «09:00», sana «10.11.2026», blok «A blok» */
  const onBlurCell = (sec: Section, key: string, f: Field, v: string) => {
    let t = v;
    if (COLS.find((c) => c.f === f)?.num) t = numCell(f, v);
    else if (f === "trips") t = v.trim() && /^\d+$/.test(v.trim()) ? String(Number(v.trim())) : v.trim();
    else if (f === "time") t = normTime(v) ?? v;
    else if (f === "date") { const d = parseDay(v, date); t = !d || !v.trim() ? v.trim() : d.unknown ? UNKNOWN : showDay(d.iso!); }
    else if (f === "block") t = blockName(v) ?? "";
    if (t !== v) patch(sec, key, f, t);
  };

  const addRows = (sec: Section) => setRows((all) => ({ ...all, [sec]: [...all[sec], ...Array.from({ length: 5 }, blank)] }));
  const removeRow = (sec: Section, key: string) => setRows((all) => {
    const list = all[sec].filter((r) => r.key !== key);
    return { ...all, [sec]: list.length ? list : [blank()] };
  });
  /**
   * «Shu mijozga yana mahsulot»: ostiga mijoz, blok, qabul qiluvchi, telefon, obyekt (nuqtasi bilan), sana va vaqt ko'chirilgan
   * qator — bir xil mijoz + obyekt + sana + vaqt bo'lgani uchun saqlanganda shu zayavkaga qo'shiladi. Kursor mahsulot katagiga o'tadi.
   */
  const addAfter = (sec: Section, i: number) => {
    const src = rows[sec][i];
    if (!src) return;
    setRows((all) => {
      const list = [...all[sec]];
      list.splice(i + 1, 0, { ...blank(), customer: src.customer, block: src.block, receiver: src.receiver, phone: src.phone, site: src.site, lat: src.lat, lng: src.lng, date: src.date, time: src.time });
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

  // ── Mijozlar ro'yxati: tepada «Yangi mijoz», keyin mijozlar; obyektida bloklar bo'lsa — har blok alohida qator ──
  const custOptions = (q: string): CustOpt[] => {
    const t = q.trim().toLowerCase(), digits = t.replace(/\D/g, "");
    const hit = (c: GridCustomer) => !t || c.name.toLowerCase().includes(t) || c.aliases.some((a) => a.toLowerCase().includes(t))
      || (digits.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(digits));
    const list = customers.filter(hit).sort((a, b) => Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)) || a.name.localeCompare(b.name));
    const out: CustOpt[] = [];
    for (const c of list) {
      out.push({ c });
      for (const s of c.sites) for (const b of s.blocks) out.push({ c, site: s, block: b });
      if (out.length >= 60) break;
    }
    return out;
  };
  const popRow = pop ? rows[pop.sec].find((r) => r.key === pop.key) ?? null : null;
  const opts = pop?.kind === "customer" && popRow ? custOptions(popRow.customer) : [];

  /** Ro'yxatdan tanlash: mijoz (+ obyekt va blok). Obyekt bo'sh bo'lsa — mijozning oxirgi obyekti. Keyin mahsulot katagiga. */
  const chooseCustomer = (sec: Section, key: string, o: CustOpt | "new") => {
    const at = rows[sec].findIndex((r) => r.key === key), r = rows[sec][at];
    setPop(null);
    if (!r) return;
    if (o === "new") {
      const typed = r.customer.trim();
      setCustFor({ sec, key, initial: { name: typed && !byCustomer.has(flat(typed)) ? typed : "", phone: r.phone, inn: "", address: r.site, lat: r.lat, lng: r.lng } });
      return;
    }
    const site = o.site ?? (r.site.trim() && customerOf(r)?.id === o.c.id ? null : o.c.sites[0] ?? null);
    patchRow(sec, key, () => ({
      customer: o.c.name,
      ...(site ? { site: site.address, lat: site.lat, lng: site.lng } : {}),
      ...(o.block ? { block: o.block } : {}),
    }));
    setTimeout(() => focusCell(sec, at, EDITABLE.indexOf("product")), 0);
  };
  const openCustomers = (sec: Section, key: string, el: HTMLElement) => {
    if (pop?.kind !== "customer" || pop.key !== key) { setPop({ kind: "customer", sec, key, el }); setHi(1); }
  };
  /** Mijoz katagi: ro'yxat ochiq bo'lsa ↑↓ — tanlash, Enter — olish, Escape — yopish; yopiq bo'lsa — oddiy katak */
  const onCustomerKey = (sec: Section, row: number, key: string, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (pop?.kind === "customer" && pop.key === key && !e.nativeEvent.isComposing) {
      const max = opts.length;
      if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, max)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); return; }
      if (e.key === "Enter") { e.preventDefault(); chooseCustomer(sec, key, hi === 0 ? "new" : opts[hi - 1] ?? "new"); return; }
      if (e.key === "Escape") { e.preventDefault(); setPop(null); return; }
      if (e.key === "Tab") setPop(null);
    }
    onKey(sec, row, EDITABLE.indexOf("customer"), e);
  };
  /** «Yangi mijoz» oynasidan: mijoz ma'lumoti eslab qolinadi (zayavka bilan saqlanadi), qatorga nomi va manzili tushadi */
  const addCustomer = (sec: Section, key: string, c: NewCustomer) => {
    setNewCust((m) => new Map(m).set(flat(c.name), c));
    const at = rows[sec].findIndex((r) => r.key === key);
    // Oynadagi manzil (xaritadagi nuqtasi bilan) qatorning «Obyekt joyi»ga tushadi
    patchRow(sec, key, () => ({ customer: c.name, ...(c.address ? { site: c.address, lat: c.lat, lng: c.lng } : {}) }));
    setTimeout(() => focusCell(sec, at, EDITABLE.indexOf("product")), 0);
  };

  /** Qatorning sanasi — serverga va guruhlashga */
  const dayOf = (r: Row) => parseDay(r.date, date);

  const save = () => {
    setError(null);
    const bad = SECTIONS.flatMap(({ sec, title }) => rows[sec].map((r, i) => (filled(r) && (!dayOf(r) || normTime(r.time) == null) ? `${title} ${i + 1}-qator` : null)).filter(Boolean));
    if (bad.length) { setError(`Sana yoki vaqt noto'g'ri: ${bad.slice(0, 5).join(", ")} — masalan 10.11.2026 va 9:00`); return; }
    const payload = SECTIONS.flatMap(({ sec }) => rows[sec].filter(filled).map((r) => {
      const d = dayOf(r)!;
      return {
        key: r.key, section: sec,
        customer: r.customer, customerId: customerOf(r)?.id ?? null,
        product: r.product, productId: productOf(r)?.id ?? null, block: blockName(r.block),
        qty: n(r.qty), price: n(r.price), fee: noDelivery(r) ? 0 : n(r.fee), prepay: n(r.prepay),
        trips: /^\d+$/.test(r.trips.trim()) ? Number(r.trips.trim()) : null,
        receiver: r.receiver, phone: r.phone, site: r.site, time: normTime(r.time) ?? "", lat: r.lat, lng: r.lng,
        date: d.iso, dateUnknown: d.unknown,
      };
    }));
    if (!payload.length) { setError("Jadval bo'sh — kamida bitta qatorni to'ldiring"); return; }
    const used = new Set(payload.map((r) => flat(r.customer)));
    const newCustomers = [...newCust.values()].filter((c) => used.has(flat(c.name)));
    start(async () => {
      const res = await saveOrderGrid({ date, creditVat, creditPay, newCustomers, rows: payload });
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
      if (res.created.length) router.refresh(); // ochilgan zayavkalar varaq tepasidagi olinganlar qatoriga o'tadi
      if (res.failed.length) setError(`${res.failed.length} ta zayavka ochilmadi — qizil qatorlarni tekshiring: ${res.failed.slice(0, 3).map((x) => `${x.customer} — ${x.error}`).join("; ")}${res.failed.length > 3 ? "…" : ""}`);
    });
  };

  /**
   * Zayavka guruhi (serverdagi kabi: bo'lim + mijoz + obyekt + sana + soat) bo'yicha jami va bosh to'lov — katakdagi ogohlantirish
   * va «To'liq» tugmasi uchun. Qora ro'yxatdagi mijozda bosh to'lov guruh jamisiga teng bo'lishi shart.
   */
  const groupKey = (sec: Section, r: Row) => {
    const d = dayOf(r);
    return [sec, customerOf(r)?.id ?? `new:${flat(r.customer)}`, normAddr(r.site), normTime(r.time) ?? r.time, d ? d.iso ?? "?" : `x:${r.date}`].join("|");
  };
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

  // Blok katagi takliflari — jadvaldagi obyektlarning bloklari
  const blockLists = new Map<string, string[]>();
  for (const { sec } of SECTIONS) for (const r of rows[sec]) { const s = siteOf(r); if (s?.blocks.length) blockLists.set(s.id, s.blocks); }

  const cell = "border border-slate-300 p-0";
  const inp = "h-8 w-full min-w-0 bg-transparent px-1.5 text-[13px] text-slate-900 outline-none placeholder:text-slate-300 focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-500 disabled:cursor-not-allowed";
  const ro = "border border-slate-300 bg-slate-50/70 px-1.5 text-right text-[13px] tabular-nums text-slate-700 whitespace-nowrap";
  const badge = "absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-[10px] font-medium";
  const icon = "absolute right-1 top-1/2 -translate-y-1/2";

  // Bo'lim jami = shu kunga olingan zayavkalar + yozilayotgan yangi qatorlar
  const totals = (sec: Section) => rows[sec].reduce((a, r) => { const l = lineOf(sec, r); return { sum: a.sum + l.sum, vat: a.vat + l.vat, total: a.total + l.total, prepay: a.prepay + n(r.prepay) }; },
    existing[sec].reduce((a, x) => ({ sum: a.sum + x.net, vat: a.vat + x.vat, total: a.total + x.total, prepay: a.prepay + x.prepay }), { sum: 0, vat: 0, total: 0, prepay: 0 }));
  /** Olingan zayavkalar: bir nechta mahsulotli zayavka № katagida rangli chiziq bilan (yangi qatorlar guruhidagi kabi) */
  const exGroups = useMemo(() => {
    const m = new Map<string, { no: number; rows: number }>();
    for (const { sec } of SECTIONS) for (const x of existing[sec]) { const g = m.get(x.orderId) ?? { no: m.size + 1, rows: 0 }; g.rows += 1; m.set(x.orderId, g); }
    return m;
  }, [existing]);
  const exText = "border border-slate-300 px-1.5 text-[13px] text-slate-700";
  /** Olingan zayavka katagi — ustun bo'yicha qiymat (faqat ko'rish) */
  const exCell = (x: DaySheetRow, col: Col): React.ReactNode => {
    switch (col.calc ?? col.f) {
      case "customer": return (
        <div className="flex items-center justify-between gap-1.5">
          <Link href={`/orders/${x.orderId}`} className="min-w-0 truncate font-medium text-slate-900 underline-offset-2 hover:text-sky-700 hover:underline">{x.customer}</Link>
          {x.first && <OrderStatusBadge status={x.status} />}
          {x.first && rowFlags[x.orderId] && <OrderRowActions id={x.orderId} edit={rowFlags[x.orderId].edit} cancel={rowFlags[x.orderId].cancel} subject={`Zayavka (${x.customer})`} className="shrink-0" />}
        </div>
      );
      case "product": return x.product;
      case "block": return x.block ?? "";
      case "unit": return x.unit;
      case "qty": return x.qty ? fmtNum(x.qty, 3) : "";
      case "price": return x.price ? fmtNum(x.price, 2) : "";
      case "trips": return x.first && x.trips != null ? (x.trips === 0 ? "0 · yo'q" : String(x.trips)) : "";
      case "fee": return x.delivery ? fmtNum(x.delivery) : "";
      case "sum": return fmtNum(x.net);
      case "vat": return x.vat ? fmtNum(x.vat) : "";
      case "total": return fmtNum(x.total);
      case "receiver": return x.receiver ?? "";
      case "phone": return x.phone ?? "";
      case "site": return x.site;
      case "date": return showDay(day);
      case "time": return x.time ?? "";
      case "prepay": return x.prepay ? fmtNum(x.prepay) : "";
      default: return "";
    }
  };
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
        {/* Shu kunga olingan zayavkalar — kulrang, kataklari tahrirlanmaydi; mijoz nomi yonida qalam (tahrirlash sahifasi) va «Bekor qilish» */}
        {existing[sec].map((x, i) => {
          const g = exGroups.get(x.orderId);
          return (
            <tr key={`ex-${x.orderId}-${i}`} className={cn("h-8 bg-slate-50", (loading || date !== day) && "opacity-40")}
              title={`Olingan zayavka · ${ORDER_STATUS[x.status].label} — tahrirlash: mijoz nomi yonidagi qalam`}>
              <td className={cn("w-14 min-w-14 border border-slate-300 bg-slate-100 text-center text-[11px] text-slate-500", g && g.rows > 1 && `border-l-4 ${GROUP_COLORS[(g.no - 1) % GROUP_COLORS.length]}`)}>{i + 1}</td>
              {COLS.map((col, ci) => {
                const right = col.num || col.calc === "sum" || col.calc === "vat" || col.calc === "total";
                const v = exCell(x, col);
                return (
                  <td key={ci} className={cn(exText, col.w, right && "text-right tabular-nums whitespace-nowrap", col.calc === "unit" && "text-center", col.calc === "total" && "font-semibold", col.f === "trips" && "text-right text-slate-500")}>
                    {typeof v === "string" ? <div className="max-w-[260px] truncate" title={v.length > 24 ? v : undefined}>{v}</div> : v}
                  </td>
                );
              })}
            </tr>
          );
        })}
        {rows[sec].map((r, i) => {
          const c = customerOf(r), p = productOf(r), l = lineOf(sec, r), site = siteOf(r), d = dayOf(r);
          const has = filled(r);
          const grp = has ? groups.get(groupKey(sec, r)) : undefined;
          const no = existing[sec].length + i + 1; // varaqdagi raqam — olingan zayavkalardan keyin davom etadi
          return (
            <tr key={r.key} className={cn("group", r.error && "bg-red-50")} title={r.error}>
              <td title={grp ? `${grp.no}-zayavka${grp.rows > 1 ? ` · ${grp.rows} ta mahsulot` : ""}` : undefined}
                className={cn("relative w-14 min-w-14 border border-slate-300 bg-slate-100 text-center text-[11px] text-slate-500", grp && grp.rows > 1 && `border-l-4 ${GROUP_COLORS[(grp.no - 1) % GROUP_COLORS.length]}`, r.error && "bg-red-200 text-red-800")}>
                {/* Sichqoncha ustida: raqam o'rnida «X» (qatorni o'chirish), chap chetda «+» (shu mijozga yana mahsulot) — katakdan chiqmaydi */}
                <span className="group-hover:invisible">{no}</span>
                {has && <button type="button" tabIndex={-1} onClick={() => addAfter(sec, i)} aria-label="Shu mijozga yana mahsulot" title="Shu mijozga yana mahsulot (ostiga qator)"
                  className="invisible absolute left-0.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-sky-700 hover:bg-sky-100 group-hover:visible"><Plus size={12} /></button>}
                <button type="button" tabIndex={-1} onClick={() => removeRow(sec, r.key)} aria-label="Qatorni o'chirish" title="Qatorni o'chirish"
                  className="invisible absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600 group-hover:visible"><X size={13} /></button>
              </td>
              {COLS.map((col, ci) => {
                if (!col.f) {
                  const v = col.calc === "unit" ? p?.unit ?? "" : col.calc === "sum" ? l.sum : col.calc === "vat" ? (vatOn(sec) ? l.vat : null) : l.total;
                  return <td key={ci} className={cn(ro, col.calc === "unit" && "text-center", col.calc === "total" && "font-semibold")}>{typeof v === "number" ? (has ? fmtNum(v) : "") : v}</td>;
                }
                const f = col.f, ei = EDITABLE.indexOf(f);
                const list = f === "product" ? "og-products" : f === "block" && site?.blocks.length ? `og-blocks-${site.id}` : undefined;
                const unknownProduct = f === "product" && r.product.trim() && !p;
                const newCustomer = f === "customer" && r.customer.trim() && !c;
                const prepared = newCustomer ? newCust.get(flat(r.customer)) : undefined;
                const noCredit = f === "customer" && !!c?.blacklisted;
                const g = f === "prepay" ? grp : undefined;
                const prepayBad = !!g && (g.prepay > g.total + 0.005 || (!!c?.blacklisted && g.prepay < g.total - 0.005));
                const badDate = f === "date" && !d, badTime = f === "time" && normTime(r.time) == null;
                const off = f === "fee" && noDelivery(r);
                return (
                  <td key={ci} className={cn(cell, "relative", col.w, (prepayBad || badDate || badTime) && "bg-red-50", off && "bg-slate-50")}
                    title={prepayBad ? (g!.prepay > g!.total + 0.005 ? "Bosh to'lov zayavka summasidan katta" : "Kredit limiti yo'q — bosh to'lov zayavka summasiga teng bo'lsin («To'liq»)")
                      : badDate ? "Sana noto'g'ri — masalan 10.11.2026 yoki «aniq emas»" : badTime ? "Vaqt noto'g'ri — masalan 9:00" : undefined}>
                    <input
                      value={r[f]} list={list} autoComplete="off" aria-label={`${title}, ${no}-qator: ${col.label}`}
                      data-sec={sec} data-row={i} data-col={ei} disabled={off}
                      inputMode={col.num || f === "trips" ? "decimal" : f === "phone" ? "tel" : undefined}
                      placeholder={f === "time" && i === 0 ? "9:00" : f === "date" ? showDay(date) : f === "trips" ? "—" : off ? "yo'q" : undefined}
                      onChange={(e) => { patch(sec, r.key, f, e.target.value); if (f === "customer") { openCustomers(sec, r.key, e.currentTarget.closest("td")!); setHi(1); } }}
                      onBlur={(e) => onBlurCell(sec, r.key, f, e.target.value)}
                      onKeyDown={(e) => (f === "customer" ? onCustomerKey(sec, i, r.key, e) : onKey(sec, i, ei, e))}
                      onPaste={(e) => onPaste(sec, i, f, e)}
                      onClick={f === "site" ? () => setSiteFor({ sec, key: r.key })
                        : f === "customer" ? (e) => openCustomers(sec, r.key, e.currentTarget.closest("td")!)
                        : f === "date" || f === "time" ? (e) => setPop({ kind: f, sec, key: r.key, el: e.currentTarget.closest("td")! }) : undefined}
                      className={cn(inp, (col.num || f === "trips") && "text-right tabular-nums", unknownProduct && "text-red-600",
                        newCustomer && "pr-12", noCredit && "pr-16", f === "prepay" && "pl-12", (f === "site" || f === "date" || f === "time") && "cursor-pointer pr-6",
                        f === "trips" && "pr-11", f === "date" && r.date.trim().toLowerCase() === UNKNOWN && "text-amber-700")}
                      title={unknownProduct ? "Bunday mahsulot ro'yxatda yo'q" : noCredit ? "Kredit limiti yo'q — zayavka faqat to'liq bosh to'lov bilan ochiladi" : undefined}
                    />
                    {newCustomer && (
                      <button type="button" tabIndex={-1} onClick={() => setCustFor({ sec, key: r.key, initial: prepared ?? { name: r.customer.trim(), phone: r.phone, inn: "", address: r.site, lat: r.lat, lng: r.lng } })}
                        title={prepared ? `Yangi mijoz: ${[prepared.phone, prepared.inn && `INN ${prepared.inn}`, prepared.address].filter(Boolean).join(" · ") || "ma'lumot kiritilgan"} — tahrirlash` : "Ro'yxatda yo'q — saqlanganda yangi mijoz ochiladi. Ma'lumotini kiritish"}
                        className={cn(badge, prepared ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}>yangi</button>
                    )}
                    {noCredit && <span className={cn(badge, "pointer-events-none bg-red-100 text-red-700")}>limit yo&apos;q</span>}
                    {f === "trips" && r.trips.trim() !== "" && (
                      <span className={cn(badge, "pointer-events-none", noDelivery(r) ? "bg-slate-200 text-slate-600" : "bg-sky-100 text-sky-800")}>{noDelivery(r) ? "yo'q" : "reys"}</span>
                    )}
                    {f === "prepay" && has && (
                      <button type="button" tabIndex={-1} onClick={() => fillPrepay(sec, r)} title="Bosh to'lov = zayavka summasi (shu mijoz, obyekt, sana va vaqt bo'yicha)"
                        className={cn("absolute left-1 top-1/2 -translate-y-1/2 rounded px-1 text-[10px] font-medium", prepayBad ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>To&apos;liq</button>
                    )}
                    {f === "site" && (
                      <button type="button" tabIndex={-1} onClick={() => setSiteFor({ sec, key: r.key })} aria-label="Xaritadan tanlash"
                        title={r.lat != null ? "Xaritada nuqta belgilangan — o'zgartirish" : "Xaritadan tanlash"}
                        className={cn(icon, r.lat != null ? "text-emerald-600" : "text-slate-400 hover:text-slate-700")}><MapPin size={14} /></button>
                    )}
                    {(f === "date" || f === "time") && (
                      <button type="button" tabIndex={-1} aria-label={f === "date" ? "Sanani tanlash" : "Vaqtni tanlash"}
                        onClick={(e) => setPop({ kind: f, sec, key: r.key, el: e.currentTarget.closest("td")! })} className={cn(icon, "text-slate-400 hover:text-slate-700")}>
                        {f === "date" ? <CalendarDays size={14} /> : <Clock size={14} />}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
        <tr>
          <td className="border border-slate-300 bg-slate-100" />
          <td className={cell} colSpan={SUM_AT}>
            <button type="button" onClick={() => addRows(sec)} className="inline-flex items-center gap-1 px-1.5 py-1 text-xs font-medium text-sky-700 hover:underline"><Plus size={13} /> 5 qator qo&apos;shish</button>
          </td>
          <td className={cn(ro, "font-bold text-slate-900")}>{fmtNum(t.sum)}</td>
          <td className={cn(ro, "font-bold text-slate-900")}>{vatOn(sec) || t.vat ? fmtNum(t.vat) : ""}</td>
          <td className={cn(ro, "font-bold text-slate-900")}>{fmtNum(t.total)}</td>
          <td className={cell} colSpan={TAIL} />
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
            <div className="inline-flex items-center gap-1">
              <button type="button" onClick={() => shiftDay(-1)} aria-label="Oldingi kun" title="Oldingi kun"
                className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronLeft size={16} /></button>
              <Input type="date" value={date} onChange={(e) => goDay(e.target.value)} aria-label="Varaq sanasi" className="h-8 w-auto" />
              <button type="button" onClick={() => shiftDay(1)} aria-label="Keyingi kun" title="Keyingi kun"
                className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronRight size={16} /></button>
            </div>
            <span className="font-normal text-slate-500">
              — {showDay(date)} · {loading || date !== day ? "yuklanmoqda…" : orderCount ? <b className="font-semibold text-slate-700">{orderCount} ta zayavka olingan</b> : "bu kunga zayavka yo'q"}
              {" "}· «Sana» bo&apos;sh yangi qatorlar shu sana bilan
            </span>
          </div>
          <p className="text-xs text-slate-500">Enter — pastga, Tab — o&apos;ngga. Excel&apos;dan bir nechta katakni ko&apos;chirib joylashtirsa bo&apos;ladi.</p>
        </div>

        <div ref={tableRef} className="overflow-x-auto">
          <table className="w-full min-w-[2120px] border-collapse">
            <thead>
              <tr>
                <th className="w-14 min-w-14 border border-slate-300 bg-slate-100" />
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
                <td className={cn(ro, "bg-slate-100 text-left font-bold text-slate-900")} colSpan={SUM_AT}>Jami (perechisleniye + naqd + qarzga)</td>
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{fmtNum(all("sum"))}</td>
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{fmtNum(all("vat"))}</td>
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{fmtNum(all("total"))}</td>
                <td className={cn(cell, "bg-slate-100")} colSpan={TAIL} />
                <td className={cn(ro, "bg-slate-100 font-bold text-slate-900")}>{all("prepay") ? fmtNum(all("prepay")) : ""}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <datalist id="og-products">{products.map((p) => <option key={p.id} value={p.name}>{p.unit}</option>)}</datalist>
        {[...blockLists].map(([id, blocks]) => <datalist key={id} id={`og-blocks-${id}`}>{blocks.map((b) => <option key={b} value={b} />)}</datalist>)}

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
          <Button type="button" onClick={save} disabled={pending || !dirty}><Save size={16} /> {pending ? "Saqlanmoqda…" : "Saqlash (qoralama)"}</Button>
          <LinkButton href="/orders" variant="secondary">Zayavkalar</LinkButton>
          <p className="text-xs text-slate-500">
            Har bo&apos;lim tepasidagi kulrang qatorlar — varaq kuniga olingan barcha zayavkalar (kun almashsa o&apos;sha kunniki); o&apos;zgartirish — mijoz nomini bosib, zayavka sahifasida.
            «Kimga» bosilsa ro&apos;yxat: tepada «Yangi mijoz», obyektida bloklari bor mijoz — har blok alohida («Mijoz — A blok»).
            Bir mijozga bir nechta mahsulot — qator raqami ustidagi «+»: bir mijoz + obyekt + sana + vaqt qatorlari bitta zayavka (chapda bir rangli chiziq).
            «Reys»: 0 — dastavka yo&apos;q (mijoz o&apos;zi olib ketadi), 1 va undan ko&apos;p — nechta reys. «Sana» bo&apos;sh — varaq sanasi, «aniq emas» ham tanlanadi.
            Perechisleniyeda QQS 12% narx va dastavka ustiga qo&apos;shiladi, qarzga — belgilansa. Bosh to&apos;lov bo&apos;lsa — naqdda kassirga,
            perechisleniyeda buxgalterga so&apos;rov boradi; «limit yo&apos;q» mijozga zayavka faqat to&apos;liq bosh to&apos;lov bilan ochiladi.
          </p>
        </div>
      </Card>

      {pop && popRow && (
        <Popover anchor={pop.el} onClose={closePop} width={pop.kind === "customer" ? 380 : pop.kind === "time" ? 300 : 260}>
          {pop.kind === "customer" ? (
            <ul role="listbox" aria-label="Mijozlar">
              <li>
                <button type="button" onClick={() => chooseCustomer(pop.sec, pop.key, "new")} onMouseEnter={() => setHi(0)}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium text-sky-700", hi === 0 && "bg-sky-50")}>
                  <UserPlus size={15} /> Yangi mijoz{popRow.customer.trim() && !customerOf(popRow) ? ` — «${popRow.customer.trim()}»` : ""}
                </button>
              </li>
              {opts.length === 0 && <li className="px-2 py-1.5 text-xs text-slate-500">Topilmadi — «Yangi mijoz» orqali qo&apos;shing</li>}
              {opts.map((o, k) => (
                <li key={`${o.c.id}|${o.site?.id ?? ""}|${o.block ?? ""}`}>
                  <button type="button" onClick={() => chooseCustomer(pop.sec, pop.key, o)} onMouseEnter={() => setHi(k + 1)}
                    className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left", hi === k + 1 && "bg-slate-100", o.block && "pl-6")}>
                    {o.block ? <Building2 size={13} className="mt-0.5 shrink-0 text-indigo-500" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-900">{o.c.name}{o.block && <b className="font-semibold text-indigo-700"> — {o.block}</b>}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {o.site ? o.site.address : [o.c.phone, o.c.sites.length ? `${o.c.sites.length} ta obyekt` : null].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {!o.block && o.c.blacklisted && <span className="shrink-0 rounded bg-red-100 px-1 text-[10px] font-medium text-red-700">limit yo&apos;q</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : pop.kind === "date" ? (
            <div className="space-y-2 p-1">
              <Input type="date" aria-label="Sana" value={dayOf(popRow)?.iso ?? ""} min={isoDate(new Date(Date.now() - 86400000))}
                onChange={(e) => { if (e.target.value) { patch(pop.sec, pop.key, "date", showDay(e.target.value)); closePop(); } }} className="h-9" />
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {([["Bugun", 0], ["Ertaga", 1], ["Indinga", 2]] as const).map(([l, add]) => (
                  <button key={l} type="button" onClick={() => { patch(pop.sec, pop.key, "date", showDay(isoDate(new Date(Date.now() + add * 86400000)))); closePop(); }}
                    className="rounded-md border border-slate-200 px-2 py-1.5 font-medium text-slate-700 hover:bg-slate-50">{l}</button>
                ))}
                <button type="button" onClick={() => { patch(pop.sec, pop.key, "date", UNKNOWN); closePop(); }}
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 font-medium text-amber-800 hover:bg-amber-100">Aniq emas</button>
                <button type="button" onClick={() => { patch(pop.sec, pop.key, "date", ""); closePop(); }}
                  className="col-span-2 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-50">Varaq sanasi ({showDay(date)})</button>
              </div>
            </div>
          ) : (
            <div className="p-1">
              <div className="grid grid-cols-5 gap-1 text-xs tabular-nums">
                {TIMES.map((t) => (
                  <button key={t} type="button" onClick={() => { patch(pop.sec, pop.key, "time", t); closePop(); }}
                    className={cn("rounded-md px-1 py-1 hover:bg-slate-100", normTime(popRow.time) === t ? "bg-slate-900 text-white hover:bg-slate-800" : "text-slate-700")}>{t}</button>
                ))}
              </div>
              <button type="button" onClick={() => { patch(pop.sec, pop.key, "time", ""); closePop(); }} className="mt-1.5 w-full rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">Vaqtsiz</button>
            </div>
          )}
        </Popover>
      )}

      {siteFor && (() => {
        const r = rows[siteFor.sec].find((x) => x.key === siteFor.key);
        return r ? <SiteDialog row={r} customer={customerOf(r)} geoSearch={geoSearch} onClose={() => setSiteFor(null)}
          onApply={(site, point) => applySite(siteFor.sec, siteFor.key, site, point)} /> : null;
      })()}

      {custFor && (
        <NewCustomerDialog initial={custFor.initial} geoSearch={geoSearch} exists={(name) => byCustomer.get(flat(name)) ?? null}
          onClose={() => setCustFor(null)} onSave={(c) => addCustomer(custFor.sec, custFor.key, c)} />
      )}
    </div>
  );
}

/** Katak ostidagi kichik oyna (mijozlar ro'yxati, sana, vaqt). Tashqariga bosilsa yoki Escape — yopiladi; aylantirilsa katak ortidan yuradi. */
function Popover({ anchor, onClose, width, children }: { anchor: HTMLElement; onClose: () => void; width: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useCallback(() => {
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    return r.bottom > window.innerHeight - 340 ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 };
  }, [anchor, width]);
  const [pos, setPos] = useState(place);
  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && (!!ref.current?.contains(t) || anchor.contains(t));
    const onDown = (e: MouseEvent) => { if (!inside(e.target)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Katakka fokus berilganda sahifa o'zi aylanadi — yopilmaydi, katak yonida qoladi
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) setPos(place()); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose, place]);
  return createPortal((
    // Bosilganda katakdagi kursor qoladi (sana maydonidan tashqari) — yozishni davom ettirsa bo'ladi
    <div ref={ref} style={{ ...pos, width }} onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}
      className="fixed z-50 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg">
      {children}
    </div>
  ), document.body);
}

/**
 * «Yangi mijoz»: nomi, telefon, INN va manzil. Mijoz darhol bazaga yozilmaydi — zayavka saqlanganda u bilan birga ochiladi
 * (tizim formasidagi «Yangi mijoz» kabi: alohida ruxsat kerak emas, INN takrori va formati serverda ham tekshiriladi).
 */
function NewCustomerDialog({ initial, geoSearch, exists, onClose, onSave }: {
  initial: NewCustomer; geoSearch: boolean; exists: (name: string) => GridCustomer | null; onClose: () => void; onSave: (c: NewCustomer) => void;
}) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const set = (k: "name" | "phone" | "inn") => (e: React.ChangeEvent<HTMLInputElement>) => { setV((x) => ({ ...x, [k]: e.target.value })); setErr(""); };
  // Manzil xaritali tanlagichdan: yozganda qidiradi, xaritaga bosib nuqta qo'yiladi
  const onAddress = useCallback((address: string) => setV((x) => ({ ...x, address })), []);
  const onPoint = useCallback((p: { lat: number; lng: number } | null) => setV((x) => ({ ...x, lat: p?.lat ?? null, lng: p?.lng ?? null })), []);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = v.name.replace(/\s+/g, " ").trim();
    if (!name) return setErr("Mijoz nomini yozing");
    const ex = exists(name);
    if (ex) return setErr(`«${ex.name}» ro'yxatda bor — uni «Kimga» ro'yxatidan tanlang`);
    const inn = parseInn(v.inn);
    if (inn.error !== undefined) return setErr(inn.error);
    onSave({ name, phone: v.phone.trim(), inn: inn.inn ?? "", address: v.address.trim(), lat: v.address.trim() ? v.lat : null, lng: v.address.trim() ? v.lng : null });
    onClose();
  };
  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      {/* Manzil katagida Enter — qidiruv taklifi uchun, oynani saqlab yubormasin */}
      <form role="dialog" aria-label="Yangi mijoz" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}
        onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.name === "ncAddress") e.preventDefault(); }}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-xl space-y-3 overflow-y-auto rounded-(--radius-card) bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-900">Yangi mijoz</div>
            <div className="text-xs text-slate-500">Zayavka saqlanganda mijoz ham ochiladi</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Yopish" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={16} /></button>
        </div>
        <FormField label="Mijoz yoki firma nomi *"><Input value={v.name} onChange={set("name")} autoFocus maxLength={200} placeholder="Masalan: Yakasaroy 8172" /></FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Telefon"><Input value={v.phone} onChange={set("phone")} inputMode="tel" maxLength={40} placeholder="+998 __ ___ __ __" /></FormField>
          <FormField label="INN" hint="9 yoki 14 raqam, bo'lmasa bo'sh"><Input value={v.inn} onChange={set("inn")} inputMode="numeric" maxLength={20} /></FormField>
        </div>
        <AddressPicker className="" label="Manzil (obyekt)" name="ncAddress" latName="ncLat" lngName="ncLng" searchEnabled={geoSearch}
          defaultAddress={initial.address} defaultLat={initial.lat} defaultLng={initial.lng} onAddress={onAddress} onPoint={onPoint} />
        {err && <p role="alert" className="text-xs font-medium text-red-600">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Bekor</Button>
          <Button type="submit"><UserPlus size={15} /> Qo&apos;shish</Button>
        </div>
      </form>
    </div>
  ), document.body);
}

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
