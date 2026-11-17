/**
 * Takror mijozlarni birlashtirish (bir martalik tozalash, 2026-11-17: «Kirpichniy dom» 3 ta karta bo'lib qolgan).
 * Takror — nom kaliti bir xil (`lib/customer-name.ts → customerNameKey`: kirill/lotin, katta-kichik harf, bo'shliq va
 * belgilarsiz). Birlashtirish qoidasi mijoz kartasidagi «Birlashtirish» bilan bitta — `lib/customer-merge.ts`
 * (zayavka, schyot, to'lov, realizatsiya, kassa, qarz o'tkazmasi, boshlang'ich qoldiq — hammasi asosiy kartaga).
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/mijoz-takrorlar.ts                      (barcha takror guruhlar, faqat ro'yxat)
 *   ... scripts/mijoz-takrorlar.ts --q "kirpichniy dom"                                                  (nomida shu bor kartalar — bitta guruh)
 *   ... scripts/mijoz-takrorlar.ts --q "kirpichniy dom" --asosiy <id>                                    (qaysi karta qolishini o'zingiz tanlang)
 *   ... --yes                                                                                            (birlashtirish)
 *
 * Asosiy karta (qoladigani): `--asosiy` berilmasa — faoli, hujjati ko'pi, eng eskisi. Qolganlari unga qo'shiladi va o'chadi
 * (nomlari asosiy kartaning «boshqa nomlari»ga o'tadi). Qaytarib bo'lmaydi — oldin pg_dump zaxira oling.
 */
import { loadEnv } from "./env";
loadEnv();

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const { db } = await import("@/lib/db");
  const { customerNameKey } = await import("@/lib/customer-name");
  const { customerMergePreview, mergeCustomers } = await import("@/lib/customer-merge");
  const { customerBalance } = await import("@/lib/receivables");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");
  const q = arg("--q"), forced = arg("--asosiy");

  const all = await db.customer.findMany({ where: { isInternal: false }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, isActive: true, createdAt: true, inn: true } });
  const groups = new Map<string, typeof all>();
  if (q) {
    const k = customerNameKey(q);
    if (!k) throw new Error("--q bo'sh");
    const hit = all.filter((c) => customerNameKey(c.name).includes(k));
    if (hit.length) groups.set(k, hit);
  } else {
    for (const c of all) { const k = customerNameKey(c.name); if (!k) continue; groups.set(k, [...(groups.get(k) ?? []), c]); }
    for (const [k, l] of groups) if (l.length < 2) groups.delete(k);
  }

  const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  console.log(`Baza: ${dbLabel()}. ${q ? `«${q}» bo'yicha` : "Takror nomli"} guruh: ${groups.size}\n`);
  type Plan = { target: string; targetName: string; sources: { id: string; name: string }[] };
  const plans: Plan[] = [];
  for (const list of groups.values()) {
    const info = await Promise.all(list.map(async (c) => {
      const docs = await Promise.all([
        db.order.count({ where: { customerId: c.id } }), db.invoice.count({ where: { customerId: c.id } }),
        db.realizationEntry.count({ where: { customerId: c.id } }), db.cashTransaction.count({ where: { customerId: c.id } }),
        db.payment.count({ where: { customerId: c.id } }), db.openingBalance.count({ where: { customerId: c.id, cancelledAt: null } }),
      ]);
      return { ...c, docs: docs.reduce((a, b) => a + b, 0), parts: docs, balance: (await customerBalance(c.id)).balance };
    }));
    const target = forced ? info.find((c) => c.id === forced) : [...info].sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.docs - a.docs || a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!target) { console.log(`--asosiy ${forced} shu guruhda yo'q — o'tkazib yuborildi`); continue; }
    for (const c of info) {
      const [o, inv, re, cash, pay, ob] = c.parts;
      console.log(`  ${c.id === target.id ? "QOLADI  " : "qo'shiladi"} ${c.id}  «${c.name}»${c.isActive ? "" : " (nofaol)"}${c.inn ? ` INN ${c.inn}` : ""}  ${c.createdAt.toISOString().slice(0, 10)}`
        + `  zayavka ${o}, schyot ${inv}, realizatsiya ${re}, kassa ${cash}, to'lov ${pay}, qoldiq ${ob}; qarz ${fmt(c.balance)}`);
    }
    const sum = info.reduce((a, c) => a + c.balance, 0);
    console.log(`  → birlashgandan keyin «${target.name}» qarzi ${fmt(sum)} (alohida qarzlar yig'indisi)\n`);
    const sources = info.filter((c) => c.id !== target.id).map((c) => ({ id: c.id, name: c.name }));
    if (sources.length) plans.push({ target: target.id, targetName: target.name, sources });
  }
  if (!plans.length) return;

  // Oldindan tekshiruv (INN farqi, bir kunga ikki boshlang'ich qoldiq) — xato bo'lsa nima to'sayotgani ko'rinadi
  for (const p of plans) for (const s of p.sources) {
    const pre = await customerMergePreview(s.id, p.target);
    if (!pre.ok) console.log(`  ! «${s.name}» → «${p.targetName}»: ${pre.error}`);
  }
  if (!confirmed) { console.log("\nBirlashtirish uchun --yes bilan qayta ishga tushiring."); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — AuditLog uchun foydalanuvchi kerak");
  let ok = 0, bad = 0;
  for (const p of plans) for (const s of p.sources) {
    const r = await mergeCustomers(s.id, p.target, "Takror mijoz (bir xil nom) — scripts/mijoz-takrorlar.ts", director.id);
    if (r.ok) { ok++; console.log(`✓ ${r.note}`); } else { bad++; console.log(`✗ «${s.name}» → «${p.targetName}»: ${r.error}`); }
  }
  console.log(`\nBirlashtirildi: ${ok}${bad ? `, birlashtirilmadi: ${bad}` : ""}.`);
}

main().then(() => setTimeout(() => process.exit(0), 1500)).catch((e) => { console.error(e); process.exit(1); });
