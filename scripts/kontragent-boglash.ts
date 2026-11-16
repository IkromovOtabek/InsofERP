/**
 * Kassa yozuvlarini Kontragent nomi bo'yicha mijoz / yetkazuvchiga bog'lash — bir martalik tozalash.
 * Kirim-Chiqimda «Mijoz qarziga» / «Yetkazuvchi» tanlanmay, faqat «Kimdan / Kimga» matni yozilgan yozuvlar qarzga
 * tushmagan (debitorka — `lib/receivables.ts`, kreditorka — `fin-report/balance.ts` faqat id bo'yicha hisoblaydi).
 * Qoida importdagi bilan bir xil — `lib/counterparty-link.ts` (nom yoki alias aniq mos kelsa; noaniq nom — tegilmaydi).
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/kontragent-boglash.ts          (faqat ro'yxat)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/kontragent-boglash.ts --yes    (yozish)
 *   ... --batafsil   — har yozuvni chiqarish
 *
 * Tegilmaydi: bekor qilingan, hujjatga bog'langan (refType), o'tkazma, xodim/brigada/komanda, loyiha, kredit,
 * boshlang'ich qoldiq va asosiy vosita yozuvlari. Har o'zgarish AuditLog'ga UPDATE bo'lib yoziladi. Oldin pg_dump zaxira oling.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { db } = await import("@/lib/db");
  const { auditMany } = await import("@/lib/audit");
  const { loadPartyIndex, autoLink } = await import("@/lib/counterparty-link");
  const { loadCategories, makeResolver } = await import("@/lib/fin-report/categories");
  const { PEREKIT_CATEGORY } = await import("@/lib/cash-categories");
  const { payablesSince } = await import("@/lib/receipt-payables");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");
  const verbose = process.argv.includes("--batafsil");

  const [idx, cats, since] = await Promise.all([loadPartyIndex(), loadCategories(), payablesSince()]);
  const resolve = makeResolver(cats);
  const txs = await db.cashTransaction.findMany({
    where: {
      cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, customerId: null, supplierId: null, refType: null,
      employeeId: null, brigadeId: null, teamId: null, projectId: null, loanId: null, counterparty: { not: null },
      category: { not: PEREKIT_CATEGORY }, opening: { is: null }, fixedAsset: { is: null },
    },
    orderBy: { date: "asc" },
  });

  type Hit = { tx: (typeof txs)[number]; customerId?: string; supplierId?: string };
  const hits: Hit[] = [];
  for (const t of txs) {
    const refund = resolve(t.category, t.subCategory)?.top.pnlLine === "CUSTOMER_REFUND";
    const a = autoLink(idx, { type: t.type as "INCOME" | "EXPENSE", counterparty: t.counterparty, category: t.category, refund });
    if (a) hits.push({ tx: t, ...a });
  }

  const names = new Map<string, string>();
  for (const m of [idx.customers, idx.suppliers]) for (const p of m.values()) if (p) names.set(p.id, p.name);
  const groups = new Map<string, { label: string; n: number; inc: number; exp: number; old: number }>();
  for (const h of hits) {
    const id = h.customerId ?? h.supplierId!;
    const g = groups.get(id) ?? { label: `${h.customerId ? "Mijoz" : "Yetkazuvchi"}: ${names.get(id)}`, n: 0, inc: 0, exp: 0, old: 0 };
    g.n++;
    if (h.tx.type === "INCOME") g.inc += Number(h.tx.amount); else g.exp += Number(h.tx.amount);
    if (h.supplierId && h.tx.date < since) g.old++;
    groups.set(id, g);
    if (verbose) console.log(`  ${h.tx.date.toISOString().slice(0, 10)}  ${h.tx.type === "INCOME" ? "+" : "-"}${Number(h.tx.amount).toFixed(2)}  ${h.tx.category}  «${h.tx.counterparty}» → ${g.label}`);
  }
  const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  console.log(`Baza: ${dbLabel()}. Bog'lanmagan kontragentli yozuv: ${txs.length}, nomi mos kelgani: ${hits.length}\n`);
  for (const g of [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))) {
    console.log(`${g.label} — ${g.n} ta, kirim ${fmt(g.inc)}, chiqim ${fmt(g.exp)}${g.old ? ` (${g.old} tasi ${since.toISOString().slice(0, 10)} dan oldin — kreditorkaga kirmaydi)` : ""}`);
  }
  if (!hits.length) return;
  if (!confirmed) { console.log("\nYozish uchun --yes bilan qayta ishga tushiring."); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — AuditLog uchun foydalanuvchi kerak");
  let done = 0;
  for (let i = 0; i < hits.length; i += 200) {
    const part = hits.slice(i, i + 200);
    done += await db.$transaction(async (tx) => {
      let n = 0;
      const changed: { id: string; before: unknown; after: unknown }[] = [];
      for (const h of part) {
        // Shartli yangilash: oraliqda kimdir qo'lda bog'lagan bo'lsa — tegilmaydi
        const r = await tx.cashTransaction.updateMany({
          where: { id: h.tx.id, customerId: null, supplierId: null, cancelledAt: null },
          data: { customerId: h.customerId ?? null, supplierId: h.supplierId ?? null },
        });
        if (r.count) {
          n++;
          changed.push({ id: h.tx.id, before: { customerId: null, supplierId: null }, after: { customerId: h.customerId ?? null, supplierId: h.supplierId ?? null, via: "kontragent-boglash" } });
        }
      }
      await auditMany(tx, director.id, "UPDATE", "CashTransaction", changed);
      return n;
    }, { timeout: 60_000 });
  }
  console.log(`\nYozildi: ${done} ta yozuv bog'landi.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
