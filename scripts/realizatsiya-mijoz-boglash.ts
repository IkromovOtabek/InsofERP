/**
 * Realizatsiyaning mijozga bog'lanmagan qo'lda/Excel qatorlarini mijozga bog'lash — bir martalik (Otabek, 2026-11-17).
 * 2026-11-12 gacha import ro'yxatda yo'q xaridorni mijozlarga qo'shmagan; qo'lda qator esa hech qachon qo'shmagan.
 * Endi barcha realizatsiya qatorlari debitorkaga «Sotib olgan» bo'lib tushadi (`lib/debt-sales.ts`) — faqat mijozga
 * bog'langanlari. Skript nomi (yoki aliasi) mos mijozga bog'laydi, yo'q bo'lsa mijoz ochadi (`linkEntriesIn`).
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/realizatsiya-mijoz-boglash.ts          (faqat hisobot)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/realizatsiya-mijoz-boglash.ts --yes    (yozish)
 *
 * Keyin kassa yozuvlari uchun: `scripts/kontragent-boglash.ts` (yangi ochilgan mijozlarga ham bog'lanadi).
 * Oldin pg_dump zaxira oling. Har o'zgarish AuditLog'da.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { db } = await import("@/lib/db");
  const { linkEntriesIn } = await import("@/lib/realization-log");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");

  const rows = await db.realizationEntry.findMany({ where: { cancelledAt: null, customerId: null }, select: { customerName: true, qty: true, price: true, delivery: true, vat: true } });
  const names = new Map<string, { n: number; sum: number }>();
  for (const r of rows) {
    const k = r.customerName.trim();
    const x = names.get(k) ?? { n: 0, sum: 0 };
    x.n++; x.sum += Number(r.qty) * Number(r.price) + Number(r.delivery) + Number(r.vat);
    names.set(k, x);
  }
  console.log(`\nBaza: ${dbLabel()}\nMijozga bog'lanmagan realizatsiya qatorlari: ${rows.length} ta, xaridor nomlari: ${names.size} ta`);
  for (const [name, x] of [...names].sort((a, b) => b[1].sum - a[1].sum)) console.log(`  ${name.padEnd(40)} ${String(x.n).padStart(4)} qator  ${Math.round(x.sum).toLocaleString("ru-RU")}`);
  if (!rows.length) return;
  if (!confirmed) { console.log("\nYozilmadi. Yozish uchun: --yes"); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — AuditLog uchun foydalanuvchi kerak");
  const res = await db.$transaction((tx) => linkEntriesIn(tx, director.id), { timeout: 120_000 });
  console.log(`\nBog'landi: ${res.linked} qator. Yangi mijozlar: ${res.newCustomers.length} ta${res.newCustomers.length ? ` — ${res.newCustomers.join(", ")}` : ""}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
