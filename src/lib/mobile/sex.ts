import { db } from "@/lib/db";
import { ATTENDANCE_MARKS, dayUtc, isoDay, markOf, today } from "@/lib/davomat";
import { productionDay } from "@/lib/production-day";
import { productionStaff, UNASSIGNED, type StaffMember } from "@/lib/production-staff";
import { buildReport, loadReport, reportHistory, reportSummary, stockHighlights, stockStatus, STOCK_LEVEL_LABEL, type ReportSnapshot } from "@/lib/production-report";
import { unitLabel } from "@/lib/unit";
import { myBrigades } from "@/lib/brigades";
import { day, inUnit, num, pctText, sum, time, totalsText } from "./fmt";
import { dashRange, type DashRange } from "./dashboard";
import { ListError } from "./list";
import type { MobileUser } from "./auth";
import type { DetailAction, DetailField, MobileDetail } from "./detail";
import type { HomeRow, HomeSection, Tone } from "./home";

/**
 * Mobil "Sex" (ishlab chiqarish bosh ekrani) — statistika kartalari bosilganda ochiladigan batafsil
 * kartochkalar. Kalitlar:
 *   · `sex/<stat>.<davr>` — produced, plan, defect, brigades, shifts, staff, attendance, stock, report;
 *     davr bosh ekrandagi filtr bilan bir xil (`day`, `week`, `month`, `year`, `custom~YYYY-MM-DD~YYYY-MM-DD`);
 *   · `sex-emp/<employeeId>` — bitta sex xodimi: davomat tugmalari (Keldi / Ketdi / Kelmadi ...);
 *   · `prod-report/<id>` — qayd etilgan kunlik hisobot (direktor ham ochadi).
 * Raqamlar veb bilan bir manbadan: `production-day.ts`, `production-staff.ts`, `production-report.ts`.
 */

/** Sex kartochkalarini ochadigan rollar (direktor har doim). */
export const SEX_ROLES = ["PRODUCTION", "SUPERVISOR"] as const;
const canWork = (u: MobileUser) => (SEX_ROLES as readonly string[]).includes(u.role);

/** Bosh ekrandagi davr → kartochka id'si ichidagi qism. */
export const periodId = (r: DashRange) => (r.key === "custom" && r.range ? `custom~${r.range.from}~${r.range.to}` : r.key);
const parsePeriod = (p?: string) => { const [period, from, to] = (p ?? "month").split("~"); return dashRange({ period, from, to }); };

const f = (label: string, value: string, tone?: Tone): DetailField => ({ label, value, tone });
const section = (title: string, rows: HomeRow[], opts: { empty?: string; target?: string; icon?: string } = {}): HomeSection =>
  ({ title, rows, empty: opts.empty ?? "Ma'lumot yo'q", target: opts.target, icon: opts.icon });
const hhmm = (d: Date) => time(d);
const STATUS_TONE: Record<string, Tone> = { PRESENT: "success", ABSENT: "danger", SICK: "warning", LEAVE: "info", DAYOFF: "info" };

/** Sex xodimi qatori: bosilsa — uning davomat kartochkasi. */
const staffRow = (m: StaffMember, withBrigade = false): HomeRow => {
  const mk = m.status ? markOf(m.status) : null;
  return {
    id: m.id, title: m.fullName,
    subtitle: [m.position, withBrigade ? m.brigade ?? UNASSIGNED : null, m.leads ? "brigadir" : null].filter(Boolean).join(" · "),
    right: mk ? `${mk.label}${m.status === "PRESENT" && m.checkIn ? ` ${m.checkIn}${m.checkOut ? `–${m.checkOut}` : ""}` : ""}` : "belgilanmagan",
    tone: m.status ? STATUS_TONE[m.status] : "warning",
  };
};

export async function sexDetail(user: MobileUser, rawId: string): Promise<MobileDetail> {
  const [stat, per] = rawId.split(".");
  const r = parsePeriod(per);
  switch (stat) {
    case "produced": return produced(r);
    case "shifts": return produced(r, true);
    case "plan": return plan();
    case "defect": return defects(r);
    case "brigades": return brigades(r);
    case "staff": return staff(user, false);
    case "attendance": return staff(user, true);
    case "stock": return stock();
    case "report": return report(user);
    default: throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
  }
}

// ───────────────────────── Ishlab chiqarildi / smenalar ─────────────────────────

async function produced(r: DashRange, byShift = false): Promise<MobileDetail> {
  const [batches, prev] = await Promise.all([
    db.productionBatch.findMany({
      where: { date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" },
      select: { id: true, batchNo: true, date: true, shift: true, qtyM3: true, product: { select: { name: true, unit: true } }, order: { select: { orderNo: true, customer: { select: { name: true } } } }, createdBy: { select: { fullName: true } } },
    }),
    db.productionBatch.findMany({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, select: { qtyM3: true, product: { select: { unit: true } } } }),
  ]);
  const rows = batches.map((b) => ({ unit: b.product.unit, qty: b.qtyM3 }));
  const group = <K extends string>(key: (b: (typeof batches)[number]) => K) => {
    const m = new Map<K, typeof batches>();
    for (const b of batches) m.set(key(b), [...(m.get(key(b)) ?? []), b]);
    return [...m];
  };
  const byProduct = group((b) => b.product.name).sort((a, b) => b[1].length - a[1].length);
  const shifts = group((b) => `${b.shift}-smena`).sort((a, b) => a[0].localeCompare(b[0]));
  const byDay = r.days > 1 ? group((b) => isoDay(new Date(b.date.getTime() - b.date.getTimezoneOffset() * 60000))).sort((a, b) => b[0].localeCompare(a[0])) : [];
  const total = (list: typeof batches) => totalsText(list.map((b) => ({ unit: b.product.unit, qty: b.qtyM3 })));

  const shiftSection = section("Smenalar bo'yicha", shifts.map(([k, list]) => ({ id: `sh-${k}`, title: k, subtitle: `${list.length} zames · ${[...new Set(list.map((b) => b.product.name))].slice(0, 3).join(", ")}`, right: total(list) })), { icon: "clock" });
  return {
    key: "sex", id: byShift ? "shifts" : "produced",
    title: byShift ? "Smenalar" : "Ishlab chiqarildi", subtitle: `Davr: ${r.label}`,
    fields: [
      f("Jami", totalsText(rows)),
      f("Zames soni", String(batches.length)),
      f("1-smena / 2-smena", `${batches.filter((b) => b.shift === 1).length} / ${batches.filter((b) => b.shift !== 1).length}`),
      f(`Oldingi davr (${r.prevName.replace(/dan$/, "")})`, totalsText(prev.map((b) => ({ unit: b.product.unit, qty: b.qtyM3 })))),
    ],
    sections: [
      ...(byShift ? [shiftSection] : []),
      section("Mahsulot bo'yicha", byProduct.map(([name, list]) => ({ id: `p-${name}`, title: name, subtitle: `${list.length} zames`, right: total(list) })), { icon: "package" }),
      ...(byShift ? [] : [shiftSection]),
      ...(byDay.length ? [section("Kunlar bo'yicha", byDay.map(([iso, list]) => ({ id: `d-${iso}`, title: iso.split("-").reverse().join("."), subtitle: `${list.length} zames`, right: total(list) })), { icon: "calendar" })] : []),
      section("Zameslar", batches.slice(0, 40).map((b) => ({
        id: b.id, title: `${b.batchNo} · ${b.product.name}`,
        subtitle: `${day(b.date)} ${hhmm(b.date)} · ${b.shift}-smena · ${b.order ? `${b.order.orderNo} ${b.order.customer.name}` : "Omborga"} · ${b.createdBy.fullName}`,
        right: inUnit(sum(b.qtyM3), b.product.unit),
      })), { target: "production", empty: "Bu davrda zames qayd qilinmagan" }),
    ],
    actions: [],
  };
}

// ───────────────────────── Plan ─────────────────────────

async function plan(): Promise<MobileDetail> {
  const d = await productionDay(today());
  const withPct = d.plan.rows.filter((p) => p.monthQty > 0);
  const avg = withPct.length ? withPct.reduce((s, p) => s + p.monthPct, 0) / withPct.length : null;
  const behind = d.plan.rows.filter((p) => p.behind > 0);
  const tone = (v: number): Tone => (v >= 90 ? "success" : v >= 60 ? "warning" : "danger");
  return {
    key: "sex", id: "plan", title: "Oylik plan", subtitle: `${d.plan.elapsed} / ${d.plan.workDays} ish kuni o'tdi · planni direktor belgilaydi`,
    fields: [
      f("O'rtacha bajarilish", pctText(avg), avg == null ? undefined : tone(avg)),
      f("Mahsulotlar", `${d.plan.rows.length} ta plan`),
      f("Plandan orqada", behind.length ? `${behind.length} mahsulot` : "yo'q", behind.length ? "danger" : "success"),
    ],
    sections: [
      section("Mahsulotlar — oy", d.plan.rows.map((p) => ({
        id: `m-${p.id}`, title: `${p.product.code} · ${p.product.name}`,
        subtitle: `fakt ${inUnit(p.factMonth, p.product.unit)} / plan ${inUnit(p.monthQty, p.product.unit)}${p.behind > 0 ? ` · orqada ${inUnit(p.behind, p.product.unit)}` : ""}`,
        right: pctText(p.monthPct), tone: p.behind > 0 ? "danger" : tone(p.monthPct),
      })), { empty: "Bu oyga plan belgilanmagan", icon: "square-check" }),
      section("Bugun — kunlik plan", d.plan.rows.map((p) => ({
        id: `d-${p.id}`, title: p.product.name,
        subtitle: `bugun ${inUnit(p.factDay, p.product.unit)} / ${inUnit(p.dayQty, p.product.unit)}${p.defectDay > 0 ? ` · brak ${inUnit(p.defectDay, p.product.unit)}` : ""}`,
        right: pctText(p.dayPct), tone: tone(p.dayPct),
      })), { empty: "Plan yo'q", icon: "target" }),
    ],
    actions: [],
  };
}

// ───────────────────────── Brak ─────────────────────────

async function defects(r: DashRange): Promise<MobileDetail> {
  const [list, made] = await Promise.all([
    db.productDefect.findMany({
      where: { date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" },
      select: { id: true, date: true, qty: true, reason: true, note: true, product: { select: { name: true, unit: true } }, brigade: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
    db.stockMove.findMany({ where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: r.from, lt: r.to } }, select: { qty: true, product: { select: { unit: true } } } }),
  ]);
  const rows = list.map((d) => ({ unit: d.product.unit, qty: d.qty }));
  const sumBy = (key: (d: (typeof list)[number]) => string) => {
    const m = new Map<string, typeof list>();
    for (const d of list) m.set(key(d), [...(m.get(key(d)) ?? []), d]);
    return [...m].sort((a, b) => b[1].length - a[1].length);
  };
  const madeTotal = totalsText(made.map((m) => ({ unit: m.product!.unit, qty: m.qty })));
  return {
    key: "sex", id: "defect", title: "Brak", subtitle: `Davr: ${r.label} · brak hovli qoldig'idan hisobdan chiqariladi`,
    fields: [
      f("Jami brak", totalsText(rows), list.length ? "danger" : "success"),
      f("Qaydlar", String(list.length)),
      f("Shu davrda ishlab chiqarildi", madeTotal),
    ],
    sections: [
      section("Sabablar", sumBy((d) => d.reason).map(([k, v]) => ({ id: `r-${k}`, title: k, subtitle: `${v.length} ta qayd`, right: totalsText(v.map((d) => ({ unit: d.product.unit, qty: d.qty }))), tone: "danger" as Tone })), { icon: "triangle-alert", empty: "Brak yo'q" }),
      section("Mahsulot bo'yicha", sumBy((d) => d.product.name).map(([k, v]) => ({ id: `p-${k}`, title: k, subtitle: `${v.length} ta qayd`, right: totalsText(v.map((d) => ({ unit: d.product.unit, qty: d.qty }))) })), { icon: "package", empty: "Brak yo'q" }),
      section("Qaydlar", list.slice(0, 40).map((d) => ({
        id: d.id, title: `${d.product.name} · ${d.reason}`,
        subtitle: `${day(d.date)} ${hhmm(d.date)} · ${d.brigade?.name ?? "brigada ko'rsatilmagan"} · ${d.createdBy.fullName}${d.note ? ` · ${d.note}` : ""}`,
        right: inUnit(sum(d.qty), d.product.unit), tone: "danger",
      })), { icon: "triangle-alert", empty: "Bu davrda brak qayd qilinmagan" }),
    ],
    actions: [],
  };
}

// ───────────────────────── Brigadalar ─────────────────────────

async function brigades(r: DashRange): Promise<MobileDetail> {
  const [list, progress, staff] = await Promise.all([
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leader: { select: { fullName: true } }, tasks: { where: { status: { in: ["NEW", "IN_PROGRESS"] } }, select: { dueDate: true } } } }),
    db.taskProgress.findMany({
      where: { date: { gte: r.from, lt: r.to } }, orderBy: { date: "desc" },
      select: { id: true, qty: true, date: true, createdBy: { select: { fullName: true } }, task: { select: { id: true, taskNo: true, brigadeId: true, orderItem: { select: { product: { select: { name: true, unit: true } } } } } } },
    }),
    productionStaff(),
  ]);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return {
    key: "sex", id: "brigades", title: "Brigadalar bajardi", subtitle: `Davr: ${r.label}`,
    fields: [
      f("Jami bajarildi", totalsText(progress.map((p) => ({ unit: p.task.orderItem.product.unit, qty: p.qty })))),
      f("Qaydlar", String(progress.length)),
      f("Faol brigadalar", String(list.length)),
    ],
    sections: [
      section("Brigadalar", list.map((b) => {
        const mine = progress.filter((p) => p.task.brigadeId === b.id);
        const g = staff.groups.find((x) => x.id === b.id);
        const overdue = b.tasks.filter((t) => t.dueDate < now).length;
        return {
          id: b.id, title: b.name,
          subtitle: `${b.leader?.fullName ?? "brigadir yo'q"} · ishda ${g?.present ?? 0}/${g?.total ?? 0} · ${b.tasks.length} ochiq${overdue ? `, ${overdue} kechikkan` : ""}`,
          right: mine.length ? totalsText(mine.map((p) => ({ unit: p.task.orderItem.product.unit, qty: p.qty }))) : "—",
          tone: overdue ? "danger" : mine.length ? "success" : undefined,
        };
      }), { target: "brigades", empty: "Faol brigada yo'q" }),
      section("Qaydlar", progress.slice(0, 40).map((p) => ({
        id: p.task.id, title: `${p.task.orderItem.product.name}`,
        subtitle: `${day(p.date)} ${hhmm(p.date)} · ${list.find((b) => b.id === p.task.brigadeId)?.name ?? "—"} · ${p.task.taskNo} · ${p.createdBy.fullName}`,
        right: inUnit(sum(p.qty), p.task.orderItem.product.unit),
      })), { target: "tasks", empty: "Bu davrda brigada qaydi yo'q" }),
    ],
    actions: [],
  };
}

// ───────────────────────── Xodimlar / davomat ─────────────────────────

const statusOptions = ATTENDANCE_MARKS.map((m) => ({ value: m.value, label: m.label }));

async function staff(user: MobileUser, attendanceView: boolean): Promise<MobileDetail> {
  const s = await productionStaff();
  const actions: DetailAction[] = [];
  if (attendanceView && canWork(user)) {
    if (s.notMarked) actions.push({ id: "att.all", label: `Hammasi keldi (${s.notMarked})`, tone: "success", confirm: `Belgilanmagan ${s.notMarked} kishi "Keldi" deb belgilansinmi? Kelgan vaqti — hozir.` });
    actions.push({
      id: "att.form", label: "Davomatni qayd etish", tone: "brand",
      form: [
        { name: "employeeId", label: "Xodim", type: "select", required: true, options: [...s.members].sort((a, b) => Number(!!a.status) - Number(!!b.status)).map((m) => ({ value: m.id, label: `${m.fullName}${m.status ? ` — ${markOf(m.status).label.toLowerCase()}` : ""}` })) },
        { name: "status", label: "Holat", type: "select", required: true, value: "PRESENT", options: statusOptions },
        { name: "checkIn", label: "Keldi (soat)", type: "time", placeholder: "hozir", showIf: { field: "status", equals: "PRESENT" }, hint: "Bo'sh qolsa — hozirgi vaqt" },
        { name: "checkOut", label: "Ketdi (soat)", type: "time", showIf: { field: "status", equals: "PRESENT" } },
        { name: "note", label: "Izoh", type: "text", placeholder: "ixtiyoriy" },
      ],
    });
  }
  const fields = [
    f("Sexda jami", `${s.total} kishi`),
    f("Ishga keldi", `${s.present} / ${s.total}`, s.present === s.total && s.total ? "success" : undefined),
    f("Kelmadi", String(s.absent), s.absent ? "danger" : undefined),
    f("Kasal / ta'til / dam", `${s.sick} / ${s.leave} / ${s.dayoff}`),
    f("Belgilanmagan", String(s.notMarked), s.notMarked ? "warning" : "success"),
    f("Taqsimlanmagan", s.unassigned ? `${s.unassigned} kishi — direktor brigadaga beradi` : "yo'q", s.unassigned ? "warning" : undefined),
  ];
  const sections: HomeSection[] = attendanceView
    ? [
        section(`Belgilanmagan (${s.notMarked})`, s.members.filter((m) => !m.status).map((m) => staffRow(m, true)), { target: "sex-emp", empty: "Hamma belgilangan", icon: "user" }),
        section(`Keldi (${s.present})`, s.members.filter((m) => m.status === "PRESENT").sort((a, b) => (a.checkIn ?? "99").localeCompare(b.checkIn ?? "99")).map((m) => staffRow(m, true)), { target: "sex-emp", empty: "Hali hech kim kelmagan", icon: "user" }),
        section("Ishda emas", s.members.filter((m) => m.status && m.status !== "PRESENT").map((m) => staffRow(m, true)), { target: "sex-emp", empty: "Yo'q", icon: "user" }),
      ]
    : [
        section("Brigadalar · keldi / jami", s.groups.map((g) => ({ id: `g-${g.id ?? "none"}`, title: g.name, right: `${g.present} / ${g.total}`, tone: g.id ? (g.total && g.present === g.total ? "success" : undefined) : "warning" as Tone })), { icon: "hard-hat" }),
        ...s.groups.filter((g) => g.total).map((g) => section(`${g.name} · ${g.present}/${g.total}`, g.members.map((m) => staffRow(m)), { target: "sex-emp", icon: "user" })),
      ];
  return {
    key: "sex", id: attendanceView ? "attendance" : "staff",
    title: attendanceView ? "Davomat — bugun" : "Sex xodimlari",
    subtitle: attendanceView
      ? (canWork(user) ? "Xodimni bosing — Keldi / Ketdi / Kelmadi. Otdel kadr tabeliga ham tushadi." : "Davomatni sex boshlig'i belgilaydi")
      : (user.role === "DIRECTOR" ? "Xodimni bosib brigadaga biriktiring" : "Xodimlarni brigadalarga direktor taqsimlaydi"),
    fields, sections, actions,
  };
}

/** Bitta sex xodimi — bugungi davomat tugmalari va oxirgi 7 kun. */
export async function sexEmployeeDetail(user: MobileUser, employeeId: string): Promise<MobileDetail> {
  const s = await productionStaff();
  const m = s.members.find((x) => x.id === employeeId);
  const e = m ?? (user.role === "DIRECTOR" ? await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, position: true, phone: true } }) : null);
  if (!e) throw new ListError("NOT_FOUND", "Xodim sex tarkibida emas", 404);
  // Brigadir faqat o'z brigadasi a'zosini ochadi va belgilaydi
  const own = user.role === "BRIGADIER" ? (await myBrigades(user.id)).map((b) => b.id) : null;
  if (own && !(m?.brigadeId && own.includes(m.brigadeId))) throw new ListError("NOT_FOUND", "Xodim sizning brigadangizda emas", 404);
  const week = new Date(dayUtc(today())); week.setUTCDate(week.getUTCDate() - 7);
  const history = await db.attendance.findMany({ where: { employeeId, date: { gte: week } }, orderBy: { date: "desc" } });
  const mk = m?.status ? markOf(m.status) : null;
  const actions: DetailAction[] = [];
  if (m && (canWork(user) || own)) {
    if (m.status !== "PRESENT") actions.push({ id: "att.present", label: "Keldi (hozir)", tone: "success" });
    if (m.status === "PRESENT" && !m.checkOut) actions.push({ id: "att.checkout", label: "Ketdi (hozir)", tone: "brand" });
    if (m.status !== "ABSENT") actions.push({ id: "att.absent", label: "Kelmadi", tone: "danger", confirm: `${m.fullName} bugun kelmadi deb belgilansinmi?` });
    actions.push({
      id: "att.status", label: "Boshqa belgi / vaqtni tuzatish", tone: "warning",
      form: [
        { name: "status", label: "Holat", type: "select", required: true, value: m.status ?? "PRESENT", options: statusOptions },
        { name: "checkIn", label: "Keldi (soat)", type: "time", value: m.checkIn ?? "", showIf: { field: "status", equals: "PRESENT" } },
        { name: "checkOut", label: "Ketdi (soat)", type: "time", value: m.checkOut ?? "", showIf: { field: "status", equals: "PRESENT" } },
        { name: "note", label: "Izoh", type: "text", value: m.note ?? "", placeholder: "ixtiyoriy" },
      ],
    });
  }
  if (user.role === "DIRECTOR") {
    actions.push({
      id: "sex.assign", label: "Brigadaga biriktirish", tone: "brand",
      form: [{ name: "brigadeId", label: "Brigada", type: "select", value: m?.brigadeId ?? "", options: [{ value: "", label: "— sexda emas / taqsimlanmagan —" }, ...s.brigades.map((b) => ({ value: b.id, label: b.name }))] }],
    });
  }
  return {
    key: "sex-emp", id: employeeId, title: e.fullName, subtitle: e.position,
    status: mk?.label,
    fields: [
      f("Brigada", m?.brigade ?? UNASSIGNED, m?.brigade ? undefined : "warning"),
      f("Bugun", mk ? mk.label : "belgilanmagan", m?.status ? STATUS_TONE[m.status] : "warning"),
      f("Keldi", m?.checkIn ?? "—"),
      f("Ketdi", m?.checkOut ?? "—"),
      ...(m?.note ? [f("Izoh", m.note)] : []),
      ...(e.phone ? [f("Telefon", e.phone)] : []),
    ],
    sections: [
      section("Oxirgi 7 kun", history.map((a) => ({
        id: a.id, title: isoDay(a.date).split("-").reverse().join("."),
        subtitle: a.note ?? undefined,
        right: `${markOf(a.status).label}${a.checkIn ? ` ${a.checkIn}${a.checkOut ? `–${a.checkOut}` : ""}` : ""}`, tone: STATUS_TONE[a.status],
      })), { empty: "Davomat yozilmagan", icon: "calendar" }),
    ],
    actions,
  };
}

// ───────────────────────── Sklad ─────────────────────────

const days = (d: number | null) => (d === null ? "sarf yo'q" : d > 999 ? ">999 kunga" : `${d.toFixed(d < 10 ? 1 : 0)} kunga yetadi`);

async function stock(): Promise<MobileDetail> {
  const list = await stockStatus();
  const { low, ok, rest } = stockHighlights(list, 20);
  const row = (m: (typeof list)[number]): HomeRow => ({
    id: m.id, title: m.name,
    subtitle: `qoldiq ${num(m.balance)} ${m.unit} · ${days(m.days)}${m.perDay > 0 ? ` · kunlik ${num(m.perDay)} ${m.unit}` : ""}${m.planned > 0 ? ` · zayavkalarga ${num(m.planned)} ${m.unit}` : ""}`,
    right: m.need > 0 ? `kerak ${num(m.need)} ${m.unit}` : STOCK_LEVEL_LABEL[m.level],
    tone: m.level === "short" ? "danger" : m.level === "low" ? "warning" : "success",
  });
  return {
    key: "sex", id: "stock", title: "Sklad holati", subtitle: "Xomashyo: nima kam qoldi va qancha olib kelish kerak",
    fields: [
      f("Yetmaydi", `${list.filter((m) => m.level === "short").length} ta`, list.some((m) => m.level === "short") ? "danger" : "success"),
      f("Kam qoldi", `${list.filter((m) => m.level === "low").length} ta`, list.some((m) => m.level === "low") ? "warning" : undefined),
      f("Yetarli", `${list.filter((m) => m.level === "ok").length} ta`),
      f("Hisob", "kunlik sarf — 30 kun o'rtachasi; «kerak» — zayavkalar va minimal qoldiqqa yetmagani"),
    ],
    sections: [
      section("Olib kelish kerak", low.map(row), { target: "stock", empty: "Hamma xomashyo yetarli", icon: "triangle-alert" }),
      section(rest > 0 ? `Yetarli (yana ${rest} ta Skladda)` : "Yetarli", ok.map(row), { target: "stock", empty: "—", icon: "layers" }),
    ],
    actions: [],
  };
}

// ───────────────────────── Kunlik hisobot ─────────────────────────

/** Hisobot obyektidan kartochka bo'limlari — jonli ham, saqlangan ham bir xil chiziladi. */
function reportSections(r: ReportSnapshot): HomeSection[] {
  return [
    section("Ishlab chiqarildi va plan", r.plan.rows.map((p) => ({
      id: `p-${p.code}`, title: `${p.code} · ${p.name}`,
      subtitle: `bugun ${num(p.day)}${p.dayPlan !== null ? ` / ${num(p.dayPlan)}` : ""} · oy ${num(p.month)}${p.monthPlan !== null ? ` / ${num(p.monthPlan)}` : ""} ${unitLabel(p.unit)}${p.defectDay ? ` · brak ${num(p.defectDay)}` : ""}`,
      right: p.monthPct !== null ? pctText(p.monthPct) : undefined, tone: (p.behind ?? 0) > 0 ? "danger" : p.monthPct !== null ? "success" : undefined,
    })), { empty: "Ishlab chiqarish qayd qilinmagan", icon: "factory" }),
    section("Yuklash", r.load.orders.map((o) => ({ id: `o-${o.orderNo}`, title: `${o.orderNo} · ${o.customer}`, subtitle: `${o.time ?? "—"} · ${o.items}`, right: o.left > 0 ? `qoldi ${num(o.left)}` : "✓", tone: o.left > 0 ? "warning" : "success" })), { empty: "Bugunga zayavka yo'q", icon: "truck" }),
    section("Brigadalar", r.brigades.map((b) => ({ id: `b-${b.name}`, title: b.name, subtitle: b.today || "qayd yo'q", right: b.overdue ? `${b.overdue} kechikkan` : `${b.open} ochiq`, tone: b.overdue ? "danger" : b.today ? "success" : undefined })), { empty: "Faol brigada yo'q", icon: "hard-hat" }),
    section("Brak", r.defects.map((d, i) => ({ id: `d-${i}`, title: `${d.code} · ${d.reason}`, subtitle: `${d.time} · ${d.brigade ?? "—"} · ${d.by}`, right: `${num(d.qty)} ${unitLabel(d.unit)}`, tone: "danger" as Tone })), { empty: "Brak yo'q", icon: "triangle-alert" }),
    section("Davomat", [
      ...r.staff.groups.map((g) => ({ id: `g-${g.name}`, title: g.name, right: `${g.present} / ${g.total}` })),
      ...r.staff.away.map((a, i) => ({ id: `a-${i}`, title: a.name, right: a.status, tone: "warning" as Tone })),
    ], { empty: "Sex xodimi yo'q", icon: "users" }),
    section("Sklad — kam qolganlar", r.stock.filter((s) => s.level !== "ok").map((s) => ({ id: `s-${s.name}`, title: s.name, subtitle: `qoldiq ${num(s.balance)} ${s.unit} · ${days(s.days)}`, right: s.need > 0 ? `kerak ${num(s.need)} ${s.unit}` : STOCK_LEVEL_LABEL[s.level], tone: s.level === "short" ? "danger" : "warning" as Tone })), { empty: "Hamma xomashyo yetarli", icon: "layers" }),
  ];
}

const reportFields = (r: ReportSnapshot): DetailField[] => [
  f("Ishda", `${r.staff.present} / ${r.staff.total} kishi`),
  f("Ishlab chiqarildi", r.producedToday && r.producedToday !== "0" ? r.producedToday : "—"),
  f("Yuklash", `${r.load.orders.length} zayavka`),
  f("Brak", r.defects.length ? `${r.defects.length} ta qayd` : "yo'q", r.defects.length ? "danger" : "success"),
];

async function report(user: MobileUser): Promise<MobileDetail> {
  const iso = today();
  const [r, history] = await Promise.all([buildReport(iso), reportHistory(10)]);
  const todays = history.filter((h) => h.iso === iso);
  return {
    key: "sex", id: "report", title: "Kunlik hisobot", subtitle: `${iso.split("-").reverse().join(".")} · jonli raqamlar. «Qayd etish» bosilsa saqlanadi va direktorga boradi.`,
    status: todays.length ? "Qayd etilgan" : "Qayd etilmagan",
    fields: [
      ...reportFields(r),
      f("Holat", todays.length ? `qayd etildi ${hhmm(todays[0].createdAt)} · ${todays[0].seenAt ? "direktor ko'rdi" : "direktor hali ochmagan"}` : "bugun hali qayd etilmagan", todays.length ? "success" : "warning"),
    ],
    sections: [
      ...reportSections(r),
      section("Qayd etilgan hisobotlar", history.map((h) => ({ id: h.id, title: `${h.iso.split("-").reverse().join(".")}${h.latest ? "" : " (avvalgi nusxa)"}`, subtitle: h.summary, right: h.seenAt ? "ko'rildi" : "yangi", tone: h.seenAt ? "success" : "warning" })), { target: "prod-report", empty: "Hali qayd etilmagan", icon: "file-text" }),
    ],
    actions: canWork(user)
      ? [{ id: "report.submit", label: todays.length ? "Qayta qayd etish" : "Qayd etish", tone: "success", form: [{ name: "note", label: "Izoh (ixtiyoriy)", type: "text", placeholder: "smena, to'xtash sababi…", hint: todays.length ? "Yangi nusxa saqlanadi — oldingisi tarixda qoladi" : "Hisobot saqlanadi va direktor kabinetiga tushadi" }] }]
      : [],
  };
}

/** Qayd etilgan hisobot — direktor ochsa "ko'rildi" belgilanadi. */
export async function savedReportDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const rep = await loadReport(id, { userId: user.id, role: user.role });
  if (!rep) throw new ListError("NOT_FOUND", "Hisobot topilmadi", 404);
  return {
    key: "prod-report", id, title: `Hisobot · ${rep.iso.split("-").reverse().join(".")}`,
    subtitle: `Qayd etdi: ${rep.by} · ${day(rep.createdAt)} ${hhmm(rep.createdAt)}`,
    status: "Qayd etilgan",
    fields: [...reportFields(rep.snap), ...(rep.note ? [f("Izoh", rep.note)] : []), f("Xulosa", reportSummary(rep.snap))],
    sections: reportSections(rep.snap),
    actions: [],
  };
}

/** "Hisobotlar" ro'yxati (direktor va sex) — qator bosilsa saqlangan hisobot. */
export async function reportRows(): Promise<HomeRow[]> {
  const list = await reportHistory(60);
  return list.map((h) => ({
    id: h.id, title: `${h.iso.split("-").reverse().join(".")}${h.latest ? "" : " (avvalgi nusxa)"}`,
    subtitle: `${h.summary} · ${h.by}`, right: h.seenAt ? "ko'rildi" : "yangi", tone: h.seenAt ? "success" : "warning",
  }));
}
