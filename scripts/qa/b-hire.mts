// QA (B) — otdel kadr 3-faza: yollash (vakansiya, nomzod, suhbat, ishga qabul → xodim kartasi + moslashuv rejasi,
// vakansiya to'lsa yopiladi), moslashuv (murabbiy qadamni belgilaydi, begona — yo'q, sinov natijasi), o'qitish
// (savollar matndan, lavozimga avtomatik biriktirish, test → o'tmadi / o'tdi, sertifikat raqami va muddati).
// Ishga tushirish: npx tsx scripts/qa/b-hire.mts (b-all.sh ichida)
import { as, check, summary, fd, idFrom, q1, n1 } from "./b-client.mjs";

const A3 = "(app)/otdel-kadr/hr3-actions";
const MA = "(app)/hisobim/hr-actions";
const kadr = await as("kadr"), sklad = await as("sklad"), mex = await as("mexanik"), dir = await as("direktor");
const tag = Date.now() % 1_000_000;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const empOf = (login: string) => q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login=${lit(login)}`)!;
const SK = empOf("test.sklad");
const skPos = q1(`select position from "Employee" where id=${lit(SK)}`)!;
const today = new Date().toLocaleDateString("sv-SE");
const phone = `+99893${String(1_000_000 + (tag % 8_999_999)).padStart(7, "0")}`;

// ── 1) Yollash ──
console.log("\n1. Yollash");
const VT = `QA haydovchi kerak ${tag}`;
let r = await kadr.action(`${A3}#saveVacancyAction`, [null, undefined, fd({ title: VT, position: `QA lavozim ${tag}`, headcount: "1", salaryFrom: "5000000", salaryTo: "4000000" })], "/otdel-kadr?tab=yollash");
check(/oralig/.test(r.error ?? ""), "maosh oralig'i teskari — rad etildi", r.error);
r = await kadr.action(`${A3}#saveVacancyAction`, [null, undefined, fd({ title: VT, position: `QA lavozim ${tag}`, headcount: "1" })], "/otdel-kadr?tab=yollash");
const V = q1(`select id from "Vacancy" where title=${lit(VT)}`)!;
check(r.ok && !!V && q1(`select status from "Vacancy" where id=${lit(V)}`) === "OPEN", "vakansiya ochildi", r.error);
r = await sklad.action(`${A3}#saveVacancyAction`, [null, undefined, fd({ title: "x", position: "y" })], "/otdel-kadr?tab=yollash");
check(!r.ok, "skladchi vakansiya ocha olmaydi");
const NAME = `QA Nomzod ${tag}`;
r = await kadr.action(`${A3}#saveCandidateAction`, [null, undefined, fd({ fullName: NAME, phone, vacancyId: V, source: "OLX", rating: "4" })], "/otdel-kadr?tab=yollash");
const C = idFrom(r.redirect);
check(!!C && q1(`select stage from "Candidate" where id=${lit(C!)}`) === "NEW", "nomzod qo'shildi → kartasiga o'tdi", r.error ?? r.redirect);
r = await kadr.action(`${A3}#saveCandidateAction`, [null, undefined, fd({ fullName: `${NAME} 2`, phone })], "/otdel-kadr?tab=yollash");
check(/nomzod bor/.test(r.error ?? ""), "shu telefon bilan ikkinchi nomzod rad etildi", r.error);
r = await kadr.action(`${A3}#moveCandidateAction`, [C, "REJECTED", undefined, fd({})], `/otdel-kadr/nomzod/${C}`);
check(/sabab/.test(r.error ?? ""), "sababsiz rad etish mumkin emas", r.error);
r = await kadr.action(`${A3}#moveCandidateAction`, [C, "SCREEN", undefined, fd({})], `/otdel-kadr/nomzod/${C}`);
check(r.ok && q1(`select stage from "Candidate" where id=${lit(C!)}`) === "SCREEN", "bosqich: saralash", r.error);
const dirUser = q1(`select id from "User" where login='test.direktor'`)!;
r = await kadr.action(`${A3}#addInterviewAction`, [C, undefined, fd({ at: `${today}T15:00`, place: "Ofis", interviewerId: dirUser })], `/otdel-kadr/nomzod/${C}`);
const IV = q1(`select id from "Interview" where "candidateId"=${lit(C!)}`)!;
check(r.ok && !!IV && q1(`select stage from "Candidate" where id=${lit(C!)}`) === "INTERVIEW", "suhbat belgilandi → nomzod «Suhbat» bosqichida", r.error);
check(n1(`select count(*) from "Notification" where type='INTERVIEW_NEW' and "userId"=${lit(dirUser)} and body like ${lit(`${NAME}%`)}`) === 1, "suhbatchiga bildirishnoma ketdi");
r = await kadr.action(`${A3}#interviewResultAction`, [IV, C, undefined, fd({ result: "PASSED", feedback: "QA tajribali" })], `/otdel-kadr/nomzod/${C}`);
check(r.ok && q1(`select result from "Interview" where id=${lit(IV)}`) === "PASSED", "suhbat natijasi: o'tdi", r.error);
r = await kadr.action(`${A3}#hireAction`, [C, undefined, fd({ position: `QA lavozim ${tag}`, hiredAt: today, mentorId: SK, probationMonths: "2" })], `/otdel-kadr/nomzod/${C}`);
const E = q1(`select "employeeId" from "Candidate" where id=${lit(C!)}`);
check(!!E && /\/employees\//.test(r.redirect ?? "") && q1(`select stage from "Candidate" where id=${lit(C!)}`) === "HIRED", "ishga qabul qilindi → xodim kartasi ochildi", r.error ?? r.redirect);
check(q1(`select "fullName" from "Employee" where id=${lit(E!)}`) === NAME && q1(`select phone from "Employee" where id=${lit(E!)}`) === phone && q1(`select position from "Employee" where id=${lit(E!)}`) === `QA lavozim ${tag}`, "kartada F.I.O., telefon, lavozim nomzoddan");
check(q1(`select status from "Vacancy" where id=${lit(V)}`) === "CLOSED", "vakansiya to'ldi — o'zi yopildi");
const P = q1(`select id from "OnboardingPlan" where "employeeId"=${lit(E!)}`)!;
check(!!P && n1(`select count(*) from "OnboardingStep" where "planId"=${lit(P)}`) >= 5 && q1(`select "mentorId" from "OnboardingPlan" where id=${lit(P)}`) === SK && !!q1(`select "probationEnd" from "OnboardingPlan" where id=${lit(P)}`), "moslashuv rejasi: qadamlar, murabbiy, sinov muddati");
r = await kadr.action(`${A3}#hireAction`, [C, undefined, fd({ position: "x", hiredAt: today })], `/otdel-kadr/nomzod/${C}`);
check(/allaqachon/.test(r.error ?? "") && n1(`select count(*) from "Employee" where "fullName"=${lit(NAME)}`) === 1, "qayta qabul — ikkinchi karta ochilmadi", r.error);

// ── 2) Moslashuv ──
console.log("\n2. Moslashuv");
const step = q1(`select id from "OnboardingStep" where "planId"=${lit(P)} order by "sortOrder" limit 1`)!;
r = await sklad.action(`${MA}#myStepAction`, [step, true], "/hisobim");
check(r.ok && !!q1(`select "doneAt" from "OnboardingStep" where id=${lit(step)}`), "murabbiy (skladchi) qadamni belgiladi", r.error);
r = await mex.action(`${MA}#myStepAction`, [step, false], "/hisobim");
check(/tegishli emas/.test(r.error ?? "") && !!q1(`select "doneAt" from "OnboardingStep" where id=${lit(step)}`), "begona xodim qadamga tega olmaydi", r.error);
r = await kadr.action(`${A3}#decideProbationAction`, [P, undefined, fd({ status: "EXTENDED" })], "/otdel-kadr?tab=moslashuv");
check(/sanani/.test(r.error ?? ""), "uzaytirish — yangi sanasiz rad etildi", r.error);
r = await kadr.action(`${A3}#decideProbationAction`, [P, undefined, fd({ status: "PASSED", note: "QA yaxshi" })], "/otdel-kadr?tab=moslashuv");
check(r.ok && q1(`select status from "OnboardingPlan" where id=${lit(P)}`) === "PASSED", "sinovdan o'tdi deb qayd etildi", r.error);
r = await sklad.action(`${MA}#myStepAction`, [step, false], "/hisobim");
check(/yakunlangan/.test(r.error ?? ""), "yakunlangan reja qadamlari o'zgarmaydi", r.error);

// ── 3) O'qitish ──
console.log("\n3. O'qitish");
const CT = `QA xavfsizlik ${tag}`;
r = await kadr.action(`${A3}#saveCourseAction`, [null, undefined, fd({ title: CT, questions: "Savol?\n- a\n- b", passScore: "50" })], "/otdel-kadr?tab=oqitish");
check(/to'g'ri javob/.test(r.error ?? ""), "to'g'ri javobi belgilanmagan savol rad etildi", r.error);
r = await kadr.action(`${A3}#saveCourseAction`, [null, undefined, fd({
  title: CT, position: skPos, passScore: "50", validMonths: "12", material: "QA material",
  questions: "Kaska qachon kiyiladi?\n+ Sexda doim\n- Faqat bayramda\n\nO't o'chirgich qayerda?\n- Bilmayman\n+ Kirish yonida",
})], "/otdel-kadr?tab=oqitish");
const K = idFrom(r.redirect);
check(!!K && n1(`select count(*) from "CourseEnrollment" where "courseId"=${lit(K!)} and "employeeId"=${lit(SK)}`) === 1, "kurs saqlandi va skladchi lavozimiga o'zi biriktirildi", r.error ?? r.redirect);
r = await sklad.action(`${MA}#takeTestAction`, [K, undefined, fd({ total: "2", a0: "1", a1: "0" })], `/hisobim/kurs/${K}`);
check(r.ok && q1(`select status from "CourseEnrollment" where "courseId"=${lit(K!)} and "employeeId"=${lit(SK)}`) === "FAILED", "noto'g'ri javoblar → o'tmadi (0%)", r.error);
r = await sklad.action(`${MA}#takeTestAction`, [K, undefined, fd({ total: "2", a0: "0" })], `/hisobim/kurs/${K}`);
check(/Barcha savollar/.test(r.error ?? ""), "javobsiz savol bilan topshirib bo'lmaydi", r.error);
r = await sklad.action(`${MA}#takeTestAction`, [K, undefined, fd({ total: "2", a0: "0", a1: "1" })], `/hisobim/kurs/${K}`);
const en = q1(`select concat_ws('|', status, "certificateNo", "expiresAt"::text, attempts::text, "bestScore"::text, id) from "CourseEnrollment" where "courseId"=${lit(K!)} and "employeeId"=${lit(SK)}`)!.split("|");
check(r.ok && en[0] === "PASSED" && /^SR-\d{4}-\d{5}$/.test(en[1] ?? "") && !!en[2] && en[3] === "2" && en[4] === "100", "to'g'ri javoblar → o'tdi 100%, sertifikat raqami va 12 oylik muddat", en);
r = await mex.action(`${MA}#takeTestAction`, [K, undefined, fd({ total: "2", a0: "0", a1: "1" })], `/hisobim/kurs/${K}`);
check(/biriktirilmagan/.test(r.error ?? ""), "biriktirilmagan xodim test topshira olmaydi", r.error);
const cert = await sklad.get(`/hisobim/sertifikat/${en[5]}`);
check(cert.status === 200 && cert.text.includes(en[1]!), "sertifikat sahifasi egasiga ochiladi", cert.status);
const certOther = await mex.get(`/hisobim/sertifikat/${en[5]}`);
check(certOther.status === 404 || !certOther.text.includes(en[1]!), "begona xodim sertifikatni ko'ra olmaydi", certOther.status);

// ── 4) Sahifalar ──
for (const p of ["/otdel-kadr?tab=yollash", `/otdel-kadr?tab=yollash&vakansiya=${V}`, "/otdel-kadr?tab=moslashuv", "/otdel-kadr?tab=moslashuv&holat=ALL", "/otdel-kadr?tab=oqitish", `/otdel-kadr/nomzod/${C}`, `/otdel-kadr/kurs/${K}`]) {
  const x = await kadr.get(p); check(x.status === 200, `kadr ${p} → ${x.status}`);
}
for (const p of ["/hisobim", `/hisobim/kurs/${K}`]) { const x = await sklad.get(p); check(x.status === 200, `sklad ${p} → ${x.status}`); }
const dx = await dir.get(`/otdel-kadr/nomzod/${C}`);
check(dx.status === 200, `direktor nomzod kartasi → ${dx.status}`);
const sx = await sklad.get(`/otdel-kadr/nomzod/${C}`);
check(sx.status !== 200 || !sx.text.includes(NAME), "skladchi nomzod kartasini ko'rmaydi", sx.status);
summary("b-hire");
process.exit();
