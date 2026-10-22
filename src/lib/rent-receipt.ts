import { db } from "./db";
import { fmtNum, date } from "./format";
import { qrKey, qrKeyValid } from "./qr-key";
import { RENT_METHOD_LABEL, monthLabel, rentFor } from "./rent";
import { shopLedger } from "./rent-tenant";
import { botEnabled, sendMessage } from "./telegram/api";

/**
 * Arenda kvitansiyasi — ijarachidan qabul qilingan pul (RentTx INCOME) uchun hujjat.
 *
 *  · Raqam bazada saqlanmaydi: «KV-<yil>-<tartib>», tartib — shu yil kiritilgan kirimlar orasidagi o'rni
 *    (yozuvlar o'chirilmaydi, shuning uchun raqam o'zgarmaydi; bekor qilingani ham raqamini saqlaydi).
 *  · QR — ommaviy `/k/<id>?k=<kalit>` sahifasi: ijarachi (yoki uning buxgalteri) to'lov haqiqiyligini va
 *    hozirgi qarzini ko'radi. Kalit — `lib/qr-key.ts` (maqsad «rent-kv»).
 */

export const rentReceiptPath = (id: string) => `/k/${id}?k=${qrKey("rent-kv", id)}`;
export const rentReceiptValid = (id: string, k: string | undefined | null) => qrKeyValid("rent-kv", id, k);

/** Tashqi manzil (QR va Telegram havolasi uchun) — faqat `APP_URL` dan; lokal manzil bo'lsa null. */
export function appUrl(): string | null {
  const env = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return env && !/localhost|127\.0\.0\.1/.test(env) ? env : null;
}

export async function receiptNo(tx: { id: string; createdAt: Date }): Promise<string> {
  const y = tx.createdAt.getFullYear();
  const seq = await db.rentTx.count({
    where: {
      type: "INCOME", createdAt: { gte: new Date(y, 0, 1) },
      OR: [{ createdAt: { lt: tx.createdAt } }, { createdAt: tx.createdAt, id: { lte: tx.id } }],
    },
  });
  return `KV-${y}-${String(seq).padStart(5, "0")}`;
}

/**
 * Kvitansiya ma'lumoti (chop etish va ommaviy sahifa). Kirim bo'lmasa — null. «Necha oyga» to'lov — bitta kvitansiya:
 * raqam va sana guruhning birinchi yozuvidan, summa — jami, «qaysi oylar uchun» — ro'yxat. To'lovchi — shartnomadagi ijarachi.
 */
export async function rentReceipt(id: string) {
  const one = await db.rentTx.findUnique({ where: { id }, include: { shop: true, lease: true, createdBy: { select: { fullName: true } } } });
  if (!one || one.type !== "INCOME" || !one.shop) return null;
  const group = one.batchId
    ? await db.rentTx.findMany({ where: { batchId: one.batchId }, orderBy: [{ month: "asc" }, { createdAt: "asc" }], include: { shop: true, lease: true, createdBy: { select: { fullName: true } } } })
    : [one];
  const tx = group[0];
  const [no, ledger] = await Promise.all([receiptNo(tx), shopLedger(tx.shop!.id, tx.leaseId)]);
  const payer = { name: tx.lease?.tenantName ?? tx.shop!.tenantName ?? tx.shop!.name, inn: tx.lease?.inn ?? tx.shop!.inn };
  const months = group.length > 1 ? group.map((g) => (g.month ? monthLabel(g.month) : "")).filter(Boolean) : null;
  const forLabel = months ? { label: `Qaysi oylar uchun (${months.length} oy)`, value: months.join(", ") } : rentFor(tx);
  return { tx, shop: tx.shop!, no, payer, forLabel, count: group.length, amount: group.reduce((a, g) => a + Number(g.amount), 0), debt: ledger.debt, ledger };
}

/**
 * To'lov yozilgach ijarachiga Telegram xabari (ulangan bo'lsa): summa, qaysi oy uchun, kvitansiya raqami,
 * hozirgi qarz va kvitansiya havolasi. Excel importi chaqirmaydi — eski to'lovlar uchun xabar ketmasin.
 */
export async function notifyRentPayment(txId: string): Promise<void> {
  if (!botEnabled()) return;
  const r = await rentReceipt(txId);
  if (!r || !r.shop.tgChatId || r.tx.cancelledAt) return;
  const origin = appUrl();
  await sendMessage(r.shop.tgChatId, [
    "To'lov qabul qilindi ✅",
    "",
    `Do'kon: ${r.shop.name} (${r.shop.location})`,
    `Summa: ${fmtNum(r.amount)} so'm (${RENT_METHOD_LABEL[r.tx.method].toLowerCase()})`,
    ...(r.forLabel ? [`${r.forLabel.label}: ${r.forLabel.value}`] : []),
    `Sana: ${date(r.tx.date)} · kvitansiya ${r.no}`,
    "",
    r.debt > 1 ? `Qolgan qarz: ${fmtNum(r.debt)} so'm` : r.debt < -1 ? `Avans (ortiqcha to'lov): ${fmtNum(-r.debt)} so'm` : "Qarzingiz yo'q. Rahmat!",
    ...(origin ? ["", `Kvitansiya: ${origin}${rentReceiptPath(r.tx.id)}`] : []),
  ].join("\n"), { markdown: false });
}
