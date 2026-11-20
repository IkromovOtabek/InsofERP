"use client";

import { createContext, startTransition, useActionState, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { updateCashTx } from "../cashflow/actions";
import { updatePaymentRow, updateTransferRow } from "./actions";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { SearchSelect } from "@/components/ui/search-select";
import { QuickAdd, WithAdd, type QuickAdded } from "@/components/quick-add";
import { quickAddCashCategory, quickAddLoan, quickAddProject } from "@/lib/quick-add-actions";
import { isLentCategory } from "@/lib/cash-categories";
import type { CategoryOption } from "@/lib/fin-report/categories";
import type { ActionState } from "@/lib/action";

/** Tahrir oynalari ro'yxatlari — jadvalda bir marta beriladi (har qatorga takrorlanmasin). */
export type CashEditOptions = {
  accounts: { id: string; name: string; type: "CASH" | "BANK" }[];
  income: CategoryOption[]; expense: CategoryOption[];
  /** Mijoz to'lovi va realizatsiya qatorida mijozni almashtirish uchun */
  customers?: { id: string; name: string }[];
  /** Sub manba (va loyiha) yonida «+» (Kirim-Chiqim formasidagi kabi): `cashflow.create` yoki `moliya.categories` */
  canAddSub?: boolean;
  /**
   * Kredit / loyiha manbasiga o'tkazish uchun ro'yxatlar («Qarz berildi» → kimga berilgan qarz). Berilmasa — bunday
   * manbalar tahrir tanlovida ko'rinmaydi (faqat yozuvning o'z manbasi).
   */
  loans?: { id: string; name: string; kind: "BANK" | "BORROWED" | "LENT" }[];
  projects?: { id: string; name: string }[];
  /** Kredit / qarz tanlovi yonida «+» (`quickAddLoan`): `cashflow.create` yoki `moliya.loans` */
  canAddLoan?: boolean;
};
const Options = createContext<CashEditOptions | null>(null);
export function CashEditProvider({ options, children }: { options: CashEditOptions; children: React.ReactNode }) {
  return <Options.Provider value={options}>{children}</Options.Provider>;
}
export const useCashEditOptions = (): CashEditOptions => useContext(Options) ?? { accounts: [], income: [], expense: [] };

/** Kassa jurnali qatori: kirim/chiqim yozuvi, mijoz to'lovi yoki perekit (o'tkazma hujjati). */
export type CashEditEntry =
  | {
      kind: "tx"; id: string; type: "INCOME" | "EXPENSE"; date: string; cashAccountId: string; amount: number;
      category: string; subCategory: string; counterparty: string; note: string; sig: string;
      /** Mijoz qarziga (kirim — qarz to'lovi, chiqim — qaytarilgan pul); bo'sh — qarzga tegmaydi */
      customerId: string; customerName: string;
      /** Kredit yoki loyihaga bog'langan — bog'lanish tahrirda o'zgarmaydi */
      linked?: boolean;
      /** Hujjatga bog'langan / kredit yozuvida qulf ustunlar (`lib/cash-entry.ts` → `cashEntryLocks`) */
      lock: { type: boolean; amount: boolean; account: boolean; category: boolean; why: string | null };
    }
  | {
      kind: "pay"; id: string; date: string; cashAccountId: string; amount: number; customerId: string; customerName: string;
      note: string; sig: string; lock: { customer: boolean; amount: boolean; why: string | null };
    }
  | {
      kind: "transfer"; id: string; docNo: string; date: string; fromAccountId: string; toAccountId: string; amount: number;
      note: string; sig: string; feeLock: boolean;
    };

/**
 * Kassa / bank qatorining tahrir oynasi — qator tafsilotidagi «Tahrirlash» tugmasidan (`cash-detail.tsx`): hamma ustunni
 * tuzatish (kirim ⇄ chiqim ham). Qoidalar serverda — `lib/cash-entry.ts`, `lib/payments.ts`, `lib/cash-transfer.ts`
 * (qoldiq, kategoriya, boshqa joyda o'zgargan bo'lsa rad).
 */
export function CashEditDialog({ entry, onClose }: { entry: CashEditEntry; onClose: () => void }) {
  return entry.kind === "tx" ? <TxDialog entry={entry} onClose={onClose} />
    : entry.kind === "pay" ? <PayDialog entry={entry} onClose={onClose} />
    : <TransferDialog entry={entry} onClose={onClose} />;
}

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Umumiy oyna: sarlavha, Esc/tashqariga bosish bilan yopish, xato, Saqlash. `<form action>` xato bilan qaytganda maydonlarni tozalaydi — onSubmit + startTransition. */
export function EditModal({ title, action, onClose, wide, foot, children }: {
  title: string; action: Act; onClose: () => void; wide?: boolean; foot?: React.ReactNode; children: React.ReactNode;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  useEffect(() => { if (state?.ok) onClose(); }, [state, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal((
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={onClose}>
      <form role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => run(fd)); }}
        className={`w-full ${wide ? "max-w-4xl" : "max-w-2xl"} space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>
        {children}
        {foot && <div className="text-xs text-slate-500">{foot}</div>}
        <FormError error={state?.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Yopish</Button>
          <Button disabled={pending}><Pencil size={15} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        </div>
      </form>
    </div>
  ), document.body);
}

const accLabel = (a: { name: string; type: "CASH" | "BANK" }) => `${a.name} (${a.type === "CASH" ? "naqd" : "bank"})`;

/** Qulf maydon: ko'rinadi, o'zgarmaydi; qiymat formaga yashirin maydondan ketadi (disabled maydon yuborilmaydi). */
const Locked = ({ name, value }: { name: string; value: string }) => <input type="hidden" name={name} value={value} />;

function AccountSelect({ name, value, locked, label = "Kassa / hisob *" }: { name: string; value: string; locked?: boolean; label?: string }) {
  const o = useCashEditOptions();
  const list = o.accounts.some((a) => a.id === value) ? o.accounts : [{ id: value, name: "Yopilgan hisob", type: "CASH" as const }, ...o.accounts];
  return (
    <Field label={label}>
      <Select name={locked ? undefined : name} defaultValue={value} disabled={locked} required>
        {list.map((a) => <option key={a.id} value={a.id}>{accLabel(a)}</option>)}
      </Select>
      {locked && <Locked name={name} value={value} />}
    </Field>
  );
}

function AmountField({ value, locked }: { value: number; locked?: boolean }) {
  const [amount, setAmount] = useState(String(value));
  return (
    <Field label="Summa *">
      {locked ? <><MoneyInput value={String(value)} disabled readOnly /><Locked name="amount" value={String(value)} /></>
        : <MoneyInput name="amount" value={amount} onChange={setAmount} required />}
    </Field>
  );
}

/* ───────── Kirim / chiqim yozuvi ───────── */

function TxDialog({ entry, onClose }: { entry: Extract<CashEditEntry, { kind: "tx" }>; onClose: () => void }) {
  const o = useCashEditOptions();
  const [type, setType] = useState(entry.type);
  const [category, setCategory] = useState(entry.category);
  const [sub, setSub] = useState(entry.subCategory);
  // «+» bilan qo'shilgan sub manbalar — sahifa yangilanguncha ham ro'yxatda tursin
  const [addedSubs, setAddedSubs] = useState<Record<string, string[]>>({});
  // Sana boshqariladi: «+» bilan ochilgan yangi qarzning boshlanish sanasi — shu yozuv sanasi (Kirim-Chiqim formasidagi kabi)
  const [date, setDate] = useState(entry.date);
  const [loanId, setLoanId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [addedLoans, setAddedLoans] = useState<NonNullable<CashEditOptions["loans"]>>([]);
  const [addedProjects, setAddedProjects] = useState<{ id: string; name: string }[]>([]);
  const action = useCallback<Act>((p, fd) => updateCashTx(entry.id, p, fd), [entry.id]);
  // Mijoz qarziga bog'lash: ro'yxat berilgan bo'lsa (cashflow.edit) — kirimda (qarz to'lovi) yoki allaqachon bog'langan yozuvda
  const [customer, setCustomer] = useState(entry.customerId);
  const custBase = o.customers ?? [];
  const custList = entry.customerId && !custBase.some((c) => c.id === entry.customerId) ? [{ id: entry.customerId, name: entry.customerName }, ...custBase] : custBase;

  const sameType = type === entry.type;
  const list = type === "INCOME" ? o.income : o.expense;
  // Eski yozuvdagi erkin nom (daraxtda yo'q) ham tanlovda tursin — tur o'zgarmagan bo'lsa
  const cats = sameType && !list.some((c) => c.name === entry.category) ? [{ name: entry.category, needs: null, loanPart: null, subs: [] }, ...list] : list;
  const cur = cats.find((c) => c.name === category);
  const active = cur ? [...cur.subs, ...(addedSubs[category] ?? []).filter((x) => !cur.subs.includes(x))] : [];
  const subs = [...active, ...(cur && category === entry.category && entry.subCategory && !active.includes(entry.subCategory) ? [entry.subCategory] : [])];
  // Sub manba majburiy — barcha manbalarda (sub manbasi yo'q bo'lsa «+» bilan qo'shiladi); qoida serverda (`lib/cash-entry.ts`).
  // Istisno — daraxtda yo'q eski erkin nom: unga sub manba qo'shib bo'lmaydi
  const legacy = sameType && category === entry.category && !list.some((c) => c.name === entry.category);
  const subNeeded = !!cur && !legacy;
  // Kredit / loyiha so'raydigan manba — ro'yxatlar berilgan bo'lsa (Kassa / bank, Kirim-Chiqim) tanlovda bor: tanlansa qaysi
  // qarz / loyiha so'raladi. Ro'yxatsiz joyda (mijoz varag'i va b.) — faqat yozuvning o'z manbasi
  const linkable = (c: { needs: string | null }) => (c.needs === "LOAN" ? !!o.loans : c.needs === "PROJECT" ? !!o.projects : true);
  const shown = cats.filter((c) => (sameType && c.name === entry.category) || linkable(c));
  const L = entry.lock;
  // Bog'lanish tanlovi: yozuv hali kredit / loyihaga bog'lanmagan bo'lsa. Boshqa manbadan o'tilsa — shart; o'z manbasida
  // (Excel importidan bog'lanmay kelgan) — ixtiyoriy. Qoida serverda ham (`lib/cash-entry.ts` → `updateCashEntry`)
  const moved = !sameType || category !== entry.category;
  const needLoan = !L.category && !entry.linked && cur?.needs === "LOAN" && !!o.loans;
  const needProject = !L.category && !entry.linked && cur?.needs === "PROJECT" && !!o.projects;
  const lentCat = isLentCategory(category);
  const loanList = [...(o.loans ?? []), ...addedLoans.filter((x) => !o.loans?.some((l) => l.id === x.id))].filter((l) => (l.kind === "LENT") === lentCat);
  const loanVal = loanList.some((l) => l.id === loanId) ? loanId : "";
  const projectList = [...(o.projects ?? []), ...addedProjects.filter((x) => !o.projects?.some((p) => p.id === x.id))];
  const saveLoan = (fd: FormData) => { fd.set("date", date); return quickAddLoan(fd); };
  // Kredit / loyiha yozuvi mijoz qarziga bog'lanmaydi: shunday manbaga o'tilsa mijoz bog'lanishi olib tashlanadi
  const dropCust = (needLoan || needProject) && moved && !!entry.customerId;
  const showCust = custBase.length > 0 && !entry.lock.type && !dropCust && (type === "INCOME" || !!entry.customerId);

  return (
    <EditModal title={`${entry.type === "INCOME" ? "Kirimni" : "Chiqimni"} tahrirlash`} action={action} onClose={onClose}
      foot={<>{L.why ? <b className="font-medium text-amber-700">{L.why}. </b> : null}Avvalgi qiymatlar Amallar tarixida (AuditLog) saqlanadi.</>}>
      <input type="hidden" name="sig" value={entry.sig} />
      <input type="hidden" name="type" value={type} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <Field label="Turi *">
          <Select value={type} disabled={L.type} aria-label="Turi"
            onChange={(e) => {
              const t = e.target.value as "INCOME" | "EXPENSE";
              setType(t);
              // Manba daraxti turga bog'liq: boshqa turga o'tilsa — manba qaytadan tanlanadi
              setCategory(t === entry.type ? entry.category : ""); setSub(t === entry.type ? entry.subCategory : "");
              setLoanId(""); setProjectId("");
            }}>
            <option value="INCOME">Kirim</option>
            <option value="EXPENSE">Chiqim</option>
          </Select>
        </Field>
        <Field label="Sana *"><Input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <AccountSelect name="cashAccountId" value={entry.cashAccountId} locked={L.account} />
        <AmountField value={entry.amount} locked={L.amount} />
        <Field label="Manba *">
          <Select name={L.category ? undefined : "category"} value={category} disabled={L.category} required
            onChange={(e) => { setCategory(e.target.value); setSub(""); setLoanId(""); setProjectId(""); }}>
            {!category && <option value="">— tanlang —</option>}
            {shown.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </Select>
          {L.category && <Locked name="category" value={entry.category} />}
        </Field>
        <Field label={subNeeded ? "Sub manba *" : "Sub manba"}
          hint={subNeeded && !active.length ? (o.canAddSub ? "bu manbada sub manba yo'q — «+» bilan qo'shing" : "bu manbada sub manba yo'q — Moliya → Kategoriyalarda qo'shing") : undefined}>
          <WithAdd add={o.canAddSub && subNeeded && (
            <QuickAdd label="Yangi sub manba qo'shish" title={`«${category}» ichida yangi sub manba`} save={quickAddCashCategory}
              onCreated={(x: QuickAdded) => { setAddedSubs((a) => ({ ...a, [category]: [...(a[category] ?? []), x.name] })); setSub(x.name); }}>
              <input type="hidden" name="parent" value={category} />
              <Field label="Nomi *"><Input name="name" required maxLength={80} autoFocus autoComplete="off" placeholder="Masalan: Ovqat (non, suv)" /></Field>
            </QuickAdd>
          )}>
            <Select name="subCategory" value={sub} required={subNeeded} onChange={(e) => setSub(e.target.value)}>
              {subNeeded ? <option value="" disabled>— tanlang —</option> : <option value="">— umumiy —</option>}
              {subs.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </WithAdd>
        </Field>
        {needLoan && (
          <Field label={moved ? "Kredit / qarz *" : "Kredit / qarz"} className="sm:col-span-3"
            hint={!loanList.length ? (o.canAddLoan ? "ro'yxat bo'sh — «+» bilan qo'shing" : "ro'yxat bo'sh — Moliya → Kreditlar sahifasida qo'shing")
              : cur?.loanPart === "INTEREST" ? "foiz — PNL xarajati" : "asosiy qarz — qoldiqni o'zgartiradi"}>
            <WithAdd add={o.canAddLoan && (
              <QuickAdd label={lentCat ? "Yangi berilgan qarz" : "Yangi kredit / qarz"} title={lentCat ? "Yangi berilgan qarz" : "Yangi kredit yoki olingan qarz"} save={saveLoan}
                onCreated={(x: QuickAdded) => { setAddedLoans((a) => [...a, { id: x.id, name: x.name, kind: lentCat ? "LENT" : "BANK" }]); setLoanId(x.id); }}>
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
              </QuickAdd>
            )}>
              <Select name="loanId" value={loanVal} required={moved} onChange={(e) => setLoanId(e.target.value)}>
                <option value="" disabled={moved}>{moved ? "— tanlang —" : "— bog'lanmagan —"}</option>
                {loanList.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </WithAdd>
          </Field>
        )}
        {needProject && (
          <Field label={moved ? "Loyiha *" : "Loyiha"} className="sm:col-span-3"
            hint={projectList.length ? "zavod foydasiga kirmaydi" : o.canAddSub ? "ro'yxat bo'sh — «+» bilan qo'shing" : "ro'yxat bo'sh — Moliya → Kategoriyalar sahifasida qo'shing"}>
            <WithAdd add={o.canAddSub && (
              <QuickAdd label="Yangi loyiha qo'shish" title="Yangi loyiha" save={quickAddProject}
                onCreated={(x: QuickAdded) => { setAddedProjects((a) => [...a, { id: x.id, name: x.name }]); setProjectId(x.id); }}>
                <Field label="Nomi *"><Input name="name" required maxLength={120} autoFocus autoComplete="off" /></Field>
                <Field label="Izoh"><Input name="note" maxLength={300} autoComplete="off" placeholder="ixtiyoriy" /></Field>
              </QuickAdd>
            )}>
              <Select name="projectId" value={projectId} required={moved} onChange={(e) => setProjectId(e.target.value)}>
                <option value="" disabled={moved}>{moved ? "— loyiha —" : "— bog'lanmagan —"}</option>
                {projectList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </WithAdd>
          </Field>
        )}
        {dropCust && <input type="hidden" name="customerId" value="" />}
        <Field label={type === "INCOME" ? "Kimdan" : "Kimga"} className="sm:col-span-1"><Input name="counterparty" defaultValue={entry.counterparty} maxLength={200} autoComplete="off" /></Field>
        {showCust && (
          <Field label={type === "INCOME" ? "Mijoz qarziga (to'lov)" : "Mijozga qaytarilgan pul"} className="sm:col-span-2"
            hint={customer ? (type === "INCOME" ? "shu mijoz qarzidan ayiriladi — «Kimdan» boshqa mijoz bo'lishi mumkin" : "shu mijoz qarziga qo'shiladi") : "tanlanmasa — mijoz qarziga tegmaydi (chakana, naqd sotuv)"}>
            <SearchSelect name="customerId" options={custList} value={customer} onChange={setCustomer} placeholder="Mijozni yozib qidiring…" ariaLabel="Mijoz qarziga" />
          </Field>
        )}
        <Field label="Izoh" className={showCust ? "sm:col-span-3" : "sm:col-span-2"}><Input name="note" defaultValue={entry.note} maxLength={500} /></Field>
      </div>
      {dropCust && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Yozuv «{entry.customerName}» qarziga bog&apos;langan edi — {needLoan ? "kredit / qarz" : "loyiha"} manbasiga o&apos;tganda mijoz qarzidan olinadi.</p>}
      {!sameType && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Yozuv {type === "INCOME" ? "chiqimdan kirimga" : "kirimdan chiqimga"} o&apos;tkaziladi — {type === "INCOME" ? "kirim" : "chiqim"} manbasini tanlang. Hisob qoldig&apos;i shunga qarab o&apos;zgaradi.</p>}
    </EditModal>
  );
}

/* ───────── Mijoz to'lovi ───────── */

function PayDialog({ entry, onClose }: { entry: Extract<CashEditEntry, { kind: "pay" }>; onClose: () => void }) {
  const o = useCashEditOptions();
  const action = useCallback<Act>((p, fd) => updatePaymentRow(entry.id, p, fd), [entry.id]);
  const custs = o.customers ?? [];
  const list = custs.some((c) => c.id === entry.customerId) ? custs : [{ id: entry.customerId, name: entry.customerName }, ...custs];
  const L = entry.lock;
  return (
    <EditModal title="Mijoz to'lovini tahrirlash" action={action} onClose={onClose}
      foot={<>{L.why ? <b className="font-medium text-amber-700">{L.why}. </b> : null}Mijoz to&apos;lovi har doim kirim — chiqimga aylantirish kerak bo&apos;lsa, To&apos;lovlar tabida bekor qilib, Kirim-Chiqimda kiriting. Avvalgi qiymatlar AuditLog&apos;da.</>}>
      <input type="hidden" name="sig" value={entry.sig} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <Field label="Sana *"><Input name="date" type="date" defaultValue={entry.date} required /></Field>
        <AccountSelect name="cashAccountId" value={entry.cashAccountId} />
        <AmountField value={entry.amount} locked={L.amount} />
        <Field label="Mijoz *" className="sm:col-span-3">
          <Select name={L.customer ? undefined : "customerId"} defaultValue={entry.customerId} disabled={L.customer} required>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          {L.customer && <Locked name="customerId" value={entry.customerId} />}
        </Field>
        <Field label="Izoh" className="sm:col-span-3"><Input name="note" defaultValue={entry.note} maxLength={500} /></Field>
      </div>
    </EditModal>
  );
}

/* ───────── Perekit (o'tkazma) ───────── */

function TransferDialog({ entry, onClose }: { entry: Extract<CashEditEntry, { kind: "transfer" }>; onClose: () => void }) {
  const action = useCallback<Act>((p, fd) => updateTransferRow(entry.id, p, fd), [entry.id]);
  return (
    <EditModal title={`Perekit ${entry.docNo} — tahrirlash`} action={action} onClose={onClose}
      foot={<>{entry.feeLock ? <b className="font-medium text-amber-700">Komissiyali o&apos;tkazma — hisoblar o&apos;zgarmaydi. </b> : null}Ikkala hisobdagi yozuv birga o&apos;zgaradi. Avvalgi qiymatlar AuditLog&apos;da.</>}>
      <input type="hidden" name="sig" value={entry.sig} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <Field label="Sana *"><Input name="date" type="date" defaultValue={entry.date} required /></Field>
        <AccountSelect name="fromAccountId" value={entry.fromAccountId} locked={entry.feeLock} label="Qayerdan *" />
        <AccountSelect name="toAccountId" value={entry.toAccountId} locked={entry.feeLock} label="Qayerga *" />
        <AmountField value={entry.amount} />
        <Field label="Izoh" className="sm:col-span-2"><Input name="note" defaultValue={entry.note} maxLength={500} /></Field>
      </div>
    </EditModal>
  );
}
