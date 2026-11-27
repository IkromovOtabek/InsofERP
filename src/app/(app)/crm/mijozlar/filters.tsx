"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui";

/** Manba / xodim filtri — tanlanganda darhol qo'llanadi (URL parametri). */
export function FilterSelect({ name, value, placeholder, options }: { name: string; value: string; placeholder: string; options: { id: string; label: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <Select aria-label={placeholder} value={value} className="w-auto min-w-0 flex-1 sm:flex-none"
      onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        if (e.target.value) p.set(name, e.target.value); else p.delete(name);
        router.replace(`${path}${p.size ? `?${p}` : ""}`);
      }}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </Select>
  );
}
