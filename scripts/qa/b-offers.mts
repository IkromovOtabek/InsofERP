// QA (B) — Tijorat taklifi (KP): tuzish (zayavkasiz, erkin mijoz), QQS hisobi, ruxsat (sotuv ha, sklad yo'q,
// direktor bergan «create» bilan sklad ha), ommaviy QR sahifa (kalitsiz 404, ko'rish hisobi), mijoz «qabul qilaman»
// (ACCEPTED + ariza + bildirishnoma), bekor qilish qoidalari, muddati o'tgan taklif, hujjat sozlamalari.
// Ishga tushirish: npx tsx scripts/qa/b-offers.mts (b-all.sh ichida)
import { as, check, summary, fd, idFrom, q, q1, n1, Client, BASE } from "./b-client.mjs";

const OA = "(app)/takliflar/actions";
const PA = "taklif/[no]/actions";
const sotuv = await as("sotuv"), dir = await as("direktor"), sklad = await as("sklad");
const tag = Date.now() % 1_000_000;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

type Row = { id: string; offerNo: string; token: string };
async function createAs(c: Client, over: Record<string, unknown> = {}) {
  const r = await c.action(`${OA}#createOfferAction`, [undefined, fd({
    clientName: `QA Mijoz ${tag}`, clientPhone: "90 111 22 33", objectName: "QA obyekt", validUntil: inDays(7), withVat: "on", advance: "1000000", lang: "uz",
    "productId[]": ["", ""], "name[]": ["QA plita", "QA dostavka"], "unit[]": ["dona", "reys"], "qty[]": ["10", "2"], "price[]": ["100000", "50000"],
    ...over,
  })], "/takliflar/new");
  const id = r.redirect?.includes("/takliflar/") ? idFrom(r.redirect) : null;
  const row = id ? q1(`select "offerNo"||'|'||"verifyToken" from "CommercialOffer" where id=${lit(id)}`) : null;
  const [offerNo, token] = (row ?? "|").split("|");
  return { r, id, offerNo, token } as { r: Awaited<ReturnType<Client["action"]>>; id: string | null } & Omit<Row, "id">;
}

// ── 1) Sotuv taklif tuzadi (mijoz bazada yo'q, zayavka yo'q) ──
console.log("\n1. Taklif tuzish");
const a = await createAs(sotuv);
check(!!a.id && /^TK-\d{4}-\d{5}$/.test(a.offerNo), "sotuv taklif tuzdi, raqam TK-YYYY-00001 ko'rinishida", a.r.error ?? a.r.redirect);
check(n1(`select count(*) from "CommercialOfferItem" where "offerId"=${lit(a.id ?? "")}`) === 2, "2 ta qator saqlandi");
check(a.token.length >= 12, "QR kaliti (verifyToken) yaratildi");
check(q1(`select status from "CommercialOffer" where id=${lit(a.id ?? "")}`) === "ACTIVE", "holat ACTIVE");
check(n1(`select count(*) from "AuditLog" where entity='CommercialOffer' and "entityId"=${lit(a.id ?? "")} and action='CREATE'`) === 1, "AuditLog CREATE yozildi");
let r = await sotuv.action(`${OA}#createOfferAction`, [undefined, fd({ clientName: `QA ${tag}`, validUntil: inDays(7), "name[]": ["X"], "unit[]": ["dona"], "qty[]": ["0"], "price[]": ["10"], "productId[]": [""] })], "/takliflar/new");
check(/miqdor/.test(r.error ?? ""), "miqdor 0 — rad etildi", r.error);
r = await sotuv.action(`${OA}#createOfferAction`, [undefined, fd({ clientName: `QA ${tag}`, validUntil: inDays(-1), "name[]": ["X"], "unit[]": ["dona"], "qty[]": ["1"], "price[]": ["10"], "productId[]": [""] })], "/takliflar/new");
check(/muddati/i.test(r.error ?? ""), "o'tgan sana — rad etildi", r.error);

// ── 2) Ruxsat: sklad yo'q; direktor «create» bersa — ha ──
console.log("\n2. Ruxsat");
const s1 = await createAs(sklad);
check(!s1.id && (s1.r.forbidden || /ruxsat/.test(s1.r.error ?? "")), "sklad taklif tuza olmaydi", s1.r.error);
q(`update "User" set perms = '{"offers":["create"]}'::jsonb where login='test.sklad'`);
const s2 = await createAs(sklad, { clientName: `QA Sklad ${tag}` });
check(!!s2.id, "direktor «create» bergan sklad taklif tuzdi", s2.r.error);
q(`update "User" set perms = null where login='test.sklad'`);
const pg = await sklad.get("/takliflar/sozlamalar");
check(pg.status === 307 && /denied|login/.test(pg.location ?? ""), "sozlamalar sahifasi skladga yopiq", `${pg.status} ${pg.location}`);

// ── 3) Ommaviy (QR) sahifa ──
console.log("\n3. QR sahifa");
const anon = new Client();
const pub = await anon.get(`/taklif/${a.offerNo}?k=${a.token}`);
check(pub.status === 200 && pub.text.includes(`QA Mijoz ${tag}`) && pub.text.includes("1 232 000"), "kalit bilan ochiladi, mijoz va jami (QQS bilan 1 232 000) ko'rinadi", String(pub.status));
const bad = await anon.get(`/taklif/${a.offerNo}?k=notarealkey12345`);
check(bad.status === 404, "noto'g'ri kalit — 404", String(bad.status));
const nokey = await anon.get(`/taklif/${a.offerNo}`);
check(nokey.status === 404, "kalitsiz — 404", String(nokey.status));
const ping = await fetch(`${BASE}/api/public/taklif-view`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ no: a.offerNo, k: a.token }) });
check(ping.status === 204 && n1(`select "viewCount" from "CommercialOffer" where id=${lit(a.id ?? "")}`) === 1, "ko'rish hisobi 1 ga oshdi", String(ping.status));
const ping2 = await fetch(`${BASE}/api/public/taklif-view`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ no: a.offerNo, k: "wrong" }) });
check(ping2.status === 204 && n1(`select "viewCount" from "CommercialOffer" where id=${lit(a.id ?? "")}`) === 1, "noto'g'ri kalit bilan ping hisoblanmaydi");

// ── 4) Mijoz «qabul qilaman» ──
console.log("\n4. Qabul qilish (QR)");
const salesId = q1(`select id from "User" where login='test.sotuv'`)!;
const notifBefore = n1(`select count(*) from "Notification" where "userId"=${lit(salesId)} and type='OFFER_ACCEPTED'`);
r = await anon.action(`${PA}#replyOffer`, [a.offerNo, a.token, undefined, fd({ kind: "accept", name: "QA Xaridor", phone: "90 222 33 44", note: "QA izoh" })], `/taklif/${a.offerNo}?k=${a.token}`);
check(r.ok, "mijoz qabul qildi — ok", r.error);
check(q1(`select status||'|'||coalesce("acceptedBy",'') from "CommercialOffer" where id=${lit(a.id ?? "")}`) === "ACCEPTED|QA Xaridor", "holat ACCEPTED, kim qabul qilgani yozildi");
await new Promise((res) => setTimeout(res, 1500)); // after() — ariza va bildirishnoma javobdan keyin yoziladi
check(n1(`select count(*) from "Lead" where source='taklif' and phone='+998902223344' and message like '%${a.offerNo}%'`) >= 1, "sotuvga ariza (manba «taklif») tushdi");
check(n1(`select count(*) from "Notification" where "userId"=${lit(salesId)} and type='OFFER_ACCEPTED'`) === notifBefore + 1, "menejerga bildirishnoma ketdi");
r = await anon.action(`${PA}#replyOffer`, [a.offerNo, a.token, undefined, fd({ kind: "accept", name: "QA Xaridor", phone: "90 222 33 44" })], `/taklif/${a.offerNo}?k=${a.token}`);
check(r.ok && q1(`select "acceptedBy" from "CommercialOffer" where id=${lit(a.id ?? "")}`) === "QA Xaridor", "qayta bosilsa — ok, yozuv o'zgarmaydi");
r = await anon.action(`${PA}#replyOffer`, [a.offerNo, "wrongkey123456", undefined, fd({ kind: "question", name: "X Y", phone: "90 222 33 44" })], `/taklif/${a.offerNo}`);
check(/topilmadi/.test(r.error ?? ""), "noto'g'ri kalit bilan javob — rad", r.error);
r = await anon.action(`${PA}#replyOffer`, [a.offerNo, a.token, undefined, fd({ kind: "question", name: "X Y", phone: "123" })], `/taklif/${a.offerNo}`);
check(/Telefon/.test(r.error ?? ""), "yaroqsiz telefon — rad", r.error);
r = await sotuv.action(`${OA}#cancelOfferAction`, [a.id, "sabab"], `/takliflar/${a.id}`);
check(/Qabul qilingan/.test(r.error ?? ""), "qabul qilingan taklif bekor qilinmaydi", r.error);

// ── 5) Bekor qilish ──
console.log("\n5. Bekor qilish");
const b = await createAs(sotuv, { clientName: `QA Bekor ${tag}` });
r = await sotuv.action(`${OA}#cancelOfferAction`, [b.id, "  "], `/takliflar/${b.id}`);
check(/sabab/i.test(r.error ?? ""), "sababsiz bekor — rad", r.error);
r = await sklad.action(`${OA}#cancelOfferAction`, [b.id, "sklad"], `/takliflar/${b.id}`);
check(!r.ok, "sklad bekor qila olmaydi");
r = await sotuv.action(`${OA}#cancelOfferAction`, [b.id, "Narx o'zgardi"], `/takliflar/${b.id}`);
check(r.ok && q1(`select status||'|'||"cancelReason" from "CommercialOffer" where id=${lit(b.id ?? "")}`) === "CANCELLED|Narx o'zgardi", "bekor qilindi, sabab yozildi", r.error);
r = await sotuv.action(`${OA}#cancelOfferAction`, [b.id, "yana"], `/takliflar/${b.id}`);
check(/allaqachon/.test(r.error ?? ""), "ikkinchi marta — allaqachon bekor");
const pubB = await anon.get(`/taklif/${b.offerNo}?k=${b.token}`);
check(pubB.status === 200 && pubB.text.includes("Bekor qilingan"), "QR sahifada «Bekor qilingan»");
r = await anon.action(`${PA}#replyOffer`, [b.offerNo, b.token, undefined, fd({ kind: "accept", name: "QA Xaridor", phone: "90 222 33 44" })], `/taklif/${b.offerNo}`);
check(/bekor/i.test(r.error ?? ""), "bekor qilinganini qabul qilib bo'lmaydi", r.error);

// ── 6) Muddati o'tgan ──
console.log("\n6. Muddati o'tgan");
const c = await createAs(sotuv, { clientName: `QA Muddat ${tag}`, validUntil: inDays(0) });
q(`update "CommercialOffer" set "validUntil" = "validUntil" - interval '3 days' where id=${lit(c.id ?? "")}`);
const pubC = await anon.get(`/taklif/${c.offerNo}?k=${c.token}`);
check(pubC.status === 200 && pubC.text.includes("Muddati o'tgan"), "QR sahifada «Muddati o'tgan»");
r = await anon.action(`${PA}#replyOffer`, [c.offerNo, c.token, undefined, fd({ kind: "accept", name: "QA Xaridor", phone: "90 222 33 44" })], `/taklif/${c.offerNo}`);
check(/muddati/i.test(r.error ?? ""), "muddati o'tganini qabul qilib bo'lmaydi", r.error);
r = await anon.action(`${PA}#replyOffer`, [c.offerNo, c.token, undefined, fd({ kind: "question", name: "QA Xaridor", phone: "90 222 33 44", note: "Yangi narx?" })], `/taklif/${c.offerNo}`);
check(r.ok, "muddati o'tgan taklif bo'yicha savol berish mumkin", r.error);
r = await sotuv.action(`${OA}#acceptOfferAction`, [c.id, "Telefon orqali"], `/takliflar/${c.id}`);
check(r.ok && q1(`select status from "CommercialOffer" where id=${lit(c.id ?? "")}`) === "ACCEPTED", "menejer qo'lda «qabul qildi» deb belgiladi (muddati o'tgan bo'lsa ham)", r.error);
const list = await sotuv.get("/takliflar?holat=ACCEPTED");
check(list.status === 200 && list.text.includes(a.offerNo) && !list.text.includes(b.offerNo), "ro'yxat filtri: qabul qilinganlar ichida bekor qilingani yo'q");

// ── 7) Hujjat sozlamalari ──
console.log("\n7. Sozlamalar");
r = await sotuv.action(`${OA}#saveOfferSettings`, [undefined, fd({ oked: "23610", vatRegNo: "327", offerValidDays: "10" })], "/takliflar/sozlamalar");
check(!r.ok, "sotuv sozlamani o'zgartira olmaydi");
r = await dir.action(`${OA}#saveOfferSettings`, [undefined, fd({ oked: "23610", vatRegNo: "327150004640", offerValidDays: "10", offerTerms: "QA shart 1\nQA shart 2" })], "/takliflar/sozlamalar");
check(r.ok && q1(`select oked||'|'||"offerValidDays" from "CompanySettings" where id='main'`) === "23610|10", "direktor saqladi (OKED, muddat)", r.error);
const d = await createAs(sotuv, { clientName: `QA Shart ${tag}` });
const prn = await sotuv.get(`/takliflar/${d.id}/print`);
check(prn.status === 200 && prn.text.includes("QA shart 2") && prn.text.includes("23610") && prn.text.includes("TIJORAT TAKLIFI"), "chop etish hujjatida shartlar va OKED chiqdi");
const prnRu = await sotuv.get(`/takliflar/${d.id}/print?lang=ru`);
check(prnRu.status === 200 && prnRu.text.includes("КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ"), "ruscha ko'rinish");
r = await dir.action(`${OA}#saveOfferSettings`, [undefined, fd({ offerValidDays: "0" })], "/takliflar/sozlamalar");
check(/kamida/i.test(r.error ?? ""), "muddat 0 kun — rad", r.error);

summary("b-offers");
