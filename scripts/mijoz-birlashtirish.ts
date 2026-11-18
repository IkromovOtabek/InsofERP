/**
 * Turli yozilgan bir mijozni bitta kartaga birlashtirish va kerakli nomga o'tkazish (bir martalik tozalash).
 * `mijoz-takrorlar.ts` faqat bir xil nom kalitini topadi — bu yerda juftlar aniq beriladi: «Orion Prom Tex» + «Orion Prom Tech»
 * → «Orion Prom Tex Servis». Birlashtirish qoidasi mijoz kartasidagi «Birlashtirish» bilan bitta (`lib/customer-merge.ts`):
 * zayavka, schyot, to'lov, realizatsiya, kassa, qarz o'tkazmasi, boshlang'ich qoldiq — hammasi qoladigan kartaga,
 * qo'shilgan kartalarning nomi «boshqa nomlar»ga o'tadi. Keyin qoladigan karta yakuniy nomga o'tkaziladi (eski nomi ham
 * «boshqa nomlar»da qoladi). Kartalar nom kaliti bo'yicha topiladi (`customerNameKey`: katta-kichik harf, bo'shliq, apostrof farqsiz).
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/mijoz-birlashtirish.ts          (reja, hech narsa o'zgarmaydi)
 *   ... scripts/mijoz-birlashtirish.ts --yes                                                       (birlashtirish va nomni o'zgartirish)
 *
 * Qoladigan karta: yakuniy nomli karta bo'lsa — o'sha; aks holda faoli, hujjati ko'pi, eng eskisi.
 * Qaytarib bo'lmaydi — oldin pg_dump zaxira oling.
 */
import { loadEnv } from "./env";
loadEnv();

/** 2026-11-18 so'rovi: [birlashtiriladigan nomlar, yakuniy nom] */
const JOBS: [string[], string][] = [
  [["Orion Prom Tex", "Orion Prom Tech"], "Orion Prom Tex Servis"],
  [["Smart Class", "Smart Slass"], "Smart Class"],
  [["Suvmaxsusta'mir", "Suv Maxsus Ta'mir"], "SuvmaxsustaMir"],
  [["Urtovul Log", "Ortaovul Log"], "Ortaovul Log"],
  [["Zamin Star City", "Zamin Star Siti"], "Zamin Star Siti"],
];

const REASON = "Bir mijoz turli yozilgan — scripts/mijoz-birlashtirish.ts";

async function main() {
  const { db } = await import("@/lib/db");
  const { audit } = await import("@/lib/audit");
  const { customerNameKey } = await import("@/lib/customer-name");
  const { cleanAliases } = await import("@/lib/customer-admin");
  const { customerMergePreview, mergeCustomers } = await import("@/lib/customer-merge");
  const { customerBalance } = await import("@/lib/receivables");
  const { syncCustomerLater } = await import("@/lib/eco/customers");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");

  const all = await db.customer.findMany({ where: { isInternal: false }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, aliases: true, isActive: true, createdAt: true, inn: true } });
  const suppliers = await db.supplier.findMany({ select: { id: true, name: true } });
  const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  console.log(`Baza: ${dbLabel()}\n`);

  type Plan = { label: string; target: { id: string; name: string }; finalName: string; sources: { id: string; name: string }[] };
  const plans: Plan[] = [];
  let problems = 0;
  for (const [names, finalName] of JOBS) {
    const keys = new Set([...names, finalName].map(customerNameKey));
    const label = `${names.map((n) => `«${n}»`).join(" + ")} → «${finalName}»`;
    console.log(label);
    const hit = all.filter((c) => keys.has(customerNameKey(c.name)));
    // Nomi boshqa, lekin «boshqa nomlar»ida shu yozilish bor karta — avval birlashtirilgan bo'lishi mumkin
    const viaAlias = all.filter((c) => !hit.includes(c) && c.aliases.some((a) => keys.has(customerNameKey(a))));
    for (const c of viaAlias) console.log(`  i  «${c.name}» ${c.id} — boshqa nomlarida bor: ${c.aliases.join(", ")}`);
    for (const s of suppliers.filter((s) => keys.has(customerNameKey(s.name)))) console.log(`  i  ta'minotchilarda ham bor: «${s.name}» ${s.id} (ta'minotchi birlashtirilmaydi)`);
    if (!hit.length) { console.log("  ! mijozlarda topilmadi\n"); problems++; continue; }

    const info = await Promise.all(hit.map(async (c) => {
      const parts = await Promise.all([
        db.order.count({ where: { customerId: c.id } }), db.invoice.count({ where: { customerId: c.id } }),
        db.realizationEntry.count({ where: { customerId: c.id } }), db.cashTransaction.count({ where: { customerId: c.id } }),
        db.payment.count({ where: { customerId: c.id } }), db.openingBalance.count({ where: { customerId: c.id, cancelledAt: null } }),
      ]);
      return { ...c, parts, docs: parts.reduce((a, b) => a + b, 0), balance: (await customerBalance(c.id)).balance };
    }));
    const finalKey = customerNameKey(finalName);
    const target = [...info].sort((a, b) =>
      Number(customerNameKey(b.name) === finalKey) - Number(customerNameKey(a.name) === finalKey)
      || Number(b.isActive) - Number(a.isActive) || b.docs - a.docs || a.createdAt.getTime() - b.createdAt.getTime())[0];
    for (const c of info) {
      const [o, inv, re, cash, pay, ob] = c.parts;
      console.log(`  ${c.id === target.id ? "QOLADI    " : "qo'shiladi"} ${c.id}  «${c.name}»${c.isActive ? "" : " (nofaol)"}${c.inn ? ` INN ${c.inn}` : ""}  ${c.createdAt.toISOString().slice(0, 10)}`
        + `  zayavka ${o}, schyot ${inv}, realizatsiya ${re}, kassa ${cash}, to'lov ${pay}, qoldiq ${ob}; qarz ${fmt(c.balance)}`);
    }
    const missing = names.filter((n) => !info.some((c) => customerNameKey(c.name) === customerNameKey(n)));
    if (missing.length) console.log(`  i  topilmagan yozilish: ${missing.map((n) => `«${n}»`).join(", ")}`);
    const sources = info.filter((c) => c.id !== target.id).map((c) => ({ id: c.id, name: c.name }));
    for (const s of sources) {
      const pre = await customerMergePreview(s.id, target.id);
      if (!pre.ok) { console.log(`  ! «${s.name}» qo'shilmaydi: ${pre.error}`); problems++; }
    }
    console.log(`  → bitta karta «${finalName}»${target.name !== finalName ? ` (hozir «${target.name}»)` : ""}, qarz ${fmt(info.reduce((a, c) => a + c.balance, 0))}\n`);
    plans.push({ label, target: { id: target.id, name: target.name }, finalName, sources });
  }
  if (!confirmed) { console.log(`${problems ? `${problems} ta muammo bor. ` : ""}Bajarish uchun --yes bilan qayta ishga tushiring.`); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — AuditLog uchun foydalanuvchi kerak");
  let merged = 0, renamed = 0, bad = 0;
  for (const p of plans) {
    let ok = true;
    for (const s of p.sources) {
      const r = await mergeCustomers(s.id, p.target.id, REASON, director.id);
      if (r.ok) { merged++; console.log(`✓ ${r.note}`); } else { bad++; ok = false; console.log(`✗ «${s.name}» → «${p.target.name}»: ${r.error}`); }
    }
    if (!ok || p.target.name === p.finalName) continue;
    // Yakuniy nom: eski nom «boshqa nomlar»da qoladi; boshqa kartada shu nom bo'lsa — to'xtaydi
    const taken = (await db.customer.findMany({ where: { id: { not: p.target.id }, isInternal: false }, select: { name: true, aliases: true } }))
      .find((c) => [c.name, ...c.aliases].some((n) => customerNameKey(n) === customerNameKey(p.finalName)));
    if (taken) { bad++; console.log(`✗ «${p.target.name}» → «${p.finalName}»: bu nom «${taken.name}» kartasida bor`); continue; }
    await db.$transaction(async (tx) => {
      const before = await tx.customer.findUniqueOrThrow({ where: { id: p.target.id } });
      const aliases = cleanAliases([...before.aliases, before.name], p.finalName);
      await tx.customer.update({ where: { id: before.id }, data: { name: p.finalName, aliases } });
      await audit(tx, director.id, "UPDATE", "Customer", before.id, { name: before.name, aliases: before.aliases }, { name: p.finalName, aliases, via: "scripts/mijoz-birlashtirish.ts" });
    });
    syncCustomerLater(p.target.id); // ilovadagi tashkilot nomi ham yangilansin
    renamed++;
    console.log(`✓ «${p.target.name}» → «${p.finalName}» nomiga o'tkazildi`);
  }
  console.log(`\nBirlashtirildi: ${merged}, nomi o'zgardi: ${renamed}${bad ? `, bajarilmadi: ${bad}` : ""}.`);
}

// ECO'ga yuborish (`syncCustomerLater`) fonda — tugashiga vaqt qolsin
main().then(() => setTimeout(() => process.exit(0), 5000)).catch((e) => { console.error(e); process.exit(1); });
