"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LayoutGrid, Monitor, Moon, Rows3, Sun } from "lucide-react";
import type { CheckView } from "@/lib/control/monitor/shared";
import type { ColorMode, MobileLayout, UiPrefs } from "@/lib/control/ui-prefs";
import { Section } from "../../_ui";
import { applyUiPrefs } from "../../_ui/prefs-client";
import { useLiveMonitor } from "../_monitor/live";
import { saveUiPrefs } from "./actions";
import { HelpButton } from "../_help/help";

const LAYOUTS: { v: MobileLayout; t: string; d: string; I: typeof LayoutGrid }[] = [
  { v: "widgets", t: "Vidjetlar", d: "Turli o'lchamdagi kartalar, gorizontal sahifalar va pastki dock. Bir qarashda holat.", I: LayoutGrid },
  { v: "pro", t: "Zich Pro", d: "Zich jadval, mono raqamlar, sparkline va qator menyusi. Tunda tez tashxis uchun.", I: Rows3 },
];
const MODES: { v: ColorMode; t: string; I: typeof Sun }[] = [
  { v: "system", t: "Tizim", I: Monitor },
  { v: "light", t: "Yorug'", I: Sun },
  { v: "dark", t: "Qorong'i", I: Moon },
];

/** Sozlamalar → Mavzu: tanlov darhol qo'llanadi (optimistik) va bazaga saqlanadi (saveUiPrefs — faqat o'z prefs'i). */
export function ThemeForm({ initial }: { initial: UiPrefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  useEffect(() => { setPrefs(initial); }, [initial]);

  const save = (patch: Partial<UiPrefs>) => {
    const prev = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next); applyUiPrefs(next); setMsg(null);
    start(async () => {
      const r = await saveUiPrefs(patch);
      if (r.error) { setPrefs(prev); applyUiPrefs(prev); setMsg({ ok: false, t: r.error }); return; }
      setMsg({ ok: true, t: "Saqlandi — barcha qurilmalaringizda amal qiladi." });
      router.refresh();
    });
  };

  return (
    <Section id="mavzu" title="Mavzu" sub="Kompyuterda «Status Board» o'zgarmaydi">
      <div className="grid gap-5">
        <fieldset className="sa-fs">
          <legend>Telefon ko&apos;rinishi <span className="sa-sub">(ekran ≤ 760px)</span> <HelpButton topic="settings:mobile" /></legend>
          <div className="sa-choice-grid">
            {LAYOUTS.map((l) => (
              <label key={l.v} className="sa-choice">
                <input type="radio" name="mobileLayout" value={l.v} checked={prefs.mobileLayout === l.v} onChange={() => save({ mobileLayout: l.v })} disabled={pending} />
                <span className="hd"><l.I size={18} aria-hidden /><b>{l.t}</b><i className="rd" aria-hidden /></span>
                <span className="sa-sub">{l.d}</span>
                {l.v === "widgets" ? <WidgetsPreview /> : <ProPreview />}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="sa-fs">
          <legend>Rang rejimi <HelpButton topic="settings:color" /></legend>
          <div className="sa-seg3">
            {MODES.map((m) => (
              <label key={m.v}>
                <input type="radio" name="colorMode" value={m.v} checked={prefs.colorMode === m.v} onChange={() => save({ colorMode: m.v })} disabled={pending} />
                <m.I size={17} aria-hidden />{m.t}
              </label>
            ))}
          </div>
          <p className="sa-sub" style={{ margin: "6px 0 0" }}>«Tizim» — telefon yoki kompyuter sozlamasiga ergashadi.</p>
        </fieldset>
        <p role="status" aria-live="polite" className={`sa-sub ${msg ? (msg.ok ? "text-emerald-600" : "text-red-600") : ""}`} style={{ margin: 0, minHeight: 20 }}>
          {pending ? "Saqlanmoqda…" : msg ? <span className="inline-flex items-center gap-1.5">{msg.ok && <CheckCircle2 size={15} aria-hidden />}{msg.t}</span> : null}
        </p>
      </div>
    </Section>
  );
}

/* ── Kichik jonli namunalar (haqiqiy oqimdan) ── */
const NOT_SERVICE = new Set(["ssl", "backup", "security", "agent"]);
const svc = (c: CheckView) => !NOT_SERVICE.has(c.kind) && !c.key.startsWith("http:tenant:") && !c.key.startsWith("db:tenant:") && !c.key.startsWith("host:");

function WidgetsPreview() {
  const { data } = useLiveMonitor();
  const h = data?.host;
  const top = data?.incidents[0];
  const ram = h && h.memTotal ? Math.round((h.memUsed / h.memTotal) * 100) : null;
  return (
    <span className="pv pv-w" aria-hidden>
      <span className={`pw w2 ${top ? "crit" : ""}`}><small>{top ? "Hodisa" : "Hodisalar"}</small><b>{top ? top.title : "Ochiq hodisa yo'q"}</b></span>
      <span className="pw"><small>CPU</small><b>{h ? `${Math.round(h.cpuPct)}%` : "—"}</b></span>
      <span className="pw"><small>RAM</small><b>{ram != null ? `${ram}%` : "—"}</b></span>
    </span>
  );
}
function ProPreview() {
  const { data } = useLiveMonitor();
  const rows = (data?.checks ?? []).filter(svc).slice(0, 3);
  return (
    <span className="pv pv-p" aria-hidden>
      <span className="pr ph"><span>xizmat</span><span>hol</span><span>ms</span></span>
      {(rows.length ? rows : [null, null]).map((c, i) => (
        <span key={c?.key ?? i} className="pr"><span className="nm">{c?.target ?? "—"}</span><span className={c?.status === "CRIT" ? "bad" : ""}>{c?.status ?? "—"}</span><span>{c?.latencyMs ?? "—"}</span></span>
      ))}
    </span>
  );
}
