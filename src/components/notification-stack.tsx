"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, ChevronUp, ClipboardList, HardHat, ShoppingBasket, Truck, Wallet, Warehouse, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { dateTime } from "@/lib/format";
import type { WebNotification } from "@/lib/web-notifications";

/**
 * O'ng tepadagi bildirishnomalar oqimi: kirgandan keyin ham, ish paytida ham keladi, ketma-ket yig'iladi va
 * «Tozalash» bosilmaguncha yo'qolmaydi. Kartochka bosilsa — o'sha amal sahifasi. «Yig'ish» faqat ekrandan
 * olib turadi (qo'ng'iroqcha bosilsa qaytadi); yangi xabar kelsa oqim o'zi yana ochiladi.
 * Ma'lumot `/api/notifications` dan, har 20 soniyada va oynaga qaytilganda (LiveRefresh uslubida).
 */

const EVERY_MS = 20_000;
type Data = { unread: number; rows: WebNotification[] };

/** Turi bo'yicha ikonka va urg'u: bekor/blok/muammo — qizil, qolgani — ko'k. */
function look(type: string): { Icon: LucideIcon; alert: boolean } {
  const alert = /CANCEL|BLOCK|PROBLEM|ISSUE|ALERT|REJECT|LATE|OVERDUE|DECLIN|FAIL/.test(type);
  const Icon = alert ? TriangleAlert
    : type.startsWith("ORDER") ? ClipboardList
    : type.startsWith("TRIP") ? Truck
    : /PAY|CASH|SALARY|INVOICE/.test(type) ? Wallet
    : /SUPPLY|PROCUR/.test(type) ? ShoppingBasket
    : /TASK|BRIG|PROD/.test(type) ? HardHat
    : /STOCK|RECEIPT|SHIP|KIRIM/.test(type) ? Warehouse
    : /HR|EMP|ATTEND|LEAVE|SURVEY/.test(type) ? Users
    : Bell;
  return { Icon, alert };
}

export function NotificationStack() {
  const router = useRouter();
  const [data, setData] = useState<Data>({ unread: 0, rows: [] });
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);

  const apply = useCallback((d: Data) => {
    // Yangi xabar keldi — yig'ilgan oqim qayta ochiladi (birinchi yuklashda yig'ish holati o'zgarmaydi)
    if (seen.current && d.rows.some((r) => !seen.current!.has(r.id))) setHidden(false);
    seen.current = new Set(d.rows.map((r) => r.id));
    setData(d);
  }, []);

  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) apply(await res.json());
    } catch { /* tarmoq uzilgan — keyingi urinishda */ }
  }, [apply]);

  useEffect(() => {
    void load();
    const id = setInterval(load, EVERY_MS);
    document.addEventListener("visibilitychange", load);
    window.addEventListener("online", load);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", load); window.removeEventListener("online", load); };
  }, [load]);

  const clear = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) apply(await res.json());
    } finally { setBusy(false); }
  };

  const open = (n: WebNotification) => {
    if (!n.href) return;
    setOpened((s) => new Set(s).add(n.id));
    router.push(n.href);
  };

  const { unread, rows } = data;
  const more = unread - rows.length;

  return (
    <>
      <button type="button" onClick={() => setHidden((h) => !h)} title="Bildirishnomalar" aria-label={`Bildirishnomalar: ${unread} ta`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 pointer-coarse:h-11 pointer-coarse:w-11">
        {unread ? <BellRing size={17} /> : <Bell size={17} />}
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[18px] text-white tabular">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {!hidden && rows.length > 0 && (
        <div role="region" aria-label="Bildirishnomalar" className="fixed right-3 top-16 z-40 flex max-h-[calc(100dvh-5rem)] w-[min(380px,calc(100vw-1.5rem))] flex-col print:hidden sm:right-4">
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 shadow-sm backdrop-blur">
            <span className="text-xs font-semibold text-slate-700">Bildirishnomalar · {unread}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={clear} disabled={busy} className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">{busy ? "Tozalanmoqda…" : "Tozalash"}</button>
              <button type="button" onClick={() => setHidden(true)} title="Yig'ish" aria-label="Yig'ish" className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ChevronUp size={14} /></button>
            </div>
          </div>
          <ol className="flex flex-col gap-2 overflow-y-auto overscroll-contain pb-1">
            {rows.map((n) => {
              const { Icon, alert } = look(n.type);
              const done = opened.has(n.id);
              return (
                <li key={n.id} className="animate-[notif-in_.25s_ease-out]">
                  <button type="button" onClick={() => open(n)} disabled={!n.href}
                    className={cn("flex w-full items-start gap-3 rounded-xl border bg-white px-3.5 py-2.5 text-left shadow-md transition",
                      alert ? "border-red-200 border-l-4 border-l-red-500" : "border-slate-200 border-l-4 border-l-blue-500",
                      n.href ? "cursor-pointer hover:-translate-x-0.5 hover:shadow-lg" : "cursor-default",
                      done && "opacity-60")}>
                    <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", alert ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600")}><Icon size={15} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-slate-900">{n.title}</span>
                      <span className="line-clamp-2 block text-xs text-slate-600">{n.body}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400 tabular">{dateTime(new Date(n.at))}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {more > 0 && <li className="rounded-lg bg-white/90 px-3 py-1.5 text-center text-xs text-slate-500 shadow-sm">yana {more} ta — «Tozalash» hammasini o&apos;qilgan qiladi</li>}
          </ol>
        </div>
      )}
    </>
  );
}
