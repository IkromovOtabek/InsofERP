"use client";

import { useActionState, useEffect, useState } from "react";
import { KeyRound, Ban } from "lucide-react";
import type { Role } from "@/generated/prisma";
import { Button, FormError, Select } from "@/components/ui";
import { grantAccess, revokeAccess } from "./actions";

/**
 * Ilova foydalanuvchisining ERP ruxsati: rol tanlab berish, rolni almashtirish, yopish.
 * `current` — hozirgi ERP roli (ruxsat berilgan bo'lsa); `employee` — zavod xodimi, roli lavozimdan (bu yerda almashmaydi).
 */
export function AppAccess({ ecoUserId, phone, current, employee, roles }: {
  ecoUserId: string; phone: string; current: Role | null; employee: boolean; roles: { value: Role; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, grant, granting] = useActionState(grantAccess.bind(null, ecoUserId, phone), undefined);
  const [rState, revoke, revoking] = useActionState(async () => revokeAccess(ecoUserId), undefined);
  const small = "px-2.5 py-1 text-xs";
  // Saqlangach forma yopiladi; xato bo'lsa ochiq qoladi va xato ostida ko'rinadi
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {!employee && <Button variant="secondary" className={small} onClick={() => setOpen(true)}><KeyRound size={14} /> {current ? "Rolni almashtirish" : "ERP'ga ruxsat"}</Button>}
        {employee && !current && <form action={grant}><input type="hidden" name="role" value={roles[0].value} /><Button variant="secondary" className={small} disabled={granting}><KeyRound size={14} /> {granting ? "…" : "Telefon bilan kirishni ulash"}</Button></form>}
        {current && (
          <form action={revoke}>
            <Button variant="secondary" className={`${small} text-red-600`} disabled={revoking} onClick={(e) => { if (!confirm("ERP'ga kirish ruxsati yopilsinmi? Ochiq sessiyalari darhol tugaydi.")) e.preventDefault(); }}>
              <Ban size={14} /> {revoking ? "…" : "Ruxsatni yopish"}
            </Button>
          </form>
        )}
        {(state?.error || rState?.error) && <FormError error={(state?.error ?? rState?.error)!} />}
      </div>
    );
  }

  return (
    <form action={grant} className="flex flex-wrap items-center gap-1.5">
      <Select name="role" defaultValue={current ?? ""} required className="h-8 w-44 py-0 text-xs">
        <option value="" disabled>Rolni tanlang…</option>
        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </Select>
      <Button className={small} disabled={granting}>{granting ? "…" : "Saqlash"}</Button>
      <Button type="button" variant="secondary" className={small} onClick={() => setOpen(false)}>Bekor</Button>
      {state?.error && <FormError error={state.error} />}
    </form>
  );
}
