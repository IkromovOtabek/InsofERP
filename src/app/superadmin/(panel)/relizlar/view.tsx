"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, GitBranch, GitCommitHorizontal, History, Rocket, RotateCcw, Server, Undo2 } from "lucide-react";
import { Badge, Button, Callout, Card, CardHeader, DL, Field, FormError, Input } from "@/components/ui";
import { DEPLOY_REF_RE } from "@/lib/control/devops/contract";
import type { ReleasesView } from "@/lib/control/devops/data";
import { actionLabel, dt, msBetween, type ActionView } from "@/lib/control/monitor/shared";
import { Modal, PasswordBox } from "../_monitor/action-dialog";
import { ActionOutput, ActionStatusBadge, Ago, StatusIcon } from "../_monitor/bits";
import { deployStatus, requestDeploy, requestRollback } from "./actions";

const PHRASE = "TASDIQLAYMAN";
const short = (s: string | null | undefined, n = 12) => (s ? s.slice(0, n) : "—");
const Sha = ({ v, n = 12 }: { v: string | null | undefined; n?: number }) => <code className="rounded bg-slate-100 px-1 text-xs" data-no-translit title={v ?? undefined}>{short(v, n)}</code>;

export function ReleasesClient({ view }: { view: ReleasesView }) {
  const { info } = view;
  const [deployRef, setDeployRef] = useState<string | null>(null);
  const [rollback, setRollback] = useState(false);
  const live = useDeployLive(view.active, view.history[0] ?? null);
  const busy = !!live.active;
  const rollbackTarget = info?.releases.find((r) => !r.current && r.built) ?? null;
  const stale = view.services.filter((s) => s.match === false);

  return (
    <div className="space-y-4">
      {!view.agentOk && <Callout tone="warning" title="insof-agent javob bermayapti">Deploy, qaytarish va relizlar holati agent orqali ishlaydi. Deploy paytida agent qayta ishga tushadi — bir necha soniya jim bo&apos;lishi normal.</Callout>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={GitBranch} title="Joriy reliz" description={info ? undefined : "Agent hali relizlar holatini yozmagan (5 daqiqagacha)."}
            action={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setDeployRef("main")} disabled={busy}><Rocket size={14} aria-hidden /> Deploy</Button>
                <Button size="sm" variant="secondary" onClick={() => setRollback(true)} disabled={busy || !rollbackTarget}><Undo2 size={14} aria-hidden /> Oldingi relizga qaytarish</Button>
              </div>
            } />
          <DL items={[
            { k: "current → releases/", v: <Sha v={info?.current} /> },
            { k: "RELEASE fayli", v: info?.releaseFile ? <Sha v={info.releaseFile} /> : "—" },
            { k: "Xabar", v: info?.releases.find((r) => r.current)?.subject ?? "—" },
            { k: "GitHub origin/main", v: <Sha v={info?.originMain} /> },
            { k: "Joriydan keyingi commitlar", v: info?.ahead == null ? "—" : info.ahead === 0 ? <Badge color="green">yangi commit yo&apos;q</Badge> : <Badge color="blue">{info.ahead} ta</Badge> },
            { k: "Oxirgi git fetch", v: info?.fetchedAt ? <Ago iso={info.fetchedAt} /> : "—" },
            { k: "Tekshirildi", v: view.infoAt ? <Ago iso={view.infoAt} /> : "—" },
          ]} />
          {info?.fetchError && <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-800"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {info.fetchError}</p>}
        </Card>

        <Card>
          <CardHeader icon={Server} title="Xizmatlar versiyasi" description="Har jarayon /api/health javobidagi versiya joriy reliz bilan mosmi" />
          {stale.length > 0 && <Callout tone="warning">{stale.length} ta xizmat eski relizda ishlayapti (qayta ishga tushmagan?).</Callout>}
          <ul className="divide-y divide-slate-100 text-sm">
            {view.services.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-2 py-2">
                {s.status ? <StatusIcon s={s.status} /> : null}
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{s.name}{s.slug && <span className="ml-1 text-xs text-slate-500" data-no-translit>({s.slug})</span>}</span>
                <Sha v={s.version} />
                {s.match === true ? <Badge color="green">mos</Badge> : s.match === false ? <Badge color="amber">eski</Badge> : <Badge color="slate">noma&apos;lum</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <DeployProgress active={live.active} last={live.last} />

      <Card>
        <CardHeader icon={GitCommitHorizontal} title={`GitHub (origin/main) dagi yangi commitlar${info?.ahead ? ` — ${info.ahead}` : ""}`}
          description="Joriy relizdan keyin qo'shilgan commitlar (eng yangisi tepada, merge'larsiz, ≤ 50)." />
        {!info?.commits.length ? (
          <p className="text-sm text-slate-500">{info?.ahead === 0 ? "Server GitHub'dagi oxirgi holatda." : "Ma'lumot yo'q."}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {info.commits.map((c) => (
              <li key={c.sha} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <Sha v={c.sha} n={7} />
                <span className="min-w-0 flex-1 basis-60 text-slate-800 [overflow-wrap:anywhere]">{c.subject}</span>
                <span className="text-xs text-slate-500">{c.author} · <span className="tabular" data-no-translit>{dt(c.date)}</span></span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeployRef(c.sha)}><Rocket size={13} aria-hidden /> Shu commitgacha</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader icon={History} title="Serverdagi relizlar" description="releases/<sha> — eng yangisi tepada (deploy.sh oxirgi 3 tasini saqlaydi)" />
        {!info?.releases.length ? <p className="text-sm text-slate-500">Ma&apos;lumot yo&apos;q.</p> : (
          <ul className="divide-y divide-slate-100">
            {info.releases.map((r) => (
              <li key={r.sha} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <Sha v={r.sha} />
                {r.current && <Badge color="green">joriy</Badge>}
                {r === rollbackTarget && <Badge color="violet">qaytarish nishoni</Badge>}
                {!r.built && <Badge color="amber">build yo&apos;q</Badge>}
                <span className="min-w-0 flex-1 basis-60 text-slate-700 [overflow-wrap:anywhere]">{r.subject ?? ""}</span>
                <span className="text-xs text-slate-500 tabular" data-no-translit>{dt(r.mtime)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader icon={RotateCcw} title="Deploy tarixi" description="Kim, qachon, qaysi ref, natija (log oxiri, sirlarsiz)" />
        {view.history.length === 0 ? <p className="text-sm text-slate-500">Hali panel orqali deploy qilinmagan.</p> : (
          <ul className="space-y-2">
            {view.history.map((a) => (
              <li key={a.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <ActionStatusBadge s={a.status} />
                  <span className="font-medium text-slate-900">{actionLabel(a.type)}</span>
                  {typeof a.params.ref === "string" && <Sha v={a.params.ref} />}
                  <span className="ml-auto text-xs text-slate-500 tabular" data-no-translit>{dt(a.requestedAt)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">Kim: <b className="font-medium text-slate-700">{a.requestedBy ?? "—"}</b> · Davomiylik: <span className="tabular">{msBetween(a.startedAt, a.finishedAt)}</span></div>
                <div className="mt-2"><ActionOutput output={a.output} open={false} /></div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DeployDialog refValue={deployRef} onClose={() => setDeployRef(null)} current={info?.current ?? null} onStarted={live.poke} />
      <RollbackDialog open={rollback} onClose={() => setRollback(false)} current={info?.current ?? null} target={rollbackTarget?.sha ?? null} onStarted={live.poke} />
    </div>
  );
}

/** Ishlayotgan deploy'ni 2.5 s da (yo'q bo'lsa 15 s da) so'raydi; tugaganda sahifa ma'lumoti yangilanadi. */
function useDeployLive(initialActive: ActionView | null, initialLast: ActionView | null) {
  const router = useRouter();
  const [state, setState] = useState({ active: initialActive, last: initialLast });
  const [tick, setTick] = useState(0);
  const wasActive = useRef(!!initialActive);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const s = await deployStatus();
        if (!alive) return;
        setState(s);
        if (wasActive.current && !s.active) router.refresh();
        wasActive.current = !!s.active;
      } catch { /* tarmoq — keyingi urinish */ }
      if (alive) setTick((x) => x + 1);
    }, state.active ? 2500 : 15_000);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  return { ...state, poke: () => { wasActive.current = true; setTick((x) => x + 1); } };
}

function DeployProgress({ active, last }: { active: ActionView | null; last: ActionView | null }) {
  const pre = useRef<HTMLPreElement>(null);
  const a = active ?? last;
  useEffect(() => { if (active && pre.current) pre.current.scrollTop = pre.current.scrollHeight; }, [active, active?.output]);
  if (!a) return null;
  return (
    <Card>
      <CardHeader icon={Rocket} title={active ? "Deploy bajarilmoqda" : "Oxirgi deploy"}
        description={active ? "Log har 2–3 soniyada yangilanadi. Agent deploy oxirida qayta ishga tushadi — log bir oz to'xtab qolishi normal." : undefined}
        action={<div className="flex items-center gap-2"><ActionStatusBadge s={a.status} /><span className="text-xs text-slate-500">{actionLabel(a.type)}{typeof a.params.ref === "string" ? ` ${a.params.ref}` : ""} · <Ago iso={a.requestedAt} /></span></div>} />
      {a.status === "PENDING" ? <p className="text-sm text-slate-600">Navbatda — agent bir necha soniyada boshlaydi.</p> : (
        <pre ref={pre} className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100" data-no-translit>{a.output ?? "…"}</pre>
      )}
    </Card>
  );
}

function ConfirmBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="mb-2 flex items-start gap-1.5 text-sm text-red-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>Xavfli amal: barcha korxonalar va panel qayta ishga tushadi. Tasdiqlash uchun <code className="rounded bg-white px-1 font-semibold">{PHRASE}</code> deb yozing.</span>
      </p>
      <Input value={value} onChange={(e) => onChange(e.target.value)} aria-label="Tasdiqlash matni" autoComplete="off" spellCheck={false} />
    </div>
  );
}

function DeployDialog({ refValue, onClose, current, onStarted }: { refValue: string | null; onClose: () => void; current: string | null; onStarted: () => void }) {
  const [ref, setRef] = useState("main");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => { if (refValue) { setRef(refValue); setConfirm(""); setPassword(""); setErr(undefined); setDone(false); } }, [refValue]);
  const r = ref.trim().toLowerCase();
  const refOk = DEPLOY_REF_RE.test(r);
  const close = () => { onClose(); setConfirm(""); setPassword(""); setErr(undefined); setDone(false); };
  return (
    <Modal open={refValue !== null} onClose={close} title="Deploy (yangi reliz)">
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (!refOk || confirm.trim() !== PHRASE || !password || pending) return;
        start(async () => {
          const res = await requestDeploy(r, confirm.trim(), password);
          setPassword("");
          if (res.error) { setErr(res.error); return; }
          setDone(true); onStarted(); setTimeout(close, 1200);
        });
      }}>
        <p className="text-sm text-slate-600">
          Agent serverda <code>scripts/deploy.sh</code> ni ishga tushiradi: git pull → build (alohida papkada) → migratsiya → current almashtirish →
          xizmatlarni bittadan qayta ishga tushirish (/api/health; o&apos;tmasa — avtomatik qaytarish). Joriy: <Sha v={current} />.
        </p>
        <Field label="Ref" hint="«main» — GitHub origin/main; yoki commit sha (7–40 belgi, 0-9 a-f)" error={ref && !refOk ? "Format noto'g'ri" : undefined}>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!ref && !refOk} data-no-translit />
        </Field>
        <ConfirmBox value={confirm} onChange={setConfirm} />
        <PasswordBox value={password} onChange={setPassword} />
        <FormError error={err} />
        {done && <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 size={16} aria-hidden /> Navbatga qo&apos;yildi — jarayon shu sahifada ko&apos;rinadi.</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close}>Bekor qilish</Button>
          <Button type="submit" variant="danger" disabled={!refOk || confirm.trim() !== PHRASE || !password || pending || done}>{pending ? "Yuborilmoqda…" : "Deploy qilish"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RollbackDialog({ open, onClose, current, target, onStarted }: { open: boolean; onClose: () => void; current: string | null; target: string | null; onStarted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const close = () => { onClose(); setConfirm(""); setPassword(""); setErr(undefined); setDone(false); };
  return (
    <Modal open={open} onClose={close} title="Oldingi relizga qaytarish">
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        if (confirm.trim() !== PHRASE || !password || pending) return;
        start(async () => {
          const res = await requestRollback(confirm.trim(), password);
          setPassword("");
          if (res.error) { setErr(res.error); return; }
          setDone(true); onStarted(); setTimeout(close, 1200);
        });
      }}>
        <p className="text-sm text-slate-600">
          <code>ROLLBACK=1 scripts/deploy.sh</code>: current <Sha v={current} /> → <Sha v={target} /> (build qilinmaydi), xizmatlar qayta ishga tushadi.
          <b> Migratsiyalar qaytmaydi</b> — baza yangi sxemada qoladi.
        </p>
        <ConfirmBox value={confirm} onChange={setConfirm} />
        <PasswordBox value={password} onChange={setPassword} />
        <FormError error={err} />
        {done && <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 size={16} aria-hidden /> Navbatga qo&apos;yildi.</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close}>Bekor qilish</Button>
          <Button type="submit" variant="danger" disabled={confirm.trim() !== PHRASE || !password || pending || done}>{pending ? "Yuborilmoqda…" : "Qaytarish"}</Button>
        </div>
      </form>
    </Modal>
  );
}
