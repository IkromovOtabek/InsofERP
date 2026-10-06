import { requireAdmin } from "@/lib/control/auth";
import { Activity, Clock, Database, Gauge, HardDrive, Lock, Table2, Zap } from "lucide-react";
import { control } from "@/lib/control/db";
import { DBT_KEYS, DBT_THRESHOLDS } from "@/lib/control/dbtraffic/contract";
import { asDbStats, type PgDbInfo, type PgSession, type PgTable } from "@/lib/control/dbtraffic/types";
import { bytes, duration } from "@/lib/control/monitor/shared";
import { Badge, Callout, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ConnBadge } from "../_monitor/live";
import { ActionButton } from "../_monitor/action-dialog";
import { Ago, CheckBadge } from "../_monitor/bits";
import { RefreshOnChecks } from "./refresh";

export const metadata = { title: "Baza (PostgreSQL)" };
export const dynamic = "force-dynamic";

const pctTxt = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${v.toFixed(digits)}%`);
const growth = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${bytes(Math.abs(v))}`);
const sec = (v: number | null) => (v == null ? "—" : duration(v));
const STATE_LABEL: Record<string, string> = {
  active: "faol (so'rov bajarilmoqda)",
  idle: "bo'sh (idle)",
  "idle in transaction": "tranzaksiyada kutmoqda",
  "idle in transaction (aborted)": "xato tranzaksiyada kutmoqda",
  fastpath: "fastpath",
  disabled: "o'chirilgan",
};

/** PostgreSQL: bazalar hajmi va o'sishi, katta jadvallar, ulanishlar, uzoq tranzaksiya/so'rovlar, qulflar, og'ir so'rovlar. */
export default async function DbPage() {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  const row = await control.serviceCheck.findUnique({ where: { key: DBT_KEYS.dbStats } });
  const d = asDbStats(row?.data);

  return (
    <div className="space-y-6">
      <RefreshOnChecks prefixes={[DBT_KEYS.dbStats]} actions={["PG_CANCEL", "PG_TERMINATE", "VACUUM_ANALYZE", "RUN_HEALTH_CHECK"]} />
      <PageHeader
        title={<>Baza (PostgreSQL) <ConnBadge /></>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">insof-agent har 5 daqiqada yig&apos;adi.{row && <> Oxirgi: <Ago iso={row.checkedAt.toISOString()} /> <CheckBadge s={row.status} /></>}</span>}
        action={<ActionButton type="RUN_HEALTH_CHECK" label="Hozir yangilash" icon="refresh" />}
      />

      {!d ? (
        <EmptyState icon={Database} title="Baza statistikasi hali yo'q" text="insof-agent ishga tushgach (yangi versiya) 5 daqiqa ichida shu yerda chiqadi. Agent o'rnatilmagan bo'lsa — PLATFORMA.md → Monitoring agenti." />
      ) : (
        <>
          {d.problems.length > 0 && (
            <Callout tone="warning" title="E'tibor talab qiladi">
              <ul className="list-disc space-y-0.5 pl-5">{d.problems.map((p) => <li key={p} data-no-translit>{p}</li>)}</ul>
            </Callout>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Ulanishlar" icon={Activity} value={<>{d.connections.total}<span className="text-sm font-normal text-slate-500"> / {d.connections.max}</span></>}
              hint={pctTxt(d.connections.pct)} tone={(d.connections.pct ?? 0) >= 80 ? "danger" : "default"} />
            <StatCard label="Cache hit" icon={Zap} value={d.cacheHit == null ? "—" : pctTxt(d.cacheHit * 100, 2)} hint="shared_buffers dan o'qilgan ulush"
              tone={d.cacheHit != null && d.cacheHit < DBT_THRESHOLDS.cacheHitWarn ? "warning" : "default"} />
            <StatCard label="Qulf kutayotganlar" icon={Lock} value={d.lockWaits} tone={d.lockWaits > 0 ? "warning" : "default"} />
            <StatCard label="Uzoq tranzaksiyalar (>1 daq)" icon={Clock} value={d.longXacts.length} hint={d.idleInXactLong ? `${d.idleInXactLong} tasi 10+ daq idle` : undefined} tone={d.idleInXactLong ? "warning" : "default"} />
            <StatCard label="Jami hajm" icon={HardDrive} value={bytes(d.databases.reduce((s, x) => s + (x.sizeBytes ?? 0), 0))} hint={`${d.databases.length} baza`} />
          </div>

          <p className="text-xs text-slate-500" data-no-translit>
            PostgreSQL {d.server.version} · agent roli <code>{d.server.role}</code>{d.server.superuser ? " (superuser)" : " (superuser emas — faqat o'z so'rovlarini bekor qila oladi)"}
            {d.server.readAllStats ? " · pg_read_all_stats" : ""} · ishga tushgan: {d.server.startedAt ? <Ago iso={d.server.startedAt} /> : "—"}
          </p>

          {/* ── Bazalar ── */}
          <Card padded={false}>
            <div className="p-5 pb-0"><CardHeader title="Bazalar" description="Hajm va kunlik o'sish (agent har kuni yozadi), ulanishlar, cache hit, o'lik qatorlar" icon={Database} /></div>
            <Table className="rounded-none border-0 shadow-none">
              <thead><tr><Th>Baza</Th><Th right>Hajm</Th><Th right>1 kun</Th><Th right>7 kun</Th><Th right>Ulanish</Th><Th right>Cache hit</Th><Th right>O&apos;lik qator</Th><Th right>Deadlock</Th><Th /></tr></thead>
              <tbody>
                {d.databases.map((x) => (
                  <Tr key={x.name}>
                    <Td><span data-no-translit>{x.name}</span>{x.owner && <div className="text-xs font-normal text-slate-500" data-no-translit>{x.owner === "control" ? "IT panel (control)" : `korxona: ${x.owner}`}</div>}</Td>
                    <Td right>{bytes(x.sizeBytes)}</Td>
                    <Td right className={(x.growth1d ?? 0) > 0 ? "text-slate-900" : undefined}>{growth(x.growth1d)}</Td>
                    <Td right>{growth(x.growth7d)}</Td>
                    <Td right>{x.conns}</Td>
                    <Td right>{x.cacheHit == null ? "—" : pctTxt(x.cacheHit * 100, 2)}</Td>
                    <Td right>{x.detail?.ok ? pctTxt(x.detail.deadPct) : "—"}</Td>
                    <Td right>{x.deadlocks || "—"}</Td>
                    <Td right>{x.owner && <ActionButton type="VACUUM_ANALYZE" params={{ db: x.name }} label="VACUUM" icon="wrench" />}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* ── Ulanishlar ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Ulanishlar holat bo'yicha" description={`Mijoz ulanishlari; fon jarayonlari (autovacuum, wal…): ${d.connections.background}`} icon={Activity} />
              <ul className="divide-y divide-slate-100 text-sm">
                {Object.entries(d.connections.byState).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                  <li key={s} className="flex items-center justify-between gap-3 py-1.5"><span><code className="text-xs" data-no-translit>{s}</code> <span className="text-slate-500">{STATE_LABEL[s] ?? ""}</span></span><b className="tabular">{n}</b></li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Ulanishlar baza bo'yicha" icon={Database} />
              <ul className="divide-y divide-slate-100 text-sm">
                {Object.entries(d.connections.byDb).sort((a, b) => b[1] - a[1]).map(([db, n]) => (
                  <li key={db} className="flex items-center justify-between gap-3 py-1.5"><code className="text-xs" data-no-translit>{db}</code><b className="tabular">{n}</b></li>
                ))}
              </ul>
            </Card>
          </div>

          <SessionList title="Uzoq so'rovlar (> 30 s)" icon={Gauge} empty="Hozir 30 soniyadan uzoq bajarilayotgan so'rov yo'q." list={d.longQueries} />
          <SessionList title="Uzoq tranzaksiyalar (> 1 daq)" icon={Clock} empty="1 daqiqadan uzoq ochiq tranzaksiya yo'q." list={d.longXacts} />
          <SessionList title="Qulf kutayotganlar" icon={Lock} empty="Qulf kutayotgan so'rov yo'q." list={d.lockWaiters} showBlockers />

          {/* ── Jadvallar ── */}
          <section aria-labelledby="tables-h" className="space-y-3">
            <h2 id="tables-h" className="flex items-center gap-2 text-base font-semibold text-slate-900"><Table2 size={16} aria-hidden /> Eng katta jadvallar</h2>
            {d.databases.filter((x) => x.detail).map((x, i) => <DbTables key={x.name} db={x} open={i === 0} />)}
          </section>

          {/* ── pg_stat_statements ── */}
          <Card>
            <CardHeader title="Eng og'ir so'rovlar (pg_stat_statements)" description="Jami bajarilish vaqti bo'yicha top 10 — qiymatlar yashirilgan" icon={Zap} />
            {d.statements.state === "ok" ? (
              d.statements.list.length === 0 ? <p className="text-sm text-slate-500">Hali statistika yo&apos;q.</p> : (
                <ol className="space-y-3">
                  {d.statements.list.map((s, k) => (
                    <li key={k} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span className="font-semibold text-slate-400">{k + 1}.</span>
                        <span>jami <b className="text-slate-900">{duration(s.totalMs / 1000)}</b>{s.sharePct != null ? ` (${s.sharePct}%)` : ""}</span>
                        <span>chaqiruv <b className="text-slate-900">{s.calls.toLocaleString("ru-RU")}</b></span>
                        <span>o&apos;rtacha <b className="text-slate-900">{s.meanMs} ms</b></span>
                        <span>qator {s.rows.toLocaleString("ru-RU")}</span>
                        <span>cache {pctTxt(s.hitPct)}</span>
                        {s.db && <code data-no-translit>{s.db}</code>}
                      </div>
                      <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800" data-no-translit>{s.query}</pre>
                    </li>
                  ))}
                </ol>
              )
            ) : <StatementsHelp state={d.statements.state} error={d.statements.error} db={d.statements.db || d.server.controlDb} role={d.server.role} />}
          </Card>
        </>
      )}
    </div>
  );
}

function SessionList({ title, icon, empty, list, showBlockers }: { title: string; icon: typeof Clock; empty: string; list: PgSession[]; showBlockers?: boolean }) {
  return (
    <Card>
      <CardHeader title={title} icon={icon} description={list.length ? "So'rov matnidagi qiymatlar (satr, son) yashirilgan" : undefined} />
      {list.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : (
        <ul className="divide-y divide-slate-100">
          {list.map((s) => (
            <li key={s.pid} className="space-y-1.5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <code className="font-semibold" data-no-translit>pid {s.pid}</code>
                <Badge color={s.state === "active" ? "blue" : s.state?.startsWith("idle in transaction") ? "amber" : "slate"}><span data-no-translit>{s.state ?? "?"}</span></Badge>
                <span className="text-xs text-slate-600" data-no-translit>{s.db ?? "—"} · {s.user ?? "?"}{s.app ? ` · ${s.app}` : ""}{s.client ? ` · ${s.client}` : ""}</span>
                <span className="text-xs text-slate-600">so&apos;rov: <b>{sec(s.querySec)}</b> · tranzaksiya: <b>{sec(s.xactSec)}</b> · holatda: <b>{sec(s.stateSec)}</b></span>
                {s.wait && <span className="text-xs text-amber-700" data-no-translit>kutmoqda: {s.waitType}/{s.wait}</span>}
                {showBlockers && s.blockedBy.length > 0 && <span className="text-xs text-red-700" data-no-translit>to&apos;sib turgan pid: {s.blockedBy.join(", ")}</span>}
                <span className="ml-auto flex flex-wrap gap-2">
                  {s.canCancel && s.db && <ActionButton type="PG_CANCEL" params={{ db: s.db, pid: String(s.pid) }} label="Bekor qilish" icon="ban" variant="secondary" />}
                  {s.canTerminate && s.db && <ActionButton type="PG_TERMINATE" params={{ db: s.db, pid: String(s.pid) }} label="Ulanishni uzish" icon="ban" variant="danger" />}
                  {!s.mine && <span className="text-xs text-slate-400">boshqa rol — to&apos;xtatib bo&apos;lmaydi</span>}
                </span>
              </div>
              {s.query && <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800" data-no-translit>{s.query}</pre>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DbTables({ db, open }: { db: PgDbInfo; open: boolean }) {
  const det = db.detail!;
  const vacuumable = (t: PgTable) => t.schema === "public";
  return (
    <details open={open} className="group rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
        <b data-no-translit>{db.name}</b>
        <span className="text-slate-500">{bytes(db.sizeBytes)} · {det.ok ? `${det.tableCount} jadval · o'lik qator ${pctTxt(det.deadPct)}` : "o'qib bo'lmadi"}</span>
      </summary>
      {!det.ok ? <p className="px-4 pb-4 text-sm text-red-700" data-no-translit>{det.error}</p> : (
        <div className="space-y-4 px-4 pb-4">
          <TableRows rows={det.tables} db={db.name} vacuumable={vacuumable} />
          {det.deadTables.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">O&apos;lik qatorlar ulushi eng yuqori</h3>
              <TableRows rows={det.deadTables} db={db.name} vacuumable={vacuumable} />
            </div>
          )}
        </div>
      )}
    </details>
  );
}

function TableRows({ rows, db, vacuumable }: { rows: PgTable[]; db: string; vacuumable: (t: PgTable) => boolean }) {
  return (
    <Table>
      <thead><tr><Th>Jadval</Th><Th right>Hajm</Th><Th right>Qator (taxm.)</Th><Th right>O&apos;lik</Th><Th>Oxirgi autovacuum</Th><Th>Oxirgi analyze</Th><Th /></tr></thead>
      <tbody>
        {rows.map((t) => {
          const vac = t.lastAutovacuum && t.lastVacuum ? (t.lastAutovacuum > t.lastVacuum ? t.lastAutovacuum : t.lastVacuum) : t.lastAutovacuum ?? t.lastVacuum;
          const an = t.lastAutoanalyze && t.lastAnalyze ? (t.lastAutoanalyze > t.lastAnalyze ? t.lastAutoanalyze : t.lastAnalyze) : t.lastAutoanalyze ?? t.lastAnalyze;
          const deadWarn = (t.dead ?? 0) >= DBT_THRESHOLDS.deadTupMin && (t.deadPct ?? 0) >= DBT_THRESHOLDS.deadRatioWarn * 100;
          return (
            <Tr key={`${t.schema}.${t.name}`}>
              <Td><span data-no-translit>{t.schema === "public" ? t.name : `${t.schema}.${t.name}`}</span></Td>
              <Td right>{bytes(t.totalBytes)}</Td>
              <Td right>{t.estRows.toLocaleString("ru-RU")}</Td>
              <Td right className={deadWarn ? "font-medium text-amber-700" : undefined}>{t.dead == null ? "—" : `${t.dead.toLocaleString("ru-RU")} (${pctTxt(t.deadPct)})`}</Td>
              <Td>{vac ? <Ago iso={vac} /> : <span className="text-slate-400">hech qachon</span>}</Td>
              <Td>{an ? <Ago iso={an} /> : <span className="text-slate-400">hech qachon</span>}</Td>
              <Td right>{vacuumable(t) && <ActionButton type="VACUUM_ANALYZE" params={{ db, table: t.name }} label="VACUUM" icon="wrench" variant="ghost" />}</Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function StatementsHelp({ state, error, db, role }: { state: string; error?: string; db: string; role: string }) {
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <p>
        {state === "not_loaded" ? "pg_stat_statements kengaytmasi yaratilgan, lekin server konfiguratsiyasida yuklanmagan."
          : state === "not_installed" ? "pg_stat_statements yoqilmagan — eng og'ir so'rovlar ro'yxati uchun kerak."
            : <>pg_stat_statements o&apos;qilmadi: <code data-no-translit>{error}</code></>}
        {" "}Panel buni o&apos;zi yoqmaydi (Postgres qayta ishga tushadi — barcha korxonalar uchun 5–10 s uzilish). Serverda qo&apos;lda, kam yuklama paytida:
      </p>
      <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800" data-no-translit>{`# 1) joriy qiymatni ko'ring (bo'sh bo'lmasa — vergul bilan qo'shing)
sudo -u postgres psql -c "SHOW shared_preload_libraries"
sudo -u postgres psql -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'"
# 2) Postgres'ni qayta ishga tushirish (UZILISH 5-10 s)
sudo systemctl restart postgresql@14-main
# 3) kengaytmani control bazada yaratish va agent roliga statistikani o'qish huquqi
sudo -u postgres psql -d ${db} -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
sudo -u postgres psql -c "GRANT pg_read_all_stats TO ${role}"`}</pre>
      <p className="text-xs text-slate-500">Batafsil: docs/deploy/PLATFORMA.md → «Baza va trafik».</p>
    </div>
  );
}
