import { db } from "./db";
import { audit } from "./audit";
import { flatName, num, numMoney, str } from "./excel";
import { DEFAULT_CREDIT_LIMIT } from "./finance";
import { createOpeningTx, activeKeyOf, OpeningError, type OpeningInput } from "./opening-balances";
import type { OpeningKind } from "@/generated/prisma";

/**
 * Boshlang'ich qoldiqlarni Excel'dan yuklash — to'rt tur uchun bitta qoida:
 *   CUSTOMER: Mijoz · INN · Summa (+ qarz / − avans) · Izoh
 *   SUPPLIER: Yetkazuvchi · INN · Summa (+ qarzimiz / − avansimiz) · Izoh
 *   CASH:     Hisob (kassa/bank nomi) · Summa · Izoh
 *   STOCK:    Mahsulot (kod yoki nomi) · Sklad · Miqdor · Tannarx · Izoh
 *
 * Avval hamma qator tekshiriladi (obyekt topiladimi, summa to'g'rimi); bitta xato bo'lsa ham hech narsa
 * yozilmaydi — xatolar qator raqami bilan qaytadi. Shu obyektga qoldiq oldin kiritilgan bo'lsa — o'tkazib
 * yuboriladi (ikki marta yozilmaydi) va hisobotda ko'rsatiladi.
 */
export type OpeningRow = { name?: unknown; inn?: unknown; amount?: unknown; warehouse?: unknown; qty?: unknown; unitCost?: unknown; note?: unknown };
export type ImportOpeningsResult = { created: number; skipped: string[]; createdEntities: string[]; total: number };

const cut = (l: string[], n = 8) => `${l.slice(0, n).join("; ")}${l.length > n ? `… (jami ${l.length} ta)` : ""}`;
const innOf = (v: unknown) => str(v).replace(/\D+/g, "") || null;

export async function importOpenings(
  kind: OpeningKind,
  rows: OpeningRow[],
  opts: { date: Date; createMissing: boolean; warehouseId: string | null },
  userId: string,
): Promise<ImportOpeningsResult> {
  const errors: string[] = [];
  type Plan = { no: number; label: string; input: Omit<OpeningInput, "customerId" | "supplierId"> & { customerId?: string | null; supplierId?: string | null }; create?: { name: string; inn: string | null } };
  const plans: Plan[] = [];

  // Spravochniklar bir marta o'qiladi
  const [customers, suppliers, accounts, products, warehouses] = await Promise.all([
    kind === "CUSTOMER" ? db.customer.findMany({ where: { isInternal: false }, select: { id: true, name: true, inn: true } }) : [],
    kind === "SUPPLIER" ? db.supplier.findMany({ select: { id: true, name: true, inn: true } }) : [],
    kind === "CASH" ? db.cashAccount.findMany({ select: { id: true, name: true, type: true, allowOverdraft: true } }) : [],
    kind === "STOCK" ? db.product.findMany({ select: { id: true, code: true, name: true } }) : [],
    kind === "STOCK" ? db.warehouse.findMany({ where: { isActive: true }, select: { id: true, name: true } }) : [],
  ]);
  const party = kind === "CUSTOMER" ? customers : suppliers;
  const byInn = new Map(party.filter((p) => p.inn).map((p) => [p.inn!.replace(/\D+/g, ""), p]));
  const byName = new Map(party.map((p) => [flatName(p.name), p]));
  const accByName = new Map(accounts.map((a) => [flatName(a.name), a]));
  const prodByCode = new Map(products.map((p) => [p.code.toLowerCase(), p]));
  const prodByName = new Map(products.map((p) => [flatName(p.name), p]));
  const whByName = new Map(warehouses.map((w) => [flatName(w.name), w]));
  const seen = new Map<string, number>(); // faylning o'zida bitta obyekt ikki marta

  for (const [i, x] of rows.entries()) {
    const no = i + 1;
    const name = str(x.name).replace(/\s+/g, " ");
    if (!name && [x.amount, x.qty].every((v) => str(v) === "")) continue; // bo'sh qator
    if (!name) { errors.push(`${no}-qator: nomi yo'q`); continue; }
    const note = str(x.note) || null;
    const base = { kind, date: opts.date, note };

    if (kind === "CUSTOMER" || kind === "SUPPLIER") {
      const amount = numMoney(x.amount);
      if (!Number.isFinite(amount) || amount === 0) { errors.push(`${no}-qator (${name}): summa raqam va 0 dan farqli bo'lsin — «${str(x.amount)}»`); continue; }
      const inn = innOf(x.inn);
      const found = (inn ? byInn.get(inn) : undefined) ?? byName.get(flatName(name));
      if (!found && !opts.createMissing) { errors.push(`${no}-qator: «${name}» bazada yo'q («bazada yo'qlarini yaratish»ni belgilang yoki avval ${kind === "CUSTOMER" ? "mijozlarni" : "yetkazuvchilarni"} import qiling)`); continue; }
      const k = found ? found.id : `new:${inn ?? flatName(name)}`;
      if (seen.has(k)) { errors.push(`${no}-qator: «${name}» faylda ${seen.get(k)}-qatorda ham bor — bitta qatorga jamlang`); continue; }
      seen.set(k, no);
      plans.push({
        no, label: name,
        input: { ...base, amount, ...(kind === "CUSTOMER" ? { customerId: found?.id ?? null } : { supplierId: found?.id ?? null }) },
        create: found ? undefined : { name, inn },
      });
      continue;
    }
    if (kind === "CASH") {
      const amount = numMoney(x.amount);
      if (!Number.isFinite(amount) || amount === 0) { errors.push(`${no}-qator (${name}): summa raqam va 0 dan farqli bo'lsin — «${str(x.amount)}»`); continue; }
      const acc = accByName.get(flatName(name));
      if (!acc) { errors.push(`${no}-qator: «${name}» hisobi topilmadi (bor hisoblar: ${accounts.map((a) => a.name).join(", ") || "yo'q"} — yangisini Sozlamalarda oching)`); continue; }
      if (seen.has(acc.id)) { errors.push(`${no}-qator: «${name}» faylda ${seen.get(acc.id)}-qatorda ham bor`); continue; }
      // Manfiy qoldiq — faqat overdraft ruxsat etilgan bankda (aks holda yozishda butun import qator raqamisiz yiqilardi)
      if (amount < 0 && !(acc.type === "BANK" && acc.allowOverdraft)) { errors.push(`${no}-qator (${acc.name}): qoldiq manfiy bo'lolmaydi — overdraft faqat ruxsat etilgan bank hisobida`); continue; }
      seen.set(acc.id, no);
      plans.push({ no, label: acc.name, input: { ...base, cashAccountId: acc.id, amount } });
      continue;
    }
    // STOCK
    const p = prodByCode.get(name.toLowerCase()) ?? prodByName.get(flatName(name));
    if (!p) { errors.push(`${no}-qator: «${name}» mahsuloti topilmadi (kodi yoki nomi bo'yicha)`); continue; }
    const whName = str(x.warehouse);
    const wh = whName ? whByName.get(flatName(whName)) : warehouses.find((w) => w.id === opts.warehouseId);
    if (!wh) { errors.push(`${no}-qator (${name}): sklad ${whName ? `«${whName}» topilmadi` : "tanlanmagan — formada standart skladni tanlang"}`); continue; }
    const qty = num(x.qty);
    if (!Number.isFinite(qty) || qty <= 0) { errors.push(`${no}-qator (${name}): miqdor 0 dan katta raqam bo'lsin — «${str(x.qty)}»`); continue; }
    let unitCost: number | null = null;
    if (str(x.unitCost) !== "") {
      unitCost = numMoney(x.unitCost);
      if (!Number.isFinite(unitCost) || unitCost < 0) { errors.push(`${no}-qator (${name}): tannarx raqam bo'lsin — «${str(x.unitCost)}»`); continue; }
    }
    const k = `${p.id}:${wh.id}`;
    if (seen.has(k)) { errors.push(`${no}-qator: «${p.name}» (${wh.name}) faylda ${seen.get(k)}-qatorda ham bor`); continue; }
    seen.set(k, no);
    plans.push({ no, label: `${p.name} · ${wh.name}`, input: { ...base, productId: p.id, warehouseId: wh.id, qty, unitCost } });
  }

  if (errors.length) throw new OpeningError(`${errors.length} ta qatorda xato — hech narsa yozilmadi: ${cut(errors)}`);
  if (!plans.length) throw new OpeningError("Faylda qator topilmadi");

  return db.$transaction(async (tx) => {
    let created = 0;
    const skipped: string[] = [];
    const createdEntities: string[] = [];
    for (const p of plans) {
      // Yangi mijoz/yetkazuvchi — import davomida ochiladi (faqat nomi va INN; qolganini keyin kartadan)
      if (p.create) {
        const c = kind === "CUSTOMER"
          ? await tx.customer.create({ data: { name: p.create.name, inn: p.create.inn, creditLimit: DEFAULT_CREDIT_LIMIT } })
          : await tx.supplier.create({ data: { name: p.create.name, inn: p.create.inn } });
        await audit(tx, userId, "CREATE", kind === "CUSTOMER" ? "Customer" : "Supplier", c.id, undefined, { ...c, via: "opening-import" });
        if (kind === "CUSTOMER") p.input.customerId = c.id; else p.input.supplierId = c.id;
        createdEntities.push(c.name);
      }
      const exists = await tx.openingBalance.findUnique({ where: { activeKey: activeKeyOf(p.input) }, select: { id: true } });
      if (exists) { skipped.push(`${p.no}-qator ${p.label}`); continue; }
      await createOpeningTx(tx, p.input, userId);
      created++;
    }
    return { created, skipped, createdEntities, total: plans.length };
  }, { timeout: 180_000, maxWait: 20_000 });
}
