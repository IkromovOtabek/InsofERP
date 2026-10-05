import { db } from "@/lib/db";
import { unpaidReceipts, type UnpaidReceipt } from "@/lib/receipt-payables";
import { supplierOpeningDues } from "@/lib/opening-balances";
import { totalPlanned } from "@/lib/supply";

/**
 * Kreditorka (bizning yetkazuvchilarga qarzimiz) — mobil dashboard kartasi va uning batafsili uchun yagona hisob.
 *
 * Vebdagi yetkazuvchi kartochkasi (`supplierLedger`, lib/receipt-payables.ts) bilan bir qoida:
 *  · to'lanmagan kirimlar (`unpaidReceipts`: storno qilinganlar va ta'minot zanjiridan kelganlar kirmaydi);
 *  · boshlang'ich qoldiqdan qolgan qarz (faqat musbat qismi — manfiysi bizning avansimiz);
 * va qo'shimcha ravishda — tasdiqlangan, moliya hali pul ajratmagan ta'minot zayavkalari (yaqin to'lov).
 *
 * Ilgari karta faqat ta'minot zayavkalarini (APPROVED + FUNDED) sanardi: kirim hujjati bo'yicha qarz va
 * boshlang'ich qoldiq umuman ko'rinmasdi, FUNDED (puli allaqachon chiqim qilingan) esa qarz deb ikki marta
 * hisoblanardi. Qarz — hozirgi holat (davr bo'yicha emas): to'lov bo'lmaguncha qarz davrdan qat'i nazar turadi.
 */
export type SupplierDebt = { id: string; name: string; receipts: number; opening: number; supply: number; total: number };
export type Payables = {
  total: number;
  receipts: { total: number; count: number; rows: UnpaidReceipt[] };
  opening: { total: number; count: number };
  supply: { total: number; count: number; rows: { id: string; docNo: string; supplier: string | null; total: number; needBy: Date | null; label: string }[] };
  /** Pul ajratilgan, mol hali kelmagan (avans) — kreditorkaga kirmaydi, ma'lumot uchun */
  funded: { total: number; count: number };
  bySupplier: SupplierDebt[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function payables(): Promise<Payables> {
  const [receipts, openings, supply] = await Promise.all([
    unpaidReceipts(),
    supplierOpeningDues(),
    db.supplyRequest.findMany({
      where: { status: { in: ["APPROVED", "FUNDED"] } },
      orderBy: [{ needBy: "asc" }, { date: "asc" }],
      include: { items: true, supplier: { select: { id: true, name: true } }, warehouse: { select: { name: true } } },
    }),
  ]);
  const openDebt = openings.filter((o) => o.left > 0.005);
  const approved = supply.filter((s) => s.status === "APPROVED");
  const funded = supply.filter((s) => s.status === "FUNDED");

  const names = new Map<string, string>();
  for (const r of receipts) names.set(r.supplierId, r.supplier);
  const missing = [...new Set(openDebt.map((o) => o.supplierId))].filter((id) => !names.has(id));
  if (missing.length) for (const s of await db.supplier.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })) names.set(s.id, s.name);

  const by = new Map<string, SupplierDebt>();
  const row = (id: string, name: string) => {
    let x = by.get(id);
    if (!x) { x = { id, name, receipts: 0, opening: 0, supply: 0, total: 0 }; by.set(id, x); }
    return x;
  };
  for (const r of receipts) { const x = row(r.supplierId, r.supplier); x.receipts += r.left; x.total += r.left; }
  for (const o of openDebt) { const x = row(o.supplierId, names.get(o.supplierId) ?? "Yetkazuvchi"); x.opening += o.left; x.total += o.left; }
  const supplyRows = approved.map((s) => ({
    id: s.id, docNo: s.docNo, supplier: s.supplier?.name ?? null, total: totalPlanned(s), needBy: s.needBy,
    label: `${s.docNo} · ${s.department ?? s.warehouse.name}`,
  }));
  for (const s of approved) {
    const t = totalPlanned(s);
    const x = s.supplier ? row(s.supplier.id, s.supplier.name) : row("—", "Yetkazuvchi tanlanmagan");
    x.supply += t; x.total += t;
  }

  const rTotal = r2(receipts.reduce((s, r) => s + r.left, 0));
  const oTotal = r2(openDebt.reduce((s, o) => s + o.left, 0));
  const sTotal = r2(supplyRows.reduce((s, r) => s + r.total, 0));
  return {
    total: r2(rTotal + oTotal + sTotal),
    receipts: { total: rTotal, count: receipts.length, rows: receipts },
    opening: { total: oTotal, count: openDebt.length },
    supply: { total: sTotal, count: supplyRows.length, rows: supplyRows },
    funded: { total: r2(funded.reduce((s, x) => s + totalPlanned(x), 0)), count: funded.length },
    bySupplier: [...by.values()].sort((a, b) => b.total - a.total),
  };
}
