/**
 * QA (C) — mobil Arenda (sekretar, ECO ilovasi): ijarachi kartasi, ijaraga berish / almashtirish / bo'shatish,
 * narx o'zgarishi, svet ko'rsatkichi, sobiq ijarachi qarzi, qarzdorlar va svet ro'yxatlari, bosh sahifa.
 * Server kerak emas — `lib/mobile/*` to'g'ridan chaqiriladi. Faqat lokal insof_test… bazasi (c-lib tekshiradi).
 *
 *   DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_c npx tsx scripts/qa/c-mobile-arenda.ts
 */
import { check, section, done } from "./c-lib";
import { db } from "@/lib/db";
import { currentMonth, monthKey, shiftMonth } from "@/lib/rent";
import type { MobileUser } from "@/lib/mobile/auth";
import { runMobileAction } from "@/lib/mobile/actions";
import { mobileDetail } from "@/lib/mobile/detail";
import { mobileList } from "@/lib/mobile/list";
import { arendaCreate, arendaHome } from "@/lib/mobile/arenda";

const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };

async function main() {
  const tag = Date.now() % 1_000_000;
  const LOC = `QA MobArenda ${tag}`;
  const cur = currentMonth();
  const u = await db.user.create({ data: { login: `qa.marenda.${tag}`, passwordHash: "x", fullName: "QA Sekretar", role: "SECRETARY" } });
  const user: MobileUser = { id: u.id, login: u.login, fullName: u.fullName, role: "SECRETARY", roleLabel: "Sekretar" };
  await db.companySettings.upsert({ where: { id: "main" }, update: { rentKwhPrice: 1000, rentElecMarkup: 10 }, create: { id: "main", rentKwhPrice: 1000, rentElecMarkup: 10 } });

  section("1. Do'kon qo'shish (yangi forma)");
  const noPhone = await err(arendaCreate(user, "arenda-shop", { name: "M1", location: LOC, area: "20", period: "MONTHLY", payDay: "5", bankAmount: "500000", cashAmount: "500000" }));
  check("ijaradagi joy telefonsiz — rad", !!noPhone && /telefon/i.test(noPhone), noPhone);
  const badInn = await err(arendaCreate(user, "arenda-shop", { name: "M1", location: LOC, area: "20", phone: "+998901234567", inn: "12345", period: "MONTHLY", payDay: "5", bankAmount: "500000", cashAmount: "500000" }));
  check("noto'g'ri INN — rad", !!badInn && /INN/.test(badInn), badInn);
  const a = await arendaCreate(user, "arenda-shop", { name: "M1", location: LOC, area: "20", phone: "+998901234567", tenantName: "Vali", inn: "123456789", period: "MONTHLY", payDay: "5", bankAmount: "500000", cashAmount: "500000", electricityBilled: true, elecFixed: "100000" });
  const A = a.id!;
  const shopA = await db.rentShop.findUniqueOrThrow({ where: { id: A } });
  check("do'kon: ijarachi, telefon, INN, svet alohida", shopA.tenantName === "Vali" && shopA.phone === "+998901234567" && shopA.inn === "123456789" && shopA.electricityBilled && Number(shopA.elecFixed) === 100000, shopA);
  const leaseA = await db.rentLease.findFirst({ where: { shopId: A, status: "ACTIVE" } });
  check("shartnoma ochildi, raqam avtomatik", !!leaseA?.no && /^IJ-/.test(leaseA.no), leaseA?.no);
  const v = await arendaCreate(user, "arenda-shop", { name: "M2", location: LOC, area: "15", vacant: true, period: "MONTHLY", bankAmount: "300000", cashAmount: "0" });
  const V = v.id!;
  const shopV = await db.rentShop.findUniqueOrThrow({ where: { id: V } });
  check("bo'sh joy — telefonsiz qo'shildi, shartnomasiz", !shopV.isActive && (await db.rentLease.count({ where: { shopId: V } })) === 0);

  section("2. Ijarachi kartasi");
  const d = await mobileDetail(user, "arenda-shop", A);
  const ids = d.actions.map((x) => x.id);
  check("karta amallari: almashtirish, bo'shatish, narx, svet, tahrir, qo'ng'iroq", ["arenda.lease.start", "arenda.lease.end", "arenda.price", "arenda.elec", "arenda.shop.edit", "arenda.call"].every((x) => ids.includes(x)), ids);
  check("qo'ng'iroq — tel: havola", d.actions.find((x) => x.id === "arenda.call")?.effect?.openUrl === "tel:+998901234567");
  check("maydonlar: ijarachi va shartnoma", d.fields.some((f) => f.label === "Ijarachi" && f.value === "Vali") && d.fields.some((f) => f.label === "Shartnoma"), d.fields.map((f) => f.label));
  check("bo'limlar: oyma-oy hisob, svet, to'lovlar", ["Oyma-oy hisob", "Svet hisobi", "To'lovlar tarixi"].every((t) => d.sections.some((s) => s.title.startsWith(t))), d.sections.map((s) => s.title));
  const dv = await mobileDetail(user, "arenda-shop", V);
  check("bo'sh joy kartasi: «Ijaraga berish»", dv.actions.some((x) => x.id === "arenda.lease.start" && x.label === "Ijaraga berish") && !dv.actions.some((x) => x.id === "arenda.lease.end"), dv.actions.map((x) => x.label));

  section("3. Ijaraga berish (bo'sh joy)");
  const noPay = await err(runMobileAction(user, "arenda.lease.start", V, { tenantName: "Sobir", phone: "+998907776655", startDate: "01.01.2026" }));
  check("oylikda to'lov kunisiz — rad", !!noPay && /To'lov kuni/.test(noPay), noPay);
  const badDate = await err(runMobileAction(user, "arenda.lease.start", V, { tenantName: "Sobir", phone: "+998907776655", startDate: "31.02.2026", payDay: "10" }));
  check("noto'g'ri sana — rad", !!badDate && /sana noto'g'ri/.test(badDate), badDate);
  const start = `01.${String(shiftMonth(cur, -2).getUTCMonth() + 1).padStart(2, "0")}.${shiftMonth(cur, -2).getUTCFullYear()}`;
  const r1 = await runMobileAction(user, "arenda.lease.start", V, { tenantName: "Sobir", phone: "+998907776655", startDate: start, payDay: "10", bankAmount: "300000", cashAmount: "0", deposit: "200000" });
  const shopV2 = await db.rentShop.findUniqueOrThrow({ where: { id: V } });
  const lv = await db.rentLease.findFirst({ where: { shopId: V, status: "ACTIVE" } });
  check("ijaraga berildi", shopV2.isActive && shopV2.payDay === 10 && lv?.tenantName === "Sobir" && Number(lv.deposit) === 200000, r1);

  section("4. Oy hisobi, svet, narx o'zgarishi");
  await runMobileAction(user, "arenda.charge", V, { month: monthKey(shiftMonth(cur, -1)), bankDue: "300000", cashDue: "0", tax: "0" });
  const e = await runMobileAction(user, "arenda.elec", A, { month: monthKey(cur), meterStart: "100", meterEnd: "150", amount: "0", paidDirect: "0" });
  const chA = await db.rentCharge.findFirst({ where: { shopId: A, month: cur } });
  check("svet: 50 kVt × 1000 + 10% = 55 000", Number(chA?.elecDue) === 55000, { e, elecDue: chA?.elecDue });
  const pr = await runMobileAction(user, "arenda.price", A, { fromMonth: monthKey(shiftMonth(cur, 1)), bankAmount: "600000", cashAmount: "600000", note: "QA" });
  const pc = await db.rentPriceChange.findFirst({ where: { shopId: A, cancelledAt: null } });
  check("narx o'zgarishi rejalashtirildi", !!pc && Number(pc.bankAmount) === 600000, pr);
  const past = await err(runMobileAction(user, "arenda.price", A, { fromMonth: monthKey(shiftMonth(cur, -1)), bankAmount: "1", cashAmount: "1" }));
  check("o'tgan oy narxi — rad", !!past, past);
  const d2 = await mobileDetail(user, "arenda-shop", A);
  check("kartada «Narx o'zgarishini bekor qilish»", d2.actions.some((x) => x.id === "arenda.price.cancel"));
  await runMobileAction(user, "arenda.price.cancel", A, { changeId: pc!.id });
  check("narx o'zgarishi bekor qilindi", !!(await db.rentPriceChange.findUnique({ where: { id: pc!.id } }))?.cancelledAt);

  section("5. Tahrirlash: telefon majburiy, shartnoma tugashi");
  const editNoPhone = await err(runMobileAction(user, "arenda.shop.edit", V, { name: "M2", location: LOC, period: "MONTHLY", payDay: "10", bankAmount: "300000", cashAmount: "0", phone: "" }));
  check("tahrir: telefon bo'sh yuborilsa — mavjudi saqlanadi", editNoPhone === null, editNoPhone);
  await runMobileAction(user, "arenda.shop.edit", V, { name: "M2", location: LOC, period: "MONTHLY", payDay: "10", bankAmount: "300000", cashAmount: "0", endDate: "31.12.2027", electricityBilled: false });
  check("shartnoma tugashi saqlandi", (await db.rentLease.findFirstOrThrow({ where: { shopId: V, status: "ACTIVE" } })).endDate?.toISOString().slice(0, 10) === "2027-12-31");
  await runMobileAction(user, "arenda.shop.edit", V, { name: "M2", location: LOC, period: "MONTHLY", payDay: "10", bankAmount: "300000", cashAmount: "0", endDate: "-" });
  check("«-» — muddatsiz", (await db.rentLease.findFirstOrThrow({ where: { shopId: V, status: "ACTIVE" } })).endDate === null);

  section("6. Ijarachini almashtirish, sobiq ijarachi qarzi");
  const r2 = await runMobileAction(user, "arenda.lease.start", V, { tenantName: "Yangi", phone: "+998905554433", startDate: `01.${String(cur.getUTCMonth() + 1).padStart(2, "0")}.${cur.getUTCFullYear()}`, payDay: "10", bankAmount: "350000", cashAmount: "0" });
  const old = await db.rentLease.findFirstOrThrow({ where: { shopId: V, tenantName: "Sobir" } });
  check("eski shartnoma yopildi, yangisi ochildi", old.status === "ENDED" && (await db.rentLease.count({ where: { shopId: V, status: "ACTIVE", tenantName: "Yangi" } })) === 1, r2);
  const d3 = await mobileDetail(user, "arenda-shop", V);
  check("kartada «Oldingi ijarachilar» va sobiq qarz amali", d3.sections.some((s) => s.title === "Oldingi ijarachilar") && d3.actions.some((x) => x.id === "arenda.pay.former"), d3.actions.map((x) => x.id));
  const today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await runMobileAction(user, "arenda.pay.former", V, { leaseId: old.id, month: monthKey(shiftMonth(cur, -1)), method: "CASH", amount: "100000", date: ymd });
  const tx = await db.rentTx.findFirst({ where: { leaseId: old.id } });
  check("sobiq ijarachi to'lovi o'z shartnomasiga", !!tx && Number(tx.amount) === 100000);
  const wrong = await err(runMobileAction(user, "arenda.pay.former", V, { leaseId: leaseA!.id, month: monthKey(cur), method: "CASH", amount: "1", date: ymd }));
  check("boshqa do'kon shartnomasi — rad", !!wrong, wrong);
  const txd = await mobileDetail(user, "arenda-tx", tx!.id);
  check("kirim kartasi ochiladi", txd.key === "arenda-tx");

  section("7. Ro'yxatlar va bosh sahifa");
  const debtors = await mobileList(user, "arenda-debtors", LOC);
  check("qarzdorlar: sobiq ijarachi bor", debtors.rows.some((r) => r.id === V && r.status === "Sobiq ijarachi"), debtors.rows);
  check("qarzdorlar filtrlari", (debtors.filters ?? []).map((f) => f.key).join() === "all,active,former,elec");
  const svet = await mobileList(user, "arenda-svet", LOC);
  check("svet varag'i: M1 55 000", svet.rows.some((r) => r.id === A && r.subtitle?.includes("55")), svet.rows);
  const shops = await mobileList(user, "arenda-shops", LOC, "all");
  check("do'konlar: ijarachi nomi qatorda", shops.rows.some((r) => r.id === A && r.subtitle?.includes("Vali")), shops.rows.map((r) => r.subtitle));
  const home = await arendaHome();
  check("bosh sahifa: bandlik va yig'im", home.sections.some((s) => s.title.startsWith("Bandlik")) && home.sections.some((s) => s.title.startsWith("Yig'im")), home.sections.map((s) => s.title));

  section("8. Joyni bo'shatish");
  await runMobileAction(user, "arenda.lease.end", A, { endedAt: `${String(new Date().getDate()).padStart(2, "0")}.${String(new Date().getMonth() + 1).padStart(2, "0")}.${new Date().getFullYear()}`, reason: "QA" });
  const sA = await db.rentShop.findUniqueOrThrow({ where: { id: A } });
  check("bo'shatildi: joy bo'sh, ijarachi tozalandi", !sA.isActive && sA.phone === null && (await db.rentLease.findUniqueOrThrow({ where: { id: leaseA!.id } })).status === "ENDED");

  section("9. Ruxsat: boshqa rol");
  const other: MobileUser = { ...user, role: "CASHIER", roleLabel: "Kassir" };
  const denied = await err(runMobileAction(other, "arenda.lease.end", V, { endedAt: "01.01.2030" }));
  check("kassir — ruxsat yo'q", !!denied && /ruxsat/i.test(denied), denied);

  done();
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
