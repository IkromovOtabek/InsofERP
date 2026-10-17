import { AtSign, Bot, Building2, Megaphone, Settings, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/nav";
import { aiReady } from "@/lib/ai/smm-writer";
import { date, dateTime, fmtNum } from "@/lib/format";
import { marketingSettings } from "@/lib/smm/boosts";
import { metaAppReady, smmDryRun } from "@/lib/smm/config";
import { ACCOUNT_STATUS, CHANNEL_LABEL } from "@/lib/smm/labels";
import { Badge, Callout, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { AccountButtons, AdsForm, AutoAgentsForm, BrandForm, CompetitorForm, CompetitorRemove, LocationsEditor, MetaConnect, MetaManualForm, TelegramForm } from "./forms";
import type { Place } from "./actions";

const ERRORS: Record<string, string> = {
  ruxsat: "Profil ulash uchun ruxsatingiz yo'q — direktorga murojaat qiling.",
  ilova: "Meta ilovasi hali sozlanmagan. Hozircha tokenni qo'lda kiriting.",
  bekor: "Meta oynasida ruxsat berilmadi — qayta urinib ko'ring.",
  state: "Ulash seansi eskirgan yoki boshqa brauzerda ochilgan — tugmani qayta bosing.",
  meta: "Meta bilan ulanishda xato. Instagram profili Business turida va Facebook sahifaga bog'langanini tekshiring.",
};

/** Marketing sozlamalari: ijtimoiy tarmoq profillari, brend profili, joylashuvlar, raqobatchilar, reklama kabineti */
export default async function MarketingSettingsPage({ searchParams }: { searchParams: Promise<{ ulandi?: string; xato?: string }> }) {
  const s = await requirePage("/marketing/sozlamalar");
  const sp = await searchParams;
  const [accounts, settings, competitors, people] = await Promise.all([
    db.smmAccount.findMany({ orderBy: [{ status: "asc" }, { channel: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }] }),
    marketingSettings(),
    db.smmCompetitor.findMany({ orderBy: { followers: { sort: "desc", nulls: "last" } } }),
    // Avtomatik hisobot qabul qiluvchilari: direktor va sotuv xodimlari
    db.user.findMany({
      where: { isActive: true, role: { in: ["DIRECTOR", "SALES"] } }, orderBy: [{ role: "asc" }, { fullName: "asc" }],
      select: { id: true, fullName: true, role: true, telegram: { where: { isBlocked: false }, select: { id: true }, take: 1 } },
    }),
  ]);
  const canConnect = canDo(s, "marketing", "settings");
  const canEdit = canDo(s, "marketing", "content");
  const [ig, fb] = (sp.ulandi ?? "").split("-").map(Number);
  const active = accounts.filter((a) => a.status !== "DISCONNECTED");
  const places = (Array.isArray(settings.locations) ? settings.locations : []) as Place[];

  return (
    <div>
      <PageHeader title="Sozlamalar" subtitle="Ijtimoiy tarmoq profillarini ulang — ERP'dan turib post chiqarish, statistika va AI tavsiyalari shu profillar orqali ishlaydi." />
      {sp.ulandi && <Callout tone="success" title="Profillar ulandi">Instagram — {ig || 0}, Facebook sahifa — {fb || 0}. Statistika bir necha daqiqada yig&apos;ila boshlaydi.</Callout>}
      {sp.xato && <Callout tone="danger">{ERRORS[sp.xato] ?? "Xato"}</Callout>}
      {smmDryRun() && <Callout tone="info">Sinov rejimi: postlar tarmoqqa yuborilmaydi, reklamaga pul sarflanmaydi.</Callout>}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Ijtimoiy tarmoq profillari" icon={AtSign} description="Har tarmoqda bitta asosiy profil — nashr va statistika shundan" />
            {active.length === 0 ? (
              <EmptyState title="Hali profil ulanmagan" text="Instagram va Facebook'ni «Meta bilan ulash» tugmasi bilan, Telegram kanalni bot orqali ulang." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {active.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {a.pictureUrl
                        // eslint-disable-next-line @next/next/no-img-element -- tarmoq rasmi tashqi CDN'da, optimizatsiya shart emas
                        ? <img src={a.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                        : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{CHANNEL_LABEL[a.channel].slice(0, 2)}</div>}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{a.name}</span>
                          <Badge color="slate" dot={false}>{CHANNEL_LABEL[a.channel]}</Badge>
                          {a.isPrimary && <Badge color="blue" dot={false}>Asosiy</Badge>}
                          <Badge color={ACCOUNT_STATUS[a.status].color}>{ACCOUNT_STATUS[a.status].label}</Badge>
                        </div>
                        <p className="text-xs text-slate-500">
                          {a.username ? `@${a.username} · ` : ""}{a.followers != null ? `${fmtNum(a.followers)} obunachi · ` : ""}
                          {a.method === "OAUTH" ? "Meta orqali ulangan" : "qo'lda ulangan"}
                          {a.tokenExpiresAt ? ` · token ${date(a.tokenExpiresAt)} gacha (o'zi yangilanadi)` : ""}
                        </p>
                        {a.lastError && <p className="text-xs text-red-600">{a.lastError}</p>}
                        {a.checkedAt && <p className="text-xs text-slate-400">Tekshirildi: {dateTime(a.checkedAt)}{a.connectedByName ? ` · uladi: ${a.connectedByName}` : ""}</p>}
                      </div>
                    </div>
                    {canConnect && <AccountButtons id={a.id} primary={a.isPrimary} />}
                  </li>
                ))}
              </ul>
            )}
            {canConnect ? (
              <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                <MetaConnect ready={metaAppReady()} />
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">Instagram / Facebook tokenini qo&apos;lda kiritish</summary>
                  <div className="mt-3"><MetaManualForm /></div>
                </details>
                <details className="group" open={!active.some((a) => a.channel === "TELEGRAM")}>
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">Telegram kanalni ulash</summary>
                  <div className="mt-3"><TelegramForm /></div>
                </details>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">Profil ulash — direktor (yoki «Ijtimoiy tarmoq profillarini ulash» ruxsati bor xodim) uchun.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Brend profili" icon={Building2} description="AI post, ssenariy va tavsiyalarni shu ma'lumotga tayanib yozadi" />
            <BrandForm disabled={!canEdit} v={{
              brandAbout: settings.brandAbout ?? "", brandTone: settings.brandTone ?? "", audience: settings.audience ?? "",
              languages: settings.languages, defaultHashtags: settings.defaultHashtags ?? "",
            }} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Joylashuvlar" icon={Settings} description="Postga qo'yiladigan joy (zavod, ofis, sklad) — Instagram'da manzil ko'rinadi" />
            <LocationsEditor initial={places} disabled={!canEdit} />
          </Card>

          <Card>
            <CardHeader title="Raqobatchilar" icon={Users} description="Instagram Business profillari — ochiq ko'rsatkichlar har kuni yangilanadi" />
            {competitors.length === 0 ? <p className="mb-3 text-sm text-slate-500">Ro&apos;yxat bo&apos;sh.</p> : (
              <ul className="mb-3 divide-y divide-slate-100">
                {competitors.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">@{c.username}</a>
                      <p className="text-xs text-slate-500">
                        {c.followers != null ? `${fmtNum(c.followers)} obunachi · o'rtacha ${fmtNum(c.avgLikes ?? 0)} layk` : c.lastError ? c.lastError : "ko'rsatkichlar profil ulangach olinadi"}
                      </p>
                    </div>
                    {canEdit && <CompetitorRemove id={c.id} />}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && <CompetitorForm />}
          </Card>

          <Card>
            <CardHeader title="Avtomatik agentlar" icon={Bot} description="Claude o'zi hisobot va reja tayyorlab, Telegram bot va ilovaga yuboradi" />
            {!aiReady() && <Callout tone="warning">AI ulanmagan — haftalik hisobot ishlamaydi, kunlik tekshiruv faqat faktlar bilan ketadi.</Callout>}
            <AutoAgentsForm disabled={!canConnect}
              v={{ autoWeekly: settings.autoWeekly, autoDaily: settings.autoDaily, autoDrafts: settings.autoDrafts, recipients: settings.autoRecipients }}
              people={people.map((p) => ({ id: p.id, name: p.fullName, role: ROLE_LABELS[p.role], telegram: p.telegram.length > 0 }))} />
            <p className="mt-3 text-xs text-slate-400">
              Oxirgi haftalik: {settings.autoWeeklyAt ? dateTime(settings.autoWeeklyAt) : "—"} · oxirgi kunlik: {settings.autoDailyAt ? dateTime(settings.autoDailyAt) : "—"}
            </p>
          </Card>

          <Card>
            <CardHeader title="Reklama kabineti va limitlar" icon={Megaphone} description="Target (Meta reklama) uchun" />
            <AdsForm disabled={!canConnect} v={{
              adAccountId: settings.adAccountId ?? "", leadFormId: settings.leadFormId ?? "", adCurrency: settings.adCurrency,
              boostDailyCap: String(settings.boostDailyCap), boostMonthlyCap: String(settings.boostMonthlyCap),
            }} />
          </Card>
        </div>
      </div>
    </div>
  );
}
