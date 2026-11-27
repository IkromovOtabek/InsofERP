import { randomBytes } from "node:crypto";
import type { CrmOptionKind } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { defaultCreditLimit } from "@/lib/finance";
import { findSameNameCustomer, lockCustomerName } from "@/lib/customer-name";
import { refreshClient } from "../contacts";
import { isoToDb } from "../dates";
import { optionIndex, type ImportReport, type Plan, type PlanClient } from "./plan";

/**
 * Rejani bazaga yozish (`dryRun` — faqat hisobot). Mavjud mijozda faqat bo'sh CRM maydonlari to'ldiriladi —
 * ERP'da yuritilgan ma'lumot ustidan yozilmaydi. Aloqalar `importKey` bo'yicha bir marta.
 */
export async function applyPlan(plan: Plan, userId: string, dryRun: boolean, label: string): Promise<ImportReport> {
  const opts = await optionIndex();
  const resolveAll = (kind: CrmOptionKind, v: string | null) => opts.resolve(kind, v);
  // Ro'yxat qiymatlari: yangi bo'lsa hisobotda ko'rsatiladi, tasdiqda yaratiladi
  for (const c of plan.clients) { resolveAll("SOURCE", c.source); resolveAll("CLIENT_TYPE", c.clientType); }
  for (const x of plan.contacts) { resolveAll("CHANNEL", x.channel); resolveAll("PRODUCT", x.product); resolveAll("SOURCE", x.leadSource); }

  const keys = plan.contacts.map((x) => x.importKey);
  const existing = new Set<string>();
  for (let i = 0; i < keys.length; i += 1000) {
    const part = await db.crmContact.findMany({ where: { importKey: { in: keys.slice(i, i + 1000) } }, select: { importKey: true } });
    part.forEach((p) => existing.add(p.importKey!));
  }
  const fresh = plan.contacts.filter((x) => !existing.has(x.importKey));

  const report: ImportReport = {
    dryRun,
    clientsNew: plan.clients.filter((c) => !c.matchId).length,
    clientsMatched: plan.clients.filter((c) => c.matchId).length,
    contactsNew: fresh.length,
    contactsExisting: existing.size,
    newOptions: opts.newOnes(),
    errors: plan.errors,
    warnings: plan.warnings,
    info: plan.info,
    sample: plan.clients.slice(0, 15).map((c) => ({ name: c.name, phone: c.phone, source: c.source, match: c.matchBy ? { inn: "STIR", phone: "telefon", name: "nom" }[c.matchBy] : null })),
  };
  if (dryRun) return report;

  // 1) Yangi ro'yxat qiymatlari
  const optionId = new Map<string, string>();
  const ensure = async (kind: CrmOptionKind, v: string | null): Promise<string | null> => {
    const r = opts.resolve(kind, v);
    if (r.id || !r.label) return r.id;
    const k = `${kind}:${r.label.toLowerCase()}`;
    if (!optionId.has(k)) {
      const o = await db.crmOption.create({ data: { kind, code: `imp_${randomBytes(4).toString("hex")}`, label: r.label.slice(0, 120), sort: 100 } });
      optionId.set(k, o.id);
    }
    return optionId.get(k)!;
  };

  // 2) Mijozlar
  const limit = await defaultCreditLimit();
  const idByKey = new Map<string, string>();
  const firstUser = new Map<string, string>();
  for (const x of plan.contacts) if (x.userId && !firstUser.has(x.clientKey)) firstUser.set(x.clientKey, x.userId);
  for (const c of plan.clients) {
    const sourceId = await ensure("SOURCE", c.source);
    const clientTypeId = await ensure("CLIENT_TYPE", c.clientType);
    const crm = {
      region: c.region, district: c.district, objectType: c.objectType, foremanName: c.foremanName, foremanPhone: c.foremanPhone,
      clientTypeId, sourceId, ownerId: c.ownerId ?? firstUser.get(c.key) ?? userId, link: c.link, crmNote: c.note,
    };
    if (c.matchId) {
      const cur = await db.customer.findUnique({ where: { id: c.matchId } });
      if (!cur) continue;
      // Faqat bo'sh maydonlar
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(crm)) if (v != null && (cur as Record<string, unknown>)[k] == null) data[k] = v;
      if (!cur.crmAt) data.crmAt = new Date();
      if (!cur.phone && c.phone) { data.phone = c.phone; data.phoneNorm = c.phone; }
      if (!cur.contactPerson && c.contactPerson) data.contactPerson = c.contactPerson;
      if (Object.keys(data).length) await db.customer.update({ where: { id: cur.id }, data });
      idByKey.set(c.key, cur.id);
      continue;
    }
    const id = await createClient(c, crm, limit, userId);
    idByKey.set(c.key, id);
  }

  // 3) Aloqalar
  const rows = [];
  // Bir kunda bir nechta aloqa: «oxirgisi» fayldagi tartib bo'yicha bo'lsin (createdAt ketma-ket)
  const t0 = Date.now() - fresh.length;
  for (const [i, x] of fresh.entries()) {
    const customerId = idByKey.get(x.clientKey);
    if (!customerId) continue;
    rows.push({
      customerId, importKey: x.importKey, date: isoToDb(x.date), resultId: x.resultId,
      channelId: await ensure("CHANNEL", x.channel), productId: await ensure("PRODUCT", x.product),
      leadSourceId: await ensure("SOURCE", x.leadSource),
      offeredPrice: x.offeredPrice, nextContactDate: x.next ? isoToDb(x.next) : null,
      userId: x.userId ?? userId, objectName: x.objectName, objectArea: x.objectArea, note: x.note,
      createdAt: new Date(t0 + i),
    });
  }
  for (let i = 0; i < rows.length; i += 500) await db.crmContact.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });

  // 4) Kesh va avto-holat
  for (const id of new Set(idByKey.values())) await db.$transaction((tx) => refreshClient(tx, id));

  await audit(db, userId, "CREATE", "CrmImport", label, undefined, {
    manba: label, mijozYangi: report.clientsNew, mijozBog: report.clientsMatched, aloqa: rows.length, yangiRoyxat: report.newOptions,
  });
  return report;
}

/** Yangi mijoz kartasi: nom band bo'lsa (boshqa mijoz) — telefon qo'shiladi, bo'lmasa tartib raqami. Realizator boti ham ishlatadi. */
export async function createClient(c: PlanClient, crm: Record<string, unknown>, creditLimit: number, userId: string): Promise<string> {
  let name = c.name.slice(0, 200);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await findSameNameCustomer(name)) {
      name = attempt === 0 && c.rawPhone ? `${c.name} (${c.rawPhone})` : `${c.name} (${attempt + 2})`;
      continue;
    }
    try {
      return await db.$transaction(async (tx) => {
        await lockCustomerName(tx, name);
        if (await findSameNameCustomer(name, null, tx)) throw new Error("NAME_TAKEN");
        const row = await tx.customer.create({
          data: {
            name, inn: c.inn, phone: c.phone ?? c.rawPhone, phoneNorm: c.phone, contactPerson: c.contactPerson,
            creditLimit, crmAt: new Date(), crmStatus: "NEW", ...crm,
          },
        });
        await audit(tx, userId, "CREATE", "Customer", row.id, undefined, { ...row, via: "crm-import" });
        return row.id;
      });
    } catch (e) {
      if (String(e).includes("NAME_TAKEN")) continue;
      // STIR boshqa mijozda (tekshiruvdan keyin paydo bo'lgan) — STIRsiz ochiladi
      if (String(e).includes("Unique constraint") && c.inn) { c.inn = null; continue; }
      throw e;
    }
  }
  throw new Error(`Mijoz ochilmadi: ${c.name}`);
}
