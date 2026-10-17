"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isAccessDenied } from "@/lib/access-denied";
import { parseForm, zDec, zStr, zOpt, type ActionState } from "@/lib/action";
import { OFFER_UNITS, acceptOfferByManager, cancelOffer, createOffer } from "@/lib/offers";

const done = (id?: string) => { revalidatePath("/takliflar"); if (id) revalidatePath(`/takliflar/${id}`); };

const UNIT_KEYS = OFFER_UNITS.map(([k]) => k);
const arr = z.array(z.string()).default([]);

const offerSchema = z.object({
  customerId: zOpt,
  clientName: zStr("Mijoz nomini kiriting"),
  clientPhone: zOpt,
  clientInn: zOpt,
  objectName: zOpt,
  deadline: zOpt,
  validUntil: zStr("Amal qilish muddatini kiriting").regex(/^\d{4}-\d{2}-\d{2}$/, "sana noto'g'ri"),
  withVat: z.string().optional(),
  advance: zDec().default(0),
  lang: z.enum(["uz", "ru"]).default("uz"),
  intro: zOpt,
  terms: zOpt,
  note: zOpt,
  orderId: zOpt,
  leadId: zOpt,
  productId: arr, name: arr, unit: arr, qty: arr, price: arr,
});

/** Yangi taklif — saqlangach hujjat kartasiga o'tadi (u yerdan chop etiladi). */
export async function createOfferAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const s = await requireAction("offers", "create");
    const r = parseForm(offerSchema, fd);
    if ("error" in r) return { error: r.error };
    const d = r.data;
    const items = d.name.map((name, i) => ({
      productId: d.productId[i] || null,
      name,
      unit: UNIT_KEYS.includes(d.unit[i] ?? "") || /^[\w³²/ .-]{1,16}$/.test(d.unit[i] ?? "") ? (d.unit[i] ?? "dona") : "dona",
      qty: Number(d.qty[i]),
      price: Number(d.price[i]),
    })).filter((l) => l.name.trim() || l.qty || l.price);
    const res = await createOffer({
      customerId: d.customerId, clientName: d.clientName, clientPhone: d.clientPhone, clientInn: d.clientInn,
      objectName: d.objectName, deadline: d.deadline, validUntil: new Date(`${d.validUntil}T00:00:00.000Z`),
      withVat: d.withVat === "on", advance: d.advance, lang: d.lang, intro: d.intro, terms: d.terms, note: d.note,
      orderId: d.orderId, leadId: d.leadId, items,
    }, s.userId);
    if (!res.ok) return { error: res.error };
    id = res.id;
    done();
  } catch (e) {
    if (isAccessDenied(e)) return { error: e.message };
    throw e;
  }
  redirect(`/takliflar/${id}?yangi=1`);
}

export async function cancelOfferAction(id: string, reason: string): Promise<ActionState> {
  try {
    const s = await requireAction("offers", "cancel");
    const r = await cancelOffer(id, reason, s.userId);
    if (!r.ok) return { error: r.error };
    done(id);
    return { ok: true, note: r.note };
  } catch (e) {
    if (isAccessDenied(e)) return { error: e.message };
    throw e;
  }
}

export async function acceptOfferAction(id: string, who: string): Promise<ActionState> {
  try {
    const s = await requireAction("offers", "cancel");
    const r = await acceptOfferByManager(id, s.userId, who);
    if (!r.ok) return { error: r.error };
    done(id);
    return { ok: true, note: r.note };
  } catch (e) {
    if (isAccessDenied(e)) return { error: e.message };
    throw e;
  }
}

const settingsSchema = z.object({
  oked: zOpt, vatRegNo: zOpt, offerIntro: zOpt, offerTerms: zOpt,
  offerValidDays: z.coerce.number().int("butun son").min(1, "kamida 1 kun").max(365, "ko'pi bilan 365 kun"),
});

/** Sozlamalar → Tijorat taklifi: hujjat matnlari va rekvizitlar (direktor yoki «settings» ruxsati). */
export async function saveOfferSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const s = await requireAction("offers", "settings");
    const r = parseForm(settingsSchema, fd);
    if ("error" in r) return { error: r.error };
    const d = r.data;
    const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { oked: true, vatRegNo: true, offerIntro: true, offerTerms: true, offerValidDays: true } });
    await db.companySettings.upsert({ where: { id: "main" }, update: d, create: { id: "main", ...d } });
    await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before ?? undefined, d);
    revalidatePath("/takliflar/sozlamalar");
    return { ok: true, note: "Saqlandi" };
  } catch (e) {
    if (isAccessDenied(e)) return { error: e.message };
    throw e;
  }
}
