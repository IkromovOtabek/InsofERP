/**
 * QA (C) — Kunlik Nazorat (`lib/nazorat`): Toshkent kuni, kassani yopish, xato kassa yozuvlari, kimga berilgani yozilmagan
 * sklad chiqimi, yoqilg'i, sklad sanog'i; Telegram matni (direktor — to'liq, mas'ul — o'z bandlari), qabul qiluvchilar,
 * bir kunda bir marta yuborish (qo'lda yuborilgandan keyin ham kechki hisobot bir marta), soatni kutish.
 * Server kerak emas; Telegram'ga murojaat yo'q (token o'chiriladi). Faqat lokal insof_test… bazasi (c-lib tekshiradi).
 *
 *   DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_c npx tsx scripts/qa/c-nazorat.ts
 */
import { check, section, done } from "./c-lib";
import { db } from "@/lib/db";
import { resetCategoryCache } from "@/lib/fin-report/categories";
import { runChecks, tashkentDay, tashkentHour, type Check } from "@/lib/nazorat/checks";
import { directorText, ownerText, planReport, sendControlReport } from "@/lib/nazorat/report";
import { nazoratTick } from "@/lib/nazorat/watch";

process.env.TELEGRAM_BOT_TOKEN = ""; // haqiqiy botga hech narsa ketmasin

const byNo = (cs: Check[], no: number) => cs.find((c) => c.no === no)!;
const at = (iso: string) => new Date(iso);

async function main() {
  const tag = Date.now() % 1_000_000;
  resetCategoryCache();

  section("1. Toshkent kuni va soati");
  check("UTC 20:30 → Toshkentda ertangi kun boshi", tashkentDay(at("2030-05-10T20:30:00Z")).toISOString() === "2030-05-10T19:00:00.000Z");
  check("UTC 18:59 → shu kun", tashkentDay(at("2030-05-10T18:59:00Z")).toISOString() === "2030-05-09T19:00:00.000Z");
  check("UTC 14:00 → Toshkent 19:00", tashkentHour(at("2030-05-10T14:00:00Z")) === 19);

  const user = await db.user.create({ data: { login: `qa.naz.dir.${tag}`, passwordHash: "x", fullName: "QA Direktor", role: "DIRECTOR" } });
  const U = user.id;
  const now = new Date();
  const c0 = await runChecks({ now });

  section("2. Kassani yopish");
  const acc = await db.cashAccount.create({ data: { name: `QA Naqd ${tag}`, type: "CASH" } });
  const c1 = await runChecks({ now });
  check("yangi naqd kassa yopilmagan deb chiqdi", byNo(c1, 1).value.includes(acc.name) && (byNo(c1, 1).status === "warn" || byNo(c1, 1).status === "crit"), byNo(c1, 1));
  const evening = new Date(tashkentDay(now).getTime() + 20 * 3_600_000); // Toshkent 20:00
  const morning = new Date(tashkentDay(now).getTime() + 9 * 3_600_000); // Toshkent 09:00
  check("kechqurun yopilmagan kassa — qizil, ertalab — sariq", byNo(await runChecks({ now: evening }), 1).status === "crit" && byNo(await runChecks({ now: morning }), 1).status === "warn");
  await db.cashCount.create({ data: { cashAccountId: acc.id, day: tashkentDay(now), counted: 0, system: 0, diff: 0, createdById: U } });
  const c2 = await runChecks({ now });
  check("sanalgandan keyin kassa ro'yxatdan chiqdi", !byNo(c2, 1).value.includes(acc.name), byNo(c2, 1));

  section("3. Kassa jurnali xatolari va sklad chiqimi");
  await db.cashTransaction.create({ data: { type: "OPENING", date: new Date(now.getTime() - 86_400_000 * 2), cashAccountId: acc.id, amount: 1_000_000, category: "Boshlang'ich qoldiq", createdById: U } });
  await db.cashTransaction.create({ data: { type: "EXPENSE", date: now, cashAccountId: acc.id, amount: 5_000, category: `QA noma'lum ${tag}`, createdById: U } });
  const c3 = await runChecks({ now });
  const errs = (cs: Check[]) => Number(byNo(cs, 2).value.split(" ")[0]) || 0;
  check("noma'lum kategoriyali yozuv xato sifatida sanaldi (+1)", errs(c3) === errs(c2) + 1 && byNo(c3, 2).status === "warn", [byNo(c2, 2).value, byNo(c3, 2).value]);
  const wh = await db.warehouse.findFirst({ select: { id: true } });
  const mat = await db.material.findFirst({ select: { id: true } });
  if (wh && mat) {
    const issues = (cs: Check[]) => Number((byNo(cs, 8).detail ?? "0").split(" ")[0]) || 0;
    await db.stockMove.create({ data: { type: "ISSUE", warehouseId: wh.id, materialId: mat.id, qty: -1, date: now, createdById: U } });
    const c4 = await runChecks({ now });
    check("kimga berilgani yozilmagan chiqim sanaldi (+1)", issues(c4) === issues(c3) + 1 && byNo(c4, 8).status === "warn", [byNo(c3, 8), byNo(c4, 8)]);
    await db.stockMove.create({ data: { type: "ADJUSTMENT", warehouseId: wh.id, materialId: mat.id, qty: 0, date: now, refType: "Inventory", refId: `qa-${tag}`, createdById: U } });
    const c5 = await runChecks({ now });
    check("bugungi inventarizatsiya → «0 kun oldin»", byNo(c5, 14).value.startsWith("0 kun"), byNo(c5, 14));
  } else check("sklad va xomashyo test bazada bor", false);

  section("4. Yoqilg'i");
  const veh = await db.vehicle.findFirst({ select: { id: true } });
  if (veh) {
    const given = (cs: Check[]) => Number((byNo(cs, 12).detail ?? "").replace(/^berildi ([\d\s,]+),.*$/, "$1").replace(/\s/g, "").replace(",", ".")) || 0;
    const before = await runChecks({ now });
    await db.fuelLog.create({ data: { vehicleId: veh.id, fuelType: "DIESEL", liters: 50, pricePerL: 14_000, amount: 700_000, date: now, createdById: U } });
    const after = await runChecks({ now });
    check("dizel quyilgani oyga +50 l qo'shildi", Math.abs(given(after) - given(before) - 50) < 0.01, [byNo(before, 12).detail, byNo(after, 12).detail]);
  } else check("transport test bazada bor", false);
  check("salyarka materiali tanlanmagan — «sozlanmagan»", (await db.companySettings.findUnique({ where: { id: "main" } }))?.fuelMaterialId ? true : byNo(c0, 7).status === "unset");

  section("5. Telegram matni");
  const fake: Check[] = [
    { no: 1, key: "a", title: "Kassa yopildimi", status: "crit", value: "yopilmagan", roles: ["CASHIER"], owner: "Kassir", action: "Yopsin", href: "/" },
    { no: 6, key: "b", title: "Ta'minot", status: "warn", value: "2 ta", roles: ["PROCUREMENT", "WAREHOUSE"], owner: "Snab", action: "Tekshirsin", href: "/" },
    { no: 4, key: "c", title: "Bugungi sotuv", status: "info", value: "0 so'm", roles: [], owner: "—", action: "—", href: "/" },
    { no: 2, key: "d", title: "Xato yozuvlar", status: "ok", value: "yo'q", roles: ["CASHIER"], owner: "Kassir", action: "—", href: "/" },
  ];
  const day = tashkentDay(at("2030-05-10T10:00:00Z"));
  const full = directorText(fake, day, "https://x/dashboard?view=nazorat");
  check("direktor matni: sana, hisob, ikkala bo'lim va havola", full.includes("10.05.2030") && full.includes("Shoshilinch: 1 · Tekshirish kerak: 1 · Joyida: 1") && full.includes("SHOSHILINCH") && full.includes("TEKSHIRISH KERAK") && full.includes("https://x/dashboard?view=nazorat"), full);
  check("yashil band direktor matnida ro'yxatlanmaydi", !full.includes("Xato yozuvlar"));
  const cashier = ownerText(fake, "CASHIER", day);
  check("kassirga faqat o'z qizil/sariq bandi", !!cashier && cashier.includes("Kassa yopildimi") && !cashier.includes("Ta'minot") && !cashier.includes("Xato yozuvlar"), cashier);
  check("bandi yo'q rolga xabar yo'q (HR)", ownerText(fake, "HR", day) === null);
  check("skladchiga ta'minot bandi", ownerText(fake, "WAREHOUSE", day)?.includes("Ta'minot") === true);

  section("6. Qabul qiluvchilar");
  const cashUser = await db.user.create({ data: { login: `qa.naz.kas.${tag}`, passwordHash: "x", fullName: "QA Kassir", role: "CASHIER" } });
  const hrUser = await db.user.create({ data: { login: `qa.naz.hr.${tag}`, passwordHash: "x", fullName: "QA Kadr", role: "HR" } });
  const offUser = await db.user.create({ data: { login: `qa.naz.off.${tag}`, passwordHash: "x", fullName: "QA Bo'shagan", role: "DIRECTOR", isActive: false } });
  const chat = (u: string, i: number) => db.telegramAccount.create({ data: { chatId: `-${tag}${i}`, userId: u, linkedAt: new Date() } });
  await chat(U, 1); await chat(cashUser.id, 2); await chat(hrUser.id, 3); await chat(offUser.id, 4);
  const planned = await planReport(fake, day);
  const mineP = planned.filter((p) => [U, cashUser.id, hrUser.id, offUser.id].includes(p.userId));
  check("direktorga to'liq matn", mineP.some((p) => p.userId === U && p.director && p.text === directorText(fake, day, p.text.split("Batafsil: ")[1] ?? "")), mineP.map((p) => p.userId));
  check("kassirga o'z bandi, kadrga — yo'q, nofaol xodimga — yo'q", mineP.some((p) => p.userId === cashUser.id && !p.director) && !mineP.some((p) => p.userId === hrUser.id || p.userId === offUser.id));
  const sBefore = await db.companySettings.findUnique({ where: { id: "main" }, select: { controlNotifyOwners: true, controlReportEnabled: true, controlReportHour: true } });
  await db.companySettings.upsert({ where: { id: "main" }, update: { controlNotifyOwners: false }, create: { id: "main", controlNotifyOwners: false } });
  check("«mas'ullarga ham» o'chirilsa — faqat direktor", !(await planReport(fake, day)).some((p) => p.userId === cashUser.id));
  await db.companySettings.update({ where: { id: "main" }, data: { controlNotifyOwners: true, controlReportEnabled: true, controlReportHour: 19 } });

  section("7. Yuborish: bir kunda bir marta, soatni kutish");
  const d1 = at("2030-05-11T09:00:00Z"); // Toshkent 14:00
  check("soat 19 dan oldin kuzatuvchi yubormaydi", (await nazoratTick(d1)) === null);
  const manual = await sendControlReport({ manual: true, now: d1 });
  check("qo'lda yuborildi (bot yo'q — rejada bor, yuborilmadi)", manual.noBot === true && manual.planned >= 1, manual);
  const d2 = at("2030-05-11T14:30:00Z"); // Toshkent 19:30
  const auto1 = await nazoratTick(d2);
  check("qo'lda yuborilgan kunda ham 19:30 da avtomatik bir marta ketdi", !!auto1 && !auto1.skipped, auto1);
  check("ikkinchi tik — takror yubormaydi", (await nazoratTick(at("2030-05-11T15:00:00Z"))) === null);
  check("to'g'ridan chaqiruv ham — ALREADY_SENT", (await sendControlReport({ now: at("2030-05-11T16:00:00Z") })).skipped === "ALREADY_SENT");
  await sendControlReport({ manual: true, now: at("2030-05-11T16:30:00Z") });
  check("keyin qo'lda yuborish avtomatik belgini buzmaydi", (await nazoratTick(at("2030-05-11T17:00:00Z"))) === null);
  const rows = await db.controlReport.findMany({ where: { day: tashkentDay(d1) } });
  check("kun uchun bitta yozuv", rows.length === 1 && rows[0]!.manual === false, rows);
  await db.companySettings.update({ where: { id: "main" }, data: { controlReportEnabled: false } });
  check("o'chirilgan bo'lsa yubormaydi", (await nazoratTick(at("2030-05-12T15:00:00Z"))) === null && (await db.controlReport.count({ where: { day: tashkentDay(at("2030-05-12T15:00:00Z")) } })) === 0);

  await db.companySettings.update({ where: { id: "main" }, data: { controlNotifyOwners: sBefore?.controlNotifyOwners ?? true, controlReportEnabled: sBefore?.controlReportEnabled ?? true, controlReportHour: sBefore?.controlReportHour ?? 19 } });
  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
