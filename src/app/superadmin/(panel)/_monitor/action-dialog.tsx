"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, Ban, Bot, CheckCircle2, DatabaseBackup, Eye, Lock, Power, RefreshCw, Rocket, RotateCcw, ScanSearch, Trash2, Wrench, XCircle } from "lucide-react";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";
import { IPV4_RE, UNIT_RE } from "@/lib/control/monitor/contract";
import { actionLabel, confirmPhrase, needsReauth } from "@/lib/control/monitor/shared";
import { DB_ACTION_DESCR } from "@/lib/control/dbtraffic/contract";
import { INFRA_ACTION_DESCR } from "@/lib/control/infra/contract";
import { BottomSheet } from "../../_ui/sheet";
import { ackIncident, enqueueAction, resolveIncident } from "../monitor-actions";
import { actionHelpId } from "@/lib/control/help-content";
import { HelpButton } from "../_help/help";

/** Sahifa ichidagi dialog (window.confirm emas): kompyuterda oyna, telefonda pastdan varaq (_ui/sheet). */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  return <BottomSheet open={open} onClose={onClose} title={title} wide={wide}>{children}</BottomSheet>;
}

/**
 * Xavfli amal uchun joriy parolni qayta kiritish (REAUTH_ACTIONS). Qiymat faqat server action argumenti sifatida ketadi
 * va dialog yopilganda tozalanadi — hech qayerda saqlanmaydi.
 */
export function PasswordBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Joriy parolingiz" hint="Xavfli amal — shaxsingizni tasdiqlash uchun parolni qayta kiriting">
      <Input type="password" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="current-password" required maxLength={200} />
    </Field>
  );
}

const DESCR: Record<string, string> = {
  RESTART_UNIT: "Xizmat 5–30 soniya javob bermaydi. Ochiq sahifalar qayta yuklanadi.",
  RELOAD_NGINX: "Nginx sozlamasi tekshirilib, uzilishsiz qayta o'qiladi.",
  RUN_BACKUP: "Barcha bazalarning zaxira nusxasi olinadi (bir necha daqiqa, server yuklamasi oshadi).",
  RENEW_CERT: "Let's Encrypt sertifikatlari yangilanadi va nginx qayta o'qiydi. Xato bo'lsa sayt HTTPS'siz qolishi mumkin.",
  FIX_SECRET_PERMS: "tenants/*.env, control.env, build.env fayllari faqat egasi o'qiydigan (600) bo'ladi.",
  BLOCK_IP: "Bu manzildan serverga barcha ulanishlar (veb, SSH) to'siladi.",
  UNBLOCK_IP: "Manzil blokdan chiqariladi.",
  RUN_HEALTH_CHECK: "Agent barcha tekshiruvlarni navbatdan tashqari bajaradi.",
  RUN_SECURITY_SCAN: "Ochiq portlar, SSH, fayl huquqlari, yangilanishlar va loglar tekshiriladi.",
  RUN_AI_ANALYSIS: "Topilmalar AI'ga beriladi va baho (A–F) bilan hisobot tuziladi.",
  ...DB_ACTION_DESCR,
  ...INFRA_ACTION_DESCR,
};

/** Ikonka nomi bilan (server sahifadan komponent funksiyasini klientga berib bo'lmaydi). */
const ICONS = { archive: Archive, ban: Ban, bot: Bot, lock: Lock, refresh: RefreshCw, restart: RotateCcw, scan: ScanSearch, wrench: Wrench, database: DatabaseBackup, power: Power, rocket: Rocket, trash: Trash2 };
export type ActionIcon = keyof typeof ICONS;

/**
 * Agentga amal so'rovi tugmasi: modal oynada tasdiq. Xavfli amallarda (IP bloklash, korxona xizmatini qayta
 * ishga tushirish, SSL yangilash) qiymatni qo'lda yozish shart — server ham aynan shuni tekshiradi.
 * Parametr berilmagan bo'lsa (masalan AI tavsiyasida IP yo'q) — oynada maydon chiqadi.
 */
export function ActionButton({ type, params = {}, incidentId, label, icon, variant = "secondary", size = "sm", disabled, className }: {
  type: string; params?: Record<string, unknown>; incidentId?: string | null; label?: string; icon?: ActionIcon;
  variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; disabled?: boolean; className?: string;
}) {
  const Icon = icon ? ICONS[icon] : null;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();
  const reauth = needsReauth(type);
  // To'liq enli tugma (telefon varag'ida) — «?» yonida, tugma qolgan joyni egallaydi
  const fullW = !!className?.split(/\s+/).includes("w-full");
  const needs: "ip" | "unit" | null = type === "BLOCK_IP" || type === "UNBLOCK_IP" ? (typeof params.ip === "string" ? null : "ip") : type === "RESTART_UNIT" ? (typeof params.unit === "string" ? null : "unit") : null;
  const full = needs ? { ...params, [needs]: input.trim() } : params;
  const phrase = confirmPhrase(type, full);
  const inputOk = !needs || (needs === "ip" ? IPV4_RE : UNIT_RE).test(input.trim());
  const canSend = inputOk && (phrase === null || (phrase !== "" && confirm.trim() === phrase)) && (!reauth || password.length > 0);

  const close = () => { setOpen(false); setErr(undefined); setDone(undefined); setConfirm(""); setPassword(""); };
  const send = () => start(async () => {
    setErr(undefined);
    const r = await enqueueAction(type, full, incidentId ?? null, phrase === null ? null : confirm, reauth ? password : null);
    setPassword("");
    if (r.error) { setErr(r.error); return; }
    setDone("Navbatga qo'yildi — agent bir necha soniyada bajaradi. Natija «Amallar» sahifasida.");
    router.refresh();
    setTimeout(close, 1500);
  });

  const paramText = Object.entries(full).filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${String(v)}`).join(", ");
  return (
    <>
      {/* Har amal tugmasi yonida «?» — nima qiladi, xavfi, qachon ishlatish kerak (lib/control/help-content.ts) */}
      <span className={fullW ? "flex w-full items-center gap-0.5" : "inline-flex items-center gap-0.5"}>
        <Button type="button" variant={variant} size={size} disabled={disabled} className={fullW ? className!.replace("w-full", "min-w-0 flex-1") : className} onClick={() => setOpen(true)}>
          {Icon && <Icon size={14} aria-hidden />} {label ?? actionLabel(type)}
        </Button>
        <HelpButton topic={actionHelpId(type) ?? undefined} />
      </span>
      <Modal open={open} onClose={close} title={label ?? actionLabel(type)}>
        <form onSubmit={(e) => { e.preventDefault(); if (canSend && !pending) send(); }} className="space-y-3">
          <p className="text-sm text-slate-600">{DESCR[type] ?? "Amal insof-agent navbatiga qo'yiladi."}</p>
          {paramText && <p className="text-sm">Parametr: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{paramText}</code></p>}
          {needs && (
            <Field label={needs === "ip" ? "IPv4 manzil" : "Xizmat (unit)"} hint={needs === "ip" ? "masalan 203.0.113.7" : "insof-erp@<slug>, insof-control yoki insof-eco"}
              error={input && !inputOk ? "Format noto'g'ri" : undefined}>
              <Input value={input} onChange={(e) => setInput(e.target.value)} inputMode={needs === "ip" ? "decimal" : "text"} autoComplete="off" spellCheck={false} aria-invalid={!!input && !inputOk} />
            </Field>
          )}
          {phrase !== null && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="mb-2 flex items-start gap-1.5 text-sm text-red-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>Xavfli amal. Tasdiqlash uchun {phrase ? <><code className="rounded bg-white px-1 font-semibold">{phrase}</code> deb yozing.</> : "avval manzilni kiriting."}</span>
              </p>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Tasdiqlash matni" autoComplete="off" spellCheck={false} disabled={!phrase} />
            </div>
          )}
          {reauth && <PasswordBox value={password} onChange={setPassword} />}
          <FormError error={err} />
          {done && <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 size={16} aria-hidden /> {done}</p>}
          <div className="sa-sheet-acts flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={close}>Bekor qilish</Button>
            <Button type="submit" variant={phrase !== null ? "danger" : "primary"} disabled={!canSend || pending || !!done} data-autofocus>{pending ? "Yuborilmoqda…" : "Bajarish"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function AckButton({ id }: { id: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-0.5">
        <Button type="button" size="sm" variant="secondary" disabled={pending}
          onClick={() => start(async () => { const r = await ackIncident(id); if (r.error) setErr(r.error); else router.refresh(); })}>
          <Eye size={14} aria-hidden /> Ko&apos;rdim
        </Button>
        <HelpButton topic="inc:ack" />
      </span>
      {err && <span className="mt-1 text-xs text-red-600">{err}</span>}
    </span>
  );
}

export function ResolveButton({ id, onDone }: { id: string; onDone?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string>();
  const [pending, start] = useTransition();
  const close = () => { setOpen(false); setErr(undefined); };
  return (
    <>
      <span className="inline-flex items-center gap-0.5">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}><XCircle size={14} aria-hidden /> Yopish</Button>
        <HelpButton topic="inc:resolve" />
      </span>
      <Modal open={open} onClose={close} title="Hodisani qo'lda yopish">
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await resolveIncident(id, note);
            if (r.error) { setErr(r.error); return; }
            setNote(""); close(); onDone?.(); router.refresh();
          });
        }}>
          <p className="text-sm text-slate-600">Muammo bartaraf etilgan bo&apos;lsa yoping. Agent yana shu nosozlikni ko&apos;rsa, yangi hodisa ochiladi.</p>
          <Field label="Izoh (nima qilindi) *"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} required minLength={3} maxLength={1000} /></Field>
          <FormError error={err} />
          <div className="sa-sheet-acts flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Bekor qilish</Button>
            <Button type="submit" disabled={pending || note.trim().length < 3}>{pending ? "…" : "Yopish"}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
