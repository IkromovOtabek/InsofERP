import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { matchKey, str, valueMapper, type ValueMaps } from "./excel";
import { money } from "./format";
import { RENT_INCOME_CATEGORY, monthKey, rentBalance } from "./rent";
import { isEmptySpot, isTotalRow, rentMoney } from "./rent-sheet";

/**
 * Arenda oy varag'ini Excel'dan import (sekretarning «Аренда …xlsx» daftari) — bitta varaq = bitta oy.
 *
 *  · do'kon (bozor + nom) bazada yo'q bo'lsa qo'shiladi (oylik summalar — andoza), bor bo'lsa topiladi
 *    (nom kirill/lotinda farq qilsa ham — `matchKey`);
 *  · shu oy hisobi (`RentCharge`) fayldagi summalar bilan yoziladi (bor bo'lsa yangilanadi);
 *  · «… o'tgan / bergan summa» — arenda kassasiga shu oy uchun kirim (`withPayments`). Kirim kaliti
 *    (`clientToken`) oy + do'kon + usul + summadan: fayl qayta import qilinsa ikkinchi marta yozilmaydi,
 *    summa o'zgargan bo'lsa eski kirim sabab bilan bekor qilinib, yangisi yoziladi (hujjat o'chirilmaydi).
 */

export type RentImportRow = Record<string, unknown>;
export type RentImportInput = { month: Date; rows: RentImportRow[]; groupRows: boolean; withPayments: boolean; valueMaps: ValueMaps };
export type RentImportResult = { shops: number; newShops: number; charges: number; payments: number; replaced: number; skipped: number };

/** Foydalanuvchiga ko'rsatiladigan xato (fayldagi qator, summa) — server action uni `error` qilib qaytaradi. */
export class RentImportError extends Error {}

const r2 = (v: number) => Math.round(v * 100) / 100;
const lockKassa = (tx: Prisma.TransactionClient) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('rent:kassa'))`;
const tokenPrefix = (month: Date, shopId: string, method: "BANK" | "CASH") => `imp-${monthKey(month)}-${shopId}-${method}`;
/** `clientToken` ustuniga sig'sin: prefiks + summa (tiyinda) — xesh bilan qisqartiriladi. */
const tokenOf = (prefix: string, amount: number) => `${prefix}-${createHash("sha1").update(String(Math.round(amount * 100))).digest("hex").slice(0, 8)}`;

export async function importRentSheet(input: RentImportInput, userId: string): Promise<RentImportResult> {
  const { month } = input;
  const mapLoc = valueMapper(input.valueMaps, "location");
  // Kirim sanasi: oy oxiri, joriy oy bo'lsa — bugun (kelajak sanasi jurnalda chiqmasin)
  const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const txDate = end < today ? end : today;

  type Line = { no: number; name: string; location: string; bankDue: number; cashDue: number; electricity: number; tax: number; bankPaid: number; cashPaid: number; note: string | null };
  const lines: Line[] = [];
  let group = "";
  let skipped = 0;
  for (const [i, x] of input.rows.entries()) {
    const no = i + 1;
    const name = str(x.name).replace(/\s+/g, " ");
    const own = mapLoc(str(x.location).replace(/\s+/g, " "));
    if (!name) { if (own) group = own; continue; }
    const amounts = { bankDue: x.bankDue, cashDue: x.cashDue, electricity: x.electricity, tax: x.tax, bankPaid: x.bankPaid, cashPaid: x.cashPaid };
    const filled = Object.values(amounts).some((v) => rentMoney(v) !== 0) || str(x.note) !== "";
    // Faqat nomi yozilgan qator — bozor sarlavhasi («Техно сити бозор»)
    if (input.groupRows && !own && !filled && !isEmptySpot(name) && !isTotalRow(name)) { group = mapLoc(name); continue; }
    if (isTotalRow(name) || isEmptySpot(name)) { skipped++; continue; }
    const v: Record<string, number> = {};
    for (const [k, raw] of Object.entries(amounts)) {
      const n = rentMoney(raw);
      if (!Number.isFinite(n)) throw new RentImportError(`${no}-qator (${name}): summa o'qilmadi — «${str(raw)}»`);
      if (n < 0) throw new RentImportError(`${no}-qator (${name}): summa manfiy bo'lmasin — «${str(raw)}»`);
      v[k] = r2(n);
    }
    // Hech qanday summa yo'q qator — izoh yoki eslatma («Чутки шоп … 1500 $ заклад»), do'kon emas
    if (v.bankDue + v.cashDue + v.bankPaid + v.cashPaid === 0) { skipped++; continue; }
    const location = own || group;
    if (!location) throw new RentImportError(`${no}-qator (${name}): bozor (joy) aniqlanmadi — «Bozor» ustunini tanlang yoki sarlavha qatorlarini yoqing`);
    if (name.length > 200) throw new RentImportError(`${no}-qator: do'kon nomi juda uzun — bu izoh qatori bo'lsa, uni fayldan olib tashlang`);
    lines.push({ no, name, location: location.slice(0, 120), bankDue: v.bankDue, cashDue: v.cashDue, electricity: v.electricity, tax: v.tax, bankPaid: v.bankPaid, cashPaid: v.cashPaid, note: str(x.note) || null });
  }
  if (!lines.length) throw new RentImportError("Import qilinadigan do'kon qatori topilmadi — «Do'kon nomi» va summa ustunlarini tekshiring");

  const res: RentImportResult = { shops: 0, newShops: 0, charges: 0, payments: 0, replaced: 0, skipped };
  try {
    await db.$transaction(async (tx) => {
      await lockKassa(tx);
      const shops = await tx.rentShop.findMany();
      let order = shops.reduce((m, s) => Math.max(m, s.sortOrder), 0);
      const seen = new Set<string>();
      for (const l of lines) {
        const shop = shops.find((s) => s.location === l.location && s.name === l.name)
          ?? shops.find((s) => matchKey(s.location) === matchKey(l.location) && matchKey(s.name) === matchKey(l.name));
        let id = shop?.id;
        if (!id) {
          const created = await tx.rentShop.create({ data: { name: l.name, location: l.location, bankAmount: l.bankDue, cashAmount: l.cashDue, electricity: l.electricity, tax: l.tax, sortOrder: ++order } });
          await audit(tx, userId, "CREATE", "RentShop", created.id, undefined, { ...created, source: "excel" });
          shops.push(created);
          id = created.id;
          res.newShops++;
        }
        if (seen.has(id)) throw new RentImportError(`${l.no}-qator: «${l.location} — ${l.name}» faylda ikki marta uchradi`);
        seen.add(id);
        res.shops++;

        const charge = { bankDue: l.bankDue, cashDue: l.cashDue, electricity: l.electricity, tax: l.tax, note: l.note };
        const before = await tx.rentCharge.findUnique({ where: { shopId_month: { shopId: id, month } } });
        const c = await tx.rentCharge.upsert({ where: { shopId_month: { shopId: id, month } }, create: { shopId: id, month, ...charge }, update: charge });
        await audit(tx, userId, before ? "UPDATE" : "CREATE", "RentCharge", c.id, before ?? undefined, { ...c, source: "excel" });
        res.charges++;

        if (!input.withPayments) continue;
        for (const [method, amount] of [["BANK", l.bankPaid], ["CASH", l.cashPaid]] as const) {
          const prefix = tokenPrefix(month, id, method);
          const token = tokenOf(prefix, amount);
          // Avvalgi importdan qolgan, summasi boshqa kirim — sabab bilan bekor qilinadi (qo'lda yozilganlarga tegilmaydi)
          const old = await tx.rentTx.findMany({ where: { clientToken: { startsWith: `${prefix}-` }, cancelledAt: null, NOT: { clientToken: token } } });
          for (const o of old) {
            await tx.rentTx.update({ where: { id: o.id }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: "Excel qayta import: summa o'zgardi" } });
            await audit(tx, userId, "STATUS_CHANGE", "RentTx", o.id, { cancelledAt: null }, { cancelReason: "Excel qayta import: summa o'zgardi" });
            res.replaced++;
          }
          if (!(amount > 0)) continue;
          // Shu summa allaqachon import qilingan (yoki keyin qo'lda bekor qilingan — qayta tiriltirilmaydi)
          if (await tx.rentTx.findUnique({ where: { clientToken: token }, select: { id: true } })) continue;
          const t = await tx.rentTx.create({
            data: { type: "INCOME", method, date: txDate, month, shopId: id, amount, category: RENT_INCOME_CATEGORY, note: "Excel'dan import", clientToken: token, createdById: userId },
          });
          await audit(tx, userId, "CREATE", "RentTx", t.id, undefined, t);
          res.payments++;
        }
      }
      // Eski kirim bekor qilinib, o'rniga kichigi yozilgan bo'lsa — kassa minusga tushmasin
      const b = await rentBalance(tx);
      if (b.cash < -0.005 || b.bank < -0.005) {
        throw new RentImportError(`Import kassani minusga tushiradi (naqd ${money(b.cash)}, perechisleniye ${money(b.bank)}) — avval kassadan chiqim qilingan pulni tekshiring`);
      }
    }, { timeout: 60_000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new RentImportError("Bir xil do'kon ikki marta qo'shilmoqda — fayldagi takroriy nomlarni tekshiring");
    throw e;
  }
  return res;
}
