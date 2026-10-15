import type { MechanicRequestStatus, MechanicTarget, Prisma, Role, TransportExpenseKind } from "@/generated/prisma";
import { Prisma as P } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { MAX_AMOUNT } from "./action";
import { money } from "./format";
import { accountBalances, cashOutflowError } from "./payments";
import { notifyAfter, notifyRoles, notifyUsers } from "./notify";
import { removeRequestPhoto, saveRequestPhoto } from "./uploads";

/**
 * Mexanik so'rovi ("Kirim") — mexanik ta'mir / ehtiyot qism uchun pul so'raydi, Snabjeniye zanjiri kabi:
 *
 *   Mexanik so'raydi (NEW)  →  Ish boshqaruvchi tasdiqlaydi (APPROVED) yoki rad etadi (REJECTED)
 *   →  Kassa pul beradi (PAID): Kirim-Chiqimga chiqim, transport bo'lsa — transport xarajati ham.
 *
 * Tasdiqsiz kassa pul bermaydi: to'lov faqat APPROVED holatdan, shartli `updateMany` bilan.
 * Mexanik o'z so'rovini tasdiqdan oldin bekor qila oladi (CANCELLED). Hujjat o'chirilmaydi — har qadam auditda.
 * Veb (`app/(app)/mexanik-sorovlar`) ham, mobil ilova (`lib/mobile/*`, kalit `kirim`) ham shu funksiyalarni chaqiradi.
 */

// ───────────────────────── Spravochniklar ─────────────────────────

/** Transport uchun muammo turlari. */
export const PROBLEMS = ["Ta'mir", "Ehtiyot qism", "Shina", "Moy almashtirish", "Akkumulyator", "Elektr", "Yuvish", "Boshqa"] as const;
/** Zavod uchun muammo turlari (shina, yuvish — mashinaniki, bu yerda yo'q). */
export const FACTORY_PROBLEMS = ["Ta'mir", "Ehtiyot qism", "Elektr", "Moy almashtirish", "Boshqa"] as const;
/** Zavoddagi obyektlar (uskuna, tarmoq, bino). "Boshqa" — izoh bilan. */
export const FACTORY_OBJECTS = ["Beton uzeli (BSU)", "Kompressor", "Elektr tarmog'i", "Bino / tom", "Suv / nasos", "Payvand", "Boshqa"] as const;
/** "Boshqa xarajat" so'rovida muammo turi tanlanmaydi. */
export const OTHER_PROBLEM = "Boshqa";

export const TARGET_LABEL: Record<MechanicTarget, string> = { TRANSPORT: "Transport", FACTORY: "Zavod", OTHER: "Boshqa xarajat" };

export const MECH_STATUS_LABEL: Record<MechanicRequestStatus, string> = {
  NEW: "Tasdiq kutilmoqda",
  APPROVED: "Tasdiqlangan — kassa kutilmoqda",
  PAID: "Pul berildi",
  REJECTED: "Rad etildi",
  CANCELLED: "Bekor qilindi",
};
/** Qisqa yorliq — ro'yxat va chiplar uchun. */
export const MECH_STATUS_SHORT: Record<MechanicRequestStatus, string> = {
  NEW: "Kutilmoqda", APPROVED: "Tasdiqlangan", PAID: "Berilgan", REJECTED: "Rad etilgan", CANCELLED: "Bekor qilingan",
};
/** Veb `Badge` rangi. */
export const MECH_STATUS_COLOR: Record<MechanicRequestStatus, "slate" | "amber" | "blue" | "green" | "red"> = {
  NEW: "amber", APPROVED: "blue", PAID: "green", REJECTED: "red", CANCELLED: "slate",
};
/** Mobil ilova ohangi (`lib/mobile/home.ts` Tone). */
export const MECH_STATUS_TONE: Record<MechanicRequestStatus, "brand" | "success" | "warning" | "danger" | "info"> = {
  NEW: "warning", APPROVED: "brand", PAID: "success", REJECTED: "danger", CANCELLED: "info",
};

/** Ro'yxat filtrlari — veb tablari va ilova chiplari bir xil. Sukut — hammasi, yangisi tepada. */
export const MECH_TABS: { key: string; label: string; status: MechanicRequestStatus[] | null }[] = [
  { key: "all", label: "Hammasi", status: null },
  { key: "NEW", label: "Kutilmoqda", status: ["NEW"] },
  { key: "APPROVED", label: "Tasdiqlangan", status: ["APPROVED"] },
  { key: "PAID", label: "Berilgan", status: ["PAID"] },
  { key: "REJECTED", label: "Rad etilgan", status: ["REJECTED", "CANCELLED"] },
];
export const mechTab = (key?: string | null) => MECH_TABS.find((t) => t.key === key) ?? MECH_TABS[0];

/** Kim nima qiladi. Vebda direktor tasdiq/rad va to'lovni ham bajaradi; mobil `can()` qat'iy — `lib/mobile/detail.ts`. */
export const MECH_ROLES = {
  create: ["MECHANIC"],
  decide: ["SUPERVISOR"],
  pay: ["CASHIER"],
  /** Ro'yxatni ko'radiganlar (direktor — har doim) */
  view: ["MECHANIC", "SUPERVISOR", "CASHIER"],
} as const satisfies Record<string, readonly Role[]>;

/** Kirim-Chiqimdagi chiqim toifasi — `EXPENSE_CATEGORIES` dagi mavjud nomlar ("Transport" alias'i yoqilg'iga tushadi). */
export const MECH_CATEGORY: Record<MechanicTarget, string> = { TRANSPORT: "Ta'mirlash / ehtiyot qism", FACTORY: "Ta'mirlash / ehtiyot qism", OTHER: "Boshqa chiqim" };
/** `CashTransaction.refType` — Kirim-Chiqimdan so'rovga o'tish uchun. */
export const MECH_REF = "MechanicRequest";

/** Muammo turi → transport xarajati turi (Logistika → Transport xarajatlari). */
const EXPENSE_KIND_OF: Record<string, TransportExpenseKind> = {
  "Ta'mir": "REPAIR", "Elektr": "REPAIR", "Ehtiyot qism": "PARTS", "Shina": "PARTS", "Moy almashtirish": "PARTS", "Akkumulyator": "PARTS", "Yuvish": "WASH",
};

export type MechResult = { id?: string; docNo?: string; error?: string; note?: string; existed?: boolean };

const ROUND = (n: number) => Math.round(n * 100) / 100;
const clean = (s: string | null | undefined, max = 500) => { const t = (s ?? "").trim(); return t ? t.slice(0, max) : null; };
/** Ilova bir martalik kalit yuboradi (UUID) — g'alati qiymat e'tiborsiz (mobil `TransferBody` bilan bir xil qoida). */
export const mechToken = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v.trim()) ? v.trim() : null);
const STALE = "So'rov boshqa joyda o'zgartirildi — sahifani yangilang";

/** So'rov nomi bildirishnoma va ro'yxatlar uchun: mashina raqami yoki obyekt. */
export const mechSubject = (r: { target: MechanicTarget; object: string | null; vehicle?: { plate: string } | null }) =>
  r.target === "TRANSPORT" ? (r.vehicle?.plate ?? "Transport") : (r.object ?? TARGET_LABEL[r.target]);

function guard(r: { status: MechanicRequestStatus } | null, expect: MechanicRequestStatus[]): string | null {
  if (!r) return "So'rov topilmadi";
  if (!expect.includes(r.status)) return `Bu amal "${MECH_STATUS_LABEL[r.status]}" holatida bajarilmaydi — sahifani yangilang`;
  return null;
}
class MechError extends Error {}

const full = {
  vehicle: { select: { id: true, plate: true, type: true, brand: true, model: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.MechanicRequestInclude;
export type MechFull = Prisma.MechanicRequestGetPayload<{ include: typeof full }>;

/** So'rov + qaror/to'lov qilgan xodimlar va kassa hisobi (relation yo'q ustunlar alohida o'qiladi). */
export async function mechanicRequest(id: string) {
  const r = await db.mechanicRequest.findUnique({ where: { id }, include: full });
  if (!r) return null;
  const ids = [r.decidedById, r.paidById].filter((x): x is string => !!x);
  const [users, acc] = await Promise.all([
    ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : Promise.resolve([]),
    r.cashAccountId ? db.cashAccount.findUnique({ where: { id: r.cashAccountId }, select: { id: true, name: true, type: true } }) : Promise.resolve(null),
  ]);
  const name = (uid: string | null) => (uid ? users.find((u) => u.id === uid)?.fullName ?? "—" : null);
  return { ...r, decidedBy: name(r.decidedById), paidBy: name(r.paidById), cashAccount: acc };
}
export type MechDetail = NonNullable<Awaited<ReturnType<typeof mechanicRequest>>>;

/** Ro'yxat: mexanik — faqat o'zinikini, qolganlar — hammasini. */
export async function mechanicList(opts: { status?: MechanicRequestStatus[] | null; createdById?: string | null; q?: string | null; take?: number }) {
  const q = opts.q?.trim();
  return db.mechanicRequest.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.createdById ? { createdById: opts.createdById } : {}),
      ...(q ? { OR: [{ docNo: { contains: q, mode: "insensitive" } }, { object: { contains: q, mode: "insensitive" } }, { problem: { contains: q, mode: "insensitive" } }, { vehicle: { plate: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 200,
    include: full,
  });
}

/** Holat bo'yicha soni (chiplar uchun). */
export async function mechanicCounts(createdById?: string | null) {
  const g = await db.mechanicRequest.groupBy({ by: ["status"], where: createdById ? { createdById } : {}, _count: { _all: true }, _sum: { amount: true } });
  const by = (s: MechanicRequestStatus) => g.find((x) => x.status === s);
  const counts = Object.fromEntries((["NEW", "APPROVED", "PAID", "REJECTED", "CANCELLED"] as const).map((s) => [s, by(s)?._count._all ?? 0])) as Record<MechanicRequestStatus, number>;
  const sums = Object.fromEntries((["NEW", "APPROVED", "PAID"] as const).map((s) => [s, Number(by(s)?._sum.amount ?? 0)])) as Record<"NEW" | "APPROVED" | "PAID", number>;
  return { counts, sums, total: g.reduce((n, x) => n + x._count._all, 0) };
}
export const tabCount = (counts: Record<MechanicRequestStatus, number>, t: (typeof MECH_TABS)[number]) =>
  t.status ? t.status.reduce((n, s) => n + counts[s], 0) : Object.values(counts).reduce((a, b) => a + b, 0);

// ───────────────────────── 1. Mexanik: so'rov ─────────────────────────

export type MechInput = {
  target: MechanicTarget;
  vehicleId?: string | null;
  object?: string | null;
  problem?: string | null;
  amount: number;
  note?: string | null;
  urgent?: boolean;
  /** Muammo / chek surati (mobil data-URL `dataUrlFile` bilan `File` ga keltiriladi) */
  photo?: File | null;
  clientToken?: string | null;
};

export async function createMechanicRequest(input: MechInput, userId: string): Promise<MechResult> {
  const token = mechToken(input.clientToken);
  // Idempotentlik: shu kalit bilan so'rov allaqachon bor — o'shani qaytaramiz (tarmoq uzilib qayta yuborilgan)
  if (token) {
    const dup = await db.mechanicRequest.findUnique({ where: { clientToken: token }, select: { id: true, docNo: true, createdById: true } });
    if (dup) return dup.createdById === userId ? { id: dup.id, docNo: dup.docNo, existed: true } : { error: "So'rov kaliti band — formani qayta oching" };
  }
  const amount = ROUND(Number(input.amount));
  if (!Number.isFinite(amount) || !(amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  if (amount > MAX_AMOUNT) return { error: "Summa juda katta" };
  const note = clean(input.note);
  if (!note || note.length < 3) return { error: "Muammo tavsifini yozing — nima buzildi, nima kerak" };

  let vehicleId: string | null = null, object: string | null = null, problem: string;
  let subject: string;
  if (input.target === "TRANSPORT") {
    const v = input.vehicleId ? await db.vehicle.findUnique({ where: { id: input.vehicleId }, select: { id: true, plate: true, isActive: true } }) : null;
    if (!v || !v.isActive) return { error: "Mashina tanlanmagan yoki faol emas" };
    if (!(PROBLEMS as readonly string[]).includes(input.problem ?? "")) return { error: "Muammo turini tanlang" };
    vehicleId = v.id; problem = input.problem!; subject = v.plate;
  } else if (input.target === "FACTORY") {
    object = clean(input.object, 200);
    if (!object) return { error: "Obyektni tanlang" };
    if (!(FACTORY_OBJECTS as readonly string[]).some((o) => object === o || object!.startsWith(`${o}:`))) return { error: "Obyekt noto'g'ri tanlangan" };
    if (!(FACTORY_PROBLEMS as readonly string[]).includes(input.problem ?? "")) return { error: "Muammo turini tanlang" };
    problem = input.problem!; subject = object;
  } else if (input.target === "OTHER") {
    object = clean(input.object, 200);
    if (!object) return { error: "Nima uchun kerakligini yozing" };
    problem = OTHER_PROBLEM; subject = object;
  } else return { error: "So'rov turi noto'g'ri" };

  const saved = await saveRequestPhoto(input.photo ?? null);
  if (saved && "error" in saved) return { error: saved.error };
  const photo = saved?.stored ?? null;

  let r: { id: string; docNo: string };
  try {
    r = await db.$transaction(async (tx) => {
      const x = await tx.mechanicRequest.create({
        data: {
          docNo: await nextNo(tx, "mechanicRequest", "MX"), target: input.target, vehicleId, object, problem, amount, note,
          photo, urgent: !!input.urgent, clientToken: token, createdById: userId,
        },
      });
      await audit(tx, userId, "CREATE", "MechanicRequest", x.id, undefined, x);
      return x;
    });
  } catch (e) {
    await removeRequestPhoto(photo);
    // Poyga: bir xil kalitli ikki so'rov birga kelsa — ikkinchisi unique xatosini oladi, birinchisini qaytaramiz
    if (token && e instanceof P.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await db.mechanicRequest.findUnique({ where: { clientToken: token }, select: { id: true, docNo: true } });
      if (dup) return { id: dup.id, docNo: dup.docNo, existed: true };
    }
    throw e;
  }
  // Ish boshqaruvchi tasdiqlaydi; kassa oldindan biladi ("tasdiq kutilmoqda" — hali pul bermaydi)
  const body = `${subject} · ${problem} · ${money(amount)}${input.urgent ? " · SHOSHILINCH" : ""}`;
  notifyAfter(async () => {
    await notifyRoles(["SUPERVISOR"], { type: "KIRIM_NEW", title: `Mexanik so'rovi — ${r.docNo}`, body: `${body} — tasdiqlang yoki rad eting`, link: { key: "kirim", id: r.id } }, { except: userId });
    await notifyRoles(["CASHIER"], { type: "KIRIM_NEW", title: `Mexanik so'rovi — ${r.docNo}`, body: `${body} — ish boshqaruvchi tasdig'i kutilmoqda`, link: { key: "kirim", id: r.id }, channel: "oddiy" }, { except: userId });
  });
  return { id: r.id, docNo: r.docNo, note: "So'rov yuborildi — ish boshqaruvchi tasdig'ini kutmoqda" };
}

// ───────────────────────── 2. Ish boshqaruvchi: tasdiq / rad ─────────────────────────

export async function approveMechanicRequest(id: string, userId: string): Promise<MechResult> {
  const r = await db.mechanicRequest.findUnique({ where: { id }, include: { vehicle: { select: { plate: true } } } });
  const err = guard(r, ["NEW"]);
  if (err || !r) return { error: err ?? "Topilmadi" };
  const now = new Date();
  const res = await db.$transaction(async (tx) => {
    const u = await tx.mechanicRequest.updateMany({ where: { id, status: "NEW" }, data: { status: "APPROVED", decidedById: userId, decidedAt: now } });
    if (u.count !== 1) throw new MechError(STALE);
    await audit(tx, userId, "STATUS_CHANGE", "MechanicRequest", id, { status: r.status }, { status: "APPROVED", docNo: r.docNo, amount: Number(r.amount) });
  }).catch((e: Error) => { if (e instanceof MechError) return { error: e.message }; throw e; });
  if (res && "error" in res) return { error: res.error };
  const subject = mechSubject(r);
  notifyAfter(async () => {
    await notifyRoles(["CASHIER"], { type: "KIRIM_APPROVED", title: `Pul berish kerak — ${r.docNo}`, body: `${subject} · ${r.problem} · ${money(Number(r.amount))} — ish boshqaruvchi tasdiqladi`, link: { key: "kirim", id } }, { except: userId });
    await notifyUsers([r.createdById === userId ? null : r.createdById], { type: "KIRIM_APPROVED", title: `So'rov tasdiqlandi — ${r.docNo}`, body: `${subject} · ${money(Number(r.amount))} — kassadan olishingiz mumkin`, link: { key: "kirim", id } });
  });
  return { id, docNo: r.docNo, note: "Tasdiqlandi — kassa pul beradi" };
}

export async function rejectMechanicRequest(id: string, reason: string, userId: string): Promise<MechResult> {
  const why = clean(reason, 500);
  if (!why || why.length < 3) return { error: "Rad etish sababini yozing" };
  const r = await db.mechanicRequest.findUnique({ where: { id }, include: { vehicle: { select: { plate: true } } } });
  const err = guard(r, ["NEW"]);
  if (err || !r) return { error: err ?? "Topilmadi" };
  const res = await db.$transaction(async (tx) => {
    const u = await tx.mechanicRequest.updateMany({ where: { id, status: "NEW" }, data: { status: "REJECTED", decidedById: userId, decidedAt: new Date(), rejectReason: why } });
    if (u.count !== 1) throw new MechError(STALE);
    await audit(tx, userId, "STATUS_CHANGE", "MechanicRequest", id, { status: r.status }, { status: "REJECTED", docNo: r.docNo, reason: why });
  }).catch((e: Error) => { if (e instanceof MechError) return { error: e.message }; throw e; });
  if (res && "error" in res) return { error: res.error };
  notifyAfter(() => notifyUsers([r.createdById === userId ? null : r.createdById], {
    type: "KIRIM_REJECTED", title: `So'rov rad etildi — ${r.docNo}`, body: `${mechSubject(r)} · ${money(Number(r.amount))} — sabab: ${why}`, link: { key: "kirim", id },
  }));
  // Kassaga yaratilganda «tasdiq kutilmoqda» xabari ketgan — endi pul berilmasligini bilsin
  notifyAfter(() => notifyRoles(["CASHIER"], {
    type: "KIRIM_REJECTED", title: `So'rov rad etildi — ${r.docNo}`, body: `${mechSubject(r)} · pul berilmaydi`, link: { key: "kirim", id }, channel: "oddiy",
  }, { except: userId }));
  return { id, docNo: r.docNo, note: "So'rov rad etildi" };
}

// ───────────────────────── 3. Kassa: pul berish ─────────────────────────

/**
 * Faqat tasdiqlangan (APPROVED) so'rov. Bitta tranzaksiyada: holat APPROVED→PAID (shartli), Kirim-Chiqimga
 * chiqim (kassa qoldig'idan oshmaydi — `cashOutflowError`, hisob qulfi ostida), transport bo'lsa — transport
 * xarajati (Logistika → Transport xarajatlari). Ikki marta bosilsa ikkinchisi hech narsa yozmaydi.
 */
export async function payMechanicRequest(id: string, input: { cashAccountId: string; note?: string | null }, userId: string): Promise<MechResult> {
  const r = await db.mechanicRequest.findUnique({ where: { id }, include: { vehicle: { select: { plate: true } }, createdBy: { select: { fullName: true } } } });
  const err = guard(r, ["APPROVED"]);
  if (err || !r) return { error: err ?? "Topilmadi" };
  const acc = input.cashAccountId ? await db.cashAccount.findUnique({ where: { id: input.cashAccountId } }) : null;
  if (!acc || !acc.isActive) return { error: "Kassa / hisob tanlanmagan" };
  const amount = Number(r.amount);
  const extra = clean(input.note, 300);
  const subject = mechSubject(r);
  const now = new Date();

  const res = await db.$transaction(async (tx) => {
    // Avval holat egallanadi — ikkinchi bosish chiqimni ikki marta yozmasin
    const u = await tx.mechanicRequest.updateMany({ where: { id, status: "APPROVED" }, data: { status: "PAID", paidById: userId, paidAt: now, cashAccountId: acc.id } });
    if (u.count !== 1) throw new MechError(STALE);
    const cashErr = await cashOutflowError(tx, acc.id, amount);
    if (cashErr) throw new MechError(cashErr);
    const ct = await tx.cashTransaction.create({
      data: {
        type: "EXPENSE", date: now, cashAccountId: acc.id, amount, category: MECH_CATEGORY[r.target],
        counterparty: r.createdBy.fullName, refType: MECH_REF, refId: id, createdById: userId,
        note: [`Mexanik so'rovi ${r.docNo}`, `${subject} · ${r.problem}`, extra].filter(Boolean).join(" · "),
      },
    });
    let teId: string | null = null;
    if (r.target === "TRANSPORT" && r.vehicleId) {
      const te = await tx.transportExpense.create({
        data: { date: now, kind: EXPENSE_KIND_OF[r.problem] ?? "OTHER", vehicleId: r.vehicleId, amount, note: `${r.docNo} · ${r.problem}${r.note ? ` · ${r.note}` : ""}`.slice(0, 500), createdById: userId },
      });
      await audit(tx, userId, "CREATE", "TransportExpense", te.id, undefined, te);
      teId = te.id;
    }
    await tx.mechanicRequest.update({ where: { id }, data: { cashTxId: ct.id, transportExpenseId: teId } });
    await audit(tx, userId, "CREATE", "CashTransaction", ct.id, undefined, ct);
    await audit(tx, userId, "STATUS_CHANGE", "MechanicRequest", id, { status: r.status }, { status: "PAID", docNo: r.docNo, amount, cashAccountId: acc.id, cashTxId: ct.id, transportExpenseId: teId });
  }).catch((e: Error) => { if (e instanceof MechError) return { error: e.message }; throw e; });
  if (res && "error" in res) return { error: res.error };
  notifyAfter(() => notifyUsers([r.createdById === userId ? null : r.createdById], {
    type: "KIRIM_PAID", title: `Pul berildi — ${r.docNo}`, body: `${subject} · ${money(amount)} · ${acc.name}`, link: { key: "kirim", id },
  }));
  // Tasdiqlagan ish boshqaruvchi — so'rov yopilganini bilsin
  notifyAfter(() => notifyUsers([r.decidedById === userId ? null : r.decidedById], {
    type: "KIRIM_PAID", title: `Pul berildi — ${r.docNo}`, body: `${subject} · ${money(amount)}`, link: { key: "kirim", id }, channel: "oddiy",
  }));
  return { id, docNo: r.docNo, note: `Pul berildi: ${money(amount)} · ${acc.name}` };
}

// ───────────────────────── 4. Mexanik: bekor qilish ─────────────────────────

/** Faqat o'z so'rovi va faqat tasdiqdan oldin (NEW). */
export async function cancelMechanicRequest(id: string, userId: string): Promise<MechResult> {
  const r = await db.mechanicRequest.findUnique({ where: { id }, include: { vehicle: { select: { plate: true } } } });
  const err = guard(r, ["NEW"]);
  if (err || !r) return { error: err ?? "Topilmadi" };
  if (r.createdById !== userId) return { error: "Faqat o'z so'rovingizni bekor qila olasiz" };
  const res = await db.$transaction(async (tx) => {
    const u = await tx.mechanicRequest.updateMany({ where: { id, status: "NEW", createdById: userId }, data: { status: "CANCELLED", decidedAt: new Date() } });
    if (u.count !== 1) throw new MechError(STALE);
    await audit(tx, userId, "STATUS_CHANGE", "MechanicRequest", id, { status: r.status }, { status: "CANCELLED", docNo: r.docNo });
  }).catch((e: Error) => { if (e instanceof MechError) return { error: e.message }; throw e; });
  if (res && "error" in res) return { error: res.error };
  notifyAfter(() => notifyRoles(["SUPERVISOR"], {
    type: "KIRIM_CANCELLED", title: `So'rov bekor qilindi — ${r.docNo}`, body: `${mechSubject(r)} · ${money(Number(r.amount))} — mexanik o'zi bekor qildi`, link: { key: "kirim", id }, channel: "oddiy",
  }, { except: userId }));
  notifyAfter(() => notifyRoles(["CASHIER"], {
    type: "KIRIM_CANCELLED", title: `So'rov bekor qilindi — ${r.docNo}`, body: `${mechSubject(r)} · pul berilmaydi`, link: { key: "kirim", id }, channel: "oddiy",
  }, { except: userId }));
  return { id, docNo: r.docNo, note: "So'rov bekor qilindi" };
}

/** Faol kassa/bank hisoblari qoldig'i bilan — to'lov tanlovi uchun (veb va ilova). */
export async function payAccounts() {
  const [accounts, bal] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, allowOverdraft: true } }),
    accountBalances(),
  ]);
  return accounts.map((a) => ({ ...a, balance: bal.get(a.id) ?? 0 }));
}
