"use client";

import { useRefreshOn } from "../_monitor/live";

/**
 * Baza/Trafik sahifalari: agent tegishli tekshiruvni yangilaganda (checkedAt) yoki shu sahifadagi amal holati
 * o'zgarganda sahifa qayta so'raladi. Katta data SSE orqali kelmaydi — faqat imzo.
 */
export function RefreshOnChecks({ prefixes, actions }: { prefixes: string[]; actions: string[] }) {
  useRefreshOn((s) =>
    s.checks.filter((c) => prefixes.some((p) => c.key.startsWith(p))).map((c) => `${c.key}:${c.checkedAt}`).join(",")
    + "|" + s.actions.filter((a) => actions.includes(a.type)).map((a) => `${a.id}:${a.status}`).join(","),
  );
  return null;
}
