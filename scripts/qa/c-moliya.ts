/**
 * QA (C) — Moliyaviy hisobotlar (`lib/fin-report`): kategoriya daraxti va eski nomlar, kassa yozuvining manba / sub manba /
 * loyiha / kredit bog'lanishi, PNL (hisoblangan), pul oqimi (DDS) va balans, kredit qoldig'i, asosiy vosita amortizatsiyasi.
 * Server kerak emas — kutubxona to'g'ridan chaqiriladi. Faqat lokal insof_test… bazasi (c-lib tekshiradi).
 * Boshqa ma'lumotga bog'liq bo'lmasin deb hamma tekshiruv O'ZGARISH (delta) bo'yicha: 2020-yil mart oyiga o'z hisobimiz bilan
 * yozamiz va hisobotni yozishdan oldin va keyin solishtiramiz.
 *
 *   DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_c npx tsx scripts/qa/c-moliya.ts
 */
import { check, section, done } from "./c-lib";
import { db } from "@/lib/db";
import { createCashEntry } from "@/lib/cash-entry";
import { loadCategories, makeResolver, resetCategoryCache } from "@/lib/fin-report/categories";
import { pnlReport } from "@/lib/fin-report/pnl";
import { ddsReport } from "@/lib/fin-report/dds";
import { balanceReport } from "@/lib/fin-report/balance";
import { loanBalances } from "@/lib/fin-report/loans";
import { activeAssets, assetStateAt, depreciationIn } from "@/lib/fin-report/assets";
import type { FinRow } from "@/lib/fin-report/rows";
import { customerDebtSheet, debtAgeReport, parseDebtDay, supplierDebtSheet } from "@/lib/fin-report/debts";

const M = "2020-03", N = "2020-04";
const val = (rows: FinRow[], key: string, i = 0) => rows.find((r) => r.key === key)?.values[i] ?? 0;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function main() {
  const tag = Date.now() % 1_000_000;
  resetCategoryCache();
  const user = await db.user.findFirst({ select: { id: true } }) ?? await db.user.create({ data: { login: `qa.moliya.${tag}`, passwordHash: "x", fullName: "QA Moliya", role: "ACCOUNTING" } });
  const U = user.id;

  section("1. Kategoriya daraxti va eski nomlar");
  const nodes = await loadCategories();
  const resolve = makeResolver(nodes);
  check("migratsiya kategoriyalari bor (manba + sub manba)", nodes.length >= 30 && nodes.some((n) => n.parentId), nodes.length);
  const y = resolve("Yoqilg'i");
  check("«Yoqilg'i» (eski nom) → Transport / Yoqilg'i", y?.top.name === "Transport" && y.sub?.name === "Yoqilg'i", y);
  const a = resolve("Avans");
  check("«Avans» → Ish haqi / Oylik va avans (alias)", a?.top.name === "Ish haqi" && a.sub?.name === "Oylik va avans", a);
  check("«Boshlang'ich qoldiq» kirimi → Ta'sischi kiritmasi (moliyaviy oqim)", resolve("Boshlang'ich qoldiq")?.top.flow === "FINANCING");
  check("apostrof turlari farq qilmaydi («Yoqilgʻi»)", resolve("Yoqilgʻi")?.top.name === "Transport");
  check("noma'lum nom → topilmaydi", resolve(`QA noma'lum ${tag}`) === null);
  check("Kredit foizi — PNL «INTEREST», kredit so'raydi, foiz qismi", (() => { const k = resolve("Kredit foizi"); return k?.top.pnlLine === "INTEREST" && k.top.needs === "LOAN" && k.top.loanPart === "INTEREST"; })());
  check("Asosiy vosita xaridi — investitsion, PNL'ga kirmaydi", (() => { const k = resolve("Asosiy vosita xaridi"); return k?.top.flow === "INVESTING" && k.top.pnlLine === "NONE"; })());

  // ── Yozishdan oldingi holat (delta uchun) ──
  const months = [M, N];
  const [pnl0, dds0, bal0] = await Promise.all([pnlReport(months), ddsReport(months), balanceReport(months)]);

  section("2. Kassa yozuvlari: manba, sub manba, loyiha, kredit");
  const acc = await db.cashAccount.create({ data: { name: `QA Moliya ${tag}`, type: "CASH" } });
  await db.cashTransaction.create({ data: { type: "OPENING", date: new Date(2020, 1, 15), cashAccountId: acc.id, amount: 5_000_000, category: "Boshlang'ich qoldiq", createdById: U } });
  const loan = await db.loan.create({ data: { kind: "BANK", name: `QA kredit ${tag}`, counterparty: "QA bank", openingBalance: 5_000_000, openingDate: new Date(2020, 0, 1), createdById: U } });
  const project = await db.project.create({ data: { name: `QA loyiha ${tag}`, createdById: U } });
  const d = (day: number) => new Date(2020, 2, day, 12);
  const base = { cashAccountId: acc.id };

  const inc = await createCashEntry({ ...base, type: "INCOME", date: d(5), amount: 200_000, category: "Boshqa tushum" }, U);
  check("kirim «Boshqa tushum» yozildi", !!inc.id, inc.error);
  const fuel = await createCashEntry({ ...base, type: "EXPENSE", date: d(6), amount: 50_000, category: "Yoqilg'i" }, U);
  const fuelRow = fuel.id ? await db.cashTransaction.findUnique({ where: { id: fuel.id } }) : null;
  check("eski nom bilan chiqim → manba «Transport», sub manba «Yoqilg'i» bo'lib saqlandi", fuelRow?.category === "Transport" && fuelRow.subCategory === "Yoqilg'i", fuel.error ?? fuelRow);
  const bad1 = await createCashEntry({ ...base, type: "INCOME", date: d(6), amount: 10_000, category: "Divident" }, U);
  check("chiqim kategoriyasi kirimga — rad etildi", !!bad1.error, bad1);
  const bad2 = await createCashEntry({ ...base, type: "EXPENSE", date: d(6), amount: 10_000, category: "Transport", subCategory: "Elektr" }, U);
  check("boshqa manbaning sub manbasi — rad etildi", !!bad2.error, bad2);
  const prin = await createCashEntry({ ...base, type: "EXPENSE", date: d(7), amount: 300_000, category: "Kredit — asosiy qarz", loanId: loan.id }, U);
  const prinRow = prin.id ? await db.cashTransaction.findUnique({ where: { id: prin.id } }) : null;
  check("kredit asosiy qarzi: loanId + PRINCIPAL", prinRow?.loanId === loan.id && prinRow.loanPart === "PRINCIPAL", prin.error ?? prinRow);
  const intr = await createCashEntry({ ...base, type: "EXPENSE", date: d(8), amount: 40_000, category: "Kredit foizi", loanId: loan.id }, U);
  const intrRow = intr.id ? await db.cashTransaction.findUnique({ where: { id: intr.id } }) : null;
  check("kredit foizi: INTEREST", intrRow?.loanPart === "INTEREST", intr.error ?? intrRow);
  const proj = await createCashEntry({ ...base, type: "EXPENSE", date: d(9), amount: 70_000, category: "Loyihalar", projectId: project.id }, U);
  check("loyiha chiqimi projectId bilan", !!proj.id && (await db.cashTransaction.findUnique({ where: { id: proj.id } }))?.projectId === project.id, proj.error);
  const div = await createCashEntry({ ...base, type: "EXPENSE", date: d(10), amount: 100_000, category: "Divident" }, U);
  check("divident yozildi", !!div.id, div.error);
  const fa = await createCashEntry({ ...base, type: "EXPENSE", date: d(11), amount: 1_200_000, category: "Asosiy vosita xaridi" }, U);
  check("asosiy vosita xaridi yozildi", !!fa.id, fa.error);
  const asset = await db.fixedAsset.create({ data: { name: `QA stanok ${tag}`, group: "Uskuna va jihozlar", acquiredAt: d(11), cost: 1_200_000, lifeMonths: 12, cashTxId: fa.id, createdById: U } });

  section("3. Asosiy vosita va kredit");
  const ast = (await activeAssets()).find((x) => x.id === asset.id)!;
  check("amortizatsiya olingan oyda 0, keyingi oydan 100 000", depreciationIn(ast, M) === 0 && depreciationIn(ast, N) === 100_000 && depreciationIn(ast, "2021-03") === 100_000 && depreciationIn(ast, "2021-04") === 0);
  check("qoldiq qiymat: mart 1 200 000, aprel 1 100 000, muddat oxirida 0", assetStateAt(ast, M).net === 1_200_000 && assetStateAt(ast, N).net === 1_100_000 && assetStateAt(ast, "2021-03").net === 0);
  const lb = (await loanBalances(new Date(2020, 3, 1))).find((l) => l.id === loan.id);
  check("kredit qoldig'i 5 000 000 − 300 000 = 4 700 000, foiz qoldiqqa ta'sir qilmaydi", lb?.balance === 4_700_000 && lb.interestPaid === 40_000, lb);

  section("4. PNL (hisoblangan) — o'zgarish");
  const pnl1 = await pnlReport(months);
  const dp = (k: string, i = 0) => val(pnl1.rows, k, i) - val(pnl0.rows, k, i);
  check("boshqa tushum +200 000", near(dp("other-income"), 200_000), dp("other-income"));
  check("ishlab chiqarish xarajati −50 000 (Transport)", near(dp("prod"), -50_000), dp("prod"));
  check("kredit foizi −40 000; asosiy qarz PNL'ga kirmadi", near(dp("interest"), -40_000), dp("interest"));
  check("loyihalar −70 000 (zavod foydasidan keyin)", near(dp("projects"), -70_000) && near(dp("net"), 200_000 - 50_000 - 40_000), [dp("projects"), dp("net")]);
  check("divident −100 000; asosiy vosita xaridi PNL'ga kirmadi", near(dp("dividend"), -100_000) && near(dp("retained"), 200_000 - 50_000 - 40_000 - 70_000 - 100_000), [dp("dividend"), dp("retained")]);
  check("aprelda amortizatsiya −100 000", near(dp("prod", 1), -100_000), dp("prod", 1));
  check("«Manbasi aniqlanmagan» o'zgarmadi", near(dp("unknown"), 0), dp("unknown"));
  const projRow = pnl1.rows.find((r) => r.key === `PROJECT:QA loyiha ${tag}`);
  check("loyiha nomi bilan alohida qator", projRow?.values[0] === -70_000, projRow);

  section("5. Pul oqimi (DDS) — o'zgarish");
  const dds1 = await ddsReport(months);
  const dd = (k: string) => val(dds1.rows, k) - val(dds0.rows, k);
  check("joriy oqim +150 000 (kirim 200 000 − yoqilg'i 50 000)", near(dd("OPERATING:net"), 150_000), dd("OPERATING:net"));
  check("moliyaviy oqim −440 000 (kredit 300 000 + foiz 40 000 + divident 100 000)", near(dd("FINANCING:net"), -440_000), dd("FINANCING:net"));
  check("investitsion oqim −1 270 000 (vosita + loyiha)", near(dd("INVESTING:net"), -1_270_000), dd("INVESTING:net"));
  check("sof oqim −1 560 000", near(dd("net"), -1_560_000), dd("net"));
  const openRow = dds1.accountRows.find((r) => r.key === `acc:${acc.id}:open`), closeRow = dds1.accountRows.find((r) => r.key === `acc:${acc.id}:close`);
  check("hisob: boshlang'ich 5 000 000 → yakuniy 3 440 000", openRow?.values[0] === 5_000_000 && closeRow?.values[0] === 3_440_000, [openRow?.values, closeRow?.values]);
  check("tekshiruv qatori 0", dds1.check.every((v) => v === 0), dds1.check);

  section("6. Balans — o'zgarish");
  const bal1 = await balanceReport(months);
  // Balansda birinchi ustun — davr boshi (01.03), keyin oy oxirlari: mart = 1, aprel = 2
  const db_ = (k: string, i = 1) => val(bal1.rows, k, i) - val(bal0.rows, k, i);
  check("asosiy vositalar: mart +1 200 000, aprel +1 100 000", near(db_("fixed"), 1_200_000) && near(db_("fixed", 2), 1_100_000) && near(db_("fixed", 0), 0), [db_("fixed", 0), db_("fixed"), db_("fixed", 2)]);
  check("bank kreditlari +4 700 000", near(db_("liab:bank"), 4_700_000), db_("liab:bank"));
  check("pul +3 440 000 (yangi hisob)", near(db_("cash"), 3_440_000), db_("cash"));
  check("aktiv = passiv", bal1.rows.find((r) => r.key === "a:total")!.values.every((v, i) => near(v ?? 0, bal1.rows.find((r) => r.key === "p:total")!.values[i] ?? 0)));
  const diff0 = bal0.capitalRows.find((r) => r.key === "cap:diff")!.values, diff1 = bal1.capitalRows.find((r) => r.key === "cap:diff")!.values;
  // Mart: kapital −60 000 (= PNL natijasi). Kredit va hisob fevraldagi boshlang'ich qoldiq — fevral oxiri kapitaliga kiradi
  check("kapital tekshiruvi: martda yozuvlarimiz farq qo'shmadi", near((diff1[1] ?? 0) - (diff0[1] ?? 0), 0), [diff0, diff1]);
  check("balans ustunlari: 01.03.2020, 31.03.2020, 30.04.2020", bal1.labels.join(",") === "01.03.2020,31.03.2020,30.04.2020", bal1.labels);
  check("PNL: jadval atamalari (Xodimlar maoshlari, Amortizatsiya…) nol bo'lsa ham turadi", ["prod:Xodimlar maoshlari", "prod:Amortizatsiya (bino, uskuna, mashinalar eskirishi)", "admin:Kurs farqi", "comm:Xayriya"].every((k) => pnl1.rows.some((r) => r.key === k)));
  check("PNL: yoqilg'i «Avtotransport» qatorida", near((pnl1.rows.find((r) => r.key === "prod:Avtotransport")?.values[0] ?? 0) - (pnl0.rows.find((r) => r.key === "prod:Avtotransport")?.values[0] ?? 0), -50_000));
  check("DDS: kredit «Kridit va kridit foizi», divident «Divident» qatorida", near(val(dds1.rows, "FINANCING:Kridit va kridit foizi") - val(dds0.rows, "FINANCING:Kridit va kridit foizi"), -340_000) && near(val(dds1.rows, "FINANCING:Divident") - val(dds0.rows, "FINANCING:Divident"), -100_000));

  section("Qarz varaqlari (Tahlil → Mijozlar)");
  const today = parseDebtDay();
  const [age, cust, cash, bank, sup] = await Promise.all([debtAgeReport(today), customerDebtSheet(today), customerDebtSheet(today, "CASH"), customerDebtSheet(today, "BANK"), supplierDebtSheet(today)]);
  check("qarz yoshi: oraliqlar yig'indisi = jami qarz", near(age.buckets.reduce((a, b) => a + b, 0), age.total), [age.buckets, age.total]);
  check("qarz yoshi jami = xaridorlar varag'idagi bugungi qarz", near(age.total, cust.total.now.debt), [age.total, cust.total.now.debt]);
  check("qarz yoshi: 60 kundan eski ≤ 30 kundan eski ≤ jami", age.over60 <= age.over30 + 0.01 && age.over30 <= age.total + 0.01);
  check("Mijoz turi: naqd + perechisleniye = hammasi", cash.rows.length + bank.rows.length === cust.rows.length && near(cash.total.now.debt + bank.total.now.debt, cust.total.now.debt));
  check("xaridorlar: oy boshi ustuni 1-sana", cust.monthStart.getDate() === 1 && cust.monthStart.getMonth() === today.getMonth());
  check("ta'minotchilar: o'zgarish = bugungi sof − oy boshidagi sof", sup.rows.every((r) => near(r.change, (r.now.debt - r.now.advance) - (r.open.debt - r.open.advance))));
  check("kelajak sanasi bugunga tushadi", parseDebtDay("2999-01-01").getTime() === today.getTime());

  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
