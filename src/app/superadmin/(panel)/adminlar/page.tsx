import { control } from "@/lib/control/db";
import { requireAdmin } from "@/lib/control/auth";
import { dateTime } from "@/lib/format";
import { ROLE_DESCR, ROLE_LABEL, roleAllows } from "@/lib/control/roles";
import { Badge, Button, Callout, Card, Table, Td, Th, Tr } from "@/components/ui";
import { PageHeader } from "../../_ui";
import { NewAdminForm, OwnPasswordForm } from "../forms";
import { toggleAdminAction } from "../actions";
import { adminEcoEnabled } from "@/lib/control/eco-login";
import { OwnEcoForm } from "./eco-form";
import { AdminRowActions, RevokeSessionButton, TwoFactorCard } from "./security-forms";
import { HelpButton, PageHelp, WithHelp } from "../_help/help";

export const metadata = { title: "IT jamoasi" };

/** User-Agent → qisqa nom (brauzer · tizim), faqat ko'rsatish uchun. */
function device(ua: string | null): string {
  if (!ua) return "—";
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /YaBrowser/.test(ua) ? "Yandex" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Brauzer";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} · ${os}` : b;
}

export default async function AdminsPage({ searchParams }: { searchParams: Promise<{ zaxira?: string }> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const owner = roleAllows(me.role, "OWNER");
  const now = new Date();
  const [admins, sessions] = await Promise.all([
    control.superAdmin.findMany({ orderBy: { createdAt: "asc" } }),
    control.adminSession.findMany({ where: { adminId: me.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: { lastSeenAt: "desc" } }),
  ]);
  const mine = admins.find((x) => x.id === me.id);
  const recoveryLeft = mine?.recoveryCodes.length ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader title={<>IT jamoasi <PageHelp topic="page:adminlar" /></>} subtitle="Platforma administratorlari: barcha korxonalarni ko'radi, yaratadi, direktorga login beradi, korxonaga IT sifatida kiradi." />
      {sp.zaxira && <Callout tone="warning" title="Zaxira kod bilan kirdingiz">Qolgan zaxira kodlar: {recoveryLeft} ta. Telefon yo&apos;qolgan bo&apos;lsa — 2FA ni o&apos;chirib, yangi telefonda qayta yoqing; aks holda yangi zaxira kodlar yarating.</Callout>}
      {owner && <Card><div className="mb-3 flex items-center gap-1 font-semibold">Yangi superadmin <HelpButton topic="adm:new" /></div><NewAdminForm /></Card>}
      <Table>
        <thead><tr><Th>F.I.O.</Th><Th><WithHelp topic="adm:table">Login</WithHelp></Th><Th>Rol</Th><Th>2FA</Th><Th><WithHelp topic="adm:table">Holat</WithHelp></Th><Th>Oxirgi kirish</Th><Th /></tr></thead>
        <tbody>{admins.map((a) => (
          <Tr key={a.id}>
            <Td>{a.fullName}{a.id === me.id && <span className="ml-2 text-xs text-slate-400">(siz)</span>}</Td>
            <Td><code className="text-xs">{a.login}</code>{a.ecoUserId && <span className="ml-2"><Badge color="violet" dot={false}>ECO</Badge></span>}</Td>
            <Td><span title={ROLE_DESCR[a.role]}><Badge color={a.role === "OWNER" ? "violet" : a.role === "OPERATOR" ? "blue" : "slate"} dot={false}>{ROLE_LABEL[a.role]}</Badge></span></Td>
            <Td>{a.totpEnabledAt ? <Badge color="green">Yoqilgan</Badge> : <Badge color="amber">Yo&apos;q</Badge>}</Td>
            <Td><Badge color={a.isActive ? "green" : "red"}>{a.isActive ? "Faol" : "Bloklangan"}</Badge></Td>
            <Td>{a.lastLoginAt ? dateTime(a.lastLoginAt) : "—"}</Td>
            <Td>{owner && a.id !== me.id && (
              <div className="flex flex-col items-end gap-1.5">
                {a.isActive && <AdminRowActions id={a.id} role={a.role} totp={!!a.totpEnabledAt} myTotp={me.totp} />}
                <form action={toggleAdminAction.bind(null, a.id)} className="inline-flex items-center gap-0.5"><Button variant="secondary" size="sm">{a.isActive ? "Bloklash" : "Yoqish"}</Button><HelpButton topic="adm:toggle" /></form>
              </div>
            )}</Td>
          </Tr>
        ))}</tbody>
      </Table>
      <p className="text-xs text-slate-500">
        {(["OWNER", "OPERATOR", "VIEWER"] as const).map((r) => <span key={r} className="mr-4 inline-block"><b>{ROLE_LABEL[r]}</b> — {ROLE_DESCR[r]}.</span>)}
      </p>
      <Card>
        <div className="mb-3 font-semibold">Mening hisobim <span className="ml-1 text-sm font-normal text-slate-500">· rol: {ROLE_LABEL[me.role]}</span></div>
        <div className="mb-2 flex items-center gap-1 text-sm font-medium text-slate-700">Parol <HelpButton topic="adm:password" /></div>
        <OwnPasswordForm totp={me.totp} />
        <p className="mt-3 flex flex-wrap items-center gap-1 text-xs text-slate-500">Parolni yoki 2FA telefonini yo&apos;qotgan bo&apos;lsangiz va panelga hech kim kira olmasa — serverda <code>npm run control:admin -- &lt;login&gt; --reset-2fa</code> <HelpButton topic="adm:reset" /></p>

        <div id="xavfsizlik" className="mb-2 mt-6 scroll-mt-24 border-t border-slate-100 pt-4 text-sm font-medium text-slate-700">Ikki bosqichli kirish (2FA)</div>
        <TwoFactorCard enabled={me.totp} recoveryLeft={recoveryLeft} />

        <div className="mb-2 mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <span className="text-sm font-medium text-slate-700">Faol sessiyalar ({sessions.length})</span>
          {sessions.length > 1 && <RevokeSessionButton />}
        </div>
        <Table>
          <thead><tr><Th>Qurilma</Th><Th>IP</Th><Th>Usul</Th><Th>Kirgan</Th><Th>Oxirgi faollik</Th><Th /></tr></thead>
          <tbody>{sessions.map((s) => (
            <Tr key={s.id}>
              <Td>{device(s.userAgent)}{s.id === me.sid && <span className="ml-2"><Badge color="green" dot={false}>shu qurilma</Badge></span>}</Td>
              <Td><code className="text-xs" data-no-translit>{s.ip ?? "—"}</code></Td>
              <Td>{s.via === "eco" ? "ECO ilovasi" : "Login/parol"}</Td>
              <Td>{dateTime(s.createdAt)}</Td>
              <Td>{dateTime(s.lastSeenAt)}</Td>
              <Td>{s.id !== me.sid && <RevokeSessionButton id={s.id} />}</Td>
            </Tr>
          ))}</tbody>
        </Table>
        <p className="mt-2 text-xs text-slate-500">Yangi IP manzildan kirilganda «Hodisalar»da ogohlantirish ochiladi va IT guruhiga Telegram xabari ketadi.</p>

        <div className="mb-2 mt-6 border-t border-slate-100 pt-4 text-sm font-medium text-slate-700"><WithHelp topic="adm:eco">Insof ECO ilovasi orqali kirish</WithHelp></div>
        <OwnEcoForm linkedPhone={mine?.ecoPhone ?? null} enabled={adminEcoEnabled()} />
      </Card>
    </div>
  );
}
