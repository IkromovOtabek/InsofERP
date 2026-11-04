import Link from "next/link";
import { ChevronLeft, ChevronRight, LogIn, Monitor, MousePointerClick, Smartphone, UserX, Users } from "lucide-react";
import type { Role } from "@/generated/prisma";
import { ROLE_LABELS } from "@/lib/nav";
import { DEVICES, LOGIN_METHODS, type LoginMethod } from "@/lib/visit-info";
import { JOURNAL_PAGE, sectionLabel, tenantVisits, VISIT_DAYS, type VisitFilter } from "@/lib/control/visits";
import { dateTime, fmtNum } from "@/lib/format";
import { Badge, Button, Callout, Card, CardHeader, Checkbox, Empty, Field, Progress, Select, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ago } from "../../status";

const DAY_LABEL: Record<number, string> = { 1: "Bugun", 7: "7 kun", 30: "30 kun", 90: "90 kun" };
const roleLabel = (r: string) => (r === "SUPERADMIN" ? "IT (SSO)" : ROLE_LABELS[r as Role] ?? r);
const deviceLabel = (d: string) => DEVICES[d as keyof typeof DEVICES] ?? d;
const methodLabel = (m: string | null) => (m ? LOGIN_METHODS[m as LoginMethod] ?? m : "—");
const client = (os: string | null, browser: string | null) => [os, browser].filter(Boolean).join(" · ") || "—";

/**
 * Korxona → «Tashriflar»: kim, qachon, qaysi bo'limni, qaysi qurilmadan ochdi va qanday kirdi.
 * Manba — korxona bazasidagi `VisitLog` (`lib/control/visits.ts`), filtrlar URL'da (`?tab=tashriflar&kun=7&u=…`).
 */
export async function TenantVisitsTab({ slug, dbName, f }: { slug: string; dbName: string; f: VisitFilter }) {
  const v = await tenantVisits(dbName, f);
  const base = `/superadmin/korxonalar/${slug}`;
  const q = (o: Partial<Record<"kun" | "u" | "qurilma" | "tur" | "it" | "bet", string | number | undefined>>) => {
    const p = new URLSearchParams({ tab: "tashriflar" });
    const all = { kun: f.days, u: f.userId, qurilma: f.device, tur: f.kind, it: f.it ? 1 : undefined, ...o };
    for (const [k, x] of Object.entries(all)) if (x !== undefined && x !== "" && !(k === "kun" && x === 7) && !(k === "bet" && x === 0)) p.set(k, String(x));
    return `${base}?${p}`;
  };

  if (!v.ok) {
    return v.reason === "nolog"
      ? <Callout tone="warning" title="Tashriflar jurnali hali yo'q">Korxona bazasi yangilanmagan — keyingi deploy'dagi migratsiyadan keyin (<code>VisitLog</code> jadvali) tashriflar yozila boshlaydi.</Callout>
      : <Callout tone="danger" title="Tashriflarni o'qib bo'lmadi">{v.reason === "missing" ? "Korxona bazasi mavjud emas." : v.error}</Callout>;
  }

  const maxDay = Math.max(1, ...v.days.map((d) => d.views));
  const totalDevUsers = v.devices.reduce((a, d) => a + d.users, 0);
  const who = f.userId ? v.users.find((u) => u.id === f.userId) : undefined;
  const pages = Math.ceil(v.journalTotal / JOURNAL_PAGE);

  return (
    <div className="space-y-5">
      <Card>
        <form method="get" action={base} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="tashriflar" />
          <Field label="Davr">
            <Select name="kun" defaultValue={String(f.days)}>{VISIT_DAYS.map((d) => <option key={d} value={d}>{DAY_LABEL[d]}</option>)}</Select>
          </Field>
          <Field label="Xodim">
            <Select name="u" defaultValue={f.userId ?? ""}>
              <option value="">Hammasi</option>
              {v.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
          </Field>
          <Field label="Qurilma">
            <Select name="qurilma" defaultValue={f.device ?? ""}>
              <option value="">Hammasi</option>
              {Object.entries(DEVICES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Tur">
            <Select name="tur" defaultValue={f.kind ?? ""}>
              <option value="">Sahifa va kirish</option>
              <option value="PAGE">Faqat sahifalar</option>
              <option value="LOGIN">Faqat kirishlar</option>
            </Select>
          </Field>
          <Checkbox name="it" value="1" defaultChecked={f.it} label="IT (SSO) kirishlari ham" className="pb-2" />
          <Button size="sm">Ko&apos;rsatish</Button>
          {(f.userId || f.device || f.kind || f.it || f.days !== 7) && <Link href={`${base}?tab=tashriflar`} className="pb-2 text-sm text-slate-500 underline">Tozalash</Link>}
        </form>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Bugun kirgan xodimlar" value={v.usersToday} icon={Users} tone="brand" href={q({ kun: 1, bet: 0 })} />
        <StatCard label={`Faol xodimlar · ${DAY_LABEL[f.days].toLowerCase()}`} value={v.usersPeriod} hint={`kirmagan: ${v.silent.length}`} icon={Monitor} href="#xodimlar" />
        <StatCard label="Sahifa ochilishi" value={fmtNum(v.viewsPeriod)} hint={v.usersPeriod ? `xodimga o'rtacha ${fmtNum(Math.round(v.viewsPeriod / v.usersPeriod))}` : undefined} icon={MousePointerClick} href={q({ tur: "PAGE", bet: 0 })} />
        <StatCard label="Tizimga kirishlar" value={fmtNum(v.loginsPeriod)} icon={LogIn} href={q({ tur: "LOGIN", bet: 0 })} />
      </div>

      {f.days > 1 && v.days.length > 0 && (
        <Card>
          <CardHeader title="Kunlar bo'yicha" description="Ustun — sahifa ochilishi, raqam — o'sha kuni kirgan xodimlar" />
          <div className="flex h-36 items-end gap-1 overflow-x-auto pb-1" role="img" aria-label="Kunlik tashriflar">
            {v.days.map((d, i) => (
              <div key={d.day} className="flex min-w-3 max-w-12 flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${d.users} xodim, ${d.views} sahifa`}>
                <span className="text-[10px] tabular text-slate-500">{d.users || ""}</span>
                <div className="w-full rounded-t" style={{ height: `${d.views ? Math.max(3, Math.round((d.views / maxDay) * 100)) : 2}px`, background: d.views ? "var(--c1)" : "var(--line)" }} />
                {(f.days <= 30 || i % 7 === 0) && <span className="text-[10px] tabular text-slate-400">{d.day.slice(8)}.{d.day.slice(5, 7)}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Qurilmalar" description="Xodimlar soni bo'yicha (bir xodim bir necha qurilmadan kirgan bo'lishi mumkin)" icon={Smartphone} />
          {v.devices.length === 0 ? <Empty text="Tashrif yo'q" /> : (
            <ul className="space-y-3">
              {v.devices.map((d) => (
                <li key={d.device}>
                  <div className="mb-1 flex justify-between gap-2 text-sm"><Link href={q({ qurilma: d.device, bet: 0 })} className="font-medium hover:underline">{deviceLabel(d.device)}</Link><span className="tabular text-slate-500">{d.users} xodim · {fmtNum(d.views)} yozuv</span></div>
                  <Progress value={d.users} max={totalDevUsers} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Eng ko'p ochilgan bo'limlar" /></div>
          <Table>
            <thead><tr><Th>Bo&apos;lim</Th><Th right>Ochilish</Th><Th right>Xodim</Th></tr></thead>
            <tbody>
              {v.sections.length === 0 && <Empty text="Sahifa ochilmagan" />}
              {v.sections.map((s) => <Tr key={s.label}><Td className="text-sm">{s.label}</Td><Td right className="tabular">{fmtNum(s.views)}</Td><Td right className="tabular">{s.users}</Td></Tr>)}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card padded={false}>
        <div id="xodimlar" className="scroll-mt-20 px-5 pt-5"><CardHeader title={`Xodimlar · ${DAY_LABEL[f.days].toLowerCase()}`} description="Oxirgi faollik bo'yicha; qatorni bossangiz — shu xodimning jurnali" icon={Users} /></div>
        <Table>
          <thead><tr><Th>Xodim</Th><Th>Oxirgi faollik</Th><Th>Oxirgi sahifa</Th><Th>Qurilma</Th><Th>IP</Th><Th right>Sahifa</Th><Th>Oxirgi kirish</Th></tr></thead>
          <tbody>
            {v.users.length === 0 && <Empty text="Bu davrda hech kim kirmagan" />}
            {v.users.map((u) => (
              <Tr key={u.id} className={u.id === f.userId ? "bg-slate-50" : ""}>
                <Td><Link href={q({ u: u.id, bet: 0 })} className="font-medium hover:underline">{u.fullName}</Link><div className="text-xs text-slate-500" data-no-translit>{u.login} · {roleLabel(u.role)}</div></Td>
                <Td className="text-sm tabular">{dateTime(u.lastAt)}<div className="text-xs text-slate-500">{ago(u.lastAt)}</div></Td>
                <Td className="text-sm">{u.lastPath ? sectionLabel(u.lastPath) : <span className="text-slate-400">kirish</span>}</Td>
                <Td className="text-sm">{deviceLabel(u.device)}<div className="text-xs text-slate-500">{client(u.os, u.browser)}</div></Td>
                <Td className="text-xs tabular text-slate-600" data-no-translit>{u.ip ?? "—"}</Td>
                <Td right className="tabular">{fmtNum(u.visits)}</Td>
                <Td className="text-sm">{u.lastLogin ? <>{dateTime(u.lastLogin.at)}<div className="text-xs text-slate-500">{methodLabel(u.lastLogin.method)}</div></> : <span className="text-xs text-slate-400">davrdan oldin</span>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {v.silent.length > 0 && !f.userId && (
        <Card>
          <CardHeader title={`Kirmagan faol xodimlar · ${v.silent.length}`} description={`${DAY_LABEL[f.days]} ichida ERP'ni ochmagan, logini faol xodimlar`} icon={UserX} />
          <div className="flex flex-wrap gap-2 text-sm">
            {v.silent.slice(0, 60).map((u) => <span key={u.id} className="rounded-md bg-slate-100 px-2 py-0.5">{u.fullName} <span className="text-xs text-slate-500">· {roleLabel(u.role)}</span></span>)}
            {v.silent.length > 60 && <span className="text-slate-500">va yana {v.silent.length - 60} ta</span>}
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div id="jurnal" className="scroll-mt-20 px-5 pt-5">
          <CardHeader title={who ? `Jurnal — ${who.fullName}` : "Jurnal"} description={`${fmtNum(v.journalTotal)} yozuv · yangilari tepada · 90 kundan eskisi o'chadi`} />
        </div>
        <Table>
          <thead><tr><Th>Vaqt</Th><Th>Xodim</Th><Th>Tur</Th><Th>Sahifa / usul</Th><Th>Qurilma</Th><Th>IP</Th></tr></thead>
          <tbody>
            {v.journal.length === 0 && <Empty text="Yozuv yo'q" />}
            {v.journal.map((r) => (
              <Tr key={r.id}>
                <Td className="text-sm tabular whitespace-nowrap">{dateTime(r.createdAt)}</Td>
                <Td className="text-sm"><Link href={q({ u: r.userId, bet: 0 })} className="hover:underline">{r.user.fullName}</Link>{r.superadmin && <span className="ml-1"><Badge color="violet" dot={false}>IT</Badge></span>}</Td>
                <Td>{r.kind === "LOGIN" ? <Badge color="green">Kirish</Badge> : <Badge color="slate" dot={false}>Sahifa</Badge>}</Td>
                <Td className="text-sm">{r.kind === "LOGIN" ? methodLabel(r.method) : <>{sectionLabel(r.path ?? "")}<div className="max-w-xs truncate text-xs text-slate-500" data-no-translit>{r.path}</div></>}</Td>
                <Td className="text-sm">{deviceLabel(r.device)}<div className="max-w-56 truncate text-xs text-slate-500" title={r.userAgent ?? undefined}>{client(r.os, r.browser)}</div></Td>
                <Td className="text-xs tabular text-slate-600" data-no-translit>{r.ip ?? "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {pages > 1 && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
            <span className="text-slate-500">{f.page + 1} / {pages}-sahifa</span>
            <div className="flex gap-2">
              {f.page > 0 && <Link href={`${q({ bet: f.page - 1 })}#jurnal`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50"><ChevronLeft size={14} /> Yangiroq</Link>}
              {f.page + 1 < pages && <Link href={`${q({ bet: f.page + 1 })}#jurnal`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">Eskiroq <ChevronRight size={14} /></Link>}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
