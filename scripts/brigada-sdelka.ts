/**
 * Brigada a'zolarini «Sdelka» (PIECE) ish haqi turiga o'tkazish — bir martalik tuzatish.
 * Otabek, 2026-11-25: Excel'dagi brigada varag'i (masalan «Илхом») bo'yicha brigada a'zosining oyligi — faqat brigada
 * fondidan ulush (C2026: «Илхом!BQ»), oklad emas. Prodda barcha brigada a'zolari «Oklad» (SALARY) turida edi:
 *   · davomatdan brigada soati faqat sdelkachiga tushadi (`autoBrigadeHours`) → soat yo'q → mahsulot fondi hech kimga
 *     bo'linmaydi (Tabel → brigada: «… fond soat yozilmagan kunlarda — hech kimga tushmadi»);
 *   · oy yakunida oklad + varaq ulushi ikkalasi hisoblanardi.
 *
 *   npx tsx scripts/brigada-sdelka.ts            faqat hisobot (ulanish read-only): kim o'tadi
 *   npx tsx scripts/brigada-sdelka.ts --yes --expect <soni>
 *       yozish (oldin pg_dump!) — bitta tranzaksiyada, har xodim AuditLog'ga (UPDATE Employee, avvalgi turi bilan)
 *
 * Kim: ishdan bo'shamagan, brigadaga biriktirilgan (`Employee.brigadeId`) yoki brigadir (`Brigade.leaderId`) xodim,
 * turi PIECE emas. Tarif stavka o'zgarmaydi (qaytarish oson bo'lsin) — sdelkachida u ishlatilmaydi.
 */
import { join } from "node:path";
import type * as DbMod from "@/lib/db";
import type * as AuditMod from "@/lib/audit";
import type * as EnvMod from "./env";

const ROOT = process.env.INSOF_ROOT || process.cwd();
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
function opt(n: string): string | null {
  const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return null;
  const a = argv[i]!;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : (argv[i + 1] ?? null);
}
function fail(msg: string): never { console.error(`\n${msg}\n`); process.exit(1); }

async function main() {
  const yes = flag("yes");
  const { loadEnv } = (await import(join(ROOT, "scripts/env"))) as typeof EnvMod;
  loadEnv();
  if (!yes && process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    u.searchParams.set("options", "-c default_transaction_read_only=on");
    process.env.DATABASE_URL = u.toString();
  }
  const { db } = (await import(join(ROOT, "src/lib/db"))) as typeof DbMod;
  const { auditMany } = (await import(join(ROOT, "src/lib/audit"))) as typeof AuditMod;
  try {
    const emps = await db.employee.findMany({
      where: { firedAt: null, payType: { not: "PIECE" }, OR: [{ brigadeId: { not: null } }, { brigades: { some: { isActive: true } } }] },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, payType: true, tariffRate: true, brigade: { select: { name: true } }, brigades: { where: { isActive: true }, select: { name: true } } },
    });
    console.log(`\nSdelkaga o'tadi: ${emps.length} xodim`);
    for (const e of emps) console.log(`  ${(e.brigade?.name ?? e.brigades[0]?.name ?? "?").padEnd(12)} ${e.fullName.padEnd(42)} ${e.payType} ${Number(e.tariffRate ?? 0)}`);
    if (!yes) { console.log(`\nYozish: --yes --expect ${emps.length} (oldin pg_dump)\n`); return; }
    const expect = Number(opt("expect"));
    if (expect !== emps.length) fail(`--expect ${emps.length} bo'lishi kerak (hozir ${opt("expect") ?? "berilmagan"})`);
    const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (!director) fail("Faol direktor topilmadi — AuditLog uchun kerak");
    await db.$transaction(async (tx) => {
      const ids = emps.map((e) => e.id);
      const r = await tx.employee.updateMany({ where: { id: { in: ids }, payType: { not: "PIECE" } }, data: { payType: "PIECE" } });
      if (r.count !== emps.length) throw new Error(`Kutilgan ${emps.length}, o'zgardi ${r.count} — bekor qilindi`);
      await auditMany(tx, director.id, "UPDATE", "Employee", emps.map((e) => ({ id: e.id, before: { payType: e.payType }, after: { payType: "PIECE", note: "brigada-sdelka.ts" } })));
    });
    console.log(`\nYozildi: ${emps.length} xodim «Sdelka»ga o'tdi\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
