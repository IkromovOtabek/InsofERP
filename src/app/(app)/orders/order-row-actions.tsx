"use client";

import Link from "next/link";
import { Pencil, XCircle } from "lucide-react";
import { ConfirmButton } from "../payments/confirm-button";
import { cancelOrder } from "./actions";
import { cn } from "@/lib/utils";

/**
 * Zayavka qatoridagi qalam (`/orders/[id]/edit`) va «Bekor qilish» — kartadagi tugmalar bilan bir xil server amali.
 * Ko'rinish sharti (`edit`/`cancel`) serverda `row-flags.ts` bilan hisoblanadi. Bekor qilingan zayavka tizimdan o'chadi —
 * ro'yxat yangilanadi va qator yo'qoladi.
 */
export function OrderRowActions({ id, edit, cancel, subject, className }: {
  id: string; edit: boolean; cancel: boolean;
  /** Savoldagi nom: «Zayavka (Mijoz)» yoki «Sklad zayavkasi» */
  subject: string;
  className?: string;
}) {
  if (!edit && !cancel) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-0.5 print:hidden", className)}>
      {edit && (
        <Link href={`/orders/${id}/edit`} title="Tahrirlash" aria-label={`${subject} — tahrirlash`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-800">
          <Pencil size={14} />
        </Link>
      )}
      {cancel && (
        <ConfirmButton action={(why) => cancelOrder(id, why)} reason="required" label="" title="Bekor qilish" icon={<XCircle size={14} />}
          question={`${subject} bekor qilinsinmi? Zayavka tizimdan butunlay o'chiriladi.`} okText="Bekor qilindi" className="h-7 px-1.5" />
      )}
    </span>
  );
}
