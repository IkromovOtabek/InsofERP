"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, Download, KeyRound, LogOut, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { Badge, Button, Field, FormError, Input, Select } from "@/components/ui";
import { ADMIN_ROLES, ROLE_LABEL, type AdminRoleT } from "@/lib/control/roles";
import { Modal } from "../_monitor/action-dialog";
import { resetAdminTotpAction, revokeAdminAllSessionsAction, setAdminRoleAction } from "../actions";
import {
  confirmTotpSetupAction, disableTotpAction, regenRecoveryCodesAction, revokeOtherOwnSessionsAction, revokeOwnSessionAction,
  startTotpSetupAction,
} from "./security-actions";

const codeInput = (v: string, set: (v: string) => void, label = "2FA kodi", hint = "Autentifikator ilovasidagi 6 raqam (yoki zaxira kod)") => (
  <Field label={label} hint={hint}>
    <Input value={v} onChange={(e) => set(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required maxLength={20} spellCheck={false} />
  </Field>
);
const passInput = (v: string, set: (v: string) => void) => (
  <Field label="Joriy parolingiz">
    <Input type="password" value={v} onChange={(e) => set(e.target.value)} autoComplete="current-password" required maxLength={200} />
  </Field>
);

/** Zaxira kodlar — faqat bir marta ko'rsatiladi: nusxa olish yoki .txt yuklab olish. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Insof IT panel — 2FA zaxira kodlari\nHar biri bir marta ishlaydi. Xavfsiz joyda saqlang.\n\n${codes.join("\n")}\n`;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">Telefon yo&apos;qolsa shu kodlar bilan kirasiz. Ular <b>boshqa ko&apos;rsatilmaydi</b> — hozir saqlab qo&apos;ying.</p>
      <ul className="grid grid-cols-2 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-sm" data-no-translit>
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => { void navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true)); }}>
          <Copy size={14} aria-hidden /> {copied ? "Nusxa olindi" : "Nusxa olish"}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => {
          const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
          const a = Object.assign(document.createElement("a"), { href: url, download: "insof-2fa-zaxira-kodlar.txt" });
          a.click();
          URL.revokeObjectURL(url);
        }}><Download size={14} aria-hidden /> Yuklab olish</Button>
        <Button type="button" size="sm" onClick={onDone}><CheckCircle2 size={14} aria-hidden /> Saqladim</Button>
      </div>
    </div>
  );
}

/** «Mening hisobim» → Ikki bosqichli kirish. */
export function TwoFactorCard({ enabled, recoveryLeft }: { enabled: boolean; recoveryLeft: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [dialog, setDialog] = useState<"off" | "regen" | null>(null);

  const reset = () => { setPassword(""); setCode(""); setErr(undefined); };
  const finish = () => { setCodes(null); setSetup(null); reset(); router.refresh(); };

  if (codes) return <RecoveryCodes codes={codes} onDone={finish} />;

  if (!enabled) {
    if (!setup) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Kirishda paroldan keyin telefondagi ilova (Google Authenticator, Microsoft Authenticator, 1Password…) ko&apos;rsatgan 6 raqamli kod so&apos;raladi.
            Deploy, reboot kabi xavfli amallarda ham kod kerak bo&apos;ladi. Parol o&apos;g&apos;irlansa ham panelga kirib bo&apos;lmaydi.
          </p>
          <FormError error={err} />
          <Button type="button" disabled={pending} onClick={() => start(async () => {
            setErr(undefined);
            const r = await startTotpSetupAction();
            if (r.error || !r.qr || !r.secret) { setErr(r.error ?? "Xato"); return; }
            setSetup({ qr: r.qr, secret: r.secret });
          })}><ShieldCheck size={16} aria-hidden /> 2FA ni yoqish</Button>
        </div>
      );
    }
    return (
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErr(undefined);
          const r = await confirmTotpSetupAction(password, code);
          setPassword(""); setCode("");
          if (r.error || !r.codes) { setErr(r.error ?? "Xato"); return; }
          setCodes(r.codes);
        });
      }}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Telefonda autentifikator ilovasini oching va «QR kodni skanerlash» ni tanlang.</li>
          <li>Skanerlab bo&apos;lmasa — «Kalitni qo&apos;lda kiritish»: quyidagi kalit, turi «vaqtga asoslangan».</li>
          <li>Ilova ko&apos;rsatgan 6 raqamni va joriy parolingizni kiriting.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- server bergan data: URL, optimallashtirish shart emas */}
          <img src={setup.qr} alt="2FA QR kodi" width={180} height={180} className="rounded-lg border border-slate-200 bg-white p-1" />
          <code className="max-w-[16rem] break-words rounded bg-slate-100 px-2 py-1 text-sm font-semibold tracking-wider" data-no-translit>{setup.secret}</code>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {codeInput(code, setCode, "Ilovadagi kod", "Autentifikator ilovasidagi 6 raqam")}
          {passInput(password, setPassword)}
        </div>
        <FormError error={err} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || !code.trim() || !password}><ShieldCheck size={16} aria-hidden /> {pending ? "Tekshirilmoqda…" : "Tasdiqlash va yoqish"}</Button>
          <Button type="button" variant="ghost" onClick={() => { setSetup(null); reset(); }}>Bekor qilish</Button>
        </div>
      </form>
    );
  }

  const close = () => { setDialog(null); reset(); };
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <Badge color="green">Yoqilgan</Badge>
        Zaxira kodlar: <b className={recoveryLeft <= 2 ? "text-red-700" : undefined}>{recoveryLeft} ta qoldi</b>
        {recoveryLeft <= 2 && <span className="text-red-700">— yangilarini yarating</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setDialog("regen")}><RefreshCw size={14} aria-hidden /> Yangi zaxira kodlar</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDialog("off")}><ShieldOff size={14} aria-hidden /> 2FA ni o&apos;chirish</Button>
      </div>
      <Modal open={dialog !== null} onClose={close} title={dialog === "off" ? "2FA ni o'chirish" : "Yangi zaxira kodlar"}>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setErr(undefined);
            if (dialog === "off") {
              const r = await disableTotpAction(password, code);
              if (r.error) { setErr(r.error); return; }
              close(); router.refresh();
            } else {
              const r = await regenRecoveryCodesAction(password, code);
              if (r.error || !r.codes) { setErr(r.error ?? "Xato"); return; }
              setDialog(null); reset(); setCodes(r.codes);
            }
          });
        }}>
          <p className="text-sm text-slate-600">{dialog === "off"
            ? "Kirish yana faqat parol bilan bo'ladi. Tavsiya etilmaydi."
            : "Eski zaxira kodlar darhol bekor bo'ladi, yangi 10 ta kod ko'rsatiladi."}</p>
          {passInput(password, setPassword)}
          {codeInput(code, setCode)}
          <FormError error={err} />
          <div className="sa-sheet-acts flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Bekor qilish</Button>
            <Button type="submit" variant={dialog === "off" ? "danger" : "primary"} disabled={pending || !password || !code.trim()} data-autofocus>
              {pending ? "…" : dialog === "off" ? "O'chirish" : "Yaratish"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/** O'z sessiyalaridan birini yopish yoki «boshqa barcha qurilmalardan chiqish». */
export function RevokeSessionButton({ id }: { id?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  return (
    <span className="inline-flex flex-col items-end">
      <Button type="button" size="sm" variant={id ? "ghost" : "secondary"} disabled={pending} onClick={() => start(async () => {
        const r = id ? await revokeOwnSessionAction(id) : await revokeOtherOwnSessionsAction();
        if (r.error) setErr(r.error); else router.refresh();
      })}>
        <LogOut size={14} aria-hidden /> {id ? "Yopish" : "Boshqa qurilmalardan chiqish"}
      </Button>
      {err && <span className="mt-1 text-xs text-red-600">{err}</span>}
    </span>
  );
}

/** Boshqa admin qatori (faqat «Egasi»): rol, sessiyalarini yopish, 2FA ni tiklash. */
export function AdminRowActions({ id, role, totp, myTotp }: { id: string; role: AdminRoleT; totp: boolean; myTotp: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string>();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const close = () => { setOpen(false); setPassword(""); setCode(""); setErr(undefined); };
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => {
    setErr(undefined);
    const r = await fn();
    if (r.error) setErr(r.error); else router.refresh();
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Select aria-label="Rol" value={role} disabled={pending} className="h-8 w-auto py-0 text-sm"
          onChange={(e) => run(() => setAdminRoleAction(id, e.target.value))}>
          {ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => revokeAdminAllSessionsAction(id))}><LogOut size={14} aria-hidden /> Sessiyalarini yopish</Button>
        {totp && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(true)}><KeyRound size={14} aria-hidden /> 2FA ni tiklash</Button>}
      </div>
      {err && !open && <span className="text-xs text-red-600">{err}</span>}
      <Modal open={open} onClose={close} title="2FA ni tiklash">
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setErr(undefined);
            const r = await resetAdminTotpAction(id, password, code);
            if (r.error) { setErr(r.error); return; }
            close(); router.refresh();
          });
        }}>
          <p className="text-sm text-slate-600">Telefoni yo&apos;qolgan admin uchun: uning 2FA si o&apos;chadi va barcha sessiyalari yopiladi. Keyin u parol bilan kirib, 2FA ni qayta yoqadi. Shaxsini telefon orqali tasdiqlang.</p>
          {passInput(password, setPassword)}
          {myTotp && codeInput(code, setCode, "Sizning 2FA kodingiz")}
          <FormError error={err} />
          <div className="sa-sheet-acts flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>Bekor qilish</Button>
            <Button type="submit" variant="danger" disabled={pending || !password || (myTotp && !code.trim())} data-autofocus>{pending ? "…" : "Tiklash"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
