/**
 * QA (C) — To'lov kalendari (`lib/fin-report/calendar.ts`) va «Bugun» ma'lumoti (`lib/fin-report/today.ts`):
 * doimiy to'lov sanalari (31 → oyning oxirgi kuni), doimiy / bir martalik to'lov va va'da qilingan tushum kunlarga
 * tushishi, muddati o'tgani bugunga o'tishi, ta'minotchi boshlang'ich qarzi, divident limiti, qoldiq zanjiri.
 * Server kerak emas. Faqat lokal insof_test… bazasi (c-lib tekshiradi). Boshqa ma'lumotga bog'liq bo'lmasin deb
 * tekshiruvlar O'ZGARISH (delta) bo'yicha: yozishdan oldin va keyin kalendar solishtiriladi.
 *
 *   DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_c npx tsx scripts/qa/c-kalendar.ts
 */
import { check, section, done } from "./c-lib";
import { db } from "@/lib/db";
import { resetCategoryCache } from "@/lib/fin-report/categories";
import { cashCalendar, recurringDates, startOfDay, CAL_DAYS } from "@/lib/fin-report/calendar";
import { todayData } from "@/lib/fin-report/today";

const DAY = 86_400_000;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function main() {
  const tag = Date.now() % 1_000_000;
  resetCategoryCache();
  const user = await db.user.findFirst({ select: { id: true } }) ?? await db.user.create({ data: { login: `qa.kal.${tag}`, passwordHash: "x", fullName: "QA Kalendar", role: "FINANCE" } });
  const U = user.id;
  const today = startOfDay(new Date());
  const inDays = (n: number) => new Date(today.getTime() + n * DAY);

  section("1. Doimiy to'lov sanalari");
  const feb = recurringDates(31, new Date(2027, 1, 1), new Date(2027, 2, 1));
  check("31-kun fevralda — 28-fevral", feb.length === 1 && feb[0]!.getDate() === 28 && feb[0]!.getMonth() === 1, feb);
  const leap = recurringDates(30, new Date(2028, 1, 1), new Date(2028, 2, 1));
  check("30-kun kabisa fevralida — 29-fevral", leap[0]?.getDate() === 29, leap);
  const two = recurringDates(15, new Date(2027, 0, 20), new Date(2027, 2, 20));
  check("oraliqdagi har oy bitta sana (15.02, 15.03)", two.length === 2 && two[0]!.getMonth() === 1 && two[1]!.getMonth() === 2, two);
  check("oraliqdan oldingi kun olinmaydi", recurringDates(5, new Date(2027, 0, 10), new Date(2027, 1, 1)).length === 0);

  const settingsBefore = await db.companySettings.findUnique({ where: { id: "main" }, select: { dividendPct: true } });
  await db.companySettings.upsert({ where: { id: "main" }, update: { dividendPct: 50 }, create: { id: "main", dividendPct: 50 } });
  const c0 = await cashCalendar();

  section("2. Kalendarga yozuvlar: doimiy, bir martalik, va'da, ta'minotchi qarzi, divident");
  const d3 = inDays(3);
  await db.recurringPayment.create({ data: { name: `QA ijara ${tag}`, category: "Ijara", dayOfMonth: d3.getDate(), amount: 7_000_000, createdById: U } });
  await db.recurringPayment.create({ data: { name: `QA nofaol ${tag}`, category: "Ijara", dayOfMonth: d3.getDate(), amount: 999_000, isActive: false, createdById: U } });
  await db.plannedFlow.create({ data: { type: "INCOME", date: inDays(5), amount: 3_000_000, counterparty: `QA mijoz ${tag}`, createdById: U } });
  await db.plannedFlow.create({ data: { type: "EXPENSE", date: inDays(-10), amount: 1_000_000, counterparty: `QA eski to'lov ${tag}`, createdById: U } });
  await db.plannedFlow.create({ data: { type: "EXPENSE", date: inDays(CAL_DAYS + 5), amount: 5_000_000, counterparty: `QA uzoq ${tag}`, createdById: U } });
  await db.plannedFlow.create({ data: { type: "EXPENSE", date: inDays(2), amount: 4_000_000, counterparty: `QA bajarilgan ${tag}`, status: "DONE", createdById: U } });
  const sup = await db.supplier.create({ data: { name: `QA ta'minotchi ${tag}`, paymentTermDays: 10 } });
  await db.openingBalance.create({ data: { kind: "SUPPLIER", date: inDays(-40), supplierId: sup.id, amount: 2_500_000, activeKey: `SUPPLIER:${sup.id}`, createdById: U } });
  const acc = await db.cashAccount.create({ data: { name: `QA Kalendar ${tag}`, type: "BANK" } });
  await db.cashTransaction.create({ data: { type: "OPENING", date: inDays(-60), cashAccountId: acc.id, amount: 10_000_000, category: "Boshlang'ich qoldiq", createdById: U } });
  await db.cashTransaction.create({ data: { type: "EXPENSE", date: new Date(today.getTime() + 60_000), cashAccountId: acc.id, amount: 1_000, category: "Divident", createdById: U } });

  const c1 = await cashCalendar();
  const item = (who: string) => c1.items.filter((i) => i.who === who);
  const rec = item(`QA ijara ${tag}`);
  check("doimiy to'lov 3-kunga tushdi (Majburiy)", rec.length === 1 && rec[0]!.day === 3 && rec[0]!.kind === "RECURRING" && rec[0]!.amount === 7_000_000, rec);
  check("nofaol doimiy to'lov kalendarga kirmaydi", item(`QA nofaol ${tag}`).length === 0);
  const inc = item(`QA mijoz ${tag}`);
  check("va'da qilingan tushum 5-kunda", inc.length === 1 && inc[0]!.day === 5 && inc[0]!.kind === "PLANNED_IN", inc);
  const old = item(`QA eski to'lov ${tag}`);
  check("muddati o'tgan bir martalik to'lov bugunga tushdi (o'tgan belgisi bilan)", old.length === 1 && old[0]!.day === 0 && old[0]!.overdue, old);
  check("30 kundan keyingi to'lov kirmaydi", item(`QA uzoq ${tag}`).length === 0);
  check("bajarilgan to'lov kirmaydi", item(`QA bajarilgan ${tag}`).length === 0);
  const op = item(`QA ta'minotchi ${tag}`);
  check("ta'minotchi boshlang'ich qarzi bugunga (muddati o'tgan)", op.length === 1 && op[0]!.day === 0 && op[0]!.kind === "SUPPLIER" && op[0]!.amount === 2_500_000, op);
  const sd = c1.suppliers.find((x) => x.supplierId === sup.id);
  check("ta'minotchilar bloki: qarz 2 500 000, muddat 10 kun", sd?.debt === 2_500_000 && sd.overdue === 2_500_000 && sd.termDays === 10, sd);

  section("3. Kunlar va jami — o'zgarish");
  const dd = (i: number, k: "outMandatory" | "inPromised" | "outSupplier") => c1.days[i]![k] - c0.days[i]![k];
  check("3-kun majburiy +7 000 000", near(dd(3, "outMandatory"), 7_000_000), dd(3, "outMandatory"));
  check("bugun majburiy +1 000 000, ta'minotchi +2 500 000", near(dd(0, "outMandatory"), 1_000_000) && near(dd(0, "outSupplier"), 2_500_000), [dd(0, "outMandatory"), dd(0, "outSupplier")]);
  check("5-kun va'da +3 000 000", near(dd(5, "inPromised"), 3_000_000), dd(5, "inPromised"));
  check("boshlang'ich pul +10 000 000 − 1 000 (divident)", near(c1.start - c0.start, 9_999_000), c1.start - c0.start);
  const chain = c1.days.every((d, i) => near(d.balance, (i ? c1.days[i - 1]!.balance : c1.start) + d.net));
  check("qoldiq zanjiri: kecha qoldig'i + kun natijasi", chain);
  check("eng past qoldiq — kunlar ichidagi minimum", near(c1.min.balance, Math.min(...c1.days.map((d) => d.balance))));
  check(`${CAL_DAYS} kun`, c1.days.length === CAL_DAYS);

  section("4. Divident limiti");
  const dv = c1.dividend;
  check("limit = max(0, o'tgan oy foydasi) × 50%", near(dv.limit, Math.round(Math.max(0, dv.profit) * 50) / 100), dv);
  check("shu oy olingan divident +1 000, qolgan = limit − olingan", near(dv.taken - c0.dividend.taken, 1_000) && near(dv.left, dv.limit - dv.taken), dv);

  section("5. «Bugun» ma'lumoti");
  const t = await todayData();
  check("jami pul = kalendar boshlang'ich puli", near(t.cash.total, t.cal.start));
  check("hisoblar yig'indisi = jami pul", near(t.cash.accounts.reduce((s, a) => s + a.balance, 0), t.cash.total));
  check("yangi hisob ro'yxatda", t.cash.accounts.some((a) => a.id === acc.id && near(a.balance, 9_999_000)));
  check("bizning qarzimiz ichida ta'minotchi qarzi bor", t.payable.suppliers >= 2_500_000 - 0.01);
  check("7 kunlik ro'yxatda doimiy to'lov bor", t.week.some((i) => i.who === `QA ijara ${tag}`));
  check("e'tibor ro'yxati bo'sh emas", t.attention.length > 0);

  await db.companySettings.update({ where: { id: "main" }, data: { dividendPct: settingsBefore?.dividendPct ?? 100 } });
  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
