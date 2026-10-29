"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markAvtoSeen } from "./actions";

/** Sahifa ko'rilgach avto zapchast xabarlari o'qilgan deb belgilanadi (render paytida emas — prefetch belgilab yubormasin). */
export function SeenMarker({ unread }: { unread: number }) {
  const router = useRouter();
  useEffect(() => {
    if (unread > 0) void markAvtoSeen().then(() => router.refresh());
  }, [unread, router]);
  return null;
}
