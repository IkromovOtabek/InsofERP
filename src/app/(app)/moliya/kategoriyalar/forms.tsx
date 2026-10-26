"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, Save, Tag } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import type { CashCategoryNeeds, CashFlowKind, LoanPart, PnlLine } from "@/generated/prisma";
import { FLOW_LABEL, NEEDS_LABEL, PNL_LINE_LABEL } from "@/lib/fin-report/labels";
import { addAliasAction, createCategoryAction, createProjectAction, toggleProjectAction, updateCategoryAction } from "./actions";

export type CatView = {
  id: string; name: string; type: "INCOME" | "EXPENSE"; parentId: string | null; flow: CashFlowKind; pnlLine: PnlLine;
  needs: CashCategoryNeeds | null; loanPart: LoanPart | null; aliases: string[]; isSystem: boolean; isActive: boolean;
};

const FLOW_OPTS = Object.entries(FLOW_LABEL) as [CashFlowKind, string][];
const LINE_OPTS = Object.entries(PNL_LINE_LABEL) as [PnlLine, string][];

/** Yangi manba (ota-onasiz) yoki sub manba (manba tanlansa — turi, oqimi va PNL qatori undan olinadi). */
export function CategoryCreateForm({ parents }: { parents: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createCategoryAction, undefined);
  const [parent, setParent] = useState("");
  const [needs, setNeeds] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) { ref.current?.reset(); setParent(""); setNeeds(""); } }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Nomi *"><Input name="name" required maxLength={80} placeholder="Masalan: Vulkanizatsiya" /></Field>
        <Field label="Qayerga" hint="manba tanlansa — sub manba bo'ladi">
          <Select name="parentId" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— yangi manba (yuqori daraja) —</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
        {!parent && (
          <Field label="Turi *">
            <Select name="type" defaultValue="EXPENSE"><option value="EXPENSE">Chiqim</option><option value="INCOME">Kirim</option></Select>
          </Field>
        )}
      </div>
      {!parent && (
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Pul oqimi turi (DDS) *"><Select name="flow" defaultValue="OPERATING">{FLOW_OPTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="PNL qatori *"><Select name="pnlLine" defaultValue="PRODUCTION">{LINE_OPTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Qo'shimcha so'raydi">
            <Select name="needs" value={needs} onChange={(e) => setNeeds(e.target.value)}>
              <option value="">— yo'q —</option>
              {(Object.entries(NEEDS_LABEL) as [CashCategoryNeeds, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {needs === "LOAN" && <Field label="Kredit qismi"><Select name="loanPart" defaultValue="PRINCIPAL"><option value="PRINCIPAL">Asosiy qarz</option><option value="INTEREST">Foiz</option></Select></Field>}
        </div>
      )}
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Kategoriya qo'shildi" : undefined} />
      <Button disabled={pending}><Plus size={16} /> {pending ? "Saqlanmoqda…" : "Qo'shish"}</Button>
    </form>
  );
}

/** Kategoriya tahriri — qatordagi «Tahrir» ichida. */
export function CategoryEditForm({ c }: { c: CatView }) {
  const [state, action, pending] = useActionState(updateCategoryAction, undefined);
  const [needs, setNeeds] = useState(c.needs ?? "");
  const top = !c.parentId;
  return (
    <details className="text-left">
      <summary className="cursor-pointer select-none text-[13px] font-medium text-slate-500 hover:text-slate-900">Tahrir</summary>
      <form action={action} className="mt-2 grid w-80 gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-(--shadow-pop)">
        <input type="hidden" name="id" value={c.id} />
        <Field label="Nomi"><Input name="name" defaultValue={c.name} readOnly={c.isSystem} maxLength={80} /></Field>
        {top && (
          <>
            <Field label="Pul oqimi turi"><Select name="flow" defaultValue={c.flow}>{FLOW_OPTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="PNL qatori"><Select name="pnlLine" defaultValue={c.pnlLine}>{LINE_OPTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            {!c.isSystem && (
              <Field label="Qo'shimcha so'raydi">
                <Select name="needs" value={needs} onChange={(e) => setNeeds(e.target.value)}>
                  <option value="">— yo'q —</option>
                  {(Object.entries(NEEDS_LABEL) as [CashCategoryNeeds, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            )}
            {!c.isSystem && needs === "LOAN" && <Field label="Kredit qismi"><Select name="loanPart" defaultValue={c.loanPart ?? "PRINCIPAL"}><option value="PRINCIPAL">Asosiy qarz</option><option value="INTEREST">Foiz</option></Select></Field>}
          </>
        )}
        <Field label="Boshqa yozilishlari (alias)" hint="vergul bilan; eski yozuvlardagi nomlar shu kategoriyaga tushadi">
          <Input name="aliases" defaultValue={c.aliases.join(", ")} />
        </Field>
        <Field label="Holati"><Select name="isActive" defaultValue={c.isActive ? "1" : "0"}><option value="1">Faol — formada chiqadi</option><option value="0">Nofaol — faqat eski yozuvlar</option></Select></Field>
        <FormError error={state?.error} />
        <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
        <Button size="sm" disabled={pending}><Save size={14} /> Saqlash</Button>
      </form>
    </details>
  );
}

/** Topilmagan nomni kategoriyaga alias qilib biriktirish. */
export function AliasForm({ alias, options }: { alias: string; options: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(addAliasAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="alias" value={alias} />
      <Select name="id" required defaultValue="" className="h-8 w-60 text-[13px]">
        <option value="" disabled>— qaysi kategoriya —</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={pending}><Tag size={14} /> Biriktirish</Button>
      {state?.error && <span className="w-full text-right text-[13px] text-red-600">{state.error}</span>}
    </form>
  );
}

export function ProjectCreateForm() {
  const [state, action, pending] = useActionState(createProjectAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Yangi loyiha" className="min-w-56 flex-1"><Input name="name" required maxLength={80} placeholder="Masalan: Future Stone" /></Field>
      <Field label="Izoh" className="min-w-56 flex-1"><Input name="note" maxLength={200} /></Field>
      <Button disabled={pending}><Plus size={16} /> Qo&apos;shish</Button>
      <div className="w-full"><FormError error={state?.error} /></div>
    </form>
  );
}

export function ProjectToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [, action, pending] = useActionState(toggleProjectAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? "0" : "1"} />
      <Button size="sm" variant="ghost" disabled={pending}>{isActive ? "Yopish" : "Qayta ochish"}</Button>
    </form>
  );
}
