"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Ban, CheckCheck, PackageCheck } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { cn } from "@/lib/utils";
import { acceptShipmentAction, rejectShipmentAction } from "../actions";
import { Badge, Button, FormError, FormSuccess, Input, Table, Td, Th, Tr } from "@/components/ui";

export type PanelItem = {
  id: string; name: string; code: string | null; isNew: boolean; category: string; unit: string; qty: number; price: number;
  status: "PENDING" | "ACCEPTED" | "REJECTED"; acceptedQty: number | null; rejectReason: string | null;
  receipt: { id: string; docNo: string } | null; decidedBy: string | null; decidedAt: string | null;
};

const ST = { PENDING: { label: "Kutmoqda", color: "amber" }, ACCEPTED: { label: "Qabul qilindi", color: "green" }, REJECTED: { label: "Rad etildi", color: "red" } } as const;
const num = (v: string) => Number(v.replace(/\s+/g, "").replace(",", "."));

/**
 * Jo'natma qatorlari. Sklad (`canAccept`) kutayotgan qatorlarni belgilab, sanab chiqilgan fakt miqdor bilan qabul qiladi
 * yoki sabab yozib rad etadi; boshqalar (snabjenets) — faqat holatni ko'radi.
 */
export function ItemsPanel({ shipmentId, items, canAccept }: { shipmentId: string; items: PanelItem[]; canAccept: boolean }) {
  const [acc, accept, accepting] = useActionState(acceptShipmentAction, undefined);
  const [rej, reject, rejecting] = useActionState(rejectShipmentAction, undefined);
  const pendingItems = items.filter((i) => i.status === "PENDING");
  const [sel, setSel] = useState<Set<string>>(() => new Set(pendingItems.map((i) => i.id)));
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(pendingItems.map((i) => [i.id, String(i.qty)])));
  const [rejectMode, setRejectMode] = useState(false);
  const busy = accepting || rejecting;
  const live = canAccept && pendingItems.length > 0;

  const allOn = pendingItems.length > 0 && pendingItems.every((i) => sel.has(i.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allOn ? new Set() : new Set(pendingItems.map((i) => i.id)));
  const chosen = pendingItems.filter((i) => sel.has(i.id));
  const chosenSum = chosen.reduce((s, i) => s + (num(qty[i.id] ?? "") || 0) * i.price, 0);
  const short = chosen.filter((i) => (num(qty[i.id] ?? "") || 0) < i.qty);
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);

  return (
    <form className="space-y-3">
      <input type="hidden" name="id" value={shipmentId} />
      {chosen.map((i) => <input key={i.id} type="hidden" name="item" value={i.id} />)}
      <FormError error={acc?.error ?? rej?.error} />
      <FormSuccess text={acc?.ok ? acc.note : rej?.ok ? rej.note : undefined} />

      <Table>
        <thead>
          <tr>
            {live && <Th className="w-10"><input type="checkbox" aria-label="Hammasini belgilash" checked={allOn} onChange={toggleAll} className="h-4 w-4 accent-slate-900" /></Th>}
            <Th>Mahsulot</Th><Th>Kategoriya</Th><Th right>Jo&apos;natildi</Th><Th right>{live ? "Qabul (fakt)" : "Qabul qilindi"}</Th><Th right>Narx</Th><Th right>Summa</Th><Th>Holat</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const pending = i.status === "PENDING";
            const on = sel.has(i.id);
            const f = num(qty[i.id] ?? "");
            return (
              <Tr key={i.id} className={cn(live && pending && on && "bg-emerald-50/50", !pending && "text-slate-500")}>
                {live && <Td>{pending && <input type="checkbox" aria-label={`${i.name} — belgilash`} checked={on} onChange={() => toggle(i.id)} className="h-4 w-4 accent-slate-900" />}</Td>}
                <Td>
                  <div className="font-medium text-slate-900">{i.name}</div>
                  <div className="text-xs text-slate-500">{i.isNew ? <span className="text-brand-700">Yangi mahsulot — qabulda spravochnikka qo&apos;shiladi</span> : i.code}</div>
                </Td>
                <Td><Badge color="slate" dot={false}>{i.category}</Badge></Td>
                <Td right>{fmtNum(i.qty, 3)} {unitLabel(i.unit)}</Td>
                <Td right>
                  {live && pending ? (
                    <div className="ml-auto flex w-36 items-center gap-1">
                      <Input name={`qty_${i.id}`} aria-label={`${i.name} — fakt miqdor`} inputMode="decimal" value={qty[i.id] ?? ""} disabled={!on}
                        onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))} className={cn("h-9 text-right", on && f < i.qty && "border-amber-400")} />
                      <span className="w-6 text-xs text-slate-500">{unitLabel(i.unit)}</span>
                    </div>
                  ) : i.acceptedQty != null ? (
                    <span className={i.acceptedQty < i.qty ? "font-medium text-amber-700" : undefined}>{fmtNum(i.acceptedQty, 3)} {unitLabel(i.unit)}</span>
                  ) : "—"}
                </Td>
                <Td right>{fmtNum(i.price)}</Td>
                <Td right>{fmtNum((i.acceptedQty ?? i.qty) * i.price)}</Td>
                <Td>
                  <Badge color={ST[i.status].color}>{ST[i.status].label}</Badge>
                  {i.receipt && <div className="mt-1 text-xs"><Link href={`/receipts/${i.receipt.id}`} className="underline">{i.receipt.docNo}</Link></div>}
                  {i.rejectReason && <div className="mt-1 max-w-48 text-xs text-red-600">{i.rejectReason}</div>}
                  {i.decidedBy && <div className="text-xs text-slate-400">{i.decidedBy} · {i.decidedAt}</div>}
                </Td>
              </Tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <Td colSpan={live ? 6 : 5} className="text-right font-medium">Jami (QQS&apos;siz)</Td>
            <Td right className="font-semibold text-slate-900">{fmtNum(total)}</Td>
            <Td />
          </tr>
        </tfoot>
      </Table>

      {live && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-slate-200 bg-white/95 p-3 shadow-(--shadow-pop) backdrop-blur">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-slate-900">Belgilangan: {chosen.length} / {pendingItems.length} qator · {fmtNum(chosenSum)} so&apos;m</div>
            <div className="text-xs text-slate-500">
              {short.length ? `${short.length} qatorda miqdor kam — snabjenetsga xabar boradi. ` : ""}
              Belgilanmaganlar kutishda qoladi — keyin qabul qilasiz yoki rad etasiz.
            </div>
          </div>
          {rejectMode ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Input name="reason" placeholder="Rad etish sababi (masalan: sifatsiz, kelmadi)" className="sm:w-72" autoFocus />
              <Button variant="danger" formAction={reject} disabled={busy || !chosen.length}><Ban size={16} /> {rejecting ? "Yozilmoqda…" : `${chosen.length} qatorni rad etish`}</Button>
              <Button type="button" variant="ghost" onClick={() => setRejectMode(false)}>Bekor</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setRejectMode(true)} disabled={busy || !chosen.length}><Ban size={16} /> Rad etish</Button>
              <Button variant="success" formAction={accept} disabled={busy || !chosen.length}>
                {allOn ? <CheckCheck size={16} /> : <PackageCheck size={16} />}
                {accepting ? "Qabul qilinmoqda…" : allOn ? "Hammasini qabul qilish" : `${chosen.length} qatorni qabul qilish`}
              </Button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
