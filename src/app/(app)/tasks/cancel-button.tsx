"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";

/**
 * Topshiriqni bekor qilish: birinchi bosishda "Rostdan?" deb so'raydi, ikkinchisida yuboradi
 * (`DeleteButton` kabi) — bitta tasodifiy bosish brigadaning ishini to'xtatib qo'ymasin.
 */
export function CancelTaskButton({ action }: { action: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  if (!armed) {
    return <Button variant="ghost" className="h-8 px-2 text-xs text-red-600 hover:bg-red-50" onClick={() => setArmed(true)}>Bekor</Button>;
  }
  return (
    <span className="flex items-center gap-1">
      <Button variant="danger" className="h-8 px-2 text-xs" disabled={pending} onClick={() => start(async () => { await action(); setArmed(false); })}>
        {pending ? "…" : "Bekor qilinsinmi?"}
      </Button>
      <Button variant="ghost" className="h-8 px-2 text-xs" disabled={pending} onClick={() => setArmed(false)}>Yo&apos;q</Button>
    </span>
  );
}
