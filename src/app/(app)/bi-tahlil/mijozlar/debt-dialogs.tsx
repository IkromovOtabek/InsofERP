"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Ban, ExternalLink, Loader2, Pencil } from "lucide-react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { SearchSelect } from "@/components/ui/search-select";
import { EditModal } from "@/app/(app)/payments/cash-edit";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/action";
import { createDebtTransferAction, editPartyAction, fixDebtBalanceAction, fixOpeningAction, updateDebtTransferAction } from "./actions";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type Opt = { id: string; name: string };

/** Katakdagi qalam — qatordagi akt sverka havolasi ustida (`z-10`), sichqoncha qatorga kelganda aniq ko'rinadi. */
const PENCIL = "relative z-10 shrink-0 rounded-md p-1 text-slate-400 opacity-40 transition hover:bg-white hover:text-slate-900 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100";

/** Katakdagi qalam-havola: summa ko'p hujjatdan yig'ilgan («Sotib olgan», «To'lagan») — tafsilotda har yozuvni tahrirlash. */
export function PencilLink({ href, title }: { href: string; title: string }) {
  return <Link href={href} title={title} aria-label={title} className={PENCIL}><Pencil size={13} /></Link>;
}

type Side = "qarz" | "haq";

/** Qarzdorlik / haqdorlik tanlovi va summa — qoldiq tuzatish oynalari uchun. `now` — joriy qiymat (musbat — ular bizga qarz). */
function SideAmount({ side, setSide, now }: { side: Side; setSide: (s: Side) => void; now: number }) {
  return (
    <>
      <Field label="Holat *">
        <input type="hidden" name="side" value={side} />
        <div className="flex h-10 rounded-lg border border-slate-300 p-0.5 text-sm">
          {(["qarz", "haq"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setSide(k)}
              className={cn("flex-1 rounded-md font-medium transition", side === k ? (k === "qarz" ? "bg-red-600 text-white" : "bg-emerald-600 text-white") : "text-slate-600 hover:bg-slate-100")}>
              {k === "qarz" ? "Qarzdorlik" : "Haqdorlik"}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Yangi qoldiq *"><MoneyInput name="amount" defaultValue={String(Math.abs(Math.round(now * 100) / 100))} required ariaLabel="Yangi qoldiq" /></Field>
    </>
  );
}

const nowText = (now: number) => (Math.abs(now) < 0.005 ? "qarz yo'q" : `${now > 0 ? "qarzdorlik" : "haqdorlik"} ${fmtNum(Math.abs(now))} so'm`);

/**
 * Qarz varag'idagi davr oxiri ustunlari qalami — «Qoldiqni tuzatish»: tanlangan kun oxiridagi qarzdorlik/haqdorlikni
 * kiritilgan summaga tenglash (`lib/debt-transfer.ts → setDebtBalance`, o'sha kunga boshlang'ich qoldiq yozuvi). `now` —
 * joriy qoldiq: musbat — ular bizga qarz (qarzdorlik), manfiy — biz ularga qarzmiz (haqdorlik). `side` — qaysi ustundan ochildi.
 */
export function DebtFixButton({ who, id, name, day, now, label, side: sideFrom }: { who: "customer" | "supplier"; id: string; name: string; day: string; now: number; /** Matnli tugma (sarlavhada); berilmasa — qatordagi qalam */ label?: string; side?: Side }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const close = useCallback(() => { setOpen(false); router.refresh(); }, [router]);
  const action = useCallback<Act>((p, fd) => fixDebtBalanceAction(who, id, p, fd), [who, id]);
  const [side, setSide] = useState<Side>(sideFrom ?? (now < 0 ? "haq" : "qarz"));
  return (
    <>
      {label
        ? <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Pencil size={15} /> {label}</button>
        : <button type="button" onClick={() => setOpen(true)} title="Qoldiqni tuzatish" aria-label={`${name} — qoldiqni tuzatish`} className={PENCIL}>
          <Pencil size={13} />
        </button>}
      {open && (
        <EditModal title={`Qoldiqni tuzatish — ${name}`} action={action} onClose={close}
          foot="O'sha kunga «Boshlang'ich qoldiq» tuzatish yozuvi yoziladi (Excel importidagi qoida) — tafsilot oynasida ko'rinadi, tahrirlanadi va o'chiriladi. AuditLog'da saqlanadi.">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Hozirgi holat: <b className="tabular text-slate-900">{nowText(now)}</b>
            <span className="text-slate-400"> · qarzdorlik — {who === "customer" ? "mijoz" : "ta'minotchi"} bizga qarz, haqdorlik — biz unga qarzmiz</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Field label="Qaysi kun oxiriga *"><Input name="date" type="date" defaultValue={day} max={day} required /></Field>
            <SideAmount side={side} setSide={setSide} now={now} />
            <Field label="Izoh (sababi)" className="sm:col-span-3"><Input name="note" maxLength={300} placeholder="Masalan: sverka bo'yicha" /></Field>
          </div>
        </EditModal>
      )}
    </>
  );
}

/**
 * Davr boshi ustunlari qalami — «Boshlang'ich qoldiqni tuzatish»: ustundagi qiymat (davr boshidagi qoldiq + davrdagi
 * boshlang'ich qoldiq yozuvlari) kiritilgan summaga tenglanadi (`setOpeningTotal`); sotuv va to'lovlar o'zgarmaydi.
 * `from` / `to` — varaq davri (`dan`, `sana`), `allTime` — «boshidan».
 */
export function OpeningFixButton({ who, id, name, from, fromLabel, to, allTime, now, side: sideFrom }: { who: "customer" | "supplier"; id: string; name: string; from: string; /** Davr boshi, ko'rinishi (dd.mm.yyyy) */ fromLabel: string; to: string; allTime: boolean; now: number; side: Side }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const close = useCallback(() => { setOpen(false); router.refresh(); }, [router]);
  const action = useCallback<Act>((p, fd) => fixOpeningAction(who, id, from, to, p, fd), [who, id, from, to]);
  const [side, setSide] = useState<Side>(Math.abs(now) < 0.005 ? sideFrom : now < 0 ? "haq" : "qarz");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Boshlang'ich qoldiqni tuzatish" aria-label={`${name} — boshlang'ich qoldiqni tuzatish`} className={PENCIL}>
        <Pencil size={13} />
      </button>
      {open && (
        <EditModal title={`Boshlang'ich qoldiq — ${name}`} action={action} onClose={close}
          foot={allTime
            ? "Farq birinchi boshlang'ich qoldiq yozuviga yoziladi (yozuv yo'q bo'lsa — birinchi harakat kuniga). Sotuv va to'lovlar o'zgarmaydi — davr oxiridagi qoldiq ham shuncha o'zgaradi. AuditLog'da saqlanadi."
            : `Farq ${fromLabel} kuniga boshlang'ich qoldiq yozuvi bo'lib yoziladi. Sotuv va to'lovlar o'zgarmaydi — davr oxiridagi qoldiq ham shuncha o'zgaradi. AuditLog'da saqlanadi.`}>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {allTime ? "Boshlang'ich qoldiq" : `Davr boshi (${fromLabel})`}: <b className="tabular text-slate-900">{nowText(now)}</b>
            <span className="text-slate-400"> · qarzdorlik — {who === "customer" ? "mijoz" : "ta'minotchi"} bizga qarz, haqdorlik — biz unga qarzmiz</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <SideAmount side={side} setSide={setSide} now={now} />
            <Field label="Izoh (sababi)" className="sm:col-span-2"><Input name="note" maxLength={300} placeholder="Masalan: 2025 yil qoldig'i, sverka bo'yicha" /></Field>
          </div>
        </EditModal>
      )}
    </>
  );
}

type Kind = "CASH" | "BANK";

/**
 * Nom ustunidagi qalam: mijoz — nomi va turi (naqd / perechisleniye), ta'minotchi — nomi. Tur tanlanmasa (qo'lda belgilanmagan
 * bo'lsa) — avvalgidek oxirgi zayavka (yo'q bo'lsa Realizatsiya qatori) bo'yicha qoladi (`customerKinds`). Bir xil nomli boshqa karta bo'lsa — saqlanmaydi.
 */
export function PartyEditButton({ who, id, name, kind, kindSet, cardHref }: { who: "customer" | "supplier"; id: string; name: string; kind?: Kind | null; kindSet?: Kind | null; cardHref?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const close = useCallback(() => { setOpen(false); router.refresh(); }, [router]);
  const action = useCallback<Act>((p, fd) => editPartyAction(who, id, p, fd), [who, id]);
  const [payKind, setPayKind] = useState<Kind | "">(kindSet ?? "");
  const shown = payKind || kind || "BANK";
  const cust = who === "customer";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={cust ? "Nomi va turini tahrirlash (naqd / perechisleniye)" : "Nomini tahrirlash"} aria-label={`${name} — tahrirlash`} className={PENCIL}>
        <Pencil size={13} />
      </button>
      {open && (
        <EditModal title={`${cust ? "Mijoz" : "Ta'minotchi"} — ${name}`} action={action} onClose={close}
          foot={cust ? "Nom o'zgarsa, eski nomi mijozning boshqa nomlariga qo'shiladi — Realizatsiya, kassa va importlar uni ham taniydi. Bir xil nomli boshqa mijoz bo'lsa saqlanmaydi (takrorni mijoz kartasida birlashtiring)." : "Bir xil nomli boshqa ta'minotchi bo'lsa saqlanmaydi."}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Nomi *" className={cust ? undefined : "sm:col-span-2"}><Input name="name" defaultValue={name} maxLength={200} required autoFocus /></Field>
            {cust && (
              <Field label="Mijoz turi">
                <input type="hidden" name="payKind" value={payKind} />
                <div className="flex h-10 rounded-lg border border-slate-300 p-0.5 text-sm">
                  {(["CASH", "BANK"] as const).map((k) => (
                    <button key={k} type="button" onClick={() => setPayKind(k)}
                      className={cn("flex-1 rounded-md font-medium transition", shown === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
                      {k === "CASH" ? "Naqd" : "Perechisleniye"}
                    </button>
                  ))}
                </div>
                {!payKind && <span className="mt-1 block text-[12px] text-slate-500">Hozir oxirgi zayavka (zayavkasi yo&apos;q bo&apos;lsa Realizatsiya qatori) bo&apos;yicha — tanlasangiz, shu qoladi</span>}
              </Field>
            )}
          </div>
          {cardHref && <Link href={cardHref} className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-600 hover:text-slate-900 hover:underline"><ExternalLink size={13} /> {cust ? "Mijoz kartasi (telefon, INN, limit, birlashtirish)" : "Ta'minotchi kartasi"}</Link>}
        </EditModal>
      )}
    </>
  );
}

export type TransferEdit = { id: string; docNo: string; date: string; debtorId: string; payerId: string; amount: number; note: string };

/**
 * «Qarzni boshqa mijoz to'ladi»: qarzdor mijoz qarzidan ayiriladi, to'lovchi mijozga yoziladi. To'lovchi puli kassaga o'z
 * nomi bilan tushadi (yoki uning avansi ishlatiladi). `edit` berilsa — mavjud hujjatni tahrirlash.
 */
export function DebtTransferButton({ customers, debtorId = "", payerId = "", edit, compact }: { customers: Opt[]; debtorId?: string; payerId?: string; edit?: TransferEdit; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const close = useCallback(() => { setOpen(false); router.refresh(); }, [router]);
  const action = useCallback<Act>((p, fd) => (edit ? updateDebtTransferAction(edit.id, p, fd) : createDebtTransferAction(p, fd)), [edit]);
  const [debtor, setDebtor] = useState(edit?.debtorId ?? debtorId);
  const [payer, setPayer] = useState(edit?.payerId ?? payerId);
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return (
    <>
      {edit
        ? <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"><Pencil size={13} /> Tahrirlash</button>
        : <button type="button" onClick={() => setOpen(true)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50", compact && "h-8 px-2.5 text-[13px]")}>
          <ArrowRightLeft size={15} /> Boshqa mijoz to&apos;lovi
        </button>}
      {open && (
        <EditModal title={edit ? `Qarz o'tkazmasi ${edit.docNo}` : "Qarzni boshqa mijoz to'ladi"} action={action} onClose={close}
          foot="Qarzdor mijoz qarzidan ayiriladi, to'lovchi mijozga yoziladi. Pul kassaga to'lovchi nomi bilan kirim qilinadi (yoki uning avansi ishlatiladi) — bu hujjat kassaga tegmaydi.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Kimning qarzi (qarzdor) *"><SearchSelect name="debtorId" options={customers} value={debtor} onChange={setDebtor} required placeholder="Mijozni yozib qidiring…" ariaLabel="Qarzdor mijoz" /></Field>
            <Field label="Kim to'ladi (to'lovchi) *"><SearchSelect name="payerId" options={customers.filter((c) => c.id !== debtor)} value={payer} onChange={setPayer} required placeholder="Mijozni yozib qidiring…" ariaLabel="To'lovchi mijoz" /></Field>
            <Field label="Summa *"><MoneyInput name="amount" defaultValue={edit ? String(edit.amount) : undefined} required ariaLabel="Summa" /></Field>
            <Field label="Sana *"><Input name="date" type="date" defaultValue={edit?.date ?? iso} max={iso} required /></Field>
            <Field label="Izoh" className="sm:col-span-2"><Input name="note" defaultValue={edit?.note} maxLength={300} placeholder="Masalan: Aziz aka Bek qurilish qarzini to'ladi" /></Field>
          </div>
        </EditModal>
      )}
    </>
  );
}

/**
 * Bekor qilish / o'chirish tugmasi — sabab so'raladi (kamida 3 belgi), server action'i bog'langan holda keladi.
 * Muvaffaqiyatdan keyin sahifa yangilanadi.
 */
export function ReasonButton({ run, label = "O'chirish", confirm }: { run: (reason: string) => Promise<ActionState>; label?: string; confirm?: string }) {
  const [ask, setAsk] = useState(false);
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!ask) return <button type="button" onClick={() => setAsk(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"><Ban size={13} /> {label}</button>;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {confirm && <span className="w-full text-[12px] text-slate-500">{confirm}</span>}
      <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Sababi" autoFocus className="h-8 w-48 text-[13px]" />
      <Button type="button" variant="secondary" className="h-8 px-2 text-[13px]" onClick={() => { setAsk(false); setError(undefined); }}>Yo&apos;q</Button>
      <Button type="button" className="h-8 bg-red-600 px-2 text-[13px] hover:bg-red-700" disabled={pending || why.trim().length < 3}
        onClick={() => start(async () => {
          const r = await run(why.trim());
          if (r?.error) setError(r.error);
          else { setAsk(false); router.refresh(); }
        })}>
        {pending ? <Loader2 size={13} className="animate-spin" /> : label}
      </Button>
      <FormError error={error} />
    </div>
  );
}
