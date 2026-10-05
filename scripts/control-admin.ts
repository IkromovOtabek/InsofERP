/**
 * Markaziy panelning superadmini (IT) — birinchisini shu skript ochadi, keyingilarini panelning o'zida qo'shasiz.
 *   CONTROL_ADMIN_PASSWORD='...' npm run control:admin -- otabek "Otabek Ikromov"
 * Parol argument sifatida berilmaydi (shell tarixiga tushmasin) — env yoki so'rov orqali.
 * Mavjud login berilsa — paroli almashtiriladi va eski sessiyalari kuyadi.
 */
import { createInterface } from "node:readline/promises";
import { loadEnv } from "./env";
// Faqat panel sozlamasi. Ildizdagi `.env` (korxona kalitlari) bu yerda o'qilmaydi.
loadEnv(process.env.CONTROL_ENV_FILE || "control.env");

async function main() {
  const [login, ...nameParts] = process.argv.slice(2);
  if (!login || !/^[a-z0-9._-]{3,40}$/.test(login)) throw new Error('Ishlatish: npm run control:admin -- <login> "F.I.O."');
  let password = process.env.CONTROL_ADMIN_PASSWORD ?? "";
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question("Parol: ");
    rl.close();
  }
  const { passwordProblem } = await import("@/lib/password-policy");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const bcrypt = (await import("bcryptjs")).default;
  const { control } = await import("@/lib/control/db");
  const passwordHash = await bcrypt.hash(password, 10);
  const fullName = nameParts.join(" ").trim() || login;
  const a = await control.superAdmin.upsert({
    where: { login },
    update: { passwordHash, isActive: true, sessionVersion: { increment: 1 }, ...(nameParts.length ? { fullName } : {}) },
    create: { login, fullName, passwordHash },
  });
  await control.controlEvent.create({ data: { adminId: a.id, action: "ADMIN_CREATE", detail: { login, viaScript: true } } });
  console.log(`✓ Superadmin: ${a.login} (${a.fullName}). Panel: /superadmin/login`);
  await control.$disconnect();
}

main().catch((e) => { console.error("✗", e instanceof Error ? e.message : e); process.exit(1); });
