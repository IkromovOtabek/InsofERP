// QA (B) — otdel kadr 2-faza: vazifalar (berish huquqi, boshlash → bajarildi → qabul / qaytarish / bekor, o'ziga vazifa,
// izoh), kundalik cheklistlar (lavozim bo'yicha, belgilash), KPI (qo'lda fakt → mukofot → oy yakuni ish haqiga bonus).
// Ishga tushirish: npx tsx scripts/qa/b-tasks.mts (b-all.sh ichida)
import { as, check, summary, fd, idFrom, q1, n1 } from "./b-client.mjs";

const VA = "(app)/vazifalar/actions";
const HA = "(app)/otdel-kadr/hr-actions";
const MA = "(app)/hisobim/hr-actions";
const kadr = await as("kadr"), sklad = await as("sklad"), drv = await as("haydovchi"), dir = await as("direktor"), mex = await as("mexanik");
const tag = Date.now() % 1_000_000;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const empOf = (login: string) => q1(`select e.id from "Employee" e join "User" u on u.id=e."userId" where u.login=${lit(login)}`)!;
const SK = empOf("test.sklad"), KD = empOf("test.kadr");
const skPos = q1(`select position from "Employee" where id=${lit(SK)}`)!;
const task = (title: string) => q1(`select id from "WorkTask" where title=${lit(title)}`)!;
const st = (id: string) => q1(`select status from "WorkTask" where id=${lit(id)}`);
const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString("sv-SE");

// ── 1) Vazifalar ──
console.log("\n1. Vazifalar");
let r = await drv.action(`${VA}#createTaskAction`, [undefined, fd({ title: `QA haydovchi ${tag}`, assigneeId: KD })], "/vazifalar");
check(!r.ok && n1(`select count(*) from "WorkTask" where title=${lit(`QA haydovchi ${tag}`)}`) === 0, "haydovchi boshqa xodimga vazifa bera olmaydi (vazifa ochilmadi)", r.error ?? r.status);
r = await mex.action(`${VA}#createTaskAction`, [undefined, fd({ title: `QA mexanik ${tag}`, assigneeId: KD })], "/vazifalar");
check(/huquq/.test(r.error ?? "") && n1(`select count(*) from "WorkTask" where title=${lit(`QA mexanik ${tag}`)}`) === 0, "mexanik (berish huquqisiz) boshqaga bera olmaydi — aniq xato", r.error);
r = await kadr.action(`${VA}#createTaskAction`, [undefined, fd({ title: "ab", assigneeId: SK })], "/vazifalar");
check(/3 belgi/.test(r.error ?? ""), "juda qisqa nom rad etildi", r.error);
const T1 = `QA inventarizatsiya ${tag}`;
r = await kadr.action(`${VA}#createTaskAction`, [undefined, fd({ title: T1, assigneeId: SK, dueDate: tomorrow, priority: "HIGH", clientToken: `qa-task-token-${tag}-0001` })], "/vazifalar");
const t1 = task(T1);
check(r.ok && !!t1 && st(t1) === "TODO" && /^VZ-\d{4}-\d{5}$/.test(q1(`select "docNo" from "WorkTask" where id=${lit(t1)}`) ?? ""), "kadr skladchiga vazifa berdi (VZ raqami)", r.error);
r = await kadr.action(`${VA}#createTaskAction`, [undefined, fd({ title: T1, assigneeId: SK, clientToken: `qa-task-token-${tag}-0001` })], "/vazifalar");
check(n1(`select count(*) from "WorkTask" where title=${lit(T1)}`) === 1, "o'sha kalit bilan qayta — ikkinchi vazifa ochilmadi", r.error ?? r.text.slice(0, 80));
check(n1(`select count(*) from "Notification" where type='WORK_TASK_NEW' and body like ${lit(`${T1}%`)}`) >= 1, "bajaruvchiga bildirishnoma ketdi");
r = await kadr.action(`${VA}#quickStatus`, [t1, "start"], "/vazifalar");
check(!!r.error && st(t1) === "TODO", "beruvchi bajaruvchi o'rniga boshlay olmaydi", r.error);
r = await sklad.action(`${VA}#quickStatus`, [t1, "start"], "/vazifalar");
check(r.ok && st(t1) === "IN_PROGRESS", "skladchi boshladi", r.error);
r = await sklad.action(`${VA}#commentAction`, [t1, undefined, fd({ text: "QA: yarmi tayyor" })], `/vazifalar/${t1}`);
check(r.ok && n1(`select count(*) from "WorkTaskComment" where "taskId"=${lit(t1)}`) === 1, "izoh qo'shildi", r.error);
r = await sklad.action(`${VA}#quickStatus`, [t1, "done"], "/vazifalar");
check(r.ok && st(t1) === "REVIEW", "bajarildi → beruvchi tekshiruvida", r.error);
r = await sklad.action(`${VA}#quickStatus`, [t1, "accept"], "/vazifalar");
check(!!r.error && st(t1) === "REVIEW", "bajaruvchi o'zi qabul qila olmaydi", r.error);
r = await kadr.action(`${VA}#taskStatusAction`, [t1, "return", undefined, fd({})], `/vazifalar/${t1}`);
check(/sabab/.test(r.error ?? ""), "sababsiz qaytarish rad etildi", r.error);
r = await kadr.action(`${VA}#taskStatusAction`, [t1, "return", undefined, fd({ note: "QA ro'yxat to'liq emas" })], `/vazifalar/${t1}`);
check(r.ok && st(t1) === "IN_PROGRESS" && q1(`select "returnNote" from "WorkTask" where id=${lit(t1)}`) === "QA ro'yxat to'liq emas", "beruvchi qaytardi (sabab bilan)", r.error);
await sklad.action(`${VA}#quickStatus`, [t1, "done"], "/vazifalar");
r = await kadr.action(`${VA}#quickStatus`, [t1, "accept"], "/vazifalar");
check(r.ok && st(t1) === "DONE" && !!q1(`select "acceptedAt" from "WorkTask" where id=${lit(t1)}`), "qayta bajarildi → beruvchi qabul qildi", r.error);
r = await kadr.action(`${VA}#taskStatusAction`, [t1, "cancel", undefined, fd({ note: "kech" })], `/vazifalar/${t1}`);
check(!!r.error && st(t1) === "DONE", "qabul qilingan vazifa bekor qilinmaydi", r.error);
const T2 = `QA o'ziga ${tag}`;
r = await sklad.action(`${VA}#createTaskAction`, [undefined, fd({ title: T2 })], "/vazifalar");
const t2 = task(T2);
r = await sklad.action(`${VA}#quickStatus`, [t2, "done"], "/vazifalar");
check(r.ok && st(t2) === "DONE", "o'ziga yozgan vazifa «bajarildi» bilan darhol yopiladi", r.error);
const T3 = `QA bekor ${tag}`;
await kadr.action(`${VA}#createTaskAction`, [undefined, fd({ title: T3, assigneeId: SK })], "/vazifalar");
const t3 = task(T3);
r = await kadr.action(`${VA}#taskStatusAction`, [t3, "cancel", undefined, fd({ note: "QA kerak emas" })], `/vazifalar/${t3}`);
check(r.ok && st(t3) === "CANCELLED" && n1(`select count(*) from "WorkTask" where id=${lit(t3)}`) === 1, "beruvchi bekor qildi (o'chirilmadi)", r.error);
const page = await drv.get(`/vazifalar/${t1}`);
check(page.status !== 200 || !page.text.includes(T1), "begona xodim vazifa kartasini ko'rmaydi", page.status);

// ── 2) Kundalik cheklistlar ──
console.log("\n2. Cheklistlar");
const CL = `QA kun yakuni ${tag}`;
r = await kadr.action(`${HA}#saveChecklistTemplate`, [null, undefined, fd({ name: CL, position: skPos, items: "Qoldiq tekshirildi\nKalit topshirildi\nJoy tozalandi" })], "/otdel-kadr?tab=cheklistlar");
const cl = q1(`select id from "ChecklistTemplate" where name=${lit(CL)}`)!;
check(r.ok && !!cl, "kadr lavozim bo'yicha cheklist qo'shdi (3 band)", r.error);
const keys = (JSON.parse(q1(`select items::text from "ChecklistTemplate" where id=${lit(cl)}`)!) as { key: string }[]).map((i) => i.key);
r = await sklad.action(`${HA}#saveChecklistTemplate`, [null, undefined, fd({ name: "x", items: "a" })], "/otdel-kadr?tab=cheklistlar");
check(!r.ok, "skladchi cheklist shablonini o'zgartira olmaydi");
r = await sklad.action(`${MA}#saveMyChecklistAction`, [cl, undefined, fd({ item: [keys[0], keys[1]] })], "/hisobim");
check(r.ok && n1(`select "doneCount" from "ChecklistRun" where "templateId"=${lit(cl)} and "employeeId"=${lit(SK)}`) === 2, "skladchi 2/3 band belgiladi", r.error);
r = await sklad.action(`${MA}#saveMyChecklistAction`, [cl, undefined, fd({ item: keys })], "/hisobim");
check(r.ok && !!q1(`select "completedAt" from "ChecklistRun" where "templateId"=${lit(cl)} and "employeeId"=${lit(SK)}`), "3/3 — cheklist yakunlandi", r.error);
const OTHER = `QA boshqa lavozim ${tag}`;
await kadr.action(`${HA}#saveChecklistTemplate`, [null, undefined, fd({ name: OTHER, position: `Yo'q lavozim ${tag}`, items: "x" })], "/otdel-kadr?tab=cheklistlar");
r = await sklad.action(`${MA}#saveMyChecklistAction`, [q1(`select id from "ChecklistTemplate" where name=${lit(OTHER)}`), undefined, fd({ item: ["b1"] })], "/hisobim");
check(/tegishli emas/.test(r.error ?? ""), "boshqa lavozim cheklisti belgilanmaydi", r.error);

// ── 3) KPI → ish haqi ──
console.log("\n3. KPI");
const KP = `QA reja ${tag}`;
r = await kadr.action(`${HA}#saveKpiMetric`, [null, undefined, fd({ name: KP, source: "MANUAL", unit: "dona", target: "10", reward: "100000", minPct: "80", capPct: "120", employeeId: SK })], "/otdel-kadr?tab=kpi");
const kp = q1(`select id from "KpiMetric" where name=${lit(KP)}`)!;
check(r.ok && !!kp, "kadr qo'lda faktli KPI qo'shdi (reja 10, mukofot 100 000)", r.error);
const month = new Date().toLocaleDateString("sv-SE").slice(0, 7);
r = await kadr.action(`${HA}#setKpiFact`, [kp, SK, month, undefined, fd({ fact: "15" })], "/otdel-kadr?tab=kpi");
check(r.ok && Number(q1(`select fact from "KpiResult" where "metricId"=${lit(kp)} and "employeeId"=${lit(SK)}`)) === 15, "fakt 15 kiritildi", r.error);
r = await sklad.action(`${HA}#setKpiFact`, [kp, SK, month, undefined, fd({ fact: "99" })], "/otdel-kadr?tab=kpi");
check(!r.ok && Number(q1(`select fact from "KpiResult" where "metricId"=${lit(kp)} and "employeeId"=${lit(SK)}`)) === 15, "skladchi o'z KPI faktini o'zgartira olmaydi");
const cur = q1(`select id from "PayrollRun" where month=${lit(month)} and kind='FINAL' and status<>'CANCELLED'`);
r = cur ? await kadr.action("(app)/ish-haqi/actions#recalcAction", [cur], `/ish-haqi/${cur}`) : await kadr.action("(app)/ish-haqi/actions#calculateAction", [undefined, fd({ month, kind: "FINAL" })], "/ish-haqi");
const run = cur ?? idFrom(r.redirect);
const bd = JSON.parse(q1(`select breakdown::text from "PayrollLine" where "runId"=${lit(run!)} and "employeeId"=${lit(SK)}`) ?? "{}") as { rules?: { rule: string; amount: number }[] };
check(bd.rules?.find((h) => h.rule === `KPI: ${KP}`)?.amount === 120_000, "ish haqida KPI bonusi: 150% → yuqori chegara 120% → 120 000", bd.rules);
r = await kadr.action(`${HA}#setKpiFact`, [kp, SK, month, undefined, fd({ fact: "7" })], "/otdel-kadr?tab=kpi");
await kadr.action("(app)/ish-haqi/actions#recalcAction", [run], `/ish-haqi/${run}`);
const bd2 = JSON.parse(q1(`select breakdown::text from "PayrollLine" where "runId"=${lit(run!)} and "employeeId"=${lit(SK)}`) ?? "{}") as { rules?: { rule: string }[] };
check(!bd2.rules?.some((h) => h.rule === `KPI: ${KP}`), "70% < minimal 80% — mukofot yo'q", bd2.rules);

// ── 4) Sahifalar ──
for (const p of ["/vazifalar", "/vazifalar?view=kanban", "/vazifalar?view=kalendar", `/vazifalar/${t1}`, "/otdel-kadr?tab=cheklistlar", "/otdel-kadr?tab=kpi"]) {
  const x = await kadr.get(p); check(x.status === 200, `kadr ${p} → ${x.status}`);
}
for (const [nm, c] of [["sklad", sklad], ["direktor", dir]] as const) {
  for (const p of ["/vazifalar", "/hisobim"]) { const x = await c.get(p); check(x.status === 200, `${nm} ${p} → ${x.status}`); }
}
const hs = await sklad.get("/hisobim");
check(hs.text.includes(CL) && hs.text.includes(KP), "«Mening hisobim»: bugungi cheklist va KPI ko'rinadi");
summary("b-tasks");
process.exit();
