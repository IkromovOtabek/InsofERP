/**
 * Logistika hisobidagi kirim nusxalarini bekor qilish (2026-11-26): zayavka dastavkasi (`TripDelivery`) va Hisob varag'i qatori
 * kirimi (`LedgerEntry`) uchun avtomatik yozilgan `LogisticsTx`. Logistika qoldig'i endi to'g'ridan hisoblanadi
 * (Tushum − Xarajat − Oylik, `lib/logistics-balance.ts`) — nusxalar ikki xil raqam berib chalkashtirardi. Yangi nusxa ochilmaydi
 * (`LOGI_MIRROR = false`). Yozuvlar o'chirilmaydi — bekor qilinadi (AuditLog'da). Tushum, Hisob varag'i, zavod kassasi o'zgarmaydi.
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/logi-nusxa-bekor.ts          (faqat ro'yxat)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/logi-nusxa-bekor.ts --yes    (bekor qilish)
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { db } = await import("@/lib/db");
  const { audit } = await import("@/lib/audit");
  const { DELIVERY_REF, ENTRY_REVENUE_REF } = await import("@/lib/logistics-finance");
  const { dbLabel } = await import("./demo-guard");
  const { money } = await import("@/lib/format");
  const confirmed = process.argv.includes("--yes");

  const rows = await db.logisticsTx.findMany({
    where: { cancelledAt: null, refType: { in: [DELIVERY_REF, ENTRY_REVENUE_REF] } },
    select: { id: true, docNo: true, refType: true, amount: true },
  });
  const sum = (ref: string) => rows.filter((r) => r.refType === ref).reduce((a, r) => a + Number(r.amount), 0);
  console.log(`Baza: ${dbLabel()} · bekor qilinadigan kirim nusxalari: ${rows.length} ta, ${money(rows.reduce((a, r) => a + Number(r.amount), 0))}`);
  console.log(`  zayavka dastavkasi: ${rows.filter((r) => r.refType === DELIVERY_REF).length} ta, ${money(sum(DELIVERY_REF))}`);
  console.log(`  Hisob varag'i qatori kirimi: ${rows.filter((r) => r.refType === ENTRY_REVENUE_REF).length} ta, ${money(sum(ENTRY_REVENUE_REF))}`);
  if (!confirmed) { console.log("\nBekor qilinmadi. Bekor qilish uchun --yes qo'shing."); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi");
  const now = new Date(), reason = "Kirim nusxasi — logistika qoldig'i endi hisoblanadi (Tushum − Xarajat − Oylik)";
  let n = 0;
  for (const r of rows) {
    await db.$transaction(async (tx) => {
      const u = await tx.logisticsTx.updateMany({ where: { id: r.id, cancelledAt: null }, data: { cancelledAt: now, cancelledById: director.id, cancelReason: reason } });
      if (u.count) { n++; await audit(tx, director.id, "STATUS_CHANGE", "LogisticsTx", r.id, { cancelledAt: null }, { cancelledAt: now, docNo: r.docNo, reason }); }
    });
  }
  console.log(`\nTayyor: ${n} ta nusxa bekor qilindi`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
