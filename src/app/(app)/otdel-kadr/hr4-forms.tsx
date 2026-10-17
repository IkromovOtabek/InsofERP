"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, PenLine, Plus, Send } from "lucide-react";
import { broadcastAction, eimzoPayloadAction, eimzoSaveAction, feedbackStatusAction, hrReplyAction, saveSurveyAction, surveyStatusAction } from "./hr4-actions";
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import type { FeedbackStatus } from "@/generated/prisma";

function useDone(state: ActionState, after?: () => void) {
  const router = useRouter();
  const cb = useRef(after);
  useEffect(() => { cb.current = after; });
  useEffect(() => { if (state?.ok) { router.refresh(); cb.current?.(); } }, [state, router]);
}

function Run({ run, label, variant = "secondary" }: { run: () => Promise<ActionState>; label: string; variant?: "secondary" | "ghost" | "success" | "danger" }) {
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, setPending] = useState(false);
  useDone(state);
  return (
    <span className="inline-flex flex-col">
      <Button size="sm" variant={variant} disabled={pending} onClick={async () => { setPending(true); setState(await run()); setPending(false); }}>{label}</Button>
      {state?.error && <span className="text-[11px] text-red-600">{state.error}</span>}
      {state?.ok && state.note && <span className="text-[11px] text-emerald-700">{state.note}</span>}
    </span>
  );
}

// ───────────────────────── So'rovnoma ─────────────────────────

export function SurveyForm({ s, positions }: { s?: { id: string; title: string; description: string | null; anonymous: boolean; position: string | null; text: string; closesAt: string | null }; positions: string[] }) {
  const [state, act, pending] = useActionState(saveSurveyAction.bind(null, s?.id ?? null), undefined);
  useDone(state);
  return (
    <form action={act} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1.2fr_160px]">
        <Field label="Nomi *"><Input name="title" required defaultValue={s?.title} placeholder="Masalan: Oktabr — ish sharoiti" /></Field>
        <Field label="Kimga" hint="Bo'sh — hammaga"><Select name="position" defaultValue={s?.position ?? ""}><option value="">Hamma xodim</option>{positions.map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Yopiladi"><Input type="date" name="closesAt" defaultValue={s?.closesAt ?? ""} /></Field>
      </div>
      <Field label="Izoh"><Input name="description" defaultValue={s?.description ?? ""} /></Field>
      <Field label="Savollar *" hint="Har qatorda bitta: «NPS: …» (0–10), «BAHO: …» (1–5), «TANLOV: savol | variant | variant», boshqasi — erkin javob">
        <Textarea name="questions" rows={6} required defaultValue={s?.text ?? "NPS: Zavodimizni ish joyi sifatida do'stingizga tavsiya qilasizmi?\nBAHO: Ish sharoiti va asbob-uskunalar\nBAHO: Rahbaringiz bilan munosabat\nNimani yaxshilash kerak?"} className="font-mono text-xs" />
      </Field>
      <Checkbox name="anonymous" label="Anonim — javob kimniki ekani saqlanmaydi" defaultChecked={s?.anonymous ?? true} />
      <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
      <Button disabled={pending}>{s ? "Saqlash" : <><Plus size={14} /> So&apos;rovnoma tuzish</>}</Button>
    </form>
  );
}

export function SurveyStatusButtons({ id, status }: { id: string; status: string }) {
  return (
    <div className="flex gap-2">
      {status === "DRAFT" && <Run run={() => surveyStatusAction(id, "OPEN")} label="Ochish va xodimlarga yuborish" variant="success" />}
      {status === "OPEN" && <Run run={() => surveyStatusAction(id, "CLOSED")} label="Yopish" variant="danger" />}
    </div>
  );
}

// ───────────────────────── Murojaatlar va ommaviy xabar ─────────────────────────

export function HrReplyForm({ id, status }: { id: string; status: FeedbackStatus }) {
  const [state, act, pending] = useActionState(hrReplyAction.bind(null, id), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useDone(state, () => ref.current?.reset());
  return (
    <div className="space-y-2">
      <form ref={ref} action={act} className="flex gap-2">
        <Textarea name="text" rows={2} required placeholder="Javob yozing…" />
        <Button disabled={pending}><Send size={15} /></Button>
      </form>
      <FormError error={state?.error} />
      <div className="flex gap-2">
        {status !== "RESOLVED" && <Run run={() => feedbackStatusAction(id, "RESOLVED")} label="Hal qilindi" variant="success" />}
        {status === "RESOLVED" && <Run run={() => feedbackStatusAction(id, "IN_REVIEW")} label="Qayta ochish" />}
      </div>
    </div>
  );
}

export function BroadcastForm({ positions }: { positions: string[] }) {
  const [state, act, pending] = useActionState(broadcastAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useDone(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={act} className="space-y-3">
      <Field label="Sarlavha *"><Input name="title" required maxLength={120} placeholder="Masalan: Shanba kuni subbotnik" /></Field>
      <Field label="Matn *"><Textarea name="body" rows={3} required maxLength={2000} /></Field>
      <details className="rounded-lg border border-slate-200 p-2 text-sm">
        <summary className="cursor-pointer text-slate-600">Faqat ayrim lavozimlarga (belgilanmasa — hammaga)</summary>
        <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {positions.map((p) => <label key={p} className="flex items-center gap-2"><input type="checkbox" name="pos" value={p} className="h-4 w-4 rounded border-slate-300" /> {p}</label>)}
        </div>
      </details>
      <Checkbox name="important" label="Muhim — ovozli bildirishnoma" />
      <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
      <Button disabled={pending}><Megaphone size={15} /> {pending ? "Yuborilmoqda…" : "Yuborish"}</Button>
    </form>
  );
}

// ───────────────────────── E-IMZO ─────────────────────────

/** Mahalliy E-IMZO ilovasiga bitta so'rov (har chaqiruv — alohida ulanish). */
function eimzoCall<T>(payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = location.protocol === "https:" ? "wss://127.0.0.1:64443/service/cryptapi" : "ws://127.0.0.1:64646/service/cryptapi";
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { reject(new Error("E-IMZO ilovasiga ulanib bo'lmadi")); return; }
    const t = setTimeout(() => { ws.close(); reject(new Error("E-IMZO javob bermadi — ilova ishga tushirilganmi?")); }, 20_000);
    ws.onerror = () => { clearTimeout(t); reject(new Error("E-IMZO topilmadi — kompyuterda E-IMZO ilovasini o'rnatib, ishga tushiring")); };
    ws.onopen = () => ws.send(JSON.stringify(payload));
    ws.onmessage = (e) => {
      clearTimeout(t); ws.close();
      const j = JSON.parse(String(e.data)) as T & { success?: boolean; reason?: string };
      if (j.success === false) reject(new Error(j.reason || "E-IMZO xatosi")); else resolve(j);
    };
  });
}
type Cert = { disk: string; path: string; name: string; alias: string };
const aliasField = (alias: string, key: string) => new RegExp(`(?:^|,)${key}=([^,]+)`, "i").exec(alias)?.[1]?.trim() ?? null;
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** Kadr hujjatini E-IMZO bilan imzolash: sertifikat tanlash → parol (E-IMZO oynasida) → imzo serverga. */
export function EimzoButton({ docId, signed }: { docId: string; signed: { signer: string | null; at: string; verified: boolean } | null }) {
  const [certs, setCerts] = useState<Cert[] | null>(null);
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; note?: string }>({});
  const router = useRouter();
  const apikeys = () => (process.env.NEXT_PUBLIC_EIMZO_APIKEYS ?? "").split(",").map((x) => x.split(":")).filter((x) => x.length === 2 && x[0] && x[1]);

  const open = async () => {
    setBusy(true); setMsg({});
    try {
      const keys = apikeys();
      if (!keys.length) throw new Error("E-IMZO API kaliti sozlanmagan (NEXT_PUBLIC_EIMZO_APIKEYS) — e-imzo.uz dan domen uchun kalit olinadi");
      await eimzoCall({ name: "apikey", arguments: keys.flat() });
      const r = await eimzoCall<{ certificates: Cert[] }>({ plugin: "pfx", name: "list_all_certificates" });
      if (!r.certificates?.length) throw new Error("Kompyuterda ERI kaliti (sertifikat) topilmadi");
      setCerts(r.certificates);
    } catch (e) { setMsg({ error: (e as Error).message }); } finally { setBusy(false); }
  };
  const sign = async () => {
    const c = certs?.[pick];
    if (!c) return;
    setBusy(true); setMsg({});
    try {
      const p = await eimzoPayloadAction(docId);
      if (!p.text) throw new Error(p.error ?? "Hujjat topilmadi");
      const k = await eimzoCall<{ keyId: string }>({ plugin: "pfx", name: "load_key", arguments: [c.disk, c.path, c.name, c.alias] });
      const s = await eimzoCall<{ pkcs7_64: string }>({ plugin: "pkcs7", name: "create_pkcs7", arguments: [b64(p.text), k.keyId, "no"] });
      const r = await eimzoSaveAction(docId, s.pkcs7_64, { name: aliasField(c.alias, "cn"), tin: aliasField(c.alias, "1.2.860.3.16.1.2") ?? aliasField(c.alias, "uid") });
      if (r?.error) throw new Error(r.error);
      setMsg({ note: r?.note }); setCerts(null); router.refresh();
    } catch (e) { setMsg({ error: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-1">
      {signed && <div className="text-xs text-emerald-700">E-IMZO: {signed.signer ?? "imzolangan"} · {signed.at}{signed.verified ? " · tekshirildi" : " · server tekshiruvisiz"}</div>}
      {!certs ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={open}><PenLine size={14} /> {busy ? "E-IMZO…" : signed ? "Qayta imzolash" : "E-IMZO bilan imzolash"}</Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={pick} onChange={(e) => setPick(Number(e.target.value))} className="h-8 text-xs">
            {certs.map((c, i) => <option key={i} value={i}>{aliasField(c.alias, "cn") ?? c.name}{aliasField(c.alias, "o") ? ` · ${aliasField(c.alias, "o")}` : ""}</option>)}
          </Select>
          <Button size="sm" disabled={busy} onClick={sign}>{busy ? "Imzolanmoqda…" : "Imzolash"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setCerts(null)}>Bekor</Button>
        </div>
      )}
      <FormError error={msg.error} />
      {msg.note && <FormSuccess text={msg.note} />}
    </div>
  );
}
