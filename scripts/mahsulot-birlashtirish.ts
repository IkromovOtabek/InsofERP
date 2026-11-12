/**
 * Kirill va lotinda ikki marta ochilgan mahsulotlarni birlashtirish (bir martalik tozalash).
 * Juftlik: kirill nomli mahsulot va nomi uning lotin ko'rinishiga teng boshqa mahsulot
 * («ПК 29-10-8 А 400» va «PK 29-10-8 A 400»).
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/mahsulot-birlashtirish.ts          (faqat ro'yxat)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/mahsulot-birlashtirish.ts --yes    (birlashtirish)
 *
 * Qoida:
 *  · ESKI (avval ochilgan) mahsulot qoladi, nomi lotindagi nusxaning nomiga o'zgaradi;
 *  · nusxaga bog'langan hamma yozuv (zayavka qatori, sklad harakati, partiya, brak, reja, retsept, realizatsiya,
 *    boshlang'ich qoldiq, taklif, lid, do'kon) qoladigan mahsulotga ko'chadi — miqdor va sanalar o'zgarmaydi;
 *  · qoladiganda bo'sh bo'lgan xususiyat (og'irlik, hajm, sdelka narxi, papka…) nusxadan olinadi, narx 0 bo'lsa — ham;
 *  · nusxa o'chirilmaydi: faolsizlantiriladi, nomiga «(takror)» qo'shiladi;
 *  · unique to'qnashuv bo'lsa (ikkalasida bir oyga reja, bir xil retsept versiyasi, do'kon kartasi, faol boshlang'ich
 *    qoldiq) — o'sha juftlik umuman tegilmaydi va sababi ko'rsatiladi.
 * Har juftlik o'z tranzaksiyasida, sklad qulfi ostida; AuditLog'ga ko'chirilgan yozuvlar id'lari bilan yoziladi.
 * Oldin pg_dump zaxira oling. Keyin qolgan kirill nomlar uchun: scripts/royxatlar-lotinga.ts --faqat=Product
 */
import { loadEnv } from "./env";
loadEnv();

const CYR = /[А-Яа-яЁёЎўҚқҒғҲҳ]/;
/** Nusxadan olinadigan xususiyatlar — qoladiganda bo'sh bo'lsa */
const FILL = ["strengthClass", "pieceRate", "weightKg", "perTrip", "volumeM3", "kind", "groupId", "note"] as const;

class Conflict extends Error {}

async function main() {
  const { db } = await import("@/lib/db");
  const { toLatin } = await import("@/lib/translit");
  const { lockStock } = await import("@/lib/stock-lock");
  const { audit } = await import("@/lib/audit");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");

  const products = await db.product.findMany({ orderBy: { createdAt: "asc" } });
  const byName = new Map<string, typeof products>();
  for (const p of products) {
    const k = p.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }

  type P = (typeof products)[number];
  const pairs: { keep: P; dup: P; name: string }[] = [];
  const unclear: string[] = [];
  for (const p of products) {
    if (!CYR.test(p.name)) continue;
    const lat = toLatin(p.name).trim();
    const twins = (byName.get(lat.toLowerCase()) ?? []).filter((x) => x.id !== p.id);
    if (!twins.length) continue;
    if (twins.length > 1) { unclear.push(`${p.name} — lotinda ${twins.length} ta nusxa`); continue; }
    const twin = twins[0];
    const [keep, dup] = p.createdAt <= twin.createdAt ? [p, twin] : [twin, p];
    pairs.push({ keep, dup, name: CYR.test(twin.name) ? lat : twin.name });
  }

  const count = async (productId: string) => {
    const w = { where: { productId } };
    const [oi, sm, pb, pd, pp, rc, ri, re, ob, co, ld, sb, si] = await Promise.all([
      db.orderItem.count(w), db.stockMove.count(w), db.productionBatch.count(w), db.productDefect.count(w),
      db.productionPlan.count(w), db.recipe.count(w), db.recipeItem.count(w), db.realizationEntry.count(w),
      db.openingBalance.count(w), db.commercialOfferItem.count(w), db.lead.count(w), db.shopBanner.count(w), db.shopItem.count(w),
    ]);
    const parts: [string, number][] = [
      ["zayavka", oi], ["sklad", sm], ["partiya", pb], ["brak", pd], ["reja", pp], ["retsept", rc], ["retsept qatori", ri],
      ["realizatsiya", re], ["boshl. qoldiq", ob], ["taklif", co], ["lid", ld], ["banner", sb], ["do'kon", si],
    ];
    return parts.filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "bog'lanish yo'q";
  };
  const diff = (a: P, b: P) => {
    const keys = ["code", "unit", "price", ...FILL] as const;
    return keys
      .filter((k) => String(a[k] ?? "") !== String(b[k] ?? ""))
      .map((k) => `${k}: ${a[k] ?? "—"} | ${b[k] ?? "—"}`);
  };

  console.log(`\nBaza: ${dbLabel()}\nTakror juftlik: ${pairs.length} ta\n`);
  for (const { keep, dup, name } of pairs) {
    console.log(`${name}`);
    console.log(`  qoladi : «${keep.name}» ${keep.createdAt.toISOString().slice(0, 10)} — ${await count(keep.id)}`);
    console.log(`  nusxa  : «${dup.name}» ${dup.createdAt.toISOString().slice(0, 10)} — ${await count(dup.id)}`);
    const d = diff(keep, dup);
    if (d.length) console.log(`  farq (qoladi | nusxa): ${d.join("; ")}`);
  }
  if (unclear.length) console.log(`\nAniq emas, tegilmaydi:\n  ${unclear.join("\n  ")}`);
  if (!confirmed) { console.log("\nFaqat ro'yxat. Birlashtirish uchun: --yes\n"); return; }
  if (!pairs.length) return;

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — audit kimga yozilishini bilmaymiz");

  let ok = 0;
  const failed: string[] = [];
  for (const { keep, dup, name } of pairs) {
    try {
      await db.$transaction(async (tx) => {
        await lockStock(tx);
        const from = { productId: dup.id };
        const to = { productId: keep.id };

        // ── Unique to'qnashuvlar: bo'lsa juftlik umuman tegilmaydi ──
        const plans = await tx.productionPlan.findMany({ where: from, select: { year: true, month: true } });
        for (const pl of plans) {
          if (await tx.productionPlan.findFirst({ where: { ...to, year: pl.year, month: pl.month } })) throw new Conflict(`ikkalasida ${pl.year}-${pl.month} oy rejasi bor`);
        }
        const recipes = await tx.recipe.findMany({ where: from, select: { version: true } });
        for (const r of recipes) {
          if (await tx.recipe.findFirst({ where: { ...to, version: r.version } })) throw new Conflict(`ikkalasida ${r.version}-versiya retsept bor`);
        }
        const rItems = await tx.recipeItem.findMany({ where: from, select: { recipeId: true } });
        for (const r of rItems) {
          if (await tx.recipeItem.findFirst({ where: { ...to, recipeId: r.recipeId } })) throw new Conflict("bitta retseptda ikkalasi ham bor");
        }
        if ((await tx.shopItem.count({ where: from })) && (await tx.shopItem.count({ where: to }))) throw new Conflict("ikkalasida do'kon kartasi bor");
        const openings = await tx.openingBalance.findMany({ where: { ...from, activeKey: { not: null } }, select: { id: true, activeKey: true } });
        const keyMoves: { id: string; key: string }[] = [];
        for (const o of openings) {
          const key = o.activeKey!.replace(`:${dup.id}:`, `:${keep.id}:`);
          if (key !== o.activeKey && (await tx.openingBalance.findUnique({ where: { activeKey: key } }))) throw new Conflict("ikkalasida shu skladga faol boshlang'ich qoldiq bor");
          keyMoves.push({ id: o.id, key });
        }

        // ── Ko'chirish: qaysi yozuv ko'chganini audit uchun yig'amiz ──
        const moved: Record<string, string[]> = {};
        const ids = async (name: string, rows: { id: string }[]) => { if (rows.length) moved[name] = rows.map((r) => r.id); };
        const sel = { where: from, select: { id: true } } as const;
        await ids("OrderItem", await tx.orderItem.findMany(sel));
        await ids("StockMove", await tx.stockMove.findMany(sel));
        await ids("ProductionBatch", await tx.productionBatch.findMany(sel));
        await ids("ProductDefect", await tx.productDefect.findMany(sel));
        await ids("ProductionPlan", await tx.productionPlan.findMany(sel));
        await ids("Recipe", await tx.recipe.findMany(sel));
        await ids("RecipeItem", await tx.recipeItem.findMany(sel));
        await ids("RealizationEntry", await tx.realizationEntry.findMany(sel));
        await ids("OpeningBalance", await tx.openingBalance.findMany(sel));
        await ids("CommercialOfferItem", await tx.commercialOfferItem.findMany(sel));
        await ids("Lead", await tx.lead.findMany(sel));
        await ids("ShopBanner", await tx.shopBanner.findMany(sel));
        await ids("ShopItem", await tx.shopItem.findMany(sel));

        await tx.orderItem.updateMany({ where: from, data: to });
        await tx.stockMove.updateMany({ where: from, data: to });
        await tx.productionBatch.updateMany({ where: from, data: to });
        await tx.productDefect.updateMany({ where: from, data: to });
        await tx.productionPlan.updateMany({ where: from, data: to });
        await tx.recipe.updateMany({ where: from, data: to });
        await tx.recipeItem.updateMany({ where: from, data: to });
        await tx.realizationEntry.updateMany({ where: from, data: to });
        await tx.commercialOfferItem.updateMany({ where: from, data: to });
        await tx.lead.updateMany({ where: from, data: to });
        await tx.shopBanner.updateMany({ where: from, data: to });
        await tx.shopItem.updateMany({ where: from, data: to });
        // Boshlang'ich qoldiq: faol kalit ichida mahsulot id'si bor — avval bo'shatib, keyin yangisini yozamiz
        await tx.openingBalance.updateMany({ where: { id: { in: keyMoves.map((k) => k.id) } }, data: { activeKey: null } });
        await tx.openingBalance.updateMany({ where: from, data: to });
        for (const k of keyMoves) await tx.openingBalance.update({ where: { id: k.id }, data: { activeKey: k.key } });

        // ── Qoladigan mahsulot: lotin nom + bo'sh xususiyatlar nusxadan ──
        const fill: Record<string, unknown> = {};
        for (const f of FILL) if (keep[f] == null && dup[f] != null) fill[f] = dup[f];
        if (Number(keep.price) === 0 && Number(dup.price) > 0) fill.price = dup.price;
        const n = await tx.product.updateMany({ where: { id: keep.id, name: keep.name }, data: { name, ...fill } });
        if (!n.count) throw new Conflict("qoladigan mahsulot nomi o'qilgandan keyin o'zgargan");
        await tx.product.update({ where: { id: dup.id }, data: { isActive: false, name: `${dup.name} (takror)`, note: `Birlashtirildi → ${keep.code}` } });

        await audit(tx, director.id, "UPDATE", "Product", keep.id,
          { name: keep.name, ...Object.fromEntries(Object.keys(fill).map((k) => [k, keep[k as keyof P]])) },
          { name, ...fill, mergedFrom: dup.id, moved });
        await audit(tx, director.id, "STATUS_CHANGE", "Product", dup.id,
          { name: dup.name, isActive: dup.isActive }, { name: `${dup.name} (takror)`, isActive: false, mergedInto: keep.id });
      });
      ok++;
    } catch (e) {
      failed.push(`${name}: ${e instanceof Conflict ? e.message : e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  }
  console.log(`\nBirlashtirildi: ${ok} ta juftlik`);
  if (failed.length) console.log(`Tegilmadi (${failed.length}):\n  ${failed.join("\n  ")}`);
  console.log("Keyingi qadam: scripts/royxatlar-lotinga.ts --faqat=Product, so'ng npm run eco:sync\n");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
