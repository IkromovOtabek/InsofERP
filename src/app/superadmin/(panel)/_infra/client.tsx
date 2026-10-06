"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Power } from "lucide-react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { CONFIRM_WORD, REBOOT_AT_RE, rebootWhen } from "@/lib/control/infra/contract";
import { Modal } from "../_monitor/action-dialog";
import { useRefreshOn } from "../_monitor/live";
import { enqueueAction } from "../monitor-actions";

/** Jonli oqimda shu sahifaga tegishli tekshiruv yoki amal holati o'zgarsa sahifani qayta so'raydi. */
export function InfraRefresh({ keys, types }: { keys: string[]; types: string[] }) {
  useRefreshOn((s) =>
    s.checks.filter((c) => keys.includes(c.key)).map((c) => `${c.key}:${c.checkedAt}`).join(",") + "|" +
    s.actions.filter((a) => types.includes(a.type)).map((a) => `${a.id}:${a.status}`).join(","));
  return null;
}

/**
 * Serverni qayta yuklash: hozir (1 daqiqadan keyin) yoki HH:MM (o'tib ketgan bo'lsa — ertaga).
 * Xavfli amal: «TASDIQLAYMAN» yozish shart, server action ham tekshiradi.
 */
export function RebootButton({ hostname, disabled }: { hostname: string | null; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"now" | "at">("at");
  const [time, setTime] = useState("03:00");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();
  const at = mode === "now" ? "now" : time;
  const atOk = REBOOT_AT_RE.test(at);
  const when = atOk ? rebootWhen(at).label : "—";
  const canSend = atOk && confirm.trim() === CONFIRM_WORD;
  const close = () => { setOpen(false); setErr(undefined); setDone(undefined); setConfirm(""); };
  const send = () => start(async () => {
    setErr(undefined);
    const r = await enqueueAction("REBOOT", { at }, null, confirm);
    if (r.error) { setErr(r.error); return; }
    setDone(`Navbatga qo'yildi — server ${when} qayta yuklanadi. Telegram'ga xabar ketadi.`);
    router.refresh();
    setTimeout(close, 2000);
  });
  return (
    <>
      <Button type="button" variant="danger" size="sm" disabled={disabled} onClick={() => setOpen(true)}><Power size={14} aria-hidden /> Qayta yuklash</Button>
      <Modal open={open} onClose={close} title="Serverni qayta yuklash">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (canSend && !pending) send(); }}>
          <p className="text-sm text-slate-600">
            {hostname ? <><b data-no-translit>{hostname}</b> serveri</> : "Server"} qayta yuklanadi: barcha korxonalar, IT panel va ECO 1–3 daqiqa ishlamaydi.
            Ishlar kam bo&apos;lgan vaqtni tanlang. Bekor qilish mumkin (shu sahifada).
          </p>
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 font-medium text-slate-800">Qachon</legend>
            <label className="flex items-center gap-2"><input type="radio" name="when" checked={mode === "at"} onChange={() => setMode("at")} /> Belgilangan vaqtda</label>
            {mode === "at" && (
              <Field label="Vaqt (server vaqti, 24 soat)" hint={atOk ? `Rejalashtiriladi: ${when}` : "HH:MM"} error={time && !atOk ? "Format noto'g'ri" : undefined}>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required aria-invalid={!atOk} />
              </Field>
            )}
            <label className="flex items-center gap-2"><input type="radio" name="when" checked={mode === "now"} onChange={() => setMode("now")} /> Hozir (1 daqiqadan keyin)</label>
          </fieldset>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="mb-2 flex items-start gap-1.5 text-sm text-red-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>Tasdiqlash uchun <code className="rounded bg-white px-1 font-semibold">{CONFIRM_WORD}</code> deb yozing.</span></p>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Tasdiqlash matni" autoComplete="off" spellCheck={false} />
          </div>
          <FormError error={err} />
          {done && <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 size={16} aria-hidden /> {done}</p>}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close}>Bekor qilish</Button>
            <Button type="submit" variant="danger" disabled={!canSend || pending || !!done}>{pending ? "Yuborilmoqda…" : `Qayta yuklash (${when})`}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
