// QA (B) — otdel kadr 1-faza: smena grafigi, arizalar (ta'til → davomat, kechikish sababi, avans → alohida vedomost),
// jarima/bonus qoidalari, ish haqi hisobi (oklad, ta'til, kasallik, JShDS), direktor tasdig'i, kassadan to'lov, ruxsatlar.
// Ishga tushirish: npx tsx scripts/qa/b-payroll.mts (b-all.sh ichida)
import { as, check, summary, fd, idFrom, q, q1, n1 } from "./b-client.mjs";

const HA = "(app)/otdel-kadr/hr-actions";
const PA = "(app)/ish-haqi/actions";
const kadr = await as("kadr"), dir = await as("direktor"), kassa = await as("kassa"), sklad = await as("sklad");
const tag = Date.now() % 1_000_000;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ── Davr: o'tgan oy (yakuniy hisob) ──
const now = new Date();
const pm = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
const M = `${pm.getUTCFullYear()}-${String(pm.getUTCMonth() + 1).padStart(2, "0")}`;
const last = new Date(Date.UTC(pm.getUTCFullYear(), pm.getUTCMonth() + 1, 0)).getUTCDate();
const days = Array.from({ length: last }, (_, i) => `${M}-${String(i + 1).padStart(2, "0")}`);
const work = days.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
const norm = work.length;

// ── Xodim: oklad 2 600 000, staj 6 yil (kasallik 60%), noyob lavozim — qoidalar faqat unga tegsin ──
const pos = `QA Pay ${tag}`;
const E = `qa_pay_${tag}`;
const RATE = 2_600_000;
q(`insert into "Employee" (id, "fullName", position, "tariffRate", "payType", "hiredAt", "isActive", "createdAt") values (${lit(E)}, ${lit(`QA Oylik ${tag}`)}, ${lit(pos)}, ${RATE}, 'SALARY', '2020-01-01', true, now())`);
// Tabel: 20 kun keldi (2 tasida 15 daqiqa kech), 1 sababsiz, 2 ta'til, 1 kasal
const present = work.slice(0, 20), absent = work[20]!, leave = work.slice(21, 23), sick = work[23]!;
const lateDays = [present[3]!, present[7]!];
for (const d of present) {
  q(`insert into "Attendance" (id, "employeeId", date, status, "checkIn", "checkOut", "lateMinutes", "updatedAt") values (${lit(`qa_att_${tag}_${d}`)}, ${lit(E)}, '${d}', 'PRESENT', ${lateDays.includes(d) ? "'08:15'" : "'08:00'"}, '17:00', ${lateDays.includes(d) ? 15 : 0}, now())`);
}
q(`insert into "Attendance" (id, "employeeId", date, status, "updatedAt") values (${lit(`qa_att_${tag}_a`)}, ${lit(E)}, '${absent}', 'ABSENT', now())`);
for (const d of leave) q(`insert into "Attendance" (id, "employeeId", date, status, "updatedAt") values (${lit(`qa_att_${tag}_${d}`)}, ${lit(E)}, '${d}', 'LEAVE', now())`);
q(`insert into "Attendance" (id, "employeeId", date, status, "updatedAt") values (${lit(`qa_att_${tag}_s`)}, ${lit(E)}, '${sick}', 'SICK', now())`);

// ── 1) Smena grafigi ──
console.log("\n1. Smena grafigi");
let r = await kadr.action(`${HA}#saveShiftTemplate`, [null, undefined, fd({ name: `Kunduzgi ${tag}`, start: "08:00", end: "17:00", color: "sky" })], "/otdel-kadr?tab=grafik");
const T = q1(`select id from "ShiftTemplate" where name=${lit(`Kunduzgi ${tag}`)}`);
check(r.ok && !!T, "smena shabloni qo'shildi", r.error);
r = await kadr.action(`${HA}#saveShiftTemplate`, [null, undefined, fd({ name: `Kunduzgi ${tag}`, start: "08:00", end: "17:00" })], "/otdel-kadr?tab=grafik");
check(/bor/.test(r.error ?? ""), "takroriy nom rad etildi", r.error);
r = await kadr.action(`${HA}#saveShiftTemplate`, [null, undefined, fd({ name: `Xato ${tag}`, start: "08:00", end: "08:00" })], "/otdel-kadr?tab=grafik");
check(/bir xil/.test(r.error ?? ""), "boshlanish = tugash rad etildi", r.error);
const nextMonday = (() => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toLocaleDateString("sv-SE"); })();
r = await kadr.action(`${HA}#fillShiftPattern`, [undefined, fd({ templateId: T!, pattern: "2/2", from: nextMonday, to: new Date(Date.parse(nextMonday) + 6 * 864e5).toISOString().slice(0, 10), emp: [E] })], "/otdel-kadr?tab=grafik");
const cells = q(`select date::text, off::text from "ShiftAssignment" where "employeeId"=${lit(E)} order by date`);
check(r.ok && cells.length === 7 && cells.map((c) => c[1]).join(",") === "false,false,true,true,false,false,true", "2/2 naqsh: 7 kun — ish, ish, dam, dam…", r.error ?? cells);
r = await kadr.action(`${HA}#saveShiftGrid`, [undefined, fd({ cells: JSON.stringify([{ employeeId: E, date: cells[0]![0], value: "off" }, { employeeId: E, date: cells[1]![0], value: "" }]) })], "/otdel-kadr?tab=grafik");
check(r.ok && q1(`select off::text from "ShiftAssignment" where "employeeId"=${lit(E)} and date='${cells[0]![0]}'`) === "true" && n1(`select count(*) from "ShiftAssignment" where "employeeId"=${lit(E)}`) === 6, "katak «Dam» qilindi, bo'shatilgan katak o'chdi", r.error);
r = await sklad.action(`${HA}#saveShiftGrid`, [undefined, fd({ cells: JSON.stringify([{ employeeId: E, date: cells[2]![0], value: "" }]) })], "/otdel-kadr?tab=grafik");
check(!r.ok, "sklad grafikni o'zgartira olmaydi");

// ── 2) Jarima / bonus qoidalari va qo'lda yozuv ──
console.log("\n2. Jarima va bonus");
r = await kadr.action(`${HA}#savePayRule`, [null, undefined, fd({ name: `Sababsiz ${tag}`, trigger: "ABSENT", amount: "50000", position: pos })], "/otdel-kadr?tab=jarima-bonus");
check(r.ok, "«sababsiz kelmaslik» jarimasi qo'shildi", r.error);
r = await kadr.action(`${HA}#savePayRule`, [null, undefined, fd({ name: `Kechikish ${tag}`, trigger: "LATE", amount: "10000", graceMinutes: "5", position: pos })], "/otdel-kadr?tab=jarima-bonus");
check(r.ok, "kechikish jarimasi (5 daqiqa imtiyoz) qo'shildi", r.error);
r = await kadr.action(`${HA}#savePayRule`, [null, undefined, fd({ name: `Bo'sh ${tag}`, trigger: "ABSENT", amount: "0" })], "/otdel-kadr?tab=jarima-bonus");
check(!!r.error, "summasiz qoida rad etildi", r.error);
r = await kadr.action(`${HA}#addPayAdjustment`, [undefined, fd({ employeeId: E, month: M, kind: "BONUS", amount: "100000", reason: "QA reja oshirildi" })], "/otdel-kadr?tab=jarima-bonus");
check(r.ok, "qo'lda bonus 100 000 yozildi", r.error);
r = await kadr.action(`${HA}#addPayAdjustment`, [undefined, fd({ employeeId: E, month: M, kind: "PENALTY", amount: "33000", reason: "QA xato yozuv" })], "/otdel-kadr?tab=jarima-bonus");
const wrongAdj = q1(`select id from "PayAdjustment" where reason='QA xato yozuv' and "employeeId"=${lit(E)}`)!;
r = await kadr.action(`${HA}#cancelPayAdjustment`, [wrongAdj, undefined, fd({ reason: "xato kiritilgan" })], "/otdel-kadr?tab=jarima-bonus");
check(r.ok && !!q1(`select "cancelledAt" from "PayAdjustment" where id=${lit(wrongAdj)}`) && n1(`select count(*) from "PayAdjustment" where id=${lit(wrongAdj)}`) === 1, "xato jarima bekor qilindi (o'chirilmadi)", r.error);

// ── 3) Yakuniy hisob ──
console.log("\n3. Oy yakuni hisobi");
r = await sklad.action(`${PA}#calculateAction`, [undefined, fd({ month: M, kind: "FINAL" })], "/ish-haqi");
check(!r.redirect && !r.ok, "sklad ish haqini hisoblay olmaydi");
r = await kadr.action(`${PA}#calculateAction`, [undefined, fd({ month: M, kind: "FINAL" })], "/ish-haqi");
const RUN = idFrom(r.redirect);
check(!!RUN && /ish-haqi/.test(r.redirect ?? ""), "kadr oy yakunini hisobladi → vedomost", r.error ?? r.redirect);
type Line = { base: string; leavePay: string; sickPay: string; bonus: string; penalty: string; gross: string; incomeTax: string; net: string; normDays: number; workedDays: number; breakdown: { rules: { rule: string; amount: number; days: number }[]; manual: { amount: number }[]; sickPct: number } };
const line = (): Line => JSON.parse(q1(`select row_to_json(l) from "PayrollLine" l where "runId"=${lit(RUN!)} and "employeeId"=${lit(E)}`) ?? "null");
let L = line();
const daily = RATE / norm;
check(!!L && L.normDays === norm && L.workedDays === 20, `norma ${norm} kun, keldi 20`, L && { norm: L.normDays, worked: L.workedDays });
check(Number(L.base) === Math.round(RATE * 20 / norm), `asosiy = ${RATE} × 20 / ${norm}`, L?.base);
check(Number(L.leavePay) === Math.round(daily * 2) && Number(L.sickPay) === Math.round(daily * 0.6) && L.breakdown.sickPct === 60, "ta'til 2 kun, kasallik 60% (staj < 8 yil)", { leave: L?.leavePay, sick: L?.sickPay });
const hit = (name: string) => L.breakdown.rules.find((h) => h.rule === name);
check(hit(`Sababsiz ${tag}`)?.amount === 50_000 && hit(`Kechikish ${tag}`)?.amount === 20_000 && hit(`Kechikish ${tag}`)?.days === 2, "qoidalar: sababsiz 50 000, kechikish 2 × 10 000", L?.breakdown.rules);
const ruleSum = (k: string) => L.breakdown.rules.filter((h) => (h as unknown as { kind: string }).kind === k).reduce((s, h) => s + h.amount, 0);
check(Number(L.bonus) === 100_000 + ruleSum("BONUS"), "bonus — qo'lda 100 000 (bekor qilingan jarima hisoblanmadi)", L?.bonus);
const pen = ruleSum("PENALTY");
check(Number(L.penalty) === pen, "jarima = qoidalar yig'indisi", { pen, got: L?.penalty });
const gross = Number(L.base) + Number(L.leavePay) + Number(L.sickPay) + Number(L.bonus);
check(Number(L.gross) === gross && Number(L.incomeTax) === Math.round(gross * 0.12), "hisoblangan = asosiy + ta'til + kasallik + bonus; JShDS 12%", L);
check(Number(L.net) === gross - Number(L.incomeTax) - Number(L.penalty), "qo'lga = hisoblangan − JShDS − jarima", L?.net);

// Kechikish sababi tasdiqlansa — shu kun jarimadan ozod; qayta hisob
r = await kadr.action(`${HA}#createRequestForEmployee`, [undefined, fd({ employeeId: E, kind: "LATE_REASON", dateFrom: lateDays[0], reason: "QA tirbandlik" })], "/otdel-kadr?tab=arizalar");
const lateReq = q1(`select id from "HrRequest" where "employeeId"=${lit(E)} and kind='LATE_REASON'`)!;
check(r.ok && !!lateReq, "kechikish sababi arizasi kiritildi", r.error);
r = await kadr.action(`${HA}#decideRequest`, [lateReq, true, undefined, fd({})], "/otdel-kadr?tab=arizalar");
check(r.ok && q1(`select status from "HrRequest" where id=${lit(lateReq)}`) === "APPROVED", "ariza tasdiqlandi", r.error);
r = await kadr.action(`${PA}#recalcAction`, [RUN], `/ish-haqi/${RUN}`);
L = line();
check(r.ok && hit(`Kechikish ${tag}`)?.days === 1 && hit(`Kechikish ${tag}`)?.amount === 10_000, "qayta hisob: sababli kun jarimadan chiqdi (1 × 10 000)", r.error ?? L?.breakdown.rules);

// ── 4) Tasdiq va to'lov ──
console.log("\n4. Tasdiq va kassadan to'lov");
r = await kadr.action(`${PA}#approveAction`, [RUN], `/ish-haqi/${RUN}`);
check(!!r.error && q1(`select status from "PayrollRun" where id=${lit(RUN!)}`) === "DRAFT", "kadr tasdiqlay olmaydi", r.error);
r = await kadr.action(`${PA}#submitAction`, [RUN], `/ish-haqi/${RUN}`);
check(r.ok && q1(`select status from "PayrollRun" where id=${lit(RUN!)}`) === "SUBMITTED", "direktor tasdig'iga yuborildi", r.error);
r = await kadr.action(`${PA}#recalcAction`, [RUN], `/ish-haqi/${RUN}`);
check(/tasdig/.test(r.error ?? ""), "yuborilgan vedomost qayta hisoblanmaydi", r.error);
r = await kadr.action(`${HA}#addPayAdjustment`, [undefined, fd({ employeeId: E, month: M, kind: "BONUS", amount: "5000", reason: "kech" })], "/otdel-kadr?tab=jarima-bonus");
check(/tasdiqqa yuborilgan/.test(r.error ?? ""), "yopilayotgan oyga bonus yozilmaydi", r.error);
r = await dir.action(`${PA}#returnAction`, [RUN, undefined, fd({ note: "QA tekshiring" })], `/ish-haqi/${RUN}`);
check(r.ok && q1(`select status from "PayrollRun" where id=${lit(RUN!)}`) === "DRAFT", "direktor qaytardi → qoralama", r.error);
await kadr.action(`${PA}#submitAction`, [RUN], `/ish-haqi/${RUN}`);
r = await dir.action(`${PA}#approveAction`, [RUN], `/ish-haqi/${RUN}`);
check(r.ok && q1(`select status from "PayrollRun" where id=${lit(RUN!)}`) === "APPROVED", "direktor tasdiqladi", r.error);
const lineId = q1(`select id from "PayrollLine" where "runId"=${lit(RUN!)} and "employeeId"=${lit(E)}`)!;
const net = Number(line().net);
const acc = q1(`select id from "CashAccount" where type='CASH' and "isActive" order by name limit 1`)!;
const dirId = q1(`select id from "User" where login='test.direktor'`)!;
q(`insert into "CashTransaction" (id, date, type, "cashAccountId", amount, category, note, "createdById", "createdAt") values (${lit(`qa_pay_in_${tag}`)}, now(), 'INCOME', ${lit(acc)}, ${net + 1_000_000}, 'Boshqa', 'QA ish haqi uchun', ${lit(dirId)}, now())`);
r = await kadr.action(`${PA}#payAction`, [RUN, undefined, fd({ cashAccountId: acc, line: [lineId] })], `/ish-haqi/${RUN}`);
check(/kassir/.test(r.error ?? ""), "kadr to'lay olmaydi", r.error);
r = await kassa.action(`${PA}#payAction`, [RUN, undefined, fd({ cashAccountId: acc, line: [lineId] })], `/ish-haqi/${RUN}`);
const tx = q(`select amount::text, category, "refType", "refId" from "CashTransaction" where "refType"='Payroll' and "refId"=${lit(RUN!)}`);
check(r.ok && tx.length === 1 && Number(tx[0]![0]) === net && tx[0]![1] === "Ish haqi", `kassir ${net} to'ladi — Kirim-Chiqimda «Ish haqi» chiqimi`, r.error ?? tx);
check(!!q1(`select "paidAt" from "PayrollLine" where id=${lit(lineId)}`) && Number(q1(`select paid from "PayrollLine" where id=${lit(lineId)}`)) === net, "qator to'langan deb belgilandi");
r = await kassa.action(`${PA}#payAction`, [RUN, undefined, fd({ cashAccountId: acc, line: [lineId] })], `/ish-haqi/${RUN}`);
check(!!r.error && n1(`select count(*) from "CashTransaction" where "refType"='Payroll' and "refId"=${lit(RUN!)}`) === 1, "qayta to'lov — ikkinchi chiqim yozilmadi", r.error);
r = await dir.action(`${PA}#cancelAction`, [RUN, undefined, fd({ reason: "QA bekor" })], `/ish-haqi/${RUN}`);
check(/To'lov qilingan/.test(r.error ?? ""), "to'lov qilingan vedomost bekor qilinmaydi", r.error);

// ── 5) Arizalar: ta'til → davomat, avans → alohida vedomost ──
console.log("\n5. Arizalar");
const today = new Date().toLocaleDateString("sv-SE");
const in3 = new Date(Date.now() + 3 * 864e5).toLocaleDateString("sv-SE"), in4 = new Date(Date.now() + 4 * 864e5).toLocaleDateString("sv-SE");
r = await kadr.action(`${HA}#createRequestForEmployee`, [undefined, fd({ employeeId: E, kind: "VACATION", dateFrom: in3, dateTo: in4 })], "/otdel-kadr?tab=arizalar");
const vac = q1(`select id from "HrRequest" where "employeeId"=${lit(E)} and kind='VACATION'`)!;
check(r.ok && !!vac, "ta'til arizasi kiritildi", r.error);
r = await kadr.action(`${HA}#createRequestForEmployee`, [undefined, fd({ employeeId: E, kind: "VACATION", dateFrom: in4, dateTo: in4 })], "/otdel-kadr?tab=arizalar");
check(/arizasi bor/.test(r.error ?? ""), "kesishgan ta'til arizasi rad etildi", r.error);
r = await kadr.action(`${HA}#decideRequest`, [vac, false, undefined, fd({})], "/otdel-kadr?tab=arizalar");
check(/sabab/.test(r.error ?? ""), "sababsiz rad etish mumkin emas", r.error);
r = await kadr.action(`${HA}#decideRequest`, [vac, true, undefined, fd({})], "/otdel-kadr?tab=arizalar");
check(r.ok && n1(`select count(*) from "Attendance" where "employeeId"=${lit(E)} and date between '${in3}' and '${in4}' and status='LEAVE'`) === 2 && n1(`select "appliedDays" from "HrRequest" where id=${lit(vac)}`) === 2, "tasdiqlangan ta'til davomatga 2 kun «Ta'til» bo'lib tushdi", r.error);
r = await kadr.action(`${HA}#decideRequest`, [vac, true, undefined, fd({})], "/otdel-kadr?tab=arizalar");
check(/allaqachon/.test(r.error ?? ""), "qayta tasdiqlash rad etildi", r.error);
r = await kadr.action(`${HA}#createRequestForEmployee`, [undefined, fd({ employeeId: E, kind: "ADVANCE", amount: "300000", reason: "QA avans" })], "/otdel-kadr?tab=arizalar");
const adv = q1(`select id from "HrRequest" where "employeeId"=${lit(E)} and kind='ADVANCE'`)!;
r = await kadr.action(`${HA}#decideRequest`, [adv, true, undefined, fd({})], "/otdel-kadr?tab=arizalar");
const xRun = q1(`select "payrollRunId" from "HrRequest" where id=${lit(adv)}`);
check(r.ok && !!xRun && q1(`select status from "PayrollRun" where id=${lit(xRun!)}`) === "SUBMITTED" && q1(`select kind from "PayrollRun" where id=${lit(xRun!)}`) === "EXTRA", "avans tasdiqlandi → alohida vedomost direktor tasdig'ida", r.error);
await dir.action(`${PA}#approveAction`, [xRun], `/ish-haqi/${xRun}`);
r = await kassa.action(`${PA}#payAction`, [xRun, undefined, fd({ cashAccountId: acc })], `/ish-haqi/${xRun}`);
check(r.ok && q1(`select status from "PayrollRun" where id=${lit(xRun!)}`) === "PAID", "avans kassadan berildi — vedomost yopildi", r.error);
// Joriy oy avans vedomosti — berilgan avans ushlanadi (takror berilmaydi)
r = await kadr.action(`${PA}#calculateAction`, [undefined, fd({ month: today.slice(0, 7), kind: "ADVANCE" })], "/ish-haqi");
const aRun = idFrom(r.redirect);
check(!!aRun && Number(q1(`select "advanceDeducted" from "PayrollLine" where "runId"=${lit(aRun!)} and "employeeId"=${lit(E)}`)) === 300_000, "joriy oy avansida berilgan 300 000 hisobga olindi", r.error ?? r.redirect);

// ── 6) Sahifalar ──
for (const p of ["/ish-haqi", `/ish-haqi/${RUN}`, "/ish-haqi?tab=sozlamalar", "/otdel-kadr?tab=grafik", "/otdel-kadr?tab=arizalar", "/otdel-kadr?tab=jarima-bonus", "/hisobim"]) {
  const x = await kadr.get(p); check(x.status === 200, `kadr ${p} → ${x.status}`);
}
for (const p of ["/ish-haqi", `/ish-haqi/${RUN}`]) {
  for (const [nm, c] of [["kassa", kassa], ["direktor", dir]] as const) { const x = await c.get(p); check(x.status === 200, `${nm} ${p} → ${x.status}`); }
}
const sk = await sklad.get("/ish-haqi");
check(sk.status !== 200, "sklad /ish-haqi ga kira olmaydi", sk.status);
summary("b-payroll");
process.exit();
