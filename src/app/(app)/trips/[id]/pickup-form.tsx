"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { AddressPicker } from "@/components/address-picker";
import { Button, FormError, FormSuccess } from "@/components/ui";
import { saveTripPickup } from "../actions";

/**
 * "Yuklandi" bosqichidagi "Yukni olgani joyi": mikser betonni qayerdan olgani.
 *
 * Nuqtasi bilan saqlanadi — haydovchi ilovasida marshrut shu yerdan boshlanadi,
 * nakladnoyda esa "qayerdan chiqdi" ko'rinadi. Sukut bo'yicha zavod joyi qo'yiladi,
 * chunki reyslarning ko'pchiligi zavoddan chiqadi.
 */
export function PickupForm({ tripId, searchEnabled, address, lat, lng }: {
  tripId: string;
  searchEnabled: boolean;
  address: string;
  lat: number | null;
  lng: number | null;
}) {
  const [state, action, pending] = useActionState(saveTripPickup.bind(null, tripId), undefined);
  return (
    <form action={action} className="space-y-3">
      <AddressPicker
        searchEnabled={searchEnabled}
        required
        name="pickupAddress"
        latName="pickupLat"
        lngName="pickupLng"
        label="Yuk qayerdan olindi"
        placeholder="Zavod, ikkinchi maydon, sklad…"
        showDistance={false}
        className=""
        defaultAddress={address}
        defaultLat={lat}
        defaultLng={lng}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}><Save size={16} /> Saqlash</Button>
        <FormSuccess text={state?.ok ? "Yuk olgan joyi saqlandi" : undefined} />
      </div>
      <FormError error={state?.error} />
    </form>
  );
}
