import Link from "next/link";
import { Building2, Package, Layers, Warehouse, Landmark, Users, ScrollText, UserX, ShieldCheck, UserRound, Gauge, Wallet, ClipboardList, Truck, MapPin, ShoppingCart, BarChart3, ArrowRight, AlarmClock } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { ROLE_LABELS, MODULES } from "@/lib/nav";
import { actionDef } from "@/lib/permissions";
import { BULK_FORM_ID, permModules } from "@/lib/perm-modules";
import { describePerms, positionTemplates, templateRoleLabel } from "@/lib/perm-template";
import type { Role } from "@/generated/prisma";
import { parsePerms } from "@/lib/auth";
import { dateTime, isoDate, money } from "@/lib/format";
import { PRODUCT_UNITS } from "@/lib/unit";
import { Badge, Button, Callout, Card, CardHeader, Empty, Input, LinkButton, PageHeader, Select, StatCard, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { RowForm } from "@/components/row-form";
import { ProductExcelPanel } from "@/components/product-excel-import";
import { ProductMatrixPanel } from "@/components/product-matrix-add";
import { DeleteButton } from "@/components/delete-button";
import { deleteCatalogProduct } from "@/lib/catalog-actions";
import { deleteCatalogMaterial } from "@/lib/material-actions";
import { PlantLocation } from "./plant-location";
import { UserForm, ResetPasswordForm, UserEditForm, ToggleUserButton, SupplyLimitForm, PayablesSinceForm, VatPayerForm, ProductionChannelForm, UserPermsForm, CopyPermsForm, BulkPermsBar, type PermTemplateOpt } from "./user-forms";
import { AttendanceRadiusForm, CustomerLimitsTable, DailyLimitsForm, DefaultCreditLimitForm, type CustomerLimitRow } from "./limits-forms";
import { ThresholdForm } from "../dashboard/byudjet/budget-form";
import { SettingsForm as LogisticsSettingsForm } from "../logistika/sozlamalar/settings-form";
import { customersCredit } from "@/lib/finance";
import { logisticsSettings, DRUM_MAX_MIN } from "@/lib/logistics";
import { today } from "@/lib/davomat";
import { fmtNum } from "@/lib/format";
import { DeletionRow } from "./deletion-forms";
import { SelfAccountPanel } from "../hisobim/panel";
import { SOURCE_LABEL } from "@/lib/account-deletion";
import { DEFAULT_PAYABLES_SINCE } from "@/lib/receipt-payables";
import { fineText, getLateFine } from "@/lib/hr/late-fine";
import { saveCompany, saveProduct, saveMaterial, saveWarehouse, saveCashAccount } from "./actions";
import { txSign } from "@/lib/cash-tx";
import { botEnabled } from "@/lib/telegram/api";

const TABS = [
  ["account", "Mening hisobim", UserRound],
  ["company", "Zavod rekvizitlari", Building2],
  ["limits", "Limitlar", Gauge],
  ["products", "Beton markalari", Package],
  ["materials", "Xomashyo", Layers],
  ["warehouses", "Skladlar", Warehouse],
  ["accounts", "Kassa / hisoblar", Landmark],
  ["users", "Foydalanuvchilar", Users],
  ["permissions", "Ruxsatlar", ShieldCheck],
  ["deletions", "Hisob so'rovlari", UserX],
  ["audit", "Audit jurnali", ScrollText],
] as const;

const ACTION_LABEL: Record<string, string> = { CREATE: "Yaratdi", UPDATE: "O'zgartirdi", DELETE: "O'chirdi", STATUS_CHANGE: "Holatni o'zgartirdi" };
/** Audit jurnalidagi barcha obyekt turlari (kodda `audit(..., "<Entity>", ...)` chaqiriladigan hammasi). */
const ENTITY_LABEL: Record<string, string> = {
  Customer: "Mijoz", Supplier: "Yetkazuvchi", Order: "Zayavka", ProductionBatch: "Zames", Recipe: "Retsept", GoodsReceipt: "Kirim",
  Trip: "Reys", Invoice: "Schyot", Payment: "To'lov", Employee: "Xodim", Vehicle: "Texnika", User: "Foydalanuvchi",
  CustomerCreditLimit: "Mijoz kredit limiti",
  Product: "Mahsulot (marka)", Material: "Xomashyo", Warehouse: "Sklad", CashAccount: "Kassa/hisob", CompanySettings: "Sozlamalar / rekvizitlar", StockMove: "Sklad harakati",
  Brigade: "Brigada", BrigadeTask: "Brigada topshirig'i", TaskProgress: "Bajarilganlik", CashTransaction: "Kirim-chiqim", WorkPosition: "Ishchi lavozim", EmployeeDocument: "Xodim hujjati",
  Attendance: "Davomat", BrigadeIssue: "Brigadaga berish", BrigadeMove: "Brigada harakati", BrigadeShift: "Brigada smenasi", ExpenseBudget: "Xarajat byudjeti",
  FuelLog: "Zapravka", HrDocument: "Kadr hujjati", Lead: "Ariza (lid)", MarketingEntry: "Marketing yozuvi", MaterialGroup: "Xomashyo guruhi",
  ProductDefect: "Brak", ProductGroup: "Mahsulot guruhi", ProductionPlan: "Ishlab chiqarish plani", ProductionReport: "Ishlab chiqarish hisoboti",
  SalesPlan: "Sotuv plani", SalesRegister: "Realizatsiya jurnali", ShopBanner: "Vitrina reklamasi", ShopItem: "Vitrina mahsuloti", Site: "Obyekt",
  SupplyDocument: "Ta'minot hujjati", SupplyIncident: "Ta'minot muammosi", SupplyQuote: "Tijorat taklifi", SupplyRequest: "Ta'minot zayavkasi",
  TransportExpense: "Transport xarajati", TripIssue: "Reys muammosi",
};
const AUDIT_PAGE = 50;
const UNITS: [string, string][] = [["kg", "kg"], ["t", "t"], ["l", "l"], ["m3", "m³"], ["dona", "dona"]];

type AuditFilter = { user?: string; entity?: string; from?: string; to?: string; page?: string };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string } & AuditFilter & PermFilter> }) {
  const s = await requireRoles(["DIRECTOR"]);
  const sp = await searchParams;
  const { tab = "company" } = sp;
  const pendingDeletions = await db.accountDeletionRequest.count({ where: { status: "PENDING" } });

  return (
    <div>
      <PageHeader title="Sozlamalar" subtitle="Faqat direktor uchun. Har bir o'zgarish audit jurnaliga tushadi." />
      <Tabs current={tab} className="mb-6" items={TABS.map(([k, label, Icon]) => ({ key: k, label, href: `/settings?tab=${k}`, icon: Icon, count: k === "deletions" && pendingDeletions ? pendingDeletions : undefined }))} />

      {tab === "account" && <SelfAccountPanel s={s} />}
      {tab === "company" && <CompanyTab />}
      {tab === "limits" && <LimitsTab />}
      {tab === "products" && <ProductsTab />}
      {tab === "materials" && <MaterialsTab />}
      {tab === "warehouses" && <WarehousesTab />}
      {tab === "accounts" && <AccountsTab />}
      {tab === "users" && <UsersTab me={s.userId} />}
      {tab === "permissions" && <PermissionsTab f={sp} />}
      {tab === "deletions" && <DeletionsTab />}
      {tab === "audit" && <AuditTab f={sp} />}
    </div>
  );
}

/**
 * Limitlar — tizimdagi barcha biznes limitlari bitta joyda (faqat direktor): mijozlar kredit limiti (standart va
 * har mijozniki), kunlik zayavka limiti va quvvat, katta xarid chegarasi, dashbord chegaralari, logistika
 * chegaralari, davomat radiusi. Har forma o'z server action'i bilan saqlanadi va auditga yoziladi. Dashbord va
 * logistika chegaralari o'z sahifalaridagi formaning o'zi (bitta action) — qaysi joyda o'zgartirilsa ham bir xil.
 */
async function LimitsTab() {
  const [year, month] = today().slice(0, 7).split("-").map(Number);
  const [c, credit, customers, blocked, logi, budget, lateFine] = await Promise.all([
    getCompany(),
    customersCredit(),
    db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.order.groupBy({ by: ["customerId"], where: { kind: "SALE", status: "BLOCKED" }, _count: { _all: true } }),
    logisticsSettings(),
    db.expenseBudget.aggregate({ where: { year, month }, _sum: { amount: true }, _count: { _all: true } }),
    getLateFine(),
  ]);
  const blockedBy = new Map(blocked.map((b) => [b.customerId, b._count._all]));
  const rows: CustomerLimitRow[] = customers.map((m) => {
    const k = credit.get(m.id);
    return { id: m.id, name: m.name, limit: k?.limit ?? 0, debt: k?.debt ?? 0, open: k?.open ?? 0, used: k?.used ?? 0, blacklisted: k?.blacklisted ?? false, blocked: blockedBy.get(m.id) ?? 0 };
  });
  const blockedTotal = blocked.reduce((s, b) => s + b._count._all, 0);
  const blackTotal = rows.filter((r) => r.blacklisted).length;
  const defLimit = Number(c.defaultCreditLimit);
  const maxM3 = c.dailyOrderMaxM3 != null ? Number(c.dailyOrderMaxM3) : null;
  const dailyText = [maxM3 ? `${fmtNum(maxM3, 2)} m³` : "", c.dailyOrderMaxCount ? `${c.dailyOrderMaxCount} ta` : ""].filter(Boolean).join(" · ") || "cheklanmagan";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Yangi mijozga standart limit" value={money(defLimit)} hint={defLimit > 0 ? "shu summagacha qarzga oladi" : "yangi mijoz faqat naqd / avans"} icon={Wallet} />
        <StatCard label="Qora ro'yxatda" value={`${blackTotal} ta mijoz`} icon={Users} tone={blackTotal ? "danger" : "default"} href="/customers?tab=black" />
        <StatCard label="Limit tufayli bloklangan" value={`${blockedTotal} ta zayavka`} icon={ClipboardList} tone={blockedTotal ? "warning" : "default"} href="/orders?status=BLOCKED" />
        <StatCard label="Kunlik zayavka limiti" value={dailyText} icon={Gauge} />
      </div>

      <Card>
        <CardHeader icon={Wallet} title="Mijozlar kredit limiti"
          description="Limit — mijoz qarzga ola oladigan eng ko'p summa. Ishlatilgan = qarz + schyot yozilmagan ochiq zayavkalar. Limit to'lsa mijoz qora ro'yxatga tushadi: yangi zayavka faqat oldindan to'lov bilan, qarzga zayavka qabul qilishda bloklanadi. 0 — faqat naqd/avans." />
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <DefaultCreditLimitForm value={defLimit} />
          <p className="mt-1.5 text-xs text-slate-500">Bundan keyin ochiladigan har yangi mijozga (forma, Excel, zayavka va arizadan, mobil ilova) shu limit beriladi. Mavjud mijozlarning limiti o&apos;zgarmaydi — ularni pastdagi jadvalda bering.</p>
        </div>
        <CustomerLimitsTable rows={rows} />
        <p className="mt-3 text-xs text-slate-500">
          Jadvalda faol mijozlar. Limitni mijoz kartasida Buxgalteriya va Finance ham o&apos;zgartiradi — har o&apos;zgarish audit jurnalida («Mijoz kredit limiti»).
          Limit oshirilganda bloklangan zayavka o&apos;zi ochilmaydi: uni zayavka kartasida «Blokdan chiqarish» bilan ochasiz. Bu huquqni boshqa xodimga{" "}
          <Link href="/settings?tab=permissions" className="underline">Ruxsatlar</Link> → Zayavkalar → «Limitdan oshgan zayavka blokini ochish» orqali berish mumkin.
        </p>
      </Card>

      <Card>
        <CardHeader icon={ClipboardList} title="Kunlik zayavka limiti va quvvat"
          description="Kunlik quvvat — yumshoq ko'rsatkich, hech narsani bloklamaydi: Zayavkalar taqvimining rangi (unga bekor qilinmagan barcha zayavkalar, sklad zayavkalari ham kiradi), egasi dashbordidagi quvvat foizi va ommaviy saytdagi «Kunlik ishlab chiqarish quvvati». Hajm va son chegarasi — qattiq: bir yetkazish kuniga tasdiqlangan mijoz zayavkalari (sklad, qoralama va bloklanganlar kirmaydi) shundan oshsa, zayavka qabul qilinmaydi va blokdan chiqarilmaydi. 0 yoki bo'sh — cheklov yo'q." />
        <DailyLimitsForm capacity={c.dailyCapacityM3 != null ? Number(c.dailyCapacityM3) : null} pcs={c.dailyCapacityPcs} m3={maxM3} count={c.dailyOrderMaxCount} />
      </Card>

      <Card>
        <CardHeader icon={ShoppingCart} title="Katta xarid — direktor tasdig'i"
          description={`Summasi shu chegaradan katta ta'minot zayavkasi ma'sul xodim tasdig'idan oldin direktor tasdig'idan o'tadi va bosh sahifadagi «Sizning tasdig'ingiz kutilmoqda» navbatida chiqadi. 0 — cheklov yo'q. Hozir: ${Number(c.supplyDirectorLimit) > 0 ? money(Number(c.supplyDirectorLimit)) : "cheklov yo'q"}.`} />
        <SupplyLimitForm value={Number(c.supplyDirectorLimit)} />
      </Card>

      <Card>
        <CardHeader icon={BarChart3} title="Dashbord chegaralari"
          description="Bosh sahifa va mobil ilovadagi sariq (e'tibor) va qizil (kritik) holatlar: xarajat byudjetidan oshish foizi, xomashyo necha kunga yetishi, muddati o'tgan qarz."
          action={<LinkButton href="/dashboard/byudjet" variant="secondary" size="sm">Xarajat byudjeti <ArrowRight size={14} /></LinkButton>} />
        <ThresholdForm t={{ alertWarnPct: c.alertWarnPct, alertCritPct: c.alertCritPct, stockWarnDays: c.stockWarnDays, stockCritDays: c.stockCritDays, overdueDays: c.overdueDays }} />
        <p className="mt-3 text-xs text-slate-500">
          Xarajat byudjeti (oy × kategoriya bo&apos;yicha limit) — Byudjet sahifasida. Joriy oy: {budget._count._all ? <><b>{budget._count._all} ta kategoriya</b>, jami {money(Number(budget._sum.amount ?? 0))}</> : "byudjet kiritilmagan"}.
        </p>
      </Card>

      <Card>
        <CardHeader icon={Truck} title="Logistika chegaralari"
          description="Reys kechikishi, GPS signali, uzoq turish va yo'ldan chiqish, yuklangan betonning kutishi, smena. Logistika rahbari ham o'z Sozlamalar sahifasida o'zgartiradi — qiymatlar bitta." />
        <LogisticsSettingsForm v={{
          lateWarnMin: logi.lateWarnMin, lateCritMin: logi.lateCritMin, gpsSilentMin: logi.gpsSilentMin, loadedWarnMin: logi.loadedWarnMin,
          assignLeadMin: logi.assignLeadMin, shiftStartHour: logi.shiftStartHour, shiftEndHour: logi.shiftEndHour, avgSpeedKmh: logi.avgSpeedKmh,
          stopAlertMin: logi.stopAlertMin, offRouteM: logi.offRouteM,
        }} />
        <p className="mt-3 text-xs text-slate-500">Baraban vaqti (yuklangandan quyilishigacha): <b>{DRUM_MAX_MIN} daqiqa</b> — o&apos;zgarmas texnologik qoida.</p>
      </Card>

      <Card>
        <CardHeader icon={MapPin} title="Davomat radiusi"
          description="Xodim ilovada «Keldim / Ketdim» bosganda zavod nuqtasidan shu masofa ichida bo'lishi shart. Shu radius zavodning GPS hududi ham: yuklangan mashina shu doirada tursa «uzoq turish» ogohlantirishi berilmaydi — radiusni juda kichraytirsangiz logistikaga ortiqcha xabar keladi." />
        <AttendanceRadiusForm value={c.attendanceRadiusM} />
        {(c.lat == null || c.lng == null) && (
          <p className="mt-2 text-xs text-amber-700">Zavod nuqtasi belgilanmagan — radius tekshirilmaydi. Nuqtani <Link href="/settings?tab=company" className="underline">Zavod rekvizitlari</Link> → «Zavod joyi» xaritasida belgilang.</p>
        )}
      </Card>

      <Card>
        <CardHeader icon={AlarmClock} title="Kechikish jarimasi"
          description="Kechikkan xodimdan ushlanadigan summa — otdel kadr yoki direktor belgilaydi (Sozlamalar → Davomat). Tabel, xodimning o'z davomati va ish haqi hisobi shu qoidadan oladi."
          action={<LinkButton href="/settings/davomat" variant="secondary" size="sm">Sozlash <ArrowRight size={14} /></LinkButton>} />
        <p className="text-sm text-slate-700">Joriy qoida: <b>{fineText(lateFine)}</b></p>
      </Card>
    </div>
  );
}

async function CompanyTab() {
  const c = await getCompany();
  return (
    <div className="space-y-4">
      <Card>
      <h2 className="mb-1 font-semibold">Zavod rekvizitlari</h2>
      <p className="mb-4 text-sm text-slate-500">Nakladnoy, schyot va mijozlar sahifasida ishlatiladi.</p>
      <RowForm action={saveCompany} cols={3} submit="Saqlash" fields={[
        { name: "name", label: "Zavod nomi (brend) *", defaultValue: c.name, required: true },
        { name: "legalName", label: "Yuridik nomi", defaultValue: c.legalName, placeholder: "INSOF BETON MChJ" },
        { name: "inn", label: "INN", defaultValue: c.inn },
        { name: "directorName", label: "Direktor F.I.O.", defaultValue: c.directorName },
        { name: "phone", label: "Telefon", defaultValue: c.phone },
        { name: "phone2", label: "Qo'shimcha telefon", defaultValue: c.phone2 },
        { name: "email", label: "E-mail", defaultValue: c.email },
        { name: "workingHours", label: "Ish vaqti", defaultValue: c.workingHours },
        { name: "foundedYear", label: "Tashkil topgan yil", type: "number", defaultValue: c.foundedYear },
        { name: "address", label: "Manzil", defaultValue: c.address, className: "sm:col-span-3" },
        { name: "bankName", label: "Bank", defaultValue: c.bankName },
        { name: "bankAccount", label: "Hisob raqam", defaultValue: c.bankAccount },
        { name: "mfo", label: "MFO", defaultValue: c.mfo },
        { name: "about", label: "Zavod haqida (mijozlar sahifasida ko'rinadi)", type: "textarea", defaultValue: c.about, className: "sm:col-span-3" },
        // Mijoz ilovasi bosh sahifasidagi "Hozir ochiq · Bugun yetkazamiz" belgisi shulardan hisoblanadi (Toshkent vaqti)
        { name: "openHour", label: "Qabul boshlanadi (soat)", type: "number", step: "1", defaultValue: c.openHour, required: true },
        { name: "closeHour", label: "Qabul tugaydi (soat)", type: "number", step: "1", defaultValue: c.closeHour, required: true },
        { name: "sameDayCutoffHour", label: "Bugun yetkazish uchun oxirgi soat", type: "number", step: "1", defaultValue: c.sameDayCutoffHour, required: true },
        { name: "telegram", label: "Telegram (mijozlar uchun)", defaultValue: c.telegram, placeholder: "@insof_beton" },
        { name: "workSunday", label: "Yakshanba ham ishlaymiz", type: "checkbox", defaultValue: c.workSunday },
        // Kunlik quvvat, kunlik zayavka limiti, katta xarid chegarasi va davomat radiusi — «Limitlar» bo'limida
      ]} />
      </Card>
      <PlantLocation lat={c.lat} lng={c.lng} />
      <Callout tone="info" title="Limitlar alohida bo'limda">
        Mijozlar kredit limiti, kunlik zayavka limiti va quvvat, katta xarid chegarasi, davomat radiusi va boshqa chegaralar —{" "}
        <Link href="/settings?tab=limits" className="font-medium underline">Sozlamalar → Limitlar</Link>.
      </Callout>
      <Card>
        <h2 className="mb-1 font-semibold">To&apos;lanmagan kirimlar — boshlanish sanasi</h2>
        <p className="mb-3 text-sm text-slate-500">Kirim-Chiqimdagi «To&apos;lanmagan kirimlar» ro&apos;yxati va yetkazuvchi qarzi shu sanadan keyin kiritilgan kirimlardan hisoblanadi. Undan oldingi chiqimsiz kirimlar (Excel import, dastlabki ma&apos;lumot) to&apos;lov kutmaydi.</p>
        {/* Sana Toshkent vaqti bo'yicha ko'rsatiladi (UTC+5) */}
        <PayablesSinceForm value={new Date((c.payablesSince ?? DEFAULT_PAYABLES_SINCE).getTime() + 5 * 3_600_000).toISOString().slice(0, 10)} />
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">QQS (NDS 12%) — kirim</h2>
        <p className="mb-3 text-sm text-slate-500">Kirimda narx QQS&apos;siz kiritiladi, QQS to&apos;lovchisi yetkazuvchidan 12% QQS qo&apos;shiladi — yetkazuvchi qarzi va to&apos;lov QQS bilan. Korxona QQS to&apos;lovchisi bo&apos;lsa xomashyo tannarxi <b>QQS&apos;siz</b> (kirim QQS&apos;i byudjetdan qaytariladi, «Kirim QQS» reyestrida), aks holda QQS tannarxga qo&apos;shiladi. O&apos;zgartirish faqat yangi kirimlarga ta&apos;sir qiladi. Hozir: <b>{c.vatPayer ? "QQS to'lovchisi" : "QQS to'lovchisi emas"}</b>.</p>
        <VatPayerForm value={c.vatPayer} />
      </Card>
      <Card>
        <h2 className="mb-1 font-semibold">Ishlab chiqarish Telegram kanali</h2>
        <p className="mb-3 text-sm text-slate-500">
          Zayavka brigadaga tayinlanganda ERP boti shu kanalga xabar yozadi: topshiriq raqami, brigada, mijoz va obyekt, mahsulot va miqdor, muddat.
          Botni kanalga <b>administrator</b> qilib qo&apos;shing va «Xabar joylash» huquqini bering, keyin «Tekshirish» ni bosing.
          {!botEnabled() && <span className="mt-1 block text-amber-700">Serverda ERP boti ulanmagan (TELEGRAM_BOT_TOKEN yo&apos;q) — kanalga xabar ketmaydi.</span>}
        </p>
        <ProductionChannelForm value={c.productionTgChat} />
      </Card>
    </div>
  );
}

type PermFilter = { q?: string; rol?: string; faqat?: string; u?: string };

/**
 * Ruxsatlar — faqat direktor. Har xodimga istalgan bo'limni (rolidan tashqari ham) daraja yoki aniq amallar
 * bilan beradi: masalan Ishlab chiqarish xodimiga Sotuv → Zayavkalardan "ochish" va "qabul qilish".
 */
async function PermissionsTab({ f }: { f: PermFilter }) {
  const all = await db.user.findMany({
    where: { isActive: true, role: { notIn: ["DIRECTOR", "SUPERADMIN"] } },
    orderBy: [{ fullName: "asc" }],
    select: { id: true, fullName: true, login: true, role: true, perms: true },
  });
  const q = f.q?.trim().toLowerCase();
  const users = all.filter((u) =>
    (!q || u.fullName.toLowerCase().includes(q) || u.login.toLowerCase().includes(q)) &&
    (!f.rol || u.role === f.rol) &&
    (f.faqat !== "1" || !!parsePerms(u.perms)));
  const modulesFor = (role: Role) => permModules(role);
  const templates: PermTemplateOpt[] = (await positionTemplates()).map((t) => ({
    id: t.id, name: t.name, roleLabel: t.loginRole ? templateRoleLabel(t.loginRole) : null,
    summary: [t.loginRole ? `Asosiy bo'lim: ${templateRoleLabel(t.loginRole)}` : "", ...(Object.keys(t.perms).length ? describePerms(t.perms) : ["Ruxsatlar: rol bo'yicha"])].filter(Boolean).join(" · "),
  }));
  const withPerms = all.filter((u) => parsePerms(u.perms)).length;
  const roles = [...new Set(all.map((u) => u.role))];
  const others = all.map((u) => ({ id: u.id, label: `${u.fullName} · ${ROLE_LABELS[u.role]}`, has: !!parsePerms(u.perms) })).filter((o) => o.has);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-semibold">Bo&apos;lim va amal bo&apos;yicha ruxsat</h2>
        <p className="text-sm text-slate-500">
          Har xodimga istalgan bo&apos;limni — o&apos;z rolidan tashqari ham — kerakli huquq bilan bering. Masalan, Ishlab chiqarish xodimiga
          Sotuv → <b>Zayavkalar</b>dan faqat <b>«Mijoz zayavkasini ochish»</b>ni belgilasangiz, u zayavka ochadi, lekin qabul ham, bekor ham qila olmaydi.
        </p>
        <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-5">
          <div><Badge color="slate">Rol bo&apos;yicha</Badge> odatdagi holat</div>
          <div><Badge color="red">Yopiq</Badge> bo&apos;lim yashiriladi</div>
          <div><Badge color="blue">Ko&apos;rish</Badge> faqat o&apos;qiydi</div>
          <div><Badge color="amber">Tanlangan amallar</Badge> ko&apos;radi + belgilangani</div>
          <div><Badge color="green">To&apos;liq</Badge> barcha amallar</div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Faqat direktor beradi va o&apos;zgartiradi. Har o&apos;zgarish audit jurnaliga yoziladi, xodimga bildirishnoma boradi va qayta kirmasdan kuchga kiradi.
          Ruxsat qoidalari (kredit limiti, kunlik limit, qora ro&apos;yxat) baribir tekshiriladi.
        </p>
      </Card>

      <Card>
        <form className="flex flex-wrap items-end gap-2" action="/settings">
          <input type="hidden" name="tab" value="permissions" />
          <label className="text-xs text-slate-500">Qidirish<Input name="q" defaultValue={f.q ?? ""} placeholder="F.I.O. yoki login" className="mt-1 w-56" /></label>
          <label className="text-xs text-slate-500">Rol
            <Select name="rol" defaultValue={f.rol ?? ""} className="mt-1 w-44">
              <option value="">Hammasi</option>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </label>
          <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="faqat" value="1" defaultChecked={f.faqat === "1"} className="h-4 w-4 accent-slate-900" /> Faqat qo&apos;shimcha ruxsatlilar ({withPerms})</label>
          <Button variant="secondary">Ko&apos;rsatish</Button>
          {(f.q || f.rol || f.faqat) && <Link href="/settings?tab=permissions" className="py-2 text-sm text-slate-500 hover:underline">Tozalash</Link>}
        </form>
      </Card>

      {users.length > 0 && (
        <Card>
          <h2 className="mb-1 font-semibold">Bir nechta xodimga birdan</h2>
          <p className="mb-3 text-sm text-slate-500">
            Pastdagi ro&apos;yxatda xodimlarni belgilang va ularga lavozim shablonini yoki bitta ruxsatlar to&apos;plamini birdan bering. Har xodim uchun alohida audit yoziladi.
          </p>
          <BulkPermsBar templates={templates} modules={permModules(null)} total={users.length} />
        </Card>
      )}

      {users.length === 0 ? <Card><Empty text="Mos foydalanuvchi topilmadi" /></Card> : users.map((u) => {
        const perms = parsePerms(u.perms) ?? {};
        const chips = Object.entries(perms).map(([m, v]) => {
          const label = MODULES.find((x) => x.key === m)?.label ?? m;
          if (Array.isArray(v)) return { key: m, color: "amber" as const, text: `${label}: ${v.length ? v.map((a) => actionDef(m, a)?.label ?? a).join(", ") : "ko'rish"}`.slice(0, 90) };
          return { key: m, color: v === "none" ? ("red" as const) : v === "view" ? ("blue" as const) : ("green" as const), text: `${label}: ${v === "none" ? "yopiq" : v === "view" ? "ko'rish" : "to'liq"}` };
        });
        return (
          <Card key={u.id}>
            <div className="flex items-start gap-3">
            <input type="checkbox" form={BULK_FORM_ID} name="ids" value={u.id} aria-label={`${u.fullName} — belgilash`} className="mt-1 h-4 w-4 shrink-0 accent-slate-900" />
            <details open={f.u === u.id || users.length === 1} className="min-w-0 flex-1">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                <ShieldCheck size={16} className={chips.length ? "text-amber-500" : "text-slate-300"} />
                <span className="font-medium">{u.fullName}</span>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{u.login}</code>
                <Badge color="slate">{ROLE_LABELS[u.role]}</Badge>
                {chips.length === 0 ? <span className="text-xs text-slate-400">rol bo&apos;yicha</span> : chips.map((c) => <Badge key={c.key} color={c.color}>{c.text}</Badge>)}
                <span className="ml-auto text-xs text-slate-400">ochish / yopish</span>
              </summary>
              <div className="mt-4 space-y-3">
                <CopyPermsForm userId={u.id} others={others.filter((o) => o.id !== u.id)} />
                <UserPermsForm userId={u.id} modules={modulesFor(u.role)} current={perms} />
              </div>
            </details>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

async function ProductsTab() {
  const products = await db.product.findMany({ orderBy: { code: "asc" }, include: { recipes: { where: { isActive: true }, select: { version: true } } } });
  const fields = (p?: (typeof products)[number]) => [
    { name: "code", label: "Kod", defaultValue: p?.code, placeholder: "M300", required: true },
    { name: "name", label: "Nomi", defaultValue: p?.name, placeholder: "Beton M300 (B22.5)", required: true, className: "sm:col-span-2" },
    { name: "strengthClass", label: "Klass", defaultValue: p?.strengthClass, placeholder: "B22.5" },
    { name: "unit", label: "Birlik", type: "select" as const, defaultValue: p?.unit ?? "m3", options: PRODUCT_UNITS },
    { name: "price", label: "Narx, so'm/birlik", type: "money" as const, defaultValue: p ? Number(p.price) : "" },
    ...(p ? [{ name: "isActive", label: "Faol", type: "checkbox" as const, defaultValue: p.isActive }] : []),
  ];
  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-semibold">Yangi mahsulot</h2>
          {/* Ko'p mahsulotni bittalab yozmay: tayyor Excel ro'yxatdan yoki qator × ustun matritsasidan */}
          <div className="flex flex-wrap items-center gap-2"><ProductExcelPanel /><ProductMatrixPanel /></div>
        </div>
        <p className="mb-3 text-xs text-slate-500">Birligi m³ — tayyor beton (saqlanmaydi). Dona/m² — hovlida turadigan tayyor mahsulot, Sklad → Ishlab chiqarish imkoni bo'limida hisoblanadi.</p>
        <RowForm action={saveProduct.bind(null, null)} mode="create" cols={6} fields={fields()} />
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Mahsulotlar</h2>
        <div className="divide-y divide-slate-100">
          {products.map((p) => (
            <div key={p.id} className="py-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                {p.recipes[0] ? <Badge color="green">retsept v{p.recipes[0].version}</Badge> : <Badge color="red">retsept yo'q</Badge>}
                <Link href={`/recipes/${p.id}`} className="hover:underline">Retseptga o'tish</Link>
              </div>
              <RowForm action={saveProduct.bind(null, p.id)} cols={6} fields={fields(p)} extra={<DeleteButton action={deleteCatalogProduct} id={p.id} name={p.name} title="Mahsulotni o'chirish" />} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

async function MaterialsTab() {
  const materials = await db.material.findMany({ orderBy: { name: "asc" } });
  const fields = (m?: (typeof materials)[number]) => [
    { name: "code", label: "Kod", defaultValue: m?.code, placeholder: "CEM", required: true },
    { name: "name", label: "Nomi", defaultValue: m?.name, placeholder: "Sement M400", required: true, className: "sm:col-span-2" },
    { name: "unit", label: "Birlik", type: "select" as const, defaultValue: m?.unit ?? "kg", options: UNITS },
    { name: "minStock", label: "Minimal qoldiq", type: "number" as const, step: "0.001", defaultValue: m ? Number(m.minStock) : "" },
    ...(m ? [{ name: "isActive", label: "Faol", type: "checkbox" as const, defaultValue: m.isActive }] : []),
  ];
  return (
    <div className="space-y-4">
      <Card><h2 className="mb-3 font-semibold">Yangi xomashyo</h2><RowForm action={saveMaterial.bind(null, null)} mode="create" cols={6} fields={fields()} /></Card>
      <Card>
        <h2 className="mb-1 font-semibold">Xomashyo ro'yxati</h2>
        <p className="mb-3 text-xs text-slate-500">Minimal qoldiqdan kam qolsa bosh sahifada "Kam qoldi" signali chiqadi.</p>
        <div className="divide-y divide-slate-100">{materials.map((m) => <div key={m.id} className="py-3"><RowForm action={saveMaterial.bind(null, m.id)} cols={6} fields={fields(m)} extra={<DeleteButton action={deleteCatalogMaterial} id={m.id} name={m.name} title="Xomashyoni o'chirish" />} /></div>)}</div>
      </Card>
    </div>
  );
}

async function WarehousesTab() {
  const list = await db.warehouse.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { stockMoves: true } } } });
  return (
    <div className="space-y-4">
      <Card><h2 className="mb-3 font-semibold">Yangi sklad</h2><RowForm action={saveWarehouse.bind(null, null)} mode="create" cols={3} fields={[{ name: "name", label: "Nomi", placeholder: "2-sklad", required: true, className: "sm:col-span-2" }]} /></Card>
      <Card>
        <h2 className="mb-3 font-semibold">Skladlar</h2>
        <div className="divide-y divide-slate-100">
          {list.map((w) => (
            <div key={w.id} className="py-3">
              <div className="mb-1 text-xs text-slate-500">{w._count.stockMoves} ta harakat{w.isDefault && <b className="text-emerald-700"> · asosiy sklad</b>}</div>
              <RowForm action={saveWarehouse.bind(null, w.id)} cols={3} fields={[{ name: "name", label: "Nomi", defaultValue: w.name, required: true }, { name: "isActive", label: "Faol", type: "checkbox", defaultValue: w.isActive }, { name: "isDefault", label: "Asosiy (reys, brigada, brak)", type: "checkbox", defaultValue: w.isDefault }]} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

async function AccountsTab() {
  const [list, pay, tx] = await Promise.all([
    db.cashAccount.findMany({ orderBy: { name: "asc" } }),
    db.payment.groupBy({ by: ["cashAccountId"], _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null }, _sum: { amount: true } }),
  ]);
  // Qoldiq — Kirim-Chiqim va Egasi dashbordi bilan bir xil formula; qoldig'i bor hisob nofaol qilinmaydi
  const bal = new Map<string, number>();
  for (const p of pay) bal.set(p.cashAccountId, (bal.get(p.cashAccountId) ?? 0) + Number(p._sum.amount ?? 0));
  for (const t of tx) bal.set(t.cashAccountId, (bal.get(t.cashAccountId) ?? 0) + txSign(t.type) * Number(t._sum.amount ?? 0));
  const types: [string, string][] = [["CASH", "Naqd kassa"], ["BANK", "Bank hisobi"]];
  return (
    <div className="space-y-4">
      <Card><h2 className="mb-3 font-semibold">Yangi kassa / hisob</h2><RowForm action={saveCashAccount.bind(null, null)} mode="create" cols={4} fields={[{ name: "name", label: "Nomi", placeholder: "Asosiy hisob raqam", required: true, className: "sm:col-span-2" }, { name: "type", label: "Turi", type: "select", options: types, defaultValue: "BANK" }]} /></Card>
      <Card>
        <h2 className="mb-3 font-semibold">Kassa va hisoblar</h2>
        <div className="divide-y divide-slate-100">
          {list.map((a) => <div key={a.id} className="py-3"><div className="mb-1 text-xs text-slate-500">Qoldiq: <b className={(bal.get(a.id) ?? 0) < 0 ? "text-red-600" : "text-slate-700"}>{money(bal.get(a.id) ?? 0)}</b>{Math.abs(bal.get(a.id) ?? 0) >= 1 && a.isActive && " · qoldiq 0 bo'lmaguncha nofaol qilinmaydi"}{!a.isActive && Math.abs(bal.get(a.id) ?? 0) >= 1 && <span className="text-amber-700"> · nofaol, lekin qoldig&apos;i bor — Kirim-Chiqimda boshqa hisobga o&apos;tkazing</span>}</div><RowForm action={saveCashAccount.bind(null, a.id)} cols={4} fields={[{ name: "name", label: "Nomi", defaultValue: a.name, required: true, className: "sm:col-span-2" }, { name: "type", label: "Turi", type: "select", options: types, defaultValue: a.type }, { name: "isActive", label: "Faol", type: "checkbox", defaultValue: a.isActive }, ...(a.type === "BANK" ? [{ name: "allowOverdraft", label: "Overdraft (minus) ruxsat", type: "checkbox" as const, defaultValue: a.allowOverdraft }] : [])]} /></div>)}
        </div>
      </Card>
    </div>
  );
}

async function UsersTab({ me }: { me: string }) {
  // IT superadmin (platforma hisobi) ro'yxatda ko'rinmaydi — uni markaziy panel boshqaradi
  const users = await db.user.findMany({ where: { role: { not: "SUPERADMIN" } }, orderBy: [{ isActive: "desc" }, { fullName: "asc" }], include: { employee: true } });
  // SUPERADMIN — platforma (IT) roli: direktor uni bera olmaydi (server ham rad etadi), tanlovda ko'rinmasin
  const roles = Object.entries(ROLE_LABELS).filter(([r]) => r !== "DRIVER" && r !== "BRIGADIER" && r !== "SUPERADMIN");
  return (
    <div className="space-y-4">
      <Card><h2 className="mb-1 font-semibold">Yangi foydalanuvchi</h2><p className="mb-3 text-xs text-slate-500">Xodim bilan bog'lash uchun Xodimlar sahifasidan qo'shing — u yerda lavozim bo'yicha rol avtomatik beriladi.</p><UserForm roles={roles} /></Card>
      <p className="text-xs text-slate-500">Ism va rolni shu yerda tahrirlang (har o&apos;zgarish audit jurnalida). Rol o&apos;zgarsa foydalanuvchining ochiq sessiyalari tugaydi. O&apos;z rolingizni va oxirgi faol direktorni o&apos;zgartirib/bloklab bo&apos;lmaydi.</p>
      <Table>
        <thead><tr><Th>F.I.O. va rol</Th><Th>Login</Th><Th>Xodim</Th><Th>Holat</Th><Th>Parol</Th><Th></Th></tr></thead>
        <tbody>
          {users.map((u) => (
            <Tr key={u.id}>
              <Td><UserEditForm userId={u.id} fullName={u.fullName} role={u.role} roles={u.role === "DRIVER" || u.role === "BRIGADIER" ? [[u.role, ROLE_LABELS[u.role]], ...roles] : roles} self={u.id === me} /></Td>
              <Td><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{u.login}</code></Td>
              <Td className="text-slate-500">{u.employee ? u.employee.position : "—"}</Td>
              <Td>{u.isActive ? <Badge color="green">Faol</Badge> : <Badge>Bloklangan</Badge>}</Td>
              <Td><ResetPasswordForm userId={u.id} /></Td>
              <Td>{u.id !== me && <ToggleUserButton userId={u.id} name={u.fullName} active={u.isActive} />}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** Hisobni o'chirish so'rovlari — App Store / Google Play talabi: xodim ilovadan so'raydi, direktor shu yerda hal qiladi. */
async function DeletionsTab() {
  const list = await db.accountDeletionRequest.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100, include: { employee: { select: { id: true, position: true } }, user: { select: { login: true, role: true } }, handledBy: { select: { fullName: true } } } });
  const pending = list.filter((r) => r.status === "PENDING");
  const done = list.filter((r) => r.status !== "PENDING");
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-semibold">Hisobni o'chirish so'rovlari</h2>
        <p className="text-xs text-slate-500">
          Mijozlar (quruvchi, tadbirkor) ilovada hisobini o'zi darhol o'chiradi. Zavod xodimi so'rov qoldiradi — tasdiqlansa ERP logini yopiladi,
          sessiyalar tugaydi, ilova hisobi (ECO) anonimlashtiriladi. Xodim kartasi (HR, tabel) o'chirilmaydi. Saytdan kelgan so'rovda odam tekshirilmagan — avval telefon qiling.
        </p>
      </Card>
      {pending.length === 0 ? <Card><Empty text="Ochiq so'rov yo'q" /></Card> : (
        <Table>
          <thead><tr><Th>Kim</Th><Th>Qayerdan</Th><Th>Telefon</Th><Th>ERP login</Th><Th>Izoh</Th><Th>Vaqt</Th><Th></Th></tr></thead>
          <tbody>
            {pending.map((r) => (
              <Tr key={r.id}>
                <Td className="font-medium">{r.employee ? <Link className="underline" href={`/employees/${r.employee.id}`}>{r.fullName}</Link> : r.fullName}{r.employee?.position && <span className="block text-xs text-slate-500">{r.employee.position}</span>}</Td>
                <Td>{SOURCE_LABEL[r.source]}</Td>
                <Td>{r.phone ?? "—"}</Td>
                <Td>{r.user ? <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.user.login}</code> : <span className="text-slate-400">yo'q</span>}</Td>
                <Td className="max-w-xs text-xs text-slate-500">{r.note ?? "—"}</Td>
                <Td className="text-slate-500">{dateTime(r.createdAt)}</Td>
                <Td><DeletionRow id={r.id} name={r.fullName} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {done.length > 0 && (
        <Table>
          <thead><tr><Th>Kim</Th><Th>Qayerdan</Th><Th>Holat</Th><Th>Natija</Th><Th>Kim hal qildi</Th><Th>Vaqt</Th></tr></thead>
          <tbody>
            {done.map((r) => (
              <Tr key={r.id}>
                <Td>{r.fullName}</Td><Td>{SOURCE_LABEL[r.source]}</Td>
                <Td>{r.status === "APPROVED" ? <Badge color="green">O'chirildi</Badge> : <Badge>Rad etildi</Badge>}</Td>
                <Td className="max-w-md text-xs text-slate-500">{r.result ?? "—"}</Td>
                <Td className="text-slate-500">{r.handledBy?.fullName ?? "—"}</Td>
                <Td className="text-slate-500">{r.handledAt ? dateTime(r.handledAt) : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/** Ikki JSON holat orasidagi farq — faqat o'zgargan maydonlar (yuqori daraja). */
function auditDiff(before: unknown, after: unknown): { key: string; from: string; to: string }[] {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const b = obj(before), a = obj(after);
  const show = (v: unknown) => { if (v === undefined) return "—"; const t = typeof v === "string" ? v : JSON.stringify(v); return t.length > 60 ? `${t.slice(0, 57)}…` : t; };
  if (!b && !a) return before === undefined && after === undefined ? [] : [{ key: "", from: show(before ?? undefined), to: show(after ?? undefined) }];
  const skip = new Set(["updatedAt", "createdAt", "passwordHash", "sessionVersion"]);
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].filter((k) => !skip.has(k));
  // Yaratishda (before yo'q) — hamma maydon "yangi"; tahrirda — faqat farq qilganlari
  return keys.filter((k) => !b || !a || JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((k) => ({ key: k, from: b ? show(b[k]) : "—", to: a ? show(a[k]) : "—" }));
}

async function AuditTab({ f }: { f: AuditFilter }) {
  const page = Math.max(1, Number(f.page) || 1);
  const from = f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? new Date(`${f.from}T00:00:00`) : null;
  const to = f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? new Date(new Date(`${f.to}T00:00:00`).getTime() + 86400000) : null;
  const where = {
    ...(f.user ? { userId: f.user } : {}),
    ...(f.entity ? { entity: f.entity } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
  };
  const [logs, total, users, entities] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * AUDIT_PAGE, take: AUDIT_PAGE, include: { user: { select: { fullName: true } } } }),
    db.auditLog.count({ where }),
    db.user.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    db.auditLog.groupBy({ by: ["entity"], _count: { _all: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE));
  const qs = (p: number) => { const q = new URLSearchParams({ tab: "audit" }); for (const k of ["user", "entity", "from", "to"] as const) if (f[k]) q.set(k, f[k]!); if (p > 1) q.set("page", String(p)); return `/settings?${q}`; };
  const sel = "rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm";
  return (
    <div className="space-y-3">
      <Card>
        <form method="get" action="/settings" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="audit" />
          <label className="text-xs text-slate-500">Kim<select name="user" defaultValue={f.user ?? ""} className={`mt-1 block w-48 ${sel}`}><option value="">Hammasi</option>{users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></label>
          <label className="text-xs text-slate-500">Obyekt<select name="entity" defaultValue={f.entity ?? ""} className={`mt-1 block w-52 ${sel}`}><option value="">Hammasi</option>{entities.sort((a, b) => (ENTITY_LABEL[a.entity] ?? a.entity).localeCompare(ENTITY_LABEL[b.entity] ?? b.entity)).map((e) => <option key={e.entity} value={e.entity}>{ENTITY_LABEL[e.entity] ?? e.entity} ({e._count._all})</option>)}</select></label>
          <label className="text-xs text-slate-500">Sanadan<input type="date" name="from" defaultValue={f.from ?? ""} className={`mt-1 block ${sel}`} /></label>
          <label className="text-xs text-slate-500">Sanagacha<input type="date" name="to" defaultValue={f.to ?? isoDate(new Date())} className={`mt-1 block ${sel}`} /></label>
          <Button className="py-1.5 text-sm">Ko&apos;rsatish</Button>
          {(f.user || f.entity || f.from || f.to) && <Link href="/settings?tab=audit" className="py-1.5 text-sm text-slate-500 hover:underline">Tozalash</Link>}
          <span className="ml-auto text-xs text-slate-500">{total} ta yozuv</span>
        </form>
      </Card>
      <Table>
        <thead><tr><Th>Vaqt</Th><Th>Kim</Th><Th>Amal</Th><Th>Obyekt</Th><Th>O&apos;zgarish (oldin → keyin)</Th></tr></thead>
        <tbody>
          {logs.length === 0 && <Empty text="Bu filtr bo'yicha yozuv yo'q" />}
          {logs.map((l) => {
            const diff = auditDiff(l.before ?? undefined, l.after ?? undefined);
            return (
              <Tr key={l.id}>
                <Td className="whitespace-nowrap align-top">{dateTime(l.createdAt)}</Td>
                <Td className="align-top">{l.user.fullName}</Td><Td className="align-top">{ACTION_LABEL[l.action] ?? l.action}</Td>
                <Td className="align-top">{ENTITY_LABEL[l.entity] ?? l.entity}<div className="font-mono text-[10px] text-slate-400">{l.entityId.slice(0, 12)}</div></Td>
                <Td className="max-w-xl align-top text-xs">
                  {diff.length === 0 ? <span className="text-slate-400">—</span> : (
                    <ul className="space-y-0.5">
                      {diff.slice(0, 8).map((d) => (
                        <li key={d.key} className="break-words">
                          {d.key && <span className="font-medium text-slate-700">{d.key}: </span>}
                          {l.before != null && <><span className="text-red-600 line-through decoration-red-300">{d.from}</span> → </>}
                          <span className="text-emerald-700">{d.to}</span>
                        </li>
                      ))}
                      {diff.length > 8 && <li className="text-slate-400">yana {diff.length - 8} ta maydon</li>}
                    </ul>
                  )}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={qs(page - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">← Oldingi</Link> : <span />}
          <span className="text-slate-500">{page} / {pages}</span>
          {page < pages ? <Link href={qs(page + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50">Keyingi →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
