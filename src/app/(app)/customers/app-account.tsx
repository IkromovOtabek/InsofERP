"use client";

import { useState, useTransition } from "react";
import { Smartphone, Search, Link2, CheckCircle2, Clock, WifiOff } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui";
import { date } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EcoUnlinkedCustomer } from "@/lib/eco/client";
import type { AppStatus } from "@/lib/eco/customers";
import { linkAppAccount, searchAppCandidates } from "./app-actions";

/**
 * Mijoz kartasidagi "Ilova hisobi" bo'limi.
 *
 * Ulangan bo'lsa — kim ro'yxatdan o'tgan (parol qo'ygan), kim faqat taklif qilingan (SMS kutilmoqda).
 * Ulanmagan bo'lsa — ilovada o'zi ro'yxatdan o'tgan mijozlar orasidan izlab "Ulash" tugmasi.
 * Ulangach mijoz ilovada shu kartaning zayavkalarini, reyslarini va mashina qayerda ekanini ko'radi.
 */
export function AppAccount({ customerId, phone, initial, canLink }: { customerId: string; phone: string | null; initial: AppStatus; canLink: boolean }) {
  const [status, setStatus] = useState<AppStatus>(initial);
  const [q, setQ] = useState(phone ?? "");
  const [items, setItems] = useState<EcoUnlinkedCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [linking, startLink] = useTransition();

  if (!status.available) {
    return (
      <div className="flex items-start gap-2 text-sm text-slate-500">
        <WifiOff size={16} className="mt-0.5 shrink-0" />
        <div>
          {status.reason === "disabled" ? "Insof ECO ilovasi ulanmagan — mijoz ilova hisobi ko'rinmaydi." : `Ilova serveri javob bermadi: ${status.message}`}
        </div>
      </div>
    );
  }

  const search = () => start(async () => {
    setError(null);
    const r = await searchAppCandidates(q);
    setItems(r.items);
    if (r.error) setError(r.error);
  });

  const link = (org: EcoUnlinkedCustomer) => {
    const who = org.members.map((m) => m.fullName ?? m.phone).join(", ");
    if (!confirm(`"${org.name}" (${who}) hisobiga ulansinmi?\nMijoz ilovada shu kartaning zayavkalari va reyslarini ko'radi.`)) return;
    startLink(async () => {
      setError(null);
      const r = await linkAppAccount(customerId, org.id);
      if (!r.ok) { setError(r.error); return; }
      setStatus({ available: true, ...r.status });
      setItems(null);
    });
  };

  const registered = status.linked ? status.members.filter((m) => m.registered) : [];
  const invited = status.linked ? status.members.filter((m) => !m.registered) : [];

  return (
    <div className="space-y-3 text-sm">
      {status.linked && registered.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="flex items-center gap-2 font-medium text-emerald-800"><CheckCircle2 size={16} /> Ilovaga ulangan</div>
          <ul className="mt-2 space-y-1">
            {registered.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium text-slate-900">{m.fullName ?? "Ism kiritilmagan"}</span> <span className="text-slate-500">{m.phone}</span></span>
                <span className="text-xs text-slate-500">{m.lastLoginAt ? `oxirgi kirish ${date(new Date(m.lastLoginAt))}` : "hali kirmagan"}{!m.isActive && " · bloklangan"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-emerald-800/80">Mijoz ilovada zayavkalarini, reyslarini va mashina qayerda ekanini ko&apos;radi.</p>
        </div>
      )}
      {status.linked && invited.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex items-center gap-2 font-medium text-amber-800"><Clock size={16} /> Taklif yuborilgan, hali ro&apos;yxatdan o&apos;tmagan</div>
          <ul className="mt-1 text-slate-700">{invited.map((m) => <li key={m.userId}>{m.phone}{m.fullName ? ` — ${m.fullName}` : ""}</li>)}</ul>
          <p className="mt-2 text-xs text-amber-800/80">Mijoz Insof ECO ilovasida shu telefon raqami bilan ro&apos;yxatdan o&apos;tsa hisob o&apos;zi ulanadi va sizga bildirishnoma keladi.</p>
        </div>
      )}
      {status.linked && status.members.length === 0 && (
        <div className="flex items-start gap-2 text-slate-600"><Smartphone size={16} className="mt-0.5 shrink-0" /> Mijoz ilovada bor, lekin telefon raqami yo&apos;q — kartaga telefon kiriting, mijoz shu raqam bilan ilovaga kirsa hisob ulanadi.</div>
      )}
      {!status.linked && (
        <div className="flex items-start gap-2 text-slate-600"><Smartphone size={16} className="mt-0.5 shrink-0" /> Mijoz ilovaga hali ulanmagan. Telefon raqami bo&apos;lsa saqlangach o&apos;zi ulanadi; mijoz ilovada boshqa raqam bilan ro&apos;yxatdan o&apos;tgan bo&apos;lsa, pastdan izlab ulang.</div>
      )}

      {canLink && (
        <div className={cn("rounded-lg border border-dashed border-slate-300 p-3", status.linked && registered.length > 0 && "opacity-80")}>
          <div className="mb-2 text-xs font-medium text-slate-600">{status.linked && registered.length > 0 ? "Boshqa ilova hisobiga ulash" : "Ilovada ro'yxatdan o'tgan mijozni izlash"}</div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Telefon, ism yoki INN" />
            <Button type="submit" variant="secondary" disabled={pending}><Search size={14} /> {pending ? "Izlanmoqda…" : "Izlash"}</Button>
          </form>
          {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
          {items && items.length === 0 && !error && <div className="mt-2 text-xs text-slate-500">Topilmadi. Mijoz ilovada hali ro&apos;yxatdan o&apos;tmagan yoki boshqa mijozga ulangan.</div>}
          {items && items.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {items.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <div className="font-medium text-slate-900">{o.name}{o.inn && <span className="ml-2 text-xs text-slate-500">INN {o.inn}</span>}</div>
                    <div className="text-xs text-slate-500">
                      {o.members.map((m) => `${m.fullName ?? "Ism yo'q"} ${m.phone}${m.registered ? "" : " (parolsiz)"}`).join(" · ")}
                      {" · "}ro&apos;yxatdan {date(new Date(o.createdAt))}
                      {o.ordersHere > 0 && <> · <Badge color="blue" dot={false}>{o.ordersHere} buyurtma bergan</Badge></>}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => link(o)} disabled={linking}><Link2 size={14} /> Ulash</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
