"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Callout } from "@/components/ui";

/** 2FA yoqilmagan admin uchun har sahifa tepasida eslatma (IT jamoasi sahifasining o'zida — ko'rsatilmaydi). */
export function TwoFactorNudge() {
  const path = usePathname();
  if (path.startsWith("/superadmin/adminlar")) return null;
  return (
    <Callout tone="warning" title="Ikki bosqichli kirish (2FA) yoqilmagan">
      Panel serverni qayta yuklaydi va deploy qiladi — faqat parol bilan himoya yetarli emas.{" "}
      <Link href="/superadmin/adminlar#xavfsizlik" className="font-semibold underline underline-offset-2">IT jamoasi → Mening hisobim</Link> bo&apos;limida yoqing (1 daqiqa).
    </Callout>
  );
}
