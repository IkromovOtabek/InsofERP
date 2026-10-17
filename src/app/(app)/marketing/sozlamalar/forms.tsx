"use client";

import { useActionState, useState, useTransition } from "react";
import { CheckCircle2, Link2, MapPin, Play, Plus, RefreshCw, Search, Send, Star, Trash2, Unplug } from "lucide-react";
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import {
  accountAction, addCompetitor, connectMetaManual, connectTelegramAction, findPlaces, removeCompetitor, runAutoAgentNow, saveAds, saveAutoAgents, saveBrand, saveLocations, type Place,
} from "./actions";

type Msg = { error?: string; note?: string } | null;

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const run = (fn: () => Promise<{ error?: string; note?: string; ok?: boolean } | undefined>) => start(async () => {
    setMsg(null);
    try { const r = await fn(); setMsg(r?.error ? { error: r.error } : { note: r?.note ?? "Bajarildi" }); } catch { setMsg({ error: "Amal bajarilmadi" }); }
  });
  return { pending, msg, run };
}

function Note({ msg }: { msg: Msg }) {
  if (msg?.error) return <span role="alert" className="text-xs text-red-600">{msg.error}</span>;
  if (msg?.note) return <span className="text-xs text-emerald-700">{msg.note}</span>;
  return null;
}

export function AccountButtons({ id, primary }: { id: string; primary: boolean }) {
  const { pending, msg, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!primary && <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => accountAction(id, "primary"))}><Star size={14} /> Asosiy qilish</Button>}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => accountAction(id, "check"))}><RefreshCw size={14} /> Tekshirish</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => { if (confirm("Profilni uzasizmi? Postlar bu profilga chiqmay qoladi.")) run(() => accountAction(id, "disconnect")); }}><Unplug size={14} /> Uzish</Button>
      <Note msg={msg} />
    </div>
  );
}

/** Meta ruxsat oynasiga o'tish — oddiy GET forma (API marshruti Meta'ga yo'naltiradi) */
export function MetaConnect({ ready }: { ready: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action="/api/marketing/oauth/meta" method="get">
        <Button disabled={!ready}><Link2 size={16} /> Instagram va Facebook&apos;ni Meta orqali ulash</Button>
      </form>
      <p className="text-xs text-slate-500">
        {ready ? "Meta oynasida sahifa va Instagram profilini tanlab, ruxsat bering." : "Meta ilovasi hali sozlanmagan — hozircha tokenni qo'lda kiriting."}
      </p>
    </div>
  );
}

export function MetaManualForm() {
  const [state, action, pending] = useActionState(connectMetaManual, undefined);
  return (
    <form action={action} className="space-y-3">
      <Field label="Meta tokeni" hint="Meta Business Suite → Sozlamalar → Tizim foydalanuvchilari → Token yaratish (instagram_content_publish, instagram_manage_insights, pages_manage_posts ruxsatlari bilan)">
        <Input name="token" type="password" autoComplete="off" required />
      </Field>
      <Button size="sm" disabled={pending}>{pending ? "Tekshirilmoqda…" : "Ulash"}</Button>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}

export function TelegramForm() {
  const [state, action, pending] = useActionState(connectTelegramAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kanal" hint="@kanal_nomi yoki -100… (yopiq kanal)"><Input name="chat" placeholder="@insof_beton" required /></Field>
        <Field label="Bot tokeni" hint="Bo'sh qoldirilsa — korxonaning asosiy boti"><Input name="token" type="password" autoComplete="off" /></Field>
      </div>
      <p className="text-xs text-slate-500">Botni kanalga administrator qilib qo&apos;shing va «Xabar joylash» huquqini bering.</p>
      <Button size="sm" disabled={pending}>{pending ? "Tekshirilmoqda…" : "Kanalni ulash"}</Button>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}

export function BrandForm({ v, disabled }: { v: { brandAbout: string; brandTone: string; audience: string; languages: string; defaultHashtags: string }; disabled?: boolean }) {
  const [state, action, pending] = useActionState(saveBrand, undefined);
  return (
    <form action={action} className="space-y-3">
      <fieldset disabled={disabled} className="space-y-3">
        <Field label="Zavod haqida" hint="Nima ishlab chiqarasiz, afzalliklar, xizmat hududi, yetkazib berish, sertifikatlar — faqat haqiqiy faktlar">
          <Textarea name="brandAbout" rows={5} defaultValue={v.brandAbout} maxLength={4000} />
        </Field>
        <Field label="Ohang" hint="Masalan: ishonchli, aniq raqamlar bilan, ortiqcha reklamasiz, quruvchi tilida">
          <Input name="brandTone" defaultValue={v.brandTone} maxLength={1000} />
        </Field>
        <Field label="Maqsadli auditoriya" hint="Kimlar sotib oladi: prorablar, xususiy uy quruvchilar, qurilish kompaniyalari…">
          <Textarea name="audience" rows={3} defaultValue={v.audience} maxLength={2000} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Post tillari">
            <Select name="languages" defaultValue={v.languages}>
              <option value="ru,uz">Rus (asosiy) + o&apos;zbek</option>
              <option value="uz,ru">O&apos;zbek (asosiy) + rus</option>
              <option value="ru">Faqat rus</option>
              <option value="uz">Faqat o&apos;zbek</option>
            </Select>
          </Field>
          <Field label="Har postga qo'shiladigan heshteglar"><Input name="defaultHashtags" defaultValue={v.defaultHashtags} placeholder="#insof #beton" /></Field>
        </div>
      </fieldset>
      {!disabled && <Button size="sm" disabled={pending}>Saqlash</Button>}
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
    </form>
  );
}

export function LocationsEditor({ initial, disabled }: { initial: Place[]; disabled?: boolean }) {
  const [list, setList] = useState<Place[]>(initial);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; address?: string }[]>([]);
  const { pending, msg, run } = useRun();
  const search = () => run(async () => {
    const r = await findPlaces(q);
    setFound(r.items ?? []);
    return r.error ? { error: r.error } : { note: r.items?.length ? `${r.items.length} ta joy topildi` : "Topilmadi" };
  });
  const save = (next: Place[]) => { setList(next); run(() => saveLocations(next)); };
  return (
    <div className="space-y-3">
      {list.length === 0 ? <p className="text-sm text-slate-500">Joy qo&apos;shilmagan.</p> : (
        <ul className="space-y-1.5">
          {list.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2"><MapPin size={14} className="shrink-0 text-slate-400" /><span className="truncate">{p.name}</span>
                {p.locationId && <CheckCircle2 size={14} className="shrink-0 text-emerald-600" aria-label="Instagram joyiga bog'langan" />}</span>
              {!disabled && <button type="button" onClick={() => save(list.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label="O'chirish"><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Joy nomi: Zavod — Chirchiq" />
            <Button type="button" size="sm" variant="secondary" disabled={pending || name.trim().length < 2} onClick={() => { save([...list, { name: name.trim() }]); setName(""); }}><Plus size={14} /></Button>
          </div>
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Instagram joyini qidirish (profil ulangach)" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={search}><Search size={14} /></Button>
          </div>
          {found.length > 0 && (
            <ul className="space-y-1">
              {found.map((f) => (
                <li key={f.id}>
                  <button type="button" className="w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => { save([...list, { name: f.name, locationId: f.id }]); setFound([]); setQ(""); }}>
                    {f.name}{f.address ? <span className="text-xs text-slate-500"> · {f.address}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Note msg={msg} />
        </>
      )}
    </div>
  );
}

export function CompetitorForm() {
  const [state, action, pending] = useActionState(addCompetitor, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="flex gap-2">
        <Input name="username" placeholder="@raqobatchi_beton yoki havola" />
        <Button size="sm" variant="secondary" disabled={pending}><Plus size={14} /> Qo&apos;shish</Button>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}

export function CompetitorRemove({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <button type="button" disabled={pending} onClick={() => run(() => removeCompetitor(id))} className="text-slate-400 hover:text-red-600" aria-label="O'chirish"><Trash2 size={14} /></button>;
}

export function AdsForm({ v, disabled }: { v: { adAccountId: string; leadFormId: string; adCurrency: string; boostDailyCap: string; boostMonthlyCap: string }; disabled?: boolean }) {
  const [state, action, pending] = useActionState(saveAds, undefined);
  return (
    <form action={action} className="space-y-3">
      <fieldset disabled={disabled} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reklama kabineti" hint="Meta Ads Manager: act_123…"><Input name="adAccountId" defaultValue={v.adAccountId} placeholder="act_1234567890" /></Field>
          <Field label="Lead forma id" hint="«Ariza qoldirishsin» maqsadi uchun"><Input name="leadFormId" defaultValue={v.leadFormId} inputMode="numeric" /></Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Valyuta">
            <Select name="adCurrency" defaultValue={v.adCurrency}>{["USD", "EUR", "UZS", "RUB", "KZT"].map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="Kunlik limit"><Input name="boostDailyCap" inputMode="decimal" defaultValue={v.boostDailyCap} /></Field>
          <Field label="Oylik limit"><Input name="boostMonthlyCap" inputMode="decimal" defaultValue={v.boostMonthlyCap} /></Field>
        </div>
      </fieldset>
      {disabled ? <p className="text-xs text-slate-500">O&apos;zgartirish — direktor uchun.</p> : <Button size="sm" disabled={pending}>Saqlash</Button>}
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
    </form>
  );
}

/** Avtomatik agentlar: jadval, nechta g'oya qoralamaga, kimga yuboriladi; «Hozir yuborish» — sinash uchun */
export function AutoAgentsForm({ v, people, disabled }: {
  v: { autoWeekly: boolean; autoDaily: boolean; autoDrafts: number; recipients: string[] };
  people: { id: string; name: string; role: string; telegram: boolean }[];
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(saveAutoAgents, undefined);
  const { pending: running, msg, run } = useRun();
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <fieldset disabled={disabled} className="space-y-3">
          <div className="space-y-1.5">
            <Checkbox name="autoWeekly" label="Haftalik hisobot va reja — har dushanba 09:00" defaultChecked={v.autoWeekly} />
            <Checkbox name="autoDaily" label="Kunlik tekshiruv — har kuni 08:30" defaultChecked={v.autoDaily} />
          </div>
          <Field label="Haftalik g'oyalardan kontent rejaga" hint="«G'oya» holatida qo'shiladi — studiyada bir bosishda video yoki post qilinadi">
            <Select name="autoDrafts" defaultValue={String(v.autoDrafts)}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n === 0 ? "Qo'shilmasin" : `${n} ta g'oya`}</option>)}
            </Select>
          </Field>
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-slate-700">Kimga yuboriladi</span>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {people.map((p) => (
                <Checkbox key={p.id} name="recipients[]" value={p.id} defaultChecked={v.recipients.includes(p.id)} label={`${p.name} · ${p.role}${p.telegram ? "" : " (Telegram ulanmagan)"}`} />
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">Hech kim belgilanmasa — barcha direktorlarga. Telegram ulanmagan xodim xabarni faqat ilovada ko&apos;radi (Mening hisobim → Telegram).</p>
          </div>
        </fieldset>
        {!disabled && <Button size="sm" disabled={pending}>Saqlash</Button>}
        <FormError error={state?.error} />
        <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
      </form>
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Button size="sm" variant="secondary" disabled={running} onClick={() => run(() => runAutoAgentNow("daily"))}><Send size={14} /> Kunlik tekshiruvni hozir yuborish</Button>
          <Button size="sm" variant="secondary" disabled={running} onClick={() => run(() => runAutoAgentNow("weekly"))}><Play size={14} /> Haftalik hisobotni hozir tayyorlash</Button>
          {running ? <span className="text-xs text-slate-500">Bajarilmoqda… (haftalik — 1 daqiqagacha)</span> : <Note msg={msg} />}
        </div>
      )}
    </div>
  );
}
