import { db } from "@/lib/db";
import { BRIGADE_ISSUE } from "@/lib/brigade-shift";
import { fmtUnitTotals } from "@/lib/unit";
import { dayUtc } from "@/lib/davomat";
import type { BrigadeIssueKind } from "@/generated/prisma";

/**
 * Hisobotning soatma-soat qismi: ish kuni boshidan (08:00) "Qayd etish" bosilgan daqiqagacha
 * har soatda nima ishlab chiqarilgani, qayerda to'xtab qolgani va brigadirlar nimani belgilagani.
 *
 * Ishlab chiqarilgan miqdor — PRODUCTION_OUTPUT (StockMove): kunlik jadval bilan bir xil manba, shuning
 * uchun soatlar yig'indisi "Bugun" ustuniga teng chiqadi (08:00 gacha qilingani alohida qatorda).
 * To'xtash oralig'i — brigadir muammosi: boshlanishi yozilgan vaqt, oxiri — yozilgan to'xtash
 * daqiqasi, bo'lmasa hal qilingan vaqt, hali ochiq bo'lsa hisobot vaqti.
 */

export const DAY_START_HOUR = 8;
/** O'tgan kun hisobotida soatlar kamida shu soatgacha — soat kartochkasi ham shunga tayanadi. */
export const hourStart = (iso: string, h: number) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, h); };
/** O'tgan kun hisobotida soatlar kamida shu soatgacha chiziladi (keyin ham ish bo'lsa — oxirgi yozuvgacha). */
const DAY_END_HOUR = 18;
/**
 * Ish to'xtatadigan muammolar — soat ichidagi to'xtash daqiqasi shulardan. Material yetishmasligi
 * har doim ishni to'xtatmaydi (boshqa topshiriqqa o'tiladi) — u faqat to'xtash daqiqasi yozilganda sanaladi.
 */
const STOPPAGE: BrigadeIssueKind[] = ["EQUIPMENT", "DELAY"];

export type HourlyEvent = { time: string; brigade: string | null; text: string; tone: "danger" | "warning" | "success" | "info" };
export type HourlyBlock = {
  from: string; to: string;
  produced: string; // "12 dona + 8 m³" yoki ""
  items: string; // mahsulot va brigada bo'yicha: "PL-60 12 dona (A brigada)"
  entries: number;
  defects: string;
  downtimeMin: number;
  /** ishladi — chiqarildi; toxtadi — soatning yarmidan ko'pi to'xtash; bosh — na ishlab chiqarish, na sabab. */
  state: "worked" | "stopped" | "idle";
  events: HourlyEvent[];
};
export type IssueRow = {
  id?: string; // eski nusxalarda yo'q
  time: string; brigade: string; kind: string; equipment: string | null; note: string; task: string | null; by: string;
  downtimeMin: number; resolved: string | null; resolution: string | null;
};
export type HourlyReport = {
  from: string; to: string; cutoffAt: string;
  before: { produced: string; items: string } | null; // 08:00 gacha qilingani
  blocks: HourlyBlock[];
  downtimeMin: number;
  idleHours: number;
  issues: IssueRow[];
  openIssues: number;
};

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const overlapMin = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / 60_000;
/** Oraliqlar birlashmasi — ikki brigada bir vaqtda to'xtasa, vaqt ikki marta sanalmasin. */
function union(rows: { s: number; e: number }[]) {
  const out: { s: number; e: number }[] = [];
  for (const r of [...rows].filter((x) => x.e > x.s).sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1];
    if (last && r.s <= last.e) last.e = Math.max(last.e, r.e); else out.push({ ...r });
  }
  return out;
}
const unionMin = (u: { s: number; e: number }[], b0: number, b1: number) => u.reduce((a, x) => a + overlapMin(x.s, x.e, b0, b1), 0);
export const minText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} soat${m % 60 ? ` ${Math.round(m % 60)} daq` : ""}` : `${Math.round(m)} daq`);

/**
 * `iso` kunining 08:00 dan `cutoff` gacha soatlari. Bugungi kun uchun `cutoff` — hozir (hisobot
 * topshirilgan payt); o'tgan kun uchun — 18:00 yoki undan kechroq oxirgi yozuv.
 */
export async function hourlyReport(iso: string, cutoff = new Date()): Promise<HourlyReport> {
  const [y, m, d] = iso.split("-").map(Number);
  const dayFrom = new Date(y, m - 1, d), dayTo = new Date(y, m - 1, d + 1);
  const start = new Date(y, m - 1, d, DAY_START_HOUR);

  const [outputs, defects, issues, shifts, started] = await Promise.all([
    db.stockMove.findMany({
      where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: dayFrom, lt: dayTo } },
      orderBy: { date: "asc" },
      select: { date: true, qty: true, product: { select: { code: true, unit: true } }, brigade: { select: { name: true } } },
    }),
    db.productDefect.findMany({
      where: { date: { gte: dayFrom, lt: dayTo } }, orderBy: { date: "asc" },
      select: { date: true, qty: true, reason: true, product: { select: { code: true, unit: true } }, brigade: { select: { name: true } }, task: { select: { taskNo: true } } },
    }),
    // Shu kuni yozilgan muammolar + oldin yozilib hali ochiq turganlari (kecha buzilgan uskuna bugun ham to'xtatib turibdi)
    db.brigadeIssue.findMany({
      where: { createdAt: { lt: dayTo }, OR: [{ createdAt: { gte: dayFrom } }, { resolvedAt: null }, { resolvedAt: { gte: dayFrom } }] },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, kind: true, equipment: true, note: true, downtimeMin: true, createdAt: true, resolvedAt: true, resolution: true,
        brigade: { select: { name: true } }, task: { select: { taskNo: true } }, createdBy: { select: { fullName: true } }, resolvedBy: { select: { fullName: true } },
      },
    }),
    db.brigadeShift.findMany({ where: { date: dayUtc(iso) }, select: { openedAt: true, closedAt: true, brigade: { select: { name: true } } } }),
    db.brigadeTask.findMany({ where: { startedAt: { gte: dayFrom, lt: dayTo } }, select: { startedAt: true, taskNo: true, brigade: { select: { name: true } }, orderItem: { select: { product: { select: { code: true } } } } } }),
  ]);

  // ── Hisobot oxiri ──
  let end = cutoff < dayTo ? cutoff : dayTo;
  if (cutoff >= dayTo) {
    const last = Math.max(new Date(y, m - 1, d, DAY_END_HOUR).getTime(), ...outputs.map((o) => o.date.getTime()), ...defects.map((x) => x.date.getTime()));
    end = new Date(Math.min(dayTo.getTime(), Math.ceil(last / 3_600_000) * 3_600_000));
  }

  // ── To'xtash oraliqlari ──
  const stops = issues.map((i) => {
    const s = i.createdAt.getTime();
    const e = i.downtimeMin != null ? s + i.downtimeMin * 60_000 : (i.resolvedAt?.getTime() ?? end.getTime());
    return { ...i, s, e: Math.min(e, end.getTime()), stops: STOPPAGE.includes(i.kind) || i.downtimeMin != null };
  });

  const stopped = union(stops.filter((x) => x.stops));

  const itemsText = (rows: typeof outputs) => {
    const g = new Map<string, { code: string; unit: string; brigade: string; qty: number }>();
    for (const o of rows) {
      const brigade = o.brigade?.name ?? "zames";
      const k = `${o.product!.code}|${brigade}`;
      const cur = g.get(k) ?? { code: o.product!.code, unit: o.product!.unit, brigade, qty: 0 };
      cur.qty += Number(o.qty); g.set(k, cur);
    }
    return [...g.values()].map((x) => `${x.code} ${fmtUnitTotals([{ unit: x.unit, qty: x.qty }])} (${x.brigade})`).join("; ");
  };

  const blocks: HourlyBlock[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += 3_600_000) {
    const b0 = t, b1 = Math.min(t + 3_600_000, end.getTime());
    const inBlock = <T extends { date: Date }>(rows: T[]) => rows.filter((r) => r.date.getTime() >= b0 && r.date.getTime() < b1);
    const out = inBlock(outputs);
    const def = inBlock(defects);
    // Kamida bitta brigada to'xtab turgan daqiqalar
    const down = unionMin(stopped, b0, b1);

    const events: HourlyEvent[] = [];
    for (const sh of shifts) {
      if (sh.openedAt.getTime() >= b0 && sh.openedAt.getTime() < b1) events.push({ time: hhmm(sh.openedAt), brigade: sh.brigade.name, text: "smena ochildi", tone: "info" });
      if (sh.closedAt && sh.closedAt.getTime() >= b0 && sh.closedAt.getTime() < b1) events.push({ time: hhmm(sh.closedAt), brigade: sh.brigade.name, text: "smena yopildi", tone: "info" });
    }
    for (const s of started) {
      if (s.startedAt!.getTime() >= b0 && s.startedAt!.getTime() < b1) events.push({ time: hhmm(s.startedAt!), brigade: s.brigade.name, text: `${s.taskNo} (${s.orderItem.product.code}) ishi boshlandi`, tone: "info" });
    }
    for (const i of stops) {
      if (i.s >= b0 && i.s < b1) {
        events.push({ time: hhmm(i.createdAt), brigade: i.brigade.name, text: `${BRIGADE_ISSUE[i.kind].label}${i.equipment ? `: ${i.equipment}` : ""} — ${i.note}${i.task ? ` (${i.task.taskNo})` : ""}`, tone: i.kind === "EQUIPMENT" ? "danger" : "warning" });
      }
      if (i.resolvedAt && i.resolvedAt.getTime() >= b0 && i.resolvedAt.getTime() < b1) {
        events.push({ time: hhmm(i.resolvedAt), brigade: i.brigade.name, text: `hal qilindi: ${BRIGADE_ISSUE[i.kind].label}${i.equipment ? ` (${i.equipment})` : ""}${i.resolution ? ` — ${i.resolution}` : ""}`, tone: "success" });
      }
    }
    for (const x of def) events.push({ time: hhmm(x.date), brigade: x.brigade?.name ?? null, text: `brak ${x.product.code} ${fmtUnitTotals([{ unit: x.product.unit, qty: Number(x.qty) }])} — ${x.reason}${x.task ? ` (${x.task.taskNo})` : ""}`, tone: "danger" });
    events.sort((a, c) => a.time.localeCompare(c.time));

    const minutes = (b1 - b0) / 60_000;
    blocks.push({
      from: hhmm(new Date(b0)), to: b1 === end.getTime() && end.getTime() - b0 < 3_600_000 ? hhmm(end) : hhmm(new Date(b1)),
      produced: out.length ? fmtUnitTotals(out.map((o) => ({ unit: o.product!.unit, qty: o.qty }))) : "",
      items: itemsText(out), entries: out.length,
      defects: def.length ? fmtUnitTotals(def.map((x) => ({ unit: x.product.unit, qty: x.qty }))) : "",
      downtimeMin: Math.round(down),
      state: out.length ? "worked" : down >= minutes / 2 ? "stopped" : "idle",
      events,
    });
  }

  const early = outputs.filter((o) => o.date < start);
  return {
    from: hhmm(start), to: hhmm(end), cutoffAt: end.toISOString(),
    before: early.length ? { produced: fmtUnitTotals(early.map((o) => ({ unit: o.product!.unit, qty: o.qty }))), items: itemsText(early) } : null,
    blocks,
    downtimeMin: Math.round(unionMin(stopped, start.getTime(), end.getTime())),
    // Faqat to'liq o'tgan soatlar — joriy (yarim) soatni "bo'sh" deyish adolatsiz
    idleHours: blocks.filter((b, i) => b.state === "idle" && (i < blocks.length - 1 || cutoff >= dayTo)).length,
    issues: stops.map((i) => ({
      id: i.id,
      time: i.createdAt < dayFrom ? `${hhmm(i.createdAt)} (${i.createdAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })})` : hhmm(i.createdAt),
      brigade: i.brigade.name, kind: BRIGADE_ISSUE[i.kind].label, equipment: i.equipment, note: i.note, task: i.task?.taskNo ?? null, by: i.createdBy.fullName,
      downtimeMin: i.stops ? Math.round(overlapMin(i.s, i.e, start.getTime(), end.getTime())) : 0,
      resolved: i.resolvedAt && i.resolvedAt <= end ? `${hhmm(i.resolvedAt)}${i.resolvedBy ? ` · ${i.resolvedBy.fullName}` : ""}` : null,
      resolution: i.resolvedAt && i.resolvedAt <= end ? i.resolution : null,
    })),
    openIssues: issues.filter((i) => !i.resolvedAt || i.resolvedAt > end).length,
  };
}
