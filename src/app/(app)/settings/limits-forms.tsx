"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Check, Save, Search } from "lucide-react";
import { saveAttendanceRadius, saveCustomerLimits, saveDailyOrderLimits, saveDefaultCreditLimit } from "./actions";
import { MoneyInput } from "@/components/money-input";
import { Badge, Button, Empty, Field, FormError, FormSuccess, Input, Table, Td, Th, Tr } from "@/components/ui";
import { fmtNum, money } from "@/lib/format";

/* Sozlamalar → Limitlar formalari (faqat direktor). Server action'lar — `./actions.ts`. */

const numStr = (n: number | null) => (n && n > 0 ? String(n) : "");

/** Kunlik ishlab chiqarish quvvati (taqvim rangi) va qattiq kunlik zayavka limiti — bitta forma, bitta audit. */
export function DailyLimitsForm({ capacity, pcs, m3, count }: { capacity: number | null; pcs: number | null; m3: number | null; count: number | null }) {
  const [state, action, pending] = useActionState(saveDailyOrderLimits, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field label="Kunlik quvvat, m³" hint="taqvim, dashbord, sayt — bloklamaydi">
        <Input name="dailyCapacityM3" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={numStr(capacity)} placeholder="200" className="w-40" />
      </Field>
      <Field label="Kunlik quvvat, dona" hint="ustun, blok — taqvimda ko'rinadi">
        <Input name="dailyCapacityPcs" type="number" min={0} step="1" inputMode="numeric" defaultValue={numStr(pcs)} placeholder="belgilanmagan" className="w-40" />
      </Field>
      <Field label="Kunlik hajm chegarasi, m³" hint="oshsa qabul qilinmaydi">
        <Input name="dailyOrderMaxM3" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={numStr(m3)} placeholder="cheklov yo'q" className="w-44" />
      </Field>
      <Field label="Kunlik zayavka soni" hint="oshsa qabul qilinmaydi">
        <Input name="dailyOrderMaxCount" type="number" min={0} step="1" inputMode="numeric" defaultValue={numStr(count)} placeholder="cheklov yo'q" className="w-40" />
      </Field>
      <div className="flex items-center gap-2 pb-5">
        <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
        {state?.note && <FormSuccess text={state.note} />}
      </div>
      <div className="basis-full"><FormError error={state?.error} /></div>
    </form>
  );
}

/** Yangi mijozga standart kredit limiti — faqat keyin ochiladigan mijozlarga. */
export function DefaultCreditLimitForm({ value }: { value: number }) {
  const [state, action, pending] = useActionState(saveDefaultCreditLimit, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Yangi mijozga standart limit, so'm">
        <MoneyInput name="defaultCreditLimit" defaultValue={String(value)} decimals={2} suffix={null} className="w-52 py-2 text-sm" />
      </Field>
      <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
      {state?.note && <FormSuccess text={state.note} />}
      <FormError error={state?.error} />
    </form>
  );
}

/** Ilovadagi "Keldim / Ketdim": xodim zavod nuqtasidan shu masofada bo'lishi shart. */
export function AttendanceRadiusForm({ value }: { value: number }) {
  const [state, action, pending] = useActionState(saveAttendanceRadius, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Davomat radiusi, m" hint="50 – 5000 m">
        <Input name="attendanceRadiusM" type="number" min={50} max={5000} step="10" inputMode="numeric" defaultValue={value} required className="w-36" />
      </Field>
      <div className="flex items-center gap-2 pb-5">
        <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
        {state?.note && <FormSuccess text={state.note} />}
      </div>
      <div className="basis-full"><FormError error={state?.error} /></div>
    </form>
  );
}

export type CustomerLimitRow = {
  id: string; name: string; limit: number; debt: number; open: number; used: number; blacklisted: boolean;
  /** Kredit limiti oshgani uchun bloklangan zayavkalar soni */
  blocked: number;
};

/** "1 250 000" / "1250000.5" → son; bo'sh yoki noto'g'ri — null. */
const toNum = (raw: string) => {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Mijozlar kredit limiti jadvali: qidirish, "faqat qora ro'yxat / o'zgarganlar" filtri, ko'rinayotgan mijozlarga
 * bir xil limit qo'yish va bitta tugma bilan saqlash. Limit maydonlari formadan TASHQARIDA (boshqariladigan holat):
 * server action tugagach forma tozalanganda ular bo'shab qolmasin. Saqlashga faqat o'zgargan qatorlar va jadval
 * ochilgandagi eski limit (`expected`) ketadi — shu orada boshqa joyda o'zgartirilgan limit ustidan yozilmaydi.
 */
export function CustomerLimitsTable({ rows }: { rows: CustomerLimitRow[] }) {
  const [state, action, pending] = useActionState(saveCustomerLimits, undefined);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "black" | "changed">("all");
  const [bulk, setBulk] = useState("");

  // Saqlangach tahrirlar tozalanadi — yangi limitlar serverdan (`rows`) keladi
  useEffect(() => { if (state?.ok) setEdits({}); }, [state]);

  const valueOf = (r: CustomerLimitRow) => (r.id in edits ? toNum(edits[r.id]) : r.limit);
  const changes = rows.flatMap((r) => {
    if (!(r.id in edits)) return [];
    const v = toNum(edits[r.id]);
    return v === null || eq(v, r.limit) ? [] : [{ id: r.id, limit: v, expected: r.limit }];
  });
  const invalid = rows.filter((r) => r.id in edits && toNum(edits[r.id]) === null).length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && !r.name.toLowerCase().includes(needle)) return false;
      if (only === "black") return r.blacklisted;
      if (only === "changed") return r.id in edits;
      return true;
    });
  }, [rows, q, only, edits]);

  const applyBulk = () => {
    const v = toNum(bulk);
    if (v === null || shown.length === 0) return;
    if (!confirm(`Ko'rinayotgan ${shown.length} ta mijozga ${money(v)} limit qo'yilsinmi? Saqlash tugmasini bosmaguningizcha hech narsa yozilmaydi.`)) return;
    setEdits((p) => ({ ...p, ...Object.fromEntries(shown.map((r) => [r.id, String(v)])) }));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="relative">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mijoz nomi" aria-label="Mijozni qidirish" className="w-56 pl-9" />
        </label>
        <div role="radiogroup" aria-label="Filtr" className="flex gap-1">
          {([["all", `Hammasi (${rows.length})`], ["black", `Qora ro'yxat (${rows.filter((r) => r.blacklisted).length})`], ["changed", `O'zgarganlar (${Object.keys(edits).length})`]] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={only === k} onClick={() => setOnly(k)}
              className={`h-10 rounded-lg border px-3 text-xs ${only === k ? "border-slate-900 bg-slate-900 font-semibold text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Field label="Ko'rinayotganlarga bir xil limit">
            <MoneyInput value={bulk} onChange={setBulk} decimals={2} suffix={null} placeholder="masalan 50 000 000" ariaLabel="Ko'rinayotgan mijozlarga bir xil limit" className="w-48 py-2 text-sm" />
          </Field>
          <Button type="button" variant="secondary" onClick={applyBulk} disabled={toNum(bulk) === null || shown.length === 0}>Qo&apos;yish</Button>
        </div>
      </div>

      <Table maxHeight="65vh">
        <thead>
          <tr>
            <Th>Mijoz</Th>
            <Th>Kredit limiti, so&apos;m</Th>
            <Th right>Bo&apos;sh limit</Th>
            <Th right>Ishlatilgan</Th>
            <Th right>Qarz</Th>
            <Th right>Ochiq zayavkalar</Th>
            <Th>Holat</Th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && <Empty text={rows.length ? "Mos mijoz topilmadi" : "Faol mijoz yo'q"} />}
          {shown.map((r) => {
            const v = valueOf(r);
            const changed = r.id in edits && v !== null && !eq(v, r.limit);
            const free = v === null ? null : v - r.used;
            return (
              <Tr key={r.id} className={changed ? "bg-amber-50/60" : undefined}>
                <Td><Link href={`/customers/${r.id}`} className="hover:underline">{r.name}</Link></Td>
                <Td className="min-w-48">
                  <MoneyInput value={r.id in edits ? edits[r.id] : String(r.limit)} onChange={(raw) => setEdits((p) => ({ ...p, [r.id]: raw }))}
                    decimals={2} suffix={null} ariaLabel={`${r.name} — kredit limiti`} className={`h-9 py-1 text-sm ${changed ? "border-amber-400" : ""}`} />
                  {changed && <span className="mt-0.5 block text-[11px] text-amber-700">avval {money(r.limit)}</span>}
                  {r.id in edits && v === null && <span className="mt-0.5 block text-[11px] text-red-600">Summa kiriting</span>}
                </Td>
                <Td right className={free !== null && free <= 0 && (v ?? 0) + r.used > 0 ? "text-red-600" : undefined}>{free === null ? "—" : money(free)}</Td>
                <Td right>{money(r.used)}</Td>
                <Td right>{r.debt > 0 ? money(r.debt) : "—"}</Td>
                <Td right>{r.open > 0 ? money(r.open) : "—"}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {r.blacklisted && <Badge color="red">Qora ro&apos;yxat</Badge>}
                    {r.blocked > 0 && <Link href={`/orders?status=BLOCKED&customer=${r.id}`}><Badge color="amber">{r.blocked} ta bloklangan</Badge></Link>}
                    {!r.blacklisted && r.blocked === 0 && <span className="text-xs text-slate-400">{r.limit > 0 ? "qarzga oladi" : "naqd / avans"}</span>}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <form action={action} className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { if (!confirm(`${changes.length} ta mijozning kredit limiti o'zgartirilsinmi?`)) e.preventDefault(); }}>
        <input type="hidden" name="changes" value={JSON.stringify(changes)} />
        <Button disabled={pending || changes.length === 0 || invalid > 0}>{state?.ok && changes.length === 0 ? <Check size={16} /> : <Save size={16} />} Limitlarni saqlash{changes.length ? ` (${changes.length})` : ""}</Button>
        {Object.keys(edits).length > 0 && <Button type="button" variant="ghost" onClick={() => setEdits({})}>Bekor qilish</Button>}
        {invalid > 0 && <span className="text-xs text-red-600">{invalid} ta qatorda summa noto&apos;g&apos;ri</span>}
        {state?.note && <FormSuccess text={state.note} />}
        <FormError error={state?.error} />
        <span className="text-xs text-slate-500">Jami limit: {money(rows.reduce((s, r) => s + (valueOf(r) ?? r.limit), 0))} · {fmtNum(rows.filter((r) => (valueOf(r) ?? 0) > 0).length)} ta mijoz qarzga oladi</span>
      </form>
    </div>
  );
}
