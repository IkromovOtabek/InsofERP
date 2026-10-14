"use client";

import { useActionState } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import { setEmployeeAnywhere } from "../../otdel-kadr/actions";
import { Badge, Button, FormError, FormSuccess } from "@/components/ui";

/**
 * Xodim kartasi → «Hududdan tashqarida davomat» kaliti. Qiymat aniq yuboriladi (yoqish / o'chirish), almashtirilmaydi —
 * ikki marta bosilsa ham natija bir xil. `canEdit` — faqat otdel kadr va direktor; boshqalar holatni ko'radi.
 */
export function AnywhereSwitch({ employeeId, on, canEdit }: { employeeId: string; on: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState(setEmployeeAnywhere.bind(null, employeeId, !on), undefined);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {on ? <Badge color="violet">Ruxsat berilgan</Badge> : <Badge>Faqat ish hududida</Badge>}
        {canEdit && (
          <form action={action}>
            <Button
              size="sm"
              variant={on ? "secondary" : "primary"}
              disabled={pending}
              role="switch"
              aria-checked={on}
              aria-label="Hududdan tashqarida davomat"
            >
              {on ? <MapPinOff size={14} /> : <MapPin size={14} />}
              {on ? "Ruxsatni olish" : "Ruxsat berish"}
            </Button>
          </form>
        )}
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </div>
  );
}
