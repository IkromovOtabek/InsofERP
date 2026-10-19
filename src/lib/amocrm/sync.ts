/**
 * amoCRM ↔ ERP sinxroni. Qoidalar:
 *
 *  1. Sayt arizasi (ERP `Lead`) → amoCRM'da kontakt + sdelka («Sayt» tegi, ariza tafsilotlari eslatmada).
 *     `AmoDeal` qatori navbat vazifasini bajaradi: yuborilmasa keyinroq qayta urinadi (amoCRM ishlamasa ERP to'xtamaydi).
 *  2. Sdelka «ERP'ga» bosqichiga (`stageToErp`) o'tsa → webhook darhol, bo'lmasa 5 daqiqalik tekshiruv
 *     sdelkani API'dan qayta o'qiydi (webhook ma'lumotiga ishonilmaydi), ERP'da mijoz topiladi/ochiladi
 *     va kelishuv «Zayavka kutmoqda» bo'ladi. Zayavkani sotuvchi ERP'da ochadi (mahsulot, sana, narx — ERP'niki).
 *  3. Shu kelishuvdan ochilgan zayavkalarning holati va summasi sdelka bosqichi va byudjetiga qaytariladi.
 *     Oxirgi yuborilgan qiymat saqlanadi: o'zgarmasa so'rov ketmaydi, menejer amoCRM'da qo'lda siljitsa — qaytarilmaydi.
 */
import type { AmoConnection, AmoDeal, OrderStatus, Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseInn } from "@/lib/inn";
import { normalizePhone } from "@/lib/phone";
import { phoneTail, samePhone } from "@/lib/phone-lookup";
import { defaultCreditLimit } from "@/lib/finance";
import { syncCustomerLater } from "@/lib/eco/customers";
import { fmtNum, money } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import {
  addLeadNote, createLeadComplex, fieldByName, findContactByPhone, getCompany, getContact, getLead, getUser, leadsInStage, phonesOf, updateLead,
  type AmoLead,
} from "./api";
import { AmoError } from "./client";
import { amoSystemUserId, getConnection, isReady } from "./store";
import { webhookFieldByName, type WebhookLead } from "./webhook";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Qayta urinish oralig'i: 1, 5, 15, 60 daqiqa, keyin har 6 soatda */
const BACKOFF_MIN = [1, 5, 15, 60, 360];
const backoff = (attempt: number) => new Date(Date.now() + BACKOFF_MIN[Math.min(attempt, BACKOFF_MIN.length - 1)]! * 60_000);
/** Yuborish «egallash» muddati — ikki jarayon bitta arizani ikki marta yubormasin */
const LEASE_MS = 2 * 60_000;

// ───────────────────────── 1. Sayt arizasi → amoCRM ─────────────────────────

/** Yangi ariza tushganda (`createLead`) — javobdan keyin fon vazifada yuboriladi. */
export function pushLeadLater(leadId: string): void {
  notifyAfter(async () => {
    const c = await getConnection();
    if (!isReady(c) || !c.pushLeads) return;
    await queueLead(leadId);
    await pushLead(leadId, c);
  });
}

async function queueLead(leadId: string): Promise<void> {
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { id: true, name: true, phone: true, address: true } });
  if (!lead) return;
  try {
    await db.amoDeal.create({ data: { leadId, state: "PUSHING", name: lead.name, contactName: lead.name, phone: lead.phone, address: lead.address, nextPushAt: new Date() } });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e; // allaqachon navbatda
  }
}

/** Bitta arizani yuborish. Tashlamaydi: xato `pushError` ga yoziladi va keyinroq qayta urinadi. */
export async function pushLead(leadId: string, c: AmoConnection): Promise<boolean> {
  const now = new Date();
  const claimed = await db.amoDeal.updateMany({
    where: { leadId, state: "PUSHING", amoLeadId: null, OR: [{ nextPushAt: null }, { nextPushAt: { lte: now } }] },
    data: { nextPushAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count !== 1) return false;
  const deal = await db.amoDeal.findUniqueOrThrow({ where: { leadId } });
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { product: { select: { name: true, unit: true } } } });
  if (!lead) {
    await db.amoDeal.update({ where: { id: deal.id }, data: { state: "DISMISSED", pushError: "Ariza topilmadi" } });
    return false;
  }
  try {
    const contactId = await findContactByPhone(lead.phone, c).catch(() => null);
    const title = `Sayt: ${lead.name}${lead.product ? ` — ${lead.product.name}` : ""}`;
    const amoLeadId = await createLeadComplex({
      name: title, pipelineId: c.pipelineId, statusId: c.stageNewLead, tags: ["Sayt", lead.source !== "landing" ? lead.source : null].filter(Boolean) as string[],
      contact: { id: contactId, name: lead.name, phone: lead.phone },
    }, c);
    // Avval id saqlanadi: eslatma yiqilsa ham sdelka ikkinchi marta ochilmasin
    await db.amoDeal.update({ where: { id: deal.id }, data: { amoLeadId, state: "IN_AMO", name: title, pushError: null, nextPushAt: null } });
    const note = [
      "Insof ERP: saytdan ariza",
      `Ism: ${lead.name}`,
      `Telefon: ${lead.phone}`,
      lead.product ? `Mahsulot: ${lead.product.name}${lead.qty ? ` — ${fmtNum(lead.qty.toString(), 3)} ${unitLabel(lead.product.unit)}` : ""}` : null,
      lead.address ? `Manzil: ${lead.address}` : null,
      lead.message ? `Izoh: ${lead.message}` : null,
      lead.utmSource || lead.utmCampaign ? `Reklama: ${[lead.utmSource, lead.utmMedium, lead.utmCampaign, lead.utmContent].filter(Boolean).join(" / ")}` : null,
      lead.landingPage ? `Sahifa: ${lead.landingPage}` : null,
    ].filter(Boolean).join("\n");
    await addLeadNote(amoLeadId, note, c).catch((e) => console.warn("[amocrm] eslatma yozilmadi", amoLeadId, errText(e)));
    return true;
  } catch (e) {
    const attempts = deal.pushAttempts + 1;
    await db.amoDeal.update({ where: { id: deal.id }, data: { pushAttempts: attempts, pushError: errText(e), nextPushAt: backoff(attempts - 1) } });
    console.warn("[amocrm] ariza yuborilmadi", leadId, errText(e));
    return false;
  }
}

/** Navbatdagi arizalar: ulanishdan keyin tushgan, hali yuborilmaganlari va qayta urinish vaqti kelganlari */
export async function pushPendingLeads(c: AmoConnection): Promise<number> {
  if (!c.pushLeads) return 0;
  const fresh = await db.lead.findMany({ where: { createdAt: { gte: c.createdAt }, amoDeal: null }, select: { id: true }, take: 50 });
  for (const l of fresh) await queueLead(l.id);
  const due = await db.amoDeal.findMany({
    where: { state: "PUSHING", amoLeadId: null, leadId: { not: null }, OR: [{ nextPushAt: null }, { nextPushAt: { lte: new Date() } }] },
    select: { leadId: true }, orderBy: { createdAt: "asc" }, take: 30,
  });
  let n = 0;
  for (const d of due) if (await pushLead(d.leadId!, c)) n++;
  return n;
}

// ───────────────────────── 2. amoCRM sdelkasi → ERP ─────────────────────────

const INN_RE = /инн|inn|stir|стир/i;
const ADDRESS_RE = /адрес|manzil|obyekt|объект/i;
// Faqat webhook usulida: kontakt/kompaniya kartasi yo'q, shu ma'lumot sdelka maydonlaridan olinadi
const PHONE_RE = /телефон|telefon|phone/i;
const COMPANY_RE = /компани|kompaniya|организац|tashkilot|firma|фирма/i;
const CONTACT_RE = /контакт|kontakt|фио|f\.?i\.?sh|mas'ul shaxs/i;

const userNames = new Map<number, string>();
async function responsibleName(id: number, c: AmoConnection): Promise<string | null> {
  if (!id) return null;
  if (userNames.has(id)) return userNames.get(id)!;
  try {
    const u = await getUser(id, c);
    userNames.set(id, u.name);
    return u.name;
  } catch { return null; }
}

/** Sdelka tafsilotlari: asosiy kontakt, kompaniya, INN va manzil (maydon nomi bo'yicha) */
async function dealDetails(lead: AmoLead, c: AmoConnection) {
  const contactRef = lead._embedded?.contacts?.find((k) => k.is_main) ?? lead._embedded?.contacts?.[0];
  const companyRef = lead._embedded?.companies?.[0];
  const [contact, company, responsible] = await Promise.all([
    contactRef ? getContact(contactRef.id, c).catch(() => null) : null,
    companyRef ? getCompany(companyRef.id, c).catch(() => null) : null,
    responsibleName(lead.responsible_user_id, c),
  ]);
  const phoneRaw = phonesOf(contact?.custom_fields_values)[0] ?? phonesOf(company?.custom_fields_values)[0] ?? null;
  const innRaw = fieldByName(company?.custom_fields_values, INN_RE) ?? fieldByName(lead.custom_fields_values, INN_RE);
  const inn = innRaw ? parseInn(innRaw.replace(/\D+/g, "")).inn ?? null : null;
  return {
    contactName: contact?.name?.trim() || null,
    companyName: company?.name?.trim() || null,
    phone: normalizePhone(phoneRaw),
    inn,
    address: fieldByName(lead.custom_fields_values, ADDRESS_RE) ?? fieldByName(company?.custom_fields_values, ADDRESS_RE, "ADDRESS"),
    responsible,
  };
}

/** ERP mijozini topish (INN, keyin telefon) yoki ochish */
async function ensureCustomer(tx: Prisma.TransactionClient, d: { name: string; phone: string | null; inn: string | null; address: string | null }, actorId: string): Promise<{ id: string; created: boolean }> {
  if (d.inn) {
    const byInn = await tx.customer.findUnique({ where: { inn: d.inn }, select: { id: true } });
    if (byInn) return { id: byInn.id, created: false };
  }
  if (d.phone) {
    const candidates = await tx.customer.findMany({ where: { isInternal: false, phone: { contains: phoneTail(d.phone) } }, orderBy: { createdAt: "asc" }, select: { id: true, phone: true } });
    const byPhone = candidates.find((x) => samePhone(x.phone, d.phone));
    if (byPhone) return { id: byPhone.id, created: false };
  }
  const c = await tx.customer.create({ data: { name: d.name.slice(0, 200), phone: d.phone, inn: d.inn, address: d.address, creditLimit: await defaultCreditLimit(tx) } });
  await audit(tx, actorId, "CREATE", "Customer", c.id, undefined, { ...c, via: "amocrm" });
  return { id: c.id, created: true };
}

type DealSnap = { id: number; name: string; price: number | null; statusId: number; pipelineId: number };
type DealDetails = { contactName: string | null; companyName: string | null; phone: string | null; inn: string | null; address: string | null; responsible: string | null };

/**
 * Sdelkani amoCRM'dan o'qib ERP'ga tushirish. «ERP'ga» bosqichida bo'lmasa — faqat bog'langan qator yangilanadi.
 * Qayta chaqirilsa xavfsiz: mijoz ikkinchi marta ochilmaydi, zayavka ochilgan kelishuv qayta «kutmoqda» bo'lmaydi.
 */
export async function pullDeal(amoLeadId: number, c: AmoConnection): Promise<"ready" | "updated" | "skipped"> {
  let lead: AmoLead;
  try {
    lead = await getLead(amoLeadId, c);
  } catch (e) {
    if (e instanceof AmoError && e.status === 404) return "skipped";
    throw e;
  }
  return landDeal(c, { id: amoLeadId, name: lead.name, price: lead.price ?? null, statusId: lead.status_id, pipelineId: lead.pipeline_id }, () => dealDetails(lead, c));
}

/**
 * API'siz usul (WEBHOOK): sdelka ma'lumoti xabar tanasidan olinadi — kontakt va kompaniya kartasi yo'q,
 * telefon/INN/manzil faqat sdelkaning o'z maydonlaridan (nomi bo'yicha).
 */
export function landWebhookLead(c: AmoConnection, l: WebhookLead): Promise<"ready" | "updated" | "skipped"> {
  const innRaw = webhookFieldByName(l, INN_RE);
  return landDeal(c, l, async () => ({
    contactName: webhookFieldByName(l, CONTACT_RE),
    companyName: webhookFieldByName(l, COMPANY_RE),
    phone: normalizePhone(webhookFieldByName(l, PHONE_RE)),
    inn: innRaw ? parseInn(innRaw.replace(/\D+/g, "")).inn ?? null : null,
    address: webhookFieldByName(l, ADDRESS_RE),
    responsible: null,
  }));
}

/** «ERP'ga» bosqichi: API usulida majburiy; webhook usulida bo'sh bo'lsa — kelgan har sdelka (raqamli voronka triggeri) */
const inErpStage = (c: AmoConnection, s: DealSnap) =>
  (c.stageToErp ? s.statusId === c.stageToErp : c.method === "WEBHOOK") && (!c.pipelineId || s.pipelineId === c.pipelineId);

async function landDeal(c: AmoConnection, snap: DealSnap, details: () => Promise<DealDetails>): Promise<"ready" | "updated" | "skipped"> {
  const amoLeadId = snap.id;
  const existing = await db.amoDeal.findUnique({ where: { amoLeadId } });
  if (!inErpStage(c, snap)) {
    if (existing) await db.amoDeal.update({ where: { id: existing.id }, data: { name: snap.name, price: snap.price } });
    return existing ? "updated" : "skipped";
  }
  if (existing && (existing.state === "READY" || existing.state === "ORDERED" || existing.state === "DISMISSED")) {
    await db.amoDeal.update({ where: { id: existing.id }, data: { name: snap.name, price: snap.price } });
    return "updated";
  }

  const d = await details();
  const actorId = await amoSystemUserId();
  const customerName = d.companyName || d.contactName || snap.name;
  const phone = d.phone ?? existing?.phone ?? null;
  // Webhook usulida telefon ham, INN ham bo'lmasa mijoz ochilmaydi (faqat nom bilan dubl bo'lardi) — sotuvchi zayavkada tanlaydi
  const autoCustomer = c.method !== "WEBHOOK" || !!(phone || d.inn);
  const res = await db.$transaction(async (tx) => {
    const cust = existing?.customerId
      ? { id: existing.customerId, created: false }
      : autoCustomer ? await ensureCustomer(tx, { name: customerName, phone, inn: d.inn, address: d.address }, actorId) : null;
    const data = {
      state: "READY" as const, readyAt: new Date(), name: snap.name, price: snap.price,
      contactName: d.contactName, phone, companyName: d.companyName, inn: d.inn,
      address: d.address ?? existing?.address ?? null, responsible: d.responsible, customerId: cust?.id ?? null,
    };
    // Ikki yo'l bir vaqtda (webhook + tekshiruv): holat shartli o'zgaradi, yaratishdagi P2002 — ikkinchisi chiqib ketadi
    let deal: AmoDeal | null = null;
    if (existing) {
      const r = await tx.amoDeal.updateMany({ where: { id: existing.id, state: { in: ["IN_AMO", "PUSHING"] } }, data });
      if (r.count === 1) deal = await tx.amoDeal.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      deal = await tx.amoDeal.create({ data: { amoLeadId, ...data } });
    }
    if (!deal) return null;
    await audit(tx, actorId, existing ? "STATUS_CHANGE" : "CREATE", "AmoDeal", deal.id, existing ?? undefined, deal);
    // Saytdan kelgan ariza bo'lsa — u ham «Mijoz bo'ldi»
    if (deal.leadId && cust) {
      const before = await tx.lead.findUnique({ where: { id: deal.leadId } });
      const r = await tx.lead.updateMany({ where: { id: deal.leadId, status: { not: "CONVERTED" } }, data: { status: "CONVERTED", customerId: cust.id, handledById: actorId, handledAt: new Date() } });
      if (r.count === 1) await audit(tx, actorId, "STATUS_CHANGE", "Lead", deal.leadId, before, { status: "CONVERTED", customerId: cust.id, via: "amocrm" });
    }
    return { deal, created: !!cust?.created };
  }).catch((e) => {
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  });
  if (!res) return "updated";
  if (res.created) syncCustomerLater(res.deal.customerId!);
  notifyAfter(() => notifyRoles(["SALES"], {
    type: "AMO_DEAL_READY",
    title: "amoCRM: kelishuv — zayavka ochish kerak",
    body: `${customerName}${snap.price ? ` · ${money(snap.price)}` : ""}${d.responsible ? ` · ${d.responsible}` : ""}`,
  }));
  return "ready";
}

/** Webhook kelmay qolgan holatlar uchun: «ERP'ga» bosqichidagi so'nggi o'zgargan sdelkalar */
export async function pullStageDeals(c: AmoConnection): Promise<number> {
  if (!c.pipelineId || !c.stageToErp) return 0;
  const startedAt = new Date();
  // 10 daqiqa ustma-ust: soat farqi yoki yarim yo'lda uzilgan tekshiruv sdelkani o'tkazib yubormasin
  const from = c.lastPullAt ? new Date(c.lastPullAt.getTime() - 10 * 60_000) : new Date(Date.now() - 7 * 86_400_000);
  const leads = await leadsInStage(c.pipelineId, c.stageToErp, from, c);
  const known = new Map((await db.amoDeal.findMany({ where: { amoLeadId: { in: leads.map((l) => l.id) } }, select: { amoLeadId: true, state: true } })).map((d) => [d.amoLeadId, d.state]));
  let n = 0;
  for (const l of leads) {
    const st = known.get(l.id);
    if (st === "READY" || st === "ORDERED" || st === "DISMISSED") continue;
    try { if ((await pullDeal(l.id, c)) === "ready") n++; } catch (e) { console.warn("[amocrm] sdelka olinmadi", l.id, errText(e)); }
  }
  await db.amoConnection.update({ where: { id: c.id }, data: { lastPullAt: startedAt } });
  return n;
}

// ───────────────────────── 3. Zayavka → sdelka bosqichi ─────────────────────────

type Stage = "CONFIRMED" | "DELIVERED" | "CLOSED" | "CANCELLED";
type OrderLite = { orderNo: string; status: OrderStatus; items: { qtyM3: Prisma.Decimal; price: Prisma.Decimal }[] };

/** Kelishuvning bir nechta zayavkasi bo'lishi mumkin (beton bo'lib-bo'lib): eng orqada qolgani hal qiladi */
export function dealStage(orders: OrderLite[]): { stage: Stage | null; price: number } {
  const active = orders.filter((o) => o.status !== "CANCELLED");
  const price = active.reduce((s, o) => s + o.items.reduce((t, i) => t + Number(i.qtyM3) * Number(i.price), 0), 0);
  if (!orders.length) return { stage: null, price: 0 };
  if (!active.length) return { stage: "CANCELLED", price: 0 };
  if (active.every((o) => o.status === "CLOSED")) return { stage: "CLOSED", price };
  if (active.every((o) => o.status === "DELIVERED" || o.status === "CLOSED")) return { stage: "DELIVERED", price };
  if (active.some((o) => o.status !== "DRAFT" && o.status !== "BLOCKED")) return { stage: "CONFIRMED", price };
  return { stage: null, price };
}

const STAGE_TEXT: Record<Stage, string> = {
  CONFIRMED: "zayavka qabul qilindi, ishlab chiqarishga tushdi",
  DELIVERED: "mahsulot yetkazildi",
  CLOSED: "to'lov yopildi",
  CANCELLED: "zayavka bekor qilindi",
};

const stageId = (c: AmoConnection, s: Stage | null): number | null =>
  s === "CONFIRMED" ? c.stageConfirmed : s === "DELIVERED" ? c.stageDelivered : s === "CLOSED" ? c.stageClosed : s === "CANCELLED" ? c.stageCancelled : null;

let lastFull = 0;
let lastCheck = 0;
let stageChain: Promise<unknown> = Promise.resolve();

/**
 * Zayavkasi o'zgargan kelishuvlarni sdelkaga yuborish. Har soatda — hammasi (ko'zdan qochgan o'zgarishlar uchun).
 * Jarayon ichida ketma-ket: zayavka ochilgandagi fon chaqiruv va daqiqalik tsikl bir-birining eski holatini ustiga yozmasin.
 */
export function syncOrderStages(c: AmoConnection, opts?: { full?: boolean }): Promise<number> {
  const run = stageChain.then(() => syncOrderStagesNow(c, opts));
  stageChain = run.catch(() => undefined);
  return run;
}

async function syncOrderStagesNow(c: AmoConnection, opts?: { full?: boolean }): Promise<number> {
  const now = Date.now();
  const full = opts?.full || now - lastFull > 3600_000;
  const since = new Date((full ? 0 : lastCheck) - 5 * 60_000);
  const deals = await db.amoDeal.findMany({
    where: { amoLeadId: { not: null }, state: "ORDERED", orders: { some: full ? {} : { updatedAt: { gte: since } } } },
    include: { orders: { where: { kind: "SALE" }, select: { orderNo: true, status: true, items: { select: { qtyM3: true, price: true } } } } },
    take: 500,
  });
  if (full) lastFull = now;
  lastCheck = now;
  let n = 0;
  for (const d of deals) {
    const { stage, price } = dealStage(d.orders);
    const sid = stageId(c, stage);
    const priceRounded = Math.round(price);
    const stageChanged = sid != null && sid !== d.syncedStage;
    const priceChanged = d.syncedPrice == null || Math.round(Number(d.syncedPrice)) !== priceRounded;
    if (!stageChanged && !priceChanged) continue;
    try {
      await updateLead(d.amoLeadId!, { ...(stageChanged ? { status_id: sid!, ...(c.pipelineId ? { pipeline_id: c.pipelineId } : {}) } : {}), price: priceRounded }, c);
      await db.amoDeal.update({ where: { id: d.id }, data: { syncedStage: stageChanged ? sid : d.syncedStage, syncedPrice: priceRounded, syncError: null } });
      if (stageChanged && stage) {
        await addLeadNote(d.amoLeadId!, `Insof ERP: ${STAGE_TEXT[stage]}.\nZayavkalar: ${d.orders.map((o) => o.orderNo).join(", ")}\nSumma: ${money(priceRounded)}`, c).catch(() => undefined);
      }
      n++;
    } catch (e) {
      await db.amoDeal.update({ where: { id: d.id }, data: { syncError: errText(e) } });
      if (e instanceof AmoError && e.auth) break; // token yaroqsiz — qolganlari ham o'tmaydi
    }
  }
  return n;
}

// ───────────────────────── Zayavka ochilganda ─────────────────────────

/** Zayavka shu kelishuvdan ochildi (`createOrder` tranzaksiyasi ichida). Kelishuv mijozi boshqa bo'lsa — bog'lanmaydi. */
export async function linkOrderTx(tx: Prisma.TransactionClient, amoDealId: string, orderId: string, customerId: string, userId: string): Promise<void> {
  const d = await tx.amoDeal.findUnique({ where: { id: amoDealId } });
  if (!d || d.state === "DISMISSED") throw new Error("amoCRM kelishuvi topilmadi yoki yopilgan");
  if (d.customerId && d.customerId !== customerId) throw new Error("Zayavka mijozi amoCRM kelishuvidagi mijozdan boshqa — kelishuv mijozini tanlang");
  await tx.order.update({ where: { id: orderId }, data: { amoDealId } });
  const r = await tx.amoDeal.updateMany({ where: { id: amoDealId, state: { not: "ORDERED" } }, data: { state: "ORDERED", customerId } });
  if (r.count === 1) await audit(tx, userId, "STATUS_CHANGE", "AmoDeal", amoDealId, { state: d.state }, { state: "ORDERED", orderId });
}

/** Zayavka ochilgandan keyin sdelkaga darhol: summa va (qabul qilingan bo'lsa) bosqich */
export function syncDealLater(): void {
  notifyAfter(async () => {
    const c = await getConnection();
    if (isReady(c)) await syncOrderStages(c);
  });
}

/** Sotuvchi: «ERP'da kerak emas» — kutilayotganlar ro'yxatidan olib tashlash */
export async function dismissDeal(id: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const before = await db.amoDeal.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "Kelishuv topilmadi" };
  const r = await db.amoDeal.updateMany({ where: { id, state: { in: ["READY", "IN_AMO"] } }, data: { state: "DISMISSED" } });
  if (r.count !== 1) return { ok: false, error: "Bu kelishuvdan zayavka ochilgan yoki allaqachon yopilgan" };
  await audit(db, userId, "STATUS_CHANGE", "AmoDeal", id, { state: before.state }, { state: "DISMISSED" });
  return { ok: true };
}

/** Qayta tiklash: yopilgan kelishuv yana «zayavka kutmoqda» */
export async function restoreDeal(id: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await db.amoDeal.updateMany({ where: { id, state: "DISMISSED", amoLeadId: { not: null } }, data: { state: "READY" } });
  if (r.count !== 1) return { ok: false, error: "Kelishuv qayta tiklanmadi" };
  await audit(db, userId, "STATUS_CHANGE", "AmoDeal", id, { state: "DISMISSED" }, { state: "READY" });
  return { ok: true };
}

/** Davriy tsikl (`watch.ts`): arizalar, sdelkalar, bosqichlar */
let lastPull = 0;
export async function amoTick(opts?: { force?: boolean }): Promise<{ pushed: number; pulled: number; synced: number } | null> {
  const c = await getConnection();
  // Token xatosidan keyin (ERROR) sokin: har daqiqada yiqiladigan so'rov yubormaymiz — qayta ulash yoki «Hozir sinxronlash»
  if (!isReady(c) || (c.status === "ERROR" && !opts?.force)) return null;
  const pushed = await pushPendingLeads(c).catch((e) => { console.warn("[amocrm] arizalar", errText(e)); return 0; });
  let pulled = 0;
  if (opts?.force || Date.now() - lastPull > 5 * 60_000) {
    lastPull = Date.now();
    pulled = await pullStageDeals(c).catch((e) => { console.warn("[amocrm] sdelkalar", errText(e)); return 0; });
  }
  const synced = await syncOrderStages(c, { full: opts?.force }).catch((e) => { console.warn("[amocrm] bosqichlar", errText(e)); return 0; });
  return { pushed, pulled, synced };
}
