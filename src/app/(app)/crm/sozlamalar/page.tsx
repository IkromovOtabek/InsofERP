import { notFound } from "next/navigation";
import { Card, CardHeader, PageHeader, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { ActivityForm, ExtForm, HookForm, OptionForm, ResultForm, SyncButton } from "./forms";
import { SITE_URL } from "@/lib/site";
import { crmUsers } from "@/lib/crm/clients";
import { extensions, pbxConfig } from "@/lib/pbx/onlinepbx";
import { dateTime } from "@/lib/format";

const KINDS = [
  { key: "SOURCE", label: "Manba", count: "sourceCustomers" },
  { key: "CLIENT_TYPE", label: "Mijoz turi", count: "typeCustomers" },
  { key: "PRODUCT", label: "Mahsulot", count: "productContacts" },
  { key: "CHANNEL", label: "Aloqa turi", count: "channelContacts" },
] as const;

/** CRM sozlamalari (menejer): ro'yxatlar, natijalar, faollik chegaralari. O'chirish yo'q — nofaol qilinadi (tarix saqlansin). */
export default async function CrmSettings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requirePage("/crm/sozlamalar");
  if (!canDo(s, "crm", "manage")) notFound();
  const { tab = "SOURCE" } = await searchParams;
  const kind = KINDS.find((k) => k.key === tab);
  const items = [
    ...KINDS.map((k) => ({ key: k.key, label: k.label, href: `/crm/sozlamalar?tab=${k.key}` })),
    { key: "RESULT", label: "Natijalar", href: "/crm/sozlamalar?tab=RESULT" },
    { key: "ACTIVITY", label: "Faollik", href: "/crm/sozlamalar?tab=ACTIVITY" },
    { key: "PBX", label: "Telefoniya", href: "/crm/sozlamalar?tab=PBX" },
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="CRM sozlamalari" back={{ href: "/crm", label: "Bugun" }} />
      <Tabs current={kind ? kind.key : tab} items={items} />
      {kind && <OptionsCard kind={kind.key} label={kind.label} />}
      {tab === "RESULT" && <ResultsCard />}
      {tab === "ACTIVITY" && <ActivityCard />}
      {tab === "PBX" && <PbxCard />}
    </div>
  );
}

async function OptionsCard({ kind, label }: { kind: (typeof KINDS)[number]["key"]; label: string }) {
  const rows = await db.crmOption.findMany({
    where: { kind }, orderBy: [{ isActive: "desc" }, { sort: "asc" }, { label: "asc" }],
    include: { _count: { select: { sourceCustomers: true, typeCustomers: true, productContacts: true, channelContacts: true, leadSourceContacts: true } } },
  });
  const used = (r: (typeof rows)[number]) => r._count.sourceCustomers + r._count.typeCustomers + r._count.productContacts + r._count.channelContacts + r._count.leadSourceContacts;
  return (
    <Card>
      <CardHeader title={label} description="Tartib — kichik son tepada. Ishlatilgan qiymat o'chirilmaydi, nofaol qilinadi (yangi tanlovlarda chiqmaydi)" />
      <div className="divide-y divide-slate-100">
        {rows.map((r) => <OptionForm key={r.id} kind={kind} row={{ id: r.id, label: r.label, sort: r.sort, isActive: r.isActive, used: used(r) }} />)}
      </div>
      <div className="mt-2 border-t border-slate-200 pt-2"><OptionForm kind={kind} /></div>
    </Card>
  );
}

async function ResultsCard() {
  const rows = await db.crmResult.findMany({ orderBy: [{ isActive: "desc" }, { sort: "asc" }], include: { _count: { select: { contacts: true } } } });
  return (
    <Card>
      <CardHeader title="Natijalar" description="Bosqich — voronkadagi eng yuqori yetgan bosqich (1–6). Guruh — formadagi bo'lim va hisobotlar (Otkaz, Kutilayotgan…). «+ kun» — keyingi aloqa sanasi standarti"
        info="Bosqich yoki guruhni o'zgartirsangiz, eski aloqalar ham yangi qoida bo'yicha hisoblanadi (voronka, avto-holat). «Taklif yuborildi», «Qimmat dedi», «Zayafka oldim» hisobotlarda alohida ustun — nomini o'zgartirish mumkin, ma'nosini emas." />
      {rows.map((r) => <ResultForm key={r.id} row={{ id: r.id, label: r.label, stage: r.stage, group: r.group, nextRule: r.nextRule, defaultDays: r.defaultDays, sort: r.sort, isActive: r.isActive, used: r._count.contacts }} />)}
      <div className="mt-2 border-t border-slate-200 pt-1"><ResultForm /></div>
    </Card>
  );
}

async function ActivityCard() {
  const s = await db.companySettings.findUnique({ where: { id: "main" }, select: { crmActiveDays: true, crmColdDays: true } });
  return (
    <Card>
      <CardHeader title="Faollik chegaralari" description="Mijoz kartochkasidagi belgi: Faol · Sovib qoldi · Eski: qayta aloqa kerak. «Ishlayotgan» → «Eski mijoz» holati ham «Sovib qoldi» chegarasidan" />
      <ActivityForm active={s?.crmActiveDays ?? 30} cold={s?.crmColdDays ?? 90} />
    </Card>
  );
}

/** Telefoniya (onlinePBX): ulanish holati, xodim ↔ ichki raqam, tarixni qo'lda olish */
async function PbxCard() {
  const cfg = pbxConfig();
  const [users, st, calls] = await Promise.all([
    crmUsers(),
    db.companySettings.findUnique({ where: { id: "main" }, select: { pbxSyncedAt: true, pbxWebhookKey: true, pbxWebhookAt: true } }),
    db.crmCall.count(),
  ]);
  const withExt = await db.user.findMany({ where: { id: { in: users.map((u) => u.id) } }, select: { id: true, pbxExt: true } });
  const extOf = new Map(withExt.map((u) => [u.id, u.pbxExt ?? ""]));
  let pbxExts: { num: string; name: string }[] = [];
  let pbxErr: string | null = null;
  if (cfg) { try { pbxExts = await extensions(); } catch (e) { pbxErr = e instanceof Error ? e.message : String(e); } }
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="onlinePBX" description={cfg ? `Ulangan: ${cfg.domain}` : "Ulanmagan"}
          info="«Qo'ng'iroq» bosilganda avval xodimning ichki raqami (softfon yoki onlinePBX ilovasi) jiringlaydi, ko'targach mijozga ulanadi — mijoz kompaniya raqamini ko'radi. Qo'ng'iroqlar tarixi har daqiqada olinadi: mijoz va xodimga bog'lanadi, o'tkazib yuborilgan kiruvchi qo'ng'iroq «Bugun»ga tushadi, yozuvni kartochkada tinglash mumkin. Ulash: korxona sozlamasiga ONLINEPBX_DOMAIN va ONLINEPBX_API_KEY (onlinePBX kabineti → API)." />
        {cfg ? (
          <div className="grid gap-3 text-sm">
            <p className="text-slate-600">Oxirgi sinxron: <b>{st?.pbxSyncedAt ? dateTime(st.pbxSyncedAt) : "hali yo'q"}</b> · bazada {calls} ta qo'ng'iroq</p>
            {pbxErr && <p className="text-red-600">{pbxErr}</p>}
            {pbxExts.length > 0 && <p className="text-slate-600">onlinePBX ichki raqamlari: {pbxExts.map((x) => `${x.num}${x.name ? ` (${x.name})` : ""}`).join(", ")}</p>}
            <SyncButton />
          </div>
        ) : (
          <p className="text-sm text-slate-600">Korxona sozlamasiga (serverda <code>tenants/&lt;korxona&gt;.env</code>) <code>ONLINEPBX_DOMAIN</code> va <code>ONLINEPBX_API_KEY</code> yozilib, ERP qayta ishga tushirilgach ulanadi. Hozircha «Qo&apos;ng&apos;iroq» telefonning o&apos;zidan (tel:) ishlaydi.</p>
        )}
      </Card>
      {cfg && (
        <Card>
          <CardHeader title="Jonli qo'ng'iroqlar (webhook)" description={st?.pbxWebhookAt ? `Oxirgi hodisa: ${dateTime(st.pbxWebhookAt)}` : "Hali hodisa kelmagan"}
            info="Webhook ulansa, qo'ng'iroq kelishi bilan CRM'da oyna chiqadi (kim qo'ng'iroq qilyapti, oxirgi aloqa) va qo'ng'iroq jurnali soniyalar ichida yangilanadi. Ulanmasa ham ishlaydi — tarix har daqiqada olinadi, faqat oyna chiqmaydi." />
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Quyidagi tugma bilan manzil yarating va nusxalang.</li>
            <li>onlinePBX kabineti → Сервисы → Webhooks → «Добавить», manzilni qo&apos;ying.</li>
            <li>Hodisalar: «Начался звонок», «Дозвон до пользователя», «Ответили на звонок», «Пропущенный звонок», «Звонок завершился» — saqlang.</li>
          </ol>
          <HookForm url={st?.pbxWebhookKey ? `${SITE_URL.replace(/\/+$/, "")}/api/crm/pbx?k=${st.pbxWebhookKey}` : null} />
        </Card>
      )}
      <Card>
        <CardHeader title="Xodimlar va ichki raqamlar" description="Qo'ng'iroq qiladigan xodimga onlinePBX'dagi ichki raqamini yozing (masalan Mushtariy — 101)" />
        <div className="divide-y divide-slate-100">
          {users.map((u) => <ExtForm key={u.id} userId={u.id} name={u.fullName} ext={extOf.get(u.id) ?? ""} />)}
        </div>
      </Card>
    </div>
  );
}
