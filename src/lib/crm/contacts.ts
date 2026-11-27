import { Prisma, type CrmClientStatus } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dbToIso, isoToDb, todayIso } from "./dates";

/**
 * Sotuv CRM — aloqalar (docs/CRM_SPEC.md 3.2, 4.2, 4.3). Aloqa tahrirlanmaydi; faqat menejer bekor qiladi.
 * Har saqlash / bekor qilishdan keyin mijozning keshi (oxirgi va keyingi aloqa sanasi) va avto-holati qayta hisoblanadi.
 */

type Tx = Prisma.TransactionClient;

export type ContactInput = {
  customerId: string;
  date: string; // yyyy-mm-dd
  channelId: string | null;
  resultId: string;
  productId: string | null;
  offeredPrice: number | null;
  nextContactDate: string | null; // yyyy-mm-dd
  leadSourceId: string | null;
  objectName: string | null;
  objectArea: string | null;
  note: string | null;
  clientToken: string | null;
};

export type SaveContactResult = { ok: true; id: string; win: boolean } | { ok: false; error: string; field?: string };

/** Aloqani saqlash. `clientToken` takror kelsa (ikki marta bosilgan) — mavjud yozuv qaytadi. */
export async function saveContact(input: ContactInput, userId: string): Promise<SaveContactResult> {
  const today = todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > today || input.date < "2020-01-01") return { ok: false, error: "Sana noto'g'ri", field: "date" };

  const [customer, result] = await Promise.all([
    db.customer.findFirst({ where: { id: input.customerId, isInternal: false }, select: { id: true, sourceId: true } }),
    db.crmResult.findUnique({ where: { id: input.resultId } }),
  ]);
  if (!customer) return { ok: false, error: "Mijoz topilmadi" };
  if (!result || !result.isActive) return { ok: false, error: "Natijani tanlang", field: "resultId" };

  // Keyingi aloqa sanasi qoidasi (3.5-jadval)
  let next = input.nextContactDate;
  if (result.nextRule === "NONE") next = null;
  if (next && (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next < input.date)) return { ok: false, error: "Keyingi aloqa sanasi aloqa sanasidan oldin bo'lmasin", field: "nextContactDate" };
  if (result.nextRule === "REQUIRED" && !next) return { ok: false, error: `«${result.label}» uchun keyingi aloqa sanasi majburiy`, field: "nextContactDate" };

  const optIds = [input.channelId, input.productId, input.leadSourceId].filter((x): x is string => !!x);
  if (optIds.length) {
    const found = await db.crmOption.count({ where: { id: { in: optIds } } });
    if (found !== new Set(optIds).size) return { ok: false, error: "Ro'yxat qiymati noto'g'ri" };
  }

  try {
    const id = await db.$transaction(async (tx) => {
      const c = await tx.crmContact.create({
        data: {
          customerId: customer.id,
          date: isoToDb(input.date),
          channelId: input.channelId,
          resultId: result.id,
          productId: input.productId,
          offeredPrice: input.offeredPrice,
          nextContactDate: next ? isoToDb(next) : null,
          userId,
          leadSourceId: input.leadSourceId ?? customer.sourceId,
          objectName: input.objectName,
          objectArea: input.objectArea,
          note: input.note,
          clientToken: input.clientToken,
        },
      });
      await audit(tx, userId, "CREATE", "CrmContact", c.id, undefined, c);
      await refreshClient(tx, customer.id, userId);
      return c.id;
    });
    return { ok: true, id, win: result.group === "WIN" };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && input.clientToken) {
      const prev = await db.crmContact.findUnique({ where: { clientToken: input.clientToken }, select: { id: true, result: { select: { group: true } } } });
      if (prev) return { ok: true, id: prev.id, win: prev.result?.group === "WIN" };
    }
    throw e;
  }
}

/** Menejer aloqani bekor qiladi (sababi bilan). Yozuv o'chmaydi — tarixda «Bekor qilingan» bo'lib qoladi. */
export async function cancelContact(id: string, reason: string, userId: string): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  const why = reason.trim();
  if (why.length < 3) return { ok: false, error: "Sababini yozing" };
  return db.$transaction(async (tx) => {
    const n = await tx.crmContact.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: why.slice(0, 500) } });
    const c = await tx.crmContact.findUnique({ where: { id }, select: { customerId: true } });
    if (!c) return { ok: false as const, error: "Aloqa topilmadi" };
    if (n.count === 0) return { ok: false as const, error: "Aloqa allaqachon bekor qilingan" };
    await audit(tx, userId, "STATUS_CHANGE", "CrmContact", id, { cancelledAt: null }, { cancelledAt: new Date(), reason: why });
    await refreshClient(tx, c.customerId, userId);
    return { ok: true as const, customerId: c.customerId };
  });
}

/**
 * Mijozning CRM keshini va avto-holatini qayta hisoblash (4.3). Qo'lda qo'yilgan holat (`crmStatusManual`) ustidan yozilmaydi.
 *   aloqasi yo'q → Yangi; oxirgi natija bosqichi 1–3 → Aloqa qilindi; 4–5 → Muzokara;
 *   zayavkasi bor: oxirgisidan ≤ N kun → Ishlayotgan, > N kun → Eski mijoz; oxirgi natija Otkaz yoki Raqam noto'g'ri → Yo'qotilgan.
 * Ustuvorlik: yaqindagi zayavka (sotib olyapti) > yo'qotilgan > eski mijoz > aloqa bosqichi.
 */
export async function refreshClient(tx: Tx, customerId: string, userId?: string) {
  const [cust, last, lastOrder, cfg] = await Promise.all([
    tx.customer.findUnique({ where: { id: customerId }, select: { crmAt: true, crmStatus: true, crmStatusManual: true, lastContactAt: true, nextContactAt: true } }),
    tx.crmContact.findFirst({
      where: { customerId, cancelledAt: null },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { date: true, nextContactDate: true, result: { select: { stage: true, group: true } } },
    }),
    tx.order.findFirst({ where: { customerId, kind: "SALE", status: { not: "CANCELLED" } }, orderBy: { date: "desc" }, select: { date: true } }),
    tx.companySettings.findUnique({ where: { id: "main" }, select: { crmColdDays: true } }),
  ]);
  if (!cust) return;

  const cold = cfg?.crmColdDays ?? 90;
  const days = lastOrder ? Math.floor((Date.now() - lastOrder.date.getTime()) / 86_400_000) : null;
  const g = last?.result?.group;
  const stage = last?.result?.stage ?? (last ? 1 : 0);
  let status: CrmClientStatus;
  if (days !== null && days <= cold) status = "ACTIVE";
  else if (g === "REFUSAL" || g === "LOSS") status = "LOST";
  else if (days !== null) status = "OLD";
  else if (!last) status = "NEW";
  else if (g === "WIN") status = "ACTIVE";
  else if (stage >= 4) status = "NEGOTIATION";
  else status = "CONTACTED";

  const data = {
    crmAt: cust.crmAt ?? new Date(),
    lastContactAt: last?.date ?? null,
    nextContactAt: last?.nextContactDate ?? null,
    ...(cust.crmStatusManual ? {} : { crmStatus: status }),
  };
  const changed = !cust.crmAt || cust.crmStatus !== (data.crmStatus ?? cust.crmStatus)
    || iso(cust.lastContactAt) !== iso(data.lastContactAt) || iso(cust.nextContactAt) !== iso(data.nextContactAt);
  if (!changed) return;
  await tx.customer.update({ where: { id: customerId }, data });
  if (userId && data.crmStatus && data.crmStatus !== cust.crmStatus) {
    await audit(tx, userId, "STATUS_CHANGE", "CustomerCrm", customerId, { crmStatus: cust.crmStatus }, { crmStatus: data.crmStatus, auto: true });
  }
}
const iso = (d: Date | null | undefined) => (d ? dbToIso(d) : "");
