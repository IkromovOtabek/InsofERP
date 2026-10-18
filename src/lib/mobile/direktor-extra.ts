import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/nav";
import { canDo } from "@/lib/permissions";
import { POSITIONS } from "@/lib/positions";
import { formatPhone } from "@/lib/phone";
import { getCompany } from "@/lib/company";
import { monthTitle, shiftMonth, today as todayIso, validMonth } from "@/lib/davomat";
import { ACCESS_ROLES, approveAccessAs, pendingAccessRequests, rejectAccessRequest } from "@/lib/access-request";
import { SOURCE_LABEL, approveRequest as approveDeletion, rejectRequest as rejectDeletion } from "@/lib/account-deletion";
import { eco, ecoEnabled, type EcoAppRole, type EcoAppUser } from "@/lib/eco/client";
import { APP_GRANTABLE_ROLES, grantAppAccess, revokeAppAccess } from "@/lib/eco/app-login";
import { LINK_CODE_TTL_MIN, createTelegramLinkCode } from "@/lib/telegram/link-code";
import { botEnabled, getMe } from "@/lib/telegram/api";
import { budgetMonth } from "@/lib/expense-budget";
import { OWNER_EDGES } from "@/lib/receivables";
import { autoGran, parseRange, type Kpi, type Range } from "@/lib/bi/core";
import { overviewTab } from "@/lib/bi/overview";
import { salesTab } from "@/lib/bi/sales";
import { returnsTab } from "@/lib/bi/returns";
import { agentsTab } from "@/lib/bi/agents";
import { customersTab } from "@/lib/bi/customers";
import { stockTab } from "@/lib/bi/stock";
import { productsTab } from "@/lib/bi/products";
import { operationsTab } from "@/lib/bi/operations";
import { financeTab } from "@/lib/bi/finance";
import { MONTHS_UZ, plansTab } from "@/lib/bi/plans";
import { KIND_LABEL, marketingEntries, marketingPlanTab, marketingTab } from "@/lib/bi/marketing";
import { anomaliesTab, forecastTab } from "@/lib/bi/forecast";
import { ownerCached } from "./owner-cache";
import { day, money, num, pctText, short, shortSigned, time } from "./fmt";
import { ListError, type ListFilter, type MobileList } from "./list";
import { DIREKTOR_ACTION_ROLES, DIREKTOR_PERM } from "./direktor-extra-access";
import type { MobileUser } from "./auth";
import type { DetailAction, DetailField, MobileDetail } from "./detail";
import type { HomeRow, HomeSection, SectionChart, Tone } from "./home";
import type { ActionResult } from "./actions";

/**
 * Direktor kabinetining veb ↔ mobil tengligi (ERP → Insof ECO):
 *   · «Tasdiqlar»dagi kirish arizalari (`access`) va hisobni o'chirish so'rovlari (`deletion`);
 *   · «Ilova foydalanuvchilari» (Insof ECO'da ro'yxatdan o'tganlar) — ERP'ga ruxsat berish / yopish;
 *   · BI tahlil (`bi`) — vebdagi `/bi-tahlil/*` sahifalarining raqamlari `lib/bi/*` dan (direktor, moliya, buxgalteriya);
 *   · Reja nazorati va marketing (faqat ko'rish), Telegram AI botiga ulash kodi;
 *   · Xarajat byudjeti va chegaralar (faqat ko'rish) — `lib/expense-budget.ts`;
 *   · Egasi dashbordining mobil bosh sahifada yo'q bloklari (`owner`): plan/fakt/prognoz, voronka, debitorka/kreditorka,
 *     sklad, transport, pul rejasi, xarajat nazorati — `ownerDashboard()` (vebdagi bilan bitta manba).
 *
 * Hisob-kitob bu yerda takrorlanmaydi: faqat veb lib funksiyalarining natijasi ilova ko'rinishiga o'giriladi.
 * Ruxsat jadvallari — `./direktor-extra-access.ts`.
 */

const fail = (m: string, status = 400): never => { throw new ListError("ACTION_FAILED", m, status); };
const notFound = (m = "Topilmadi"): never => { throw new ListError("NOT_FOUND", m, 404); };
const textOf = (p: Record<string, unknown>, key: string) => String(p[key] ?? "").trim();

const f = (label: string, value: string, tone?: Tone): DetailField => ({ label, value, tone });
const sec = (title: string, rows: HomeRow[], o: { empty?: string; target?: string; icon?: string; chart?: SectionChart } = {}): HomeSection =>
  ({ title, rows, empty: o.empty ?? "Ma'lumot yo'q", target: o.target, icon: o.icon, chart: o.chart });
const pick = (...s: (HomeSection | null | undefined | false)[]) => s.filter((x): x is HomeSection => !!x);
const dt = (d: Date) => `${day(d)} ${time(d)}`;
const fx = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "—");
/** O'zgarish izohi: "▲ 12%". */
const arrow = (delta: number | null | undefined) => (delta == null || !Number.isFinite(delta) ? "" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}%`);
/** KPI maydoni: joriy qiymat va oldingi davrdan o'zgarish. */
const kf = (label: string, k: Kpi, fmt: (v: number) => string = short, invert = false): DetailField => {
  const a = arrow(k.delta);
  const bad = k.delta != null && (invert ? k.delta > 0 : k.delta < 0);
  return f(label, a ? `${fmt(k.cur)} · ${a}` : fmt(k.cur), bad ? "warning" : undefined);
};
const pctF = (v: number) => `${fx(v)}%`;
const levelTone = (l: string): Tone => (l === "crit" || l === "danger" ? "danger" : l === "warn" || l === "warning" ? "warning" : l === "info" ? "info" : "success");
/** Davr bo'yicha ustunlar: bitta seriya. */
const barsOf = (label: string, pts: { label: string; value: number }[], fmt: (v: number) => string = short): SectionChart => ({
  kind: "bars", series: [{ key: "v", label }],
  points: pts.map((p) => ({ label: p.label, values: [Math.max(0, p.value)], texts: [fmt(p.value)] })),
  total: fmt(pts.reduce((s, p) => s + p.value, 0)),
});
/** Ulushlar halqasi — ilova eng kattalarini o'zi oladi. */
const donutOf = (items: { label: string; value: number }[], fmt: (v: number) => string = short, totalLabel?: string): SectionChart => {
  const list = items.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  return { kind: "donut", items: list.map((x) => ({ label: x.label, value: x.value, text: fmt(x.value) })), total: fmt(list.reduce((s, x) => s + x.value, 0)), totalLabel };
};
/** Dinamika qatorlari (eski ilova grafikni chizmaydi) — qiymati bor oxirgi davrlar, yangisi tepada. */
const dynRows = (pts: { label: string; value: number }[], fmt: (v: number) => string = short, limit = 10): HomeRow[] =>
  pts.map((p, i) => ({ ...p, i })).filter((p) => p.value !== 0).slice(-limit).reverse().map((p) => ({ id: `p${p.i}`, title: p.label, right: fmt(p.value) }));
/** Yakshanbadan boshlangan hafta kunlari → Dushanbadan. */
const monFirst = <T,>(a: T[]) => [...a.slice(1), a[0]!];

/** Amalni foydalanuvchi bajara oladimi — `detail.ts` `can()` bilan bir xil qoida (bu fayl `detail.ts` ni import qilmaydi). */
function allowed(user: MobileUser, action: string): boolean {
  const roles = Object.hasOwn(DIREKTOR_ACTION_ROLES, action) ? DIREKTOR_ACTION_ROLES[action] : [];
  if (!roles.includes(user.role)) return false;
  if (user.role === "DIRECTOR") return true;
  const p = DIREKTOR_PERM[action];
  return p?.action ? canDo({ role: user.role, perms: user.perms }, p.module, p.action) : true;
}

// ───────────────────────── Tasdiqlar: kirish arizalari, hisobni o'chirish ─────────────────────────

const positionLabel = (role: string) => POSITIONS.find((p) => p.role === role)?.label ?? ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role;

/** «Tasdiqlar» → «Kirish arizalari»: login sahifasidan yuborilgan, telefon kodi bilan tasdiqlangan arizalar. */
export async function accessApprovalRows(q?: string): Promise<HomeRow[]> {
  const s = q?.toLowerCase();
  const rows = (await pendingAccessRequests()).filter((r) => !s || r.fullName.toLowerCase().includes(s) || r.login.includes(s) || r.phone.includes(s));
  return rows.map((r) => ({
    id: `access:${r.id}`, title: `${r.fullName} · ${r.position}`,
    subtitle: `Kirish arizasi · login ${r.login} · ${formatPhone(r.phone)} · ${day(r.createdAt)}${r.existingLogin ? ` · raqamda login bor: ${r.existingLogin}` : ""}`,
    status: "Login", tone: (r.existingLogin ? "danger" : "warning") as Tone,
  }));
}

/** «Tasdiqlar» → «Hisobni o'chirish»: xodim ilovadan / saytdan so'ragan (App Store, Google Play talabi). */
export async function deletionApprovalRows(q?: string): Promise<HomeRow[]> {
  const list = await db.accountDeletionRequest.findMany({
    where: { status: "PENDING", ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}) },
    orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { login: true } } },
  });
  return list.map((r) => ({
    id: `deletion:${r.id}`, title: r.fullName,
    subtitle: `Hisobni o'chirish so'rovi · ${SOURCE_LABEL[r.source]}${r.phone ? ` · ${formatPhone(r.phone)}` : ""}${r.user ? ` · login ${r.user.login}` : ""} · ${day(r.createdAt)}`,
    status: "O'chirish", tone: "danger" as Tone,
  }));
}

const ACCESS_STATUS: Record<string, string> = { UNVERIFIED: "Kod tasdiqlanmagan", PENDING: "Tasdiq kutmoqda", APPROVED: "Login ochilgan", REJECTED: "Rad etilgan" };

async function accessDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const r = (await pendingAccessRequests()).find((x) => x.id === id);
  if (!r) {
    const done = await db.accessRequest.findUnique({ where: { id }, select: { fullName: true, phone: true, position: true, login: true, status: true, decidedAt: true, rejectReason: true } });
    if (!done) return notFound("Ariza topilmadi");
    return {
      key: "access", id, title: done.fullName, subtitle: "Kirish arizasi", status: ACCESS_STATUS[done.status],
      fields: [f("Telefon", formatPhone(done.phone)), f("Bo'lim", done.position), f("Login", done.login), f("Holat", ACCESS_STATUS[done.status] ?? done.status, done.status === "APPROVED" ? "success" : "danger"),
        ...(done.decidedAt ? [f("Ko'rib chiqildi", dt(done.decidedAt))] : []), ...(done.rejectReason ? [f("Sabab", done.rejectReason)] : [])],
      sections: [], actions: [],
    };
  }
  const actions: DetailAction[] = [];
  if (allowed(user, "access.approve")) actions.push({
    id: "access.approve", label: "Tasdiqlash — login ochish", tone: "success",
    form: [{ name: "role", label: "Bo'lim (tizim huquqi)", type: "select", required: true, value: r.suggestedRole && ACCESS_ROLES.includes(r.suggestedRole) ? r.suggestedRole : undefined, options: ACCESS_ROLES.map((x) => ({ value: x, label: positionLabel(x) })) }],
  });
  if (allowed(user, "access.reject")) actions.push({ id: "access.reject", label: "Rad etish", tone: "danger", form: [{ name: "reason", label: "Sabab (ixtiyoriy)", type: "text" }] });
  return {
    key: "access", id, title: r.fullName, subtitle: "Kirish arizasi — xodim o'zi login va parol tanlagan, telefonini kod bilan tasdiqlagan", status: "Tasdiq kutmoqda",
    fields: [
      f("Telefon", formatPhone(r.phone)), f("So'ragan bo'lim", r.position), f("Login", r.login), f("Yuborilgan", dt(r.createdAt)),
      r.existingLogin ? f("Diqqat", `Bu raqamda login bor: ${r.existingLogin}`, "danger")
        : r.employee ? f("Xodim kartasi", `Bor: ${r.employee.fullName} · ${r.employee.position}`, "success")
        : f("Xodim kartasi", "Yangi karta ochiladi", "info"),
      ...(r.note ? [f("Izoh", r.note)] : []),
    ],
    sections: [], actions,
  };
}

async function deletionDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const r = await db.accountDeletionRequest.findUnique({ where: { id }, include: { employee: { select: { id: true, position: true, fullName: true } }, user: { select: { login: true, role: true } }, handledBy: { select: { fullName: true } } } });
  if (!r) return notFound("So'rov topilmadi");
  const open = r.status === "PENDING";
  const actions: DetailAction[] = open && allowed(user, "deletion.approve") ? [
    { id: "deletion.approve", label: "Tasdiqlash — hisobni yopish", tone: "danger", confirm: `${r.fullName} hisobi yopilsinmi? ERP logini yopiladi, sessiyalar tugaydi, ilova hisobi anonimlashtiriladi. Xodim kartasi saqlanadi.` },
    { id: "deletion.reject", label: "Rad etish", form: [{ name: "reason", label: "Sabab (ixtiyoriy)", type: "text" }] },
  ] : [];
  return {
    key: "deletion", id, title: r.fullName, subtitle: "Hisobni o'chirish so'rovi", status: open ? "Kutmoqda" : r.status === "APPROVED" ? "O'chirildi" : "Rad etildi",
    fields: [
      f("Qayerdan", SOURCE_LABEL[r.source]), f("Telefon", r.phone ? formatPhone(r.phone) : "—"),
      f("ERP login", r.user ? `${r.user.login} · ${ROLE_LABELS[r.user.role] ?? r.user.role}` : "yo'q"),
      ...(r.employee ? [f("Xodim", `${r.employee.fullName} · ${r.employee.position}`)] : []),
      f("Yuborilgan", dt(r.createdAt)), ...(r.note ? [f("Izoh", r.note)] : []),
      ...(r.source === "WEB" && open ? [f("Diqqat", "Saytdan kelgan — odam tekshirilmagan, avval telefon qiling", "warning")] : []),
      ...(!open ? [f("Natija", r.result ?? "—"), f("Kim hal qildi", `${r.handledBy?.fullName ?? "—"}${r.handledAt ? ` · ${dt(r.handledAt)}` : ""}`)] : []),
    ],
    sections: r.employee ? [sec("Xodim kartasi", [{ id: r.employee.id, title: r.employee.fullName, subtitle: r.employee.position }], { target: "employees" })] : [],
    actions,
  };
}

// ───────────────────────── Ilova foydalanuvchilari (Insof ECO) ─────────────────────────

const APP_ROLE: Record<EcoAppRole, string> = { TADBIRKOR: "Tadbirkor", QURUVCHI: "Quruvchi", HAYDOVCHI: "Haydovchi" };
const NEW_DAYS = 7;
const APP_TABS = [
  { key: "all", label: "Hammasi" }, { key: "new", label: `Yangi (${NEW_DAYS} kun)` },
  { key: "TADBIRKOR", label: "Tadbirkor" }, { key: "QURUVCHI", label: "Quruvchi" }, { key: "HAYDOVCHI", label: "Haydovchi" },
] as const;
const ecoOff = () => fail("Insof ECO ulanmagan — ERP sozlamasida ECO_API_URL va ECO_API_KEY yo'q", 503);
const isNewUser = (u: EcoAppUser) => new Date(u.registeredAt).getTime() >= Date.now() - NEW_DAYS * 86_400_000;
const hasAppRole = (u: EcoAppUser, r: string) => u.memberships.some((m) => m.role === r);
/** Kartochka id'si: `<ecoUserId>~<telefon>` — telefon ECO qidiruvi uchun (veb ham telefon bilan qidiradi), id aniq mos kelishi shart. */
const appUserId = (u: EcoAppUser) => `${u.userId}~${u.phone}`;

async function erpLinks(ecoIds: string[]) {
  const [employees, users] = await Promise.all([
    ecoIds.length ? db.employee.findMany({ where: { ecoUserId: { in: ecoIds } }, select: { id: true, fullName: true, position: true, ecoUserId: true, userId: true } }) : [],
    ecoIds.length ? db.user.findMany({ where: { ecoUserId: { in: ecoIds } }, select: { ecoUserId: true, role: true, isActive: true } }) : [],
  ]);
  return { employeeByEco: new Map(employees.map((e) => [e.ecoUserId!, e])), erpByEco: new Map(users.map((u) => [u.ecoUserId!, u])) };
}

async function appUsersList(title: string, q?: string, filter?: string): Promise<MobileList> {
  // Ro'yxat ochilishi xato bermasin: ECO ulanmagan yoki javob bermasa — sabab sarlavhada, ro'yxat bo'sh (veb sahifasi kabi)
  if (!ecoEnabled()) return { key: "ilova-users", title: `${title} — Insof ECO ulanmagan`, rows: [] };
  let users: EcoAppUser[];
  try { users = await eco.appUsers(q || undefined); } catch { return { key: "ilova-users", title: `${title} — ECO serveriga ulanib bo'lmadi`, rows: [] }; }
  const { erpByEco } = await erpLinks(users.map((u) => u.userId));
  const tab = APP_TABS.find((t) => t.key === filter) ?? APP_TABS[0];
  const test = (u: EcoAppUser, k: string) => (k === "all" ? true : k === "new" ? isNewUser(u) : hasAppRole(u, k));
  const rows: HomeRow[] = users.filter((u) => test(u, tab.key)).slice(0, 200).map((u) => {
    const erp = erpByEco.get(u.userId);
    return {
      id: appUserId(u), title: `${u.fullName ?? "ism kiritilmagan"}${isNewUser(u) ? " · yangi" : ""}`,
      subtitle: [formatPhone(u.phone), u.memberships.map((m) => `${APP_ROLE[m.role]} · ${m.ownPlant ? "bizning zavod" : m.org.name}${m.isActive ? "" : " (tasdiq kutilmoqda)"}`).join(", ") || "rol tanlanmagan"].join(" · "),
      right: u.lastLoginAt ? day(new Date(u.lastLoginAt)) : undefined,
      status: u.deleteRequestedAt ? "O'chirish so'ralgan" : erp ? (erp.isActive ? `ERP · ${ROLE_LABELS[erp.role]}` : "Ruxsat yopilgan") : undefined,
      tone: (u.deleteRequestedAt ? "danger" : erp?.isActive ? "success" : erp ? "warning" : "info") as Tone,
    };
  });
  const filters: ListFilter[] = APP_TABS.map((t) => ({ key: t.key, label: t.label, count: users.filter((u) => test(u, t.key)).length, active: t.key === tab.key }));
  return { key: "ilova-users", title, rows, filters };
}

async function findAppUser(id: string): Promise<EcoAppUser> {
  if (!ecoEnabled()) ecoOff();
  const i = id.indexOf("~");
  const ecoUserId = i > 0 ? id.slice(0, i) : id, phone = i > 0 ? id.slice(i + 1) : "";
  let list: EcoAppUser[];
  try { list = await eco.appUsers(phone || undefined); } catch (e) { return fail(`ECO serveriga ulanib bo'lmadi: ${(e as Error).message}`, 502); }
  return list.find((u) => u.userId === ecoUserId) ?? notFound("Ilova foydalanuvchisi topilmadi");
}

async function appUserDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const u = await findAppUser(id);
  const { employeeByEco, erpByEco } = await erpLinks([u.userId]);
  const emp = employeeByEco.get(u.userId), erp = erpByEco.get(u.userId);
  const refs = u.memberships.map((m) => m.org.externalRef).filter((r): r is string => !!r);
  const customers = refs.length ? await db.customer.findMany({ where: { id: { in: refs } }, select: { id: true, name: true } }) : [];
  const current = erp?.isActive ? erp.role : null;
  // Zavod xodimi (login lavozimidan, Otdel kadrda) — bu yerdan faqat telefon bilan kirish ulanadi (veb `AppAccess` bilan bir xil)
  const employee = !!emp?.userId && !erp;
  const actions: DetailAction[] = [];
  if (!u.deleteRequestedAt && erp?.role !== "DIRECTOR" && allowed(user, "appuser.grant")) {
    if (employee && !current) actions.push({ id: "appuser.grant", label: "Telefon bilan kirishni ulash", tone: "brand", confirm: "Xodim ERP'ga ilovadagi telefon va paroli bilan ham kira oladi. Roli lavozimidan qoladi." });
    if (!employee) actions.push({
      id: "appuser.grant", label: current ? "Rolni almashtirish" : "ERP'ga ruxsat berish", tone: current ? undefined : "success",
      form: [{ name: "role", label: "Rol", type: "select", required: true, value: current ?? undefined, options: APP_GRANTABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) }],
    });
    if (current) actions.push({ id: "appuser.revoke", label: "Ruxsatni yopish", tone: "danger", confirm: "ERP'ga kirish ruxsati yopilsinmi? Ochiq sessiyalari darhol tugaydi." });
  }
  const device = u.device ? `${u.device.platform === "ios" ? "iOS" : u.device.platform === "android" ? "Android" : u.device.platform}${u.device.model ? ` · ${u.device.model}` : ""}${u.device.appVersion ? ` · v${u.device.appVersion}` : ""}` : "—";
  return {
    key: "ilova-users", id, title: u.fullName ?? "Ism kiritilmagan", subtitle: "Insof ECO ilovasi foydalanuvchisi",
    status: u.deleteRequestedAt ? "O'chirish so'ralgan" : current ? "ERP'ga kira oladi" : undefined,
    fields: [
      f("Telefon", formatPhone(u.phone)), f("Ro'yxatdan o'tgan", dt(new Date(u.registeredAt))),
      f("Oxirgi kirish", u.lastLoginAt ? dt(new Date(u.lastLoginAt)) : "—"), f("Qurilma", device),
      f("ERP", erp ? (erp.isActive ? `Kira oladi · ${ROLE_LABELS[erp.role]}` : "Ruxsat yopilgan") : employee ? "Xodim logini bor (telefon ulanmagan)" : "Ruxsat yo'q", erp?.isActive ? "success" : erp ? "danger" : undefined),
      ...(u.deleteRequestedAt ? [f("Hisobni o'chirish", `So'ralgan · ${dt(new Date(u.deleteRequestedAt))}`, "danger")] : []),
    ],
    sections: pick(
      sec("Rollar va tashkilotlar", u.memberships.map((m, i) => ({ id: `m${i}`, title: `${APP_ROLE[m.role]} · ${m.ownPlant ? "bizning zavod" : m.org.name}`, subtitle: `${m.isActive ? "faol" : "tasdiq kutilmoqda"} · ${day(new Date(m.since))}${m.org.inn ? ` · INN ${m.org.inn}` : ""}`, tone: (m.isActive ? "success" : "warning") as Tone })), { icon: "users", empty: "Rol tanlanmagan" }),
      customers.length > 0 && sec("ERP mijoz kartasi", customers.map((c) => ({ id: c.id, title: c.name })), { target: "customers" }),
      emp && sec("ERP xodim kartasi", [{ id: emp.id, title: emp.fullName, subtitle: emp.position }], { target: "employees" }),
    ),
    actions,
  };
}

// ───────────────────────── Xarajat byudjeti (faqat ko'rish) ─────────────────────────

const ymNow = () => todayIso().slice(0, 7);

async function budgetList(title: string, filter?: string): Promise<MobileList> {
  const cur = ymNow();
  const months = [shiftMonth(cur, -2), shiftMonth(cur, -1), cur, shiftMonth(cur, 1)];
  const ym = validMonth(filter) ?? cur;
  const [{ rows }, company] = await Promise.all([budgetMonth(ym), getCompany()]);
  const shown = rows.filter((r) => r.amount !== null || r.fact > 0);
  const plan = rows.reduce((s, r) => s + (r.amount ?? 0), 0), fact = rows.reduce((s, r) => s + r.fact, 0), fc = rows.reduce((s, r) => s + r.forecast, 0);
  const tone = (r: (typeof rows)[number]): Tone => (r.over ? "danger" : r.amount === null ? "warning" : r.fact >= r.amount * (company.alertWarnPct / 100) ? "warning" : "success");
  return {
    key: "byudjet", title,
    rows: [
      { id: `${ym}~*`, title: `Jami — ${monthTitle(ym)}`, subtitle: `byudjet ${short(plan)} · prognoz ${short(fc)} · ${rows.filter((r) => r.over).length} ta oshgan · chegaralar va tarix`, right: short(fact), tone: plan && fact > plan ? "danger" : "brand" },
      ...shown.map((r) => ({
        id: `${ym}~${r.cat}`, title: r.cat,
        subtitle: `${r.amount === null ? "byudjetsiz" : `byudjet ${short(r.amount)}`}${r.limit !== null ? ` · limit ${short(r.limit)}` : ""} · prognoz ${short(r.forecast)}`,
        right: `${short(r.fact)}${r.amount ? ` · ${pctText((r.fact / r.amount) * 100)}` : ""}`,
        status: r.over ? "Oshdi" : r.amount === null ? "Rejasiz" : undefined, tone: tone(r),
      })),
    ],
    filters: months.map((m) => ({ key: m, label: monthTitle(m), active: m === ym })),
  };
}

async function budgetDetail(id: string): Promise<MobileDetail> {
  const i = id.indexOf("~");
  const ym = validMonth(i > 0 ? id.slice(0, i) : id) ?? ymNow();
  const cat = i > 0 ? id.slice(i + 1) : "*";
  const [{ rows, history }, company] = await Promise.all([budgetMonth(ym), getCompany()]);
  if (cat === "*") {
    const plan = rows.reduce((s, r) => s + (r.amount ?? 0), 0), fact = rows.reduce((s, r) => s + r.fact, 0);
    return {
      key: "byudjet", id, title: `Xarajat byudjeti — ${monthTitle(ym)}`, subtitle: "Faqat ko'rish · o'zgartirish vebda (Bosh sahifa → Byudjet)",
      fields: [
        f("Byudjet jami", money(plan)), f("Fakt (chiqim)", money(fact), plan && fact > plan ? "danger" : undefined),
        f("Prognoz (oy oxiri)", money(rows.reduce((s, r) => s + r.forecast, 0))),
        f("Byudjetdan oshgan", `${rows.filter((r) => r.over).length} kategoriya`, rows.some((r) => r.over) ? "danger" : "success"),
        f("Rejalashtirilmagan", `${rows.filter((r) => r.amount === null && r.fact > 0).length} kategoriya`),
        f("Holat chegaralari", `e'tibor ${company.alertWarnPct}% · kritik ${company.alertCritPct}%`),
        f("Sklad zaxirasi", `e'tibor ${company.stockWarnDays} kun · kritik ${company.stockCritDays} kun`),
        f("Muddati o'tgan qarz", `${company.overdueDays} kundan`),
      ],
      sections: [
        sec("Kategoriyalar", rows.filter((r) => r.amount !== null || r.fact > 0).map((r) => ({ id: `${ym}~${r.cat}`, title: r.cat, subtitle: `${r.amount === null ? "byudjetsiz" : `byudjet ${short(r.amount)}`} · prognoz ${short(r.forecast)}${r.histAvg !== null ? ` · 3 oy o'rtacha ${short(r.histAvg)}` : ""}`, right: short(r.fact), tone: (r.over ? "danger" : "info") as Tone })), { target: "byudjet", icon: "chart-pie", empty: "Bu oyda xarajat yo'q va byudjet belgilanmagan" }),
        sec("O'zgarishlar tarixi", history.map((h) => {
          const after = h.after as { c: string; a: number }[] | { copiedFrom?: string; count?: number } | null;
          const text = Array.isArray(after) ? `${after.length} kategoriya · jami ${money(after.reduce((s, x) => s + x.a, 0))}` : after && "copiedFrom" in after ? `${after.copiedFrom} dan ${after.count} ta nusxalandi` : "—";
          return { id: h.id, title: h.user.fullName, subtitle: text, right: dt(h.createdAt) };
        }), { icon: "clock", empty: "Hali o'zgarish yo'q" }),
      ],
      actions: [],
    };
  }
  const r = rows.find((x) => x.cat === cat) ?? notFound("Kategoriya topilmadi");
  const [year, month] = ym.split("-").map(Number);
  const tx = await db.cashTransaction.findMany({
    where: { type: "EXPENSE", category: cat, cancelledAt: null, date: { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) } },
    orderBy: { amount: "desc" }, take: 40,
    select: { id: true, date: true, amount: true, counterparty: true, note: true, cashAccount: { select: { name: true } }, supplier: { select: { name: true } }, createdBy: { select: { fullName: true } } },
  });
  return {
    key: "byudjet", id, title: cat, subtitle: `Xarajat byudjeti — ${monthTitle(ym)}`, status: r.over ? "Byudjetdan oshdi" : r.amount === null && r.fact > 0 ? "Rejasiz" : undefined,
    fields: [
      f("Byudjet", r.amount === null ? "belgilanmagan" : money(r.amount)), f("Limit", r.limit === null ? "byudjetning o'zi" : money(r.limit)),
      f("Fakt", money(r.fact), r.over ? "danger" : undefined), f("Bajarilish", r.amount ? pctText((r.fact / r.amount) * 100) : "—"),
      f("Prognoz (oy oxiri)", money(r.forecast), r.amount !== null && r.forecast > r.amount ? "warning" : undefined),
      f("Oldingi 3 oy o'rtachasi", r.histAvg === null ? "—" : money(r.histAvg)),
    ],
    sections: [sec("Chiqimlar", tx.map((t) => ({ id: t.id, title: t.supplier?.name ?? t.counterparty ?? "—", subtitle: [day(t.date), t.cashAccount.name, t.createdBy.fullName, t.note].filter(Boolean).join(" · "), right: short(Number(t.amount)) })), { target: "cashflow", empty: "Bu oyda chiqim yo'q" })],
    actions: [],
  };
}

// ───────────────────────── BI tahlil ─────────────────────────

/** BI bo'limlari — vebdagi `/bi-tahlil/*` sahifalari bilan bir xil tartib va nomlar. */
const BI_TABS: { key: string; title: string; hint: string; periodic: boolean }[] = [
  { key: "overview", title: "Umumiy ko'rinish", hint: "Biznes salomatligi, bugungi vazifalar, xavf ostidagi pul", periodic: true },
  { key: "sales", title: "Sotuvlar", hint: "Dinamika, mahsulot va mijoz kesimi, o'sganlar / pasayganlar", periodic: true },
  { key: "cancelled", title: "Bekor qilinganlar", hint: "Yo'qotilgan tushum, sabablar, sotuvchilar", periodic: true },
  { key: "agents", title: "Agentlar", hint: "Sotuvchilar reytingi, sekinlashganlar, reja holati", periodic: true },
  { key: "customers", title: "Mijozlar", hint: "RFM segmentlar, qarz aging, kim bilan ishlash kerak", periodic: true },
  { key: "stock", title: "Ombor", hint: "Buyurtma navbati, xavf zonasi, muzlagan zaxira", periodic: true },
  { key: "products", title: "Mahsulotlar", hint: "ABC × XYZ, foydalilik, klasterlar", periodic: true },
  { key: "operations", title: "Ishlab chiqarish va logistika", hint: "Zameslar, reyslar, mikserlar, haydovchilar", periodic: true },
  { key: "finance", title: "Moliya", hint: "Yo'qotish kanallari, P&L, pul prognozi, debitorka", periodic: true },
  { key: "plan", title: "Reja nazorati", hint: "Joriy oy sotuv rejasi — kompaniya va sotuvchilar", periodic: false },
  { key: "marketing", title: "Marketing", hint: "Kanallar samaradorligi: ROAS, CAC, xulosa", periodic: true },
  { key: "mplan", title: "Marketing reja nazorati", hint: "Joriy oy kanallar bo'yicha reja / fakt", periodic: false },
  { key: "mdata", title: "Marketing ma'lumotlari", hint: "Joriy yil byudjet, reja va fakt yozuvlari", periodic: false },
  { key: "forecast", title: "Bashorat (ML)", hint: "Sotuv bashorati, xomashyo tugash prognozi, quvvat", periodic: false },
  { key: "churn", title: "Churn tahlili", hint: "Ketish xavfi zonalari va omillari", periodic: false },
  { key: "clusters", title: "Klasterlar", hint: "Mahsulot guruhlari va tavsiyalar", periodic: true },
  { key: "anomalies", title: "Anomaliyalar", hint: "Oxirgi 30 kun: shubhali to'lov, narx, hajm", periodic: false },
  { key: "telegram", title: "Telegram bot", hint: "Insof AI botiga hisobni ulash", periodic: false },
];
const BI_PERIODS = [{ key: "day", label: "Bugun" }, { key: "month", label: "Oy" }, { key: "year", label: "Yil" }] as const;
const biPeriod = (p?: string) => (BI_PERIODS.some((x) => x.key === p) ? p! : "month");

function biList(title: string, filter?: string): MobileList {
  const per = biPeriod(filter);
  return {
    key: "bi", title,
    rows: BI_TABS.map((t) => ({ id: `${t.key}.${per}`, title: t.title, subtitle: t.periodic ? t.hint : `${t.hint} · davrga bog'liq emas` })),
    filters: BI_PERIODS.map((p) => ({ key: p.key, label: p.label, active: p.key === per })),
  };
}

type Part = Pick<MobileDetail, "title" | "subtitle" | "status" | "fields" | "sections"> & { actions?: DetailAction[] };
type BiCtx = { user: MobileUser; r: Range };

async function biOverview({ r }: BiCtx): Promise<Part> {
  const d = await overviewTab(r);
  const K = d.kpis;
  const ht: Tone = d.health === null ? "info" : d.health >= 75 ? "success" : d.health >= 50 ? "warning" : "danger";
  return {
    title: "Umumiy ko'rinish", subtitle: `Davr: ${r.label}`,
    status: d.health !== null ? `${d.health}/100 · ${d.healthLabel}` : d.healthLabel,
    fields: [
      f("Bugungi sotuv", `${money(d.todayRevenue)}${arrow(d.todayDelta) ? ` · kechagidan ${arrow(d.todayDelta)}` : ""}`),
      f("Oy boshidan", `${short(d.month.revenue)}${arrow(d.month.delta) ? ` · ${arrow(d.month.delta)}` : ""}`),
      f("Oy prognozi", short(d.month.forecast)),
      kf("Sotuv (davr)", K.revenue), kf("Yalpi foyda", K.gross), f("Marja", `${fx(K.margin.cur)}%`, K.margin.cur < 15 && K.revenue.cur > 0 ? "warning" : undefined),
      kf("Kassa tushumi", K.cashIn), f("Debitorka", `${short(K.receivable)} · ${K.debtors} qarzdor`),
      f("Faol mijozlar (30 kun)", `${K.active} / ${K.total} · ${fx(K.activeRate, 0)}%`),
      f("Biznes salomatligi", d.health !== null ? `${d.health}/100 · ${d.healthLabel}` : d.healthLabel, ht),
      f("Xavf ostidagi pul", money(d.riskTotal), d.riskTotal > 0 ? "warning" : "success"),
      f("Bugun", `${num(d.todayM3)} m³ · ${d.delivered}/${d.tripsToday} reys yetkazildi`),
    ],
    sections: pick(
      sec("Biznes salomatligi", d.components.map((c, i) => ({ id: `h${i}`, title: c.label, subtitle: c.text, right: c.score === null ? "—" : `${c.score}/20`, tone: (c.score === null ? "info" : c.score >= 15 ? "success" : c.score >= 10 ? "warning" : "danger") as Tone })), {
        icon: "heart-pulse",
        chart: { kind: "progress", items: d.components.map((c) => ({ label: c.label, pct: c.score === null ? null : c.score * 5, fact: c.score === null ? "ma'lumot yo'q" : `${c.score}/20`, plan: null, tone: (c.score === null ? "info" : c.score >= 15 ? "success" : c.score >= 10 ? "warning" : "danger") as Tone })) },
      }),
      sec("Bugungi vazifalar", d.tasks.map((t) => ({ id: `t${t.n}`, title: `${t.n}. ${t.title}`, subtitle: t.text, right: t.money ? short(t.money) : undefined, tone: levelTone(t.tone) })), { icon: "clipboard-list", empty: "Shoshilinch vazifa yo'q" }),
      sec("Xavf ostidagi pul", [
        { id: "debt", title: "Xavfli debitorka", subtitle: `${d.risk.debtCount} ta mijoz`, right: short(d.risk.debt), tone: "danger" },
        { id: "lost", title: "Yo'qotilayotgan foyda", subtitle: `${d.risk.lostCount} ta (bloklangan zayavka, yetishmayotgan xomashyo)`, right: short(d.risk.lostProfit), tone: "warning" },
        { id: "frozen", title: "Muzlagan zaxira", subtitle: `${d.risk.frozenCount} ta pozitsiya`, right: short(d.risk.frozen), tone: "info" },
      ], { icon: "triangle-alert", chart: donutOf([{ label: "Debitorka", value: d.risk.debt }, { label: "Foyda", value: d.risk.lostProfit }, { label: "Muzlagan", value: d.risk.frozen }]) }),
      d.goodNews.length > 0 && sec("Yaxshi xabarlar", d.goodNews.map((g, i) => ({ id: `g${i}`, title: g, tone: "success" as Tone })), { icon: "trending-up" }),
    ),
  };
}

async function biSales({ r }: BiCtx): Promise<Part> {
  const d = await salesTab(r, autoGran(r.days), 1, 1, {});
  const K = d.kpis;
  const up = d.custMovers.filter((x) => x.diff > 0).slice(0, 5), down = [...d.custMovers].reverse().filter((x) => x.diff < 0).slice(0, 5);
  return {
    title: "Sotuvlar", subtitle: `Davr: ${r.label} · sotuv — yetkazilgan mahsulot`,
    fields: [
      kf("Sotuv", K.revenue), kf("Zayavkalar", K.orders, (v) => `${Math.round(v)} ta`), kf("O'rtacha chek", K.avgCheck), kf("Mijozlar", K.customers, (v) => `${Math.round(v)} ta`),
      kf("Yalpi foyda", K.gross), f("Marja", `${fx(K.margin.cur)}%${arrow(K.margin.delta) ? ` · ${arrow(K.margin.delta)}` : ""}`), kf("Beton hajmi", K.volume, (v) => `${num(v)} m³`),
      f("Oy sur'ati", `${short(d.pulse.perDay)}/kun · prognoz ${short(d.pulse.forecast)}`),
      f("Chegirma", `${short(d.discount)} · ${d.discountCount} qator`, d.discount > 0 ? "warning" : undefined),
      f("Yo'qotilgan tushum", `bloklangan ${short(d.lost.blocked)} (${d.lost.blockedOrders}) · bekor ${short(d.lost.cancelled)} (${d.lost.cancelledOrders})`, d.lost.blocked + d.lost.cancelled > 0 ? "warning" : undefined),
      ...(K.uncosted > 0 ? [f("Tannarxi noma'lum sotuv", short(K.uncosted), "info")] : []),
    ],
    sections: pick(
      sec("Sotuv dinamikasi", dynRows(d.dyn), { icon: "chart-column", chart: barsOf("Sotuv", d.dyn) }),
      sec("Mahsulotlar", d.productRows.slice(0, 12).map((p) => ({ id: p.id, title: `${p.code} · ${p.name}`, subtitle: `${p.abc} · ulush ${fx(p.share, 0)}% · ${p.costKnown ? `marja ${fx(p.margin)}%` : "tannarx noma'lum"} · ${p.orders} zayavka`, right: short(p.revenue) })), { icon: "package", chart: donutOf(d.productRows.map((p) => ({ label: p.code, value: p.revenue }))) }),
      sec("Mijozlar", d.byCustomer.slice(0, 12).map((c) => ({ id: c.id, title: c.name, subtitle: `${c.orders} zayavka${c.qty ? ` · ${num(c.qty)} m³` : ""}`, right: short(c.revenue) })), { target: "customers" }),
      up.length > 0 && sec("Ko'p o'sgan mijozlar", up.map((x) => ({ id: x.id, title: x.name, subtitle: `oldin ${short(x.prev)} → hozir ${short(x.cur)}`, right: `+${short(x.diff)}`, tone: "success" as Tone })), { target: "customers" }),
      down.length > 0 && sec("Ko'p pasaygan mijozlar", down.map((x) => ({ id: x.id, title: x.name, subtitle: `oldin ${short(x.prev)} → hozir ${short(x.cur)}`, right: shortSigned(x.diff), tone: "danger" as Tone })), { target: "customers" }),
      sec("Hafta kunlari", monFirst(d.weekday).map((w, i) => ({ id: `w${i}`, title: w.label, right: short(w.value) })), { icon: "calendar-days", chart: barsOf("Sotuv", monFirst(d.weekday)) }),
      d.lost.blockedRows.length > 0 && sec("Bloklangan zayavkalar", d.lost.blockedRows.map((o) => ({ id: o.orderId, title: `${o.orderNo} · ${o.customer}`, right: short(o.revenue), tone: "danger" as Tone })), { target: "orders" }),
    ),
  };
}

async function biCancelled({ r }: BiCtx): Promise<Part> {
  const d = await returnsTab(r, autoGran(r.days), { page: 1, size: 1 });
  const K = d.kpis;
  const grp = (title: string, list: typeof d.byReason, o: { target?: string; icon?: string } = {}) =>
    sec(title, list.slice(0, 10).map((x) => ({ id: x.key, title: x.name, subtitle: `${x.count} zayavka · ulush ${fx(x.share, 0)}%`, right: short(x.value) })), { ...o, empty: "Bekor qilingan yo'q" });
  return {
    title: "Bekor qilingan zayavkalar", subtitle: `Davr: ${r.label} · zayavka sanasi bo'yicha`,
    fields: [
      kf("Bekor qilingan tushum", K.total, short, true), f("Bekor ulushi", `${fx(K.rate.cur)}%${K.rateDelta ? ` · ${K.rateDelta > 0 ? "▲" : "▼"} ${fx(Math.abs(K.rateDelta))} p.p.` : ""}`, K.rateDelta > 0 ? "warning" : undefined),
      kf("Yo'qotilgan marja", K.lostMargin, short, true), kf("Zayavkalar", K.count, (v) => `${Math.round(v)} ta`, true), kf("O'rtacha", K.avg),
      f("Mijozlar", `${K.customers} ta`), f("Hajm", `${num(K.volume)} m³`), f("O'rtacha kunlik", short(d.avgDaily)),
      ...(d.worst && d.worst.value > 0 ? [f("Eng yomon kun", `${d.worst.label} · ${short(d.worst.value)}`)] : []),
    ],
    sections: [
      sec("Dinamika", dynRows(d.dyn), { icon: "chart-column", chart: barsOf("Bekor", d.dyn) }),
      { ...grp("Sabablar", d.byReason, { icon: "triangle-alert" }), chart: donutOf(d.byReason.map((x) => ({ label: x.name, value: x.value }))) },
      grp("Mahsulotlar", d.byProduct, { icon: "package" }),
      grp("Sotuvchilar", d.bySeller, { icon: "user" }),
      grp("Mijozlar", d.byCustomer, { target: "customers" }),
    ],
  };
}

const TIER_TONE: Record<string, Tone> = { TOP: "success", YAXSHI: "brand", "O'RTA": "warning", PAST: "danger" };

async function biAgents({ r }: BiCtx): Promise<Part> {
  const d = await agentsTab(r);
  const K = d.kpis, P = d.planStatus;
  return {
    title: "Agentlar", subtitle: `Davr: ${r.label} · sotuvchi — mijozga biriktirilgan agent yoki zayavkani kiritgan`,
    fields: [
      kf("Faol sotuvchilar", K.active, (v) => `${Math.round(v)} ta`), kf("Sotuv", K.revenue), kf("Sotuvchiga o'rtacha", K.perAgent),
      f("Zayavka sifati", `${fx(d.quality.pct, 0)}% · ${d.quality.converted}/${d.quality.created} sotuvga aylandi`),
      f("Bugun", `${short(K.todayRevenue)} · ${K.todayOrders} zayavka`), f("Bekor qilingan", short(K.cancelledRevenue), K.cancelledRevenue > 0 ? "warning" : undefined),
      f("Reja (oy)", P.withPlan ? `${P.withPlan}/${P.total} rejali · ${P.done} bajardi · ${P.behind} ortda` : "reja belgilanmagan", P.behind ? "warning" : undefined),
      f("Sekinlashganlar", d.slow.length ? `${d.slow.length} ta · kuniga −${short(d.slowLoss)}` : "yo'q", d.slow.length ? "warning" : "success"),
      f("3+ kun faol emas", `${d.offline.length} ta`, d.offline.length ? "warning" : undefined),
      ...(d.best ? [f("Eng yaxshisi", `${d.best.name} · ${short(d.best.revenue)}`, "success")] : []),
    ],
    sections: pick(
      sec("Reyting", d.sellers.slice(0, 20).map((s) => ({
        id: s.id, title: s.name,
        subtitle: `${s.tier} · ball ${s.score} · ${s.orders} zayavka · konversiya ${fx(s.conversion, 0)}%${s.planPct !== null ? ` · reja ${fx(s.planPct, 0)}%` : ""}${s.delta !== null ? ` · ${arrow(s.delta)}` : ""}`,
        right: short(s.revenue), tone: TIER_TONE[s.tier],
      })), { icon: "users", chart: donutOf(d.sellers.map((s) => ({ label: s.name, value: s.revenue }))), empty: "Bu davrda sotuv yo'q" }),
      d.slow.length > 0 && sec("Sekinlashganlar", d.slow.slice(0, 10).map((s) => ({ id: `s-${s.id}`, title: s.name, subtitle: `${s.slowReason} · ${s.slowDays} kun · odatiy ${short(s.usualPerDay)}/kun → ${short(s.nowPerDay)}/kun`, right: `−${short(s.usualPerDay - s.nowPerDay)}`, tone: "warning" as Tone })), { icon: "trending-down" }),
      d.offline.length > 0 && sec("Faol emas (3+ kun)", d.offline.map((s) => ({ id: `o-${s.id}`, title: s.name, subtitle: `oxirgi zayavka ${s.lastOrderAt ? day(s.lastOrderAt) : "—"}`, right: `${s.offlineDays} kun`, tone: "danger" as Tone })), { icon: "clock" }),
      d.route.length > 0 && sec(`Ertangi yetkazish · ${num(d.routeTotal)} m³ · ${d.routeTrips} reys`, d.route.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer}`, subtitle: `${o.address}${o.pump ? " · nasos" : ""}`, right: `${num(o.m3)} m³ · ${o.trips} reys` })), { target: "orders" }),
    ),
  };
}

async function biCustomers({ r }: BiCtx): Promise<Part> {
  const d = await customersTab(r, { page: 1, size: 1 });
  const C = d.cards;
  return {
    title: "Mijozlar", subtitle: `Davr: ${r.label} · RFM segmentlar, qarz aging`,
    fields: [
      f("Jami mijozlar", `${C.total} · faol ${C.active} (${fx(C.activityRate, 0)}%)`), f("VIP", `${C.vip} ta`), f("Xavf ostida / yo'qotilgan", `${C.atRiskOnly} / ${C.lost}`, C.atRisk ? "warning" : undefined),
      f("Jim (14–50 kun)", `${C.silent} ta`), f("To'xtagan (50+ kun)", `${C.stopped} ta`, C.stopped ? "warning" : undefined), f("Yangi", `${C.newCount} ta`),
      f("O'rtacha chek (davr)", short(C.avgCheck)), f("Debitorka", `${short(C.debt)} · ${C.debtors} qarzdor`, C.debt > 0 ? "warning" : undefined),
      ...(C.legacyDebtors ? [f("Eski qarzdorlar", `${C.legacyDebtors} ta · ${short(C.legacyDebt)}`)] : []),
      f("Ketish xavfi", `${d.churn.atRisk} ta · kutilgan yo'qotish ${short(d.churn.expectedLoss)}`, d.churn.atRisk ? "danger" : "success"),
    ],
    sections: [
      sec("Segmentlar", d.segments.filter((s) => s.count > 0).map((s) => ({ id: s.segment, title: s.segment, subtitle: `180 kun sotuv ${short(s.revenue)}${s.debt ? ` · qarz ${short(s.debt)}` : ""}`, right: `${s.count} ta` })), { icon: "chart-pie", chart: donutOf(d.segments.map((s) => ({ label: s.segment, value: s.count })), (v) => `${v} ta`, "mijoz") }),
      sec("Kim bilan ishlash kerak", d.nba.map((x) => ({ id: x.id, title: x.name, subtitle: `${x.segment} · ${x.action}`, right: short(x.overdueDebt || x.expectedLoss || x.debt), tone: (x.risk === "Kritik" || x.risk === "Yuqori" ? "danger" : "warning") as Tone })), { target: "customers", empty: "Shoshilinch ish yo'q" }),
      sec("Qarz aging", Object.entries(d.aging).map(([l, v], i) => ({ id: `a${i}`, title: `${l} kun`, right: short(v), tone: (i >= 2 && v > 0 ? "danger" : "info") as Tone })), { icon: "clock", chart: barsOf("Qarz", Object.entries(d.aging).map(([label, value]) => ({ label, value }))) }),
      sec("Eng katta qarzdorlar", d.agingTop.map((c) => ({ id: c.id, title: c.name, right: short(c.total), tone: "warning" as Tone })), { target: "customers", empty: "Qarz yo'q" }),
      sec("Mijoz oqimi (oy)", d.flow.map((x, i) => ({ id: `f${i}`, title: x.label, subtitle: `yangi ${x.newC} · yo'qotilgan ${x.lost}` })), { icon: "users", chart: { kind: "columns", series: [{ key: "n", label: "Yangi", tone: "success" }, { key: "l", label: "Yo'qotilgan", tone: "danger" }], groups: d.flow.map((x) => ({ label: x.label, values: [x.newC, x.lost], texts: [String(x.newC), String(x.lost)] })) } }),
    ],
  };
}

async function biStock({ r }: BiCtx): Promise<Part> {
  const d = await stockTab(r, autoGran(r.days));
  const C = d.cards, Z = d.zones;
  const unit = (n: number, u: string) => `${num(n)} ${u}`;
  return {
    title: "Ombor", subtitle: `Davr: ${r.label} · xomashyo qiymati, aylanma, buyurtma navbati`,
    fields: [
      f("Xomashyo qiymati", money(C.value)), f("Pozitsiyalar", `${C.sku} ta`), f("Aylanma", C.turnoverDays == null ? "—" : `${num(Number(C.turnoverDays))} kun`),
      f("Xavf zonasida", `${C.stockout} ta (kritik ${Z.critical} · xavfli ${Z.risky})`, C.stockout ? "danger" : "success"), f("Ortiqcha zaxira (90+ kun)", `${C.overstock} ta`),
      f("Hisobdan chiqarilgan", `${short(C.writeOff)} · ${C.writeOffCount} ta`, C.writeOff ? "warning" : undefined), f("Xarid (davr)", short(C.purchases)),
      f("Muzlagan qiymat", short(d.deadValue), d.deadValue > 0 ? "warning" : undefined),
    ],
    sections: pick(
      sec("Zaxira zonalari", [
        { id: "z1", title: "Kritik (7 kundan kam)", right: `${Z.critical} ta`, tone: "danger" }, { id: "z2", title: "Xavfli (7–20 kun)", right: `${Z.risky} ta`, tone: "warning" },
        { id: "z3", title: "Yaxshi", right: `${Z.good} ta`, tone: "success" }, { id: "z4", title: "Ma'lumot yo'q", right: `${Z.unknown} ta`, tone: "info" },
      ], { icon: "chart-pie", chart: donutOf([{ label: "Kritik", value: Z.critical }, { label: "Xavfli", value: Z.risky }, { label: "Yaxshi", value: Z.good }, { label: "Ma'lumot yo'q", value: Z.unknown }], (v) => `${v} ta`, "xomashyo") }),
      sec("Buyurtma navbati", d.queue.slice(0, 15).map((m) => ({ id: m.id, title: `${m.name}${m.short ? " · zayavkalarga yetmaydi" : ""}`, subtitle: `${m.zone} · qoldiq ${unit(m.balance, m.unit)}${m.days !== null ? ` · ${num(m.days)} kunga` : ""}`, right: `${unit(m.suggestQty, m.unit)} · ${short(m.suggestCost)}`, tone: (m.zone === "Kritik" || m.short ? "danger" : "warning") as Tone })), { target: "stock", empty: "Buyurtma kerak emas" }),
      d.dead.length > 0 && sec("Muzlagan xomashyo (90 kun)", d.dead.map((m) => ({ id: m.id, title: m.name, subtitle: `qoldiq ${unit(m.balance, m.unit)}`, right: short(m.value), tone: "warning" as Tone })), { target: "stock" }),
      d.finished.length > 0 && sec("Tayyor mahsulot qoldig'i", d.finished.map((p) => ({ id: p.id, title: `${p.code} · ${p.name}`, subtitle: `${num(p.qty)} ${p.unit}`, right: p.cost === null ? "tannarx yo'q" : short(p.value) })), { icon: "package" }),
      d.suppliers.length > 0 && sec("Yetkazuvchilar (davr)", d.suppliers.map((s, i) => ({ id: `s${i}`, title: s.name, subtitle: `${s.docs} kirim`, right: short(s.value) })), { icon: "store" }),
      d.trend.length > 1 && sec("Qoldiq qiymati (hafta)", dynRows(d.trend), { icon: "chart-column", chart: barsOf("Qiymat", d.trend) }),
    ),
  };
}

async function biProducts({ r }: BiCtx): Promise<Part> {
  const d = await productsTab(r);
  const C = d.cards;
  return {
    title: "Mahsulotlar", subtitle: `Davr: ${r.label} · ABC × XYZ, foydalilik, klasterlar`,
    fields: [
      f("Faol mahsulotlar", `${C.sku} ta`), f("Tushum (davr)", short(d.totalRevenue)), f("O'rtacha marja", `${fx(C.avgMargin)}%`, C.avgMargin < 15 ? "warning" : undefined),
      f("Pareto 80/20", `${d.paretoCount} ta mahsulot tushumning 80%i`), f("AX (barqaror lider)", `${C.aaa} ta`), f("O'sayotgan", `${C.growing} ta`, "success"),
      f("Past marja (<10%)", `${C.lowMargin} ta`, C.lowMargin ? "warning" : undefined), f("Retseptsiz (tannarx yo'q)", `${C.noRecipe} ta`, C.noRecipe ? "warning" : undefined),
      f("Ombordagi tayyor mahsulot", short(C.frozen)),
    ],
    sections: [
      sec("Klasterlar", d.clusters.map((c) => ({ id: c.key, title: `${c.title} · ${c.sub}`, subtitle: `${c.count} ta · marja ${fx(c.margin)}% · ${c.advice}`, right: `${short(c.revenue)} · ${fx(c.share, 0)}%` })), { icon: "layout-grid", chart: donutOf(d.clusters.map((c) => ({ label: c.title, value: c.revenue }))) }),
      sec("Mahsulotlar", d.rows.slice(0, 20).map((p) => ({ id: p.id, title: `${p.code} · ${p.name}`, subtitle: `${p.abc}${p.xyz} · ${p.cluster} · ${p.cost === null ? "tannarx noma'lum" : `marja ${fx(p.margin)}%`}${p.trend ? ` · trend ${p.trend > 0 ? "+" : ""}${fx(p.trend, 0)}%` : ""}`, right: short(p.revenue) })), { icon: "package" }),
      sec("ABC × XYZ matritsa", d.matrix.flatMap((row, i) => row.map((cell, j) => ({ cell, code: `${"ABC"[i]}${"XYZN"[j]}` }))).filter((x) => x.cell.length > 0).map((x) => ({ id: x.code, title: x.code, subtitle: x.cell.slice(0, 6).map((p) => p.code).join(", "), right: `${x.cell.length} ta` })), { icon: "grid-3x3", empty: "Sotuv yo'q" }),
    ],
  };
}

async function biOperations({ r }: BiCtx): Promise<Part> {
  const d = await operationsTab(r, autoGran(r.days));
  const K = d.kpis;
  return {
    title: "Ishlab chiqarish va logistika", subtitle: `Davr: ${r.label}`,
    fields: [
      kf("Ishlab chiqarildi", K.produced, (v) => `${num(v)} m³`), kf("Zameslar", K.batches, (v) => `${Math.round(v)} ta`), ...(K.hasPieces ? [f("Dona mahsulot", K.pieces)] : []),
      kf("Reyslar", K.trips, (v) => `${Math.round(v)} ta`), kf("Yetkazildi", K.deliveredM3, (v) => `${num(v)} m³`), kf("Yetkazish ulushi", K.deliveryRate, pctF),
      kf("O'rtacha reys", K.avgMinutes, (v) => `${Math.round(v)} daq`, true), f("O'z vaqtida", `${fx(K.onTime.cur, 0)}%`, K.onTime.cur < 80 ? "warning" : undefined),
      f("Bekor reyslar", `${K.cancelled} ta`, K.cancelled ? "warning" : undefined), f("Kuniga", `${num(K.perDay)} m³`),
      f("Ochiq zayavkalar qoldig'i", d.backlog || "—"), f("Muddati o'tgan", `${d.overdue.length} ta`, d.overdue.length ? "danger" : "success"),
    ],
    sections: pick(
      d.signals.length > 0 && sec("Ogohlantirishlar", d.signals.map((s, i) => ({ id: `s${i}`, title: s.title, subtitle: s.text, tone: levelTone(s.level) })), { icon: "triangle-alert" }),
      sec("Ishlab chiqarish va yetkazish", d.prodDyn.map((p, i) => ({ p, s: d.shipDyn[i]?.value ?? 0, i })).filter((x) => x.p.value || x.s).slice(-10).reverse().map((x) => ({ id: `d${x.i}`, title: x.p.label, subtitle: `yetkazildi ${num(x.s)} m³`, right: `${num(x.p.value)} m³` })), {
        icon: "chart-column",
        chart: { kind: "columns", series: [{ key: "p", label: "Ishlab chiqarildi", tone: "brand" }, { key: "s", label: "Yetkazildi", tone: "success" }], groups: d.prodDyn.map((p, i) => ({ label: p.label, values: [p.value, d.shipDyn[i]?.value ?? 0], texts: [num(p.value), num(d.shipDyn[i]?.value ?? 0)] })) },
      }),
      sec("Mahsulotlar", d.byProduct.map((p) => ({ id: p.id, title: p.label, subtitle: `${p.batches} zames`, right: `${num(p.value)} m³` })), { icon: "package", chart: d.byShift.length > 1 ? donutOf(d.byShift, (v) => `${num(v)} m³`, "smenalar") : undefined }),
      sec("Mikserlar", d.mixers.map((m) => ({ id: m.id, title: m.plate, subtitle: `${m.trips} reys · ${m.delivered} yetkazildi${m.fill !== null ? ` · to'lish ${fx(m.fill, 0)}%` : ""}${m.idle ? " · 7 kun bo'sh" : ""}`, right: `${num(m.m3)} m³`, tone: (m.idle ? "warning" : "info") as Tone })), { icon: "truck", empty: "Mikser yo'q" }),
      sec("Haydovchilar reytingi", d.drivers.slice(0, 15).map((x) => ({ id: x.id, title: x.name, subtitle: `${x.tier} · ball ${x.score} · ${x.trips} reys · ${fx(x.rate, 0)}% yetkazildi${x.late ? ` · ${x.late} kech` : ""}`, right: `${num(x.m3)} m³`, tone: TIER_TONE[x.tier] })), { icon: "users", empty: "Reys yo'q" }),
      d.overdue.length > 0 && sec("Muddati o'tgan zayavkalar", d.overdue.slice(0, 15).map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer}`, subtitle: `${day(o.deliveryDate)} · jo'natildi ${o.shipped} / ${o.total}`, right: `${Math.round(o.shippedPct)}%`, tone: "danger" as Tone })), { target: "orders" }),
    ),
  };
}

async function biFinance({ r }: BiCtx): Promise<Part> {
  const d = await financeTab(r, autoGran(r.days), 1, 1);
  const K = d.kpis, CF = d.cashForecast;
  const ag = ["0–30", "31–60", "61–90", "90+"].map((label, i) => ({ label: `${label} kun`, value: d.aging[i] ?? 0 }));
  return {
    title: "Moliya", subtitle: `Davr: ${r.label} · yo'qotish, P&L, pul prognozi`,
    fields: [
      kf("Sotuv tushumi", K.revenue), kf("Yalpi foyda", K.gross), f("Marja", `${fx(K.margin)}%`), f("Foyda (brakdan keyin)*", shortSigned(K.profit), K.profit < 0 ? "danger" : undefined),
      kf("Kassa tushumi", K.cashIn), f("Kassa va bank", short(K.cashTotal)), f("Debitorka", `${short(K.receivable)} · ${K.debtors} qarzdor`, K.receivable > 0 ? "warning" : undefined),
      kf("Xomashyo xaridi", K.purchases, short, true), f("Chegirma", short(K.discount)), f("Brak / hisobdan chiqarish", short(K.writeOff), K.writeOff ? "warning" : undefined),
      f("Yo'qotish (kuniga)", short(d.loss.totalPerDay), d.loss.totalPerDay > 0 ? "danger" : "success"),
      f("Pul prognozi (7 kun)", `${shortSigned(CF.after7)} · xavf ${CF.risk}`, CF.low7 < 0 ? "danger" : undefined),
    ],
    sections: [
      sec("Yo'qotish kanallari", d.loss.channels.map((c) => ({ id: c.key, title: c.title, subtitle: `${c.sub} · ${c.count} · ${c.text}`, right: `${short(c.perDay)}/kun`, tone: (c.perDay > 0 ? "danger" : "success") as Tone })), { icon: "droplets", chart: donutOf(d.loss.channels.map((c) => ({ label: c.title, value: c.perDay }))) }),
      sec("Foyda zanjiri (P&L)", d.waterfall.map((w, i) => ({ id: `w${i}`, title: w.label, right: shortSigned(w.value), tone: ("total" in w && w.total ? "brand" : w.value < 0 ? "danger" : "success") as Tone })), { icon: "banknote" }),
      sec("Pul prognozi — 7 kun", [
        { id: "c1", title: "Hozirgi qoldiq", right: shortSigned(CF.start) },
        { id: "c2", title: "Kutilgan kirim", subtitle: `kuniga ~${short(CF.perDay)} · debitorka ${short(CF.receivable)}`, right: short(CF.expectedIn), tone: "success" },
        { id: "c3", title: "Kutilgan chiqim", subtitle: `kuniga ~${short(CF.outPerDay)}`, right: short(CF.expectedOut), tone: "warning" },
        { id: "c4", title: "7 kundan keyin", subtitle: `yomon holatda ${shortSigned(CF.low7)} · xavf ${CF.risk}`, right: shortSigned(CF.after7), tone: CF.after7 < 0 ? "danger" : "brand" },
      ], { icon: "landmark" }),
      sec("Hisoblar", d.accountRows.map((a) => ({ id: a.id, title: a.name, subtitle: `${a.type === "CASH" ? "naqd" : "bank"} · davrda kirdi ${short(a.period)}`, right: shortSigned(a.total), tone: (a.total < 0 ? "danger" : "info") as Tone })), { icon: "landmark", empty: "Hisob yo'q" }),
      sec("Debitorka aging", ag.map((a, i) => ({ id: `a${i}`, title: a.label, right: short(a.value), tone: (i >= 2 && a.value > 0 ? "danger" : "info") as Tone })), { icon: "clock", chart: barsOf("Qarz", ag) }),
      sec("Ko'rsatkichlar (oldingi davrga nisbatan)", d.indicators.map((x, i) => ({ id: `k${i}`, title: x.label, subtitle: `oldin ${x.unit === "%" ? `${fx(x.prev)}%` : x.unit === "so'm" ? short(x.prev) : `${num(x.prev)} ${x.unit}`}`, right: `${x.unit === "%" ? `${fx(x.cur)}%` : x.unit === "so'm" ? short(x.cur) : `${num(x.cur)} ${x.unit}`}${arrow(x.delta) ? ` ${arrow(x.delta)}` : ""}` })), { icon: "chart-column" }),
      sec("Eng katta to'lovlar", d.topPayments.map((p) => ({ id: p.id, title: p.customer.name, subtitle: `${day(p.date)} · ${p.cashAccount.name}${p.invoice ? ` · ${p.invoice.invoiceNo}` : ""}`, right: short(Number(p.amount)), tone: "success" as Tone })), { target: "payments", empty: "Bu davrda to'lov yo'q" }),
    ],
  };
}

const SIGNAL_TONE: Record<string, Tone> = { BONUS: "success", NORMAL: "brand", OGOHLANTIRISH: "warning", XAVF: "danger", "REJA YO'Q": "info" };

async function biPlan(): Promise<Part> {
  const now = new Date();
  const d = await plansTab(now.getFullYear(), now.getMonth() + 1);
  return {
    title: "Reja nazorati", subtitle: `${MONTHS_UZ[d.month - 1]} ${d.year} · ${d.wdPassed}/${d.wdTotal} ish kuni o'tdi · faqat ko'rish`,
    status: d.companyPlan && d.pct !== null ? `${fx(d.pct, 0)}% bajarildi` : "Reja yo'q",
    fields: [
      f("Kompaniya rejasi", d.companyPlan ? money(d.companyPlan) : "belgilanmagan"), f("Fakt", money(d.fact)),
      f("Prognoz (oy oxiri)", `${short(d.forecast)}${d.fpct !== null ? ` · ${fx(d.fpct, 0)}%` : ""}`, d.fpct !== null ? (d.fpct >= 100 ? "success" : d.fpct >= 70 ? "warning" : "danger") : undefined),
      ...(d.companyPlan ? [f("Rejaga farq (prognoz)", shortSigned(d.gap), d.gap < 0 ? "danger" : "success"), f("Kerakli kunlik sotuv", `${d.needPerDay === null ? "—" : short(d.needPerDay)}/kun · hozir ${short(d.avgPerDay)}/kun`)] : []),
      f("Qolgan ish kunlari", String(d.wdLeft)),
      ...(d.volumePlan ? [f("Hajm rejasi", `${num(d.volumeFact)} / ${num(d.volumePlan)} m³`)] : []),
      f("Sotuvchilar", `bonus ${d.bonus.length} · norma ${d.normal.length} · ogohlantirish ${d.warn.length} · xavf ${d.risk.length}`, d.risk.length ? "danger" : undefined),
    ],
    sections: [
      sec("Sotuvchilar", d.sellers.map((s) => ({
        id: s.id, title: s.name,
        subtitle: `${s.plan ? `reja ${short(s.plan)} · ` : ""}prognoz ${short(s.forecast)}${s.fpct !== null ? ` (${fx(s.fpct, 0)}%)` : ""}${s.needPerDay ? ` · kerak ${short(s.needPerDay)}/kun` : ""}`,
        right: `${short(s.fact)}${s.pct !== null ? ` · ${fx(s.pct, 0)}%` : ""}`, status: s.signal, tone: SIGNAL_TONE[s.signal],
      })), {
        icon: "users", empty: "Sotuvchi yo'q",
        chart: { kind: "progress", items: d.sellers.filter((s) => s.plan).slice(0, 10).map((s) => ({ label: s.name, pct: s.pct === null ? null : Math.round(s.pct), fact: short(s.fact), plan: s.plan ? short(s.plan) : null, tone: SIGNAL_TONE[s.signal] ?? "info" })) },
      }),
      sec("Oxirgi 6 oy", d.monthly.map((m, i) => ({ id: `m${i}`, title: m.label, subtitle: m.plan ? `reja ${short(m.plan)}` : "reja yo'q", right: `${short(m.fact)}${m.pct !== null ? ` · ${fx(m.pct, 0)}%` : ""}` })), {
        icon: "chart-column",
        chart: { kind: "columns", series: [{ key: "p", label: "Reja", tone: "info" }, { key: "f", label: "Fakt", tone: "brand" }], groups: d.monthly.map((m) => ({ label: m.label, values: [m.plan, m.fact], texts: [short(m.plan), short(m.fact)] })) },
      }),
    ],
  };
}

const VERDICT_TONE: Record<string, Tone> = { "TO'XTATING": "danger", KAMAYTIRING: "warning", SAQLANG: "brand", "KO'PAYTIRING": "success", "MA'LUMOT KAM": "info" };
const xr = (v: number | null) => (v === null ? "—" : `${fx(v)}x`);

async function biMarketing({ r }: BiCtx): Promise<Part> {
  const d = await marketingTab(r);
  const T = d.t;
  return {
    title: "Marketing", subtitle: `Davr: ${r.label} · kanallar samaradorligi`,
    fields: [
      f("Sarflangan", `${short(T.spend)}${arrow(d.deltas.spend) ? ` · ${arrow(d.deltas.spend)}` : ""}`), f("Marketingdan tushum", short(T.revenue)),
      f("ROAS", xr(T.roas), T.roas !== null && T.roas < 1 ? "danger" : undefined), f("ROMI", T.romi === null ? "—" : `${fx(T.romi, 0)}%`),
      f("Leadlar / mijozlar", `${T.leads} / ${T.customers} · konversiya ${fx(d.conversion, 0)}%`), f("CPL / CAC", `${T.cpl === null ? "—" : short(T.cpl)} / ${T.cac === null ? "—" : short(T.cac)}`),
      f("LTV / CAC", d.ltvCac === null ? "—" : `${fx(d.ltvCac)}x`), f("Byudjet", short(T.budget)),
      ...(d.freed > 0 ? [f("To'xtatilsa bo'shaydi", short(d.freed), "warning")] : []),
    ],
    sections: pick(
      d.signals.length > 0 && sec("Xulosalar", d.signals.map((s, i) => ({ id: `s${i}`, title: s.title, subtitle: s.text, tone: levelTone(s.level) })), { icon: "info" }),
      sec("Kanallar", d.verdicts.map((c) => ({ id: c.channel, title: c.channel, subtitle: `sarf ${short(c.spend)} · tushum ${short(c.revenue)} · ${c.leads} lead · ${c.customers} mijoz`, right: `ROAS ${xr(c.roas)}`, status: c.verdict, tone: VERDICT_TONE[c.verdict] })), { icon: "chart-pie", empty: "Bu davr uchun ma'lumot kiritilmagan", chart: donutOf(d.verdicts.map((c) => ({ label: c.channel, value: c.spend }))) }),
      sec("Voronka", d.funnel.map((x, i) => ({ id: `f${i}`, title: x.label, subtitle: x.cost ? `bittasi ${short(x.cost)}` : undefined, right: num(x.value) })), { icon: "users" }),
    ),
  };
}

async function biMarketingPlan(): Promise<Part> {
  const now = new Date();
  const d = await marketingPlanTab(now.getFullYear(), now.getMonth() + 1);
  const T = d.totals;
  const pc = (fact: number, plan: number) => (plan ? ` · ${fx((fact / plan) * 100, 0)}%` : "");
  return {
    title: "Marketing reja nazorati", subtitle: `${MONTHS_UZ[d.month - 1]} ${d.year} · faqat ko'rish`,
    fields: [
      f("Byudjet", short(T.budget)), f("Sarf (reja / fakt)", `${short(T.plan.spend)} / ${short(T.fact.spend)}${pc(T.fact.spend, T.plan.spend)}`),
      f("Leadlar (reja / fakt)", `${T.plan.leads} / ${T.fact.leads}${pc(T.fact.leads, T.plan.leads)}`), f("Mijozlar (reja / fakt)", `${T.plan.customers} / ${T.fact.customers}${pc(T.fact.customers, T.plan.customers)}`),
      f("Daromad (reja / fakt)", `${short(T.plan.revenue)} / ${short(T.fact.revenue)}${pc(T.fact.revenue, T.plan.revenue)}`),
    ],
    sections: pick(
      d.notes.length > 0 && sec("Izohlar", d.notes.map((n, i) => ({ id: `n${i}`, title: n.title, subtitle: n.text, tone: levelTone(n.level) })), { icon: "info" }),
      sec("Kanallar", d.byChannel.map((c) => ({ id: c.channel, title: c.channel, subtitle: `sarf ${short(c.fact.spend)}/${short(c.plan.spend)} · lead ${c.fact.leads}/${c.plan.leads} · mijoz ${c.fact.customers}/${c.plan.customers}${c.roas !== null ? ` · ROAS ${xr(c.roas)}` : ""}`, right: `${short(c.fact.revenue)}${c.pct.revenue !== null ? ` · ${fx(c.pct.revenue, 0)}%` : ""}`, tone: (c.pct.spend !== null && c.pct.spend > 110 ? "warning" : "info") as Tone })), {
        icon: "chart-pie", empty: "Reja kiritilmagan",
        chart: { kind: "progress", items: d.byChannel.filter((c) => c.plan.revenue > 0).slice(0, 8).map((c) => ({ label: c.channel, pct: c.pct.revenue === null ? null : Math.round(c.pct.revenue), fact: short(c.fact.revenue), plan: short(c.plan.revenue), tone: (c.pct.revenue !== null && c.pct.revenue >= 100 ? "success" : c.pct.revenue !== null && c.pct.revenue >= 70 ? "brand" : "danger") as Tone })) },
      }),
      sec(`${d.year} — oylar`, d.monthly.filter((m) => m.planRevenue || m.factRevenue || m.planSpend || m.factSpend).map((m, i) => ({ id: `m${i}`, title: m.label, subtitle: `sarf ${short(m.factSpend)}/${short(m.planSpend)} · lead ${m.factLeads}/${m.planLeads}`, right: `${short(m.factRevenue)}/${short(m.planRevenue)}` })), { icon: "chart-column", empty: "Bu yil ma'lumot yo'q" }),
    ),
  };
}

async function biMarketingData(): Promise<Part> {
  const year = new Date().getFullYear();
  const d = await marketingEntries({ year });
  const S = d.summary;
  return {
    title: "Marketing ma'lumotlari", subtitle: `${year}-yil · oy × kanal yozuvlari · kiritish vebda`,
    fields: [
      f("Rejalashtirilgan byudjet", short(S.budget)),
      f("Haqiqiy sarflangan", `${short(S.spent)}${S.budget ? ` · byudjetning ${fx((S.spent / S.budget) * 100, 0)}%` : ""}`, S.budget && S.spent > S.budget ? "danger" : undefined),
      f("Marketingdan tushum", short(S.revenue)), f("ROAS", xr(S.roas)), f("Yozuvlar", `${S.count} ta`),
    ],
    sections: [sec("Yozuvlar", d.rows.slice(0, 60).map((e) => ({
      id: e.id, title: `${MONTHS_UZ[e.month - 1]} · ${e.channel}`,
      subtitle: [KIND_LABEL[e.kind], e.leads != null ? `${e.leads} lead` : null, e.customers != null ? `${e.customers} mijoz` : null, e.revenue != null ? `tushum ${short(Number(e.revenue))}` : null, e.createdBy.fullName].filter(Boolean).join(" · "),
      right: short(Number(e.amount)), tone: (e.kind === "FACT" ? "success" : e.kind === "PLAN" ? "warning" : "info") as Tone,
    })), { icon: "file-text", empty: "Bu yil yozuv yo'q" })],
  };
}

async function biForecast(): Promise<Part> {
  const d = await forecastTab();
  const groups = d.labels.map((label, i) => ({ label, h: Number(d.histVals[i] ?? 0), fc: Number(d.fcVals[i] ?? 0) }));
  return {
    title: "Bashorat (ML)", subtitle: "Trend × hafta kuni mavsumiyligi · sana filtriga bog'liq emas",
    status: d.enough ? undefined : "Ma'lumot kam",
    fields: [
      ...(d.enough ? [] : [f("Diqqat", `Tarix ${d.histDays} kun — ishonchli bashorat uchun kamida ${d.minDays} kun kerak`, "warning")]),
      f("Keyingi 7 kun", `${num(d.next7)} m³ · ~${short(d.next7Revenue)}`), f("Keyingi 30 kun", `${num(d.next30)} m³ · ~${short(d.next30Revenue)}`),
      f("Model aniqligi (WAPE)", d.wape === null ? "—" : `${fx(d.wape * 100, 0)}% xato`), f("Trend", `${d.slope >= 0 ? "▲" : "▼"} ${fx(Math.abs(d.slope))} m³/kun`),
      f("Quvvat", `o'rtacha ${num(d.capacity.avg)} · eng yuqori ${num(d.capacity.peak)} · kerak ${num(d.capacity.needPerDay)} m³/kun`, d.capacity.needPerDay > d.capacity.peak && d.capacity.peak > 0 ? "danger" : undefined),
      f("Xomashyo", `14 kunda tugaydi: kritik ${d.zones.critical} · o'rta ${d.zones.mid}`, d.zones.critical ? "danger" : "success"),
    ],
    sections: [
      sec("Sotuv: tarix va bashorat (m³)", [], { icon: "chart-column", empty: "Grafik yangi ilovada", chart: { kind: "columns", series: [{ key: "h", label: "Fakt", tone: "brand" }, { key: "f", label: "Bashorat", tone: "warning" }], groups: groups.map((g) => ({ label: g.label, values: [g.h, g.fc], texts: [num(g.h), num(g.fc)] })) } }),
      sec("Xomashyo tugash prognozi", d.matForecast.filter((m) => m.daysLeft !== null).slice(0, 15).map((m) => ({ id: m.id, title: m.name, subtitle: `qoldiq ${num(m.balance)} ${m.unit} · kuniga ${num(m.perDayFc)}${m.orderQty > 0 ? ` · buyurtma ${num(m.orderQty)} ${m.unit}` : ""}`, right: m.runsOut ? `${day(m.runsOut)} · ${num(m.daysLeft!)} kun` : "—", tone: (m.daysLeft! < 7 ? "danger" : m.daysLeft! < 14 ? "warning" : "success") as Tone })), { target: "stock", empty: "Sarf ma'lumoti yo'q" }),
      sec("Hafta kuni indeksi", monFirst(d.weekday).map((w, i) => ({ id: `w${i}`, title: w.label, right: `${Math.round(w.value)}%` })), { icon: "calendar-days", chart: barsOf("Indeks", monFirst(d.weekday), (v) => `${Math.round(v)}%`) }),
    ],
  };
}

async function biChurn({ r }: BiCtx): Promise<Part> {
  const d = await customersTab(r, { page: 1, size: 1 });
  const C = d.churn;
  const zoneTone: Record<string, Tone> = { Kritik: "danger", Yuqori: "danger", "O'rta": "warning", Past: "info", Xavfsiz: "success" };
  return {
    title: "Churn tahlili", subtitle: "Mijozlarning ketish xavfi — qoida asosidagi ball",
    fields: [
      f("Xavf ostida", `${C.atRisk} ta mijoz`, C.atRisk ? "danger" : "success"), f("Kutilgan yo'qotish", money(C.expectedLoss), C.expectedLoss ? "danger" : undefined),
      f("Qaytarsa bo'ladi (yiliga)", short(C.recoverable)), f("O'rtacha xavf bali", fx(C.avgScore, 0)),
    ],
    sections: [
      sec("Xavf zonalari", C.zones.map((z) => ({ id: z.label, title: z.label, subtitle: z.loss ? `kutilgan yo'qotish ${short(z.loss)}` : undefined, right: `${z.value} ta`, tone: zoneTone[z.label] })), { icon: "chart-pie", chart: donutOf(C.zones.map((z) => ({ label: z.label, value: z.value })), (v) => `${v} ta`, "mijoz") }),
      sec("Omillar", C.factors.map((x, i) => ({ id: `f${i}`, title: x.label, right: `${x.value} ta`, tone: (x.value ? "warning" : "success") as Tone })), { icon: "triangle-alert" }),
      sec("Birinchi navbatda", d.nba.map((x) => ({ id: x.id, title: x.name, subtitle: `${x.segment} · ${x.risk} · ${x.action}`, right: short(x.expectedLoss || x.overdueDebt || x.debt), tone: zoneTone[x.risk] })), { target: "customers", empty: "Xavf ostida mijoz yo'q" }),
    ],
  };
}

async function biClusters({ r }: BiCtx): Promise<Part> {
  const d = await productsTab(r);
  return {
    title: "Mahsulot klasterlari", subtitle: `Davr: ${r.label} · tezlik × o'sish`,
    fields: d.clusters.map((c) => f(`${c.title} (${c.sub.toLowerCase()})`, `${c.count} ta · ${short(c.revenue)} · ${fx(c.share, 0)}%`)),
    sections: [
      sec("Klasterlar", d.clusters.map((c) => ({ id: c.key, title: c.title, subtitle: `${c.advice} · ${c.products.slice(0, 8).join(", ")}`, right: `marja ${fx(c.margin)}%` })), { icon: "layout-grid", empty: "Mahsulot yo'q", chart: donutOf(d.clusters.map((c) => ({ label: c.title, value: c.revenue }))) }),
    ],
  };
}

const ANOM_TONE: Record<string, Tone> = { High: "danger", Medium: "warning", Low: "info" };
const ANOM_LABEL: Record<string, string> = { High: "Yuqori", Medium: "O'rta", Low: "Past" };

async function biAnomalies(): Promise<Part> {
  const d = await anomaliesTab({ days: 30 });
  const C = d.cards;
  return {
    title: "Anomaliyalar", subtitle: "Oxirgi 30 kun · qoida asosida aniqlangan shubhali holatlar",
    fields: [
      f("Jami", `${C.total} ta`), f("Yuqori / o'rta / past", `${C.high} / ${C.medium} / ${C.low}`, C.high ? "danger" : undefined),
      f("Yuqori xavfdagi summa", money(C.money), C.money ? "danger" : undefined), f("Oxirgi 7 kun", `${C.last7} ta · oldingi 7 kun ${C.prev7}`), f("Ish vaqtidan tashqari", `${C.offHours} ta`),
    ],
    sections: [
      sec("Turlar", d.patterns.map((p) => ({ id: p.pattern, title: p.pattern, subtitle: `${p.source}${p.high ? ` · ${p.high} ta yuqori` : ""}`, right: `${p.count} ta${p.amount ? ` · ${short(p.amount)}` : ""}`, tone: (p.high ? "danger" : "warning") as Tone })), { icon: "chart-pie", chart: donutOf(d.patterns.map((p) => ({ label: p.pattern, value: p.count })), (v) => `${v} ta`, "holat") }),
      sec("Holatlar", d.list.slice(0, 40).map((a) => ({ id: a.id, title: a.title, subtitle: [day(a.date), a.source, a.pattern, a.who, a.detail].filter(Boolean).join(" · "), right: a.amount ? short(a.amount) : undefined, status: ANOM_LABEL[a.level], tone: ANOM_TONE[a.level] })), { icon: "triangle-alert", empty: "Shubhali holat topilmadi" }),
      sec("Kim kiritgan", d.who.map((w) => ({ id: w.label, title: w.label, subtitle: w.high ? `${w.high} ta yuqori` : undefined, right: `${w.value} ta` })), { icon: "user", empty: "—" }),
    ],
  };
}

async function biTelegram({ user }: BiCtx): Promise<Part> {
  const [bot, mine] = await Promise.all([
    botEnabled() ? getMe().catch(() => null) : Promise.resolve(null),
    db.telegramAccount.findMany({ where: { userId: user.id }, orderBy: { linkedAt: "desc" }, select: { id: true, username: true, firstName: true, chatId: true, linkedAt: true, isBlocked: true } }),
  ]);
  const all = user.role === "DIRECTOR" ? await db.telegramAccount.findMany({ where: { userId: { not: null } }, orderBy: { linkedAt: "desc" }, take: 30, select: { id: true, username: true, firstName: true, chatId: true, linkedAt: true, isBlocked: true, user: { select: { fullName: true, role: true } } } }) : [];
  const name = (a: { username: string | null; firstName: string | null; chatId: string }) => (a.username ? `@${a.username}` : a.firstName ?? a.chatId);
  return {
    title: "Telegram bot", subtitle: "Ovozli savol bering — bot ERP raqamlari asosida javob qaytaradi, hech narsani o'zgartirmaydi",
    status: bot ? "Bot ishlayapti" : "Bot sozlanmagan",
    fields: [
      f("Bot", bot ? `@${bot.username}` : "sozlanmagan (TELEGRAM_BOT_TOKEN)", bot ? "success" : "warning"),
      f("1-qadam", bot ? `Telegramda @${bot.username} ni oching va /start bosing` : "Bot sozlangach ulanadi"),
      f("2-qadam", `«Ulash kodini olish» — 8 xonali kod, ${LINK_CODE_TTL_MIN} daqiqa amal qiladi`),
      f("3-qadam", "Kodni botga yuboring — shundan keyin savol berishingiz mumkin"),
      f("Ulangan chatlaringiz", `${mine.length} ta`),
    ],
    sections: pick(
      sec("Ulangan chatlaringiz", mine.map((a) => ({ id: a.id, title: name(a), subtitle: a.linkedAt ? `ulangan ${dt(a.linkedAt)}` : undefined, status: a.isBlocked ? "Bloklangan" : undefined, tone: (a.isBlocked ? "danger" : "success") as Tone })), { icon: "message-circle", empty: "Hali ulanmagan" }),
      user.role === "DIRECTOR" && sec("Barcha ulangan chatlar", all.map((a) => ({ id: a.id, title: `${a.user?.fullName ?? "—"} · ${name(a)}`, subtitle: `${a.user ? ROLE_LABELS[a.user.role] : ""}${a.linkedAt ? ` · ${dt(a.linkedAt)}` : ""}`, status: a.isBlocked ? "Bloklangan" : undefined, tone: (a.isBlocked ? "danger" : "info") as Tone })), { icon: "users", empty: "Hech kim ulanmagan" }),
    ),
    actions: bot && allowed(user, "tg.code") ? [{ id: "tg.code", label: "Ulash kodini olish", tone: "brand" }] : [],
  };
}

const BI_BUILDERS: Record<string, (c: BiCtx) => Promise<Part>> = {
  overview: biOverview, sales: biSales, cancelled: biCancelled, agents: biAgents, customers: biCustomers, stock: biStock,
  products: biProducts, operations: biOperations, finance: biFinance, plan: () => biPlan(), marketing: biMarketing,
  mplan: () => biMarketingPlan(), mdata: () => biMarketingData(), forecast: () => biForecast(), churn: biChurn,
  clusters: biClusters, anomalies: () => biAnomalies(), telegram: biTelegram,
};

async function biDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const [tab, per] = id.split(".");
  const build = Object.hasOwn(BI_BUILDERS, tab ?? "") ? BI_BUILDERS[tab!] : undefined;
  if (!build) return notFound("Bunday tahlil yo'q");
  const part = await build({ user, r: parseRange({ period: biPeriod(per) }) });
  return { key: "bi", id, actions: [], ...part };
}

// ───────────────────────── Egasi dashbordi — mobil bosh sahifada yo'q bloklar ─────────────────────────

const OWNER_PARTS = ["plan", "funnel", "debt", "stock", "transport", "cashplan", "expctl"] as const;

/** Direktor bosh sahifasidagi «Egasi paneli — batafsil» bo'limi: har qator — vebdagi blokning kartochkasi. */
async function ownerHomeSection(): Promise<HomeSection> {
  const d = await ownerCached();
  const S = d.summary, T = d.transport;
  const rows: Record<(typeof OWNER_PARTS)[number], HomeRow> = {
    plan: { id: "plan", title: "Plan / fakt / prognoz", subtitle: `tushum ${short(S.revenue.month)}${S.revenue.plan ? ` · plan ${pctText(S.revenue.pct)}` : ""} · prognoz ${short(S.revenue.forecast)}`, tone: levelTone(d.levels.revenue) },
    funnel: { id: "funnel", title: "Zayavka → yetkazildi → to'landi", subtitle: `${d.funnel.stuck.length} muddati o'tgan · ${d.funnel.unpaidShipments.length} to'lanmagan otgruzka`, tone: d.funnel.stuck.length ? "warning" : "success" },
    debt: { id: "debt", title: "Debitorka va kreditorka", subtitle: `debitorka ${short(d.debt.receivable)} · kreditorka ${short(d.debt.payable.total)}`, tone: d.debt.overdue > 0 ? "warning" : "success" },
    stock: { id: "stock", title: "Sklad va xomashyo", subtitle: `qiymat ${short(d.stock.value)} · ${d.stock.critical.length} kritik${d.stock.minDays ? ` · ${d.stock.minDays.name} ${num(d.stock.minDays.days)} kun` : ""}`, tone: d.stock.critical.length ? "danger" : "success" },
    transport: { id: "transport", title: "Transport va texnika", subtitle: `${T.working} ishda · ${T.free} bo'sh · ${T.repair.length} ta'mirda · ${T.idle.length} bekor`, tone: T.repair.length + T.idle.length ? "warning" : "success" },
    cashplan: { id: "cashplan", title: "Pul rejasi va uzilish prognozi", subtitle: `7 kunda to'lov ${short(d.cashflow.planned.d7)}${S.cash.gapDay ? ` · ${S.cash.gapDay} kunda pul yetmaydi` : ""}`, tone: S.cash.gapDay ? "danger" : "success" },
    expctl: { id: "expctl", title: "Xarajat nazorati", subtitle: `${d.expenses.overspent.length} oshgan · ${d.expenses.unplanned.length} rejasiz · ${d.expenses.anomalies.length} g'ayrioddiy`, tone: d.expenses.overspent.length ? "danger" : d.expenses.unplanned.length + d.expenses.anomalies.length ? "warning" : "success" },
  };
  return { title: "Egasi paneli — batafsil", empty: "", icon: "layout-grid", target: "owner", rows: OWNER_PARTS.map((k) => rows[k]) };
}

async function ownerDetail(id: string): Promise<MobileDetail> {
  const d = await ownerCached();
  const S = d.summary, L = d.levels;
  const base = { key: "owner", id, actions: [] as DetailAction[] };
  const qty = (n: number) => `${num(n)} m³`;
  switch (id) {
    case "plan": {
      const concreteFc = d.wdPassed ? (S.production.concreteMonth / d.wdPassed) * d.wdTotal : 0;
      const items = [
        { label: "Tushum", plan: S.revenue.plan, fact: S.revenue.month, fc: S.revenue.forecast, invert: false, level: L.revenue, fmt: short },
        { label: "Sof foyda", plan: S.profit.plan, fact: S.profit.month, fc: S.profit.forecast, invert: false, level: L.profit, fmt: shortSigned },
        { label: "Xarajatlar", plan: S.expenses.plan, fact: S.expenses.month, fc: d.expenses.forecast, invert: true, level: L.expenses, fmt: short },
        { label: "Beton, m³", plan: S.production.concretePlan, fact: S.production.concreteMonth, fc: concreteFc, invert: false, level: L.production, fmt: qty },
      ];
      return {
        ...base, title: "Plan / fakt / prognoz", subtitle: `Joriy oy · ${d.wdPassed} / ${d.wdTotal} ish kuni o'tdi · prognoz — ish kunlari sur'ati`,
        fields: items.map((x) => f(x.label, `fakt ${x.fmt(x.fact)} · prognoz ${x.fmt(x.fc)}${x.plan ? ` · plan ${x.fmt(x.plan)} (chetlanish ${x.fmt(x.fc - x.plan)})` : " · plan yo'q"}`, levelTone(x.level))),
        sections: [
          sec("Bajarilish", items.map((x, i) => ({ id: `p${i}`, title: x.label, subtitle: `plan ${x.plan ? x.fmt(x.plan) : "—"} · prognoz ${x.fmt(x.fc)}`, right: x.plan ? pctText((x.fact / x.plan) * 100) : x.fmt(x.fact), tone: levelTone(x.level) })), {
            icon: "square-check",
            chart: { kind: "progress", items: items.map((x) => ({ label: x.label, pct: x.plan ? Math.round((x.fact / x.plan) * 100) : null, fact: x.fmt(x.fact), plan: x.plan ? x.fmt(x.plan) : null, tone: levelTone(x.level), invert: x.invert })) },
          }),
          sec("Sotuv o'sishi", d.dyn.map((x) => ({ id: `g${x.days}`, title: `Oxirgi ${x.days} kun`, subtitle: "oldingi shunday davrga nisbatan", right: `${short(x.revenue)}${arrow(x.delta) ? ` · ${arrow(x.delta)}` : ""}`, tone: (x.delta !== null && x.delta < 0 ? "danger" : "success") as Tone })), { icon: "trending-up" }),
          sec("Beton — 3 oy", d.trend.map((t) => ({ id: t.key, title: t.label, right: qty(t.production) })), { icon: "chart-column" }),
        ],
      };
    }
    case "funnel": {
      const F = d.funnel, base0 = F.stages[0]?.sum || 1;
      return {
        ...base, title: "Zayavka → ishlab chiqarish → yetkazildi → to'landi", subtitle: "Joriy oyda qabul qilingan zayavkalar",
        fields: F.stages.map((s) => f(s.label, `${s.count} ta · ${short(s.sum)}`)),
        sections: [
          sec("Bosqichlar", F.stages.map((s) => ({ id: s.key, title: s.label, subtitle: `${s.count} ta`, right: short(s.sum) })), { icon: "chart-column", chart: { kind: "progress", items: F.stages.map((s) => ({ label: s.label, pct: Math.round((s.sum / base0) * 100), fact: `${s.count} ta · ${short(s.sum)}`, plan: null, tone: "brand" as Tone })) } }),
          sec(`Muddati o'tgan zayavkalar (${F.stuck.length})`, F.stuck.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer}`, subtitle: `${day(o.deliveryDate)} · ${o.days} kun kech`, right: short(o.sum), tone: "danger" as Tone })), { target: "orders", empty: "Yo'q" }),
          sec(`To'lanmagan otgruzka (${F.unpaidShipments.length})`, F.unpaidShipments.map((o) => ({ id: o.id, title: `${o.orderNo} · ${o.customer}`, right: short(o.left), tone: "warning" as Tone })), { target: "orders", empty: "Yo'q" }),
        ],
      };
    }
    case "debt": {
      const D = d.debt;
      const labels = [`0–${OWNER_EDGES[0]} kun`, `${OWNER_EDGES[0] + 1}–${OWNER_EDGES[1]}`, `${OWNER_EDGES[1] + 1}–${OWNER_EDGES[2]}`, `${OWNER_EDGES[2]}+`];
      const ag = labels.map((label, i) => ({ label, value: D.aging[i] ?? 0 }));
      return {
        ...base, title: "Debitorka va kreditorka", subtitle: `Muddati o'tgan — ${d.thresholds.overdue} kundan eski ochiq schyotlar`,
        fields: [
          f("Debitorka", money(D.receivable)), f("Muddati o'tgan", money(D.overdue), D.overdue > 0 ? "danger" : "success"),
          f("Kreditorka (tasdiqlangan ta'minot)", money(D.payable.total)), f("Kreditorka muddati o'tgan", money(D.payable.overdue), D.payable.overdue > 0 ? "danger" : undefined),
        ],
        sections: pick(
          sec("Qarz yoshi", ag.map((a, i) => ({ id: `a${i}`, title: a.label, right: short(a.value), tone: (i >= 2 && a.value > 0 ? "danger" : "info") as Tone })), { icon: "clock", chart: barsOf("Qarz", ag) }),
          sec("Eng katta qarzdorlar", D.topDebtors.map((c) => ({ id: c.id, title: c.name, subtitle: `${c.overdue ? `muddati o'tgan ${short(c.overdue)} · ` : ""}eng eskisi ${c.oldest} kun`, right: short(c.debt), tone: (c.overdue > 0 ? "danger" : "warning") as Tone })), { target: "customers", empty: "Qarz yo'q" }),
          sec("To'lanadigan ta'minot", D.payable.rows.map((x) => ({ id: x.id, title: `${x.docNo} · ${x.supplier}`, subtitle: `${x.by}${x.needBy ? ` · kerak ${day(x.needBy)}` : ""}`, right: short(x.amount), tone: (x.overdue ? "danger" : "info") as Tone })), { target: "supply", empty: "Tasdiq kutayotgan ta'minot yo'q" }),
          D.topSuppliers.length > 0 && sec("Eng katta yetkazuvchilar (oy)", D.topSuppliers.map((s, i) => ({ id: `s${i}`, title: s.name, right: short(s.value) })), { icon: "store" }),
        ),
      };
    }
    case "stock": {
      const K = d.stock;
      return {
        ...base, title: "Sklad va xomashyo", subtitle: `Kunlar — qoldiq 30 kunlik o'rtacha sarfda necha kunga yetadi · ${d.thresholds.stockCrit} kundan kam — kritik`,
        fields: [
          f("Qoldiq qiymati", money(K.value)), f("Kritik", `${K.critical.length} ta`, K.critical.length ? "danger" : "success"),
          ...(K.minDays ? [f("Eng avval tugaydi", `${K.minDays.name} — ${num(K.minDays.days)} kun`, K.minDays.days < d.thresholds.stockCrit ? "danger" : undefined)] : []),
          ...(d.production.materialOverspend > 0 ? [f("Normadan ortiq sarf (oy)", money(d.production.materialOverspend), "danger")] : []),
        ],
        sections: [sec("Xomashyo", K.rows.slice(0, 20).map((x) => ({ id: x.id, title: `${x.name}${x.short ? " · zayavkalarga yetmaydi" : ""}`, subtitle: `qoldiq ${num(x.balance)} ${x.unit} · kuniga ${num(x.perDay)}${x.normDev !== null ? ` · normadan ${x.normDev > 0 ? "+" : ""}${fx(x.normDev, 0)}%` : ""}`, right: x.days === null ? "—" : `${num(x.days)} kun`, tone: levelTone(x.level) })), { target: "stock", empty: "Xomashyo yo'q" })],
      };
    }
    case "transport": {
      const T = d.transport;
      return {
        ...base, title: "Transport va texnika", subtitle: "Holat (ta'mirda / bekor) — logistika belgilaydi",
        fields: [
          f("Jami", String(T.total)), f("Ishda / bo'sh", `${T.working} / ${T.free}`), f("Ta'mirda", String(T.repair.length), T.repair.length ? "warning" : undefined), f("Bekor", String(T.idle.length), T.idle.length ? "warning" : undefined),
          f("Reyslar bugun / oy", `${T.tripsToday} / ${T.tripsMonth}`), f("O'rtacha m³ / reys", num(T.avgM3)),
          f("Yoqilg'i fakt / norma", `${short(T.fuelFact)} / ${T.fuelNorm !== null ? short(T.fuelNorm) : "—"}`, T.fuelOver > 0 ? "danger" : undefined),
          f("Ta'mir xarajati (oy)", short(T.repairFact)), f("Bekor turish", T.idleDays ? `${T.idleDays} texnika-kun` : "yo'q", T.idleDays ? "warning" : undefined),
        ],
        sections: [sec("Ta'mirda va bekor", [...T.repair, ...T.idle].map((v) => ({ id: v.id, title: v.plate, subtitle: v.statusNote ?? "sabab yozilmagan", right: v.statusSince ? `${day(v.statusSince)} dan` : undefined, status: v.status === "REPAIR" ? "Ta'mirda" : "Bekor", tone: (v.status === "REPAIR" ? "danger" : "warning") as Tone })), { icon: "truck", empty: "Hamma texnika ishda" })],
      };
    }
    case "cashplan": {
      const C = d.cashflow;
      return {
        ...base, title: "Pul rejasi", subtitle: "Yaqin to'lovlar — tasdiqlangan, moliya hali to'lamagan ta'minot · uzilish = qoldiq + o'rtacha kirim − chiqim − to'lovlar",
        fields: [
          f("Hozir", shortSigned(S.cash.total)), f("To'lov 7 / 14 / 30 kun", `${short(C.planned.d7)} / ${short(C.planned.d14)} / ${short(C.planned.d30)}`),
          f("O'rtacha kunlik kirim / chiqim", `${short(C.avgDailyIn)} / ${short(C.avgDailyOut)}`),
          ...(S.cash.gapDay ? [f("Pul yetmay qolishi", `${S.cash.gapDay} kun ichida`, "danger")] : []),
        ],
        sections: [
          sec("Qoldiq prognozi", C.gap.map((g) => ({ id: `g${g.days}`, title: `${g.days} kundan keyin`, right: shortSigned(g.balance), tone: (g.balance < 0 ? "danger" : "success") as Tone })), { icon: "landmark" }),
          sec("Yaqin to'lovlar (ta'minot)", C.planned.rows.map((x) => ({ id: x.id, title: `${x.docNo} · ${x.supplier}`, subtitle: `${x.status === "APPROVED" ? "to'lov kutmoqda" : "tasdiq kutmoqda"}${x.needBy ? ` · kerak ${day(x.needBy)}` : ""}`, right: short(x.amount), tone: (x.overdue ? "danger" : "info") as Tone })), { target: "supply", empty: "Yaqin to'lov yo'q" }),
        ],
      };
    }
    case "expctl": {
      const E = d.expenses, P = d.production;
      const catRow = (c: (typeof E.categories)[number], note: string): HomeRow => ({ id: `${c.cat}`, title: c.cat, subtitle: `${c.plan !== null ? `byudjet ${short(c.plan)} · ` : ""}${note}`, right: short(c.month), tone: levelTone(c.level) });
      return {
        ...base, title: "Xarajat nazorati", subtitle: "Joriy oy · byudjetdan oshgan, rejasiz va g'ayrioddiy xarajatlar",
        fields: [
          f("Byudjetdan oshgan", `${E.overspent.length} kategoriya`, E.overspent.length ? "danger" : "success"), f("Rejalashtirilmagan", `${E.unplanned.length} kategoriya`, E.unplanned.length ? "warning" : undefined),
          f("G'ayrioddiy (3 oy o'rtachasidan 1,5×)", `${E.anomalies.length} kategoriya`, E.anomalies.length ? "warning" : undefined),
          f("Takroriy chiqim", E.duplicates ? `${E.duplicates} ta · ${short(E.duplicateSum)}` : "yo'q", E.duplicates ? "warning" : undefined),
          f("Xarajat / tushum", pctText(E.ratio), E.ratio > 80 ? "danger" : undefined),
        ],
        sections: pick(
          sec("Byudjetdan oshgan", E.overspent.map((c) => catRow(c, `oshdi ${short(Math.max(0, c.deviation ?? 0))}`)), { target: "byudjet", empty: "Yo'q" }),
          sec("Rejalashtirilmagan", E.unplanned.map((c) => catRow(c, "byudjet belgilanmagan")), { target: "byudjet", empty: "Hamma xarajat byudjet ichida" }),
          sec("G'ayrioddiy", E.anomalies.map((c) => catRow(c, `prognoz ${short(c.forecast)}`)), { target: "byudjet", empty: "Yo'q" }),
          P.unitCosts.length > 0 && sec("Mahsulot tannarxi va marjasi", P.unitCosts.slice(0, 8).map((p) => ({ id: p.id, title: `${p.code} · ${p.name}`, subtitle: `${p.unitCost !== null ? `tannarx ${short(p.unitCost)}` : "tannarx noma'lum"} · narx ${short(p.price)}`, right: pctText(p.margin), tone: (p.margin >= 20 ? "success" : p.margin >= 10 ? "warning" : "danger") as Tone })), { icon: "package" }),
          P.norm.length > 0 && sec("Xomashyo: norma / fakt (oy)", P.norm.map((n) => ({ id: n.id, title: n.name, subtitle: `norma ${num(n.norm)} · fakt ${num(n.fact)} ${n.unit}`, right: `${n.devPct > 0 ? "+" : ""}${fx(n.devPct, 0)}%${n.cost > 0 ? ` · ${short(n.cost)}` : ""}`, tone: (n.devPct > 5 ? "danger" : n.devPct > 0 ? "warning" : "success") as Tone })), { target: "stock" }),
        ),
      };
    }
    default: return notFound("Bunday blok yo'q");
  }
}

// ───────────────────────── Ro'yxat / kartochka / amal / bosh sahifa — registr nuqtalari ─────────────────────────

/** `list.ts` → `mobileList`: ruxsat u yerda tekshirilgan (`DIREKTOR_ACCESS`). */
export async function direktorList(_user: MobileUser, key: string, title: string, q?: string, filter?: string): Promise<MobileList> {
  switch (key) {
    case "bi": return biList(title, filter);
    case "ilova-users": return appUsersList(title, q, filter);
    case "byudjet": return budgetList(title, filter);
    default: throw new ListError("UNKNOWN_LIST", "Bunday ro'yxat yo'q", 404);
  }
}

/** `detail.ts` → `mobileDetail`: rol `DIREKTOR_DETAIL_ROLES` va modul yopiqligi u yerda tekshirilgan. */
export async function direktorDetail(user: MobileUser, card: string, id: string): Promise<MobileDetail> {
  switch (card) {
    case "bi": return biDetail(user, id);
    case "ilova-users": return appUserDetail(user, id);
    case "byudjet": return budgetDetail(id);
    case "owner": return ownerDetail(id);
    case "access": return accessDetail(user, id);
    case "deletion": return deletionDetail(user, id);
    default: throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
  }
}

/** `actions.ts` → `runMobileAction`: rol va ruxsat (`can`) u yerda tekshirilgan; bu yerda — veb lib funksiyasi. */
export async function direktorAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<ActionResult> {
  switch (action) {
    case "access.approve": {
      const r = await approveAccessAs(id, textOf(payload, "role") as never, { userId: user.id, role: user.role });
      if (!r.ok) fail(r.error);
      return { ok: true, message: `Login «${(r as { login: string }).login}» ochildi` };
    }
    case "access.reject": {
      const r = await rejectAccessRequest(id, textOf(payload, "reason").slice(0, 300) || null, user.id);
      if (!r.ok) fail(r.error);
      return { ok: true, message: "Ariza rad etildi" };
    }
    case "deletion.approve": {
      const r = await approveDeletion(id, user.id);
      if (!r.ok) fail(r.error);
      return { ok: true, message: "Hisob yopildi" };
    }
    case "deletion.reject": {
      const r = await rejectDeletion(id, user.id, textOf(payload, "reason").slice(0, 300) || null);
      if (!r.ok) fail(r.error);
      return { ok: true, message: "So'rov rad etildi" };
    }
    case "appuser.grant": {
      const u = await findAppUser(id);
      let role = textOf(payload, "role");
      if (!role) {
        // Zavod xodimi: roli lavozimidan (lib uni almashtirmaydi) — veb ham ro'yxatdagi birinchi rolni yuboradi.
        // Xodim bo'lmasa rol tanlanishi shart: aks holda tasodifiy rol berilib qolmasin.
        const [own, emp] = await Promise.all([
          db.user.findUnique({ where: { ecoUserId: u.userId }, select: { id: true } }),
          db.employee.findFirst({ where: { ecoUserId: u.userId, userId: { not: null } }, select: { id: true } }),
        ]);
        if (own || !emp) fail("Rolni tanlang");
        role = APP_GRANTABLE_ROLES[0]!;
      }
      if (!APP_GRANTABLE_ROLES.includes(role as never)) fail("Rolni tanlang");
      let r: { error?: string };
      try { r = await grantAppAccess(user.id, u.userId, u.phone, role as never); } catch (e) { return fail((e as Error).message); }
      if (r.error) fail(r.error);
      return { ok: true, message: "ERP ruxsati saqlandi" };
    }
    case "appuser.revoke": {
      const ecoUserId = id.split("~")[0]!;
      const r = await revokeAppAccess(user.id, ecoUserId);
      if (r.error) fail(r.error);
      return { ok: true, message: "ERP ruxsati yopildi" };
    }
    case "tg.code": {
      const bot = botEnabled() ? await getMe().catch(() => null) : null;
      const r = await createTelegramLinkCode(user.id);
      if ("error" in r) return fail(r.error);
      return {
        ok: true, message: `Kod: ${r.code} — botga yuboring`,
        receipt: {
          headline: r.code, caption: bot ? `@${bot.username} botiga yuboring` : "Kodni botga yuboring",
          status: { label: "Kod tayyor", tone: "success", at: time(new Date()) },
          rows: [{ label: "Kod", value: r.code, copy: true }, { label: "Amal qiladi", value: `${time(r.expiresAt)} gacha (${LINK_CODE_TTL_MIN} daqiqa)` }, ...(bot ? [{ label: "Bot", value: `@${bot.username}`, copy: true }] : [])],
        },
      };
    }
    default: return fail("Bunday amal yo'q", 404);
  }
}

/**
 * Bosh sahifaga qo'shimcha bo'limlar (`home.ts`): direktorga — Egasi dashbordining batafsil bloklari;
 * moliya va buxgalteriyaga — BI tahlilga kirish (vebda ularning menyusida «Tahlil» guruhi bor).
 */
export async function direktorHomeSections(user: MobileUser): Promise<HomeSection[]> {
  if (user.role === "DIRECTOR") return [await ownerHomeSection()];
  if ((user.role === "FINANCE" || user.role === "ACCOUNTING") && user.perms?.["bi-tahlil"] !== "none") {
    const rows = ["overview", "finance", "sales", "customers"].map((k) => BI_TABS.find((t) => t.key === k)!).map((t) => ({ id: `${t.key}.month`, title: t.title, subtitle: t.hint }));
    return [{ title: "BI tahlil", empty: "", icon: "chart-column", target: "bi", rows }];
  }
  return [];
}

/** Bosh sahifadagi tezkor ro'yxat ikonlari (`home.ts` LIST_ICON). */
export const DIREKTOR_LIST_ICON: Record<string, string> = { bi: "chart-column", "ilova-users": "smartphone", byudjet: "pie-chart" };

