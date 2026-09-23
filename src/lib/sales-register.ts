import { db } from "./db";
import { audit } from "./audit";
import type { Prisma } from "@/generated/prisma";

/**
 * Realizatsiya jurnali — buxgalteriya Excel'da yuritadigan kunlik jo'natma jadvali
 * (Kassa/bank → "Excel orqali qo'shish"). Bu yerda faqat qoida va baza ishi:
 * sessiya tekshiruvi va `revalidatePath` chaqiruvchi server action'da.
 */

type Tx = Prisma.TransactionClient;

/** Nomlarni taqqoslash uchun: «"SAM GOLDEN FIRM" MCHJ» → samgoldenfirmmchj */
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яёўқғҳ]+/gi, "");

/**
 * "Деньги" ustuni → pul qaysi hisobga tushadi:
 * н-к (наличка) — naqd kassa, п-р (перечисление) — bank hisobi. Tanib bo'lmasa null.
 */
export function payKind(v: string): "CASH" | "BANK" | null {
  const s = v.toLowerCase().replace(/[\s.,'"]/g, "");
  if (!s) return null;
  if (/^(н-?к|нал|naqd|nk|nal)/.test(s)) return "CASH";
  if (/^(п-?р|перечисл|безнал|б\/?н|pr|otkazma|o‘tkazma|o'tkazma|bank|plastik)/.test(s)) return "BANK";
  return null;
}

/** Kassa/bank sahifasida ko'rsatiladigan nom. */
export const payKindLabel = (v: string | null) => {
  const k = payKind(v ?? "");
  return k === "CASH" ? "naqd" : k === "BANK" ? "o'tkazma" : v || "—";
};

/**
 * Fayldagi mijoz nomlarini bazadagi mijozlarga moslaydi.
 * `createMissing` bo'lsa topilmagani yangi mijoz sifatida ochiladi (standart kredit limiti bilan),
 * aks holda `missing` ro'yxatida qaytadi va import to'xtaydi.
 */
export async function resolveCustomers(tx: Tx, names: string[], createMissing: boolean) {
  const all = await tx.customer.findMany({ select: { id: true, name: true } });
  const byKey = new Map(all.map((c) => [flat(c.name), c]));
  const result = new Map<string, { id: string; name: string }>();
  const missing: string[] = [];
  const created: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = flat(name);
    if (!key || result.has(key)) continue;
    const found = byKey.get(key);
    if (found) { result.set(key, found); continue; }
    if (!createMissing) { missing.push(name); continue; }
    const c = await tx.customer.create({ data: { name }, select: { id: true, name: true } });
    byKey.set(key, c); result.set(key, c); created.push(c.name);
  }
  return { result, missing: [...new Set(missing)], created };
}

/** Fayldan kelgan bitta qator (raqamlar tozalangan holda). */
export type RegisterRow = {
  date: Date;
  customer: string;
  productName: string;
  qty: number;
  unit?: string;
  vehicleNo?: string;
  ttn?: string;
  fromWho?: string;
  payType?: string;
  deliveryFee?: number;
  price?: number;
  sum?: number;
  nds?: number;
  total?: number;
  address?: string;
  contractNo?: string;
  invoiceNo?: string;
  monthNo?: string;
  note?: string;
};

export type RegisterImportInput = {
  rows: RegisterRow[];
  /** н-к qatorlar shu kassaga yoziladi */
  cashAccountId: string;
  /** п-р qatorlar shu bank hisobiga yoziladi */
  bankAccountId: string;
  /** Ro'yxatda yo'q mijozlar ochilsinmi */
  createMissing: boolean;
  /** Har qator summasi kassaga kirim (Payment) bo'lib tushsinmi */
  toCash: boolean;
};

/**
 * Summa ustunlari: fayldagi qiymat ustun turadi, bo'sh bo'lsa hisoblanadi.
 * Rasmdagi jadvalda "Общие Сумма" = miqdor × narx + dostavka, "Итого Сумма" = summa + NDS.
 */
export function rowAmounts(r: RegisterRow) {
  const qty = Number.isFinite(r.qty) ? r.qty : 0;
  const price = Number.isFinite(r.price) ? r.price! : 0;
  const delivery = Number.isFinite(r.deliveryFee) ? r.deliveryFee! : 0;
  const sum = Number.isFinite(r.sum) && r.sum! > 0 ? r.sum! : qty * price + delivery;
  const nds = Number.isFinite(r.nds) ? r.nds! : 0;
  const total = Number.isFinite(r.total) && r.total! > 0 ? r.total! : sum + nds;
  return { qty, price, delivery, sum, nds, total };
}

export type RegisterImportResult = {
  batch: string;
  rows: number;
  customers: number;
  createdCustomers: string[];
  payments: number;
  amount: number;
  unknownPayType: number;
};

/**
 * Import: har qator jurnalga tushadi, `toCash` bo'lsa yana kassa kirimi (Payment) yoziladi.
 * Qator ↔ to'lov bog'langan: import partiyasi o'chirilsa to'lovlar ham o'chadi (balans tiklanadi).
 * "Деньги" ustuni tanilmasa — pul naqd kassaga yoziladi (jurnalda ko'rinadi, keyin tuzatish mumkin).
 */
export async function importSalesRegister(input: RegisterImportInput, userId: string): Promise<RegisterImportResult> {
  const batch = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return db.$transaction(async (tx) => {
    const { result, missing, created } = await resolveCustomers(tx, input.rows.map((r) => r.customer), input.createMissing);
    if (missing.length) {
      throw new Error(`Bunday mijoz yo'q: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}. "Ro'yxatda yo'q mijozlarni yaratish" ni belgilang.`);
    }

    let payments = 0, amount = 0, unknownPayType = 0;
    for (const r of input.rows) {
      const customer = result.get(flat(r.customer))!;
      const a = rowAmounts(r);
      const kind = payKind(r.payType ?? "");
      if (!kind) unknownPayType++;
      const accountId = kind === "BANK" ? input.bankAccountId : input.cashAccountId;

      // Pul kassaga: schyotga bog'lanmaydi (avans/tushum sifatida) — mavjud schyot holatlari o'zgarmasin
      let paymentId: string | undefined;
      if (input.toCash && a.total > 0) {
        const p = await tx.payment.create({
          data: {
            customerId: customer.id, cashAccountId: accountId, amount: a.total, date: r.date,
            note: ["Realizatsiya", r.productName, r.ttn ? `TTN ${r.ttn}` : "", r.invoiceNo ? `Schyot ${r.invoiceNo}` : ""].filter(Boolean).join(" · "),
          },
          select: { id: true },
        });
        paymentId = p.id; payments++; amount += a.total;
      }

      await tx.salesRegister.create({
        data: {
          date: r.date, customerId: customer.id, productName: r.productName.trim(),
          unit: r.unit?.trim() || "m3", qty: a.qty,
          vehicleNo: r.vehicleNo?.trim() || null, ttn: r.ttn?.trim() || null, fromWho: r.fromWho?.trim() || null,
          payType: r.payType?.trim() || null, deliveryFee: a.delivery, price: a.price, sum: a.sum, nds: a.nds, total: a.total,
          address: r.address?.trim() || null, contractNo: r.contractNo?.trim() || null, invoiceNo: r.invoiceNo?.trim() || null,
          monthNo: r.monthNo?.trim() || null, note: r.note?.trim() || null,
          cashAccountId: input.toCash && a.total > 0 ? accountId : null,
          paymentId, batch, createdById: userId,
        },
      });
    }

    // Har qator uchun emas — butun partiya uchun bitta audit yozuvi
    await audit(tx, userId, "CREATE", "SalesRegister", batch, undefined, {
      rows: input.rows.length, customers: result.size, createdCustomers: created, payments, amount, toCash: input.toCash,
    });

    return { batch, rows: input.rows.length, customers: result.size, createdCustomers: created, payments, amount, unknownPayType };
  }, { timeout: 120_000, maxWait: 15_000 });
}

/** Import partiyasini butunlay qaytarish: qatorlar va ular yozgan kassa kirimlari o'chadi. */
export async function deleteRegisterBatch(batch: string, userId: string) {
  return db.$transaction(async (tx) => {
    const rows = await tx.salesRegister.findMany({ where: { batch }, select: { id: true, paymentId: true } });
    if (!rows.length) return { rows: 0, payments: 0 };
    await tx.salesRegister.deleteMany({ where: { batch } });
    const payIds = rows.map((r) => r.paymentId).filter((x): x is string => !!x);
    if (payIds.length) await tx.payment.deleteMany({ where: { id: { in: payIds } } });
    await audit(tx, userId, "DELETE", "SalesRegister", batch, { rows: rows.length, payments: payIds.length }, undefined);
    return { rows: rows.length, payments: payIds.length };
  });
}
