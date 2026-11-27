"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { saveCustomerLib } from "@/lib/customer-admin";
import { defaultCreditLimit } from "@/lib/finance";
import { syncCustomerLater } from "@/lib/eco/customers";
import { normalizePhone } from "@/lib/phone";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { findDuplicates, type DupMatch } from "@/lib/crm/clients";
import { CRM_STATUSES, T } from "@/lib/crm/labels";
import type { CrmClientStatus } from "@/generated/prisma";

const schema = z.object({
  name: zStr(`${T.field.name} to'ldirilishi shart`),
  inn: zOpt,
  phone: zOpt,
  contactPerson: zOpt,
  region: zOpt,
  district: zOpt,
  objectType: zOpt,
  foremanName: zOpt,
  foremanPhone: zOpt,
  clientTypeId: zOpt,
  sourceId: zStr(T.form.sourceRequired),
  ownerId: zOpt,
  crmStatus: zOpt,
  link: zOpt,
  crmNote: zOpt,
  force: zOpt,
});

/** Formadagi STIR / telefon yozilganda — mavjud mijozlar (CRM_SPEC 3.1: ogohlantirish va «Shu mijozni ochish»). */
export async function checkDuplicates(inn: string, phone: string, excludeId: string | null): Promise<DupMatch[]> {
  await requireAction("crm", "client");
  return findDuplicates({ inn, phone, excludeId });
}

/** CRM mijozini saqlash. Asosiy maydonlar (nom, STIR, telefon, aloqa shaxsi) — ERP mijoz kartasi qoidasi bilan (`saveCustomerLib`). */
export async function saveClient(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("crm", "client");
  const manager = canDo(s, "crm", "manage");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const d = r.data;

  const phone = d.phone ? normalizePhone(d.phone) : null;
  if (d.phone && !phone) return { error: T.form.phoneInvalid, field: "phone" };
  const foremanPhone = d.foremanPhone ? normalizePhone(d.foremanPhone) : null;
  if (d.foremanPhone && !foremanPhone) return { error: T.form.foremanPhoneInvalid, field: "foremanPhone" };
  if (d.link && !/^https?:\/\//i.test(d.link)) return { error: T.form.linkInvalid, field: "link" };

  const cur = id ? await db.customer.findFirst({ where: { id, isInternal: false } }) : null;
  if (id && !cur) return { error: "Mijoz topilmadi" };

  // Ro'yxat qiymatlari haqiqiy bo'lsin (forma qo'lda o'zgartirilgan bo'lsa ham)
  const optIds = [d.sourceId, d.clientTypeId].filter((x): x is string => !!x);
  const opts = await db.crmOption.findMany({ where: { id: { in: optIds } }, select: { id: true, kind: true } });
  if (!opts.some((o) => o.id === d.sourceId && o.kind === "SOURCE")) return { error: T.form.sourceRequired, field: "sourceId" };
  if (d.clientTypeId && !opts.some((o) => o.id === d.clientTypeId && o.kind === "CLIENT_TYPE")) return { error: "Mijoz turi noto'g'ri", field: "clientTypeId" };

  // Dublikat: STIR yoki telefon bo'yicha. Telefon mos kelsa — tasdiq bilan baribir saqlash mumkin; STIR unikal
  const innChanged = !cur || (d.inn ?? "") !== (cur.inn ?? "");
  const phoneChanged = !cur || (phone ?? "") !== (normalizePhone(cur.phone) ?? "");
  if (innChanged || phoneChanged) {
    const dups = await findDuplicates({ inn: innChanged ? d.inn : null, phone: phoneChanged ? phone : null, excludeId: id });
    const byInn = dups.find((x) => x.by === "inn");
    if (byInn) return { error: `Bu STIR bilan mijoz bor: ${byInn.name}`, field: "inn" };
    if (dups.length && d.force !== "1") return { error: `${T.form.dupTitle}: ${dups.map((x) => x.name).join(", ")}`, field: "dup" };
  }

  let ownerId = cur ? cur.ownerId : s.userId;
  if (manager && d.ownerId !== undefined) {
    if (d.ownerId && !(await db.user.findUnique({ where: { id: d.ownerId }, select: { id: true } }))) return { error: "Xodim topilmadi", field: "ownerId" };
    ownerId = d.ownerId ?? (cur ? null : s.userId);
  }
  let crmStatus = cur?.crmStatus ?? "NEW";
  let crmStatusManual = cur?.crmStatusManual ?? false;
  if (manager) {
    if (d.crmStatus && (CRM_STATUSES as string[]).includes(d.crmStatus)) { crmStatus = d.crmStatus as CrmClientStatus; crmStatusManual = true; }
    else crmStatusManual = false;
  }

  const core = await saveCustomerLib(id, {
    name: d.name, inn: d.inn, phone, contactPerson: d.contactPerson,
    address: cur?.address ?? null, isActive: cur?.isActive ?? true,
    creditLimit: cur ? Number(cur.creditLimit) : await defaultCreditLimit(),
  }, { userId: s.userId, role: s.role }, cur ? String(cur.creditLimit) : null);
  if (!core.ok) return { error: core.error };

  const crm = {
    region: d.region, district: d.district, objectType: d.objectType, foremanName: d.foremanName, foremanPhone,
    clientTypeId: d.clientTypeId, sourceId: d.sourceId, ownerId, crmStatus, crmStatusManual, link: d.link, crmNote: d.crmNote,
    crmAt: cur?.crmAt ?? new Date(),
  };
  await db.$transaction(async (tx) => {
    const before = await tx.customer.findUniqueOrThrow({ where: { id: core.id } });
    await tx.customer.update({ where: { id: core.id }, data: crm });
    await audit(tx, s.userId, "UPDATE", "CustomerCrm", core.id,
      Object.fromEntries(Object.keys(crm).map((k) => [k, before[k as keyof typeof before]])), { ...crm, via: "crm" });
  });
  syncCustomerLater(core.id);
  revalidatePath("/crm/mijozlar");
  redirect(`/crm/mijozlar/${core.id}`);
}
