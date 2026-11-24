/**
 * Mahsulot katalogini bir martalik tozalash — Sarvar rejasi 1.1 (2026-11-24), Otabek qarorlari bilan:
 *  A. «PK xx-xx-8» (reestr nomi, kirill «ПК» ham) → «PK xx-xx-8 A 400» ga birlashadi, A 400 nomi qoladi;
 *  B. «Beton m N» (kirill «м» ham) ↔ «BN» — bitta mahsulot: retseptli «BN» kartochkasi qoladi, nomi «Beton m N»;
 *     juftsiz «BN» ham «Beton m N» deb nomlanadi (bir xil ko'rinish);
 *  C. mijozga sotiladigan xomashyo (Sheben, Klenes, Pesok, Almatura) — mahsulot bo'lib qoladi, «Xomashyo sotuvi»
 *     papkasiga o'tadi, nomi skladdagidek: Klenes → Klines, Pesok → Qum, Almatura → Armatura;
 *  D. katalogga bog'lanmagan reestr qatorlari nom kaliti / boshqa nomi / «+ A 400» bo'yicha mahsulotga bog'lanadi;
 *  E. qolgan nomlar normallashadi (kirill → lotin, «3,5» → «3.5», bo'shliqlar);
 *  F. papkasiz faol mahsulot nomidan taxmin qilingan papkaga (PK → Plita…), topilmasa «Boshqalar»;
 *  G. hech qayerda ishlatilmagan faqat-raqam nomli mahsulot («90») arxivga olinadi.
 * Kolso/Opora juftlari (qaysi nom qolishi aniqlanmagan) tegilmaydi — ro'yxati chiqadi.
 *
 * Birlashtirish yadrosi — `lib/product-merge.ts` (hech narsa o'chmaydi: nusxa arxivga, eski nom boshqa nom bo'lib qoladi).
 * Hammasi BITTA tranzaksiyada, sklad qulfi ostida. `--yes` bo'lmasa oxirida bekor qilinadi — sinov natijasi aynan
 * haqiqiy natijaning o'zi. AuditLog'ga birinchi faol direktor nomidan, `via: "katalog-tozalash"` bilan yoziladi.
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/katalog-tozalash.ts          (faqat ko'rish)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/katalog-tozalash.ts --yes    (yozish)
 * Oldin pg_dump zaxira oling.
 */
import { loadEnv } from "./env";
loadEnv();

class DryRun extends Error {}

async function main() {
  const { db } = await import("@/lib/db");
  const { lockStock } = await import("@/lib/stock-lock");
  const { audit, auditMany } = await import("@/lib/audit");
  const { mergeProductInto, MergeConflict } = await import("@/lib/product-merge");
  const { normalizeProductName, productNameKey, aliasesAfterRename, guessProductGroup, OTHER_PRODUCT_GROUP } = await import("@/lib/product-name");
  const { ensureRootGroup } = await import("@/lib/product-name-db");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — audit kimga yozilishini bilmaymiz");
  const userId = director.id, via = "katalog-tozalash";
  const log: string[] = [];
  const say = (s: string) => log.push(s);

  try {
    await db.$transaction(async (tx) => {
      await lockStock(tx);
      type P = { id: string; code: string; name: string; unit: string; aliases: string[]; groupId: string | null; isActive: boolean };
      const active = async (): Promise<P[]> => tx.product.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, code: true, name: true, unit: true, aliases: true, groupId: true, isActive: true } });
      const merge = async (keep: P, drop: P, name?: string) => {
        try {
          const r = await mergeProductInto(tx, { keepId: keep.id, dropId: drop.id, userId, name, via });
          const card = productNameKey(keep.name) === productNameKey(r.name) ? "" : ` (kartochkasi «${keep.name}», retsepti/papkasi shundan)`;
          say(`  «${drop.name}» → «${r.name}»${card}  — ko'chdi: ${Object.entries(r.moved).map(([k, n]) => `${k} ${n}`).join(", ") || "bog'lanish yo'q"}`);
          return true;
        } catch (e) {
          if (e instanceof MergeConflict) { say(`  TEGILMADI «${drop.name}» → «${keep.name}»: ${e.message}`); return false; }
          throw e;
        }
      };
      const rename = async (p: P, name: string, groupId?: string) => {
        const after = await tx.product.update({ where: { id: p.id }, data: { name, aliases: aliasesAfterRename(p.name, p.aliases, name), ...(groupId ? { groupId } : {}) } });
        await audit(tx, userId, "UPDATE", "Product", p.id, { name: p.name, aliases: p.aliases, groupId: p.groupId }, { name: after.name, aliases: after.aliases, groupId: after.groupId, via });
      };
      const takenBy = (list: P[], name: string, exceptId: string) => {
        const k = productNameKey(name);
        return list.find((x) => x.id !== exceptId && (productNameKey(x.name) === k || x.aliases.some((a) => productNameKey(a) === k)));
      };

      // ── A. «PK xx-xx-8» → «PK xx-xx-8 A 400» ──
      say("A. Plita: «PK xx-xx-8» → «PK xx-xx-8 A 400»");
      let list = await active();
      const A400 = /\s*a\s*400\s*$/i;
      const targets = new Map<string, P[]>();
      for (const t of list) if (A400.test(normalizeProductName(t.name))) {
        const k = productNameKey(normalizeProductName(t.name).replace(A400, ""));
        targets.set(k, [...(targets.get(k) ?? []), t]);
      }
      let nA = 0;
      for (const [k, ts] of targets) {
        const drops = list.filter((p) => !A400.test(normalizeProductName(p.name)) && productNameKey(p.name) === k);
        if (!drops.length) continue;
        if (ts.length > 1) { say(`  ANIQ EMAS: ${ts.map((t) => `«${t.name}»`).join(", ")} — bir nechta A 400 kartochka, tegilmadi`); continue; }
        for (const d of drops) if (await merge(ts[0], d, normalizeProductName(ts[0].name))) nA++;
      }
      say(`  jami: ${nA} ta`);

      // ── B. «Beton m N» ↔ «BN» ──
      say("B. Beton: «Beton m N» = «BN», nomi «Beton m N»");
      list = await active();
      const betonGroup = await ensureRootGroup(tx, "Beton", userId);
      const markOf = (name: string) => { const n = normalizeProductName(name); return /^beton\s*m\s*(\d{2,3})$/i.exec(n)?.[1] ?? null; };
      const classOf = (name: string) => /^b\s?(\d{2,3})$/i.exec(normalizeProductName(name))?.[1] ?? null;
      const marks = new Map<string, P[]>();
      for (const p of list) { const m = markOf(p.name); if (m && p.unit === "m3") marks.set(m, [...(marks.get(m) ?? []), p]); }
      for (const t of list.filter((p) => classOf(p.name) && p.unit === "m3")) {
        const m = classOf(t.name)!;
        const name = `Beton m ${m}`;
        const drops = marks.get(m) ?? [];
        marks.delete(m);
        if (drops.length) { for (const d of drops) await merge(t, d, name); }
        else if (!takenBy(list, name, t.id)) { await rename(t, name); say(`  «${t.name}» → «${name}» (juftsiz, faqat nomi)`); }
        if (!t.groupId) await tx.product.update({ where: { id: t.id }, data: { groupId: betonGroup } });
      }
      // «Beton m N» lar BN juftsiz: bittaga yig'iladi (kirill «м» nusxasi ham), papka — Beton
      for (const [m, ps] of marks) {
        const [keep, ...rest] = ps;
        for (const d of rest) await merge(keep, d, `Beton m ${m}`);
        if (!keep.groupId || normalizeProductName(keep.name) !== `Beton m ${m}`) {
          await rename(keep, `Beton m ${m}`, keep.groupId ? undefined : betonGroup);
          say(`  «${keep.name}» → «Beton m ${m}» (BN juftsiz)`);
        }
      }

      // ── C. Mijozga sotiladigan xomashyo — «Xomashyo sotuvi» ──
      say("C. Xomashyo sotuvi");
      list = await active();
      const rawGroup = await ensureRootGroup(tx, "Xomashyo sotuvi", userId);
      const RAW: [string, string][] = [["Sheben", "Sheben"], ["Klenes", "Klines"], ["Klines", "Klines"], ["Pesok", "Qum"], ["Qum", "Qum"], ["Almatura", "Armatura"], ["Armatura", "Armatura"]];
      for (const [from, to] of RAW) {
        for (const p of list.filter((x) => productNameKey(x.name) === productNameKey(from))) {
          const other = takenBy(await active(), to, p.id);
          if (other && other.id !== p.id && productNameKey(other.name) === productNameKey(to)) {
            if (other.groupId !== rawGroup) await tx.product.update({ where: { id: other.id }, data: { groupId: rawGroup } });
            await merge(other, p, to);
          } else if (p.name !== to || p.groupId !== rawGroup) {
            await rename(p, to, rawGroup);
            say(`  «${p.name}» → «${to}», papka «Xomashyo sotuvi»`);
          }
        }
      }

      // ── D. Bog'lanmagan reestr qatorlari ──
      say("D. Katalogga bog'lanmagan realizatsiya qatorlari");
      list = await active();
      const byKey = new Map<string, P>();
      for (const p of list) { const k = productNameKey(p.name); if (k && !byKey.has(k)) byKey.set(k, p); }
      for (const p of list) for (const a of p.aliases) { const k = productNameKey(a); if (k && !byKey.has(k)) byKey.set(k, p); }
      const loose = await tx.realizationEntry.groupBy({ by: ["productName"], where: { productId: null }, _count: { _all: true } });
      let linked = 0;
      const unresolved: string[] = [];
      for (const g of loose) {
        const k = productNameKey(g.productName);
        let p = byKey.get(k);
        if (!p) {
          const t = byKey.get(productNameKey(`${g.productName} A 400`));
          if (t) {
            const fresh = await tx.product.findUniqueOrThrow({ where: { id: t.id }, select: { aliases: true, name: true } });
            if (!fresh.aliases.some((a) => productNameKey(a) === k)) {
              await tx.product.update({ where: { id: t.id }, data: { aliases: [...fresh.aliases, normalizeProductName(g.productName)] } });
              await audit(tx, userId, "UPDATE", "Product", t.id, { aliases: fresh.aliases }, { aliases: [...fresh.aliases, normalizeProductName(g.productName)], via });
            }
            p = t; byKey.set(k, t);
          }
        }
        if (!p) { unresolved.push(`${g.productName} (${g._count._all})`); continue; }
        const rows = await tx.realizationEntry.findMany({ where: { productId: null, productName: g.productName }, select: { id: true } });
        await tx.realizationEntry.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { productId: p.id } });
        await auditMany(tx, userId, "UPDATE", "RealizationEntry", rows.map((r) => ({ id: r.id, before: { productId: null }, after: { productId: p!.id, productName: g.productName, via } })));
        linked += rows.length;
        say(`  «${g.productName}» → «${p.name}»: ${rows.length} qator`);
      }
      say(`  bog'landi: ${linked} qator${unresolved.length ? `; topilmadi: ${unresolved.join(", ")}` : ""}`);

      // ── E. Nomlarni normallash ──
      say("E. Nomlar normallashdi (kirill → lotin, «3,5» → «3.5»)");
      list = await active();
      for (const p of list) {
        const name = normalizeProductName(p.name);
        if (name === p.name) continue;
        const other = takenBy(list, name, p.id);
        if (other) { say(`  TEGILMADI «${p.name}» → «${name}»: «${other.name}» bilan bir xil — birlashtirish kerak`); continue; }
        await rename(p, name);
        say(`  «${p.name}» → «${name}»`);
      }

      // ── F. Papkasiz mahsulotlar ──
      say("F. Papkasiz mahsulotlar papkaga");
      list = await active();
      const materials = (await tx.material.findMany({ select: { name: true } })).map((m) => m.name);
      for (const p of list.filter((x) => !x.groupId)) {
        const g = guessProductGroup(p.name, materials) ?? OTHER_PRODUCT_GROUP;
        const gid = await ensureRootGroup(tx, g, userId);
        await tx.product.update({ where: { id: p.id }, data: { groupId: gid } });
        await audit(tx, userId, "UPDATE", "Product", p.id, { groupId: null }, { groupId: gid, group: g, via });
        say(`  «${p.name}» → ${g}`);
      }

      // ── G. Ishlatilmagan faqat-raqam nomlar ──
      say("G. Faqat raqamli nom, hech qayerda ishlatilmagan → arxiv");
      for (const p of (await active()).filter((x) => /^[\s\d.,()-]+$/.test(x.name))) {
        const w = { where: { productId: p.id } };
        const used = (await Promise.all([tx.orderItem.count(w), tx.stockMove.count(w), tx.realizationEntry.count(w), tx.openingBalance.count(w), tx.recipe.count(w), tx.productionBatch.count(w)])).some((n) => n > 0);
        if (used) { say(`  TEGILMADI «${p.name}» — hujjatlarda bor, nomini qo'lda tuzating`); continue; }
        await tx.product.update({ where: { id: p.id }, data: { isActive: false } });
        await audit(tx, userId, "STATUS_CHANGE", "Product", p.id, { isActive: true }, { isActive: false, via });
        say(`  «${p.name}» arxivga olindi`);
      }

      // ── Qaror kutayotganlar va yakun ──
      list = await active();
      const groups = await tx.productGroup.findMany({ select: { id: true, name: true, parentId: true } });
      const gById = new Map(groups.map((g) => [g.id, g]));
      const top = (id: string | null) => { let g = id ? gById.get(id) : undefined; for (let i = 0; g?.parentId && i < 10; i++) g = gById.get(g.parentId); return g?.name ?? "—"; };
      const nums = (s: string) => normalizeProductName(s).match(/\d+/g) ?? [];
      const first = (s: string) => normalizeProductName(s).toLowerCase().split(/[^a-z0-9]+/)[0];
      const pending: string[] = [];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (first(a.name) !== first(b.name) || !/^(kolso|opora)$/.test(first(a.name))) continue;
        const na = nums(a.name), nb = nums(b.name);
        const [s, l] = na.length <= nb.length ? [na, nb] : [nb, na];
        if (na.join("|") === nb.join("|") || (s.length && l.slice(l.length - s.length).join("|") === s.join("|"))) pending.push(`«${a.name}» ↔ «${b.name}»`);
      }
      say(`Qaror kutmoqda (tegilmadi): ${pending.join(", ") || "yo'q"}`);
      const byTop = new Map<string, number>();
      for (const p of list) byTop.set(top(p.groupId), (byTop.get(top(p.groupId)) ?? 0) + 1);
      say(`Yakun: faol mahsulot ${list.length} ta — ${[...byTop].map(([g, n]) => `${g} ${n}`).join(", ")}; narxi 0 — ${(await tx.product.count({ where: { isActive: true, price: 0 } }))} ta`);

      if (!confirmed) throw new DryRun();
    }, { timeout: 600_000, maxWait: 30_000 });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }

  console.log(`\nBaza: ${dbLabel()}\n${log.join("\n")}`);
  console.log(confirmed ? "\nYOZILDI.\n" : "\nFaqat ko'rish — hech narsa yozilmadi (tranzaksiya bekor qilindi). Yozish uchun: --yes\n");
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
