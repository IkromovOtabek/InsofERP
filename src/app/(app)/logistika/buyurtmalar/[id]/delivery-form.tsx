"use client";

import { useActionState } from "react";
import { Truck } from "lucide-react";
import { Button, Card, CardHeader, Checkbox, Field, FormActions, FormError, Input, LinkButton, Textarea } from "@/components/ui";
import { AddressPicker, type SavedPlace } from "@/components/address-picker";
import { isoDate } from "@/lib/format";
import { editOrderDelivery } from "../actions";
import { blockEnterSubmit, submitKeepingState } from "../../../orders/order-form";

export type DeliveryData = {
  id: string; deliveryDate: string; dateUnknown: boolean; deliveryTime: string;
  deliveryAddress: string; lat: number | null; lng: number | null; needsPump: boolean; isUrgent: boolean; note: string;
};

/** Logistika: yetkazish ma'lumotlari (sana, soat, obyekt, nasos, shoshilinch, izoh). Xato qaytsa kiritilgani o'chmaydi. */
export function DeliveryForm({ data, sites, geoSearch }: { data: DeliveryData; sites: SavedPlace[]; geoSearch: boolean }) {
  const [state, action, pending] = useActionState(editOrderDelivery.bind(null, data.id), undefined);
  const today = isoDate();
  return (
    <form onSubmit={submitKeepingState(action)} onKeyDown={blockEnterSubmit} className="space-y-5">
      <FormError error={state?.error} />
      <Card>
        <CardHeader icon={Truck} title="Yetkazish" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Yetkazish sanasi">
            <Input name="deliveryDate" type="date" required defaultValue={data.dateUnknown ? "" : data.deliveryDate} min={!data.dateUnknown && data.deliveryDate < today ? undefined : today} />
          </Field>
          <Field label="Soat" hint="Bo'sh — kun davomida">
            <Input name="deliveryTime" type="time" defaultValue={data.deliveryTime} />
          </Field>
          <div className="sm:col-span-2">
            <AddressPicker searchEnabled={geoSearch} required label="Obyekt" defaultAddress={data.deliveryAddress} defaultLat={data.lat} defaultLng={data.lng} saved={sites} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
            <Checkbox name="needsPump" label="Nasos kerak" defaultChecked={data.needsPump} />
            <Checkbox name="isUrgent" label="Zarur (shoshilinch)" defaultChecked={data.isUrgent} />
          </div>
        </div>
      </Card>
      <Card>
        <Field label="Izoh"><Textarea name="note" defaultValue={data.note} rows={3} /></Field>
        <FormActions>
          <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
          <LinkButton href="/logistika/buyurtmalar" variant="secondary">Bekor</LinkButton>
        </FormActions>
      </Card>
    </form>
  );
}
