import { db } from "@/lib/db";
import { BRIGADE_ISSUE } from "@/lib/brigade-shift";
import { DAY_START_HOUR, hourStart, hourlyReport, minText } from "@/lib/production-hourly";
import { productionStaff } from "@/lib/production-staff";
import { markOf, today } from "@/lib/davomat";
import { unitLabel } from "@/lib/unit";
import { inUnit, num, sum, time, totalsText } from "./fmt";
import { ListError } from "./list";
import type { MobileUser } from "./auth";
import type { DetailField, MobileDetail } from "./detail";
import type { HomeRow, HomeSection, Tone } from "./home";

/**
 * Kunlik hisobotdan bosib ochiladigan batafsil kartochkalar (`rep/<id>`) — faqat ko'rish uchun,
 * hech bir kartada amal tugmasi yo'q (sex boshlig'i ham, direktor ham kuzatadi).
 *
 *   · `h~<kun>~<soat>~<cutoff>` — bitta soat: shu soatdagi hamma amal izohlari bilan;
 *     `<soat>` = "early" — 08:00 gacha qilingani;
 *   · `g~<kun>~<brigadaId>~<cutoff>` — brigadaning shu kundagi ishi;
 *   · `p~<kun>~<mahsulotId>~<cutoff>` — mahsulot bo'yicha shu kun;
 *   · `d~<brakId>` — bitta brak yozuvi.
 * `<cutoff>` — hisobot qayd etilgan payt (ms): saqlangan hisobotdan ochilganda keyingi yozuvlar aralashmaydi.
 *
 * Qatorlar boshqa kartochkalarga olib boradi (`tasks:<id>`, `brig-issue:<id>`, `production:<id>` ...) —
 * bo'lim `target` i "rep", id esa aralash havola (`splitRef`), shuning uchun bitta bo'limda turli kartalar ochiladi.
 */

export const REP = "rep";
const f = (label: string, value: string, tone?: Tone): DetailField => ({ label, value, tone });
const sec = (title: string, rows: HomeRow[], empty: string, icon: string): HomeSection => ({ title, rows, empty, icon, target: REP });
const dd = (iso: string) => iso.split("-").reverse().join(".");
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Hisobot qatorlari uchun id yasovchilar — `sex.ts` shularni ishlatadi. */
export const repId = {
  hour: (iso: string, h: number | "early", cut: number) => `h~${iso}~${h}~${cut}`,
  brigade: (iso: string, id: string, cut: number) => `g~${iso}~${id}~${cut}`,
  product: (iso: string, id: string, cut: number) => `p~${iso}~${id}~${cut}`,
  defect: (id: string) => `d~${id}`,
  none: "none",
};
/** Hisobotning kesish vaqti: saqlangan nusxada — qayd etilgan payt, jonli ko'rinishda — hozir. */
export const reportCut = (iso: string, cutoffAt?: string) => {
  if (cutoffAt) return new Date(cutoffAt).getTime();
  const [y, m, d] = iso.split("-").map(Number);
  return iso === today() ? Date.now() : new Date(y, m - 1, d + 1).getTime();
};

export async function repDetail(_user: MobileUser, id: string): Promise<MobileDetail> {
  const [kind, ...rest] = id.split("~");
  if (kind === "d") return defectDetail(rest[0] ?? "");
  if (kind === "none") {
    return { key: REP, id, title: "Batafsil ma'lumot yo'q", subtitle: "Bu hisobot eski nusxada saqlangan — qatorlar kartochkalarga bog'lanmagan. Yangi qayd etilgan hisobotlarda hammasi ochiladi.", fields: [], sections: [], actions: [] };
  }
  const [iso, key, cutRaw] = rest;
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || !key) throw new ListError("NOT_FOUND", "Kartochka topilmadi", 404);
  const cut = Math.min(Number(cutRaw) || Date.now(), Date.now());
  if (kind === "h") return hourDetail(iso, key, cut);
  if (kind === "g") return brigadeDayDetail(iso, key, cut);
  if (kind === "p") return productDayDetail(iso, key, cut);
  throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
}

// ───────────────────────── Oraliqdagi hamma amal ─────────────────────────

type Scope = { from: Date; to: Date; iso: string; brigadeId?: string; productId?: string; attendance?: boolean };

/**
 * Oraliq ichidagi amallar — har biri izohi va kim qilgani bilan, bosilsa manba kartochkasi.
 * Soat, brigada-kun va mahsulot-kun kartalari shu bitta funksiyadan chiziladi.
 */
async function activity(s: Scope): Promise<{ sections: HomeSection[]; counts: { progress: number; batches: number; defects: number; issues: number } }> {
  const range = { gte: s.from, lt: s.to };
  const taskWhere = { ...(s.brigadeId ? { brigadeId: s.brigadeId } : {}), ...(s.productId ? { orderItem: { productId: s.productId } } : {}) };
  const [progress, batches, defects, issues, shifts, started, staff] = await Promise.all([
    db.taskProgress.findMany({
      where: { date: range, task: taskWhere }, orderBy: { date: "asc" },
      select: { id: true, qty: true, date: true, note: true, createdBy: { select: { fullName: true } }, task: { select: { id: true, taskNo: true, brigade: { select: { name: true } }, order: { select: { orderNo: true } }, orderItem: { select: { product: { select: { name: true, unit: true } } } } } } },
    }),
    // Zames brigadaga bog'lanmaydi — brigada kartasida chiqmaydi
    s.brigadeId ? Promise.resolve([]) : db.productionBatch.findMany({
      where: { date: range, ...(s.productId ? { productId: s.productId } : {}) }, orderBy: { date: "asc" },
      select: { id: true, batchNo: true, date: true, shift: true, qtyM3: true, note: true, product: { select: { name: true, unit: true } }, order: { select: { orderNo: true, customer: { select: { name: true } } } }, createdBy: { select: { fullName: true } } },
    }),
    db.productDefect.findMany({
      where: { date: range, ...(s.brigadeId ? { brigadeId: s.brigadeId } : {}), ...(s.productId ? { productId: s.productId } : {}) }, orderBy: { date: "asc" },
      select: { id: true, qty: true, date: true, reason: true, note: true, product: { select: { name: true, unit: true } }, brigade: { select: { name: true } }, task: { select: { taskNo: true } }, createdBy: { select: { fullName: true } } },
    }),
    // Oraliqqa to'g'ri kelgan muammolar: shu oraliqda ochilgan, yopilgan yoki butun oraliq davomida ochiq turgan
    db.brigadeIssue.findMany({
      where: {
        createdAt: { lt: s.to }, OR: [{ resolvedAt: null }, { resolvedAt: { gte: s.from } }],
        ...(s.brigadeId ? { brigadeId: s.brigadeId } : {}), ...(s.productId ? { task: { orderItem: { productId: s.productId } } } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, equipment: true, note: true, downtimeMin: true, createdAt: true, resolvedAt: true, resolution: true, brigade: { select: { name: true } }, task: { select: { taskNo: true } }, createdBy: { select: { fullName: true } }, resolvedBy: { select: { fullName: true } } },
    }),
    s.productId ? Promise.resolve([]) : db.brigadeShift.findMany({
      where: { OR: [{ openedAt: range }, { closedAt: range }], ...(s.brigadeId ? { brigadeId: s.brigadeId } : {}) },
      select: { id: true, openedAt: true, closedAt: true, note: true, summary: true, brigade: { select: { name: true } }, openedBy: { select: { fullName: true } }, closedBy: { select: { fullName: true } } },
    }),
    db.brigadeTask.findMany({
      where: { startedAt: range, ...taskWhere }, orderBy: { startedAt: "asc" },
      select: { id: true, taskNo: true, startedAt: true, qty: true, brigade: { select: { name: true } }, orderItem: { select: { product: { select: { name: true, unit: true } } } } },
    }),
    s.attendance ? productionStaff(s.iso) : Promise.resolve(null),
  ]);

  const inRange = (hm: string | null) => {
    if (!hm) return false;
    const [h, m] = hm.split(":").map(Number);
    const [y, mo, d] = s.iso.split("-").map(Number);
    const t = new Date(y, mo - 1, d, h, m);
    return t >= s.from && t < s.to;
  };
  const people = (staff?.members ?? []).filter((m) => (!s.brigadeId || m.brigadeId === s.brigadeId) && (inRange(m.checkIn) || inRange(m.checkOut)));

  const issueRows = issues
    // Oldingi kundan ochiq qolgan, to'xtash vaqti allaqachon tugagan yozuvlar oraliqqa tegmaydi
    .filter((i) => !(i.downtimeMin != null && i.createdAt.getTime() + i.downtimeMin * 60_000 < s.from.getTime() && i.createdAt < s.from && !(i.resolvedAt && i.resolvedAt >= s.from)))
    .map((i) => {
      const opened = i.createdAt >= s.from ? `${time(i.createdAt)} belgiladi` : `${i.createdAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} ${time(i.createdAt)} dan ochiq`;
      const closed = i.resolvedAt && i.resolvedAt < s.to ? `hal qilindi ${time(i.resolvedAt)}${i.resolvedBy ? ` (${i.resolvedBy.fullName})` : ""}${i.resolution ? `: ${i.resolution}` : ""}` : null;
      return {
        id: `brig-issue:${i.id}`, title: `${BRIGADE_ISSUE[i.kind].label}${i.equipment ? ` · ${i.equipment}` : ""}`,
        subtitle: [opened, i.brigade.name, i.createdBy.fullName, i.note, i.task?.taskNo, i.downtimeMin ? `to'xtash ${minText(i.downtimeMin)}` : null, closed].filter(Boolean).join(" · "),
        right: closed ? "hal qilindi" : i.resolvedAt ? "keyin hal qilindi" : "ochiq", tone: (closed ? "success" : "danger") as Tone,
      };
    });

  const shiftRows: HomeRow[] = [];
  for (const sh of shifts) {
    if (sh.openedAt >= s.from && sh.openedAt < s.to) shiftRows.push({ id: `brig-shift:${sh.id}`, title: `${sh.brigade.name} — smena ochildi`, subtitle: `${time(sh.openedAt)} · ${sh.openedBy.fullName}`, right: time(sh.openedAt), tone: "info" });
    if (sh.closedAt && sh.closedAt >= s.from && sh.closedAt < s.to) shiftRows.push({ id: `brig-shift:${sh.id}`, title: `${sh.brigade.name} — smena yopildi`, subtitle: [time(sh.closedAt), sh.closedBy?.fullName, sh.summary, sh.note ? `izoh: ${sh.note}` : null].filter(Boolean).join(" · "), right: time(sh.closedAt), tone: "success" });
  }
  for (const t of started) shiftRows.push({ id: `tasks:${t.id}`, title: `${t.taskNo} — ish boshlandi`, subtitle: `${time(t.startedAt!)} · ${t.brigade.name} · ${t.orderItem.product.name} ${inUnit(sum(t.qty), t.orderItem.product.unit)}`, right: time(t.startedAt!), tone: "info" });
  shiftRows.sort((a, b) => (a.right ?? "").localeCompare(b.right ?? ""));

  const sections: HomeSection[] = [
    sec(`Brigada qaydlari (bajarildi) · ${progress.length}`, progress.map((p) => ({
      id: `tasks:${p.task.id}`, title: `${p.task.taskNo} · ${p.task.orderItem.product.name}`,
      subtitle: [time(p.date), p.task.brigade.name, p.createdBy.fullName, p.task.order.orderNo, p.note ? `izoh: ${p.note}` : null].filter(Boolean).join(" · "),
      right: inUnit(sum(p.qty), p.task.orderItem.product.unit), tone: "success" as Tone,
    })), "Bu vaqtda brigada qaydi yo'q", "square-check"),
    ...(s.brigadeId ? [] : [sec(`Zameslar · ${batches.length}`, batches.map((b) => ({
      id: `production:${b.id}`, title: `${b.batchNo} · ${b.product.name}`,
      subtitle: [time(b.date), `${b.shift}-smena`, b.order ? `${b.order.orderNo} ${b.order.customer.name}` : "omborga", b.createdBy.fullName, b.note ? `izoh: ${b.note}` : null].filter(Boolean).join(" · "),
      right: inUnit(sum(b.qtyM3), b.product.unit), tone: "success" as Tone,
    })), "Bu vaqtda zames yo'q", "factory")]),
    sec(`Brak · ${defects.length}`, defects.map((d) => ({
      id: repId.defect(d.id), title: `${d.product.name} — ${d.reason}`,
      subtitle: [time(d.date), d.brigade?.name, d.task?.taskNo, d.createdBy.fullName, d.note ? `izoh: ${d.note}` : null].filter(Boolean).join(" · "),
      right: inUnit(sum(d.qty), d.product.unit), tone: "danger" as Tone,
    })), "Brak yozilmagan", "triangle-alert"),
    sec(`To'xtash va muammolar · ${issueRows.length}`, issueRows, "Brigadir muammo belgilamagan", "wrench"),
    ...(s.productId ? [] : [sec("Smena va ish boshlanishi", shiftRows, "Bu vaqtda smena ochilmagan / ish boshlanmagan", "clock")]),
    ...(s.attendance ? [sec(`Davomat (keldi / ketdi) · ${people.length}`, people.map((m) => ({
      id: `sex-emp:${m.id}`, title: m.fullName,
      subtitle: [m.position, m.brigade, inRange(m.checkIn) ? `keldi ${m.checkIn}` : null, inRange(m.checkOut) ? `ketdi ${m.checkOut}` : null, m.note ? `izoh: ${m.note}` : null].filter(Boolean).join(" · "),
      right: m.status ? markOf(m.status).label : undefined, tone: "info" as Tone,
    })), "Bu vaqtda kelgan-ketgan yo'q", "users")] : []),
  ];
  return { sections, counts: { progress: progress.length, batches: batches.length, defects: defects.length, issues: issueRows.length } };
}

// ───────────────────────── Soat ─────────────────────────

async function hourDetail(iso: string, key: string, cut: number): Promise<MobileDetail> {
  const early = key === "early";
  const h = early ? 0 : Number(key);
  if (!early && !(h >= 0 && h < 24)) throw new ListError("NOT_FOUND", "Soat topilmadi", 404);
  const from = early ? hourStart(iso, 0) : hourStart(iso, h);
  const to = new Date(Math.min(early ? hourStart(iso, DAY_START_HOUR).getTime() : from.getTime() + 3_600_000, cut));
  const [rep, act] = await Promise.all([hourlyReport(iso, new Date(cut)), activity({ from, to, iso, attendance: true })]);
  const b = rep.blocks.find((x) => x.from === hh(h));
  const title = early ? `${dd(iso)} · ${rep.from} gacha` : `${dd(iso)} · ${hh(h)}–${b?.to ?? hh(h + 1)}`;
  const state = early ? null : b?.state;
  return {
    key: REP, id: `h~${iso}~${key}~${cut}`, title,
    subtitle: "Shu soatdagi hamma amal — kim, qachon, qanday izoh bilan. Qator bosilsa asl hujjat ochiladi.",
    status: state === "stopped" ? "To'xtab turdi" : state === "idle" ? "Qayd yo'q" : state === "worked" ? "Ishladi" : undefined,
    fields: [
      f("Ishlab chiqarildi", (early ? rep.before?.produced : b?.produced) || "—", (early ? rep.before : b?.produced) ? "success" : undefined),
      ...((early ? rep.before?.items : b?.items) ? [f("Mahsulot / brigada", (early ? rep.before!.items : b!.items))] : []),
      ...(!early ? [
        f("Brak", b?.defects || "yo'q", b?.defects ? "danger" : "success"),
        f("To'xtab turdi", b?.downtimeMin ? minText(b.downtimeMin) : "yo'q", b?.downtimeMin ? "danger" : "success"),
      ] : []),
      f("Qaydlar", `${act.counts.progress} brigada qaydi · ${act.counts.batches} zames · ${act.counts.defects} brak · ${act.counts.issues} muammo`),
    ],
    sections: act.sections,
    actions: [],
  };
}

// ───────────────────────── Brigada / mahsulot — kun bo'yicha ─────────────────────────

async function brigadeDayDetail(iso: string, brigadeId: string, cut: number): Promise<MobileDetail> {
  const b = await db.brigade.findUnique({ where: { id: brigadeId }, select: { name: true, leader: { select: { fullName: true } } } });
  if (!b) throw new ListError("NOT_FOUND", "Brigada topilmadi", 404);
  const from = hourStart(iso, 0), to = new Date(Math.min(hourStart(iso, 24).getTime(), cut));
  const [act, progress] = await Promise.all([
    activity({ from, to, iso, brigadeId, attendance: true }),
    db.taskProgress.findMany({ where: { date: { gte: from, lt: to }, task: { brigadeId } }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
  ]);
  return {
    key: REP, id: `g~${iso}~${brigadeId}~${cut}`, title: b.name, subtitle: `${dd(iso)} · ${time(to)} gacha · brigadir ${b.leader?.fullName ?? "—"}`,
    fields: [
      f("Bajardi", progress.length ? totalsText(progress.map((p) => ({ unit: p.task.orderItem.product.unit, qty: p.qty }))) : "qayd yo'q", progress.length ? "success" : "warning"),
      f("Qaydlar", `${act.counts.progress} ta`),
      f("Brak", `${act.counts.defects} ta`, act.counts.defects ? "danger" : "success"),
      f("Muammolar", `${act.counts.issues} ta`, act.counts.issues ? "warning" : "success"),
    ],
    sections: [...act.sections, { title: "Brigada kartochkasi", empty: "", icon: "hard-hat", target: REP, rows: [{ id: `brigades:${brigadeId}`, title: b.name, subtitle: "tarkib, ochiq topshiriqlar, xomashyo" }] }],
    actions: [],
  };
}

async function productDayDetail(iso: string, productId: string, cut: number): Promise<MobileDetail> {
  const p = await db.product.findUnique({ where: { id: productId }, select: { code: true, name: true, unit: true } });
  if (!p) throw new ListError("NOT_FOUND", "Mahsulot topilmadi", 404);
  const from = hourStart(iso, 0), to = new Date(Math.min(hourStart(iso, 24).getTime(), cut));
  const [act, out, def] = await Promise.all([
    activity({ from, to, iso, productId }),
    db.stockMove.aggregate({ where: { type: "PRODUCTION_OUTPUT", productId, date: { gte: from, lt: to } }, _sum: { qty: true } }),
    db.productDefect.aggregate({ where: { productId, date: { gte: from, lt: to } }, _sum: { qty: true } }),
  ]);
  const made = sum(out._sum.qty), bad = sum(def._sum.qty);
  return {
    key: REP, id: `p~${iso}~${productId}~${cut}`, title: `${p.code} · ${p.name}`, subtitle: `${dd(iso)} · ${time(to)} gacha`,
    fields: [
      f("Ishlab chiqarildi", `${num(made)} ${unitLabel(p.unit)}`, made ? "success" : "warning"),
      f("Brak", bad ? `${num(bad)} ${unitLabel(p.unit)}${made ? ` · ${Math.round((bad / made) * 100)}%` : ""}` : "yo'q", bad ? "danger" : "success"),
    ],
    sections: act.sections,
    actions: [],
  };
}

// ───────────────────────── Brak ─────────────────────────

async function defectDetail(id: string): Promise<MobileDetail> {
  const d = await db.productDefect.findUnique({
    where: { id },
    select: {
      qty: true, date: true, reason: true, note: true, taskId: true, brigadeId: true,
      product: { select: { name: true, unit: true } }, brigade: { select: { name: true } }, createdBy: { select: { fullName: true } },
      task: { select: { taskNo: true, doneQty: true, order: { select: { orderNo: true } } } },
    },
  });
  if (!d) throw new ListError("NOT_FOUND", "Brak yozuvi topilmadi", 404);
  const links: HomeRow[] = [
    ...(d.taskId && d.task ? [{ id: `tasks:${d.taskId}`, title: `Topshiriq ${d.task.taskNo}`, subtitle: `${d.task.order.orderNo} · bajarilgan ${inUnit(sum(d.task.doneQty), d.product.unit)}` }] : []),
    ...(d.brigadeId && d.brigade ? [{ id: `brigades:${d.brigadeId}`, title: d.brigade.name, subtitle: "brigada kartochkasi" }] : []),
  ];
  return {
    key: REP, id: `d~${id}`, title: `Brak · ${d.product.name}`, subtitle: `${d.date.toLocaleDateString("ru-RU")} ${time(d.date)}`,
    status: "Brak",
    fields: [
      f("Miqdor", inUnit(sum(d.qty), d.product.unit), "danger"),
      f("Sabab", d.reason),
      ...(d.note ? [f("Izoh", d.note)] : []),
      f("Brigada", d.brigade?.name ?? "—"),
      ...(d.task ? [f("Topshiriq", d.task.taskNo)] : []),
      f("Kim yozdi", d.createdBy.fullName),
      f("Hisobdan", "hovli qoldig'idan chiqarildi (hisobdan chiqarish)"),
    ],
    sections: links.length ? [{ title: "Bog'liq", empty: "", icon: "link", target: REP, rows: links }] : [],
    actions: [],
  };
}
