"use client";

import { useActionState } from "react";
import { Link2, RefreshCw, UserPlus, Truck, Send } from "lucide-react";
import { Button, FormError, FormSuccess } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { linkDriver, linkAllDrivers, importEcoDriver, syncVehicles, resendPendingTrips } from "./actions";

const ICON = { link: Link2, all: RefreshCw, import: UserPlus, vehicles: Truck, trips: Send } as const;

/** Bitta tugmali forma: natija (xato/ok) tugma ostida chiqadi. */
function ActionButton({ action, label, icon, variant = "secondary", small = true, done = "Bajarildi" }: {
  action: (prev: ActionState) => Promise<ActionState>; label: string; icon: keyof typeof ICON; variant?: "primary" | "secondary"; small?: boolean; done?: string;
}) {
  const [state, run, pending] = useActionState(async (prev: ActionState) => action(prev), undefined);
  const Icon = ICON[icon];
  return (
    <form action={run} className="inline-flex flex-col items-start gap-1">
      <Button variant={variant} disabled={pending} className={small ? "px-2.5 py-1 text-xs" : undefined}><Icon size={14} /> {pending ? "…" : label}</Button>
      {state?.error && <FormError error={state.error} />}
      {state?.ok && <FormSuccess text={done} />}
    </form>
  );
}

export const LinkDriverButton = ({ employeeId, relink }: { employeeId: string; relink?: boolean }) =>
  <ActionButton action={() => linkDriver(employeeId)} label={relink ? "Qayta ulash" : "ECO'ga ulash"} icon="link" done="Ulandi" />;
export const LinkAllButton = () => <ActionButton action={() => linkAllDrivers()} label="Hammasini ulash" icon="all" variant="primary" small={false} done="Hammasi ulandi" />;
export const ImportDriverButton = ({ userId, fullName, phone }: { userId: string; fullName: string; phone: string }) =>
  <ActionButton action={() => importEcoDriver(userId, fullName, phone)} label="Xodim qilib qo'shish" icon="import" done="Qo'shildi" />;
export const SyncVehiclesButton = () => <ActionButton action={() => syncVehicles()} label="Texnikani ECO'ga yuborish" icon="vehicles" small={false} done="Yuborildi" />;
export const ResendTripsButton = () => <ActionButton action={() => resendPendingTrips()} label="Reyslarni qayta yuborish" icon="trips" small={false} done="Yuborildi" />;
