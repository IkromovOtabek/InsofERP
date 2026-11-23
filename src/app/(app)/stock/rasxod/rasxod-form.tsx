"use client";

import { startTransition, useActionState, useMemo, useRef, useState } from "react";
import { AlertTriangle, History, PackageMinus, Plus, Trash2, Truck, UserPlus, X } from "lucide-react";
import { createRasxod } from "./actions";
import { MaterialField, type MaterialGroup } from "@/components/material-picker";
import { TargetSelect } from "./target-select";
import { TargetHoldings } from "@/components/holdings-panel";
import type { Holding } from "@/lib/holdings";
import { Button, Field, FormError, IconButton, Input, Select } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { unitShort } from "@/lib/unit";
import { cn } from "@/lib/utils";
import { targetName, type TargetGroups } from "@/lib/issue-target";
import type { IssueHints } from "@/lib/stock-issue";
import type { MaterialCategory } from "@/generated/prisma";
import { MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";

type Opt = { id: string; name: string };
type Mat = { id: string; name: string; code: string; unit: string; groupId: string | null; category: MaterialCategory; price: number | null; approx: boolean };
/** Avto zapchast — «Kimga»da transportlar, summasi Logistika moliyada chiqim */
const AVTO: MaterialCategory = "AVTO_ZAPCHAST";
const isVehicleKey = (k: string) => k.startsWith("v:");
type Line = { key: string; materialId: string; qty: string };
/** Bitta chiqim (hujjat): o'z «Kimga»si, kategoriyasi va qatorlari. Bir oynada bir nechta bo'lishi mumkin. */
type Block = { key: string; to: string; cat: MaterialCategory | ""; lines: Line[] };
/** Bir oynada ko'pi bilan shuncha chiqim — serverdagi `ISSUE_MAX_DOCS` (lib/stock-issue) bilan bir xil */
const MAX_DOCS = 20;

/**
 * «Tuzatish» / nusxa: eski chiqimdan to'ldirilgan forma (`/stock/rasxod/new?copy=<ref>`). `copyOf` — faqat bekor qilingan
 * hujjatda: server shu hujjat sanasida yozishga ruxsat beradi (31 kunlik chegaradan eski bo'lsa ham).
 */
export type RasxodInitial = { warehouseId: string; to: string; date: string; note: string; lines: { materialId: string; qty: string }[]; copyOf: string | null };

const EPS = 0.0005;
const num = (v: string) => Number(v.replace(/\s+/g, "").replace(",", ".")) || 0;

/**
 * Qatorlar — `Table` emas (u `overflow-x-auto`: MaterialField ochiladigan ro'yxati kesilardi), «Kirim» formasidagidek grid:
 * keng ekranda Excel'ga o'xshash jadval, telefonda har qator alohida blok. № | Nomi | Birlik | Qoldiq | Miqdor | Narx | Summa | ×
 */
const GRID = "xl:grid-cols-[28px_minmax(220px,1fr)_64px_110px_128px_120px_132px_36px]";
const HEAD = "px-2 py-2 text-[12.5px] font-semibold leading-tight text-slate-900";
/** Telefonda maydon nomi (keng ekranda ustun sarlavhasi bor). */
const Lbl = ({ children }: { children: React.ReactNode }) => <span className="mb-1 block text-xs font-medium text-slate-500 xl:hidden">{children}</span>;

/**
 * «Yangi chiqim» formasi. Qatorlar: Nomi · Birlik · Qoldiq (tanlangan sklad) · Miqdor · Narx · Summa.
 * Bir oynada bir nechta chiqim: «Yana chiqim — boshqa oluvchiga» — har biri o'z «Kimga»si va qatorlari bilan (masalan
 * 1-brigadaga 3 xomashyo, haydovchiga 2 ta); Sana, Sklad va Izoh — hammasiga umumiy. Bitta «Yozish» bilan hammasi bitta
 * tranzaksiyada yoziladi (server `issueStockMany`): birortasida qoldiq yetmasa — hech biri yozilmaydi. Bir oluvchi ikki
 * chiqimda tanlanmaydi. «Tuzatish» (bekor qilingan hujjat nusxasi) da faqat bitta chiqim.
 * Miqdor qoldiqdan oshsa (bir xomashyo bir necha qatorda yoki chiqimda bo'lsa — yig'indisi) qator qizaradi va tugma yopiladi;
 * yakuniy tekshiruv serverda, qulf ostida.
 * Yuborish — `onSubmit` + `startTransition(() => action(formData))`: `<form action>` bo'lsa React 19 xato bilan qaytgan
 * action'dan keyin formani reset qiladi va boshqariladigan Sklad / Kimga select'lari ko'rinishda standartga qaytib qoladi.
 * «Kimga» ro'yxati: brigadalar → xodimlar → boshqa oluvchilar → «Qo'lda kiritish…» (yangi oluvchi oynasi, darhol tanlanadi).
 * Tez tanlash (`hints`, `issueHints`): oxirgi 90 kunda ko'p olganlar tugmacha bo'lib turadi (bosilsa — faol chiqimga);
 * oluvchi tanlangach — unga oxirgi berilgan tovarlar: bosilsa qator oxirgi miqdori bilan qo'shiladi (miqdor tahrirlanadi).
 * Sklad — oxirgi chiqimdagi sklad.
 * «Kategoriya» (har chiqimda): nomlar ro'yxati shu kategoriyaga filtrlanadi; «Avto zapchast» da «Kimga» — faqat transportlar
 * ("v:<id>"), zapchast summasi Logistika moliyada chiqim bo'ladi (server, `issueStock`).
 */
export function RasxodForm({ warehouses, targets, hints, materials, groups, categories, defaultCategory, balances, flows, holdings, clientToken, today, minDate, defaultTo, initial }: {
  warehouses: Opt[]; targets: TargetGroups; hints: IssueHints; materials: Mat[]; groups: MaterialGroup[];
  /** Rol ko'radigan kategoriyalar (mexanik — Zavod zapchastsiz); tanlovda «Hammasi» + shular */
  categories: MaterialCategory[]; defaultCategory: MaterialCategory | null;
  balances: Record<string, Record<string, number>>;
  /** Sklad → xomashyo → jami kirim va jami chiqim (nom tanlashda «Kirim · Chiqim · Qoldi») */
  flows: Record<string, Record<string, { received: number; issued: number }>>;
  /** «Kimga» tanlanganda — unda hozir nima bor (brigada qo'lida / xodim jami olgani) */
  holdings: Holding[];
  clientToken: string; today: string; minDate: string; defaultTo: string;
  initial?: RasxodInitial;
}) {
  const [state, action, pending] = useActionState(createRasxod, undefined);
  // «Qayerdan» eslab qolinadi: oxirgi chiqim yozilgan sklad (faol bo'lsa), bo'lmasa birinchisi
  const [whId, setWhId] = useState(warehouses.find((w) => w.id === (initial?.warehouseId ?? hints.warehouseId))?.id ?? warehouses[0]?.id ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [note, setNote] = useState(initial?.note ?? "");
  const seq = useRef(1);
  const newLine = (): Line => ({ key: `l${seq.current++}`, materialId: "", qty: "" });
  const [blocks, setBlocks] = useState<Block[]>(() => [{
    key: "c0",
    to: initial?.to ?? defaultTo,
    cat: defaultCategory && categories.includes(defaultCategory) ? defaultCategory : "",
    lines: initial?.lines.length ? initial.lines.map((l, i) => ({ key: `i${i}`, ...l })) : [{ key: "i0", materialId: "", qty: "" }],
  }]);
  // Faol chiqim — «Tez tanlash» tugmachalari shunga yoziladi (oxirgi bosilgan / qo'shilgan)
  const [activeKey, setActiveKey] = useState("c0");
  const multi = blocks.length > 1;
  const active = blocks.find((b) => b.key === activeKey) ?? blocks[blocks.length - 1];

  const patchBlock = (bk: string, f: (b: Block) => Partial<Block>) => setBlocks((bs) => bs.map((b) => (b.key === bk ? { ...b, ...f(b) } : b)));
  const patchLine = (bk: string, lk: string, p: Partial<Line>) => patchBlock(bk, (b) => ({ lines: b.lines.map((l) => (l.key === lk ? { ...l, ...p } : l)) }));
  const addLine = (bk: string) => patchBlock(bk, (b) => ({ lines: [...b.lines, newLine()] }));
  const removeLine = (bk: string, lk: string) => patchBlock(bk, (b) => ({ lines: b.lines.length > 1 ? b.lines.filter((l) => l.key !== lk) : [newLine()] }));
  // Tez tanlash: oluvchining oxirgi tovari — bo'sh qator bo'lsa shunga, bo'lmasa yangi qatorga (oxirgi miqdor bilan)
  const addPreset = (bk: string, materialId: string, qty: number) => patchBlock(bk, (b) => {
    if (b.lines.some((l) => l.materialId === materialId)) return {}; // allaqachon bor — ikkinchi marta qo'shilmaydi
    const line = { materialId, qty: String(qty) };
    const empty = b.lines.findIndex((l) => !l.materialId && !l.qty.trim());
    if (empty >= 0) return { lines: b.lines.map((l, i) => (i === empty ? { ...l, ...line } : l)) };
    return { lines: [...b.lines, { ...newLine(), ...line }] };
  });
  // Kategoriya almashsa — mos kelmaydigan «Kimga» tozalanadi (transport faqat Avto zapchastda)
  const pickCat = (bk: string, c: MaterialCategory | "") => patchBlock(bk, (b) => ({ cat: c, to: (c === AVTO) !== isVehicleKey(b.to) ? "" : b.to }));
  // Tez tanlash: transport bosilsa — Avto zapchast, boshqasi Avto zapchastda bosilsa — «Hammasi»
  const chooseTarget = (bk: string, key: string) => patchBlock(bk, (b) => ({ to: key, cat: isVehicleKey(key) ? AVTO : b.cat === AVTO ? "" : b.cat }));
  const addBlock = () => {
    const key = `c${seq.current++}`;
    setBlocks((bs) => [...bs, { key, to: "", cat: "", lines: [newLine()] }]);
    setActiveKey(key);
    // Yangi chiqim ko'rinsin (forma uzun bo'lsa pastda qoladi)
    setTimeout(() => document.getElementById(`chiqim-${key}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };
  const removeBlock = (bk: string) => {
    const rest = blocks.filter((b) => b.key !== bk);
    if (!rest.length) return;
    setBlocks(rest);
    if (activeKey === bk) setActiveKey(rest[rest.length - 1].key);
  };

  const bal = useMemo(() => balances[whId] ?? {}, [balances, whId]);
  const meta = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  // Nomlar ro'yxati kategoriya bo'yicha ("" — «Hammasi»): avval skladda qolgani bor (hali chiqim qilinadigan) xomashyolar,
  // keyin qolganlari — ikkalasi ham nom bo'yicha
  const pickerByCat = useMemo(() => {
    const fl = flows[whId] ?? {};
    const sorted = [...materials].sort((a, b) => Number((bal[b.id] ?? 0) > EPS) - Number((bal[a.id] ?? 0) > EPS));
    const item = (m: Mat) => ({
      id: m.id, name: m.name, code: m.code, unit: m.unit, groupId: m.groupId, balance: bal[m.id] ?? 0,
      received: fl[m.id]?.received ?? 0, issued: fl[m.id]?.issued ?? 0,
    });
    const out = new Map<MaterialCategory | "", ReturnType<typeof item>[]>([["", sorted.filter((m) => categories.includes(m.category)).map(item)]]);
    for (const c of categories) out.set(c, sorted.filter((m) => m.category === c).map(item));
    return out;
  }, [materials, bal, flows, whId, categories]);

  const filledOf = (b: Block) => b.lines.filter((l) => l.materialId && num(l.qty) > 0);
  const sumOf = (ls: Line[]) => ls.reduce((s, l) => s + num(l.qty) * (meta.get(l.materialId)?.price ?? 0), 0);
  // Bir xomashyo bir necha qatorda yoki bir necha chiqimda — yig'indisi qoldiq bilan solishtiriladi;
  // `after` — shu qatordan keyin skladda qoladi (oldingi qatorlar va chiqimlar bilan birga)
  const wanted = new Map<string, number>();
  const after = new Map<string, number>();
  for (const b of blocks) {
    for (const l of b.lines) {
      if (!l.materialId) continue;
      const w = (wanted.get(l.materialId) ?? 0) + num(l.qty);
      wanted.set(l.materialId, w);
      after.set(l.key, (bal[l.materialId] ?? 0) - w);
    }
  }
  const overIds = new Set([...wanted.entries()].filter(([id, q]) => q > (bal[id] ?? 0) + EPS).map(([id]) => id));
  const allFilled = blocks.flatMap(filledOf);
  const total = sumOf(allFilled);
  const noPrice = [...new Set(allFilled.filter((l) => meta.get(l.materialId)?.price == null).map((l) => meta.get(l.materialId)!.name))];
  const incomplete = blocks.some((b) => b.lines.some((l) => l.materialId && !(num(l.qty) > 0)));
  // Bir oluvchi ikki chiqimda — bittasiga yozilsin (server ham rad etadi): chiqim kaliti → oldingi chiqim raqami
  const dupOf = new Map<string, number>();
  const firstOf = new Map<string, number>();
  blocks.forEach((b, i) => {
    if (!b.to) return;
    const was = firstOf.get(b.to);
    if (was != null) dupOf.set(b.key, was + 1);
    else firstOf.set(b.to, i);
  });
  const blocked = pending || !whId || overIds.size > 0 || incomplete || dupOf.size > 0 || blocks.some((b) => !b.to || filledOf(b).length === 0);

  const activeIdx = blocks.indexOf(active);
  const quickTargets = hints.targets.map((t) => ({ ...t, name: targetName(targets, t.key) })).filter((t) => t.name && (active.cat !== AVTO || isVehicleKey(t.key)));
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    // Ichki oynadagi forma (xomashyo spravochnigi) — portal orqali shu yerga ko'tariladi: unga tegilmaydi
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    if (blocked) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };

  /** Chiqimning «Kategoriya» va «Kimga» maydonlari: bitta chiqimda — Sana/Sklad qatorida, bir nechtasida — chiqim ichida. */
  const blockFields = (b: Block) => (
    <>
      <Field label="Kategoriya">
        <Select value={b.cat} onChange={(e) => pickCat(b.key, e.target.value as MaterialCategory | "")} aria-label="Kategoriya">
          <option value="">Hammasi</option>
          {categories.map((c) => <option key={c} value={c}>{MATERIAL_CATEGORY_LABEL[c]}</option>)}
        </Select>
      </Field>
      <Field label={b.cat === AVTO ? "Kimga (transport) *" : "Kimga *"}>
        <TargetSelect targets={targets} value={b.to} onChange={(v) => patchBlock(b.key, () => ({ to: v }))} name="to[]"
          invalid={(!b.to && !!state?.error) || dupOf.has(b.key)} vehiclesOnly={b.cat === AVTO} />
      </Field>
    </>
  );

  const renderBlock = (b: Block, bi: number) => {
    const toName = b.to ? targetName(targets, b.to) : null;
    const filled = filledOf(b);
    const sub = sumOf(filled);
    const presets = (b.to ? hints.materials[b.to] ?? [] : []).filter((p) => meta.has(p.materialId));
    const inLines = new Set(b.lines.map((l) => l.materialId));
    const pickerMats = pickerByCat.get(b.cat) ?? [];
    const dup = dupOf.get(b.key);
    const isActive = multi && b.key === active.key;
    return (
      <section key={b.key} id={`chiqim-${b.key}`} aria-label={multi ? `${bi + 1}-chiqim` : undefined}
        onFocusCapture={() => setActiveKey(b.key)} onPointerDownCapture={() => setActiveKey(b.key)}
        className={cn("space-y-4", multi && "scroll-mt-4 rounded-lg border p-3 sm:p-4", multi && (isActive ? "border-slate-400 bg-slate-50/50" : "border-slate-200"))}>
        {multi && (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="shrink-0 rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white tabular">{`${bi + 1}-chiqim`}</span>
                <span className={cn("truncate font-medium", toName ? "text-slate-900" : "text-slate-400")}>{toName ?? "Kimga tanlanmagan"}</span>
              </div>
              <IconButton type="button" icon={X} label={`${bi + 1}-chiqimni olib tashlash`} onClick={() => removeBlock(b.key)} className="hover:bg-red-50 hover:text-red-600" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{blockFields(b)}</div>
          </>
        )}
        {dup != null && (
          <p className="text-sm text-red-600">{`Bu oluvchi ${dup}-chiqimda ham tanlangan — xomashyolarini o'sha chiqimga qo'shing yoki boshqa oluvchini tanlang`}</p>
        )}
        {b.to && !isVehicleKey(b.to) && <TargetHoldings holdings={holdings} targetKey={b.to} />}
        {isVehicleKey(b.to) && (
          <p className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-sm text-blue-900">
            <Truck size={16} className="mt-0.5 shrink-0" />
            <span>
              <b className="font-semibold">{toName}</b> ga berilgan zapchast summasi ({`${fmtNum(sub)} so'm`}) Logistika moliyada «Ehtiyot qism»
              chiqimi bo&apos;lib yoziladi va shu mashina xarajatiga tushadi. Chiqim bekor qilinsa — u ham bekor bo&apos;ladi.
            </span>
          </p>
        )}
        {b.to && presets.length > 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span><b className="font-medium text-slate-700">{toName}</b> ga oxirgi berilgan tovarlar — bosing, qator oxirgi miqdori bilan qo&apos;shiladi</span>
              <button type="button" className="font-medium text-slate-700 underline hover:text-slate-900"
                onClick={() => presets.forEach((p) => addPreset(b.key, p.materialId, p.qty))}>Hammasini qo&apos;shish</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => {
                const m = meta.get(p.materialId)!;
                const done = inLines.has(p.materialId);
                return (
                  <button key={p.materialId} type="button" disabled={done} onClick={() => addPreset(b.key, p.materialId, p.qty)}
                    title={done ? "Qatorlarda bor" : `Oxirgi berilgan: ${fmtNum(p.qty, 3)} ${unitShort(m.unit)} · ${new Date(p.lastAt).toLocaleDateString("ru-RU")}`}
                    className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
                      done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500")}>
                    {!done && <Plus size={12} className="text-slate-400" />}{m.name}
                    <span className="tabular text-slate-500">{`${fmtNum(p.qty, 3)} ${unitShort(m.unit)}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className={cn("hidden overflow-hidden rounded-t-lg border border-b-0 border-slate-300/80 bg-red-50/70 xl:grid xl:items-center xl:gap-2", GRID)}>
            <div className={cn(HEAD, "text-center")}>№</div>
            <div className={HEAD}>Nomi</div>
            <div className={cn(HEAD, "text-center")}>Birlik</div>
            <div className={cn(HEAD, "text-right")}>Qoldiq</div>
            <div className={cn(HEAD, "text-right")}>Miqdor</div>
            <div className={cn(HEAD, "text-right")}>Narx</div>
            <div className={cn(HEAD, "text-right")}>Summa</div>
            <div />
          </div>
          <div className="space-y-2 bg-white xl:space-y-0 xl:rounded-b-lg xl:border xl:border-slate-300/80">
            {b.lines.map((l, i) => {
              const m = l.materialId ? meta.get(l.materialId) : undefined;
              const u = m ? unitShort(m.unit) : "";
              const q = num(l.qty);
              const have = l.materialId ? bal[l.materialId] ?? 0 : null;
              const left = after.get(l.key) ?? 0;
              const over = !!l.materialId && overIds.has(l.materialId);
              const del = (
                <button type="button" onClick={() => removeLine(b.key, l.key)} aria-label={`${i + 1}-qatorni o'chirish`} title="Qatorni o'chirish"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 size={15} />
                </button>
              );
              return (
                <div key={l.key} className={cn("grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-4",
                  "xl:items-center xl:rounded-none xl:border-0 xl:border-b xl:border-slate-200 xl:px-0 xl:py-1.5 xl:last:border-b-0", GRID,
                  over && "border-red-200 bg-red-50/60")}>
                  {/* Telefonda: qator raqami va o'chirish */}
                  <div className="col-span-2 flex items-center justify-between sm:col-span-4 xl:hidden">
                    <span className="text-xs font-semibold text-slate-500">{`${i + 1}-qator`}</span>
                    {del}
                  </div>
                  <div className="hidden text-center text-xs text-slate-400 tabular xl:block">{i + 1}</div>
                  <div className="col-span-2 sm:col-span-4 xl:col-span-1">
                    <Lbl>Nomi</Lbl>
                    <MaterialField materials={pickerMats} groups={groups} value={l.materialId} placeholder="Nomi yoki kodi"
                      onPick={(x) => patchLine(b.key, l.key, { materialId: x.id })} />
                  </div>
                  <div className="hidden text-center text-sm text-slate-600 xl:block">{u || "—"}</div>
                  <div className="text-sm tabular xl:px-2 xl:text-right">
                    <Lbl>Qoldiq{u && <>, {u}</>}</Lbl>
                    <span className={cn(have != null && have <= EPS ? "text-red-600" : "text-slate-600")}>{have == null ? "—" : fmtNum(have, 3)}</span>
                    {/* Shu chiqimdan keyin skladda qancha qoladi (oldingi qatorlar bilan) — yana shuncha chiqim qilinadi */}
                    {have != null && q > 0 && (
                      <span className={cn("block text-xs", left < -EPS ? "text-red-600" : "text-slate-400")} title="Shu chiqimdan keyin skladda qoladi">
                        {`keyin qoladi: ${fmtNum(Math.max(0, left), 3)}`}
                      </span>
                    )}
                  </div>
                  <div>
                    <Lbl>Miqdor{u && <>, {u}</>}</Lbl>
                    <Input value={l.qty} inputMode="decimal" placeholder="0" aria-label={`Miqdor, ${multi ? `${bi + 1}-chiqim, ` : ""}${i + 1}-qator`} autoComplete="off"
                      aria-invalid={over || undefined}
                      className={cn("h-9 text-right tabular", over && "border-red-400 text-red-700")}
                      onChange={(e) => patchLine(b.key, l.key, { qty: e.target.value })} />
                  </div>
                  <div className="text-sm whitespace-nowrap tabular xl:px-2 xl:text-right">
                    <Lbl>Narx{u && <> / {u}</>}</Lbl>
                    {!m ? <span className="text-slate-400">—</span>
                      : m.price == null ? <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={13} /> narx yo'q</span>
                      : <span title={m.approx ? "«Dona narxi» belgilanmagan — o'rtacha tannarx" : "Dona narxi"}>{m.approx && <span className="mr-0.5 text-slate-400">≈</span>}{fmtNum(m.price, 2)}</span>}
                  </div>
                  <div className="text-sm font-medium whitespace-nowrap tabular xl:px-2 xl:text-right">
                    <Lbl>Summa</Lbl>
                    {m && q > 0 && m.price != null ? fmtNum(q * m.price) : "—"}
                  </div>
                  <div className="hidden justify-center xl:flex">{del}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="secondary" onClick={() => addLine(b.key)}><Plus size={16} /> Qator qo'shish</Button>
          <div className="text-sm text-slate-500">
            <span>Qatorlar: <b className="text-slate-900">{filled.length}</b></span> · <span>Jami: <b className="text-slate-900 tabular">{`${fmtNum(sub)} so'm`}</b></span>
          </div>
        </div>
      </section>
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <input type="hidden" name="clientToken" value={clientToken} />
      {initial?.copyOf && <input type="hidden" name="copyOf" value={initial.copyOf} />}
      {/* Qator → chiqim: `grp[]` — `to[]` (har chiqimning «Kimga» tanlovi, tartib bilan) indeksi */}
      {blocks.map((b, bi) => filledOf(b).map((l) => (
        <span key={l.key} hidden>
          <input type="hidden" name="materialId[]" value={l.materialId} />
          <input type="hidden" name="qty[]" value={l.qty.replace(/\s+/g, "").replace(",", ".")} />
          <input type="hidden" name="grp[]" value={bi} />
        </span>
      )))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Sana *">
          <Input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} min={minDate} max={today} required />
        </Field>
        <Field label="Sklad (Kimdan) *">
          <Select name="warehouseId" value={whId} onChange={(e) => setWhId(e.target.value)} required>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        {!multi && blockFields(blocks[0])}
      </div>

      {quickTargets.length > 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <History size={13} /> Tez tanlash — oxirgi 90 kunda ko&apos;p olganlar{multi && <b className="font-semibold text-slate-700">{` · ${activeIdx + 1}-chiqimga`}</b>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickTargets.map((t) => {
              const usedIn = blocks.findIndex((b) => b.key !== active.key && b.to === t.key);
              return (
                <button key={t.key} type="button" onClick={() => chooseTarget(active.key, t.key)} aria-pressed={active.to === t.key} disabled={usedIn >= 0}
                  title={usedIn >= 0 ? `${usedIn + 1}-chiqimda tanlangan` : `${t.count} ta chiqim · oxirgisi ${new Date(t.lastAt).toLocaleDateString("ru-RU")}`}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
                    active.to === t.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500")}>
                  {t.name}<span className={cn("tabular", active.to === t.key ? "text-white/70" : "text-slate-400")}>{`×${t.count}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">{blocks.map(renderBlock)}</div>

      {!initial?.copyOf && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-slate-300 pt-4">
          <Button type="button" variant="secondary" onClick={addBlock} disabled={blocks.length >= MAX_DOCS}
            title="Bir oynada boshqa oluvchiga ham chiqim — hammasi bitta «Yozish» bilan saqlanadi">
            <UserPlus size={16} /> Yana chiqim — boshqa oluvchiga
          </Button>
          {multi && (
            <div className="text-sm text-slate-500">
              <span>Chiqimlar: <b className="text-slate-900">{blocks.length}</b></span> · <span>Qatorlar: <b className="text-slate-900">{allFilled.length}</b></span>
              {" · "}<span>Jami: <b className="text-slate-900 tabular">{`${fmtNum(total)} so'm`}</b></span>
            </div>
          )}
        </div>
      )}

      {overIds.size > 0 && (
        <p className="text-sm text-red-600">
          {`Skladdagi qoldiqdan ko'p: ${[...overIds].map((id) => `${meta.get(id)?.name ?? "?"} (bor ${fmtNum(bal[id] ?? 0, 3)}, kerak ${fmtNum(wanted.get(id) ?? 0, 3)})`).join("; ")}`}
        </p>
      )}
      {noPrice.length > 0 && (
        <p className="flex items-start gap-1.5 text-sm text-amber-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {`Narx yo'q (Dona narxi belgilanmagan va kirim bo'lmagan): ${noPrice.join(", ")} — qator summasiz yoziladi.`}
        </p>
      )}

      <Field label={multi ? "Izoh (hamma chiqimga)" : "Izoh"}>
        <Input name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Masalan: ta'mirga, obyekt uchun, №… zayavka bo'yicha" autoComplete="off" />
      </Field>

      <FormError error={state?.error} />
      <div className="flex justify-end">
        <Button disabled={blocked}><PackageMinus size={16} /> {pending ? "Yozilmoqda…" : multi ? `Chiqimlarni yozish (${blocks.length})` : "Chiqimni yozish"}</Button>
      </div>
    </form>
  );
}
