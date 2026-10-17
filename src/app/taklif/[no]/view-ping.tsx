"use client";

import { useEffect } from "react";

/** Sahifa ochilganda bir marta (brauzer sessiyasida) «ko'rildi» deb yuboradi — ERP'da menejer ko'radi. */
export function ViewPing({ no, k }: { no: string; k: string }) {
  useEffect(() => {
    const key = `taklif-seen:${no}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* maxfiy rejim — baribir yuboramiz */ }
    fetch("/api/public/taklif-view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ no, k }), keepalive: true }).catch(() => {});
  }, [no, k]);
  return null;
}
