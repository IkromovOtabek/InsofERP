/**
 * Moliya manbalarini bir martalik tozalash — Sarvar rejasi 1.2 (2026-11-24). Prod diagnostikasi:
 *  · kassa importi noma'lum manbalarni o'zi ochgan va PNL qatorini taxmin qilgan: kirim → «Boshqa tushum» (Daromadga),
 *    chiqim → «Ishlab chiqarish». «Pul yechib berish» 546 mln daromadga, «Nazira Servis» 480 mln va «Sotib oluvchi puli
 *    qaytarildi» 204 mln ishlab chiqarish xarajatiga tushgan;
 *  · «Kredit foizi» manbasida «kredit va kredit foizi» aliasi bor — qo'shma yozuv (asosiy qarz + foiz) butunligicha foizga
 *    (PNL xarajatiga) tushardi.
 * Nima qiladi:
 *  A. import ochgan (sort 500, tizimniki emas) va PNL qatori hali o'sha taxminligicha turgan (hech kim tahrirlamagan) manbalar →
 *     «Aniqlanmagan» (UNSORTED): PNL'da «Manbasi aniqlanmagan pul» qatorida ko'rinadi, buxgalter Moliya → Kategoriyalar'da
 *     to'g'ri qatorni tanlaydi. Nomi «qaytar…» bo'lgan mijoz puli qaytarish manbasi — darhol «Sotib oluvchi pulini qaytarish».
 *  B. «Kredit foizi» dan qo'shma aliaslar olinadi (keyingi importda bunday yozuv «Aniqlanmagan» bo'lib keladi).
 *  C. Faqat hisobot: Sim izdelni kabi kg narxi shubhali (bir xil materialning o'rtacha narxidan 20 baravar katta) kirimlar
 *     va «Qarz berildi» ning katta yozuvlari — buxgalter tekshirishi uchun (bazaga tegmaydi).
 * Bitta tranzaksiya; `--yes` bo'lmasa oxirida bekor qilinadi. AuditLog — birinchi faol direktor nomidan, via «moliya-tozalash».
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/moliya-tozalash.ts          (faqat ko'rish)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/moliya-tozalash.ts --yes    (yozish)
 */
import { loadEnv } from "./env";
loadEnv();

class DryRun extends Error {}

async function main() {
  const { db } = await import("@/lib/db");
  const { audit } = await import("@/lib/audit");
  const { dbLabel } = await import("./demo-guard");
  const { fmtNum } = await import("@/lib/format");
  const confirmed = process.argv.includes("--yes");
  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — audit kimga yozilishini bilmaymiz");
  const userId = director.id, via = "moliya-tozalash";
  const log: string[] = [];
  const say = (s: string) => log.push(s);
  const since = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1);

  try {
    await db.$transaction(async (tx) => {
      // ── A. Import ochgan manbalar ──
      say("A. Import ochgan manbalar (PNL qatori taxmin bo'yicha qolgan)");
      const auto = await tx.cashCategory.findMany({ where: { isSystem: false, sort: 500, parentId: null } });
      // Faqat PNL qatori o'zgartirilgan tahrirlar hisobga olinadi (nomni lotinga o'girish / birlashtirish — emas)
      const edited = new Set((await tx.auditLog.findMany({ where: { entity: "CashCategory", action: "UPDATE", entityId: { in: auto.map((c) => c.id) } }, select: { entityId: true, before: true, after: true } }))
        .filter((a) => JSON.stringify(a.before ?? {}).includes("pnlLine") || JSON.stringify(a.after ?? {}).includes("pnlLine")).map((a) => a.entityId));
      for (const c of auto) {
        const guessed = c.type === "INCOME" ? c.pnlLine === "OTHER_INCOME" : c.pnlLine === "PRODUCTION";
        if (!guessed) { say(`  tegilmadi «${c.name}» — PNL qatori qo'lda tanlangan (${c.pnlLine})`); continue; }
        if (edited.has(c.id)) { say(`  tegilmadi «${c.name}» — PNL qatorini kimdir o'zgartirgan (AuditLog)`); continue; }
        // Ma'nosi nomidan aniq bo'lganlari — to'g'ri qatorga; qolgani (o'tkazma, qarz, hisob-kitob…) — «Aniqlanmagan»
        const refund = c.type === "EXPENSE" && /qaytar/i.test(c.name) && /(sotib\s*oluvchi|mijoz|xaridor|klient)/i.test(c.name);
        const commercial = c.type === "EXPENSE" && /(sotuv\s*xarajat|ortakash|urtakash|o'rtakash|vositachi)/i.test(c.name);
        const production = c.type === "EXPENSE" && /^(zavod|pb\s*sex|sex\b|ishlab\s*chiqarish)/i.test(c.name);
        if (production) { say(`  tegilmadi «${c.name}» — nomidan ishlab chiqarish xarajati (PRODUCTION qoladi)`); continue; }
        const pnlLine = refund ? "CUSTOMER_REFUND" : commercial ? "COMMERCIAL" : "UNSORTED";
        const sum = await tx.cashTransaction.aggregate({ where: { category: c.name, cancelledAt: null, date: { gte: since } }, _sum: { amount: true }, _count: { _all: true } });
        await tx.cashCategory.update({ where: { id: c.id }, data: { pnlLine } });
        await audit(tx, userId, "UPDATE", "CashCategory", c.id, { pnlLine: c.pnlLine }, { pnlLine, via });
        say(`  «${c.name}» (${c.type === "INCOME" ? "kirim" : "chiqim"}): ${c.pnlLine} → ${pnlLine}  — so'nggi 3 oyda ${sum._count._all} yozuv, ${fmtNum(Number(sum._sum.amount ?? 0))} so'm`);
      }

      // ── B. «Kredit foizi» qo'shma aliaslari ──
      say("B. «Kredit foizi» manbasidan qo'shma aliaslar");
      for (const c of await tx.cashCategory.findMany({ where: { pnlLine: "INTEREST" } })) {
        const keep = c.aliases.filter((a) => !/(kredit|kridit)\s+va\s+(kredit|kridit)/i.test(a));
        if (keep.length === c.aliases.length) continue;
        await tx.cashCategory.update({ where: { id: c.id }, data: { aliases: keep } });
        await audit(tx, userId, "UPDATE", "CashCategory", c.id, { aliases: c.aliases }, { aliases: keep, via });
        say(`  «${c.name}»: olib tashlandi — ${c.aliases.filter((a) => !keep.includes(a)).join(", ")}`);
      }

      // ── C. Faqat hisobot ──
      say("C. Tekshirish uchun (bazaga tegilmaydi)");
      const moves = await tx.stockMove.findMany({
        where: { materialId: { not: null }, unitCost: { not: null }, qty: { gt: 0 }, date: { gte: since } },
        select: { date: true, qty: true, unitCost: true, material: { select: { id: true, name: true, unit: true } } },
      });
      const byMat = new Map<string, { name: string; unit: string; rows: { date: Date; qty: number; cost: number }[] }>();
      for (const m of moves) {
        const x = byMat.get(m.material!.id) ?? { name: m.material!.name, unit: m.material!.unit, rows: [] };
        x.rows.push({ date: m.date, qty: Number(m.qty), cost: Number(m.unitCost) });
        byMat.set(m.material!.id, x);
      }
      for (const x of byMat.values()) {
        const costs = x.rows.map((r) => r.cost).sort((a, b) => a - b);
        const median = costs[Math.floor(costs.length / 2)];
        for (const r of x.rows) if (median > 0 && costs.length > 1 && r.cost > median * 20) say(`  shubhali narx: «${x.name}» ${r.date.toISOString().slice(0, 10)} — ${fmtNum(r.qty, 3)} ${x.unit} × ${fmtNum(r.cost)} (odatda ${fmtNum(median)})`);
        if (/sim\s*izdel/i.test(x.name)) for (const r of x.rows) say(`  Sim izdelni kirimi: ${r.date.toISOString().slice(0, 10)} — ${fmtNum(r.qty, 3)} ${x.unit} × ${fmtNum(r.cost)} = ${fmtNum(r.qty * r.cost)}`);
      }
      const loans = await tx.cashTransaction.findMany({ where: { category: "Qarz berildi", cancelledAt: null, date: { gte: since }, amount: { gte: 100_000_000 } }, orderBy: { amount: "desc" }, take: 15, select: { date: true, amount: true, counterparty: true, note: true, cashAccount: { select: { name: true } } } });
      for (const l of loans) say(`  «Qarz berildi»: ${l.date.toISOString().slice(0, 10)} ${l.cashAccount.name} — ${fmtNum(Number(l.amount))} · ${l.counterparty ?? "—"} · ${l.note ?? ""}`);

      if (!confirmed) throw new DryRun();
    }, { timeout: 120_000, maxWait: 20_000 });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  console.log(`\nBaza: ${dbLabel()}\n${log.join("\n")}`);
  console.log(confirmed ? "\nYOZILDI.\n" : "\nFaqat ko'rish — hech narsa yozilmadi. Yozish uchun: --yes\n");
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
