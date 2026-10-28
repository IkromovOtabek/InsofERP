import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@/generated/prisma";
import { loadEnv } from "./env";
loadEnv();

/**
 * «Insof 2026» Google jadvalining «Ro'yxatlar» varag'ini spravochniklarga yozadi.
 * Ma'lumot fayllari (jadvaldan ko'chirilgan, repoga kirmaydi) papkada turadi:
 *   small.txt        — «## Bo'lim» sarlavhali ro'yxatlar (Manba, Sub manba, Hisob, Sotuvchi, Brigada|Brigadir, Mahsulot, Tovar…)
 *   kontragentlar.txt — «X|T|nom» (X — xaridor, T — ta'minotchi, bo'sh — faqat pul jurnalida)
 *   aliases.txt      — «Kassadagi nom=>Spravkadagi asosiy nom»
 *   mashinalar.txt   — «Mashina|Model|Haydovchi|Yoqilg'i|DT l/km|DT l/soat|Gaz m3/km|Gaz m3/soat» («Mashinalar» varag'idan)
 *
 *   npx tsx scripts/import-royxatlar.ts <papka>           — faqat reja (bazaga yozmaydi)
 *   npx tsx scripts/import-royxatlar.ts <papka> --apply   — bitta tranzaksiyada yozadi
 *
 * Qayta ishga tushirilsa zarari yo'q: bor yozuv nom (va aliaslar) bo'yicha topiladi, yangisi yaratilmaydi.
 */

const dir = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!dir) { console.error("Papka ko'rsatilmagan: npx tsx scripts/import-royxatlar.ts <papka> [--apply]"); process.exit(1); }

const read = (f: string) => readFileSync(join(dir, f), "utf8").split("\n").map((s) => s.replace(/\r$/, "")).filter((s) => s.trim());

function sections(lines: string[]) {
  const out = new Map<string, string[]>();
  let cur = "";
  for (const l of lines) {
    if (l.startsWith("## ")) { cur = l.slice(3).trim(); out.set(cur, []); continue; }
    out.get(cur)?.push(l.trim());
  }
  return out;
}

// ───────────────────────── Kassa kategoriyalari ─────────────────────────
// Jadvaldagi Manba / Sub manba nomlari mavjud daraxtda (nom yoki alias) topilmasa — shu xarita bo'yicha.

/** Mavjud kategoriyaga alias sifatida qo'shiladi. */
const CAT_ALIAS: Record<string, string> = {
  "O'qish xarajatlari": "cc_o_hr",
  "Xodim topishga xarajatlar": "cc_o_hr",
  "Usluga xarajatlari": "cc_t_yollanma",
  "Ijaraga moshina": "cc_t_yollanma",
};

/** Yangi sub manba: nom → ota manba id. Turi, oqimi, PNL qatori va tannarxga kirishi otadan olinadi. */
const CAT_SUB: Record<string, string> = {
  "Usta xarajatlari": "cc_tamir",
  "Labaratoriya xizmatlari": "cc_tamir",
  "Logistika xarajatlari": "cc_transport",
  "Konstavar": "cc_ofis",
  "Tozalik (Uborka) xarajatlari": "cc_ofis",
  "Boshqa adminstrativni xarajatlar": "cc_ofis",
  "Pochta xizmatlari": "cc_ofis",
  "Boshqa tijoriy xarajatlar.": "cc_marketing",
  "Target va reklama xarajatlari": "cc_marketing",
  "INPS": "cc_soliq",
  "NDS": "cc_soliq",
  "Daromad solig'i": "cc_soliq",
  "Foyda solig'i": "cc_soliq",
  "Divident solig'i": "cc_soliq",
  "Mol-mulk solig'i": "cc_soliq",
  "Yekalogiya solig'i": "cc_soliq",
  "Yer solig'i": "cc_soliq",
  "Suv solig'i": "cc_soliq",
  "Aliment": "cc_ishhaqi",
  "Ishlab chiqarish xodimlarining ish xaqisi": "cc_ishhaqi",
  "Adminstrativ xodimlar ish xaqi": "cc_ishhaqi",
};

/** Yangi manba (ota-onasiz). */
const CAT_TOP = ["Mijozga pul qaytarish"];

/** Loyiha (Project) — xarajati «Loyihalar» manbasi orqali yoziladi. */
const PROJECTS = ["PB sex", "Nazira Servis", "Kuylik yangi zavod", "Gigabit", "Future Stone", "Shpaklofka Sex"];

/**
 * Kategoriya emas: o'tkazmalar (CashTransfer, DDS «Ichki o'tkazma» qatorlari), mijoz to'lovlari (Payment → «Savdo tushumi»)
 * va hisoblanadigan amortizatsiya (Asosiy vositalar).
 */
const CAT_SKIP = new Set([
  "Savdo tushumi", "Amartizatsiya", "99999-Xisob raqam almashinuvi", "Pul yechib berish", "Tranzit (pul almashinuvi)",
  "Hisobdan hisobga", "Naqd yechish (bank → kassa)", "Inkassa (kassa → bank)", "Pul aylantirish (naqdlashtirish)",
]);

// ───────────────────────── Nomlarni solishtirish ─────────────────────────

const LEGAL = /\b(mchj|xk|qk|ok|aj|atb|duk|ooo|sp|dm|uk|llc|chp)\b/g;

async function main() {
  const { db } = await import("@/lib/db");
  const { audit } = await import("@/lib/audit");
  const { translit, flatName } = await import("@/lib/excel");
  const { normalizePhone } = await import("@/lib/phone");
  const { normalizeUnit, UNIT_FALLBACK } = await import("@/lib/unit");
  const { resolveMaterials } = await import("@/lib/import-materials");
  const { defaultCreditLimit } = await import("@/lib/finance");
  const { normCat } = await import("@/lib/fin-report/categories");

  /** «"BAO XIN METALL" MCHJ QK» = «Bao Xin Metall»: kirill → lotin, yuridik shakl va belgilarsiz. */
  // h/x farqsiz: «Shohruh» = «Shoxrux», «Hamkor» = «Xamkor»
  const norm = (s: string) => translit(s).replace(/[ʻʼ’‘`'"]/g, "").replace(LEGAL, " ").replace(/[^a-z0-9]+/g, "").replace(/h/g, "x");
  /** Nom ichidagi telefon: «Yangiyul(97 783 28 32)» → +998977832832; 4 xonali qisqartma telefon emas. */
  const phoneOf = (s: string) => {
    const d = s.replace(/\D/g, "");
    return d.length === 9 || (d.length === 12 && d.startsWith("998")) ? normalizePhone(d) : null;
  };

  const small = sections(read("small.txt"));
  const sec = (k: string) => { const v = small.get(k); if (!v) throw new Error(`small.txt: «${k}» bo'limi yo'q`); return v; };

  // Alias: kassadagi nom → spravkadagi asosiy nom (zanjir bo'lsa oxirigacha)
  const alias = new Map<string, string>();
  for (const l of read("aliases.txt")) {
    const [from, to] = l.split("=>").map((s) => s.trim());
    if (from && to && norm(from) !== norm(to)) alias.set(norm(from), to);
  }
  const canon = (name: string) => {
    let n = name.trim();
    for (let i = 0; i < 5 && alias.has(norm(n)); i++) n = alias.get(norm(n))!;
    return n;
  };

  const kontr = read("kontragentlar.txt").map((l) => {
    const i = l.indexOf("|");
    return { flags: l.slice(0, i), name: l.slice(i + 1).replace(/\s+/g, " ").trim() };
  });
  /** Ism emas: bir harf, umumiy so'z yoki qisqartma («Kum», «Nalichka», «Shox»). */
  const JUNK = new Set(["Xaridorlar", "Янгм", "Kum", "Nalichka", "Boshqa tavarlar", "Shox", "Shj"].map(norm));
  const junk = (n: string) => norm(n).length < 3 || JUNK.has(norm(n));
  const cyr = (s: string) => /[а-яёўқғҳ]/i.test(s);

  const plan: string[] = [];
  const stat: Record<string, { created: number; updated: number; existing: number }> = {};
  const bump = (k: string, f: "created" | "updated" | "existing") => { (stat[k] ??= { created: 0, updated: 0, existing: 0 })[f]++; };

  const admin = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true, login: { not: { startsWith: "test." } } }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("Audit uchun direktor foydalanuvchi topilmadi");
  const uid = admin.id;

  const run = async (tx: Prisma.TransactionClient) => {
    // ── 1. Kassa kategoriyalari va loyihalar
    const cats = await tx.cashCategory.findMany();
    const known = new Map<string, (typeof cats)[number]>();
    for (const c of cats) { known.set(normCat(c.name), c); for (const a of c.aliases) if (!known.has(normCat(a))) known.set(normCat(a), c); }
    const byId = new Map(cats.map((c) => [c.id, c]));
    const sheetCats = [...sec("Manba"), ...sec("Sub manba")];
    for (const name of sheetCats) {
      if (CAT_SKIP.has(name) || PROJECTS.includes(name)) continue;
      if (known.has(normCat(name))) { bump("Kassa kategoriyasi", "existing"); continue; }
      if (CAT_ALIAS[name]) {
        const c = byId.get(CAT_ALIAS[name]);
        if (!c) throw new Error(`Kategoriya ${CAT_ALIAS[name]} yo'q`);
        const aliases = [...c.aliases, normCat(name)];
        await tx.cashCategory.update({ where: { id: c.id }, data: { aliases } });
        await audit(tx, uid, "UPDATE", "CashCategory", c.id, { aliases: c.aliases }, { aliases });
        c.aliases = aliases; known.set(normCat(name), c);
        plan.push(`Kategoriya «${c.name}» ← alias «${name}»`); bump("Kassa kategoriyasi", "updated");
        continue;
      }
      const parent = CAT_SUB[name] ? byId.get(CAT_SUB[name]) : null;
      if (CAT_SUB[name] && !parent) throw new Error(`Ota kategoriya ${CAT_SUB[name]} yo'q`);
      if (!parent && !CAT_TOP.includes(name)) throw new Error(`Kategoriya xaritada yo'q: «${name}» — CAT_ALIAS / CAT_SUB / CAT_TOP / CAT_SKIP ga qo'shing`);
      const sort = Math.max(0, ...cats.filter((c) => c.parentId === (parent?.id ?? null)).map((c) => c.sort)) + 1;
      const data = parent
        ? { name, parentId: parent.id, type: parent.type, flow: parent.flow, pnlLine: parent.pnlLine, inCost: parent.inCost, sort }
        : { name, type: "EXPENSE" as const, flow: "OPERATING" as const, pnlLine: "NONE" as const, sort };
      const c = await tx.cashCategory.create({ data });
      await audit(tx, uid, "CREATE", "CashCategory", c.id, undefined, data);
      cats.push(c); known.set(normCat(name), c);
      plan.push(`Kategoriya + «${parent ? `${parent.name} / ` : ""}${name}»`); bump("Kassa kategoriyasi", "created");
    }
    for (const name of PROJECTS) {
      const ex = await tx.project.findUnique({ where: { name } });
      if (ex) { bump("Loyiha", "existing"); continue; }
      const p = await tx.project.create({ data: { name, createdById: uid } });
      await audit(tx, uid, "CREATE", "Project", p.id, undefined, { name });
      plan.push(`Loyiha + «${name}»`); bump("Loyiha", "created");
    }

    // ── 2. Hisoblar (kassa / bank)
    for (const name of sec("Hisob")) {
      const type = name === "Naqd" ? "CASH" as const : "BANK" as const;
      const ex = await tx.cashAccount.findFirst({ where: { name, type } });
      if (ex) { bump("Hisob", "existing"); continue; }
      const a = await tx.cashAccount.create({ data: { name, type } });
      await audit(tx, uid, "CREATE", "CashAccount", a.id, undefined, { name, type });
      plan.push(`Hisob + «${name}» (${type})`); bump("Hisob", "created");
    }

    // ── 3. Xodimlar: sotuvchilar va brigadirlar; brigadalar
    const employee = async (fullName: string, position: string, brigadeId?: string) => {
      const ex = await tx.employee.findFirst({ where: { fullName: { equals: fullName, mode: "insensitive" }, position } });
      if (ex) { bump(`Xodim (${position})`, "existing"); return ex; }
      const e = await tx.employee.create({ data: { fullName, position, brigadeId } });
      await audit(tx, uid, "CREATE", "Employee", e.id, undefined, { fullName, position });
      plan.push(`Xodim + «${fullName}» (${position})`); bump(`Xodim (${position})`, "created");
      return e;
    };
    for (const name of sec("Sotuvchi")) await employee(name, "Sotuv");

    const brigades = await tx.brigade.findMany();
    for (const line of sec("Brigada")) {
      const [bName, leader] = line.split("|").map((s) => s.trim());
      const num = /(\d+)/.exec(bName)?.[1];
      let b = brigades.find((x) => num && new RegExp(`^brigada\\s*${num}\\b`, "i").test(x.name)) ?? null;
      if (!b) {
        b = await tx.brigade.create({ data: { name: `${bName} — ${leader}` } });
        await audit(tx, uid, "CREATE", "Brigade", b.id, undefined, { name: b.name });
        brigades.push(b); plan.push(`Brigada + «${b.name}»`); bump("Brigada", "created");
      } else bump("Brigada", "existing");
      const e = await employee(leader, "Brigadir", b.id);
      if (!e.brigadeId) await tx.employee.update({ where: { id: e.id }, data: { brigadeId: b.id } });
      if (!b.leaderId) {
        await tx.brigade.update({ where: { id: b.id }, data: { leaderId: e.id } });
        await audit(tx, uid, "UPDATE", "Brigade", b.id, { leaderId: null }, { leaderId: e.id });
        plan.push(`Brigada «${b.name}» ← brigadir ${leader}`); bump("Brigada", "updated");
      }
    }

    // ── 4. Mahsulotlar
    const products = await tx.product.findMany({ select: { id: true, code: true, name: true } });
    const groups = await tx.productGroup.findMany({ select: { id: true, code: true, name: true, parentId: true } });
    const codes = new Set([...products, ...groups].map((x) => x.code.toUpperCase()));
    let seq = [...codes].map(Number).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
    const nextCode = () => { do seq++; while (codes.has(String(seq))); codes.add(String(seq)); return String(seq); };
    const byFlat = new Map(products.map((p) => [flatName(p.name), p]));
    const byCode = new Map(products.map((p) => [p.code.toUpperCase(), p]));
    let pkGroup = groups.find((g) => !g.parentId && flatName(g.name) === flatName("Plita PK"))?.id;
    for (const name of sec("Mahsulot")) {
      const clean = name.replace(/\s+/g, " ").trim();
      const beton = /^Beton m (\d+)$/i.exec(clean);
      const fbs = /^FBS (\d+)\.\d+\.\d+/i.exec(clean);
      // Demo katalogdagi «Beton M300 (B22.5)», «FBS blok 24.4.6» — kod bo'yicha bir xil mahsulot
      const ex = byFlat.get(flatName(clean)) ?? (beton ? byCode.get(`M${beton[1]}`) : fbs ? byCode.get(`FBS${fbs[1]}`) : undefined);
      if (ex) { bump("Mahsulot", "existing"); continue; }
      const unit = beton || /^Sheben$/i.test(clean) ? "m3" : "dona";
      let groupId: string | undefined;
      if (/^PK /i.test(clean)) {
        if (!pkGroup) {
          const g = await tx.productGroup.create({ data: { name: "Plita PK", code: nextCode() } });
          await audit(tx, uid, "CREATE", "ProductGroup", g.id, undefined, { name: g.name, code: g.code });
          pkGroup = g.id; plan.push("Mahsulot papkasi + «Plita PK»");
        }
        groupId = pkGroup;
      }
      const code = beton && !codes.has(`M${beton[1]}`) ? (codes.add(`M${beton[1]}`), `M${beton[1]}`) : nextCode();
      const data = { code, name: clean, unit, kind: "Tayyor Mahsulot", groupId };
      const p = await tx.product.create({ data });
      await audit(tx, uid, "CREATE", "Product", p.id, undefined, data);
      byFlat.set(flatName(clean), p); plan.push(`Mahsulot + ${code} «${clean}» (${unit})`); bump("Mahsulot", "created");
    }

    // ── 5. Xom-ashyo / tovarlar (birligi jadvalda yo'q — nomdan; qolgani «dona»)
    const matUnit = (n: string) =>
      /^salarka|^moy (stalbaga|aralashma)/i.test(n) ? "l" : /^cyement$|^provoloka/i.test(n) ? "t" : UNIT_FALLBACK;
    const mats = sec("Tovar (xom-ashyo)").map((n) => ({ name: n.replace(/\s+/g, " ").trim(), unit: normalizeUnit(matUnit(n.trim())) ?? UNIT_FALLBACK }));
    const { result, created } = await resolveMaterials(tx, mats, true);
    for (const m of created) {
      await audit(tx, uid, "CREATE", "Material", m.id, undefined, { code: m.code, name: m.name, unit: m.unit });
      plan.push(`Xom-ashyo + ${m.code} «${m.name}» (${m.unit})`); bump("Xom-ashyo", "created");
    }
    for (let i = 0; i < result.size - created.length; i++) bump("Xom-ashyo", "existing");

    // ── 6. Ta'minotchilar va mijozlar (aliaslar bo'yicha birlashtiriladi)
    type Party = { name: string; phone: string | null };
    const collect = (flag: "X" | "T") => {
      const out = new Map<string, Party>();
      const byPhone = new Map<string, string>();
      const add = (raw: string) => {
        if (junk(raw)) return;
        const name = canon(raw);
        const phone = phoneOf(name) ?? phoneOf(raw);
        // Bir telefon — bir mijoz: «Ховос 977190066» va «Xovos(97 719 00 66)»
        const k = (!out.has(norm(name)) && phone && byPhone.get(phone)) || norm(name);
        if (phone && !byPhone.has(phone)) byPhone.set(phone, k);
        const cur = out.get(k);
        if (!cur) out.set(k, { name, phone });
        else {
          if (cyr(cur.name) && !cyr(name)) cur.name = name; // «Алибек драбилка» va «Alibek Drabilka» — lotinchasi qoladi
          if (!cur.phone && phone) cur.phone = phone;
        }
      };
      // Kassadagi nom spravkadagi asosiy nomga almashtiriladi — bir mijoz bitta yozuv bo'ladi
      for (const r of kontr) if (r.flags.includes(flag)) add(r.name);
      return out;
    };

    const supplierList = collect("T");
    const suppliers = await tx.supplier.findMany({ select: { id: true, name: true, phone: true } });
    const supKeys = new Map<string, (typeof suppliers)[number]>();
    for (const s of suppliers) { supKeys.set(norm(s.name), s); supKeys.set(norm(canon(s.name)), s); }
    for (const [k, p] of supplierList) {
      const ex = supKeys.get(k) ?? supKeys.get(norm(p.name));
      if (ex) { bump("Ta'minotchi", "existing"); continue; }
      const s = await tx.supplier.create({ data: { name: p.name, phone: p.phone } });
      await audit(tx, uid, "CREATE", "Supplier", s.id, undefined, { name: p.name, phone: p.phone });
      supKeys.set(k, s); plan.push(`Ta'minotchi + «${p.name}»`); bump("Ta'minotchi", "created");
    }

    const customerList = collect("X");
    const customers = await tx.customer.findMany({ select: { id: true, name: true, phone: true } });
    const custKeys = new Map<string, (typeof customers)[number]>();
    const custByPhone = new Map<string, (typeof customers)[number]>();
    for (const c of customers) {
      custKeys.set(norm(c.name), c); custKeys.set(norm(canon(c.name)), c);
      const ph = normalizePhone(c.phone);
      if (ph && !custByPhone.has(ph)) custByPhone.set(ph, c);
    }
    const limit = await defaultCreditLimit(tx);
    for (const [k, p] of customerList) {
      const ex = custKeys.get(k) ?? custKeys.get(norm(p.name)) ?? (p.phone ? custByPhone.get(p.phone) : undefined);
      if (ex) {
        if (!ex.phone && p.phone) { await tx.customer.update({ where: { id: ex.id }, data: { phone: p.phone } }); bump("Mijoz", "updated"); }
        else bump("Mijoz", "existing");
        continue;
      }
      const c = await tx.customer.create({ data: { name: p.name, phone: p.phone, creditLimit: limit } });
      await audit(tx, uid, "CREATE", "Customer", c.id, undefined, { name: p.name, phone: p.phone });
      custKeys.set(k, c); if (p.phone) custByPhone.set(p.phone, c); plan.push(`Mijoz + «${p.name}»${p.phone ? ` ${p.phone}` : ""}`); bump("Mijoz", "created");
    }

    // ── 7. Kontragentlar — kassa formasidagi «Kimga / Kimdan» maydoniga taklif sifatida
    const names = new Map<string, string>();
    for (const r of kontr) {
      if (junk(r.name)) continue;
      const n = canon(r.name), k = norm(n), cur = names.get(k);
      if (!cur || (cyr(cur) && !cyr(n))) names.set(k, n);
    }
    let mem = 0;
    for (const value of names.values()) {
      const v = value.slice(0, 200);
      const r = await tx.inputMemory.upsert({ where: { key_value: { key: "cashflow:counterparty", value: v } }, update: {}, create: { key: "cashflow:counterparty", value: v } });
      if (r) mem++;
    }
    plan.push(`Kassa «Kimga / Kimdan» takliflari: ${mem} nom`);

    // ── 8. Bizning mashinalar («Mashinalar» varag'idagi model, yoqilg'i va normalar bilan)
    const num = (s: string | undefined) => { const v = Number((s ?? "").replace(",", ".").trim()); return s?.trim() && Number.isFinite(v) ? v : null; };
    const per100 = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 100);
    const info = new Map(read("mashinalar.txt").map((l) => { const c = l.split("|"); return [c[0].trim(), c] as const; }));
    for (const plate of sec("Bizning mashinalar")) {
      const ex = await tx.vehicle.findUnique({ where: { plate } });
      if (ex) { bump("Mashina", "existing"); continue; }
      const [, model = "", driver = "", fuel = "", dtKm, dtHour, gasKm, gasHour] = info.get(plate) ?? [];
      const type = /mikser/i.test(model) ? "MIXER" as const : "TRUCK" as const;
      const fuelType = fuel === "DT + Gaz" ? "DIESEL_METHANE" as const : fuel === "Gaz" ? "METHANE" as const : fuel === "DT" ? "DIESEL" as const : fuel === "Benzin" ? "PETROL" as const : null;
      const methane = fuelType === "METHANE";
      const data = {
        plate, type, capacityUnit: type === "TRUCK" ? "TON" as const : "M3" as const,
        model: model || null, fuelType,
        fuelNormL100: per100(num(methane ? gasKm : dtKm)), idleNormPerHour: num(methane ? gasHour : dtHour),
        gasNormPer100: fuelType === "DIESEL_METHANE" ? per100(num(gasKm)) : null,
        gasIdlePerHour: fuelType === "DIESEL_METHANE" ? num(gasHour) : null,
        note: driver ? `Asosiy haydovchi: ${driver}` : null,
      };
      const v = await tx.vehicle.create({ data });
      await audit(tx, uid, "CREATE", "Vehicle", v.id, undefined, data);
      plan.push(`Mashina + ${plate} ${model} (${type}${fuelType ? `, ${fuelType}` : ""})`); bump("Mashina", "created");
    }
  };

  class DryRun extends Error {}
  try {
    await db.$transaction(async (tx) => { await run(tx); if (!APPLY) throw new DryRun(); }, { timeout: 300_000, maxWait: 20_000 });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }

  for (const l of plan) console.log(l);
  console.log("\n— Natija —");
  for (const [k, v] of Object.entries(stat)) console.log(`${k}: yangi ${v.created}, yangilandi ${v.updated}, bor edi ${v.existing}`);
  console.log(APPLY ? "\nBazaga yozildi." : "\nSINOV: bazaga hech narsa yozilmadi. Yozish uchun --apply qo'shing.");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
