"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { assignBrigades } from "./assign-actions";
import { Button, FormError, FormSuccess, Select, Td, Th, Tr } from "@/components/ui";

type Item = { id: string; product: string; qty: string; unit: string; taskNo: string | null; brigade: string | null };
type Brigade = { id: string; name: string; leader: string | null };

export function AssignForm({ orderId, items, brigades }: { orderId: string; items: Item[]; brigades: Brigade[] }) {
  const [state, action, pending] = useActionState(assignBrigades.bind(null, orderId), undefined);
  const open = items.filter((i) => !i.taskNo);
  return (
    <form action={action}>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text="Topshiriqlar brigadalarga yuborildi" />}
      <table className="w-full text-sm">
        <thead><tr><Th>Mahsulot</Th><Th right>Miqdor</Th><Th>Brigada</Th></tr></thead>
        <tbody>
          {items.map((i) => (
            <Tr key={i.id}>
              <Td className="font-medium">{i.product}</Td>
              <Td right>{i.qty} {i.unit}</Td>
              <Td>
                {i.taskNo ? (
                  <span className="text-xs text-slate-500">{i.brigade} · topshiriq {i.taskNo} yuborilgan</span>
                ) : (
                  <Select name={`brigade_${i.id}`} defaultValue="" className="h-9 max-w-xs text-sm">
                    <option value="">Tanlang…</option>
                    {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}{b.leader ? ` · ${b.leader}` : ""}</option>)}
                  </Select>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </table>
      {open.length > 0 && (
        <div className="flex items-center justify-end gap-3 px-5 py-4">
          <span className="text-xs text-slate-500">Tasdiqlangach tanlangan qatorlar topshiriq bo&apos;lib brigadalarga yuboriladi</span>
          <Button disabled={pending || brigades.length === 0} variant="success"><Send size={16} /> {pending ? "Yuborilmoqda…" : "Tasdiqlash — brigadalarga yuborish"}</Button>
        </div>
      )}
    </form>
  );
}
