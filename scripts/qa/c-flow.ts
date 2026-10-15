/**
 * QA (C): ma'lumot to'xtab qolmasligi — eslatmalar, marketing tasdig'i, nakladnoy skaneri moslashtirgichi.
 * Kutubxona darajasida (serversiz), faqat insof_test… bazasida.
 *
 *   ENV_FILE=.env.test.example DATABASE_URL=<insof_test…> npx tsx scripts/qa/c-flow.ts
 */
import { check, done, section } from "./c-lib";
import { db } from "@/lib/db";
import { runReminders } from "@/lib/reminders";
import { approveContentLib, rejectContentLib, submitContent } from "@/lib/smm/approval";
import { bestMatch, docNumber } from "@/lib/mobile/scan";

const TAG = `qa-flow-${Date.now()}`;

async function main() {
  const dir = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true } });
  const sales = await db.user.findFirst({ where: { role: "SALES", isActive: true } });
  if (!dir || !sales) { check("test bazasida direktor va sotuvchi bor", false); done(); }
  const actor = { userId: sales!.id, name: sales!.fullName };
  const boss = { userId: dir!.id, name: dir!.fullName };

  section("Eslatmalar");
  // Kechagi kun: eslatmalar haqiqiy vaqt bilan yoziladi — "hozir" o'tmishda bo'lsa takror tekshiruvi to'g'ri ishlaydi
  const noon = new Date(); noon.setDate(noon.getDate() - 1); noon.setHours(12, 0, 0, 0);
  const night = new Date(noon); night.setHours(23, 0, 0, 0);
  const c = await db.lead.create({ data: { name: `${TAG} ariza`, phone: "+998900000001", status: "NEW", createdAt: new Date(noon.getTime() - 5 * 3600_000) } });
  check("tunda eslatma yuborilmaydi", (await runReminders(night)) === 0);
  const before = await db.notification.count({ where: { type: "REMIND_LEAD" } });
  await runReminders(noon);
  const after1 = await db.notification.count({ where: { type: "REMIND_LEAD" } });
  check("2 soatdan eski javobsiz ariza — sotuvga eslatma", after1 > before, { before, after1 });
  await runReminders(new Date(noon.getTime() + 3600_000));
  const after2 = await db.notification.count({ where: { type: "REMIND_LEAD" } });
  check("12 soat ichida qayta yuborilmaydi", after2 === after1, { after1, after2 });
  await db.lead.update({ where: { id: c.id }, data: { status: "IN_PROGRESS" } });
  await db.notification.deleteMany({ where: { type: "REMIND_LEAD", createdAt: { gt: new Date(Date.now() - 600_000) } } });
  await runReminders(noon);
  check("ishga olingan ariza eslatilmaydi", (await db.notification.count({ where: { type: "REMIND_LEAD", body: { contains: TAG } } })) === 0);

  section("Marketing tasdig'i");
  const post = await db.marketingContent.create({ data: { title: `${TAG} post`, type: "POST", channels: ["TELEGRAM"], caption: "QA matn", createdBy: TAG } });
  const s1 = await submitContent(post.id, actor);
  check("tasdiqlashga yuborildi", s1.ok);
  const p1 = await db.marketingContent.findUniqueOrThrow({ where: { id: post.id } });
  check("holat PENDING", p1.approval === "PENDING");
  const stale = new Date(p1.updatedAt.getTime() - 1000);
  const a0 = await approveContentLib(post.id, stale, boss);
  check("eski versiyani tasdiqlab bo'lmaydi", !a0.ok);
  const a1 = await approveContentLib(post.id, p1.updatedAt, boss);
  check("ko'rilgan versiya tasdiqlandi", a1.ok, a1);
  const r1 = await rejectContentLib(post.id, "QA sabab", boss);
  check("tasdiqlangan postni rad etish mumkin (chiqmagan)", r1.ok);
  const empty = await db.marketingContent.create({ data: { title: `${TAG} bo'sh`, type: "POST", channels: [], createdBy: TAG } });
  check("tarmoqsiz post yuborilmaydi", !(await submitContent(empty.id, actor)).ok);

  section("Skaner moslashtirgichi");
  check("48 109 286 → son", docNumber("48 109 286") === 48109286);
  check("4,900 → 4900 (minglik)", docNumber("4,900") === 4900);
  check("23,5 → 23.5 (kasr)", docNumber("23,5") === 23.5);
  const mats = [{ id: "1", name: "Sement M400", code: "SEM400" }, { id: "2", name: "Sement M500", code: "SEM500" }, { id: "6", name: "Armatura 12 mm", code: "ARM12" }];
  check("ruscha nom → lotin nom", bestMatch("Цемент М400", mats)?.id === "1");
  check("boshqa marka tanlanmaydi", bestMatch("Armatura 14 mm", mats) === null);
  check("kod bo'yicha", bestMatch("nimadir", mats, "ARM12")?.id === "6");

  await db.marketingContent.deleteMany({ where: { createdBy: TAG } });
  await db.lead.deleteMany({ where: { name: { startsWith: TAG } } });
  done();
}

main().catch(async (e) => {
  console.error(e);
  await db.marketingContent.deleteMany({ where: { createdBy: TAG } }).catch(() => undefined);
  process.exit(1);
});
