import { requireAdmin } from "@/lib/control/auth";
import { AlertTriangle, Ban, Globe, Network, ServerCrash, ShieldAlert, Snail } from "lucide-react";
import { control } from "@/lib/control/db";
import { DBT_KEYS } from "@/lib/control/dbtraffic/contract";
import { isIpv4 } from "@/lib/control/dbtraffic/nginx";
import { asTraffic } from "@/lib/control/dbtraffic/types";
import { asSuggested, restartableUnit } from "@/lib/control/monitor/shared";
import { Callout, Card, CardHeader, EmptyState, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { PageHeader } from "../../_ui";
import { ConnBadge } from "../_monitor/live";
import { ActionButton } from "../_monitor/action-dialog";
import { Ago, CheckBadge } from "../_monitor/bits";
import { RefreshOnChecks } from "../baza/refresh";
import { PerMinute } from "./chart";

export const metadata = { title: "Trafik (nginx)" };
export const dynamic = "force-dynamic";

const pctTxt = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
const SUB_LABEL: Record<string, string> = { refused: "ulanish rad etildi", timeout: "vaqt tugadi", nolive: "tirik upstream yo'q", closed: "ulanish uzildi", other: "boshqa" };

const LOG_FORMAT = `# /etc/nginx/conf.d/insof-log.conf  (docs/deploy/nginx-log.conf)
log_format insof_main '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                      'host=$host rt=$request_time urt="$upstream_response_time"';
access_log /var/log/nginx/access.log insof_main;`;

/** nginx trafik: domenlar bo'yicha so'rovlar, 4xx/5xx, 429, eng sekin yo'llar, eng faol IP'lar, upstream xatolari. */
export default async function TrafficPage() {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  const [row, upRows, incidents, blockedActs] = await Promise.all([
    control.serviceCheck.findUnique({ where: { key: DBT_KEYS.traffic } }),
    control.serviceCheck.findMany({ where: { key: { startsWith: DBT_KEYS.upstreamPrefix } }, orderBy: [{ status: "desc" }, { target: "asc" }] }),
    control.incident.findMany({ where: { key: { startsWith: DBT_KEYS.upstreamPrefix }, status: { in: ["OPEN", "ACKED"] } }, select: { key: true, suggestedActions: true } }),
    control.agentAction.findMany({ where: { type: { in: ["BLOCK_IP", "UNBLOCK_IP"] }, status: "DONE" }, orderBy: [{ finishedAt: "asc" }], select: { type: true, params: true } }),
  ]);
  const d = asTraffic(row?.data);
  const blocked = new Set<string>();
  for (const a of blockedActs) {
    const ip = (a.params as { ip?: unknown } | null)?.ip;
    if (typeof ip !== "string") continue;
    if (a.type === "BLOCK_IP") blocked.add(ip); else blocked.delete(ip);
  }
  const suggested = new Map(incidents.map((i) => [i.key, asSuggested(i.suggestedActions)]));

  return (
    <div className="space-y-6">
      <RefreshOnChecks prefixes={["traffic:"]} actions={["BLOCK_IP", "UNBLOCK_IP", "RESTART_UNIT", "RUN_HEALTH_CHECK"]} />
      <PageHeader
        title={<>Trafik (nginx) <ConnBadge /></>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">access.log va error.log ning oxirgi 5 / 60 daqiqasi, har daqiqada.{row && <> Oxirgi: <Ago iso={row.checkedAt.toISOString()} /> <CheckBadge s={row.status} /></>}</span>}
        action={<ActionButton type="RUN_HEALTH_CHECK" label="Hozir yangilash" icon="refresh" />}
      />

      {!d ? (
        <EmptyState icon={Globe} title="Trafik ma'lumoti hali yo'q" text={row?.message ?? "insof-agent (yangi versiya) ishga tushgach bir daqiqada chiqadi. deploy foydalanuvchisi adm guruhida bo'lishi kerak (nginx loglari) — PLATFORMA.md."} />
      ) : (
        <>
          {d.source.problems.length > 0 && (
            <Callout tone="warning" title="Loglarni to'liq o'qib bo'lmadi">
              <ul className="list-disc space-y-0.5 pl-5">{d.source.problems.map((p) => <li key={p} data-no-translit>{p}</li>)}</ul>
            </Callout>
          )}
          {d.w60.total > 0 && (!d.format.hasHost || !d.format.hasRequestTime) && (
            <Callout tone="info" title="Log formatini kengaytiring">
              <p>Hozirgi access.log formatida {!d.format.hasHost && <b>$host</b>}{!d.format.hasHost && !d.format.hasRequestTime && " va "}{!d.format.hasRequestTime && <b>$request_time</b>} yo&apos;q — {!d.format.hasHost ? "domen bo'yicha ajratish" : ""}{!d.format.hasHost && !d.format.hasRequestTime ? " va " : ""}{!d.format.hasRequestTime ? "eng sekin yo'llar" : ""} ishlamaydi. Serverda (PLATFORMA.md → «Baza va trafik»):</p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-blue-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-800" data-no-translit>{LOG_FORMAT}</pre>
            </Callout>
          )}
          {d.source.truncated && <Callout tone="info">Log juda katta — oynaning bir qismi o&apos;qildi (512 MB chegarasi).</Callout>}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="So'rov/daq (5 daq)" icon={Globe} value={d.w5.perMin} hint={`60 daq: ${d.w60.perMin}/daq · ${d.w60.total} jami`} />
            <StatCard label="4xx ulushi" icon={AlertTriangle} value={pctTxt(d.w5.pct4xx)} hint={`60 daq: ${pctTxt(d.w60.pct4xx)}`} />
            <StatCard label="5xx ulushi" icon={ServerCrash} value={pctTxt(d.w5.pct5xx)} hint={`60 daq: ${pctTxt(d.w60.pct5xx)} · ${d.w60.s5} ta`} tone={(d.w5.pct5xx ?? 0) >= 5 ? "danger" : "default"} />
            <StatCard label="429 (limit_req)" icon={ShieldAlert} value={d.w5.s429} hint={`60 daq: ${d.w60.s429}`} tone={d.w5.s429 > 0 ? "warning" : "default"} />
            <StatCard label="Upstream xatolari" icon={Network} value={d.upstream.reduce((s, u) => s + u.n5, 0)} hint={`60 daq: ${d.upstream.reduce((s, u) => s + u.n60, 0)}`} tone={d.upstream.some((u) => u.n5 > 0) ? "danger" : "default"} />
          </div>

          <Card>
            <CardHeader title="So'nggi 60 daqiqa" description="Daqiqalik so'rovlar va 5xx javoblar" icon={Globe} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div><div className="mb-1 text-xs text-slate-500">So&apos;rovlar / daq</div><PerMinute label="So'rovlar" values={d.perMinute.map((p) => p.n)} times={d.perMinute.map((p) => p.t)} /></div>
              <div><div className="mb-1 text-xs text-slate-500">5xx / daq</div><PerMinute label="5xx" tone="danger" values={d.perMinute.map((p) => p.e5)} times={d.perMinute.map((p) => p.t)} /></div>
            </div>
          </Card>

          {/* ── Upstream xatolari ── */}
          <Card>
            <CardHeader title="Upstream xatolari (error.log)" description="nginx orqadagi xizmatga ulana olmagan so'rovlar — domen bo'yicha" icon={Network} />
            {upRows.length === 0 && d.upstream.length === 0 ? <p className="text-sm text-slate-500">Oxirgi 60 daqiqada upstream xatosi yo&apos;q.</p> : (
              <ul className="divide-y divide-slate-100">
                {d.upstream.map((u) => {
                  const r = upRows.find((x) => x.key === DBT_KEYS.upstream(u.domain)) ?? upRows.find((x) => x.key === DBT_KEYS.upstream("unknown"));
                  const acts = (r ? suggested.get(r.key) : undefined) ?? [];
                  return (
                    <li key={u.domain} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3 text-sm">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {r && <CheckBadge s={r.status} />}
                          <b data-no-translit>{u.domain}</b>
                          {u.upstreams.map((a) => <code key={a.addr} className="rounded bg-slate-100 px-1 text-xs" data-no-translit>→ {a.addr} ({a.n})</code>)}
                        </div>
                        <div className="text-xs text-slate-600">5 daq: <b>{u.n5}</b> · 60 daq: <b>{u.n60}</b> · {Object.entries(u.subs).map(([k, n]) => `${SUB_LABEL[k] ?? k}: ${n}`).join(", ")} · oxirgisi <Ago iso={u.last} /></div>
                        <div className="text-xs text-slate-500" data-no-translit>{u.head}</div>
                      </div>
                      {acts.filter((a) => a.type === "RESTART_UNIT" && typeof a.params?.unit === "string" && restartableUnit(`unit:${a.params.unit}`)).map((a) => (
                        <ActionButton key={String(a.params?.unit)} type="RESTART_UNIT" params={a.params} label={a.label ?? "Qayta ishga tushirish"} icon="restart" variant="danger" />
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* ── Domenlar ── */}
          <Card padded={false}>
            <div className="p-5 pb-0"><CardHeader title="Domenlar" description={d.format.hasHost ? "So'rovlar/daq (5 va 60 daq), xato ulushlari — 60 daqiqa" : "Log formatida $host yo'q — barcha so'rovlar bitta guruhda"} icon={Globe} /></div>
            <Table className="rounded-none border-0 shadow-none">
              <thead><tr><Th>Domen</Th><Th right>/daq (5)</Th><Th right>/daq (60)</Th><Th right>Jami (60)</Th><Th right>4xx</Th><Th right>5xx</Th><Th right>429</Th><Th right>O&apos;rtacha javob</Th></tr></thead>
              <tbody>
                {d.domains.length === 0 ? <tr><Td colSpan={8} className="text-center text-slate-500">Oxirgi 60 daqiqada so&apos;rov yo&apos;q</Td></tr> : d.domains.map((x) => (
                  <Tr key={x.domain}>
                    <Td><span data-no-translit>{x.domain}</span></Td>
                    <Td right>{x.perMin5}</Td><Td right>{x.perMin60}</Td><Td right>{x.total60.toLocaleString("ru-RU")}</Td>
                    <Td right>{pctTxt(x.pct4xx)}</Td>
                    <Td right className={(x.pct5xx ?? 0) >= 5 ? "font-medium text-red-600" : undefined}>{pctTxt(x.pct5xx)}</Td>
                    <Td right>{x.s429 || "—"}</Td>
                    <Td right>{x.avgRtMs == null ? "—" : `${x.avgRtMs} ms`}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* ── IP'lar ── */}
            <Card padded={false}>
              <div className="p-5 pb-0"><CardHeader title="Eng faol 10 IP (60 daq)" description="Shubhali manzilni bloklash — ufw (BLOCK_IP), tasdiq bilan" icon={Ban} /></div>
              <Table className="rounded-none border-0 shadow-none">
                <thead><tr><Th>IP</Th><Th right>So&apos;rov</Th><Th right>5 daq</Th><Th right>4xx</Th><Th right>5xx</Th><Th right>429</Th><Th /></tr></thead>
                <tbody>
                  {d.topIps.length === 0 ? <tr><Td colSpan={7} className="text-center text-slate-500">Ma&apos;lumot yo&apos;q</Td></tr> : d.topIps.map((x) => (
                    <Tr key={x.ip}>
                      <Td><code data-no-translit>{x.ip}</code>{x.topPath && <div className="max-w-56 truncate text-xs font-normal text-slate-500" title={x.topPath} data-no-translit>{x.topPath}</div>}</Td>
                      <Td right>{x.n.toLocaleString("ru-RU")}</Td><Td right>{x.n5}</Td><Td right>{x.e4 || "—"}</Td><Td right>{x.e5 || "—"}</Td><Td right>{x.r429 || "—"}</Td>
                      <Td right>
                        {blocked.has(x.ip) ? <span className="text-xs text-slate-500">bloklangan</span>
                          : isIpv4(x.ip) && !/^(127|0)\./.test(x.ip) ? <ActionButton type="BLOCK_IP" params={{ ip: x.ip }} label="Bloklash" icon="ban" variant="ghost" />
                            : <span className="text-xs text-slate-400">—</span>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {d.ipOverflow > 0 && <p className="px-5 py-2 text-xs text-slate-500">IP ro&apos;yxati chegarasi: {d.ipOverflow} so&apos;rov hisobga olinmadi.</p>}
            </Card>

            {/* ── Sekin yo'llar ── */}
            <Card padded={false}>
              <div className="p-5 pb-0"><CardHeader title="Eng sekin yo'llar (60 daq)" description="O'rtacha javob vaqti ($request_time), kamida 3 so'rov; id/raqamlar :id ga guruhlangan" icon={Snail} /></div>
              {!d.format.hasRequestTime ? <p className="px-5 pb-5 text-sm text-slate-500">Log formatida $request_time yo&apos;q — yuqoridagi ko&apos;rsatma bo&apos;yicha qo&apos;shing.</p> : (
                <Table className="rounded-none border-0 shadow-none">
                  <thead><tr><Th>Yo&apos;l</Th><Th right>So&apos;rov</Th><Th right>O&apos;rtacha</Th><Th right>Eng uzoq</Th><Th right>5xx</Th></tr></thead>
                  <tbody>
                    {d.slowPaths.length === 0 ? <tr><Td colSpan={5} className="text-center text-slate-500">Ma&apos;lumot yo&apos;q</Td></tr> : d.slowPaths.map((p) => (
                      <Tr key={p.path}>
                        <Td><code className="text-xs [overflow-wrap:anywhere]" data-no-translit>{p.path}</code></Td>
                        <Td right>{p.n}</Td>
                        <Td right className={p.avgMs >= 2000 ? "font-medium text-amber-700" : undefined}>{p.avgMs} ms</Td>
                        <Td right>{p.maxMs} ms</Td>
                        <Td right>{p.e5 || "—"}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          {d.limitZones.length > 0 && (
            <Card>
              <CardHeader title="Tezlik cheklovi (limit_req) — error.log" description="Zona bo'yicha cheklangan so'rovlar (insof_auth — login, insof_pub — ochiq API, insof_ai — AI)" icon={ShieldAlert} />
              <ul className="divide-y divide-slate-100 text-sm">
                {d.limitZones.map((z) => <li key={z.zone} className="flex justify-between py-1.5"><code data-no-translit>{z.zone}</code><span>5 daq: <b>{z.n5}</b> · 60 daq: <b>{z.n60}</b></span></li>)}
              </ul>
            </Card>
          )}

          <p className="text-xs text-slate-500" data-no-translit>
            {d.source.access}: {d.source.accessLines.toLocaleString("ru-RU")} qator o&apos;qildi ({d.source.parseFail} tanilmadi) · {d.source.error}: {d.source.errorLines.toLocaleString("ru-RU")} qator
          </p>
        </>
      )}
    </div>
  );
}
