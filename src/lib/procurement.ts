import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import type { Prisma, Role, SupplyDelivery, SupplyIncidentKind, SupplyPriority, SupplyStatus } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { getCompany } from "./company";
import { notifyAfter, notifyRoles, notifyUsers } from "./notify";
import { UPLOADS_DIR, readUpload } from "./uploads";
import { DELIVERY_LABEL, DELIVERY_MANUAL, DEPARTMENTS, DOC_KINDS, INCIDENT_KINDS, INCIDENT_LABEL, PRIORITIES, PRIORITY_LABEL } from "./procurement-const";
import { SUPPLY_LABEL, totalPlanned, type SupplyResult } from "./supply";

/**
 * Snabjeniye TZ amallari — zanjir (`lib/supply.ts`) ustiga qo'shilgan ish:
 * talabnoma rekvizitlari, tijorat takliflari, direktor tasdig'i (katta xarid), yetkazib berish
 * monitoringi, muammolar (incident) va hujjatlar.
 *
 * Zanjir bosqichini (SupplyStatus) bu yerdagi hech bir amal o'zgartirmaydi — faqat
 * rekvizit/yetkazish holati. Har amal tarixda (`SupplyEvent`, joriy bosqich bilan) va auditda qoladi.
 * Veb (`lib/supply-actions.ts`) ham, mobil ilova (`lib/mobile/actions.ts`) ham shu funksiyalarni chaqiradi.
 */

const OPEN: SupplyStatus[] = ["NEW", "PRICED", "APPROVED", "FUNDED"];
const QUOTABLE: SupplyStatus[] = ["NEW", "PRICED"];

const note = (s: string | null | undefined) => (s ?? "").trim() || null;
const parseDay = (s: string | null | undefined) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const dd = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const som = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;

async function load(id: string) {
  return db.supplyRequest.findUnique({ where: { id }, include: { items: true } });
}
function guard(req: { status: SupplyStatus } | null, expect: SupplyStatus[]): string | null {
  if (!req) return "Ta'minot zayavkasi topilmadi";
  if (!expect.includes(req.status)) return `Bu amal "${SUPPLY_LABEL[req.status]}" bosqichida bajarilmaydi — sahifani yangilang`;
  return null;
}
const event = (tx: Prisma.TransactionClient, requestId: string, stage: SupplyStatus, userId: string, text: string) =>
  tx.supplyEvent.create({ data: { requestId, stage, userId, note: text } });

// ───────────────────────── Katta xarid: direktor tasdig'i ─────────────────────────

/** Chegara (so'm): shundan katta xarid avval direktor tasdig'idan o'tadi. 0 — cheklov yo'q. */
export async function directorLimit() {
  return Number((await getCompany()).supplyDirectorLimit);
}
export const needsDirector = (total: number, limit: number) => limit > 0 && total >= limit;

/** Direktor katta xaridni tasdiqlaydi — shundan keyin ma'sul (sotuv) xodim tasdig'i ochiladi. */
export async function directorApproveSupply(id: string, userId: string, text?: string | null): Promise<SupplyResult> {
  const req = await load(id);
  const err = guard(req, ["PRICED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  if (req.directorOkAt) return { error: "Direktor allaqachon tasdiqlagan" };
  const total = totalPlanned(req);
  const res = await db.$transaction(async (tx) => {
    // Narx o'qilgandan keyin qayta qo'yilgan bo'lsa — eski summa tasdiqlanmasin
    const r = await tx.supplyRequest.updateMany({ where: { id, status: "PRICED", updatedAt: req.updatedAt, directorOkAt: null }, data: { directorOkAt: new Date(), directorOkById: userId } });
    if (r.count !== 1) throw new Error("Zayavka boshqa joyda o'zgartirildi — sahifani yangilang");
    await event(tx, id, "PRICED", userId, `Direktor tasdiqladi (${som(total)})${text ? ` · ${text}` : ""}`);
    await audit(tx, userId, "UPDATE", "SupplyRequest", id, { directorOkAt: null }, { directorOkAt: new Date(), total });
  }).catch((e: Error) => ({ error: e.message }));
  if (res && "error" in res) return { error: res.error };
  notifyAfter(() => notifyRoles(["SALES"], {
    type: "SUPPLY_DIRECTOR_OK",
    title: `Direktor tasdiqladi — ${req.docNo}`,
    body: `${som(total)} — endi siz tasdiqlaysiz`,
    link: { key: "supply", id },
  }));
  return { id, docNo: req.docNo, note: "Tasdiqlandi — endi ma'sul xodim tasdiqlaydi" };
}

// ───────────────────────── Talabnoma rekvizitlari ─────────────────────────

export type MetaInput = {
  department?: string | null;
  priority?: SupplyPriority | string | null;
  responsibleId?: string | null;
  needBy?: string | null;
  contractNo?: string | null;
};

/** Bo'lim, ustuvorlik, mas'ul, kerak sana, shartnoma — ochiq zayavkada istalgan bosqichda. */
export async function updateSupplyMeta(id: string, input: MetaInput, userId: string): Promise<SupplyResult> {
  const req = await load(id);
  const err = guard(req, OPEN);
  if (err || !req) return { error: err ?? "Topilmadi" };
  const priority = input.priority ? (PRIORITIES.includes(input.priority as SupplyPriority) ? (input.priority as SupplyPriority) : null) : req.priority;
  if (!priority) return { error: "Ustuvorlik noto'g'ri" };
  const needBy = input.needBy === undefined ? req.needBy : parseDay(input.needBy);
  if (needBy === undefined) return { error: "Sana noto'g'ri" };
  const department = input.department === undefined ? req.department : note(input.department);
  if (department && !(DEPARTMENTS as readonly string[]).includes(department)) return { error: "Bo'lim noto'g'ri" };
  let responsibleId = input.responsibleId === undefined ? req.responsibleId : note(input.responsibleId);
  if (responsibleId) {
    const u = await db.user.findUnique({ where: { id: responsibleId }, select: { isActive: true } });
    if (!u?.isActive) responsibleId = null;
  }
  const data = { department, priority, responsibleId, needBy, contractNo: input.contractNo === undefined ? req.contractNo : note(input.contractNo) };

  const changed: string[] = [];
  if (data.department !== req.department) changed.push(`bo'lim: ${data.department ?? "—"}`);
  if (data.priority !== req.priority) changed.push(`ustuvorlik: ${PRIORITY_LABEL[data.priority]}`);
  if (data.responsibleId !== req.responsibleId) changed.push("mas'ul o'zgardi");
  if ((data.needBy?.getTime() ?? 0) !== (req.needBy?.getTime() ?? 0)) changed.push(`kerak sana: ${data.needBy ? dd(data.needBy) : "—"}`);
  if (data.contractNo !== req.contractNo) changed.push(`shartnoma: ${data.contractNo ?? "—"}`);
  if (!changed.length) return { id, docNo: req.docNo, note: "O'zgarish yo'q" };

  await db.$transaction(async (tx) => {
    await tx.supplyRequest.update({ where: { id }, data });
    await event(tx, id, req.status, userId, `Rekvizitlar: ${changed.join(", ")}`);
    await audit(tx, userId, "UPDATE", "SupplyRequest", id,
      { department: req.department, priority: req.priority, responsibleId: req.responsibleId, needBy: req.needBy, contractNo: req.contractNo }, data);
  });
  if (data.responsibleId && data.responsibleId !== req.responsibleId && data.responsibleId !== userId) {
    const rid = data.responsibleId;
    notifyAfter(() => notifyUsers([rid], {
      type: "SUPPLY_ASSIGNED",
      title: `Sizga biriktirildi — ${req.docNo}`,
      body: `${PRIORITY_LABEL[data.priority]} ustuvorlik${data.needBy ? ` · ${dd(data.needBy)} gacha kerak` : ""}`,
      link: { key: "supply", id },
    }));
  }
  return { id, docNo: req.docNo, note: "Rekvizitlar saqlandi" };
}

// ───────────────────────── Tijorat takliflari ─────────────────────────

export type QuoteInput = {
  supplierId?: string | null;
  supplierName?: string | null;
  amount: number;
  deliveryDays?: number | null;
  paymentTerms?: string | null;
  validUntil?: string | null;
  note?: string | null;
};

export async function addSupplyQuote(id: string, input: QuoteInput, userId: string): Promise<SupplyResult> {
  const req = await load(id);
  const err = guard(req, QUOTABLE);
  if (err || !req) return { error: err ?? "Topilmadi" };
  if (!(input.amount > 0)) return { error: "Taklif summasini kiriting" };
  const sup = input.supplierId ? await db.supplier.findUnique({ where: { id: input.supplierId } }) : null;
  const name = sup?.name ?? note(input.supplierName);
  if (!name) return { error: "Yetkazuvchini tanlang yoki nomini yozing" };
  const validUntil = parseDay(input.validUntil);
  if (validUntil === undefined) return { error: "Amal qilish sanasi noto'g'ri" };
  const days = input.deliveryDays != null && Number.isFinite(input.deliveryDays) ? Math.max(0, Math.round(input.deliveryDays)) : null;

  const q = await db.$transaction(async (tx) => {
    const q = await tx.supplyQuote.create({
      data: {
        requestId: id, supplierId: sup?.id ?? null, supplierName: name, amount: input.amount, deliveryDays: days,
        paymentTerms: note(input.paymentTerms), validUntil, note: note(input.note), createdById: userId,
      },
    });
    await event(tx, id, req.status, userId, `Tijorat taklifi: ${name} · ${som(input.amount)}${days != null ? ` · ${days} kunda` : ""}`);
    await audit(tx, userId, "CREATE", "SupplyQuote", q.id, undefined, q);
    return q;
  });
  return { id: q.id, docNo: req.docNo, note: "Taklif qo'shildi" };
}

/** Taklifni tanlash: tanlangani belgilanadi, yetkazuvchisi zayavkaga yoziladi (narx qo'yishda tanlangan bo'ladi). */
export async function chooseSupplyQuote(quoteId: string, userId: string): Promise<SupplyResult> {
  const q = await db.supplyQuote.findUnique({ where: { id: quoteId }, include: { request: true } });
  if (!q) return { error: "Taklif topilmadi" };
  const err = guard(q.request, QUOTABLE);
  if (err) return { error: err };
  await db.$transaction(async (tx) => {
    await tx.supplyQuote.updateMany({ where: { requestId: q.requestId }, data: { chosen: false } });
    await tx.supplyQuote.update({ where: { id: q.id }, data: { chosen: true } });
    if (q.supplierId) await tx.supplyRequest.update({ where: { id: q.requestId }, data: { supplierId: q.supplierId } });
    await event(tx, q.requestId, q.request.status, userId, `Taklif tanlandi: ${q.supplierName} · ${som(Number(q.amount))}`);
    await audit(tx, userId, "UPDATE", "SupplyQuote", q.id, { chosen: q.chosen }, { chosen: true });
  });
  return { id: q.requestId, docNo: q.request.docNo, note: `${q.supplierName} tanlandi${q.supplierId ? "" : " — yetkazuvchini spravochnikka qo'shing"}` };
}

export async function deleteSupplyQuote(quoteId: string, userId: string): Promise<SupplyResult> {
  const q = await db.supplyQuote.findUnique({ where: { id: quoteId }, include: { request: true } });
  if (!q) return { error: "Taklif topilmadi" };
  const err = guard(q.request, QUOTABLE);
  if (err) return { error: err };
  await db.$transaction(async (tx) => {
    await tx.supplyQuote.delete({ where: { id: q.id } });
    await audit(tx, userId, "DELETE", "SupplyQuote", q.id, q, undefined);
  });
  return { id: q.requestId, docNo: q.request.docNo, note: "Taklif o'chirildi" };
}

// ───────────────────────── Yetkazib berish monitoringi ─────────────────────────

export type DeliveryInput = {
  status: SupplyDelivery | string;
  shippedAt?: string | null;
  eta?: string | null;
  provider?: string | null;
  note?: string | null;
};

/**
 * Pul ajratilgan (FUNDED) buyurtmaning yetkazish holati. Zavodga kelganda sklad xabardor qilinadi
 * ("qabul qilishni boshlang"), "Muammo" — incident sifatida yoziladi (hal qilinmaguncha alert).
 */
export async function updateSupplyDelivery(id: string, input: DeliveryInput, userId: string): Promise<SupplyResult> {
  const req = await load(id);
  const err = guard(req, ["FUNDED"]);
  if (err || !req) return { error: err ?? "Topilmadi" };
  const status = input.status as SupplyDelivery;
  if (!DELIVERY_MANUAL.includes(status)) return { error: "Holat noto'g'ri" };
  const shippedAt = input.shippedAt === undefined ? req.shippedAt : parseDay(input.shippedAt);
  const eta = input.eta === undefined ? req.eta : parseDay(input.eta);
  if (shippedAt === undefined || eta === undefined) return { error: "Sana noto'g'ri" };
  const text = note(input.note);
  if (status === "PROBLEM" && !text) return { error: "Muammoni yozing — nima bo'ldi" };

  const now = new Date();
  const data = {
    deliveryStatus: status,
    shippedAt: shippedAt ?? (status === "IN_TRANSIT" ? now : null),
    eta,
    arrivedAt: status === "ARRIVED" || status === "RECEIVING" ? (req.arrivedAt ?? now) : req.arrivedAt,
    deliveryProvider: input.provider === undefined ? req.deliveryProvider : note(input.provider),
  };
  await db.$transaction(async (tx) => {
    await tx.supplyRequest.update({ where: { id }, data });
    if (status === "PROBLEM") {
      await tx.supplyIncident.create({ data: { requestId: id, kind: "DELAY", note: text!, createdById: userId } });
    }
    await event(tx, id, "FUNDED", userId, `Yetkazish: ${DELIVERY_LABEL[status]}${data.eta ? ` · ETA ${dd(data.eta)}` : ""}${data.deliveryProvider ? ` · ${data.deliveryProvider}` : ""}${text ? ` · ${text}` : ""}`);
    await audit(tx, userId, "UPDATE", "SupplyRequest", id,
      { deliveryStatus: req.deliveryStatus, shippedAt: req.shippedAt, eta: req.eta, arrivedAt: req.arrivedAt }, data);
  });

  if ((status === "ARRIVED" || status === "RECEIVING") && req.deliveryStatus !== status) {
    // Qabul qilishni boshlash — sklad xodimiga vazifa
    notifyAfter(() => notifyRoles(["WAREHOUSE"], {
      type: "SUPPLY_ARRIVED",
      title: `${status === "ARRIVED" ? "Mol zavodga keldi" : "Qabulni boshlang"} — ${req.docNo}`,
      body: `${req.items.length} ta mahsulot — tekshirib qabul qiling${data.deliveryProvider ? ` · ${data.deliveryProvider}` : ""}`,
      link: { key: "supply", id },
    }, { except: userId }));
  }
  if (status === "PROBLEM") {
    notifyAfter(() => notifyRoles(["PROCUREMENT", "WAREHOUSE"], {
      type: "SUPPLY_INCIDENT",
      title: `Yetkazishda muammo — ${req.docNo}`,
      body: text!,
      link: { key: "supply", id },
    }, { except: userId }));
  }
  return { id, docNo: req.docNo, note: `Holat: ${DELIVERY_LABEL[status]}` };
}

// ───────────────────────── Muammolar (incident) ─────────────────────────

export async function createSupplyIncident(id: string, input: { kind: SupplyIncidentKind | string; note: string }, userId: string): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id } });
  if (!req) return { error: "Ta'minot zayavkasi topilmadi" };
  if (req.status === "REJECTED") return { error: "Bekor qilingan zayavkaga muammo yozilmaydi" };
  const kind = input.kind as SupplyIncidentKind;
  if (!INCIDENT_KINDS.includes(kind)) return { error: "Muammo turi noto'g'ri" };
  const text = note(input.note);
  if (!text) return { error: "Muammoni yozing" };
  const inc = await db.$transaction(async (tx) => {
    const inc = await tx.supplyIncident.create({ data: { requestId: id, kind, note: text, createdById: userId } });
    if (req.status === "FUNDED") await tx.supplyRequest.update({ where: { id }, data: { deliveryStatus: "PROBLEM" } });
    await event(tx, id, req.status, userId, `Muammo: ${INCIDENT_LABEL[kind]} · ${text}`);
    await audit(tx, userId, "CREATE", "SupplyIncident", inc.id, undefined, inc);
    return inc;
  });
  notifyAfter(() => notifyRoles(["PROCUREMENT", "WAREHOUSE"], {
    type: "SUPPLY_INCIDENT",
    title: `${INCIDENT_LABEL[kind]} — ${req.docNo}`,
    body: text,
    link: { key: "supply", id },
  }, { except: userId }));
  return { id: inc.id, docNo: req.docNo, note: "Muammo qayd qilindi" };
}

export async function resolveSupplyIncident(incidentId: string, resolution: string, userId: string): Promise<SupplyResult> {
  const inc = await db.supplyIncident.findUnique({ where: { id: incidentId }, include: { request: true } });
  if (!inc) return { error: "Muammo topilmadi" };
  if (inc.resolvedAt) return { error: "Bu muammo allaqachon hal qilingan" };
  const text = note(resolution);
  if (!text) return { error: "Qanday hal qilinganini yozing" };
  await db.$transaction(async (tx) => {
    await tx.supplyIncident.update({ where: { id: inc.id }, data: { resolvedAt: new Date(), resolvedById: userId, resolution: text } });
    // Boshqa ochiq muammo qolmasa, yetkazish holati "Muammo"dan chiqadi
    const left = await tx.supplyIncident.count({ where: { requestId: inc.requestId, resolvedAt: null } });
    if (!left && inc.request.deliveryStatus === "PROBLEM") {
      await tx.supplyRequest.update({ where: { id: inc.requestId }, data: { deliveryStatus: inc.request.arrivedAt ? "ARRIVED" : inc.request.shippedAt ? "IN_TRANSIT" : "PLANNED" } });
    }
    await event(tx, inc.requestId, inc.request.status, userId, `Muammo hal qilindi (${INCIDENT_LABEL[inc.kind]}): ${text}`);
    await audit(tx, userId, "UPDATE", "SupplyIncident", inc.id, { resolvedAt: null }, { resolvedAt: new Date(), resolution: text });
  });
  return { id: inc.requestId, docNo: inc.request.docNo, note: "Muammo yopildi" };
}

// ───────────────────────── Hujjatlar ─────────────────────────

const DOC_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
export const SUPPLY_DOC_ACCEPT = Object.keys(DOC_TYPES).join(",");
export const SUPPLY_DOC_MAX_MB = 15;

export function supplyDocPath(stored: string) {
  if (!/^[\w-]+\.(pdf|jpg|png|webp|heic)$/.test(stored)) return null;
  return path.join(UPLOADS_DIR, "supply", stored);
}

/**
 * Mobil ilova rasmni data-URL qilib yuboradi (`data:image/jpeg;base64,...`) —
 * shu yerda oddiy `File` ga keltiriladi, veb forma esa to'g'ridan-to'g'ri `File` beradi.
 */
export function dataUrlFile(data: string | null | undefined, name = "hujjat"): File | null {
  if (!data) return null;
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(data.trim());
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length) return null;
  const ext = DOC_TYPES[m[1].toLowerCase()] ?? "bin";
  return new File([new Uint8Array(buf)], `${name}.${ext}`, { type: m[1].toLowerCase() });
}

export async function addSupplyDocument(id: string, kind: string, file: File | null, userId: string): Promise<SupplyResult> {
  const req = await db.supplyRequest.findUnique({ where: { id } });
  if (!req) return { error: "Ta'minot zayavkasi topilmadi" };
  if (!(DOC_KINDS as readonly string[]).includes(kind)) return { error: "Hujjat turini tanlang" };
  if (!file || file.size === 0) return { error: "Fayl tanlanmagan" };
  if (file.size > SUPPLY_DOC_MAX_MB * 1024 * 1024) return { error: `Fayl ${SUPPLY_DOC_MAX_MB} MB dan katta` };
  // Turi brauzer yuborgan `file.type` dan emas, fayl mazmunidan (magic bytes) aniqlanadi
  const f = await readUpload(file, ["pdf", "jpg", "png", "webp", "heic"]);
  if (!f) return { error: "Hujjat PDF yoki rasm (JPG, PNG, WEBP, HEIC) bo'lishi kerak" };
  const ext = f.ext;
  const dir = path.join(UPLOADS_DIR, "supply");
  await mkdir(dir, { recursive: true });
  const stored = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await writeFile(path.join(dir, stored), f.buf);
  const doc = await db.$transaction(async (tx) => {
    const doc = await tx.supplyDocument.create({ data: { requestId: id, kind, file: stored, fileName: file.name || `${kind}.${ext}`, fileType: f.mime, createdById: userId } });
    await event(tx, id, req.status, userId, `Hujjat biriktirildi: ${kind}`);
    await audit(tx, userId, "CREATE", "SupplyDocument", doc.id, undefined, doc);
    return doc;
  });
  return { id: doc.id, docNo: req.docNo, note: `${kind} biriktirildi` };
}

/** Qabul qilingan (RECEIVED) zayavkaning hujjatlari — kirim va to'lov asosi: ularni faqat direktor o'chiradi. */
export const canRemoveSupplyDoc = (status: SupplyStatus, role: Role) => status !== "RECEIVED" || role === "DIRECTOR";

export async function removeSupplyDocument(docId: string, userId: string, role: Role): Promise<SupplyResult> {
  const doc = await db.supplyDocument.findUnique({ where: { id: docId }, include: { request: { select: { docNo: true, status: true } } } });
  if (!doc) return { error: "Hujjat topilmadi" };
  if (!canRemoveSupplyDoc(doc.request.status, role)) return { error: "Qabul qilingan zayavka hujjatini faqat direktor o'chiradi" };
  await db.$transaction(async (tx) => {
    await tx.supplyDocument.delete({ where: { id: doc.id } });
    await event(tx, doc.requestId, doc.request.status, userId, `Hujjat o'chirildi: ${doc.kind} (${doc.fileName})`);
    await audit(tx, userId, "DELETE", "SupplyDocument", doc.id, doc, undefined);
  });
  const p = supplyDocPath(doc.file);
  if (p) { try { await unlink(p); } catch { /* fayl allaqachon yo'q */ } }
  return { id: doc.requestId, docNo: doc.request.docNo, note: "Hujjat o'chirildi" };
}

/** Mas'ul tanlovi uchun — snabjeniye (va o'rnini bosuvchi sklad) xodimlari. */
export const responsibleOptions = () =>
  db.user.findMany({ where: { isActive: true, role: { in: ["PROCUREMENT", "WAREHOUSE"] } }, select: { id: true, fullName: true, role: true }, orderBy: { fullName: "asc" } });
