/**
 * QA (C): amoCRM integratsiyasi — kutubxona darajasida (serversiz), soxta amoCRM (lokal http stub) bilan, faqat insof_test… bazasida.
 *   · domen tekshiruvi, tokenlar seyfi (SMM seyfidan alohida kalit);
 *   · ulash (uzoq muddatli token): hisob tekshiruvi, webhook o'rnatish, bosqich moslamasi tekshiruvi;
 *   · sayt arizasi → sdelka + kontakt + eslatma; takror yuborilmaydi; amoCRM yiqilsa navbatda qoladi;
 *   · «ERP'ga» bosqichi → mijoz (INN/telefon bo'yicha dublsiz), kelishuv READY, ariza «Mijoz bo'ldi»;
 *   · webhook: noto'g'ri kalit 404, to'g'risi sdelkani API'dan qayta o'qiydi;
 *   · zayavka → sdelka bosqichi va byudjeti; o'zgarmasa so'rov ketmaydi; bekor qilinsa — «bekor» bosqichi;
 *   · 401 → ulanish ERROR, tsikl to'xtaydi; OAuth: muddati o'tgan token refresh bilan yangilanadi;
 *   · API'siz (WEBHOOK) usul: sdelka xabar tanasidan, mijoz telefon bo'yicha (dublsiz), telefonsiz — mijozsiz kelishuv,
 *     bosqich filtri, boshqa hisob subdomeni 404, amoCRM'ga hech qanday so'rov ketmaydi.
 *
 *   ENV_FILE=.env.test.example DATABASE_URL=postgresql://…/insof_test_… npx tsx scripts/qa/c-amocrm.ts
 */
import { check, done, section } from "./c-lib";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/lib/db";
import { vault, normalizeDomain, AMO_ID, getConnection, isActive, isReady, AMO_SYSTEM_LOGIN } from "@/lib/amocrm/store";
import { seal as smmSeal } from "@/lib/smm/vault";
import { connectWebhookOnly, connectWithToken, saveStages, saveWebhookStage, disconnectAmo } from "@/lib/amocrm/connect";
import { amo } from "@/lib/amocrm/client";
import { amoTick, dealStage, dismissDeal, pullDeal, pullStageDeals, pushPendingLeads, syncOrderStages } from "@/lib/amocrm/sync";
import { createLead } from "@/lib/leads";
import { createOrder } from "@/lib/orders";
import { date } from "@/lib/format";

const TAG = `qa-amo-${Date.now()}`;
const TOKEN = "qa-long-lived-token-0123456789abcdefghijklmnopqrstuvwxyz";
const P = 100, S_NEW = 1001, S_OFFER = 1002, S_ERP = 1003, S_PROD = 1004, S_DELIV = 1005, WON = 142, LOST = 143;

// ───────── Soxta amoCRM ─────────
type Lead = { id: number; name: string; price: number; status_id: number; pipeline_id: number; responsible_user_id: number; updated_at: number; contacts: number[]; companies: number[]; custom_fields_values: unknown[] | null };
const st = {
  tokens: new Set([TOKEN]),
  leads: new Map<number, Lead>(),
  contacts: new Map<number, { id: number; name: string; phone: string }>(),
  companies: new Map<number, { id: number; name: string; inn: string }>(),
  notes: [] as { leadId: number; text: string }[],
  patches: [] as { id: number; body: Record<string, number> }[],
  webhooks: [] as string[],
  failComplex: false,
  refreshCalls: 0,
  seq: 5000,
  requests: 0,
};
const now = () => Math.floor(Date.now() / 1000);

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
async function readBody(req: IncomingMessage): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const t = Buffer.concat(chunks).toString("utf8");
  return t ? JSON.parse(t) : null;
}
const leadOut = (l: Lead) => ({ ...l, _embedded: { contacts: l.contacts.map((id, i) => ({ id, is_main: i === 0 })), companies: l.companies.map((id) => ({ id })) } });

const server = createServer(async (req, res) => {
  st.requests++;
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  if (p === "/oauth2/access_token" && req.method === "POST") {
    const b = await readBody(req);
    if (b.client_secret !== "qa-secret-0123456789abcdef" || !["qa-refresh-1", "qa-refresh-2"].includes(b.refresh_token)) return send(res, 400, { hint: "bad" });
    st.refreshCalls++;
    st.tokens.add("qa-access-2");
    return send(res, 200, { token_type: "Bearer", expires_in: 86400, access_token: "qa-access-2", refresh_token: "qa-refresh-2" });
  }
  const auth = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!st.tokens.has(auth)) return send(res, 401, { title: "Unauthorized" });

  if (p === "/api/v4/account") return send(res, 200, { id: 777, name: "QA amoCRM", subdomain: "qa" });
  if (p === "/api/v4/leads/pipelines") {
    return send(res, 200, { _embedded: { pipelines: [{ id: P, name: "Beton savdo", is_main: true, _embedded: { statuses: [
      { id: S_NEW, name: "Yangi", sort: 10, type: 1 }, { id: S_OFFER, name: "Taklif", sort: 20, type: 0 }, { id: S_ERP, name: "Kelishildi (ERP)", sort: 30, type: 0 },
      { id: S_PROD, name: "Ishlab chiqarishda", sort: 40, type: 0 }, { id: S_DELIV, name: "Yetkazildi", sort: 50, type: 0 },
      { id: WON, name: "Muvaffaqiyatli", sort: 10000, type: 0 }, { id: LOST, name: "Yopildi", sort: 11000, type: 0 },
    ] } }] } });
  }
  if (p === "/api/v4/webhooks") {
    const b = await readBody(req);
    if (req.method === "POST") { st.webhooks.push(b.destination); return send(res, 200, { id: 1, destination: b.destination }); }
    st.webhooks = st.webhooks.filter((w) => w !== b.destination);
    return send(res, 204);
  }
  if (p === "/api/v4/contacts" && req.method === "GET") {
    const q = url.searchParams.get("query") ?? "";
    const hits = [...st.contacts.values()].filter((c) => c.phone.replace(/\D+/g, "").endsWith(q));
    if (!hits.length) return send(res, 204);
    return send(res, 200, { _embedded: { contacts: hits.map((c) => ({ id: c.id, name: c.name, custom_fields_values: [{ field_code: "PHONE", values: [{ value: c.phone }] }] })) } });
  }
  let m = /^\/api\/v4\/contacts\/(\d+)$/.exec(p);
  if (m) {
    const c = st.contacts.get(Number(m[1]));
    return c ? send(res, 200, { id: c.id, name: c.name, custom_fields_values: [{ field_code: "PHONE", values: [{ value: c.phone }] }] }) : send(res, 404);
  }
  m = /^\/api\/v4\/companies\/(\d+)$/.exec(p);
  if (m) {
    const c = st.companies.get(Number(m[1]));
    return c ? send(res, 200, { id: c.id, name: c.name, custom_fields_values: [{ field_id: 9, field_name: "ИНН", values: [{ value: c.inn }] }] }) : send(res, 404);
  }
  m = /^\/api\/v4\/users\/(\d+)$/.exec(p);
  if (m) return send(res, 200, { id: Number(m[1]), name: "Menejer Alisher" });
  if (p === "/api/v4/leads/complex" && req.method === "POST") {
    if (st.failComplex) return send(res, 500, { title: "Internal" });
    const b = (await readBody(req))[0];
    const k = b._embedded.contacts[0];
    let cid = k.id as number | undefined;
    if (!cid) { cid = ++st.seq; st.contacts.set(cid, { id: cid, name: k.first_name, phone: k.custom_fields_values?.[0]?.values?.[0]?.value ?? "" }); }
    const id = ++st.seq;
    st.leads.set(id, { id, name: b.name, price: 0, status_id: b.status_id ?? S_NEW, pipeline_id: b.pipeline_id ?? P, responsible_user_id: 11, updated_at: now(), contacts: [cid], companies: [], custom_fields_values: null });
    return send(res, 200, [{ id, contact_id: cid, company_id: null, request_id: ["0"], merged: false }]);
  }
  m = /^\/api\/v4\/leads\/(\d+)\/notes$/.exec(p);
  if (m && req.method === "POST") { const b = await readBody(req); st.notes.push({ leadId: Number(m[1]), text: b[0].params.text }); return send(res, 200, { _embedded: { notes: [{ id: 1 }] } }); }
  m = /^\/api\/v4\/leads\/(\d+)$/.exec(p);
  if (m) {
    const l = st.leads.get(Number(m[1]));
    if (!l) return send(res, 404, { title: "Not found" });
    if (req.method === "PATCH") {
      const b = await readBody(req);
      st.patches.push({ id: l.id, body: b });
      Object.assign(l, b, { updated_at: now() });
      return send(res, 200, { id: l.id });
    }
    return send(res, 200, leadOut(l));
  }
  if (p === "/api/v4/leads" && req.method === "GET") {
    const sid = Number(url.searchParams.get("filter[statuses][0][status_id]"));
    const from = Number(url.searchParams.get("filter[updated_at][from]"));
    const list = [...st.leads.values()].filter((l) => l.status_id === sid && l.updated_at >= from);
    return list.length ? send(res, 200, { _embedded: { leads: list.map(leadOut) } }) : send(res, 204);
  }
  send(res, 404, { title: `stub: ${req.method} ${p}` });
});

/** amoCRM'da menejer sdelkani boshqa bosqichga o'tkazdi */
function move(id: number, status: number, price?: number) {
  const l = st.leads.get(id)!;
  l.status_id = status; l.updated_at = now();
  if (price != null) l.price = price;
}

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const domain = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sales = await db.user.findUniqueOrThrow({ where: { login: "test.sotuv" } });
  const actor = { userId: sales.id, name: sales.fullName };
  // Oldingi yugurishdan qolgan holat
  await db.order.updateMany({ where: { amoDealId: { not: null } }, data: { amoDealId: null } });
  await db.amoDeal.deleteMany({});
  await db.amoConnection.deleteMany({});

  section("Domen va seyf");
  check("insof.amocrm.ru", normalizeDomain("https://Insof.amocrm.ru/leads/") === "insof.amocrm.ru");
  check("kommo.com", normalizeDomain("abc.kommo.com") === "abc.kommo.com");
  check("begona domen rad etiladi", normalizeDomain("evil.example.com") === null && normalizeDomain("amocrm.ru.evil.com") === null);
  check("test rejimida lokal stub qabul qilinadi", normalizeDomain(domain) === domain);
  const sealed = vault.seal("abc");
  check("seal → unseal", vault.unseal(sealed) === "abc");
  check("SMM seyfi shifri amoCRM seyfida ochilmaydi", vault.unseal(smmSeal("abc")) === null);

  section("Ulash");
  const name = await connectWithToken(domain, TOKEN, actor);
  let c = await getConnection();
  check("hisob nomi olindi", name === "QA amoCRM", name);
  check("ulanish ACTIVE, token shifrlangan", c?.status === "ACTIVE" && !!c.accessTokenEnc && !c.accessTokenEnc.includes(TOKEN));
  check("webhook o'rnatildi", c?.webhookOk === true && st.webhooks.length === 1 && st.webhooks[0]!.endsWith(`/api/amocrm/webhook/${c?.webhookKey}`));
  const audit = await db.auditLog.findFirst({ where: { entity: "AmoConnection" }, orderBy: { createdAt: "desc" } });
  check("auditda token yo'q", !!audit && !JSON.stringify(audit.after).includes(TOKEN) && !JSON.stringify(audit.after).includes("accessToken"));
  const badToken = await connectWithToken(domain, "wrong-token-0123456789abcdefghijklmnopqrstuvwxyz", actor).then(() => "ok", (e: Error) => e.message);
  check("noto'g'ri token saqlanmaydi", badToken !== "ok" && (await getConnection())?.status === "ACTIVE", badToken);

  const stages = { pipelineId: P, stageNewLead: S_NEW, stageToErp: S_ERP, stageConfirmed: S_PROD, stageDelivered: S_DELIV, stageClosed: WON, stageCancelled: LOST, pushLeads: true };
  const e1 = await saveStages({ ...stages, stageToErp: 99999 }, actor).then(() => null, (e: Error) => e.message);
  check("voronkada yo'q bosqich rad etiladi", !!e1 && /voronkada yo'q/.test(e1), e1);
  const e2 = await saveStages({ ...stages, stageToErp: null }, actor).then(() => null, (e: Error) => e.message);
  check("«ERP'ga» bosqichi majburiy", !!e2, e2);
  await saveStages(stages, actor);
  c = await getConnection();
  check("bosqichlar saqlandi", c?.stageToErp === S_ERP && c?.stageClosed === WON);

  section("Sayt arizasi → amoCRM");
  const phone = `+99890${String(Date.now()).slice(-7)}`;
  const lr = await createLead({ name: `${TAG} Ali`, phone, address: "Toshkent, Chilonzor 5", message: "M300 kerak", utm: { source: "instagram", campaign: "kuz" } });
  check("ariza yaratildi", lr.ok);
  const lead = await db.lead.findFirstOrThrow({ where: { phone }, orderBy: { createdAt: "desc" } });
  // createLead fon vazifasi (pushLeadLater) ham ishlaydi — tsikl bilan birga ikki marta yuborilmasligi tekshiriladi
  await pushPendingLeads(c!);
  await new Promise((r) => setTimeout(r, 300));
  await pushPendingLeads(c!);
  const deal1 = await db.amoDeal.findUnique({ where: { leadId: lead.id } });
  check("sdelka ochildi (IN_AMO, id saqlandi)", deal1?.state === "IN_AMO" && !!deal1.amoLeadId, deal1);
  const amoLeads = [...st.leads.values()].filter((l) => l.name.includes(`${TAG} Ali`));
  check("amoCRM'da bitta sdelka (takror yo'q)", amoLeads.length === 1, amoLeads.length);
  check("sdelka «Yangi» bosqichida va voronkada", amoLeads[0]?.status_id === S_NEW && amoLeads[0]?.pipeline_id === P);
  // Eslatma sdelkadan keyin alohida so'rov bilan yoziladi (fon vazifasi ham) — band mashinada 300 ms yetmaydi, 3 s gacha kutiladi
  let note = st.notes.find((n) => n.leadId === deal1?.amoLeadId);
  for (let i = 0; !note && i < 30; i++) { await new Promise((r) => setTimeout(r, 100)); note = st.notes.find((n) => n.leadId === deal1?.amoLeadId); }
  check("eslatmada telefon, manzil va reklama", !!note && note.text.includes(phone) && note.text.includes("Chilonzor") && note.text.includes("instagram"), note?.text);

  // Shu telefon bilan ikkinchi ariza (2 daqiqadan keyin bo'lsa) — mavjud kontaktga bog'lanadi
  const lead2 = await db.lead.create({ data: { name: `${TAG} Ali qayta`, phone } });
  await pushPendingLeads(c!);
  const deal2 = await db.amoDeal.findUnique({ where: { leadId: lead2.id } });
  const l2 = deal2?.amoLeadId ? st.leads.get(deal2.amoLeadId) : null;
  check("qaytgan mijoz — mavjud amoCRM kontaktiga", !!l2 && l2.contacts[0] === amoLeads[0]?.contacts[0], { l2: l2?.contacts, first: amoLeads[0]?.contacts });

  st.failComplex = true;
  const lead3 = await db.lead.create({ data: { name: `${TAG} Vali`, phone: `+99891${String(Date.now()).slice(-7)}` } });
  await pushPendingLeads(c!);
  const d3 = await db.amoDeal.findUnique({ where: { leadId: lead3.id } });
  check("amoCRM yiqilsa — navbatda qoladi (xato va keyingi urinish)", d3?.state === "PUSHING" && d3.pushAttempts === 1 && !!d3.pushError && !!d3.nextPushAt && d3.nextPushAt > new Date(), d3);
  st.failComplex = false;
  await pushPendingLeads(c!);
  check("vaqti kelmaguncha qayta yuborilmaydi", (await db.amoDeal.findUnique({ where: { leadId: lead3.id } }))?.state === "PUSHING");
  await db.amoDeal.update({ where: { leadId: lead3.id }, data: { nextPushAt: new Date(Date.now() - 1000) } });
  await pushPendingLeads(c!);
  const d3b = await db.amoDeal.findUnique({ where: { leadId: lead3.id } });
  check("vaqti kelganda yuborildi, xato tozalandi", d3b?.state === "IN_AMO" && !!d3b.amoLeadId && d3b.pushError === null, d3b);

  section("amoCRM → ERP («ERP'ga» bosqichi)");
  // Sayt arizasidan kelgan sdelka: kompaniya va INN amoCRM'da qo'shildi, menejer «Kelishildi» ga o'tkazdi
  const inn = String(300000000 + (Date.now() % 99999999)).slice(0, 9);
  const compId = ++st.seq;
  st.companies.set(compId, { id: compId, name: `${TAG} Qurilish MChJ`, inn });
  st.leads.get(deal1!.amoLeadId!)!.companies = [compId];
  move(deal1!.amoLeadId!, S_ERP, 12_500_000);
  const n1 = await pullStageDeals(c!);
  const ready1 = await db.amoDeal.findUnique({ where: { id: deal1!.id }, include: { customer: true } });
  check("tekshiruv sdelkani topdi → READY", n1 >= 1 && ready1?.state === "READY", { n1, st: ready1?.state });
  check("mijoz kompaniya nomi va INN bilan ochildi", ready1?.customer?.name === `${TAG} Qurilish MChJ` && ready1.customer.inn === inn && ready1.customer.phone === phone, ready1?.customer);
  check("byudjet va mas'ul menejer", Number(ready1?.price) === 12_500_000 && ready1?.responsible === "Menejer Alisher");
  const leadAfter = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
  check("sayt arizasi «Mijoz bo'ldi»", leadAfter.status === "CONVERTED" && leadAfter.customerId === ready1?.customerId);
  const sys = await db.user.findUnique({ where: { login: AMO_SYSTEM_LOGIN } });
  check("tizim foydalanuvchisi kira olmaydi", sys?.isActive === false);
  const again = await pullDeal(deal1!.amoLeadId!, c!);
  check("qayta o'qish — mijoz ikkinchi marta ochilmaydi", again === "updated" && (await db.customer.count({ where: { inn } })) === 1);

  // amoCRM'ning o'zida ochilgan sdelka: kontakt telefoni ERP'dagi mavjud mijozniki
  const existing = await db.customer.create({ data: { name: `${TAG} Eski mijoz`, phone: `+99893${String(Date.now()).slice(-7)}` } });
  const k2 = ++st.seq;
  // amoCRM'da raqam boshqa ko'rinishda yozilgan bo'lsa ham topiladi
  st.contacts.set(k2, { id: k2, name: "Bobur", phone: existing.phone!.replace(/^\+998(\d\d)(\d{3})(\d\d)(\d\d)$/, "+998 ($1) $2-$3-$4") });
  const own = ++st.seq;
  st.leads.set(own, { id: own, name: `${TAG} Telegramdan`, price: 3_000_000, status_id: S_OFFER, pipeline_id: P, responsible_user_id: 11, updated_at: now(), contacts: [k2], companies: [], custom_fields_values: [{ field_id: 5, field_name: "Manzil", values: [{ value: "Yunusobod 7" }] }] });
  check("«ERP'ga» bosqichida bo'lmagan sdelka tushmaydi", (await pullDeal(own, c!)) === "skipped" && !(await db.amoDeal.findUnique({ where: { amoLeadId: own } })));

  section("Webhook");
  const { POST } = await import("@/app/api/amocrm/webhook/[key]/route");
  const call = (key: string, body: string) => POST(new Request(`http://localhost/api/amocrm/webhook/${key}`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }), { params: Promise.resolve({ key }) });
  move(own, S_ERP);
  const bad = await call("notthekey-notthekey-notthekey12", `leads[status][0][id]=${own}&leads[status][0][status_id]=${S_ERP}`);
  check("noto'g'ri kalit — 404", bad.status === 404);
  const good = await call(c!.webhookKey, `leads[status][0][id]=${own}&leads[status][0][status_id]=${S_ERP}&leads[status][0][pipeline_id]=${P}&account[id]=777`);
  check("to'g'ri kalit — 200", good.status === 200);
  let ownDeal = null;
  for (let i = 0; i < 20 && !ownDeal; i++) { await new Promise((r) => setTimeout(r, 150)); ownDeal = await db.amoDeal.findUnique({ where: { amoLeadId: own } }); }
  check("webhook → sdelka o'qildi, mavjud mijozga (telefon bo'yicha) bog'landi", ownDeal?.state === "READY" && ownDeal.customerId === existing.id, ownDeal);
  check("manzil sdelka maydonidan", ownDeal?.address === "Yunusobod 7");
  const fake = await call(c!.webhookKey, `leads[status][0][id]=999999&leads[status][0][status_id]=${S_ERP}`);
  await new Promise((r) => setTimeout(r, 300));
  check("soxta id — amoCRM'da yo'q, hech narsa ochilmaydi", fake.status === 200 && !(await db.amoDeal.findUnique({ where: { amoLeadId: 999999 } })));

  section("Zayavka → sdelka bosqichi");
  const product = await db.product.findFirst({ where: { isActive: true }, orderBy: { name: "asc" } });
  check("test bazasida mahsulot bor", !!product);
  if (product) {
    const wrongCust = await createOrder({
      customerId: existing.id, deliveryDate: new Date(Date.now() + 86_400_000), deliveryAddress: "X", items: [{ productId: product.id, qtyM3: 1, price: 100 }],
      prepay: { amount: 100 }, amoDealId: ready1!.id,
    }, sales.id).then(() => "ok", (e: Error) => e.message);
    check("boshqa mijozga kelishuv bog'lanmaydi", wrongCust !== "ok" && /kelishuv/i.test(wrongCust), wrongCust);
    st.patches.length = 0;
    const o = await createOrder({
      customerId: ready1!.customerId!, deliveryDate: new Date(Date.now() + 86_400_000), deliveryAddress: "Toshkent, Chilonzor 5",
      items: [{ productId: product.id, qtyM3: 10, price: 1_200_000 }], prepay: { amount: 12_000_000 }, amoDealId: ready1!.id,
    }, sales.id);
    const linked = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    const dOrdered = await db.amoDeal.findUniqueOrThrow({ where: { id: ready1!.id } });
    check("zayavka kelishuvga bog'landi, holat ORDERED", linked.amoDealId === ready1!.id && dOrdered.state === "ORDERED");
    // createOrder fon chaqiruvi (syncDealLater) bilan ketma-ket ishlaydi — ikkalasidan bitta so'rov chiqishi kerak
    await syncOrderStages(c!, { full: true });
    const p1 = st.patches.find((x) => x.id === deal1!.amoLeadId);
    check("parallel sinxronda bosqich ikki marta yuborilmadi", st.patches.filter((x) => x.id === deal1!.amoLeadId).length === 1, st.patches);
    check("qoralama: faqat byudjet (bosqich siljimaydi)", !!p1 && p1.body.price === 12_000_000 && p1.body.status_id === undefined, p1);
    await db.order.update({ where: { id: o.id }, data: { status: "CONFIRMED" } });
    st.patches.length = 0;
    await syncOrderStages(c!, { full: true });
    const p2 = st.patches.find((x) => x.id === deal1!.amoLeadId && x.body.status_id != null);
    check("qabul qilindi → «Ishlab chiqarishda»", p2?.body.status_id === S_PROD && st.leads.get(deal1!.amoLeadId!)?.status_id === S_PROD, p2);
    check("sdelkaga eslatma (yetkazish sanasi bilan, raqamsiz)", st.notes.some((n) => n.leadId === deal1!.amoLeadId && n.text.includes(date(linked.deliveryDate)) && !n.text.includes(linked.orderNo)));
    st.patches.length = 0;
    await syncOrderStages(c!, { full: true });
    check("o'zgarmasa — so'rov ketmaydi", st.patches.length === 0, st.patches);
    // Menejer amoCRM'da qo'lda boshqa bosqichga o'tkazdi — ERP uni qaytarib siljitmaydi
    move(deal1!.amoLeadId!, S_OFFER);
    await syncOrderStages(c!, { full: true });
    check("qo'lda siljitilgan bosqich qaytarilmaydi", st.leads.get(deal1!.amoLeadId!)?.status_id === S_OFFER);
    await db.order.update({ where: { id: o.id }, data: { status: "CLOSED" } });
    await syncOrderStages(c!);
    check("to'lov yopildi → «Muvaffaqiyatli» (o'zgargan zayavka tez tekshiruvda)", st.leads.get(deal1!.amoLeadId!)?.status_id === WON);
    await db.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    await syncOrderStages(c!, { full: true });
    const lc = st.leads.get(deal1!.amoLeadId!);
    check("bekor qilindi → «Yopildi», byudjet 0", lc?.status_id === LOST && lc.price === 0, lc);
  }

  section("Bosqich hisobi (bir nechta zayavka)");
  const it = (q: number, p: number) => ({ qtyM3: q, price: p }) as unknown as { qtyM3: never; price: never };
  const ord = (status: string, q = 1, p = 100) => ({ orderNo: "Z", status: status as never, deliveryFee: 0 as never, items: [it(q, p)] });
  check("zayavka yo'q — siljimaydi", dealStage([]).stage === null);
  check("bittasi yetkazildi, biri ishlab chiqarishda → CONFIRMED", dealStage([ord("DELIVERED"), ord("IN_PRODUCTION")]).stage === "CONFIRMED");
  check("bekor + yetkazildi → DELIVERED, summa bekorsiz", (() => { const r = dealStage([ord("CANCELLED", 5), ord("DELIVERED", 2)]); return r.stage === "DELIVERED" && r.price === 200; })());
  check("hammasi yopildi → CLOSED", dealStage([ord("CLOSED"), ord("CLOSED")]).stage === "CLOSED");
  check("faqat qoralama → siljimaydi", dealStage([ord("DRAFT"), ord("BLOCKED")]).stage === null);

  section("Kerak emas");
  const dis = await dismissDeal(ownDeal!.id, sales.id);
  check("READY → DISMISSED", dis.ok && (await db.amoDeal.findUniqueOrThrow({ where: { id: ownDeal!.id } })).state === "DISMISSED");
  move(own, S_ERP);
  await pullStageDeals(c!);
  check("yopilgan kelishuv tekshiruvda qayta ochilmaydi", (await db.amoDeal.findUniqueOrThrow({ where: { id: ownDeal!.id } })).state === "DISMISSED");

  section("Token xatosi");
  st.tokens.delete(TOKEN);
  const e401 = await amo("/api/v4/account").then(() => null, (e: Error) => e.message);
  check("401 → xato matni", !!e401 && /token/i.test(e401), e401);
  c = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  check("ulanish ERROR holatiga o'tdi", c?.status === "ERROR" && !!c.lastError);
  const reqBefore = st.requests;
  check("ERROR holatida tsikl so'rov yubormaydi", (await amoTick()) === null && st.requests === reqBefore);

  section("OAuth refresh");
  await db.amoConnection.update({
    where: { id: AMO_ID },
    data: { method: "OAUTH", clientId: "qa-client-0000-0000-0000-000000000000", clientSecretEnc: vault.seal("qa-secret-0123456789abcdef"), accessTokenEnc: vault.seal("qa-access-expired"), refreshTokenEnc: vault.seal("qa-refresh-1"), tokenExpiresAt: new Date(Date.now() - 60_000), status: "ACTIVE", lastError: null },
  });
  const acc = await amo<{ name: string }>("/api/v4/account").catch((e: Error) => ({ name: `xato: ${e.message}` }));
  c = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  check("muddati o'tgan token yangilandi va so'rov o'tdi", acc.name === "QA amoCRM" && st.refreshCalls === 1, acc);
  check("yangi refresh token bazaga yozildi", vault.unseal(c?.refreshTokenEnc) === "qa-refresh-2" && vault.unseal(c?.accessTokenEnc) === "qa-access-2" && (c?.tokenExpiresAt?.getTime() ?? 0) > Date.now() + 3600_000);

  section("Uzish");
  const hook = st.webhooks[0];
  await disconnectAmo(actor);
  c = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  check("DISCONNECTED, tokenlar o'chirildi", c?.status === "DISCONNECTED" && !c.accessTokenEnc && !c.refreshTokenEnc);
  check("webhook amoCRM'dan olib tashlandi", !st.webhooks.includes(hook!));
  check("uzilgandan keyin ulanish yo'q", !isReady(await getConnection()));
  const oldHook = await call(hook!.split("/").pop()!, `leads[status][0][id]=${own}&leads[status][0][status_id]=${S_ERP}`);
  check("eski webhook kaliti endi 404", oldHook.status === 404);

  section("Faqat webhook (API'siz)");
  await connectWebhookOnly(domain, actor);
  c = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  check("WEBHOOK usulida ulandi, token yo'q", c?.method === "WEBHOOK" && c.status === "ACTIVE" && !c.accessTokenEnc && isActive(c) && !isReady(c));
  check("yangi webhook kaliti", !!c && c.webhookKey !== hook!.split("/").pop());
  check("o'sha hisob — API usulidagi «ERP'ga» bosqichi saqlandi", c?.stageToErp === S_ERP && c.pipelineId === P);
  await saveWebhookStage(null, null, actor);
  const wReq = st.requests;
  const wPhone = `+99890${String(Date.now()).slice(-7)}`;
  const W1 = 880001, W2 = 880002, W3 = 880003;
  const fieldsBody = (p: string, id: number, statusId: number, extra: string) =>
    `${p}[id]=${id}&${p}[name]=${encodeURIComponent(`${TAG} webhook ${id}`)}&${p}[status_id]=${statusId}&${p}[pipeline_id]=${P}&${p}[price]=5000000${extra}`;
  const withPhone = `&leads[status][0][custom_fields][0][id]=1&leads[status][0][custom_fields][0][name]=${encodeURIComponent("Telefon")}&leads[status][0][custom_fields][0][values][0][value]=${encodeURIComponent(wPhone)}`
    + `&leads[status][0][custom_fields][1][id]=2&leads[status][0][custom_fields][1][name]=${encodeURIComponent("Kompaniya")}&leads[status][0][custom_fields][1][values][0][value]=${encodeURIComponent(`${TAG} MChJ`)}`
    + `&leads[status][0][custom_fields][2][id]=3&leads[status][0][custom_fields][2][name]=${encodeURIComponent("Адрес")}&leads[status][0][custom_fields][2][values][0][value]=${encodeURIComponent("Sergeli 3")}`;
  const waitDeal = async (id: number) => { let d = null; for (let i = 0; i < 20 && !d; i++) { await new Promise((r) => setTimeout(r, 150)); d = await db.amoDeal.findUnique({ where: { amoLeadId: id } }); } return d; };

  const evil = await call(c!.webhookKey, `${fieldsBody("leads[status][0]", W1, S_ERP, withPhone)}&account[subdomain]=boshqa`);
  check("boshqa hisob subdomeni — 404", evil.status === 404);
  const w1 = await call(c!.webhookKey, fieldsBody("leads[status][0]", W1, S_ERP, withPhone));
  const d1 = await waitDeal(W1);
  check("bosqich tanlanmagan — sdelka tanadan READY bo'ldi", w1.status === 200 && d1?.state === "READY" && Number(d1.price) === 5_000_000, d1);
  const cust1 = d1?.customerId ? await db.customer.findUnique({ where: { id: d1.customerId } }) : null;
  check("mijoz telefon va kompaniya maydonidan ochildi", cust1?.name === `${TAG} MChJ` && cust1.phone === wPhone && d1?.address === "Sergeli 3", cust1);
  await call(c!.webhookKey, fieldsBody("leads[status][0]", W1, S_ERP, withPhone));
  await new Promise((r) => setTimeout(r, 400));
  check("takror xabar — dubl yo'q", (await db.customer.count({ where: { phone: wPhone } })) === 1 && (await db.amoDeal.count({ where: { amoLeadId: W1 } })) === 1);
  c = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  check("oxirgi xabar va bosqich ID sozlamada ko'rinadi", !!c?.lastWebhookAt && c.lastWebhookInfo?.includes(`bosqich ${S_ERP}`) === true, c?.lastWebhookInfo);

  await call(c!.webhookKey, fieldsBody("leads[add][0]", W2, S_NEW, ""));
  const d2 = await waitDeal(W2);
  check("telefon/INN yo'q — kelishuv mijozsiz (sotuvchi tanlaydi)", d2?.state === "READY" && d2.customerId === null, d2);

  await saveWebhookStage(S_ERP, null, actor);
  await call(c!.webhookKey, fieldsBody("leads[status][0]", W3, S_OFFER, ""));
  await new Promise((r) => setTimeout(r, 400));
  check("bosqich tanlangan — boshqa bosqich sdelkasi tushmaydi", !(await db.amoDeal.findUnique({ where: { amoLeadId: W3 } })));
  await call(c!.webhookKey, fieldsBody("leads[status][0]", W3, S_ERP, ""));
  check("«ERP'ga» bosqichiga o'tganda tushadi", (await waitDeal(W3))?.state === "READY");

  const wProduct = await db.product.findFirstOrThrow({ where: { isActive: true } });
  const o2 = await createOrder({
    newCustomer: { name: `${TAG} yangi mijoz`, phone: null, inn: null, address: null }, deliveryDate: new Date(Date.now() + 86_400_000), deliveryAddress: "X",
    items: [{ productId: wProduct.id, qtyM3: 1, price: 100 }], prepay: { amount: 100 }, amoDealId: d2!.id,
  }, sales.id).then((o) => o, (e: Error) => e.message);
  const d2o = await db.amoDeal.findUniqueOrThrow({ where: { id: d2!.id } });
  check("mijozsiz kelishuvdan yangi mijoz bilan zayavka — bog'landi", typeof o2 !== "string" && d2o.state === "ORDERED" && !!d2o.customerId, o2);
  check("tsikl API'ga so'rov yubormaydi", (await amoTick({ force: true })) === null && st.requests === wReq);

  server.close();
}

main().then(done, (e) => { console.error(e); server.close(); done(); });
