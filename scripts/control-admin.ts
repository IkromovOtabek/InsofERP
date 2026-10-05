/**
 * Markaziy panelning superadmini (IT) — birinchisini shu skript ochadi, keyingilarini panelning o'zida qo'shasiz.
 *   CONTROL_ADMIN_PASSWORD='...' npm run control:admin -- otabek "Otabek Ikromov"
 * Parol argument sifatida berilmaydi (shell tarixiga tushmasin) — env yoki so'rov orqali.
 * Mavjud login berilsa — paroli almashtiriladi va eski sessiyalari kuyadi.
 */
import { loadEnv } from "./env";
// Faqat panel sozlamasi. Ildizdagi `.env` (korxona kalitlari) bu yerda o'qilmaydi.
loadEnv(process.env.CONTROL_ENV_FILE || "control.env");

/** Parolni ekranda ko'rsatmasdan so'rash (terminal raw rejimi; belgi o'rniga hech narsa chiqmaydi). */
function askHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("Terminal yo'q — parolni CONTROL_ADMIN_PASSWORD orqali bering");
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let buf = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (fn: () => void) => { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n"); fn(); };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(buf));
        if (ch === "\u0003") return done(() => reject(new Error("Bekor qilindi")));   // Ctrl+C
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);                   // Backspace
        else if (ch >= " ") buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const [login, ...nameParts] = process.argv.slice(2);
  if (!login || !/^[a-z0-9._-]{3,40}$/.test(login)) throw new Error('Ishlatish: npm run control:admin -- <login> "F.I.O."');
  let password = process.env.CONTROL_ADMIN_PASSWORD ?? "";
  if (!password) {
    password = await askHidden("Parol (ekranda ko'rinmaydi): ");
    if ((await askHidden("Parolni takrorlang: ")) !== password) throw new Error("Parollar mos kelmadi");
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
