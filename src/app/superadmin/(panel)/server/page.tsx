import { requireAdmin } from "@/lib/control/auth";
import { Cpu, HardDrive, PackageCheck, Power, ShieldCheck } from "lucide-react";
import { loadInfraView } from "@/lib/control/infra/view";
import { JOURNAL_KEEP, KEEP_RELEASES, infraKey } from "@/lib/control/infra/contract";
import { bytes, dt, duration } from "@/lib/control/monitor/shared";
import { Badge, Callout, Card, CardHeader, DL, Empty, PageHeader, Progress, Table, Td, Th, Tr } from "@/components/ui";
import { ConnBadge } from "../_monitor/live";
import { ActionButton } from "../_monitor/action-dialog";
import { Ago, AgentHint, CheckBadge } from "../_monitor/bits";
import { InfraRefresh, RebootButton } from "../_infra/client";
import { RecentActions } from "../_infra/recent";

export const metadata = { title: "Server tizimi" };
export const dynamic = "force-dynamic";

const TYPES = ["REBOOT", "REBOOT_CANCEL", "CLEAN_RELEASES", "JOURNAL_VACUUM"];

/**
 * Server tizimi: OS, yadro, qayta yuklash, yangilanishlar, unattended-upgrades, disk bo'yicha eng katta papkalar.
 * APT upgrade paneldan QILINMAYDI — faqat ko'rsatiladi (sabab sahifada va PLATFORMA.md da).
 */
export default async function ServerPage() {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  const v = await loadInfraView(TYPES);
  const s = v.system;
  const chk = v.check(infraKey.system());
  const host = v.snap.host;
  const running = v.actions.filter((a) => a.status === "PENDING" || a.status === "RUNNING").map((a) => a.type);
  const toDelete = s ? s.releases.filter((r, i) => i >= KEEP_RELEASES && !r.current) : [];
  const maxDir = s ? Math.max(1, ...s.dirs.map((d) => d.bytes ?? 0)) : 1;
  const unattendedOk = !!s?.unattended?.installed && s.unattended.periodic !== false && s.unattended.enabled !== false;

  return (
    <div className="space-y-6">
      <InfraRefresh keys={[infraKey.system(), "host:reboot"]} types={TYPES} />
      <PageHeader
        title={<>Server tizimi <ConnBadge /></>}
        subtitle="Operatsion tizim, yadro, yangilanishlar va disk. Ma'lumotni insof-agent yig'adi (disk o'lchami 30 daqiqada, apt — soatda bir)."
        action={chk ? <span className="flex items-center gap-2 text-xs text-slate-500"><CheckBadge s={chk.status} /> <Ago iso={chk.checkedAt} /></span> : undefined}
      />
      <AgentHint agent={v.snap.agent} />

      {!s ? <Card><Empty text="Tizim ma'lumoti hali yig'ilmagan — agent yangilanib ishga tushgach 1–5 daqiqada paydo bo'ladi." icon={Cpu} /></Card> : (
        <>
          {s.problems.length > 0 && <Callout tone="warning" title="E'tibor talab qiladi"><ul className="ml-4 list-disc">{s.problems.map((p) => <li key={p}>{p}</li>)}</ul></Callout>}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Tizim" icon={Cpu} />
              <DL items={[
                { k: "Server", v: <span data-no-translit>{host?.hostname ?? v.snap.agent?.hostname ?? "—"}</span> },
                { k: "OS", v: s.os ?? "—" },
                { k: "Yadro (ishlayotgan)", v: <code data-no-translit>{s.kernel}</code> },
                { k: "Kutilayotgan yadro", v: s.pendingKernel ? <span className="text-amber-700"><code data-no-translit>{s.pendingKernel}</code> — qayta yuklashda yoqiladi</span> : "yo'q" },
                { k: "Ishlash vaqti (uptime)", v: <>{duration(s.uptimeSec)} <span className="text-slate-500">(yoqilgan {dt(s.bootedAt)})</span></> },
              ]} />
            </Card>

            <Card>
              <CardHeader title="Qayta yuklash" icon={Power}
                action={<div className="flex flex-wrap gap-2">
                  {s.scheduledShutdown && <ActionButton type="REBOOT_CANCEL" label="Bekor qilish" icon="ban" disabled={running.includes("REBOOT_CANCEL")} />}
                  <RebootButton hostname={host?.hostname ?? v.snap.agent?.hostname ?? null} disabled={running.includes("REBOOT")} />
                </div>} />
              {s.scheduledShutdown && (
                <Callout tone="warning" title="Qayta yuklash rejalashtirilgan">
                  {dt(s.scheduledShutdown.at)} (<span data-no-translit>{s.scheduledShutdown.mode}</span>). Bekor qilish — «Bekor qilish» tugmasi.
                </Callout>
              )}
              <DL items={[
                { k: "Qayta yuklash kerakmi", v: s.rebootRequired ? <Badge color="amber">Ha — yangilanishlar kutmoqda</Badge> : <Badge color="green">Kerak emas</Badge> },
                { k: "Sabab paketlar", v: s.rebootPkgs.length ? <span className="text-xs" data-no-translit>{s.rebootPkgs.join(", ")}</span> : "—" },
              ]} />
              <p className="mt-3 text-xs text-slate-500">
                Qayta yuklash <code>shutdown -r</code> orqali: «hozir» — 1 daqiqadan keyin (Telegram xabari va bekor qilish imkoni uchun), yoki HH:MM (o&apos;tgan bo&apos;lsa — ertaga).
                Barcha xizmatlar systemd orqali o&apos;zi ko&apos;tariladi; zaxira yoki korxona sozlanayotgan paytda rad etiladi.
              </p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Yangilanishlar (apt)" icon={PackageCheck} description={s.updates?.checkedAt ? `apt list --upgradable · ${dt(s.updates.checkedAt)}` : undefined} />
              {s.updates ? (
                <>
                  {s.updates.error && <Callout tone="danger">{s.updates.error}</Callout>}
                  <div className="mb-3 grid grid-cols-2 gap-3 text-center">
                    <div className="rounded-lg bg-slate-50 p-3"><div className="text-2xl font-semibold tabular">{s.updates.total}</div><div className="text-xs text-slate-500">yangilanadigan paket</div></div>
                    <div className={`rounded-lg p-3 ${s.updates.security ? "bg-red-50" : "bg-emerald-50"}`}><div className={`text-2xl font-semibold tabular ${s.updates.security ? "text-red-700" : "text-emerald-700"}`}>{s.updates.security}</div><div className="text-xs text-slate-500">xavfsizlik yangilanishi</div></div>
                  </div>
                  {s.updates.securityPkgs.length > 0 && <p className="mb-2 text-xs text-slate-600" data-no-translit>{s.updates.securityPkgs.join(", ")}</p>}
                  <DL items={[{ k: "Paketlar ro'yxati yangilangan (apt update)", v: s.aptListsAt ? <Ago iso={s.aptListsAt} /> : "—" }]} />
                </>
              ) : <Empty text="apt yo'q (Ubuntu emas yoki lokal muhit)" />}
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <b>Paketlar paneldan yangilanmaydi.</b> <code>apt upgrade</code> root huquqida ixtiyoriy paket skriptlarini bajaradi, uzoq davom etadi,
                konfiguratsiya savollari (dpkg) va nginx/postgres/node qayta ishga tushishi bilan butun platformani to&apos;xtatishi mumkin — buni kuzatib turgan
                odam SSH orqali qilishi kerak. Xavfsizlik yangilanishlarini <b>unattended-upgrades</b> o&apos;zi har kuni qo&apos;yadi; qolganini rejali texnik
                oynada: <code>sudo apt update &amp;&amp; sudo apt upgrade</code>, keyin kerak bo&apos;lsa shu sahifadan qayta yuklash.
              </div>
            </Card>

            <Card>
              <CardHeader title="Avtomatik xavfsizlik yangilanishlari" icon={ShieldCheck} action={s.unattended ? (unattendedOk ? <Badge color="green">Yoqilgan</Badge> : <Badge color="red">O&apos;chiq</Badge>) : undefined} />
              {s.unattended ? (
                <DL items={[
                  { k: "unattended-upgrades o'rnatilgan", v: s.unattended.installed ? "ha" : "yo'q" },
                  { k: "Xizmat (systemd)", v: `${s.unattended.enabled == null ? "?" : s.unattended.enabled ? "enabled" : "disabled"} / ${s.unattended.active ?? "?"}` },
                  { k: "20auto-upgrades", v: s.unattended.periodic == null ? "fayl yo'q" : s.unattended.periodic ? "Unattended-Upgrade \"1\"" : "o'chirilgan (\"0\")" },
                  { k: "Oxirgi ishga tushish", v: s.unattended.lastRun ? <><Ago iso={s.unattended.lastRun} /></> : "—" },
                  { k: "Oxirgi log qatori", v: <span className="text-xs font-normal" data-no-translit>{s.unattended.lastLine ?? "—"}</span> },
                ]} />
              ) : <Empty text="Ma'lumot yo'q" />}
              {s.unattended && !unattendedOk && <p className="mt-3 text-xs text-slate-600">Yoqish (SSH): <code>sudo apt install -y unattended-upgrades &amp;&amp; sudo dpkg-reconfigure -plow unattended-upgrades</code> (docs/server-xavfsizlik.md 3.3).</p>}
            </Card>
          </div>

          <Card>
            <CardHeader title="Disk: eng katta papkalar" icon={HardDrive}
              description={host ? `/ — ${bytes(host.diskUsed)} / ${bytes(host.diskTotal)}` : undefined}
              action={<div className="flex flex-wrap gap-2">
                <ActionButton type="JOURNAL_VACUUM" icon="trash" disabled={running.includes("JOURNAL_VACUUM")} label={`Jurnalni tozalash (${JOURNAL_KEEP.replace("d", " kun")})`} />
                <ActionButton type="CLEAN_RELEASES" icon="trash" disabled={running.includes("CLEAN_RELEASES") || toDelete.length === 0} label={toDelete.length ? `Eski relizlarni o'chirish (${toDelete.length})` : "Eski reliz yo'q"} />
              </div>} />
            {host && <div className="mb-4"><Progress value={host.diskUsed} max={host.diskTotal} tone={host.diskUsed / Math.max(1, host.diskTotal) > 0.9 ? "danger" : host.diskUsed / Math.max(1, host.diskTotal) > 0.8 ? "warning" : "success"} /></div>}
            <ul className="space-y-2.5">
              {s.dirs.map((d) => (
                <li key={d.path}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    <span>{d.label} <code className="text-xs text-slate-400" data-no-translit>{d.path}</code>{d.note ? <span className="text-xs text-slate-500"> · {d.note}</span> : null}</span>
                    <span className="font-medium tabular">{bytes(d.bytes)}</span>
                  </div>
                  <Progress value={d.bytes ?? 0} max={maxDir} />
                </li>
              ))}
            </ul>
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-0"><CardHeader title={`Relizlar (${s.releases.length})`} description={`Eng yangi ${KEEP_RELEASES} ta va joriy (current) saqlanadi — orqaga qaytarish (ROLLBACK) uchun. Qolgani «Eski relizlarni o'chirish» bilan o'chadi.`} /></div>
            {s.releases.length === 0 ? <div className="p-5"><Empty text="releases/ bo'sh yoki topilmadi" /></div> : (
              <Table>
                <thead><tr><Th>Reliz</Th><Th>Sana</Th><Th right>Hajm</Th><Th>Holat</Th></tr></thead>
                <tbody>
                  {s.releases.map((r, i) => (
                    <Tr key={r.name}>
                      <Td><code data-no-translit>{r.name.slice(0, 12)}</code></Td>
                      <Td><span className="tabular" data-no-translit>{dt(r.mtime)}</span></Td>
                      <Td right><span className="tabular">{bytes(r.bytes)}</span></Td>
                      <Td>{r.current ? <Badge color="green">joriy (current)</Badge> : i < KEEP_RELEASES ? <Badge color="blue">saqlanadi</Badge> : <Badge color="amber">o&apos;chiriladi</Badge>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      <RecentActions actions={v.actions} />
    </div>
  );
}
