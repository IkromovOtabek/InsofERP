import { db } from "./db";
import { notifyRoles } from "@/lib/notify";
import { audit } from "./audit";
import { upsertRecipient } from "./stock-recipients";
import { nextNo } from "./numbering";
import { MAX_AMOUNT, validDate } from "./action";
import { cashOutflowError } from "./payments";
import { Prisma, type ReceiptPayment, type Role } from "@/generated/prisma";
import { companyVatPayer, isVatRate, receiptTotal, supplierVatRate, vatLine, type VatRate } from "./receipt-vat";

/**
 * Kirim (GoodsReceipt) — yagona yaratish qoidasi va «Kirim» jurnali (Sklad → Kirim, avval «Приход»).
 *
 * `createGoodsReceipt` ni chaqiradiganlar: Kirim formasi (`receipts/actions.ts#createReceipt`),
 * Sklad → «Kirim» formasi (`stock/prixod/actions.ts`) va ECO ilova. Xato matnlari o'zbekcha («Рус» rejimida lug'atdan).
 * Ruxsat (`requireAction("stock", "receipt")`)
 * chaqiruvchida tekshiriladi; bu yerda faqat direktor hisobi (to'lov) qoidasi.
 *
 * Summalar `lib/receipt-vat.ts` da: narx QQS'siz, QQS (0/6/12%) faqat tovarga, «Доставка» QQS'siz va
 * Общие/Итого ga hamda sklad tannarxiga (birlikka bo'lib) qo'shiladi.
 */

export type ReceiptInput = {
  supplierId: string;
  warehouseId: string;
  /** YYYY-MM-DD */
  date: string;
  /** ТТН — yuk xati / nakladnoy raqami */
  waybillNo?: string | null;
  /** Деньги: П-р (BANK) / Н-к (CASH). CASH — barcha qatorlar QQS'siz */
  payment?: "BANK" | "CASH" | null;
  /** Кому — faol StockRecipient */
  recipientId?: string | null;
  /** Адрес */
  address?: string | null;
  /** Снабженец — faol foydalanuvchi (bo'sh bo'lsa jurnalda kiritgan xodim ko'rinadi) */
  buyerId?: string | null;
  /** Почему */
  purpose?: string | null;
  /** «Mashina (kim olib keldi)»: «Ta'minotchi o'zi», transport firma, haydovchi yoki mashina raqami */
  carrier?: string | null;
  /** «Qayerdan yuklandi» — yuk ortilgan joy */
  loadedFrom?: string | null;
  /**
   * «Darhol kimga berildi (avto chiqim)» — faol StockRecipient. Mol skladga tushmay to'g'ri shu oluvchiga ketdi
   * (sement → BRU): har qatorga kirim bilan bir tranzaksiyada ISSUE (−qty, o'sha tannarx, refType "GoodsReceipt") yoziladi —
   * sklad qoldig'i o'zgarmaydi, Chiqim jurnalida «avto» qatori chiqadi, storno ikkalasini ham teskari yozadi
   */
  autoIssueToId?: string | null;
  /**
   * «Kimga» (darhol chiqim) — brigada yoki xodim ham bo'lishi mumkin: "b:<id>" | "e:<id>" | "r:<id>" (`autoIssueToId` o'rniga).
   * Brigadaga — StockMove BRIGADE_ISSUE + BrigadeMove ISSUE (brigada qo'lidagi qoldiqqa), xodimga — ISSUE (employeeId).
   */
  autoIssueKey?: string | null;
  note?: string | null;
  vehicle?: string | null;
  /** Tarozi, kg: brutto va tara ikkalasi birga beriladi */
  gross?: number | null;
  tare?: number | null;
  /** Faqat direktor: shu hisobdan darhol to'langan deb yoziladi (boshqa rolda e'tiborsiz qoldiriladi) */
  cashAccountId?: string | null;
  /** Formadagi bir martalik kalit — ikki marta yuborish ikkinchi kirim ochmaydi */
  clientToken?: string | null;
  items: { materialId: string; qty: number; price: number; vatRate?: VatRate | null; deliveryCost?: number | null }[];
};

/** @deprecated Xatolar doim o'zbekcha (ruschasi — «Рус» rejimida lug'atdan); parametr eski chaqiruvlar buzilmasligi uchun qoldi. */
export type ReceiptLang = "uz" | "ru";

/** Formadagi bir martalik kalit: bo'sh yoki g'alati bo'lsa — e'tiborga olinmaydi. */
export const receiptTokenOf = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return /^[A-Za-z0-9-]{16,64}$/.test(t) ? t : null;
};

/** Tranzaksiya ichidan foydalanuvchiga ko'rinadigan xato (kassa yetmaydi va h.k.). */
class ReceiptError extends Error {}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Miqdor — Decimal(18,3): bazaga yozilgani bilan summa hisobi bir xil bo'lsin. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clean =(v: string | null | undefined, max = 300) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Nakladnoy raqami, mashina va tarozi (brutto − tara = netto) — kirim izohiga bir xil tuzilishda yoziladi:
 * "Nakladnoy № 123 · Mashina 01A123BC · Tarozi: brutto 32 500, tara 12 300, netto 20 200 kg · <izoh>".
 * ТТН alohida `waybillNo` ustunida ham turadi; izohdagisi eski kirimlar bilan bir xil qidirish va chop uchun.
 */
export function receiptNote(
  d: { note?: string | null; waybillNo?: string | null; vehicle?: string | null; gross?: number | null; tare?: number | null },
): { note: string | null } | { error: string } {
  const gross = d.gross ?? null, tare = d.tare ?? null;
  if (gross != null && !(Number.isFinite(gross) && gross > 0 && gross <= MAX_AMOUNT)) return { error: "Brutto og'irligi noto'g'ri" };
  if (tare != null && !(Number.isFinite(tare) && tare >= 0 && tare <= MAX_AMOUNT)) return { error: "Tara og'irligi noto'g'ri" };
  if ((gross == null) !== (tare == null)) return { error: "Tarozi: brutto va tara ikkalasini ham kiriting" };
  if (gross != null && tare != null && tare >= gross) return { error: "Tara bruttodan kichik bo'lishi kerak" };
  const parts = [
    d.waybillNo ? `Nakladnoy № ${d.waybillNo}` : null,
    d.vehicle ? `Mashina ${d.vehicle.toUpperCase()}` : null,
    gross != null && tare != null ? `Tarozi: brutto ${gross}, tara ${tare}, netto ${Math.round((gross - tare) * 1000) / 1000} kg` : null,
    d.note,
  ].filter(Boolean);
  return { note: parts.length ? parts.join(" · ") : null };
}

/**
 * Kirim: GoodsReceipt + har qator uchun StockMove RECEIPT (+qty, unitCost = tannarx + dostavka / qty).
 * Miqdor 3 kasrga yaxlitlanadi (bazadagi Decimal(18,3) bilan summalar bir xil; 0,001 dan kami — xato). Narx QQS'siz; QQS stavkasi: yetkazuvchi QQS to'lovchisi emas yoki «Н-к» (naqd) — 0, aks holda qator stavkasi
 * (berilmasa 12). Direktor hisob tanlasa — shu zahoti chiqim (naqd kassa minusga tushmasin), aks holda
 * kirim «To'lanmagan kirimlar» ga tushadi va moliya to'laydi.
 *
 * Xato bo'lsa `Error` tashlaydi (matn o'zbekcha; `opts.lang` e'tiborsiz — eski chaqiruvlar uchun). `clientToken` bilan kirim allaqachon bo'lsa — o'shani
 * `existed: true` bilan qaytaradi (ikki marta bosish yoki parallel yuborish, P2002).
 */
export async function createGoodsReceipt(
  input: ReceiptInput,
  actor: { userId: string; role: Role },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- eski chaqiruvlar (`{ lang: "ru" }`) buzilmasin
  opts: { lang?: ReceiptLang } = {},
): Promise<{ id: string; docNo: string; existed: boolean }> {
  function fail(msg: string): never { throw new Error(msg); }

  if (!input.date || !validDate(input.date)) fail("Sana noto'g'ri — 2000-yildan bugungacha bo'lsin");
  const date = new Date(input.date);
  const raw = (input.items ?? []).filter((i) => i && i.materialId);
  if (!raw.length) fail("Kamida bitta qator kerak");
  if (raw.some((i) => !(Number.isFinite(i.qty) && i.qty > 0 && i.qty <= MAX_AMOUNT) || !(Number.isFinite(i.price) && i.price >= 0 && i.price <= MAX_AMOUNT))) {
    fail("Har qatorda miqdor va narx bo'lsin");
  }
  if (raw.some((i) => r3(i.qty) < 0.001)) fail("Miqdor juda kichik — kamida 0,001");
  if (raw.some((i) => i.vatRate != null && !isVatRate(Number(i.vatRate)))) fail("QQS stavkasi 0, 6 yoki 12% bo'lsin");
  if (raw.some((i) => i.deliveryCost != null && !(Number.isFinite(i.deliveryCost) && i.deliveryCost >= 0 && i.deliveryCost <= MAX_AMOUNT))) {
    fail("Dostavka summasi manfiy bo'lmasin");
  }
  const payment: ReceiptPayment | null = input.payment ?? null;
  if (payment != null && payment !== "BANK" && payment !== "CASH") fail("To'lov turi noto'g'ri");
  const n = receiptNote({ note: clean(input.note, 1000), waybillNo: clean(input.waybillNo, 60), vehicle: clean(input.vehicle, 30), gross: input.gross, tare: input.tare });
  if ("error" in n) throw new Error(n.error);

  // Ikki marta bosilgan "Saqlash" (yoki tarmoq qayta yuborgan so'rov) ikkinchi kirim ochmasin:
  // shu kalit bilan kirim allaqachon bor bo'lsa — o'shanga qaytamiz. Poyga holati — `clientToken` unique.
  const clientToken = receiptTokenOf(input.clientToken);
  if (clientToken) {
    const dup = await db.goodsReceipt.findUnique({ where: { clientToken }, select: { id: true, docNo: true } });
    if (dup) return { ...dup, existed: true };
  }

  // Sklad, yetkazuvchi, xomashyo, hisob, oluvchi va snabjenets — mavjud va faol bo'lsin (aks holda FK xatosi → 500)
  const isDirector = actor.role === "DIRECTOR";
  const accId = isDirector ? clean(input.cashAccountId, 64) : null;
  const recipientId = clean(input.recipientId, 64), buyerId = clean(input.buyerId, 64);
  // «Kimga» (darhol chiqim): kalit "b:" / "e:" / "r:" yoki eski `autoIssueToId` (oluvchi)
  const autoKey = /^([ber]):(.{1,64})$/.exec(clean(input.autoIssueKey, 70) ?? "");
  const autoToId = autoKey ? (autoKey[1] === "r" ? autoKey[2] : null) : clean(input.autoIssueToId, 64);
  const autoBrigadeId = autoKey?.[1] === "b" ? autoKey[2] : null, autoEmployeeId = autoKey?.[1] === "e" ? autoKey[2] : null;
  const ids = [...new Set(raw.map((i) => i.materialId))];
  const [wh, sup, mats, acc, recipient, buyer, autoTo, autoBrigade, autoEmployee] = await Promise.all([
    db.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true }, select: { id: true } }),
    db.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true, isActive: true, vatPayer: true } }),
    db.material.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } }),
    accId ? db.cashAccount.findFirst({ where: { id: accId, isActive: true }, select: { id: true, type: true } }) : Promise.resolve(null),
    recipientId ? db.stockRecipient.findFirst({ where: { id: recipientId, isActive: true }, select: { id: true } }) : Promise.resolve(null),
    buyerId ? db.user.findFirst({ where: { id: buyerId, isActive: true }, select: { id: true } }) : Promise.resolve(null),
    autoToId ? db.stockRecipient.findFirst({ where: { id: autoToId, isActive: true }, select: { id: true, name: true } }) : Promise.resolve(null),
    autoBrigadeId ? db.brigade.findFirst({ where: { id: autoBrigadeId, isActive: true }, select: { id: true, name: true } }) : Promise.resolve(null),
    autoEmployeeId ? db.employee.findFirst({ where: { id: autoEmployeeId, isActive: true }, select: { id: true, fullName: true } }) : Promise.resolve(null),
  ]);
  if (!wh) fail("Sklad topilmadi yoki yopilgan");
  if (!sup) fail("Yetkazuvchi topilmadi");
  if (!sup.isActive) fail(`"${sup.name}" yopilgan — avval Yetkazuvchilar bo'limida faollashtiring`);
  if (mats.length !== ids.length) fail("Xomashyo topilmadi — sahifani yangilang");
  if (mats.some((m) => !m.isActive)) fail("Yopilgan xomashyoga kirim qilinmaydi");
  if (accId && !acc) fail("To'lov hisobi topilmadi yoki yopilgan");
  if (acc && payment && acc.type !== payment) {
    fail(payment === "CASH" ? "Naqd pul kirimi — faqat naqd kassadan to'lanadi" : "Bank o'tkazma kirimi — faqat bank hisobidan to'lanadi");
  }
  if (recipientId && !recipient) fail("Oluvchi («Kimga») topilmadi yoki yopilgan");
  if (buyerId && !buyer) fail("Snabjenets topilmadi yoki ishdan bo'shagan");
  if (autoToId && !autoTo) fail("«Kimga» oluvchisi topilmadi yoki yopilgan");
  if (autoBrigadeId && !autoBrigade) fail("«Kimga» brigadasi topilmadi yoki nofaol");
  if (autoEmployeeId && !autoEmployee) fail("«Kimga» xodimi topilmadi yoki ishdan bo'shagan");

  // QQS: QQS to'lovchisi bo'lmagan yetkazuvchi va naqd (Н-к) kirim QQS bermaydi — stavka majburan 0.
  // Aks holda qator stavkasi (0 — QQS'dan ozod tovar yoki 12), berilmasa 12.
  const vatPayer = await companyVatPayer();
  const noVat = !sup.vatPayer || payment === "CASH";
  const defRate = supplierVatRate(sup.vatPayer);
  const items = raw.map((i) => {
    const rate: VatRate = noVat ? 0 : i.vatRate != null ? (Number(i.vatRate) as VatRate) : defRate;
    return { materialId: i.materialId, ...vatLine(r3(i.qty), i.price, rate, vatPayer, false, i.deliveryCost ?? 0) };
  });
  const total = receiptTotal(items);
  if (total > MAX_AMOUNT) fail("Kirim summasi juda katta");

  try {
    const created = await db.$transaction(async (tx) => {
      const rec = await tx.goodsReceipt.create({
        data: {
          docNo: await nextNo(tx, "goodsReceipt", "K"), date, supplierId: sup.id, warehouseId: wh.id, note: n.note, createdById: actor.userId, clientToken,
          waybillNo: clean(input.waybillNo, 60), payment, recipientId: recipient?.id ?? null, address: clean(input.address), buyerId: buyer?.id ?? null, purpose: clean(input.purpose),
          carrier: clean(input.carrier, 120), loadedFrom: clean(input.loadedFrom), autoIssueToId: autoTo?.id ?? null,
          autoIssueBrigadeId: autoBrigade?.id ?? null, autoIssueEmployeeId: autoEmployee?.id ?? null,
          items: { create: items.map((i) => ({ materialId: i.materialId, qty: i.qty, price: i.price, vatRate: i.vatRate, vatAmount: i.vatAmount, deliveryCost: i.deliveryCost })) },
        },
      });
      await tx.stockMove.createMany({
        data: items.map((i) => ({
          type: "RECEIPT" as const, date, warehouseId: wh.id, materialId: i.materialId,
          qty: i.qty, unitCost: i.unitCost, refType: "GoodsReceipt", refId: rec.id, createdById: actor.userId,
        })),
      });
      // «Darhol kimga berildi»: mol skladda turmaydi — kirim bilan bir vaqtda o'sha oluvchiga chiqim (o'sha tannarx bilan).
      // Kirim bilan bitta hujjat (refType "GoodsReceipt"): storno ikkalasini ham teskari yozadi, qoldiq jami o'zgarmaydi
      // Oluvchi yoki xodim — ISSUE (sarf); brigada — BRIGADE_ISSUE + BrigadeMove ISSUE (brigada qo'lidagi qoldiqqa o'tadi)
      if (autoTo || autoEmployee) {
        await tx.stockMove.createMany({
          data: items.map((i) => ({
            type: "ISSUE" as const, date, warehouseId: wh.id, materialId: i.materialId,
            recipientId: autoTo?.id ?? null, employeeId: autoEmployee?.id ?? null,
            qty: -i.qty, unitCost: i.unitCost, refType: "GoodsReceipt", refId: rec.id, createdById: actor.userId,
            note: `Avto chiqim: kirim ${rec.docNo} → ${autoTo?.name ?? autoEmployee?.fullName}`,
          })),
        });
      }
      if (autoBrigade) {
        for (const i of items) {
          const move = await tx.stockMove.create({
            data: {
              type: "BRIGADE_ISSUE", date, warehouseId: wh.id, materialId: i.materialId, brigadeId: autoBrigade.id,
              qty: -i.qty, unitCost: i.unitCost, refType: "GoodsReceipt", refId: rec.id, createdById: actor.userId,
              note: `${autoBrigade.name} brigadasiga berildi · avto chiqim: kirim ${rec.docNo}`,
            },
          });
          await tx.brigadeMove.create({
            data: {
              type: "ISSUE", date, brigadeId: autoBrigade.id, materialId: i.materialId, qty: i.qty, unitCost: i.unitCost,
              refType: "StockMove", refId: move.id, note: `Kirim ${rec.docNo}`, createdById: actor.userId,
            },
          });
        }
      }
      // Kirim summasi (QQS va dostavka bilan — yetkazuvchiga shuncha to'lanadi) — hisobdan chiqim. Sklad/snabjeniye kassadan
      // pul chiqara olmaydi: bunday kirim Kirim-Chiqimda "To'lanmagan kirimlar" ro'yxatiga tushadi va moliya to'laydi (`payReceipt`).
      // Direktor esa hisobni tanlab, shu zahoti to'langan deb yozishi mumkin.
      if (total > 0 && acc) {
        // Naqd kassa minusga tushmasin (qulf ostida) — bankdan to'lash yoki to'lovni moliyaga qoldirish kerak
        const cashErr = await cashOutflowError(tx, acc.id, total);
        if (cashErr) throw new ReceiptError(`${cashErr}. Hisobni o'zgartiring yoki to'lovsiz saqlang — moliya keyin to'laydi`);
        const cashTx = await tx.cashTransaction.create({
          data: {
            type: "EXPENSE", date, cashAccountId: acc.id, amount: total,
            category: "Xomashyo", supplierId: sup.id, counterparty: sup.name,
            note: `Kirim ${rec.docNo} · ${items.length} qator`,
            refType: "GoodsReceipt", refId: rec.id, createdById: actor.userId,
          },
        });
        await audit(tx, actor.userId, "CREATE", "CashTransaction", cashTx.id, undefined, cashTx);
      }
      await audit(tx, actor.userId, "CREATE", "GoodsReceipt", rec.id, undefined, { ...rec, items });
      return { id: rec.id, docNo: rec.docNo, existed: false };
    });
    // To'lanmagan kirim — yetkazuvchiga pulni moliya/buxgalteriya to'laydi; xabarsiz u faqat ro'yxatda turardi.
    // Ta'minot zanjiridan kelgan kirim (pul allaqachon ajratilgan) bu yerdan o'tmaydi (`lib/supply.ts`).
    if (!created.existed) queueUnpaidNotice(created.id, actor.userId);
    return created;
  } catch (e) {
    // Bir vaqtda kelgan ikki bir xil yuborish: ikkinchisi unique kalitga urildi — birinchisining kirimi qaytariladi
    if (clientToken && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await db.goodsReceipt.findUnique({ where: { clientToken }, select: { id: true, docNo: true } });
      if (dup) return { ...dup, existed: true };
    }
    if (e instanceof ReceiptError) throw new Error(e.message);
    throw e;
  }
}

/**
 * To'lanmagan kirim haqida moliya/buxgalteriyaga xabar — 30 soniyalik oynada guruhlanadi:
 * Excel jurnal importi o'nlab kirim yaratsa, o'nlab push emas, bitta «N ta kirim» xabari ketadi.
 */
const unpaidQueue = new Map<string, { ids: string[]; timer: ReturnType<typeof setTimeout> }>();
function queueUnpaidNotice(receiptId: string, userId: string) {
  const q = unpaidQueue.get(userId);
  if (q) { q.ids.push(receiptId); return; }
  const timer = setTimeout(() => {
    const ids = unpaidQueue.get(userId)?.ids ?? [];
    unpaidQueue.delete(userId);
    void (async () => {
      const paid = new Set((await db.cashTransaction.findMany({ where: { refType: "GoodsReceipt", refId: { in: ids } }, select: { refId: true } })).map((t) => t.refId));
      const open = await db.goodsReceipt.findMany({ where: { id: { in: ids.filter((i) => !paid.has(i)) } }, select: { id: true, docNo: true, supplier: { select: { name: true } } } });
      if (!open.length) return;
      const one = open.length === 1 ? open[0]! : null;
      await notifyRoles(["FINANCE", "ACCOUNTING"], one
        ? { type: "RECEIPT_UNPAID", title: `Kirim to'lanmagan — ${one.docNo}`, body: `${one.supplier.name} · yetkazuvchiga to'lov kerak`, link: { key: "receipts", id: one.id }, channel: "oddiy" }
        : { type: "RECEIPT_UNPAID", title: `${open.length} ta kirim to'lanmagan`, body: `Yetkazuvchilarga to'lov kerak: ${[...new Set(open.map((r) => r.supplier.name))].slice(0, 4).join(", ")}`, channel: "oddiy" },
      { except: userId });
    })().catch((e) => console.error("[notify] kirim", e));
  }, 30_000);
  timer.unref?.();
  unpaidQueue.set(userId, { ids: [receiptId], timer });
}

// ───────────────────────── «Приход» jurnali ─────────────────────────

/** «Kimga» (darhol chiqim) nomi: oluvchi, brigada yoki xodim. */
const autoName = (r: { autoIssueTo: { name: string } | null; autoIssueBrigade: { name: string } | null; autoIssueEmployee: { fullName: string } | null }) =>
  r.autoIssueTo?.name ?? r.autoIssueBrigade?.name ?? r.autoIssueEmployee?.fullName ?? null;

export type PrixodPayment = "BANK" | "CASH";

/**
 * Jurnal qatori = bitta kirim qatori (GoodsReceiptItem). Pul — so'm, tiyinga yaxlitlangan.
 * Storno qilingan kirim: asl qator o'z sanasida qoladi (`cancelled`), storno sanasida esa teskari qator (`storno`:
 * К-во, Доставка, Общие, НДС, Итого — manfiy). Shunda davr yig'indisi = «Остатки» dagi «Приход» (RECEIPT ishorasi bilan).
 */
export type PrixodRow = {
  /** GoodsReceiptItem.id; storno qatorida — `<id>~storno` (ro'yxat kaliti noyob bo'lsin) */
  id: string;
  receiptId: string;
  docNo: string;
  /** Kirim sanasi; storno qatorida — storno qilingan payt (cancelledAt) */
  date: Date;
  material: string;
  materialId: string;
  unit: string;
  /** ТТН (eski kirimlarda izohdagi «Nakladnoy № X» dan) */
  waybillNo: string | null;
  qty: number;
  /** От Кого */
  supplier: string;
  /** Кому — StockRecipient nomi, bo'lmasa sklad nomi */
  recipient: string;
  /** Деньги — kirimdagi belgi, bo'lmasa bog'langan to'lov hisobining turi (BANK → П-р, CASH → Н-к) */
  payment: PrixodPayment | null;
  delivery: number;
  price: number;
  vatRate: number;
  /** Общие сумма: qty × price + delivery */
  sum: number;
  /** НДС (qator stavkasi bo'yicha: 0, 6 yoki 12%) */
  vat: number;
  /** Итого сумма: sum + vat */
  total: number;
  address: string | null;
  /** Снабженец — buyer, bo'lmasa kiritgan xodim */
  buyer: string | null;
  purpose: string | null;
  /** Kirim izohi (eski kirimlarda «Nakladnoy № …» ham shu yerda) */
  note: string | null;
  /** «Mashina (kim olib keldi)» */
  carrier: string | null;
  /** «Qayerdan yuklandi» */
  loadedFrom: string | null;
  /** «Darhol kimga berildi (avto chiqim)» — oluvchi nomi */
  autoIssueTo: string | null;
  /** Kirim keyin storno qilingan — bu asl qator (summalari musbat, ustidan chizib ko'rsatiladi) */
  cancelled?: boolean;
  /** Storno qatori: storno sanasida, summalar manfiy */
  storno?: boolean;
};

export type PrixodTotals = { rows: number; delivery: number; sum: number; vat: number; total: number };

/** Eski kirim izohidan ТТН: "Nakladnoy № 123 · Mashina …" → "123". */
export function waybillFromNote(note: string | null | undefined): string | null {
  const m = /Nakladnoy № ([^·]+?)\s*(?:·|$)/.exec(note ?? "");
  return m ? m[1].trim() || null : null;
}

/**
 * Kirimlarning «Деньги» belgisi: kirimda yozilgani, bo'lmasa unga bog'langan birinchi chiqimning hisob turi
 * (direktor yoki moliya to'lagan, ta'minot zanjiri). To'lanmagan va belgisiz kirim — null («—»).
 */
export async function resolveReceiptPayments(
  receipts: { id: string; payment: ReceiptPayment | null }[],
  client: Pick<Prisma.TransactionClient, "cashTransaction"> = db,
): Promise<Map<string, PrixodPayment | null>> {
  const out = new Map<string, PrixodPayment | null>(receipts.map((r) => [r.id, r.payment]));
  const need = receipts.filter((r) => !r.payment).map((r) => r.id);
  if (need.length) {
    const txs = await client.cashTransaction.findMany({
      where: { type: "EXPENSE", refType: "GoodsReceipt", refId: { in: need } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: { refId: true, cashAccount: { select: { type: true } } },
    });
    for (const x of txs) if (x.refId && out.get(x.refId) == null) out.set(x.refId, x.cashAccount.type);
  }
  return out;
}

/**
 * «Приход» jurnali: davr (`from` ≤ sana < `to`) ichidagi kirimlarning har qatori, kun bo'yicha o'sish tartibida.
 * Storno qilingan kirim o'z sanasida `cancelled` belgisi bilan chiqadi, storno payti (cancelledAt) davr ichida bo'lsa —
 * o'sha kunning oxirida manfiy `storno` qatori ham (sklad teskari harakati shu paytda yozilgan — `lib/storno.ts`).
 * Natijada Σ К-во = «Остатки» dagi «Приход» ning RECEIPT qismi (`lib/stock-turnover.ts`).
 * `q` — Наименование yoki От Кого bo'yicha qidiruv, `warehouseId` — bitta sklad.
 */
export async function prixodJournal(p: { from: Date; to: Date; warehouseId?: string | null; q?: string | null }): Promise<PrixodRow[]> {
  const q = (p.q ?? "").trim().slice(0, 100);
  const period = { gte: p.from, lt: p.to };
  const items = await db.goodsReceiptItem.findMany({
    where: {
      receipt: { OR: [{ date: period }, { cancelledAt: period }], ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}) },
      ...(q ? { OR: [{ material: { name: { contains: q, mode: "insensitive" as const } } }, { receipt: { supplier: { name: { contains: q, mode: "insensitive" as const } } } }] } : {}),
    },
    orderBy: [{ receipt: { date: "asc" } }, { receipt: { docNo: "asc" } }, { id: "asc" }],
    select: {
      id: true, qty: true, price: true, vatRate: true, vatAmount: true, deliveryCost: true,
      material: { select: { id: true, name: true, unit: true } },
      receipt: {
        select: {
          id: true, docNo: true, date: true, note: true, waybillNo: true, payment: true, address: true, purpose: true, cancelledAt: true,
          carrier: true, loadedFrom: true, autoIssueTo: { select: { name: true } },
          autoIssueBrigade: { select: { name: true } }, autoIssueEmployee: { select: { fullName: true } },
          supplier: { select: { name: true } }, warehouse: { select: { name: true } }, recipient: { select: { name: true } },
          buyer: { select: { fullName: true } }, createdBy: { select: { fullName: true } },
        },
      },
    },
  });
  const recs = new Map(items.map((i) => [i.receipt.id, { id: i.receipt.id, payment: i.receipt.payment }]));
  const pay = await resolveReceiptPayments([...recs.values()]);
  const t0 = p.from.getTime(), t1 = p.to.getTime();
  const inPeriod = (d: Date | null): d is Date => d != null && d.getTime() >= t0 && d.getTime() < t1;
  const neg = (v: number) => -v || 0; // -0 bo'lmasin
  const rows: PrixodRow[] = [];
  const stornoRows: PrixodRow[] = [];
  for (const i of items) {
    const r = i.receipt;
    const qty = Number(i.qty), price = Number(i.price), delivery = r2(Number(i.deliveryCost)), vat = r2(Number(i.vatAmount));
    const sum = r2(qty * price + delivery);
    const row: PrixodRow = {
      id: i.id, receiptId: r.id, docNo: r.docNo, date: r.date,
      material: i.material.name, materialId: i.material.id, unit: i.material.unit,
      waybillNo: r.waybillNo ?? waybillFromNote(r.note), qty,
      supplier: r.supplier.name, recipient: r.recipient?.name ?? autoName(r) ?? r.warehouse.name,
      payment: pay.get(r.id) ?? null, delivery, price, vatRate: i.vatRate, sum, vat, total: r2(sum + vat),
      address: r.address, buyer: r.buyer?.fullName ?? r.createdBy?.fullName ?? null, purpose: r.purpose,
      note: r.note, carrier: r.carrier, loadedFrom: r.loadedFrom, autoIssueTo: autoName(r),
    };
    if (inPeriod(r.date)) rows.push(r.cancelledAt ? { ...row, cancelled: true } : row);
    if (inPeriod(r.cancelledAt)) {
      stornoRows.push({
        ...row, id: `${i.id}~storno`, date: r.cancelledAt, storno: true,
        qty: neg(qty), delivery: neg(delivery), sum: neg(sum), vat: neg(vat), total: neg(row.total),
      });
    }
  }
  // Kun bo'yicha (mahalliy, `dateRu` kabi); kun ichida — avval kirimlar (so'rov tartibi: sana, hujjat), keyin storno qatorlari
  // storno payti bo'yicha. `sort` barqaror — teng kalitlarda so'rov tartibi saqlanadi.
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return [...rows, ...stornoRows].sort((a, b) =>
    day(a.date) - day(b.date) || Number(!!a.storno) - Number(!!b.storno) || (a.storno && b.storno ? a.date.getTime() - b.date.getTime() : 0));
}

/** Jurnal jami («Итого» qatori va kartalar) — ishorasi bilan: storno qatorlari ayiriladi. */
export function prixodTotals(rows: PrixodRow[]): PrixodTotals {
  const s = (f: (r: PrixodRow) => number) => r2(rows.reduce((a, r) => a + f(r), 0));
  return { rows: rows.length, delivery: s((r) => r.delivery), sum: s((r) => r.sum), vat: s((r) => r.vat), total: s((r) => r.total) };
}

/**
 * Har xomashyoning OXIRGI (storno qilinmagan) kirim qatori shartlari — «Расход» jurnalida Деньги va НДС meros olinadi:
 * payment (kirimdagi belgi → bog'langan to'lov hisobi turi → null) va shu qatorning QQS stavkasi.
 * `before` berilsa — shu paytdan oldingi (`date < before`) oxirgi kirim.
 */
export async function lastReceiptTerms(materialIds: string[], before?: Date): Promise<Map<string, { payment: PrixodPayment | null; vatRate: number; receiptId: string; date: Date }>> {
  const ids = [...new Set(materialIds)];
  if (!ids.length) return new Map();
  // Har xomashyo uchun bitta qator (Prisma `distinct` xotirada ishlaydi — butun tarixni o'qimaslik uchun alohida so'rov)
  const rows = (await Promise.all(ids.map((materialId) => db.goodsReceiptItem.findFirst({
    where: { materialId, receipt: { cancelledAt: null, ...(before ? { date: { lt: before } } : {}) } },
    orderBy: [{ receipt: { date: "desc" } }, { receipt: { createdAt: "desc" } }],
    select: { materialId: true, vatRate: true, receipt: { select: { id: true, date: true, payment: true } } },
  })))).filter((r) => r != null);
  const pay = await resolveReceiptPayments(rows.map((r) => ({ id: r.receipt.id, payment: r.receipt.payment })));
  return new Map(rows.map((r) => [r.materialId, { payment: pay.get(r.receipt.id) ?? null, vatRate: r.vatRate, receiptId: r.receipt.id, date: r.receipt.date }]));
}

// ───────────────────────── «Ta'minotchi» va «Kimga» — nom bo'yicha ─────────────────────────

const cleanName = (v: string | null | undefined, max: number) => clean((v ?? "").replace(/\s+/g, " "), max);

/**
 * Kirim formasidagi «Ta'minotchi»: ro'yxatdan tanlangan (`id`) yoki qo'lda yozilgan nom (`name`).
 * Nom bo'yicha (katta-kichik harf farqsiz) mavjud yetkazuvchi olinadi; yo'q bo'lsa yangisi yaratiladi va Yetkazuvchilar
 * spravochnigida qoladi — keyingi kirimda ro'yxatdan chiqadi. Yangi yetkazuvchi QQS to'lovchisi deb yoziladi (naqd kirimda
 * QQS baribir 0; kerak bo'lsa Yetkazuvchilar bo'limida o'zgartiriladi). Yaratish huquqi — `stock → suppliers` (`canAdd`).
 */
export async function resolveSupplier(input: { id?: string | null; name?: string | null }, actor: { userId: string; canAdd: boolean }): Promise<{ id: string } | { error: string }> {
  const id = clean(input.id, 64);
  if (id) return { id };
  const name = cleanName(input.name, 200);
  if (!name) return { error: "Ta'minotchini tanlang yoki nomini yozing" };
  const found = await db.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true, isActive: true } });
  if (found) {
    if (!found.isActive) return { error: `"${found.name}" yopilgan — avval Yetkazuvchilar bo'limida faollashtiring` };
    return { id: found.id };
  }
  if (!actor.canAdd) return { error: `«${name}» yetkazuvchisi spravochnikda yo'q — ro'yxatdan tanlang yoki Yetkazuvchilar bo'limida qo'shing` };
  const sup = await db.supplier.create({ data: { name, vatPayer: true } });
  await audit(db, actor.userId, "CREATE", "Supplier", sup.id, undefined, { ...sup, via: "kirim-forma" });
  return { id: sup.id };
}

/**
 * «Kimga» / «Darhol kimga berildi»: tanlangan oluvchi (`id`) yoki yozilgan nom (`name`) — mavjudi olinadi, yo'g'i yaratiladi
 * (`upsertRecipient`: nom takrorlanmaydi, nofaol bo'lsa xato). Ikkalasi bo'sh — `{ id: null }` (kirim skladga).
 */
export async function resolveRecipient(input: { id?: string | null; name?: string | null }, userId: string): Promise<{ id: string | null } | { error: string }> {
  const id = clean(input.id, 64);
  if (id) return { id };
  const name = cleanName(input.name, 80);
  if (!name) return { id: null };
  const found = await db.stockRecipient.findFirst({ where: { name: { equals: name, mode: "insensitive" }, isActive: true }, select: { id: true } });
  if (found) return { id: found.id };
  const r = await upsertRecipient({ name }, userId);
  return "error" in r ? r : { id: r.id };
}
