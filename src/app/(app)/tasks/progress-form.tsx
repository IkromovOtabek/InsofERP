"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Check } from "lucide-react";
import { addProgress, substituteTask } from "./actions";
import { Button, Input, Select } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export type SubProduct = { id: string; name: string; unit: string };
export type SubBrigade = { id: string; name: string };


/**
 * «Bajarildi» qaydi va uning ostida «Qolganini boshqa o'lchamda bajardim» (zayavka qatori asl narxda bo'linadi):
 *  · qaydda almashtirish (sukut) — faqat o'rinbosar mahsulot va miqdor; o'sha brigadada bajarildi, hovliga kirim;
 *  · «Perekit» — topshiriqni bo'lish: qolgani yangi topshiriq bo'lib (tanlangan brigadaga) ochiladi, hali quyilmagan.
 * O'rinbosar ro'yxati — shu birlikdagi faol mahsulotlar, nomi o'xshashlari (masalan «ПК …») birinchi.
 */
export function ProgressForm({ taskId, remaining, unit, product, productId, brigadeId, products, brigades }: {
  taskId: string; remaining: number; unit: string;
  product?: string; productId?: string; brigadeId?: string; products?: SubProduct[]; brigades?: SubBrigade[];
}) {
  const [state, action, pending] = useActionState(addProgress.bind(null, taskId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  const canSub = !!(products && productId && unit !== "m³" && remaining > 0);
  return (
    <div className="flex flex-col gap-1.5">
      <form ref={ref} action={action} className="flex items-center gap-1.5">
        <Input name="qty" aria-label="Bajarilgan miqdor" type="number" step="any" min="0" max={remaining} placeholder={`${unit}`} className="h-8 w-24 text-xs" required />
        <Button disabled={pending} variant="secondary" className="h-8 px-2 text-xs"><Check size={14} /> Bajarildi</Button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
        {/* Tasdiq: qancha mahsulot hovliga kirim bo'ldi, zayavka yopildimi, xomashyo yetdimi */}
        {state?.ok && state.note && <span className="text-xs text-emerald-700">{state.note}</span>}
      </form>
      {canSub && <Substitute taskId={taskId} remaining={remaining} unit={unit} product={product ?? ""} productId={productId!} brigadeId={brigadeId ?? ""} products={products!} brigades={brigades ?? []} />}
    </div>
  );
}

function Substitute({ taskId, remaining, unit, product, productId, brigadeId, products, brigades }: {
  taskId: string; remaining: number; unit: string; product: string; productId: string; brigadeId: string; products: SubProduct[]; brigades: SubBrigade[];
}) {
  const [state, action, pending] = useActionState(substituteTask.bind(null, taskId), undefined);
  const [on, setOn] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(String(remaining));
  // "record" — qaydda almashtirish (1-shablon), "split" — «Perekit»: topshiriqni bo'lish (2-shablon)
  const [mode, setMode] = useState<"record" | "split">("record");
  useEffect(() => { if (state?.ok) { setOn(false); setTo(""); setMode("record"); } }, [state]);
  useEffect(() => { setAmount(String(remaining)); }, [remaining]);

  // Bir xil birlik, asl mahsulotdan boshqa; nomining birinchi so'zi mos kelganlar (ПК, FBS…) yuqorida
  const options = useMemo(() => {
    const head = product.split(/\s+/)[0]?.toLowerCase() ?? "";
    return products
      .filter((p) => p.id !== productId && p.unit === products.find((x) => x.id === productId)?.unit)
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(head)) - Number(a.name.toLowerCase().startsWith(head)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [products, productId, product]);

  const n = Number(amount.replace(",", "."));
  const err = !to ? null
    : !(Number.isInteger(n) && n > 0) ? "Miqdor butun son va 0 dan katta bo'lsin"
    : n > remaining ? `Ko'pi bilan ${fmtNum(remaining, 3)} ${unit} — topshiriqda qolgani`
    : null;

  const toggle = (
    <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium whitespace-nowrap text-slate-700">
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-3.5 w-3.5 accent-amber-600" />
      Qolganini boshqa o&apos;lchamda bajardim
    </label>
  );

  if (!on) return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {toggle}
      {state?.ok && state.note && <span className="text-emerald-700">{state.note}</span>}
    </div>
  );

  const split = mode === "split";
  return (
    <form action={action} className={cn("flex w-[360px] max-w-full flex-col gap-2 rounded-lg border p-2.5 text-xs", split ? "border-sky-300 bg-sky-50/60" : "border-amber-300 bg-amber-50/60")}>
      {toggle}
      {split && <div className="font-semibold text-slate-800">Topshiriqni bo&apos;lish — qolgani yangi topshiriq bo&apos;ladi</div>}
      <div className="flex items-center gap-1.5">
        <Select name="productId" value={to} onChange={(e) => setTo(e.target.value)} aria-label="O'rinbosar mahsulot" className="h-8 min-w-0 flex-1 text-xs" required>
          <option value="">O&apos;rinbosar mahsulot…</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Input name="qty" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" aria-label="Miqdor" aria-invalid={err ? true : undefined} className="h-8 w-16 text-right text-xs tabular" />
        <span className="text-slate-500">{unit}</span>
      </div>
      {split ? (
        brigades.length > 0 && (
          <Select name="brigadeId" defaultValue={brigadeId} aria-label="Brigada" className="h-8 text-xs">
            {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )
      ) : (
        // Qaydda almashtirish: o'sha brigada allaqachon quydi — darhol bajarildi, hovliga kirim
        <><input type="hidden" name="brigadeId" value={brigadeId} /><input type="hidden" name="done" value="on" /></>
      )}
      <input type="hidden" name="reason" value={split ? "Topshiriqni bo'lish" : "Qaydda almashtirish"} />
      {err && <span role="alert" className="font-medium text-red-600">{err}</span>}
      {state?.error && <span role="alert" className="font-medium text-red-600">{state.error}</span>}
      <div className="flex items-center justify-between gap-2">
        {split
          ? <button type="button" onClick={() => setMode("record")} className="font-medium text-slate-600 hover:text-slate-900 hover:underline">← Qaydga qaytish</button>
          : <Button type="button" variant="secondary" onClick={() => setMode("split")} className="h-8 px-2.5 text-xs" title="Topshiriqni bo'lish: qolganini yangi topshiriq qilib brigadaga berish"><ArrowRightLeft size={14} /> Perekit</Button>}
        <Button disabled={pending || !to || !!err} variant={split ? "primary" : "brand"} className="h-8 px-2.5 text-xs">
          {split ? <><ArrowRightLeft size={14} /> {pending ? "O'tkazilmoqda…" : "O'tkazish"}</> : <><Check size={14} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</>}
        </Button>
      </div>
      <span className="text-slate-500">
        {!to ? "Qolgan qism qaysi mahsulotda quyilganini tanlang."
          : split ? `Topshiriq ${fmtNum(remaining - (err ? 0 : n), 3)} ${unit} ga qisqaradi, tanlangan brigadaga yangi topshiriq ochiladi. Zayavkada ${product} o'rniga yangi qator — narx o'zgarmaydi.`
          : `Bajarildi deb yoziladi va hovliga kirim qilinadi. Zayavkada ${product} o'rniga yangi qator — narx o'zgarmaydi.`}
      </span>
    </form>
  );
}
