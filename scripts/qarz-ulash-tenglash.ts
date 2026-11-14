/**
 * Debitorka sotuv va kassaga ulangandan keyin (2026-11-14) — eski qoldiqlarni SANASIDA saqlash (bir martalik, Otabek qarori).
 *
 * Endi mijoz qarziga Realizatsiya reestrining «Qarz» qatorlari va kassadagi qarz to'lovlari ham kiradi (`lib/receivables.ts`).
 * Excel bilan kiritilgan qarz qoldiqlari (boshlang'ich qoldiq yozuvlari, har sanaga bittadan) esa eski qoida bo'yicha
 * tenglangan edi — ularning ustiga reestr qo'shilsa bir sotuv ikki marta hisoblanadi. Skript har mijozning har yozuvini
 * shunday tuzatadi: o'sha kun oxiridagi qoldiq avvalgidek (eski qoidadagidek) qoladi, keyingi kundan tizim o'zi yuritadi.
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/qarz-ulash-tenglash.ts          (faqat hisobot)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/qarz-ulash-tenglash.ts --yes    (yozish)
 *
 * Faqat migratsiya (`*_qarz_kassa_otkazma`) qo'llanishidan OLDIN yaratilgan yozuvlar olinadi — keyin yangi qoida bilan
 * kiritilganlar («Qoldiqni tuzatish», yangi Excel importi) tegilmaydi. Skript tuzatgan yozuv AuditLog'da belgi bilan qoladi —
 * qayta ishga tushirilsa o'tkazib yuboriladi (ikki marta ayirilmaydi). Har mijoz o'z tranzaksiyasida, AuditLog'ga UPDATE.
 * Oldin pg_dump zaxira oling. Deploydan keyin, imkon qadar tezroq ishga tushirilsin.
 */
import { loadEnv } from "./env";
loadEnv();

const r2 = (n: number) => Math.round(n * 100) / 100;
/** AuditLog'dagi belgi — shu skript tuzatgan yozuv */
const MARK = "(qarz-ulash-tenglash)";
const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + 1); return x; };

async function main() {
  const { db } = await import("@/lib/db");
  const { customerBalance } = await import("@/lib/receivables");
  const { cancelOpeningTx, updateOpeningTx, lockOpening, OpeningError } = await import("@/lib/opening-balances");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");

  // Yangi qoida qachon yoqilgan — migratsiya qo'llangan payt; undan keyin yaratilgan yozuv yangi qoidada tenglangan
  const mig = await db.$queryRaw<{ finished_at: Date | null }[]>`SELECT finished_at FROM "_prisma_migrations" WHERE migration_name LIKE '%_qarz_kassa_otkazma' AND finished_at IS NOT NULL ORDER BY finished_at LIMIT 1`;
  const liveAt = mig[0]?.finished_at;
  if (!liveAt) throw new Error("qarz_kassa_otkazma migratsiyasi hali qo'llanmagan — avval deploy (prisma migrate deploy)");
  // Oldingi yugurishda tuzatilganlar — qayta tegilmaydi
  const fixedBefore = new Set((await db.auditLog.findMany({ where: { entity: "OpeningBalance", action: "UPDATE", after: { path: ["reason"], string_contains: MARK } }, select: { entityId: true } })).map((a) => a.entityId));
  const entries = await db.openingBalance.findMany({
    where: { kind: "CUSTOMER", cancelledAt: null, createdAt: { lt: liveAt } },
    orderBy: [{ customerId: "asc" }, { date: "asc" }],
    select: { id: true, customerId: true, date: true, amount: true, note: true, customer: { select: { name: true } } },
  });
  const byCustomer = new Map<string, typeof entries>();
  for (const e of entries) if (e.customerId) byCustomer.set(e.customerId, [...(byCustomer.get(e.customerId) ?? []), e]);
  console.log(`\nBaza: ${dbLabel()}\nYangi qoida yoqilgan: ${liveAt.toISOString()}\nUndan oldingi qoldiq yozuvi bor mijozlar: ${byCustomer.size} ta, yozuvlar: ${entries.length} ta (oldin tuzatilgan: ${fixedBefore.size})`);

  type Fix = { id: string; customerId: string; name: string; date: Date; old: number; next: number };
  const fixes: Fix[] = [];
  for (const [cid, list] of byCustomer) {
    // Har yozuv kuni oxiridagi qoldiq: eski qoida (schyot − to'lov) — saqlanadigan raqam; yangi qoida — reestr va kassa bilan
    const days = list.map((e) => endOfDay(e.date));
    const [legacy, fresh] = await Promise.all([
      Promise.all(days.map((d) => customerBalance(cid, { asOf: d, legacy: true }))),
      Promise.all(days.map((d) => customerBalance(cid, { asOf: d }))),
    ]);
    // Yangi qoidadagi «boshqa harakat» (yozuvlarsiz) = yangi balans − shu kungacha yozuvlar (joriy summalar bilan)
    const sumBefore = (end: Date, amounts: Map<string, number>) => list.reduce((s, e) => (e.date < end ? s + (amounts.get(e.id) ?? Number(e.amount)) : s), 0);
    const cur = new Map(list.map((e) => [e.id, Number(e.amount)]));
    const next = new Map<string, number>();
    list.forEach((e, i) => {
      const other = fresh[i]!.balance - sumBefore(days[i]!, cur);
      const prior = list.slice(0, i).reduce((s, x) => (x.date < days[i]! ? s + (next.get(x.id) ?? Number(x.amount)) : s), 0);
      const need = r2(legacy[i]!.balance - other - prior);
      next.set(e.id, need);
      if (fixedBefore.has(e.id)) { next.set(e.id, Number(e.amount)); return; }
      if (Math.abs(need - Number(e.amount)) >= 0.005) fixes.push({ id: e.id, customerId: cid, name: e.customer?.name ?? "—", date: e.date, old: Number(e.amount), next: need });
    });
  }

  if (!fixes.length) { console.log("\nTuzatish kerak emas — barcha qoldiqlar sanasida to'g'ri.\n"); return; }
  const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ");
  console.log(`\nTuzatiladigan yozuvlar: ${fixes.length} ta (${new Set(fixes.map((f) => f.customerId)).size} ta mijoz)`);
  for (const f of fixes) console.log(`  ${f.date.toISOString().slice(0, 10)}  ${f.name.padEnd(40).slice(0, 40)}  ${fmt(f.old).padStart(16)} → ${fmt(f.next).padStart(16)}${Math.abs(f.next) < 0.005 ? "  (bekor qilinadi)" : ""}`);
  if (!confirmed) { console.log("\nFaqat hisobot. Yozish uchun: --yes\n"); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — audit kimga yozilishini bilmaymiz");
  const failed: string[] = [];
  let done = 0;
  for (const cid of new Set(fixes.map((f) => f.customerId))) {
    const mine = fixes.filter((f) => f.customerId === cid);
    try {
      await db.$transaction(async (tx) => {
        await lockOpening(tx, { kind: "CUSTOMER", customerId: cid });
        for (const f of mine) {
          const why = `Debitorka reestr/kassaga ulandi: shu kun qoldig'i saqlandi ${MARK}`;
          if (Math.abs(f.next) < 0.005) await cancelOpeningTx(tx, f.id, why, director.id);
          else await updateOpeningTx(tx, f.id, (o) => ({ date: o.date, amount: f.next, note: o.note, reason: why }), director.id);
        }
      }, { timeout: 60_000 });
      done += mine.length;
    } catch (e) {
      failed.push(`${mine[0]!.name}: ${e instanceof OpeningError ? e.message : (e as Error).message}`);
    }
  }
  console.log(`\nTuzatildi: ${done} ta yozuv`);
  if (failed.length) console.log(`Tuzatilmadi:\n  ${failed.join("\n  ")}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
