/**
 * Eslatmalar: muddati o'tib ham ko'rib chiqilmagan hujjat — mas'ul rolga qayta bildirishnoma.
 * Har bir hodisa birinchi marta o'z joyida bir martalik xabar beradi; u o'qilmay qolib ketsa, ish shu yerda
 * to'xtab qolardi. Bu yerda — «N soatdan beri kutmoqda» qoidalari (har biri: holat, muddat, kimga).
 *
 * Takrorlanmasligi: bir hujjat bo'yicha bir xil eslatma `REPEAT_H` soatda bir martadan ko'p ketmaydi
 * (Notification jadvalidagi oxirgi yozuv tekshiriladi). Tunda (21:00–08:00) yuborilmaydi.
 * Rejalashtiruvchi har 30 daqiqada (`startReminders`), korxona jarayonida; test rejimida o'chiq.
 */
import type { Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import { notifyRoles, notifyUsers, type NotifyLink } from "@/lib/notify";
import { runRentReminders } from "@/lib/rent-tenant";

const H = 3_600_000;
const REPEAT_H = 12;

type Due = { id: string; link: NotifyLink; title: string; body: string; roles?: Role[]; users?: string[] };
type Rule = { type: string; find: (now: Date) => Promise<Due[]> };

const ago = (now: Date, hours: number) => new Date(now.getTime() - hours * H);
const hrs = (from: Date, now: Date) => Math.max(1, Math.round((now.getTime() - from.getTime()) / H));

const RULES: Rule[] = [
  {
    type: "REMIND_ORDER_DRAFT",
    find: async (now) => (await db.order.findMany({
      where: { status: "DRAFT", kind: "SALE", createdAt: { lt: ago(now, 2) } }, take: 50,
      select: { id: true, orderNo: true, createdAt: true, customer: { select: { name: true } } },
    })).map((o) => ({ id: o.id, link: { key: "orders", id: o.id }, roles: ["SALES"] as Role[], title: `Qabul qilinmagan zayavka — ${o.orderNo}`, body: `${o.customer?.name ?? ""} · ${hrs(o.createdAt, now)} soatdan beri qoralamada` })),
  },
  {
    type: "REMIND_ORDER_BLOCKED",
    find: async (now) => (await db.order.findMany({
      where: { status: "BLOCKED", updatedAt: { lt: ago(now, 4) } }, take: 50,
      select: { id: true, orderNo: true, updatedAt: true, customer: { select: { name: true } } },
    })).map((o) => ({ id: o.id, link: { key: "orders", id: o.id }, roles: ["DIRECTOR"], title: `Bloklangan zayavka kutmoqda — ${o.orderNo}`, body: `${o.customer?.name ?? ""} · ${hrs(o.updatedAt, now)} soatdan beri direktor qarorini kutmoqda` })),
  },
  {
    // Tasdiqlangan, yetkazish kuni ertaga yoki o'tgan, lekin bitta ham reys yo'q
    type: "REMIND_ORDER_NO_TRIP",
    find: async (now) => {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
      return (await db.order.findMany({
        where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, deliveryDate: { lt: tomorrow }, trips: { none: {} } }, take: 50,
        select: { id: true, orderNo: true, deliveryDate: true, customer: { select: { name: true } } },
      })).map((o) => ({ id: o.id, link: { key: "orders", id: o.id }, roles: ["LOGISTICS"], title: `Reys rejalashtirilmagan — ${o.orderNo}`, body: `${o.customer?.name ?? ""} · yetkazish ${o.deliveryDate.toLocaleDateString("ru-RU")}` }));
    },
  },
  {
    type: "REMIND_ORDER_NO_INVOICE",
    find: async (now) => (await db.order.findMany({
      where: { kind: "SALE", status: "DELIVERED", updatedAt: { lt: ago(now, 24) }, invoices: { none: { status: { not: "CANCELLED" } } } }, take: 50,
      select: { id: true, orderNo: true, customer: { select: { name: true } } },
    })).map((o) => ({ id: o.id, link: { key: "orders", id: o.id }, roles: ["ACCOUNTING"], title: `Schyot yozilmagan — ${o.orderNo}`, body: `${o.customer?.name ?? ""} · yetkazilgan, lekin schyot yo'q` })),
  },
  {
    type: "REMIND_SUPPLY",
    find: async (now) => (await db.supplyRequest.findMany({
      where: { status: { in: ["NEW", "PRICED", "APPROVED"] }, updatedAt: { lt: ago(now, 24) } }, take: 50,
      select: { id: true, docNo: true, status: true, updatedAt: true },
    })).map((r) => {
      const who: Record<string, { roles: Role[]; what: string }> = {
        NEW: { roles: ["PROCUREMENT", "WAREHOUSE"], what: "narx qo'yilmagan" },
        PRICED: { roles: ["SALES"], what: "tasdiqlanmagan" },
        APPROVED: { roles: ["FINANCE", "ACCOUNTING", "CASHIER"], what: "pul ajratilmagan" },
      };
      const w = who[r.status]!;
      return { id: r.id, link: { key: "supply", id: r.id }, roles: w.roles, title: `Ta'minot kutmoqda — ${r.docNo}`, body: `${hrs(r.updatedAt, now)} soatdan beri ${w.what}` };
    }),
  },
  {
    type: "REMIND_MECHANIC",
    find: async (now) => (await db.mechanicRequest.findMany({
      where: { OR: [{ status: "NEW", createdAt: { lt: ago(now, 4) } }, { status: "APPROVED", decidedAt: { lt: ago(now, 4) } }] }, take: 50,
      select: { id: true, docNo: true, status: true, createdAt: true, decidedAt: true },
    })).map((r) => ({
      id: r.id, link: { key: "kirim", id: r.id }, roles: (r.status === "NEW" ? ["SUPERVISOR"] : ["CASHIER"]) as Role[],
      title: `Mexanik so'rovi kutmoqda — ${r.docNo}`, body: `${hrs(r.decidedAt ?? r.createdAt, now)} soatdan beri ${r.status === "NEW" ? "tasdiqlanmagan" : "pul berilmagan"}`,
    })),
  },
  {
    type: "REMIND_LEAD",
    find: async (now) => (await db.lead.findMany({
      where: { status: "NEW", createdAt: { lt: ago(now, 2) } }, take: 50, select: { id: true, name: true, createdAt: true },
    })).map((l) => ({ id: l.id, link: { key: "leads", id: l.id }, roles: ["SALES"], title: "Javobsiz ariza", body: `${l.name} · ${hrs(l.createdAt, now)} soatdan beri bog'lanilmagan` })),
  },
  {
    // Xodim arizasi (ta'til, kasallik, avans) — otdel kadr 24 soatda ko'rib chiqmagan bo'lsa
    type: "REMIND_HR_REQUEST",
    find: async (now) => (await db.hrRequest.findMany({
      where: { status: "PENDING", createdAt: { lt: ago(now, 24) } }, take: 50,
      select: { id: true, docNo: true, createdAt: true, employee: { select: { fullName: true } } },
    })).map((r) => ({ id: r.id, link: { key: "arizalar", id: r.id }, roles: ["HR"] as Role[], title: `Ariza kutmoqda — ${r.docNo}`, body: `${r.employee.fullName} · ${hrs(r.createdAt, now)} soatdan beri ko'rib chiqilmagan` })),
  },
  {
    // Ish haqi: direktor tasdig'i va kassa to'lovi kutilayotgan vedomostlar
    type: "REMIND_PAYROLL",
    find: async (now) => (await db.payrollRun.findMany({
      where: { OR: [{ status: "SUBMITTED", submittedAt: { lt: ago(now, 12) } }, { status: "APPROVED", approvedAt: { lt: ago(now, 24) } }] }, take: 20,
      select: { id: true, docNo: true, status: true, submittedAt: true, approvedAt: true },
    })).map((r) => ({
      id: r.id, link: { key: "ish-haqi", id: r.id }, roles: (r.status === "SUBMITTED" ? ["DIRECTOR"] : ["CASHIER"]) as Role[],
      title: `Ish haqi kutmoqda — ${r.docNo}`, body: `${hrs((r.status === "SUBMITTED" ? r.submittedAt : r.approvedAt) ?? now, now)} soatdan beri ${r.status === "SUBMITTED" ? "tasdiqlanmagan" : "to'lanmagan"}`,
    })),
  },
  {
    // Vazifalar: muddati o'tgan — bajaruvchiga; tekshiruvda 24 soat qolgan — beruvchiga
    type: "REMIND_WORK_TASK",
    find: async (now) => {
      const today0 = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const [late, review] = await Promise.all([
        db.workTask.findMany({ where: { status: { in: ["TODO", "IN_PROGRESS"] }, dueDate: { lt: today0 } }, take: 50, select: { id: true, docNo: true, title: true, assignee: { select: { userId: true } } } }),
        db.workTask.findMany({ where: { status: "REVIEW", doneAt: { lt: ago(now, 24) } }, take: 50, select: { id: true, docNo: true, title: true, createdById: true } }),
      ]);
      return [
        ...late.filter((t) => t.assignee.userId).map((t) => ({ id: t.id, link: { key: "vazifalarim", id: t.id }, users: [t.assignee.userId!], title: `Muddati o'tgan vazifa — ${t.docNo}`, body: t.title })),
        ...review.map((t) => ({ id: t.id, link: { key: "vazifalarim", id: t.id }, users: [t.createdById], title: `Vazifa tekshiruvni kutmoqda — ${t.docNo}`, body: t.title })),
      ];
    },
  },
  {
    // Sinov muddati 7 kun ichida tugaydi (yoki o'tib ketgan) — natijani otdel kadr qayd etsin
    type: "REMIND_PROBATION",
    find: async (now) => (await db.onboardingPlan.findMany({
      where: { status: { in: ["ACTIVE", "EXTENDED"] }, probationEnd: { lte: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 7)) } }, take: 50,
      select: { id: true, employeeId: true, probationEnd: true, employee: { select: { fullName: true } } },
    })).map((p) => ({ id: p.id, link: { key: "employees", id: p.employeeId }, roles: ["HR"] as Role[], title: `Sinov muddati tugaydi — ${p.employee.fullName}`, body: `${p.probationEnd!.toISOString().slice(0, 10)} · natijani qayd eting (o'tdi / uzaytirish / o'tmadi)` })),
  },
  {
    // Majburiy kurs muddati o'tgan, hali topshirilmagan — xodimga
    type: "REMIND_COURSE",
    find: async (now) => (await db.courseEnrollment.findMany({
      where: { status: { not: "PASSED" }, dueDate: { lt: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) }, course: { isActive: true } }, take: 50,
      select: { id: true, courseId: true, course: { select: { title: true } }, employee: { select: { userId: true } } },
    })).filter((e) => e.employee.userId).map((e) => ({ id: e.id, link: { key: "kurslarim", id: e.courseId }, users: [e.employee.userId!], title: "Kurs muddati o'tdi", body: `${e.course.title} — testni topshiring` })),
  },
  {
    type: "REMIND_SMM",
    find: async (now) => [
      ...(await db.marketingContent.findMany({
        where: { approval: "PENDING", status: { notIn: ["CANCELLED", "PUBLISHED"] }, updatedAt: { lt: ago(now, 12) } }, take: 20, select: { id: true, title: true, updatedAt: true },
      })).map((c) => ({ id: c.id, link: { key: "smm", id: c.id }, roles: ["DIRECTOR"] as Role[], title: "Post tasdiqlashni kutmoqda", body: `${c.title} · ${hrs(c.updatedAt, now)} soatdan beri` })),
      ...(await db.smmBoost.findMany({
        where: { status: "PENDING_APPROVAL", createdAt: { lt: ago(now, 12) } }, take: 20, select: { id: true, createdAt: true, content: { select: { title: true } } },
      })).map((b) => ({ id: b.id, link: { key: "boost", id: b.id }, roles: ["DIRECTOR"] as Role[], title: "Target so'rovi kutmoqda", body: `${b.content.title} · ${hrs(b.createdAt, now)} soatdan beri` })),
    ],
  },
];

/** Bitta aylanish: qoidalar bo'yicha topilganlarga (oxirgi `REPEAT_H` soatda eslatilmaganlarga) xabar */
export async function runReminders(now = new Date()): Promise<number> {
  const h = now.getHours();
  if (h < 8 || h >= 21) return 0;
  let sent = 0;
  for (const rule of RULES) {
    let due: Due[];
    try { due = await rule.find(now); } catch (e) { console.error("[reminders]", rule.type, e instanceof Error ? e.message : e); continue; }
    if (!due.length) continue;
    // Shu turdagi yaqinda yuborilgan eslatmalar (link JSON ichida id) — takrorlanmasin
    const recent = await db.notification.findMany({
      where: { type: rule.type, createdAt: { gt: ago(now, REPEAT_H) } }, select: { link: true },
    });
    const seen = new Set(recent.map((r) => (r.link as { id?: string } | null)?.id).filter(Boolean));
    for (const d of due) {
      if (seen.has(d.id)) continue;
      const n = { type: rule.type, title: d.title, body: d.body, link: d.link };
      if (d.roles?.length) await notifyRoles(d.roles, n);
      if (d.users?.length) await notifyUsers(d.users, n);
      seen.add(d.id);
      sent++;
    }
  }
  // Arenda: oyning belgilangan sanasidan qarzdor ijarachilarga Telegram eslatma (oyda bir marta) — `lib/rent-tenant.ts`
  try { sent += await runRentReminders(now); } catch (e) { console.error("[reminders] arenda", e instanceof Error ? e.message : e); }
  return sent;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startReminders(intervalMs = 30 * 60_000) {
  if (timer) return;
  const tick = () => {
    if (running) return;
    running = true;
    runReminders().catch((e) => console.error("[reminders]", e)).finally(() => { running = false; });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 5 * 60_000).unref?.();
}
