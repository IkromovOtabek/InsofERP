import { requireAdmin } from "@/lib/control/auth";
import { CloudOff, CloudUpload, DatabaseBackup, FlaskConical, HardDrive } from "lucide-react";
import { loadInfraView } from "@/lib/control/infra/view";
import { infraKey, type RunLog } from "@/lib/control/infra/contract";
import { checkKey } from "@/lib/control/monitor/contract";
import { bytes, dt } from "@/lib/control/monitor/shared";
import { Badge, Callout, Card, CardHeader, DL, Empty, Progress, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { PageHeader } from "../../_ui";
import { ConnBadge } from "../_monitor/live";
import { ActionButton } from "../_monitor/action-dialog";
import { Ago, AgentHint, CheckBadge } from "../_monitor/bits";
import { InfraRefresh } from "../_infra/client";
import { LogTail, RecentActions } from "../_infra/recent";
import { HelpButton, PageHelp } from "../_help/help";

export const metadata = { title: "Zaxira nusxa" };
export const dynamic = "force-dynamic";

const TYPES = ["RUN_BACKUP", "RUN_RESTORE_TEST"];

function RunBadge({ r }: { r: RunLog }) {
  if (r.status === "OK") return <Badge color="green">Muvaffaqiyatli</Badge>;
  if (r.status === "FAILED") return <Badge color="red">Xato</Badge>;
  return <Badge color="slate">Noma&apos;lum</Badge>;
}

const ageTone = (iso: string | null, warnH: number) => {
  if (!iso) return "warning" as const;
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h > warnH ? ("warning" as const) : ("success" as const);
};

/** Zaxira: mahalliy nusxalar, oxirgi backup va tiklash sinovi (loglardan), masofadagi nusxa, disk prognozi. */
export default async function BackupPage() {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  const v = await loadInfraView(TYPES);
  const inv = v.backup;
  const invCheck = v.check(infraKey.backup());
  const latestCheck = v.check(checkKey.backup());
  const running = v.actions.filter((a) => a.status === "PENDING" || a.status === "RUNNING").map((a) => a.type);
  const latest = inv?.copies[0] ?? null;
  const disk = inv?.disk ?? null;
  const remote = inv?.remote ?? null;

  return (
    <div className="space-y-6">
      <InfraRefresh keys={[infraKey.backup(), checkKey.backup()]} types={TYPES} />
      <PageHeader
        title={<>Zaxira nusxa <ConnBadge /> <PageHelp topic="page:zaxira" /></>}
        subtitle="Har kecha server-backup.sh (cron) → /var/backups/insof va server tashqarisiga (rclone). Tiklash sinovi — har yakshanba. Ma'lumotni insof-agent har 5 daqiqada yig'adi."
        action={
          <div className="flex flex-wrap gap-2">
            <ActionButton type="RUN_RESTORE_TEST" icon="scan" disabled={running.includes("RUN_RESTORE_TEST")} label={running.includes("RUN_RESTORE_TEST") ? "Tiklash sinovi bajarilmoqda…" : undefined} />
            <ActionButton type="RUN_BACKUP" icon="database" variant="primary" disabled={running.includes("RUN_BACKUP")} label={running.includes("RUN_BACKUP") ? "Zaxira olinmoqda…" : "Hozir zaxira olish"} />
          </div>
        }
      />
      <AgentHint agent={v.snap.agent} />

      {!inv ? (
        <Card><Empty text="Zaxira inventari hali yig'ilmagan — agent yangilanib ishga tushgach 1–5 daqiqada paydo bo'ladi." icon={DatabaseBackup} /></Card>
      ) : (
        <>
          {inv.problems.length > 0 && (
            <Callout tone={invCheck?.status === "CRIT" ? "danger" : "warning"} title="E'tibor talab qiladi">
              <ul className="ml-4 list-disc space-y-0.5">{inv.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </Callout>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Oxirgi nusxa" icon={DatabaseBackup} tone={ageTone(latest?.at ?? null, 26)}
              value={latest?.at ? <Ago iso={latest.at} /> : "yo'q"}
              hint={latest ? <>{latest.name} · {bytes(latest.bytes)} · {latest.sha256sums ? "SHA256SUMS ✓" : "SHA256SUMS yo'q"}</> : undefined} />
            <StatCard label="Oxirgi zaxira jarayoni" icon={DatabaseBackup} tone={inv.lastBackup.status === "FAILED" ? "danger" : inv.lastBackup.status === "OK" ? "success" : "default"}
              value={<RunBadge r={inv.lastBackup} />} hint={inv.lastBackup.at ? <>{dt(inv.lastBackup.at)} (<Ago iso={inv.lastBackup.at} />)</> : "log topilmadi"} />
            <StatCard label="Tiklash sinovi" icon={FlaskConical} tone={inv.lastRestoreTest.status === "FAILED" ? "danger" : inv.lastRestoreTest.status === "OK" ? ageTone(inv.lastRestoreTest.at, 8 * 24) : "warning"}
              value={<RunBadge r={inv.lastRestoreTest} />} hint={inv.lastRestoreTest.at ? <>{dt(inv.lastRestoreTest.at)} (<Ago iso={inv.lastRestoreTest.at} />)</> : "hali o'tkazilmagan"} />
            <StatCard label="Masofadagi nusxa" icon={remote?.ok ? CloudUpload : CloudOff} tone={remote?.ok ? (latest && latest.remote === false ? "warning" : "success") : remote?.ok === false ? "danger" : "default"}
              value={remote?.ok ? `${remote.copies.length} ta` : remote?.ok === false ? "Xato" : "—"}
              hint={<span className="[overflow-wrap:anywhere]">{remote?.target ?? remote?.kind ?? ""}{remote?.latest ? ` · oxirgisi ${remote.latest}` : ""}</span>} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Masofadagi nusxa (server tashqarisida)" help={<HelpButton topic="zx:remote" />} icon={CloudUpload}
                description="rclone lsf / rclone about — 30 daqiqada bir tekshiriladi" />
              {remote ? (
                <>
                  {remote.error && <Callout tone={remote.ok === false ? "danger" : "info"}>{remote.error}</Callout>}
                  <DL items={[
                    { k: "Usul", v: <code>{remote.kind}</code> },
                    { k: "Manzil", v: remote.target ? <code data-no-translit>{remote.target}</code> : "—" },
                    { k: "Holat", v: remote.ok ? <Badge color="green">Ulanish bor</Badge> : remote.ok === false ? <Badge color="red">Xato</Badge> : <Badge color="slate">Tekshirilmadi</Badge> },
                    { k: "Nusxalar", v: remote.ok ? `${remote.copies.length} ta${remote.copies.length ? ` (${remote.copies[0]} … ${remote.latest})` : ""}` : "—" },
                    { k: "Oxirgi mahalliy nusxa masofada", v: latest ? (latest.remote == null ? "—" : latest.remote ? "bor ✓" : "YO'Q") : "—" },
                    ...(remote.quota ? [{ k: "Hajm (Drive)", v: `${bytes(remote.quota.used)} / ${bytes(remote.quota.total)} · bo'sh ${bytes(remote.quota.free)}${remote.quota.trashed ? ` · savatda ${bytes(remote.quota.trashed)}` : ""}` }] : []),
                    { k: "Tekshirildi", v: remote.checkedAt ? <Ago iso={remote.checkedAt} /> : "—" },
                  ]} />
                  {remote.quota?.total ? <div className="mt-3"><Progress value={remote.quota.used ?? 0} max={remote.quota.total} tone={(remote.quota.used ?? 0) / remote.quota.total > 0.9 ? "danger" : (remote.quota.used ?? 0) / remote.quota.total > 0.75 ? "warning" : "success"} /></div> : null}
                </>
              ) : <Empty text="Ma'lumot yo'q" />}
            </Card>

            <Card>
              <CardHeader title="Disk va prognoz" help={<HelpButton topic="zx:disk" />} icon={HardDrive} description={disk ? `${inv.dir} joylashgan disk` : undefined} />
              {disk ? (
                <>
                  <div className="mb-3">
                    <div className="mb-1 flex justify-between text-sm"><span>{bytes(disk.used)} / {bytes(disk.total)}</span><span className="tabular">{disk.pct ?? "—"}%</span></div>
                    <Progress value={disk.used} max={disk.used + disk.avail} tone={(disk.pct ?? 0) >= 90 ? "danger" : (disk.pct ?? 0) >= 80 ? "warning" : "success"} />
                  </div>
                  <DL items={[
                    { k: "Bo'sh joy", v: bytes(disk.avail) },
                    { k: "Mahalliy nusxalar jami", v: `${bytes(disk.backupsBytes)} (${inv.copies.length} ta)` },
                    { k: "O'rtacha nusxa (oxirgi 7)", v: bytes(disk.avgCopyBytes) },
                    { k: `Saqlash muddati to'lganda (${disk.keepDays} kun)`, v: bytes(disk.steadyStateBytes) },
                    { k: "Disk o'sishi", v: disk.growthPerDay != null ? `${disk.growthPerDay >= 0 ? "+" : "−"}${bytes(Math.abs(disk.growthPerDay))}/kun (${disk.sampleDays} kun bo'yicha)` : "hali yetarli ma'lumot yo'q" },
                    { k: "To'lishigacha", v: disk.daysToFull == null ? "o'smayapti / noma'lum" : <b className={disk.daysToFull < 14 ? "text-red-600" : undefined}>~{disk.daysToFull} kun</b> },
                  ]} />
                </>
              ) : <Empty text="Disk ma'lumoti yo'q" />}
            </Card>
          </div>

          <Card padded={false}>
            <div className="p-5 pb-0"><CardHeader title={`Mahalliy nusxalar (${inv.copies.length})`} help={<HelpButton topic="zx:copies" />} description={inv.dir} icon={DatabaseBackup} /></div>
            {inv.copies.length === 0 ? <div className="p-5"><Empty text="Hali birorta nusxa yo'q" /></div> : (
              <Table>
                <thead><tr><Th>Sana</Th><Th right>Hajm</Th><Th>Fayllar</Th><Th>SHA256SUMS</Th><Th>Masofada</Th></tr></thead>
                <tbody>
                  {inv.copies.map((c) => (
                    <Tr key={c.name}>
                      <Td><span className="font-medium tabular" data-no-translit>{c.at ? dt(c.at).slice(0, 16) : c.name}</span><div className="text-xs text-slate-400" data-no-translit>{c.name}</div></Td>
                      <Td right><span className="tabular">{bytes(c.bytes)}</span></Td>
                      <Td>
                        <details className="text-xs">
                          <summary className="cursor-pointer select-none text-slate-600">{c.files.length} ta fayl</summary>
                          <ul className="mt-1 space-y-0.5" data-no-translit>{c.files.map((f) => <li key={f.name} className="flex justify-between gap-3"><code>{f.name}</code><span className="tabular text-slate-500">{bytes(f.bytes)}</span></li>)}</ul>
                        </details>
                      </Td>
                      <Td>{c.sha256sums ? <Badge color="green">bor</Badge> : <Badge color="red">yo&apos;q</Badge>}</Td>
                      <Td>{c.remote == null ? <span className="text-slate-400">—</span> : c.remote ? <Badge color="green">bor</Badge> : <Badge color="amber">yo&apos;q</Badge>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {inv.partial.length > 0 && <p className="px-5 py-3 text-xs text-amber-700">Tugallanmagan: {inv.partial.join(", ")}</p>}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Oxirgi zaxira jarayoni" help={<HelpButton topic="zx:runs" />} description="/var/log/insof-backup.log" action={<RunBadge r={inv.lastBackup} />} />
              <p className="mb-2 text-sm text-slate-600 [overflow-wrap:anywhere]">{inv.lastBackup.summary ?? "—"}</p>
              <LogTail lines={inv.lastBackup.tail} label="Log" />
            </Card>
            <Card>
              <CardHeader title="Oxirgi tiklash sinovi" help={<HelpButton topic="zx:runs" />} description="/var/log/insof-restore-test.log" action={<RunBadge r={inv.lastRestoreTest} />} />
              <p className="mb-2 text-sm text-slate-600 [overflow-wrap:anywhere]">{inv.lastRestoreTest.summary ?? "—"}</p>
              <LogTail lines={inv.lastRestoreTest.tail} label="Log" />
            </Card>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {invCheck && <span className="flex items-center gap-1.5">Inventar: <CheckBadge s={invCheck.status} /> <Ago iso={invCheck.checkedAt} /></span>}
        {latestCheck && <span className="flex items-center gap-1.5">Yangilik tekshiruvi: <CheckBadge s={latestCheck.status} /> {latestCheck.message}</span>}
      </div>

      <RecentActions actions={v.actions} />
    </div>
  );
}
