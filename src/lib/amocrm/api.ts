/**
 * amoCRM API v4 ning bizga kerakli qismi: hisob, voronkalar, sdelka/kontakt/kompaniya, eslatma, webhook.
 * Maydonlar: https://www.amocrm.ru/developers/content/crm_platform/leads-api
 */
import type { AmoConnection } from "@/generated/prisma";
import { amo } from "./client";

type Conn = AmoConnection | null | undefined;

export type AmoField = { field_id?: number; field_name?: string; field_code?: string | null; values: { value: string | number | boolean; enum_code?: string }[] };
export type AmoStatusDef = { id: number; name: string; sort: number; type: number; color?: string };
export type AmoPipeline = { id: number; name: string; is_main: boolean; _embedded: { statuses: AmoStatusDef[] } };
export type AmoLead = {
  id: number; name: string; price: number | null; status_id: number; pipeline_id: number; responsible_user_id: number;
  updated_at: number; created_at: number; closed_at?: number | null; is_deleted?: boolean;
  custom_fields_values: AmoField[] | null;
  _embedded?: { contacts?: { id: number; is_main?: boolean }[]; companies?: { id: number }[]; tags?: { id: number; name: string }[] };
};
export type AmoContact = { id: number; name: string; first_name?: string; last_name?: string; custom_fields_values: AmoField[] | null };
export type AmoCompany = { id: number; name: string; custom_fields_values: AmoField[] | null };

/** amoCRM'da yopilgan bosqichlar: 142 — «Muvaffaqiyatli», 143 — «Yopildi va amalga oshmadi» (har voronkada bor) */
export const WON = 142;
export const LOST = 143;

export const account = (c?: Conn) => amo<{ id: number; name: string; subdomain: string }>("/api/v4/account", {}, c);

export async function pipelines(c?: Conn): Promise<AmoPipeline[]> {
  const r = await amo<{ _embedded?: { pipelines: AmoPipeline[] } } | null>("/api/v4/leads/pipelines", {}, c);
  return (r?._embedded?.pipelines ?? []).map((p) => ({ ...p, _embedded: { statuses: [...p._embedded.statuses].sort((a, b) => a.sort - b.sort) } }));
}

export const getLead = (id: number, c?: Conn) => amo<AmoLead>(`/api/v4/leads/${id}`, { query: { with: "contacts" } }, c);
export const getContact = (id: number, c?: Conn) => amo<AmoContact>(`/api/v4/contacts/${id}`, {}, c);
export const getCompany = (id: number, c?: Conn) => amo<AmoCompany>(`/api/v4/companies/${id}`, {}, c);
export const getUser = (id: number, c?: Conn) => amo<{ id: number; name: string }>(`/api/v4/users/${id}`, {}, c);

/** Bosqichdagi sdelkalar (shu vaqtdan keyin o'zgarganlari), eng ko'pi 250 ta */
export async function leadsInStage(pipelineId: number, statusId: number, updatedFrom: Date, c?: Conn): Promise<AmoLead[]> {
  const r = await amo<{ _embedded?: { leads: AmoLead[] } } | null>("/api/v4/leads", {
    query: {
      "filter[statuses][0][pipeline_id]": pipelineId,
      "filter[statuses][0][status_id]": statusId,
      "filter[updated_at][from]": Math.floor(updatedFrom.getTime() / 1000),
      limit: 250,
    },
  }, c);
  return r?._embedded?.leads ?? [];
}

/** Telefon bo'yicha mavjud kontakt (dublikat ochmaslik uchun) */
export async function findContactByPhone(phone: string, c?: Conn): Promise<number | null> {
  const digits = phone.replace(/\D+/g, "");
  const r = await amo<{ _embedded?: { contacts: AmoContact[] } } | null>("/api/v4/contacts", { query: { query: digits.slice(-9), limit: 5 } }, c);
  const hit = (r?._embedded?.contacts ?? []).find((k) => phonesOf(k.custom_fields_values).some((p) => p.replace(/\D+/g, "").endsWith(digits.slice(-9))));
  return hit?.id ?? null;
}

/** Sdelka + kontakt bitta so'rovda. Kontakt id berilsa — mavjud kontaktga bog'lanadi. */
export async function createLeadComplex(input: {
  name: string; pipelineId?: number | null; statusId?: number | null; price?: number | null; tags?: string[];
  contact: { id?: number | null; name?: string; phone?: string };
}, c?: Conn): Promise<number> {
  const contact = input.contact.id
    ? { id: input.contact.id }
    : { first_name: input.contact.name, custom_fields_values: input.contact.phone ? [{ field_code: "PHONE", values: [{ value: input.contact.phone, enum_code: "WORK" }] }] : undefined };
  const body = [{
    name: input.name.slice(0, 250),
    ...(input.pipelineId ? { pipeline_id: input.pipelineId } : {}),
    ...(input.statusId ? { status_id: input.statusId } : {}),
    ...(input.price != null ? { price: Math.round(input.price) } : {}),
    _embedded: { contacts: [contact], ...(input.tags?.length ? { tags: input.tags.map((name) => ({ name })) } : {}) },
  }];
  const r = await amo<{ id: number }[]>("/api/v4/leads/complex", { method: "POST", body }, c);
  const id = r?.[0]?.id;
  if (!id) throw new Error("amoCRM sdelka id qaytarmadi");
  return id;
}

export const updateLead = (id: number, patch: { status_id?: number; pipeline_id?: number; price?: number }, c?: Conn) =>
  amo(`/api/v4/leads/${id}`, { method: "PATCH", body: patch }, c);

export const addLeadNote = (id: number, text: string, c?: Conn) =>
  amo(`/api/v4/leads/${id}/notes`, { method: "POST", body: [{ note_type: "common", params: { text: text.slice(0, 5000) } }] }, c);

export const subscribeWebhook = (destination: string, c?: Conn) =>
  amo("/api/v4/webhooks", { method: "POST", body: { destination, settings: ["status_lead"] } }, c);

export const unsubscribeWebhook = (destination: string, c?: Conn) =>
  amo("/api/v4/webhooks", { method: "DELETE", body: { destination } }, c);

// ───────── Maydonlardan qiymat olish ─────────

export function phonesOf(fields: AmoField[] | null | undefined): string[] {
  return (fields ?? []).filter((f) => f.field_code === "PHONE").flatMap((f) => f.values.map((v) => String(v.value)));
}

/** Nomi bo'yicha maydon (korxona o'zi qo'shgan: «ИНН», «Manzil»…) */
export function fieldByName(fields: AmoField[] | null | undefined, re: RegExp, code?: string): string | null {
  const f = (fields ?? []).find((x) => (code && x.field_code === code) || (x.field_name && re.test(x.field_name)));
  const v = f?.values?.[0]?.value;
  return v == null || v === "" ? null : String(v).trim();
}
