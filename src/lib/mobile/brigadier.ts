import { db } from "@/lib/db";
import { myBrigades } from "@/lib/brigades";
import {
  BRIGADE_ISSUE, ISSUE_KINDS, brigadeMembers, buildShiftReport, canResolveIssue, dayPlan, isLate, shiftOf, taskPhase, type ShiftReport,
} from "@/lib/brigade-shift";
import { DEFECT_REASONS } from "@/lib/production-day";
import { markOf, today } from "@/lib/davomat";
import { unitLabel } from "@/lib/unit";
import { faceCheckEnabled } from "@/lib/ai/face";
import { day, inUnit, num, pctText, sum, time, totalsText } from "./fmt";
import { ListError, type MobileList } from "./list";
import type { MobileUser } from "./auth";
import type { DetailAction, DetailField, FormField, MobileDetail } from "./detail";
import type { HomeCard, HomeRow, HomeSection, Tone } from "./home";
import type { BrigadeIssueKind, Prisma, Role } from "@/generated/prisma";

/**
 * Brigadir ish joyi (ECO ilova) — "Brigadir Dashboard" hujjati bo'yicha.
 *
 * Bosh ekran: KPI (`dashboard.ts` → `brigadier`) + shu fayldagi smena kartasi va bo'limlar
 * (ogohlantirishlar, brigada xodimlari, faol topshiriqlar, uskunalar, smena hisobotlari).
 * Kartochkalar:
 *   · `brig-shift/b~<brigadeId>` — bugungi smena: smenani boshlash, davomat, muammo, brak, yopish;
 *   · `brig-shift/<shiftId>` — yopilgan smenaning muzlatilgan hisoboti;
 *   · `brig-issue/<id>` — bitta muammo: mas'ul bo'lim (yoki brigadir) hal qiladi.
 * Qoidalar `lib/brigade-shift.ts` da, amallar ijrosi `actions.ts` da.
 */

export const TODAY_PREFIX = "b~";
const f = (label: string, value: string, tone?: Tone): DetailField => ({ label, value, tone });
const section = (title: string, rows: HomeRow[], opts: { empty?: string; target?: string; icon?: string } = {}): HomeSection =>
  ({ title, rows, empty: opts.empty ?? "Ma'lumot yo'q", target: opts.target, icon: opts.icon });
const minText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} soat${m % 60 ? ` ${m % 60} daq` : ""}` : `${m} daq`);
const ATT_TONE: Record<string, Tone> = { PRESENT: "success", ABSENT: "danger", SICK: "warning", LEAVE: "info", DAYOFF: "info" };

/** Brigadirning brigadalari id'lari; boshqa rol uchun null (cheklov yo'q). */
export async function ownBrigadeIds(user: MobileUser): Promise<string[] | null> {
  return user.role === "BRIGADIER" ? (await myBrigades(user.id)).map((b) => b.id) : null;
}
async function assertBrigade(user: MobileUser, brigadeId: string) {
  const own = await ownBrigadeIds(user);
  if (own && !own.includes(brigadeId)) throw new ListError("NOT_FOUND", "Brigada topilmadi", 404);
}

// ───────────────────────── Formalar ─────────────────────────

const noteField = (label = "Izoh", required = false, placeholder?: string): FormField => ({ name: "note", label, type: "text", required, placeholder });
const downtimeField: FormField = { name: "downtimeMin", label: "To'xtab qolgan vaqt (daqiqa)", type: "number", placeholder: "masalan 45", hint: "bilmasangiz bo'sh qoldiring — hal bo'lganda yoziladi" };
type TaskOpt = { id: string; taskNo: string; product: string };
const taskField = (tasks: TaskOpt[]): FormField[] => tasks.length
  ? [{ name: "taskId", label: "Qaysi topshiriq", type: "select", value: "", options: [{ value: "", label: "— umumiy (topshiriqqa bog'lanmagan) —" }, ...tasks.map((t) => ({ value: t.id, label: `${t.taskNo} · ${t.product}` }))] }]
  : [];

/**
 * Muammo tugmalari — hujjatdagi alohida amallar: uskuna, material, qo'shimcha ishchi, boshqa.
 * `tasks` — smena kartasida topshiriq tanlovi; topshiriq kartasida null (kartaning id'si o'zi topshiriq).
 */
export function issueActions(tasks: TaskOpt[] | null): DetailAction[] {
  const t = tasks ? taskField(tasks) : [];
  return [
    { id: "issue.equipment", label: "Uskuna muammosi", tone: "danger", form: [
      { name: "equipment", label: "Uskuna", type: "text", required: true, placeholder: "masalan: vibrostol, beton aralashtirgich" }, ...t, downtimeField, noteField("Nosozlik sababi", true),
    ] },
    { id: "issue.material", label: "Material yetishmayapti", tone: "warning", form: [
      ...t, noteField("Qaysi material, qancha kerak", true, "masalan: armatura 12 mm — 200 kg"),
    ] },
    { id: "issue.staff", label: "Qo'shimcha ishchi so'rash", tone: "brand", form: [
      { name: "qty", label: "Nechta ishchi kerak", type: "number", required: true, value: "1" }, ...t, noteField("Nima uchun", true, "ish hajmi, kelmagan xodim o'rniga..."),
    ] },
    { id: "issue.other", label: "Boshqa muammo", tone: "warning", form: [
      { name: "kind", label: "Muammo turi", type: "select", required: true, value: "DELAY", options: (["DELAY", "QUALITY", "OTHER"] as BrigadeIssueKind[]).map((k) => ({ value: k, label: BRIGADE_ISSUE[k].label })) },
      ...t, downtimeField, noteField("Tavsif", true),
    ] },
  ];
}

/** Brak qayd qilish formasi. `products` — tanlov (topshiriq kartasida bittasi, oldindan tanlangan). */
export function defectAction(id: string, products: { id: string; name: string; unit: string }[]): DetailAction {
  return {
    id, label: "Brakni qayd qilish", tone: "danger",
    form: [
      { name: "productId", label: "Mahsulot", type: "select", required: true, value: products.length === 1 ? products[0]!.id : "", options: products.map((p) => ({ value: p.id, label: `${p.name} (${unitLabel(p.unit)})` })) },
      { name: "qty", label: "Brak miqdori", type: "number", required: true },
      { name: "reason", label: "Sababi", type: "select", required: true, value: DEFECT_REASONS[0], options: DEFECT_REASONS.map((r) => ({ value: r, label: r })) },
      noteField(),
    ],
  };
}

// ───────────────────────── Bosh ekran ─────────────────────────

/** Brigadir bosh ekranidagi smena kartasi va bo'limlar (KPI va diagrammalar — `dashboard.ts`). */
export async function brigadierHome(user: MobileUser): Promise<{ cards: HomeCard[]; sections: HomeSection[] }> {
  const mine = await myBrigades(user.id);
  if (!mine.length) {
    return { cards: [{ key: "nobrigade", label: "Brigada biriktirilmagan", value: "—", hint: "Ishlab chiqarish yoki Otdel kadrga ayting", tone: "danger", icon: "alert-circle" }], sections: [] };
  }
  const ids = mine.map((b) => b.id);
  const many = mine.length > 1;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const month = new Date(start); month.setDate(month.getDate() - 30);
  const [shifts, members, open, issues, equipment, reports, defectsToday, plan] = await Promise.all([
    Promise.all(mine.map((b) => shiftOf(b.id))),
    Promise.all(mine.map((b) => brigadeMembers(b.id))),
    db.brigadeTask.findMany({
      where: { brigadeId: { in: ids }, status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, take: 30,
      include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } }, issues: { where: { resolvedAt: null }, select: { kind: true } } },
    }),
    db.brigadeIssue.findMany({ where: { brigadeId: { in: ids }, resolvedAt: null }, orderBy: { createdAt: "desc" }, include: { task: { select: { taskNo: true } } } }),
    db.brigadeIssue.findMany({ where: { brigadeId: { in: ids }, kind: "EQUIPMENT", createdAt: { gte: month } }, orderBy: { createdAt: "desc" }, select: { id: true, equipment: true, resolvedAt: true, createdAt: true, downtimeMin: true, note: true } }),
    db.brigadeShift.findMany({ where: { brigadeId: { in: ids }, closedAt: { not: null } }, orderBy: { date: "desc" }, take: 7, select: { id: true, date: true, summary: true, closedAt: true, brigade: { select: { name: true } } } }),
    db.productDefect.findMany({ where: { brigadeId: { in: ids }, date: { gte: start } }, select: { qty: true, product: { select: { unit: true } } } }),
    dayPlan(ids),
  ]);

  // ── Smena holati (hujjatdagi A blok) — har brigadaga bitta karta, bosilsa smena kartochkasi ──
  const cards: HomeCard[] = mine.map((b, i) => {
    const s = shifts[i], m = members[i]!;
    const present = m.filter((x) => x.status === "PRESENT").length;
    const state = !s ? "Ochilmagan" : s.closedAt ? `Yopildi ${time(s.closedAt)}` : `Ochiq · ${time(s.openedAt)} dan`;
    return {
      key: `shift-${b.id}`, label: many ? `Smena — ${b.name}` : "Smena holati", value: state,
      hint: `${present}/${m.length} xodim keldi${s && !s.closedAt ? " · yopish uchun bosing" : !s ? " · boshlash uchun bosing" : ""}`,
      tone: !s ? "warning" : s.closedAt ? "success" : "brand", icon: "clock", open: { key: "brig-shift", id: `${TODAY_PREFIX}${b.id}` },
    };
  });

  // ── Muammolar / ogohlantirishlar (F blok va "Bildirishnomalar" bo'limi — ilova ochilganda) ──
  // Qatorlar har xil kartochkani ochadi — id'da kalit: `tasks:<id>`, `brig-issue:<id>` (`splitRef`)
  const alerts: HomeRow[] = [];
  for (const t of open) {
    const ph = taskPhase(t, t.issues.map((x) => x.kind));
    if (ph.late) alerts.push({ id: `tasks:${t.id}`, title: `Kechikmoqda — ${t.taskNo}`, subtitle: `${t.orderItem.product.name} · muddat ${day(t.dueDate)}`, right: inUnit(sum(t.qty) - sum(t.doneQty), t.orderItem.product.unit), tone: "danger" });
    else if (t.order.isUrgent && t.status === "NEW" && !t.startedAt) alerts.push({ id: `tasks:${t.id}`, title: `Shoshilinch — ${t.taskNo}`, subtitle: `${t.orderItem.product.name} · muddat ${day(t.dueDate)}`, right: inUnit(sum(t.qty), t.orderItem.product.unit), tone: "warning" });
  }
  for (const i of issues) {
    alerts.push({ id: `brig-issue:${i.id}`, title: BRIGADE_ISSUE[i.kind].label, subtitle: [i.equipment, i.task?.taskNo, i.note].filter(Boolean).join(" · "), right: `${day(i.createdAt)} ${time(i.createdAt)}`, tone: i.kind === "EQUIPMENT" || i.kind === "MATERIAL" ? "danger" : "warning" });
  }
  const hour = new Date().getHours();
  const main = plan.units[0];
  if (main && main.plan > 0 && hour >= 13 && main.fact / main.plan < 0.5) {
    alerts.push({ id: `brig-shift:${TODAY_PREFIX}${ids[0]}`, title: "Reja bajarilishi past", subtitle: `soat ${hour}:00 — fakt ${inUnit(main.fact, main.unit)} / reja ${inUnit(main.plan, main.unit)}`, right: pctText((main.fact / main.plan) * 100), tone: "warning" });
  }
  const absent = members.flat().filter((m) => m.status === "ABSENT");
  if (absent.length) alerts.push({ id: `sex-emp:${absent[0]!.id}`, title: `Smenaga kelmadi — ${absent.length} kishi`, subtitle: absent.map((m) => m.fullName).join(", "), tone: "danger" });
  const defTotal = defectsToday.reduce((s, d) => s + sum(d.qty), 0);
  if (main && main.fact > 0 && defTotal / main.fact > 0.05) alerts.push({ id: `brig-shift:${TODAY_PREFIX}${ids[0]}`, title: "Brak ko'paydi", subtitle: `bugun brak ${totalsText(defectsToday.map((d) => ({ unit: d.product.unit, qty: d.qty })))}`, right: pctText((defTotal / main.fact) * 100), tone: "danger" });

  // ── Brigada xodimlari (C blok) — bosilsa davomat kartochkasi ──
  const staffRows: HomeRow[] = members.flat().map((m) => {
    const late = isLate(m);
    return {
      id: m.id, title: m.fullName, subtitle: [m.position, many ? m.brigade : null, m.leads ? "brigadir" : null].filter(Boolean).join(" · "),
      right: m.status ? `${late ? "Kechikdi" : markOf(m.status).label}${m.status === "PRESENT" && m.checkIn ? ` ${m.checkIn}${m.checkOut ? `–${m.checkOut}` : ""}` : ""}` : "belgilanmagan",
      tone: !m.status ? "warning" : late ? "warning" : ATT_TONE[m.status],
    };
  });

  // ── Uskunalar (D blok): oxirgi 30 kunda qayd qilingan har uskunaning so'nggi holati ──
  const seen = new Map<string, (typeof equipment)[number] & { down: number; count: number }>();
  for (const e of equipment) {
    const k = (e.equipment ?? "—").trim().toLowerCase();
    const cur = seen.get(k);
    if (cur) { cur.down += e.downtimeMin ?? 0; cur.count += 1; if (!e.resolvedAt && cur.resolvedAt) Object.assign(cur, { ...e, down: cur.down, count: cur.count }); }
    else seen.set(k, { ...e, down: e.downtimeMin ?? 0, count: 1 });
  }
  const equipRows: HomeRow[] = [...seen.values()].map((e) => ({
    id: e.id, title: e.equipment ?? "—",
    subtitle: e.resolvedAt ? `ishlayapti · ${e.count} marta to'xtagan (30 kun)` : `to'xtagan ${day(e.createdAt)} ${time(e.createdAt)} · ${e.note} · texnik xizmat kerak`,
    right: e.down ? minText(e.down) : undefined, status: e.resolvedAt ? "Ishlayapti" : "To'xtagan", tone: e.resolvedAt ? "success" : "danger",
  }));

  const sections: HomeSection[] = [
    section("Muammolar va ogohlantirishlar", alerts, { empty: "Hammasi joyida — ochiq muammo yo'q", target: "tasks", icon: "triangle-alert" }),
    section(many ? "Brigada xodimlari" : `Brigada xodimlari — ${mine[0]!.name}`, staffRows, { empty: "Brigadaga xodim taqsimlanmagan — direktorga ayting", target: "sex-emp", icon: "users" }),
    section("Faol topshiriqlar", open.map((t) => {
      const ph = taskPhase(t, t.issues.map((x) => x.kind));
      const left = sum(t.qty) - sum(t.doneQty);
      return {
        id: t.id, title: `${t.taskNo} · ${t.orderItem.product.name}`,
        subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)} · ${Math.round((sum(t.doneQty) / (sum(t.qty) || 1)) * 100)}% bajarildi${many ? ` · ${t.brigade.name}` : ""}`,
        right: `${inUnit(left, t.orderItem.product.unit)} qoldi`, status: ph.label, tone: ph.tone,
      };
    }), { empty: "Ochiq topshiriq yo'q — brigadangizga tayinlansa shu yerda chiqadi", target: "tasks", icon: "list" }),
    section("Uskunalar holati", equipRows, { empty: "Uskuna nosozligi qayd qilinmagan (30 kun)", target: "brig-issue", icon: "wrench" }),
    section("Smena hisobotlari", reports.map((r) => ({ id: r.id, title: `${day(r.date)}${many ? ` · ${r.brigade.name}` : ""}`, subtitle: r.summary ?? undefined, right: r.closedAt ? time(r.closedAt) : undefined, tone: "success" as Tone })), { empty: "Hali smena yopilmagan", target: "brig-shift", icon: "clipboard-check" }),
  ];
  return { cards, sections };
}

// ───────────────────────── Smena kartochkasi ─────────────────────────

export async function brigShiftDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  if (id.startsWith(TODAY_PREFIX)) return todayShift(user, id.slice(TODAY_PREFIX.length));
  const s = await db.brigadeShift.findUnique({ where: { id }, include: { brigade: { select: { name: true } }, openedBy: { select: { fullName: true } }, closedBy: { select: { fullName: true } } } });
  if (!s) throw new ListError("NOT_FOUND", "Smena topilmadi", 404);
  await assertBrigade(user, s.brigadeId);
  // Yopilmagan smena — bugungi jonli ko'rinish
  if (!s.closedAt || !s.report) return todayShift(user, s.brigadeId);
  // Ishlab chiqarish birinchi ochganda "ko'rildi"
  if (!s.seenAt && (user.role === "PRODUCTION" || user.role === "SUPERVISOR")) await db.brigadeShift.update({ where: { id }, data: { seenAt: new Date() } });
  const r = s.report as unknown as ShiftReport;
  return {
    key: "brig-shift", id, title: `Smena hisoboti — ${day(s.date)}`, subtitle: r.brigade, status: "Yopilgan",
    fields: reportFields(r, s.closedBy?.fullName ?? null),
    sections: reportSections(r),
    actions: [],
  };
}

function reportFields(r: ShiftReport, closedBy: string | null): DetailField[] {
  const main = r.totals[0];
  return [
    f("Brigadir", r.leader ?? "—"),
    f("Smena", `${time(new Date(r.openedAt))} – ${time(new Date(r.closedAt))}`),
    f("Ish vaqti", minText(r.workMin)),
    f("To'xtab qolish", r.downtimeMin ? minText(r.downtimeMin) : "yo'q", r.downtimeMin ? "warning" : "success"),
    ...r.totals.map((t) => f(`Reja / fakt (${unitLabel(t.unit)})`, `${num(t.plan)} / ${num(t.fact)} · ${pctText(t.plan ? (t.fact / t.plan) * 100 : null)}`, t.plan && t.fact / t.plan >= 0.9 ? "success" : "warning")),
    ...(main ? [] : [f("Reja / fakt", "topshiriq bo'lmagan")]),
    f("Davomat", `${r.staff.present}/${r.staff.total} keldi${r.staff.late ? ` · ${r.staff.late} kechikdi` : ""}${r.staff.absent ? ` · ${r.staff.absent} kelmadi` : ""}`, r.staff.absent ? "danger" : "success"),
    f("Brak", r.defects.length ? totalsText(r.defects.map((d) => ({ unit: d.unit, qty: d.qty }))) : "yo'q", r.defects.length ? "warning" : "success"),
    ...(closedBy ? [f("Yopdi", closedBy)] : []),
    ...(r.note ? [f("Brigadir izohi", r.note)] : []),
  ];
}

function reportSections(r: ShiftReport): HomeSection[] {
  return [
    section("Topshiriqlar: reja va fakt", r.tasks.map((t, i) => ({
      id: `t${i}`, title: `${t.taskNo} · ${t.product}`, subtitle: `reja ${inUnit(t.plan, t.unit)} · fakt ${inUnit(t.fact, t.unit)}${t.late ? " · kechikkan" : ""}${t.reason ? ` · ${t.reason}` : ""}`,
      right: t.phase, tone: t.late ? "danger" : t.fact >= t.plan && t.plan > 0 ? "success" : "warning",
    })), { empty: "Topshiriq bo'lmagan", icon: "list" }),
    section("Muammolar", r.issues.map((x, i) => ({ id: `i${i}`, title: x.kind, subtitle: [x.equipment, x.note, x.downtimeMin ? `to'xtash ${minText(x.downtimeMin)}` : null].filter(Boolean).join(" · "), right: x.resolved ? "hal qilindi" : "ochiq", tone: x.resolved ? "success" : "danger" })), { empty: "Muammo bo'lmadi", icon: "triangle-alert" }),
    section("Brak", r.defects.map((d, i) => ({ id: `d${i}`, title: d.product, subtitle: d.reason, right: inUnit(d.qty, d.unit), tone: "warning" })), { empty: "Brak qayd qilinmagan", icon: "shield-check" }),
    section("Davomat", r.staff.rows.map((m, i) => ({ id: `s${i}`, title: m.name, subtitle: m.position, right: `${m.mark}${m.checkIn ? ` ${m.checkIn}${m.checkOut ? `–${m.checkOut}` : ""}` : ""}`, tone: m.mark === "Keldi" ? "success" : m.mark === "belgilanmagan" ? "warning" : "danger" })), { empty: "Brigadada xodim yo'q", icon: "users" }),
  ];
}

async function todayShift(user: MobileUser, brigadeId: string): Promise<MobileDetail> {
  await assertBrigade(user, brigadeId);
  const b = await db.brigade.findUnique({ where: { id: brigadeId }, select: { id: true, name: true, leader: { select: { fullName: true } } } });
  if (!b) throw new ListError("NOT_FOUND", "Brigada topilmadi", 404);
  const s = await shiftOf(brigadeId);
  // Yopilgan bo'lsa — muzlatilgan hisobot
  if (s?.closedAt && s.report) return brigShiftDetail(user, s.id);
  const now = new Date();
  const r = await buildShiftReport(brigadeId, today(), s?.openedAt ?? now, now, null);
  const open = await db.brigadeTask.findMany({ where: { brigadeId, status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, select: { id: true, taskNo: true, orderItem: { select: { product: { select: { id: true, name: true, unit: true } } } } } });
  const members = await brigadeMembers(brigadeId);
  const mine = user.role === "BRIGADIER";

  const actions: DetailAction[] = [];
  if (mine) {
    if (!s) actions.push({ id: "shift.open", label: "Smenani boshlash", tone: "success", confirm: `${b.name} — bugungi smena ochilsinmi? Ochilgan vaqt ish vaqtining boshi hisoblanadi.` });
    // Yuz tekshiruvi yoqiq bo'lsa hammani birdan "Keldi" qilib bo'lmaydi — har biri yuz bilan
    if (members.some((m) => !m.status) && !faceCheckEnabled()) actions.push({ id: "att.all", label: "Belgilanmaganlar — hammasi keldi", tone: "success", confirm: "Belgilanmagan brigada a'zolari \"Keldi\" deb belgilansinmi?" });
    actions.push(...issueActions(open.map((t) => ({ id: t.id, taskNo: t.taskNo, product: t.orderItem.product.name }))));
    const products = [...new Map(open.map((t) => [t.orderItem.product.id, t.orderItem.product])).values()];
    if (products.length) actions.push(defectAction("shift.defect", products));
    if (s) actions.push({ id: "shift.close", label: "Smenani yopish va hisobot yuborish", tone: "brand", form: [noteField("Brigadir izohi", false, "kechikish sabablari, ertangi reja...")] });
  }
  return {
    key: "brig-shift", id: `${TODAY_PREFIX}${brigadeId}`, title: `Smena — ${day(now)}`, subtitle: b.name,
    status: s ? "Ochiq" : "Ochilmagan",
    fields: [
      f("Smena", s ? `ochildi ${time(s.openedAt)}` : "hali boshlanmagan", s ? "success" : "warning"),
      f("Boshlanish", s ? time(s.openedAt) : "—"),
      f("Tugash", "ochiq"),
      f("Brigadir", b.leader?.fullName ?? "—"),
      f("Faol xodimlar", `${r.staff.present}/${r.staff.total}${r.staff.late ? ` · ${r.staff.late} kechikdi` : ""}${r.staff.notMarked ? ` · ${r.staff.notMarked} belgilanmagan` : ""}`, r.staff.notMarked || r.staff.absent ? "warning" : "success"),
      ...r.totals.map((t) => f(`Reja / fakt (${unitLabel(t.unit)})`, `${num(t.plan)} / ${num(t.fact)} · ${pctText(t.plan ? (t.fact / t.plan) * 100 : null)}`)),
      ...(r.downtimeMin ? [f("To'xtab qolish", minText(r.downtimeMin), "warning")] : []),
    ],
    sections: [
      section("Brigada tarkibi", members.map((m) => ({
        id: m.id, title: m.fullName, subtitle: m.position,
        right: m.status ? `${isLate(m) ? "Kechikdi" : markOf(m.status).label}${m.checkIn ? ` ${m.checkIn}${m.checkOut ? `–${m.checkOut}` : ""}` : ""}` : "belgilanmagan",
        tone: !m.status || isLate(m) ? "warning" : ATT_TONE[m.status],
      })), { empty: "Brigadaga xodim taqsimlanmagan", target: "sex-emp", icon: "users" }),
      section("Kunlik topshiriqlar", (await dayPlan([brigadeId])).rows.map((t) => {
        const ph = taskPhase(t);
        return { id: t.id, title: `${t.taskNo} · ${t.product}`, subtitle: `reja ${inUnit(t.plan, t.unit)} · fakt ${inUnit(t.fact, t.unit)} · muddat ${day(t.dueDate)}`, right: ph.label, tone: ph.tone };
      }), { empty: "Bugunga topshiriq yo'q", target: "tasks", icon: "list" }),
      ...reportSections(r).slice(1, 3),
    ],
    actions,
  };
}

// ───────────────────────── Muammo kartochkasi ─────────────────────────

export async function brigIssueDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const i = await db.brigadeIssue.findUnique({
    where: { id },
    include: { brigade: { select: { name: true } }, task: { select: { id: true, taskNo: true, orderItem: { select: { product: { select: { name: true } } } } } }, createdBy: { select: { fullName: true } }, resolvedBy: { select: { fullName: true } } },
  });
  if (!i) throw new ListError("NOT_FOUND", "Muammo topilmadi", 404);
  await assertBrigade(user, i.brigadeId);
  const meta = BRIGADE_ISSUE[i.kind];
  const actions: DetailAction[] = [];
  if (!i.resolvedAt && canResolveIssue(user.role, i.kind)) {
    actions.push({
      id: "issue.resolve", label: "Hal qilindi", tone: "success",
      form: [
        { name: "resolution", label: "Qanday hal qilindi", type: "text", required: true, placeholder: i.kind === "MATERIAL" ? "material berildi, 200 kg" : i.kind === "EQUIPMENT" ? "ta'mirlandi, ishlayapti" : "" },
        ...(i.kind === "EQUIPMENT" || i.kind === "DELAY" ? [{ ...downtimeField, label: "Jami to'xtash vaqti (daqiqa)", value: i.downtimeMin != null ? String(i.downtimeMin) : String(Math.round((Date.now() - i.createdAt.getTime()) / 60_000)), hint: undefined }] : []),
      ],
    });
  }
  return {
    key: "brig-issue", id, title: meta.label, subtitle: `${i.brigade.name} · ${day(i.createdAt)} ${time(i.createdAt)}`,
    status: i.resolvedAt ? "Hal qilindi" : "Ochiq",
    fields: [
      f("Holat", i.resolvedAt ? `hal qilindi ${day(i.resolvedAt)} ${time(i.resolvedAt)}` : "ochiq", i.resolvedAt ? "success" : "danger"),
      ...(i.equipment ? [f("Uskuna", i.equipment)] : []),
      ...(i.kind === "STAFF" && i.qty ? [f("Kerakli ishchi", `${num(sum(i.qty))} kishi`, "warning")] : []),
      ...(i.task ? [f("Topshiriq", `${i.task.taskNo} · ${i.task.orderItem.product.name}`)] : []),
      f("Tavsif", i.note),
      ...(i.downtimeMin != null ? [f("To'xtash vaqti", minText(i.downtimeMin), "warning")] : []),
      f("Bildirdi", i.createdBy.fullName),
      f("Mas'ul", meta.owner.map((r) => ROLE_NAME[r] ?? r).join(", ")),
      ...(i.resolvedAt ? [f("Hal qildi", i.resolvedBy?.fullName ?? "—"), f("Yechim", i.resolution ?? "—")] : []),
    ],
    sections: [],
    actions,
  };
}
const ROLE_NAME: Partial<Record<Role, string>> = { PRODUCTION: "Ishlab chiqarish", SUPERVISOR: "Ish boshqaruvchi", WAREHOUSE: "Sklad", PROCUREMENT: "Snabjeniye", HR: "Otdel kadr" };

// ───────────────────────── Ro'yxatlar ─────────────────────────

/** Rol qaysi muammolarni ko'radi: brigadir — o'z brigadasiniki, bo'limlar — o'zi mas'ul turlar. */
async function issueScope(user: MobileUser): Promise<Prisma.BrigadeIssueWhereInput> {
  const own = await ownBrigadeIds(user);
  if (own) return { brigadeId: { in: own } };
  if (user.role === "DIRECTOR") return {};
  return { kind: { in: ISSUE_KINDS.filter((k) => BRIGADE_ISSUE[k].owner.includes(user.role)) } };
}

const ISSUE_FILTERS = [{ key: "open", label: "Ochiq" }, { key: "done", label: "Hal qilingan" }, { key: "all", label: "Hammasi" }] as const;

export async function brigIssuesList(user: MobileUser, title: string, q?: string, filter?: string): Promise<MobileList> {
  const scope = await issueScope(user);
  const key = ISSUE_FILTERS.some((x) => x.key === filter) ? filter! : "open";
  const where = (k: string): Prisma.BrigadeIssueWhereInput => ({
    ...scope,
    ...(k === "open" ? { resolvedAt: null } : k === "done" ? { resolvedAt: { not: null } } : {}),
    ...(q ? { OR: [{ note: { contains: q, mode: "insensitive" } }, { equipment: { contains: q, mode: "insensitive" } }, { brigade: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  });
  const [rows, counts] = await Promise.all([
    db.brigadeIssue.findMany({ where: where(key), orderBy: { createdAt: "desc" }, take: 60, include: { brigade: { select: { name: true } }, task: { select: { taskNo: true } } } }),
    Promise.all(ISSUE_FILTERS.map((x) => db.brigadeIssue.count({ where: where(x.key) }))),
  ]);
  return {
    key: "brig-issues", title,
    rows: rows.map((i) => ({
      id: i.id, title: `${BRIGADE_ISSUE[i.kind].label} · ${i.brigade.name}`,
      subtitle: [i.equipment, i.task?.taskNo, i.note].filter(Boolean).join(" · "),
      right: `${day(i.createdAt)} ${time(i.createdAt)}`, status: i.resolvedAt ? "Hal qilindi" : "Ochiq", tone: i.resolvedAt ? "success" : "danger",
    })),
    filters: ISSUE_FILTERS.map((x, n) => ({ key: x.key, label: x.label, count: counts[n]!, active: x.key === key })),
  };
}

export async function brigShiftsList(user: MobileUser, title: string, q?: string): Promise<MobileList> {
  const own = await ownBrigadeIds(user);
  const rows = await db.brigadeShift.findMany({
    where: { ...(own ? { brigadeId: { in: own } } : {}), ...(q ? { brigade: { name: { contains: q, mode: "insensitive" } } } : {}) },
    orderBy: [{ date: "desc" }, { openedAt: "desc" }], take: 60,
    select: { id: true, date: true, openedAt: true, closedAt: true, summary: true, seenAt: true, brigade: { select: { name: true } } },
  });
  return {
    key: "brig-shifts", title,
    rows: rows.map((s) => ({
      id: s.id, title: `${day(s.date)} · ${s.brigade.name}`,
      subtitle: s.summary ?? `ochildi ${time(s.openedAt)} — hali yopilmagan`,
      right: s.closedAt ? `${time(s.openedAt)}–${time(s.closedAt)}` : "ochiq",
      status: s.closedAt ? (s.seenAt || own ? "Yopilgan" : "Yangi hisobot") : "Ochiq", tone: s.closedAt ? (s.seenAt || own ? "success" : "brand") : "warning",
    })),
  };
}

/** Brigadir topshiriqlari — hujjatdagi status bo'yicha filtr chiplari bilan. */
const TASK_FILTERS = [
  { key: "open", label: "Ochiq" }, { key: "work", label: "Jarayonda" }, { key: "late", label: "Kechikkan" },
  { key: "blocked", label: "Muammoli" }, { key: "done", label: "Bajarilgan" }, { key: "all", label: "Hammasi" },
] as const;

export async function brigTasksList(title: string, brigadeIds: string[], q?: string, filter?: string): Promise<MobileList> {
  const list = await db.brigadeTask.findMany({
    where: {
      brigadeId: { in: brigadeIds },
      ...(q ? { OR: [{ taskNo: { contains: q, mode: "insensitive" } }, { orderItem: { product: { name: { contains: q, mode: "insensitive" } } } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : {}),
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 200,
    include: { order: { include: { customer: true } }, orderItem: { include: { product: true } }, issues: { where: { resolvedAt: null }, select: { kind: true } } },
  });
  const rows = list.map((t) => ({ t, ph: taskPhase(t, t.issues.map((i) => i.kind)), open: t.status === "NEW" || t.status === "IN_PROGRESS" }));
  const test: Record<string, (x: (typeof rows)[number]) => boolean> = {
    open: (x) => x.open, work: (x) => x.open && (!!x.t.startedAt || x.t.status === "IN_PROGRESS"), late: (x) => x.ph.late,
    blocked: (x) => x.open && x.t.issues.length > 0, done: (x) => x.t.status === "DONE", all: () => true,
  };
  const key = filter && filter in test ? filter : "open";
  return {
    key: "tasks", title,
    rows: rows.filter(test[key]!).slice(0, 60).map(({ t, ph }) => ({
      id: t.id, title: `${t.taskNo} · ${t.orderItem.product.name}`,
      subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}${t.order.isUrgent ? " · shoshilinch" : ""}`,
      right: `${num(sum(t.qty) - sum(t.doneQty))} / ${num(sum(t.qty))} ${unitLabel(t.orderItem.product.unit)}`,
      status: ph.label, tone: ph.tone,
    })),
    filters: TASK_FILTERS.map((x) => ({ key: x.key, label: x.label, count: rows.filter(test[x.key]!).length, active: x.key === key })),
  };
}
