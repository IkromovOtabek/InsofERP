/**
 * Har bir lavozim (rol) uchun sun'iy test xodimi: login + parol + xodim kartasi (telefon bilan).
 * Faqat lokal sinov uchun — production'da ishlamaydi.
 *
 *   npm run db:test-users            → yaratadi / parolini qayta tiklaydi (qayta ishga tushirsa bo'ladi)
 *   npm run db:test-users -- --remove → hammasini o'chiradi (tarixi bo'lsa — faqat bloklaydi)
 *
 * Loginlar `test.<bo'lim>` ko'rinishida, parol hammasiga bitta: TEST_PASSWORD.
 * Telefonlar +998 90 900 00 XX — boshqa xodimlarnikiga to'qnashmaydi, parol tiklash (Telegram bot) sinovida ham ishlatsa bo'ladi.
 */
import bcrypt from "bcryptjs";
import { PrismaClient, type Role } from "../src/generated/prisma";
import { guardDemo } from "./demo-guard";

// Faqat lokal test bazasi (insof_test…) yoki ALLOW_DEMO=yes-i-know
guardDemo("scripts/test-users.ts");
const db = new PrismaClient();
const TEST_PASSWORD = "Test2026";
const NOTE = "Sun'iy test xodimi (scripts/test-users.ts)";
const BRIGADE_NAME = "Test brigada (sinov)";

const USERS: { login: string; role: Role; fullName: string; position: string }[] = [
  { login: "test.direktor",  role: "DIRECTOR",    fullName: "Test Direktor",         position: "Direktor" },
  { login: "test.sotuv",     role: "SALES",       fullName: "Test Sotuvchi",         position: "Sotuv" },
  { login: "test.ishlab",    role: "PRODUCTION",  fullName: "Test Ishlab chiqarish", position: "Ishlab chiqarish" },
  { login: "test.prorab",    role: "SUPERVISOR",  fullName: "Test Ish boshqaruvchi", position: "Ish boshqaruvchi" },
  { login: "test.logistika", role: "LOGISTICS",   fullName: "Test Logist",           position: "Logistika" },
  { login: "test.sklad",     role: "WAREHOUSE",   fullName: "Test Skladchi",         position: "Sklad" },
  { login: "test.snab",      role: "PROCUREMENT", fullName: "Test Snabjeniye",       position: "Snabjeniye" },
  { login: "test.buh",       role: "ACCOUNTING",  fullName: "Test Buxgalter",        position: "Buxgalteriya" },
  { login: "test.finance",   role: "FINANCE",     fullName: "Test Finance",          position: "Finance" },
  { login: "test.kadr",      role: "HR",          fullName: "Test Otdel kadr",       position: "Otdel kadr" },
  { login: "test.kassa",     role: "CASHIER",     fullName: "Test Kassir",           position: "Kassa / bank" },
  { login: "test.haydovchi", role: "DRIVER",      fullName: "Test Haydovchi",        position: "Haydovchi" },
  { login: "test.brigadir",  role: "BRIGADIER",   fullName: "Test Brigadir",         position: "Brigadir" },
  { login: "test.mexanik",   role: "MECHANIC",    fullName: "Test Mexanik",          position: "Mexanik" },
];

const phoneOf = (i: number) => `+9989090000${String(i + 1).padStart(2, "0")}`;

async function create() {
  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  const mixer = await db.vehicle.findFirst({ where: { type: "MIXER" }, orderBy: { plate: "asc" } });

  for (const [i, u] of USERS.entries()) {
    const user = await db.user.upsert({
      where: { login: u.login },
      create: { login: u.login, passwordHash: hash, fullName: u.fullName, role: u.role },
      // Parol va rol har safar qayta o'rnatiladi; sessionVersion oshadi — eski kirishlar kuyadi.
      update: { passwordHash: hash, fullName: u.fullName, role: u.role, isActive: true, sessionVersion: { increment: 1 } },
    });
    const data = {
      fullName: u.fullName, position: u.position, phone: phoneOf(i), isActive: true, firedAt: null, note: NOTE,
      vehicleId: u.role === "DRIVER" ? mixer?.id ?? null : undefined,
    };
    const emp = await db.employee.upsert({ where: { userId: user.id }, create: { ...data, userId: user.id }, update: data });

    if (u.role === "BRIGADIER") {
      const b = await db.brigade.findFirst({ where: { name: BRIGADE_NAME } });
      if (b) await db.brigade.update({ where: { id: b.id }, data: { leaderId: emp.id, phone: emp.phone, isActive: true } });
      else await db.brigade.create({ data: { name: BRIGADE_NAME, leaderId: emp.id, phone: emp.phone, note: NOTE } });
    }
  }

  console.log(`\nParol (hammasiga): ${TEST_PASSWORD}\n`);
  console.table(USERS.map((u, i) => ({ login: u.login, rol: u.role, lavozim: u.position, telefon: phoneOf(i) })));
}

async function remove() {
  await db.brigade.updateMany({ where: { name: BRIGADE_NAME }, data: { leaderId: null } });
  await db.brigade.deleteMany({ where: { name: BRIGADE_NAME, items: { none: {} }, tasks: { none: {} } } }).catch(() => undefined);
  for (const u of USERS) {
    const user = await db.user.findUnique({ where: { login: u.login } });
    if (!user) continue;
    try {
      // Xodim bolalari (davomat, hujjatlar) endi Restrict — avval ular o'chiriladi, keyin xodim va login
      const emp = { employee: { userId: user.id } };
      await db.$transaction([
        db.attendance.deleteMany({ where: emp }),
        db.employeeDocument.deleteMany({ where: emp }),
        db.hrDocument.deleteMany({ where: emp }),
        db.employee.deleteMany({ where: { userId: user.id } }),
        db.user.delete({ where: { id: user.id } }),
      ]);
      console.log("o'chirildi:", u.login);
    } catch {
      // Sinov paytida hujjat/yozuv qoldirgan bo'lsa — bog'lanishlar buzilmasin, faqat bloklanadi.
      await db.user.update({ where: { id: user.id }, data: { isActive: false, sessionVersion: { increment: 1 } } });
      await db.employee.updateMany({ where: { userId: user.id }, data: { isActive: false } });
      console.log("bloklandi (tarixi bor):", u.login);
    }
  }
}

(async () => {
  await (process.argv.includes("--remove") ? remove() : create());
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
