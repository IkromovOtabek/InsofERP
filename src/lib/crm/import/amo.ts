import type { AmoConnection } from "@/generated/prisma";
import { amo, AmoError } from "@/lib/amocrm/client";
import { pipelines, phonesOf, type AmoCompany, type AmoContact, type AmoLead } from "@/lib/amocrm/api";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { baseUrl, normalizeDomain, vault } from "@/lib/amocrm/store";
import { db } from "@/lib/db";
import { todayIso } from "../dates";
import { matchExisting, type Plan, type PlanClient } from "./plan";

/**
 * amoCRM'dan import (bir martalik): sdelkalar → CRM mijozlari (telefon bo'yicha birlashtiriladi), har sdelka → bitta aloqa
 * (natija — bosqich moslamasidan, keyingi aloqa — ochiq vazifa muddati, izoh — vazifa matni). Kontaktlar va kompaniyalar
 * sdelkaga bog'langanlari olinadi; sdelkasiz kontaktlar (qo'ng'iroqdan avtomatik ochilganlar) import qilinmaydi.
 * Token faqat shu so'rov uchun ishlatiladi, bazada saqlanmaydi.
 */

export type AmoStage = { id: number; pipeline: string; name: string; count: number; guess: string };
export type AmoUserRow = { id: number; name: string; count: number; guess: string };
export type AmoMapping = { stages: Record<string, string>; users: Record<string, string>; sourceId: string };
export type AmoDiscovery = { stages: AmoStage[]; users: AmoUserRow[]; leads: number };

/** Qo'ng'iroqdan avtomatik ochilgan «nom»lar — mijoz nomi bo'la olmaydi */
const JUNK = /^(исходящий|входящий|клиент не ответил|сделка\s*#|новый (лид|клиент|контакт)|звонок|facebook\s*№|instagram\s*№|лид\s*#|\+?[\d\s()-]{7,}$)/i;
const good = (s: string | null | undefined) => (s && s.trim() && !JUNK.test(s.trim()) ? s.replace(/\s+/g, " ").trim() : null);

function connFor(domain: string, token: string): AmoConnection {
  const d = normalizeDomain(domain);
  if (!d) throw new AmoError("amoCRM manzili noto'g'ri (masalan: insofuz.amocrm.ru)");
  const now = new Date();
  return {
    id: "import", domain: d, accountId: null, accountName: null, method: "TOKEN", clientId: null, clientSecretEnc: null,
    accessTokenEnc: vault.seal(token.trim()), refreshTokenEnc: null, tokenExpiresAt: null, webhookKey: "import", webhookOk: false,
    pipelineId: null, stageNewLead: null, stageToErp: null, stageConfirmed: null, stageDelivered: null, stageClosed: null, stageCancelled: null,
    pushLeads: false, status: "ACTIVE", lastError: null, lastPullAt: null, lastWebhookAt: null, lastWebhookInfo: null,
    connectedById: null, connectedByName: null, createdAt: now, updatedAt: now,
  };
}

type Task = { id: number; entity_id: number; entity_type: string; complete_till: number; text: string; responsible_user_id: number; is_completed: boolean };

async function pages<T>(path: string, key: string, query: Record<string, string | number>, c: AmoConnection, max = 40): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= max; page++) {
    const r = await amo<{ _embedded?: Record<string, T[]> } | null>(path, { query: { ...query, limit: 250, page }, probe: true }, c);
    const part = r?._embedded?.[key] ?? [];
    out.push(...part);
    if (part.length < 250) break;
  }
  return out;
}

async function byIds<T>(path: string, key: string, ids: number[], c: AmoConnection): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const q: Record<string, number> = { limit: 250 };
    ids.slice(i, i + 200).forEach((id, j) => { q[`filter[id][${j}]`] = id; });
    const r = await amo<{ _embedded?: Record<string, T[]> } | null>(path, { query: q, probe: true }, c);
    out.push(...(r?._embedded?.[key] ?? []));
  }
  return out;
}

const dayOf = (unix: number) => todayIso(new Date(unix * 1000));

/** Bosqich nomidan natija taxmini (foydalanuvchi o'zgartiradi) */
function guessStage(name: string, id: number, results: { id: string; code: string }[]): string {
  const r = (code: string) => results.find((x) => x.code === code)?.id ?? "";
  if (id === 142) return r("order");
  if (id === 143) return r("not_needed");
  const n = name.toLowerCase();
  if (/не ответ|недозвон|холод/.test(n)) return r("no_answer");
  if (/перезвон|qayta/.test(n)) return r("callback");
  if (/квалиф|потребн|ehtiyoj/.test(n)) return r("has_need");
  if (/кп|предлож|счет|счёт|taklif/.test(n)) return r("offer_sent");
  if (/переговор|согласов|muzokara/.test(n)) return r("negotiating");
  if (/думает|позже|отлож|kutil/.test(n)) return r("later");
  if (/новый|неразобр|первич/.test(n)) return "";
  return r("talked");
}

/** Ma'lumotni olib kelish (barcha bosqichlar uchun bitta chaqiriq) */
async function fetchAll(domain: string, token: string) {
  const c = connFor(domain, token);
  const [pls, users, leads] = await Promise.all([
    pipelines(c),
    pages<{ id: number; name: string }>("/api/v4/users", "users", {}, c),
    pages<AmoLead>("/api/v4/leads", "leads", { with: "contacts" }, c),
  ]);
  const contactIds = [...new Set(leads.flatMap((l) => l._embedded?.contacts?.map((x) => x.id) ?? []))];
  const companyIds = [...new Set(leads.flatMap((l) => l._embedded?.companies?.map((x) => x.id) ?? []))];
  const [contacts, companies, tasks] = await Promise.all([
    byIds<AmoContact>("/api/v4/contacts", "contacts", contactIds, c),
    byIds<AmoCompany>("/api/v4/companies", "companies", companyIds, c),
    pages<Task>("/api/v4/tasks", "tasks", { "filter[is_completed]": 0 }, c),
  ]);
  return { c, pls, users, leads, contacts, companies, tasks };
}

/** Quruq ishga tushirishdan oldin: bosqichlar va xodimlar ro'yxati (moslash uchun). */
export async function discoverAmo(domain: string, token: string): Promise<AmoDiscovery> {
  const c = connFor(domain, token);
  const [pls, users, leads, results, erpUsers] = await Promise.all([
    pipelines(c),
    pages<{ id: number; name: string }>("/api/v4/users", "users", {}, c),
    pages<AmoLead>("/api/v4/leads", "leads", {}, c),
    db.crmResult.findMany({ select: { id: true, code: true } }),
    db.user.findMany({ where: { isActive: true, role: { notIn: ["DRIVER", "BRIGADIER"] } }, select: { id: true, fullName: true } }),
  ]);
  const cnt = new Map<number, number>(), ucnt = new Map<number, number>();
  for (const l of leads) { cnt.set(l.status_id, (cnt.get(l.status_id) ?? 0) + 1); ucnt.set(l.responsible_user_id, (ucnt.get(l.responsible_user_id) ?? 0) + 1); }
  const stages: AmoStage[] = [];
  for (const p of pls) for (const s of p._embedded.statuses) {
    const n = cnt.get(s.id) ?? 0;
    if (n) stages.push({ id: s.id, pipeline: p.name, name: s.name, count: n, guess: guessStage(s.name, s.id, results) });
  }
  const guessUser = (name: string) => {
    const w = name.toLowerCase().split(/\s+/).filter((x) => x.length >= 3);
    return erpUsers.find((u) => w.some((x) => u.fullName.toLowerCase().includes(x)))?.id ?? "";
  };
  const urows = users.filter((u) => ucnt.get(u.id)).map((u) => ({ id: u.id, name: u.name, count: ucnt.get(u.id) ?? 0, guess: guessUser(u.name) }));
  return { stages, users: urows, leads: leads.length };
}

export async function planFromAmo(domain: string, token: string, map: AmoMapping): Promise<Plan> {
  const plan: Plan = { clients: [], contacts: [], errors: [], warnings: [], info: [] };
  const { c, leads, contacts, companies, tasks } = await fetchAll(domain, token);
  const contactById = new Map(contacts.map((x) => [x.id, x]));
  const companyById = new Map(companies.map((x) => [x.id, x]));
  const contactLead = new Map<number, number>();
  for (const l of leads) for (const k of l._embedded?.contacts ?? []) if (!contactLead.has(k.id)) contactLead.set(k.id, l.id);

  // Ochiq vazifalar → sdelka bo'yicha eng yaqin muddat
  const taskByLead = new Map<number, Task[]>();
  for (const t of tasks) {
    const leadId = t.entity_type === "leads" ? t.entity_id : t.entity_type === "contacts" ? contactLead.get(t.entity_id) : undefined;
    if (!leadId) continue;
    (taskByLead.get(leadId) ?? taskByLead.set(leadId, []).get(leadId)!).push(t);
  }
  const srcRows = await db.crmOption.findMany({ where: { kind: "SOURCE" }, select: { id: true, code: true, label: true } });
  const srcLabel = (code: string) => srcRows.find((s) => s.code === code)?.label ?? null;
  const defaultSource = srcRows.find((s) => s.id === map.sourceId)?.label ?? null;
  if (!defaultSource) plan.errors.push("Manbani tanlang");

  const byPhone = new Map<string, PlanClient>();
  let skipped = 0;
  for (const l of [...leads].sort((a, b) => a.created_at - b.created_at)) {
    const mainContact = l._embedded?.contacts?.find((x) => x.is_main) ?? l._embedded?.contacts?.[0];
    const ct = mainContact ? contactById.get(mainContact.id) : undefined;
    const co = l._embedded?.companies?.[0] ? companyById.get(l._embedded.companies[0].id) : undefined;
    const rawPhone = [...phonesOf(ct?.custom_fields_values), ...phonesOf(co?.custom_fields_values)][0] ?? null;
    const phone = normalizePhone(rawPhone);
    const personName = good(ct?.name);
    const name = good(co?.name) ?? personName ?? good(l.name) ?? (phone ? `Mijoz ${formatPhone(phone)}` : rawPhone ? `Mijoz ${rawPhone}` : null);
    if (!name) { skipped++; continue; }
    const key = phone ?? `amo:${ct?.id ?? `lead${l.id}`}`;
    const tags = (l._embedded?.tags ?? []).map((t) => t.name.toLowerCase()).join(" ") + " " + (l.name ?? "").toLowerCase();
    const source = /facebook|instagram/.test(tags) ? srcLabel("social") : /входящ/.test(tags) ? srcLabel("inbound") : defaultSource;
    const owner = map.users[String(l.responsible_user_id)] || null;
    let client = byPhone.get(key);
    if (!client) {
      client = {
        key, name, inn: null, phone, rawPhone,
        contactPerson: co && personName ? personName : null, region: null, district: null, objectType: null, foremanName: null, foremanPhone: null,
        clientType: co ? "Quruvchi firma" : null, source, ownerId: owner, link: null,
        note: `amoCRM: ${baseUrl(c.domain)}/leads/detail/${l.id}`,
      };
      byPhone.set(key, client);
      plan.clients.push(client);
    } else if (client.name.startsWith("Mijoz ") && !name.startsWith("Mijoz ")) client.name = name;

    const open = (taskByLead.get(l.id) ?? []).sort((a, b) => a.complete_till - b.complete_till);
    const t = open[0];
    const resultId = map.stages[String(l.status_id)] || null;
    plan.contacts.push({
      importKey: `amo:lead:${l.id}`, clientKey: key, date: dayOf(l.updated_at), channel: "Qo'ng'iroq", resultId,
      product: null, offeredPrice: l.price ? Number(l.price) : null, next: t ? dayOf(t.complete_till) : null,
      userId: map.users[String(t?.responsible_user_id ?? l.responsible_user_id)] || owner, leadSource: source,
      objectName: good(l.name), objectArea: null,
      note: open.length ? open.map((x) => x.text).filter(Boolean).join(" · ").slice(0, 2000) || null : null,
    });
  }
  // Bir nechta sdelkali mijoz: keyingi aloqa — eng so'nggi aloqadagi (refreshClient sana bo'yicha oladi)
  plan.info.push(`amoCRM: ${leads.length} sdelka, ${contacts.length} kontakt, ${companies.length} kompaniya, ${tasks.length} ochiq vazifa`);
  plan.info.push(`Telefon bo'yicha birlashtirilib ${plan.clients.length} mijoz bo'ldi`);
  if (skipped) plan.warnings.push(`Nomi ham, telefoni ham yo'q ${skipped} sdelka o'tkazildi`);
  const noStage = plan.contacts.filter((x) => !x.resultId).length;
  if (noStage) plan.info.push(`Natijasiz (bosqichi moslanmagan) aloqalar: ${noStage} ta — voronkada 1-bosqich`);
  const overdue = plan.contacts.filter((x) => x.next && x.next < todayIso()).length;
  if (overdue) plan.info.push(`Muddati o'tgan vazifalar: ${overdue} ta — «Bugun» ekranida «O'tib ketgan» bo'lib chiqadi`);
  await matchExisting(plan.clients, { byName: false });
  return plan;
}
