// QA (B) — otdel kadr 4-faza: so'rovnoma (anonimlik, bir kishi — bir javob, tekshiruvlar, natijalar), HR chat
// (anonim murojaat: muallif saqlanmaydi, lekin o'zi ko'radi; begona ko'rmaydi), ommaviy xabar, hisobot va Excel,
// E-IMZO imzosini saqlash (hujjat matniga tegishlilik tekshiruvi, server sozlanmaganda «tekshirilmagan»).
// Ishga tushirish: npx tsx scripts/qa/b-voice.mts (b-all.sh ichida)
import { randomBytes } from "node:crypto";
import { as, check, summary, fd, idFrom, q1, n1 } from "./b-client.mjs";

const A4 = "(app)/otdel-kadr/hr4-actions";
const MA = "(app)/hisobim/hr-actions";
const kadr = await as("kadr"), sklad = await as("sklad"), mex = await as("mexanik"), drv = await as("haydovchi");
const tag = Date.now() % 1_000_000;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const empOf = (login: string) => q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login=${lit(login)}`)!;
const SK = empOf("test.sklad");
const skPos = q1(`select position from "Employee" where id=${lit(SK)}`)!;
const skUser = q1(`select id from "User" where login='test.sklad'`)!;
const json1 = (t: string) => { const m = t.match(/^1:(\{.*\})$/m); return m ? JSON.parse(m[1]!) : null; };

// ── 1) So'rovnoma ──
console.log("\n1. So'rovnoma");
const ST = `QA kayfiyat ${tag}`;
let r = await kadr.action(`${A4}#saveSurveyAction`, [null, undefined, fd({ title: ST, anonymous: "on", questions: "TANLOV: faqat bitta | A" })], "/otdel-kadr?tab=sorovnoma");
check(/2 variant/.test(r.error ?? ""), "variantlari kam TANLOV rad etildi", r.error);
r = await kadr.action(`${A4}#saveSurveyAction`, [null, undefined, fd({ title: ST, anonymous: "on", position: skPos, questions: "NPS: Tavsiya qilasizmi?\nBAHO: Ish sharoiti\nTANLOV: Qaysi smena? | Kunduzgi | Tungi\nNimani yaxshilash kerak?" })], "/otdel-kadr?tab=sorovnoma");
const SV = idFrom(r.redirect);
check(!!SV && q1(`select status from "Survey" where id=${lit(SV!)}`) === "DRAFT", "anonim so'rovnoma tuzildi (qoralama)", r.error ?? r.redirect);
const ans = (extra: Record<string, string> = {}) => fd({ s1: "9", s2: "4", s3: "Tungi", s4: "QA ko'proq dam", ...extra });
r = await sklad.action(`${MA}#answerSurveyAction`, [SV, undefined, ans()], "/hisobim");
check(/yopiq/.test(r.error ?? ""), "ochilmagan so'rovnomaga javob berib bo'lmaydi", r.error);
r = await kadr.action(`${A4}#surveyStatusAction`, [SV, "OPEN"], `/otdel-kadr/sorovnoma/${SV}`);
check(r.ok && n1(`select count(*) from "Notification" where type='SURVEY_OPEN' and "userId"=${lit(skUser)} and body like ${lit(`${ST}%`)}`) === 1, "ochildi — skladchiga bildirishnoma ketdi", r.error);
r = await sklad.action(`${MA}#answerSurveyAction`, [SV, undefined, ans({ s1: "11" })], "/hisobim");
check(/0 dan 10/.test(r.error ?? ""), "NPS 11 rad etildi", r.error);
r = await sklad.action(`${MA}#answerSurveyAction`, [SV, undefined, ans()], "/hisobim");
check(r.ok && n1(`select count(*) from "SurveyResponse" where "surveyId"=${lit(SV!)}`) === 1 && q1(`select coalesce("employeeId",'null') from "SurveyResponse" where "surveyId"=${lit(SV!)}`) === "null", "javob saqlandi — anonim (xodim id'si yo'q)", r.error);
r = await sklad.action(`${MA}#answerSurveyAction`, [SV, undefined, ans()], "/hisobim");
check(/javob bergansiz/.test(r.error ?? "") && n1(`select count(*) from "SurveyResponse" where "surveyId"=${lit(SV!)}`) === 1, "ikkinchi marta javob berib bo'lmaydi", r.error);
r = await mex.action(`${MA}#answerSurveyAction`, [SV, undefined, ans()], "/hisobim");
check(/tegishli emas/.test(r.error ?? ""), "boshqa lavozimga mo'ljallangan so'rovnomaga javob yo'q", r.error);
r = await kadr.action(`${A4}#saveSurveyAction`, [SV, undefined, fd({ title: ST, questions: "Yangi savol" })], `/otdel-kadr/sorovnoma/${SV}`);
check(/o'zgartirib bo'lmaydi/.test(r.error ?? ""), "javob kelgan so'rovnoma tahrirlanmaydi", r.error);
const res = await kadr.get(`/otdel-kadr/sorovnoma/${SV}`);
check(res.status === 200 && res.text.includes("NPS 100") && res.text.includes("proq dam"), "natijalar sahifasi: NPS 100 va matnli javob", res.status);

// ── 2) HR chat — anonim murojaat ──
console.log("\n2. Murojaat (HR chat)");
const FS = `QA anonim ${tag}`;
r = await sklad.action(`${MA}#sendFeedbackAction`, [undefined, fd({ kind: "COMPLAINT", subject: FS, text: "QA ish joyida shamol", anonymous: "on" })], "/hisobim");
const F = q1(`select id from "Feedback" where subject=${lit(FS)}`)!;
check(r.ok && !!F && q1(`select coalesce("employeeId",'null') from "Feedback" where id=${lit(F)}`) === "null" && q1(`select coalesce("userId",'null') from "FeedbackMessage" where "feedbackId"=${lit(F)}`) === "null", "anonim murojaat: xodim va login saqlanmadi", r.error);
const hp = await kadr.get(`/otdel-kadr/murojaat/${F}`);
check(hp.status === 200 && !hp.text.includes("Test Skladchi"), "kadr murojaatni ko'radi, muallif ismi yo'q", hp.status);
r = await kadr.action(`${A4}#hrReplyAction`, [F, undefined, fd({ text: "QA ko'rib chiqamiz" })], `/otdel-kadr/murojaat/${F}`);
check(r.ok && n1(`select count(*) from "FeedbackMessage" where "feedbackId"=${lit(F)} and "fromHr"`) === 1 && q1(`select status from "Feedback" where id=${lit(F)}`) === "IN_REVIEW", "kadr javob berdi → «ko'rib chiqilmoqda»", r.error);
const own = await sklad.get(`/hisobim/murojaat/${F}`);
check(own.status === 200 && own.text.includes("rib chiqamiz"), "muallif o'z anonim murojaatini va javobni ko'radi", own.status);
const other = await mex.get(`/hisobim/murojaat/${F}`);
check(other.status === 404 || !other.text.includes(FS), "begona xodim boshqaning murojaatini ko'rmaydi", other.status);
r = await sklad.action(`${MA}#myFeedbackReplyAction`, [F, undefined, fd({ text: "QA rahmat" })], `/hisobim/murojaat/${F}`);
check(r.ok && n1(`select count(*) from "FeedbackMessage" where "feedbackId"=${lit(F)}`) === 3, "muallif javob yozdi (anonimligicha)", r.error);
r = await kadr.action(`${A4}#feedbackStatusAction`, [F, "RESOLVED"], `/otdel-kadr/murojaat/${F}`);
check(r.ok && q1(`select status from "Feedback" where id=${lit(F)}`) === "RESOLVED", "hal qilindi", r.error);
const FO = `QA ochiq ${tag}`;
await sklad.action(`${MA}#sendFeedbackAction`, [undefined, fd({ kind: "SUGGESTION", subject: FO, text: "QA taklif" })], "/hisobim");
check(q1(`select "employeeId" from "Feedback" where subject=${lit(FO)}`) === SK, "ismli murojaatda xodim saqlanadi");
r = await sklad.action(`${A4}#hrReplyAction`, [F, undefined, fd({ text: "x" })], `/otdel-kadr/murojaat/${F}`);
check(!r.ok, "skladchi kadr nomidan javob yoza olmaydi");

// ── 3) Ommaviy xabar ──
console.log("\n3. Ommaviy xabar");
const BT = `QA subbotnik ${tag}`;
r = await kadr.action(`${A4}#broadcastAction`, [undefined, fd({ title: BT, body: "QA shanba 9:00 da", pos: [skPos] })], "/otdel-kadr?tab=murojaatlar");
const B = q1(`select id from "Broadcast" where title=${lit(BT)}`)!;
check(r.ok && !!B && n1(`select count(*) from "Notification" where type='BROADCAST' and "userId"=${lit(skUser)} and title=${lit(BT)}`) === 1 && n1(`select "sentCount" from "Broadcast" where id=${lit(B)}`) >= 1, "lavozimga xabar ketdi (bildirishnoma yozildi)", r.error);
check(n1(`select count(*) from "Notification" where type='BROADCAST' and title=${lit(BT)} and "userId"=(select id from "User" where login='test.mexanik')`) === 0, "boshqa lavozimga ketmadi");
r = await drv.action(`${A4}#broadcastAction`, [undefined, fd({ title: "x", body: "yyy" })], "/otdel-kadr?tab=murojaatlar");
check(!r.ok, "haydovchi ommaviy xabar yubora olmaydi");

// ── 4) E-IMZO ──
console.log("\n4. E-IMZO");
const DOC = q1(`insert into "HrDocument" (id, "employeeId", kind, "docDate", position, "updatedAt") values ('qa_eimzo_${tag}', ${lit(SK)}, 'SHARTNOMA', current_date, 'QA', now()) returning id`)!;
r = await kadr.action(`${A4}#eimzoPayloadAction`, [DOC], `/employees/${SK}`);
const payload = json1(r.text)?.text as string | undefined;
check(!!payload && payload.includes(`ID: ${DOC}`), "imzolanadigan matn olindi (hujjat ID bilan)", r.text.slice(0, 120));
const fake = (body: string) => Buffer.concat([randomBytes(400), Buffer.from(body, "utf8"), randomBytes(60)]).toString("base64");
r = await kadr.action(`${A4}#eimzoSaveAction`, [DOC, fake("boshqa matn"), { name: "QA Direktor", tin: "123456789" }], `/employees/${SK}`);
check(/tegishli emas/.test(r.error ?? "") && !q1(`select "eSignature" from "HrDocument" where id=${lit(DOC)}`), "boshqa matnga qo'yilgan imzo rad etildi", r.error);
r = await kadr.action(`${A4}#eimzoSaveAction`, [DOC, fake(payload ?? ""), { name: "QA Direktor", tin: "123456789" }], `/employees/${SK}`);
check(r.ok && q1(`select "eSigner" from "HrDocument" where id=${lit(DOC)}`) === "QA Direktor" && q1(`select "eVerified"::text from "HrDocument" where id=${lit(DOC)}`) === "false", "imzo saqlandi — server sozlanmagan, «tekshirilmagan»", r.error);
r = await sklad.action(`${A4}#eimzoSaveAction`, [DOC, fake(payload ?? ""), {}], `/employees/${SK}`);
check(!r.ok, "skladchi kadr hujjatini imzolay olmaydi");

// ── 5) Hisobot va sahifalar ──
const xl = await kadr.get(`/otdel-kadr/hisobot-excel?oy=${new Date().toLocaleDateString("sv-SE").slice(0, 7)}`);
check(xl.status === 200 && /spreadsheetml/.test(xl.headers.get("content-type") ?? ""), "kadr hisoboti Excel yuklanadi", xl.status);
for (const p of ["/otdel-kadr?tab=sorovnoma", "/otdel-kadr?tab=murojaatlar", "/otdel-kadr?tab=murojaatlar&holat=ALL", "/otdel-kadr?tab=hisobotlar", `/otdel-kadr/sorovnoma/${SV}`, `/employees/${SK}`]) {
  const x = await kadr.get(p); check(x.status === 200, `kadr ${p} → ${x.status}`);
}
const sx = await sklad.get("/otdel-kadr?tab=hisobotlar");
check(sx.status !== 200 || !sx.text.includes("Aylanma"), "skladchi kadr hisobotini ko'rmaydi", sx.status);
summary("b-voice");
process.exit();
