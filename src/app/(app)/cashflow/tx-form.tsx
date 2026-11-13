"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Banknote, Landmark } from "lucide-react";
import { isoDate } from "@/lib/format";
import { createCashTx } from "./actions";
import { Button, Callout, Field, FormError, FormSuccess, Input, Select, FormActions } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { cn } from "@/lib/utils";
import { CASH_METHOD_LABEL, PEREKIT_CATEGORY, SALES_CATEGORY, type CashMethod } from "@/lib/cash-categories";
import type { CategoryOption } from "@/lib/fin-report/categories";
import { PNL_LINE_LABEL } from "@/lib/fin-report/labels";
import { QuickAdd, QuickDelete, QuickEdit, SupplierAdd, WithAdd, type QuickAdded } from "@/components/quick-add";
import { quickAddCashCategory, quickAddLoan, quickAddProject, quickRemoveCashCategory, quickRenameCashCategory } from "@/lib/quick-add-actions";
import { CategoryManager, RemoveText } from "./category-manager";

type Opt = { id: string; name: string };
type LoanOpt = Opt & { kind: "BANK" | "BORROWED" | "LENT" };
type Acc = Opt & { type?: CashMethod };

/**
 * `receipts` — to'lanmagan kirim hujjatlari: chiqim shulardan biriga bog'lansa, kirimning "to'langan" summasiga qo'shiladi.
 * `canPerekit` — Chiqim kategoriyalarida «Perekit»: o'z hisoblarimiz orasida o'tkazma (chiqim emas, `lib/cash-transfer.ts`).
 * «Naqd / Bank» — to'lov usuli: hisob ro'yxatini shu turdagi hisoblarga toraytiradi (usul hisob turidan olinadi).
 * Kategoriya — «Manba → Sub manba» daraxti (`CashCategory`); manba loyiha yoki kredit so'rasa, qo'shimcha tanlov chiqadi.
 * `canAdd` — manba, sub manba, loyiha, kredit / qarz va yetkazuvchi tanlovlari yonida «+»: ro'yxatda yo'g'i shu yerning o'zida qo'shiladi
 * va darhol tanlanadi (sahifa yangilanguncha mahalliy ro'yxatga ham qo'shib turiladi).
 * `canEditCat` / `canDeleteCat` — tanlangan manba va sub manba yonida qalam (nomini o'zgartirish) va savatcha (o'chirish;
 * ishlatilgani ro'yxatdan olinadi). `lockedCats` — tizim kategoriyalari: qalam yo'q (nomi o'zgarmaydi), savatcha faqat ro'yxatdan oladi.
 * Manba ostidagi «Ro'yxatni tahrirlash» — shu turdagi barcha manba va sub manbalar bitta oynada (`category-manager.tsx`).
 */
export function TxForm({ accounts, suppliers, receipts = [], incomeCats, expenseCats, projects = [], loans = [], canPerekit = false, canAdd = false, canEditCat = false, canDeleteCat = false, lockedCats = [], clientToken = "" }: {
  accounts: Acc[]; suppliers: Opt[]; receipts?: { id: string; supplierId: string; label: string }[]; incomeCats: CategoryOption[]; expenseCats: CategoryOption[];
  projects?: Opt[]; loans?: LoanOpt[]; canPerekit?: boolean; canAdd?: boolean; canEditCat?: boolean; canDeleteCat?: boolean; lockedCats?: string[]; clientToken?: string;
}) {
  const [state, action, pending] = useActionState(createCashTx, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  // Saqlangandan keyin maydonlar qayta mount qilinadi — summa (MoneyInput) ham, tanlovlar ham to'liq tozalanadi
  const [formKey, setFormKey] = useState(0);
  const [supplierId, setSupplierId] = useState("");
  const [category, setCategory] = useState("");
  const [sub, setSub] = useState("");
  const [projectId, setProjectId] = useState("");
  const [loanId, setLoanId] = useState("");
  // «+» bilan qo'shilganlar — sahifa ma'lumoti yangilanguncha ham ro'yxatda tursin
  const [added, setAdded] = useState<{ cats: (CategoryOption & { type: "INCOME" | "EXPENSE" })[]; subs: Record<string, string[]>; projects: Opt[]; suppliers: Opt[]; loans: LoanOpt[] }>({ cats: [], subs: {}, projects: [], suppliers: [], loans: [] });
  const merge = <T,>(base: T[], extra: T[], key: (x: T) => string) => [...base, ...extra.filter((x) => !base.some((b) => key(b) === key(x)))];
  // Qalam / savatcha natijasi — sahifa ma'lumoti yangilanguncha ham ro'yxatda aks etsin (eski nom → yangi, o'chirilganlar)
  const [edits, setEdits] = useState<{ renamed: Record<string, string>; removed: string[] }>({ renamed: {}, removed: [] });
  const [catNote, setCatNote] = useState("");
  const ren = (n: string) => { let x = n; for (let i = 0; i < 5 && edits.renamed[x]; i++) x = edits.renamed[x]; return x; };
  const live = (n: string) => !edits.removed.includes(n);
  const fixCat = (c: CategoryOption): CategoryOption => ({ ...c, name: ren(c.name), subs: c.subs.map(ren).filter(live) });
  const pickCategory = (v: string) => { setCategory(v); setSub(""); setLoanId(""); };
  const [method, setMethod] = useState<CashMethod>(accounts.some((a) => a.type === "CASH") || !accounts.some((a) => a.type === "BANK") ? "CASH" : "BANK");
  const [fromId, setFromId] = useState(accounts[0]?.id ?? "");
  // Perekit uchun bir martalik kalit: ikki marta bosilgan «Saqlash» ikkinchi o'tkazma ochmaydi; saqlangach yangilanadi
  const [token, setToken] = useState(clientToken);
  useEffect(() => { if (state?.ok) { setFormKey((k) => k + 1); setCatNote(""); setSupplierId(""); setCategory(""); setSub(""); setProjectId(""); setLoanId(""); setToken(crypto.randomUUID()); } }, [state]);
  const perekitOpt: CategoryOption = { name: PEREKIT_CATEGORY, needs: null, loanPart: null, subs: [] };
  const typeCats = merge(type === "INCOME" ? incomeCats : expenseCats, added.cats.filter((c) => c.type === type), (c) => c.name).map(fixCat).filter((c) => live(c.name));
  const cats = type === "EXPENSE" && canPerekit && accounts.length >= 2 ? [...typeCats, perekitOpt] : typeCats;
  const cur = cats.find((c) => c.name === category) ?? cats[0];
  const subs = cur ? merge(cur.subs, (added.subs[cur.name] ?? []).map(ren).filter(live), (x) => x) : [];
  const projectList = merge(projects, added.projects, (p) => p.id);
  const supplierList = merge(suppliers, added.suppliers, (p) => p.id);
  const cat = cur?.name ?? "";
  const perekit = type === "EXPENSE" && cat === PEREKIT_CATEGORY;
  // Sub manba har bir kirim/chiqimda majburiy (perekitdan tashqari); sub manbasi yo'q manbada «+» bilan qo'shiladi. Qoida serverda ham (`lib/cash-entry.ts`)
  const subNeeded = !perekit && !!cur;
  // Qalam / savatcha: tanlangan haqiqiy manba / sub manbada (perekitda emas). Tizim kategoriyasida faqat savatcha —
  // nomi o'zgarmaydi (kod unga tayanadi), o'chirish esa uni faqat ro'yxatdan oladi
  const catTools = !!cur && !perekit;
  const catLocked = lockedCats.includes(cat);
  const subTools = subNeeded && !!sub && subs.includes(sub);
  const subLocked = lockedCats.includes(sub);
  // Qalam / savatcha (tanlov ostida ham, «Ro'yxatni tahrirlash» oynasida ham): ro'yxat va formadagi tanlov yangi holatga o'tadi
  const onRenamed = (old: string, x: QuickAdded, top: boolean) => {
    setEdits((e) => ({ ...e, renamed: { ...e.renamed, [old]: x.name } }));
    if (top) {
      setAdded((a) => ({ ...a, subs: { ...a.subs, [x.name]: a.subs[old] ?? [] } }));
      if (category === old) setCategory(x.name);
    } else if (sub === old) setSub(x.name);
    setCatNote(x.note ?? "");
  };
  const onRemoved = (old: string, x: QuickAdded, top: boolean) => {
    setEdits((e) => ({ ...e, removed: [...e.removed, old] }));
    if (top) { if (cat === old) pickCategory(""); } else if (sub === old) setSub("");
    setCatNote(x.note ?? "");
  };
  // «Ro'yxatni tahrirlash» oynasi uchun: shu turdagi barcha manbalar, «+» bilan qo'shilgan sub manbalari bilan (perekitsiz)
  const allCats = typeCats.map((c) => ({ name: c.name, subs: merge(c.subs, (added.subs[c.name] ?? []).map(ren).filter(live), (x) => x) }));
  // Perekitda hamma hisob (kassa ⇄ bank); oddiy kirim/chiqimda — tanlangan usuldagi hisoblar
  const shownAccounts = perekit ? accounts : accounts.filter((a) => !a.type || a.type === method);
  const accId = shownAccounts.some((a) => a.id === fromId) ? fromId : shownAccounts[0]?.id ?? "";
  const accLabel = (a: Acc) => `${a.name}${a.type ? ` (${a.type === "CASH" ? "naqd" : "bank"})` : ""}`;
  const shownReceipts = supplierId ? receipts.filter((r) => r.supplierId === supplierId) : receipts;
  // Kredit kategoriyasi: «Qarz berildi / qaytdi» — biz bergan qarzlar, qolganlari — kreditlar va olingan qarzlar
  const lentCat = /qarz berildi|berilgan qarz/i.test(cat);
  const shownLoans = merge(loans, added.loans, (l) => l.id).filter((l) => (l.kind === "LENT") === lentCat);
  const loanVal = shownLoans.some((l) => l.id === loanId) ? loanId : "";
  // Yangi qarzning sanasi — shu kirim/chiqim sanasi (qarz qoldig'i shu sanadan oldingi yozuvlarni hisobga olmaydi)
  const saveLoan = (fd: FormData) => {
    const d = formRef.current ? new FormData(formRef.current).get("date") : null;
    if (typeof d === "string") fd.set("date", d);
    return quickAddLoan(fd);
  };

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      {catNote && <FormSuccess text={catNote} />}
      <input type="hidden" name="type" value={type} />
      {perekit && <input type="hidden" name="clientToken" value={token} />}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
          <button type="button" onClick={() => setType("INCOME")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition", type === "INCOME" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100")}><ArrowDownLeft size={14} /> Kirim</button>
          <button type="button" onClick={() => setType("EXPENSE")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition", type === "EXPENSE" ? "bg-red-600 text-white" : "text-slate-600 hover:bg-slate-100")}><ArrowUpRight size={14} /> Chiqim</button>
        </div>
        {!perekit && (
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="group" aria-label="To'lov usuli">
            {(["CASH", "BANK"] as const).map((m) => {
              const Icon = m === "CASH" ? Banknote : Landmark;
              const none = !accounts.some((a) => a.type === m);
              return <button key={m} type="button" disabled={none} title={none ? "Bu turdagi faol hisob yo'q (Sozlamalar → Kassa / hisoblar)" : undefined} onClick={() => setMethod(m)} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-40", method === m ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}><Icon size={14} /> {CASH_METHOD_LABEL[m]}</button>;
            })}
          </div>
        )}
      </div>
      {/* Naqd kassa ochilmagan korxonada «Naqd» tugmasi o'chiq — sababi faqat title'da qolib, xodim nega bosilmayotganini bilmasdi */}
      {!perekit && !accounts.some((a) => a.type === "CASH") && (
        <Callout tone="warning">Naqd kassa ochilmagan — naqd kirim/chiqim yozib bo&apos;lmaydi. Direktor Sozlamalar → Kassa / hisoblar bo&apos;limida «Naqd» turidagi hisob qo&apos;shsin.</Callout>
      )}
      <div key={formKey} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
        <Field label={perekit ? "Qayerdan (hisob) *" : "Kassa / hisob *"}><Select name="cashAccountId" value={accId} onChange={(e) => setFromId(e.target.value)} required>{shownAccounts.map((a) => <option key={a.id} value={a.id}>{perekit ? accLabel(a) : a.name}</option>)}</Select></Field>
        <Field label="Summa *"><MoneyInput name="amount" required /></Field>
        <div>
          <Field label="Manba (kategoriya) *" hint={type === "INCOME" && cat === SALES_CATEGORY ? "Mijoz qarzini kamaytirmaydi — mijoz to'lovi Kassa / bank → To'lovlar orqali kiritiladi" : undefined}>
            <WithAdd add={canAdd && (
              <QuickAdd label="Yangi manba qo'shish" title={`Yangi ${type === "INCOME" ? "kirim" : "chiqim"} manbasi`} save={quickAddCashCategory}
                onCreated={(x: QuickAdded) => { setEdits((e) => ({ ...e, removed: e.removed.filter((n) => n !== x.name) })); setAdded((a) => ({ ...a, cats: [...a.cats, { name: x.name, needs: null, loanPart: null, subs: [], type }] })); pickCategory(x.name); }}>
                <input type="hidden" name="type" value={type} />
                <Field label="Nomi *"><Input name="name" required maxLength={80} autoFocus autoComplete="off" placeholder={type === "INCOME" ? "Masalan: Ijara tushumi" : "Masalan: Qo'riqlash xizmati"} /></Field>
                <Field label="Foyda-zarar (PNL) qatori" hint="Oqim turi, alias va boshqasi — Moliya → Kategoriyalar sahifasida">
                  <Select name="pnlLine" defaultValue={type === "INCOME" ? "OTHER_INCOME" : "PRODUCTION"}>
                    {Object.entries(PNL_LINE_LABEL).filter(([k]) => k !== "PROJECT" && (type === "INCOME" ? ["OTHER_INCOME", "NONE"].includes(k) : k !== "OTHER_INCOME")).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
              </QuickAdd>
            )}>
              <Select name="category" value={cat} onChange={(e) => pickCategory(e.target.value)}>{cats.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</Select>
            </WithAdd>
          </Field>
          {(canEditCat || canDeleteCat) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {catTools && !catLocked && canEditCat && (
                <QuickEdit label="Manba nomini tahrirlash" title={`«${cat}» manbasini tahrirlash`} save={quickRenameCashCategory}
                  onSaved={(x) => onRenamed(cat, x, true)}>
                  <input type="hidden" name="name" value={cat} />
                  <Field label="Nomi *" hint="Shu manbadagi eski yozuvlar ham yangi nomga o'tadi. PNL qatori va oqim turi — Moliya → Kategoriyalarda">
                    <Input name="newName" required maxLength={80} defaultValue={cat} autoFocus autoComplete="off" />
                  </Field>
                </QuickEdit>
              )}
              {catTools && canDeleteCat && (
                <QuickDelete label="Manbani o'chirish" title={`«${cat}» manbasini o'chirish`} save={quickRemoveCashCategory} onDone={(x) => onRemoved(cat, x, true)}>
                  <input type="hidden" name="name" value={cat} />
                  <RemoveText name={cat} subCount={subs.length} system={catLocked} />
                </QuickDelete>
              )}
              <CategoryManager type={type} cats={allCats} locked={lockedCats} canEdit={canEditCat} canDelete={canDeleteCat} onRenamed={onRenamed} onRemoved={onRemoved} />
            </div>
          )}
        </div>
        {subNeeded && (
          <div>
            <Field label="Sub manba *" hint={subs.length ? "majburiy — hisobotda manba ichida ko'rinadi" : canAdd ? "bu manbada sub manba yo'q — «+» bilan qo'shing" : "bu manbada sub manba yo'q — Moliya → Kategoriyalarda qo'shing"}>
              <WithAdd add={canAdd && (
                <QuickAdd label="Yangi sub manba qo'shish" title={`«${cat}» ichida yangi sub manba`} save={quickAddCashCategory}
                  onCreated={(x: QuickAdded) => { setEdits((e) => ({ ...e, removed: e.removed.filter((n) => n !== x.name) })); setAdded((a) => ({ ...a, subs: { ...a.subs, [cat]: [...(a.subs[cat] ?? []), x.name] } })); setSub(x.name); }}>
                  <input type="hidden" name="parent" value={cat} />
                  <Field label="Nomi *"><Input name="name" required maxLength={80} autoFocus autoComplete="off" placeholder="Masalan: Ovqat (non, suv)" /></Field>
                </QuickAdd>
              )}>
                <Select name="subCategory" value={sub} required onChange={(e) => setSub(e.target.value)}><option value="" disabled>— tanlang —</option>{subs.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
              </WithAdd>
            </Field>
            {subTools && ((canEditCat && !subLocked) || canDeleteCat) && (
              <div className="mt-1 flex flex-wrap gap-1">
                {subTools && !subLocked && canEditCat && (
                  <QuickEdit label="Sub manba nomini tahrirlash" title={`«${sub}» sub manbasini tahrirlash`} save={quickRenameCashCategory} onSaved={(x) => onRenamed(sub, x, false)}>
                    <input type="hidden" name="parent" value={cat} />
                    <input type="hidden" name="name" value={sub} />
                    <Field label="Nomi *" hint="Shu sub manbadagi eski yozuvlar ham yangi nomga o'tadi">
                      <Input name="newName" required maxLength={80} defaultValue={sub} autoFocus autoComplete="off" />
                    </Field>
                  </QuickEdit>
                )}
                {subTools && canDeleteCat && (
                  <QuickDelete label="Sub manbani o'chirish" title={`«${sub}» sub manbasini o'chirish`} save={quickRemoveCashCategory} onDone={(x) => onRemoved(sub, x, false)}>
                    <input type="hidden" name="parent" value={cat} />
                    <input type="hidden" name="name" value={sub} />
                    <RemoveText name={sub} parent={cat} system={subLocked} />
                  </QuickDelete>
                )}
              </div>
            )}
          </div>
        )}
        {!perekit && cur?.needs === "PROJECT" && (
          <Field label="Loyiha *" hint={projectList.length ? "zavod foydasiga kirmaydi" : canAdd ? "«+» bilan loyiha qo'shing" : "Moliya → Kategoriyalar sahifasida loyiha qo'shing"}>
            <WithAdd add={canAdd && (
              <QuickAdd label="Yangi loyiha qo'shish" title="Yangi loyiha" save={quickAddProject}
                onCreated={(x: QuickAdded) => { setAdded((a) => ({ ...a, projects: [...a.projects, { id: x.id, name: x.name }] })); setProjectId(x.id); }}>
                <Field label="Nomi *"><Input name="name" required maxLength={120} autoFocus autoComplete="off" /></Field>
                <Field label="Izoh"><Input name="note" maxLength={300} autoComplete="off" placeholder="ixtiyoriy" /></Field>
              </QuickAdd>
            )}>
              <Select name="projectId" required value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="" disabled>— loyiha —</option>{projectList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            </WithAdd>
          </Field>
        )}
        {!perekit && cur?.needs === "LOAN" && (
          <Field label="Kredit / qarz *" hint={shownLoans.length ? (cur.loanPart === "INTEREST" ? "foiz — PNL xarajati" : "asosiy qarz — qoldiqni o'zgartiradi") : canAdd ? "«+» bilan qo'shing" : "Moliya → Kreditlar sahifasida qo'shing"}>
            <WithAdd add={canAdd && (
              <QuickAdd label={lentCat ? "Yangi berilgan qarz" : "Yangi kredit / qarz"} title={lentCat ? "Yangi berilgan qarz" : "Yangi kredit yoki olingan qarz"} save={saveLoan}
                onCreated={(x: QuickAdded) => { setAdded((a) => ({ ...a, loans: [...a.loans, { id: x.id, name: x.name, kind: lentCat ? "LENT" : "BANK" }] })); setLoanId(x.id); }}>
                {lentCat ? <input type="hidden" name="kind" value="LENT" /> : (
                  <Field label="Turi *">
                    <Select name="kind" defaultValue="BANK" required>
                      <option value="BANK">Bank krediti</option>
                      <option value="BORROWED">Olingan qarz (shaxs / firma)</option>
                    </Select>
                  </Field>
                )}
                <Field label={lentCat ? "Kimga berildi *" : "Bank / kimdan *"}><Input name="counterparty" required maxLength={160} autoFocus autoComplete="off" placeholder={lentCat ? "F.I.O. yoki tashkilot" : "Aloqabank"} /></Field>
                <Field label="Nomi" hint="bo'sh qolsa — yuqoridagi nom"><Input name="name" maxLength={160} autoComplete="off" placeholder={lentCat ? "Masalan: Aliyev — 2026 qarz" : "Masalan: Aloqabank — 2026 kredit"} /></Field>
                <Field label="Izoh"><Input name="note" maxLength={300} autoComplete="off" placeholder="ixtiyoriy" /></Field>
                <p className="text-[13px] text-slate-500">Qoldiq 0 dan boshlanadi — qarzni shu yozuvning o&apos;zi ochadi. Boshlang&apos;ich qoldiq kerak bo&apos;lsa — Moliya → Kreditlar va qarzlar.</p>
              </QuickAdd>
            )}>
              <Select name="loanId" required value={loanVal} onChange={(e) => setLoanId(e.target.value)}><option value="" disabled>— tanlang —</option>{shownLoans.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
            </WithAdd>
          </Field>
        )}
        {perekit ? (
          <Field label="Qayerga (hisob) *" hint="Pul o'z hisobimizga o'tadi — chiqim emas, ikkala hisob tarixida ko'rinadi" className="sm:col-span-2">
            <Select name="toAccountId" defaultValue="" required><option value="" disabled>Hisobni tanlang…</option>{accounts.filter((a) => a.id !== accId).map((a) => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}</Select>
          </Field>
        ) : type === "EXPENSE" ? (
          <Field label="Yetkazuvchi" hint="Xomashyo uchun">
            <WithAdd add={canAdd && <SupplierAdd onCreated={(x) => { setAdded((a) => ({ ...a, suppliers: [...a.suppliers, { id: x.id, name: x.name }] })); setSupplierId(x.id); }} />}>
              <Select name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">—</option>{supplierList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            </WithAdd>
          </Field>
        ) : null}
        {type === "EXPENSE" && !perekit && shownReceipts.length > 0 && (
          <Field label="Kirim hujjati" hint="Tanlansa — shu kirimga to'lov (qisman ham), qolgandan oshmaydi" className="sm:col-span-2">
            <Select name="receiptId" defaultValue=""><option value="">— bog&apos;lanmagan —</option>{shownReceipts.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select>
          </Field>
        )}
        {!perekit && <Field label={type === "INCOME" ? "Kimdan" : "Kimga"}><Input name="counterparty" placeholder="Nomi / F.I.O." /></Field>}
        <Field label="Izoh" className="sm:col-span-3"><Input name="note" placeholder={cur?.needs === "ASSET" ? "Qanday vosita (kartochka shu nom bilan ochiladi)" : "Nima uchun"} /></Field>
      </div>
      <FormActions>
        {perekit
          ? <Button disabled={pending}><ArrowRightLeft size={14} className="mr-1.5 inline" />{pending ? "Saqlanmoqda…" : "Perekitni saqlash"}</Button>
          : <Button disabled={pending} className={type === "INCOME" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}>{pending ? "Saqlanmoqda…" : type === "INCOME" ? "Kirimni saqlash" : "Chiqimni saqlash"}</Button>}
      </FormActions>
    </form>
  );
}
