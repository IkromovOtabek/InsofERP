import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hrDocLabel } from "@/lib/hr-docs";

/**
 * E-IMZO — kadr hujjatini elektron raqamli imzo (ERI) bilan imzolash.
 *
 * Oqim: brauzer imzolanadigan matnni oladi (`signPayload`) → kompyuterdagi E-IMZO ilovasi (mahalliy WebSocket)
 * PKCS#7 (attached) imzo yaratadi → server saqlaydi. Imzoning haqiqiyligini tekshirish uchun korxonaning E-IMZO
 * serveri kerak: `EIMZO_SERVER_URL` (masalan http://127.0.0.1:8080) berilsa — `/backend/pkcs7/verify/attached` ga
 * yuboriladi va faqat u tasdiqlasa `eVerified = true`. Sozlanmagan bo'lsa imzo saqlanadi, lekin "tekshirilmagan".
 * Brauzer tomoni domen API kalitini `NEXT_PUBLIC_EIMZO_APIKEYS` dan oladi ("domen:kalit,domen:kalit" — e-imzo.uz beradi).
 */

/** Imzolanadigan matn — hujjatning asosiy maydonlari (keyin o'zgarsa, imzo boshqa matnga tegishli bo'lib qoladi). */
export async function signPayload(docId: string): Promise<string | null> {
  const d = await db.hrDocument.findUnique({ where: { id: docId }, include: { employee: { select: { fullName: true, pinfl: true } } } });
  if (!d) return null;
  const date = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");
  return [
    `Hujjat: ${hrDocLabel(d.kind)}${d.no ? ` № ${d.no}` : ""}`,
    `Sana: ${date(d.docDate)}`,
    `Xodim: ${d.employee.fullName}${d.employee.pinfl ? ` (JSHSHIR ${d.employee.pinfl})` : ""}`,
    ...(d.position ? [`Lavozim: ${d.position}`] : []),
    ...(d.effectiveAt ? [`Kuchga kirish: ${date(d.effectiveAt)}`] : []),
    ...(d.salary ? [`Oylik: ${Number(d.salary)}`] : []),
    ...(d.reason ? [`Izoh: ${d.reason}`] : []),
    `ID: ${d.id}`,
  ].join("\n");
}

const B64 = /^[A-Za-z0-9+/=\r\n]+$/;

type VerifyResult = { verified: boolean; signer: string | null; tin: string | null; note: string };

/** E-IMZO server bilan tekshirish (sozlangan bo'lsa). Javob shakli serverga bog'liq — ism/STIR ehtiyotkorlik bilan o'qiladi. */
async function verifyOnServer(pkcs7: string): Promise<VerifyResult | null> {
  const base = (process.env.EIMZO_SERVER_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  try {
    const res = await fetch(`${base}/backend/pkcs7/verify/attached`, { method: "POST", body: pkcs7, headers: { "Content-Type": "text/plain" }, signal: AbortSignal.timeout(15_000) });
    const j = (await res.json()) as { status?: number; message?: string; pkcs7Info?: { signers?: { certificate?: { subjectName?: string; subjectInfo?: Record<string, string> }[]; verified?: boolean; certificateVerified?: boolean }[] } };
    const signer = j.pkcs7Info?.signers?.[0];
    const cert = signer?.certificate?.[0];
    const info = cert?.subjectInfo ?? {};
    const ok = j.status === 1 && signer?.verified !== false && signer?.certificateVerified !== false;
    return { verified: ok, signer: info.CN ?? cert?.subjectName ?? null, tin: info.UID ?? info["1.2.860.3.16.1.2"] ?? null, note: ok ? "E-IMZO server tasdiqladi" : `E-IMZO server rad etdi: ${j.message ?? `status ${j.status}`}` };
  } catch (e) {
    return { verified: false, signer: null, tin: null, note: `E-IMZO serveriga ulanib bo'lmadi: ${(e as Error).message}` };
  }
}

/** Imzoni saqlash. `certInfo` — brauzer sertifikat taxallusidan o'qigan ism/STIR (server tasdiqlasa — uniki ustun). */
export async function saveESignature(docId: string, pkcs7: string, certInfo: { name?: string | null; tin?: string | null }, userId: string) {
  const sig = pkcs7.trim();
  if (sig.length < 200 || sig.length > 2_000_000 || !B64.test(sig)) return { error: "Imzo noto'g'ri formatda" };
  const doc = await db.hrDocument.findUnique({ where: { id: docId }, select: { id: true, employeeId: true, eSignature: true } });
  if (!doc) return { error: "Hujjat topilmadi" };
  const payload = await signPayload(docId);
  // Attached PKCS#7 ichida imzolangan matn bo'ladi — u hozirgi hujjat matni bilan mos kelishi shart (base64 ichida qidiriladi)
  const raw = Buffer.from(sig, "base64");
  if (!payload || !raw.includes(Buffer.from(payload, "utf8"))) return { error: "Imzo shu hujjat matniga tegishli emas — sahifani yangilab, qayta imzolang" };
  const v = await verifyOnServer(sig);
  const signer = (v?.signer ?? certInfo.name ?? "").slice(0, 200) || null;
  const tin = (v?.tin ?? certInfo.tin ?? "").slice(0, 20) || null;
  await db.$transaction(async (tx) => {
    await tx.hrDocument.update({ where: { id: docId }, data: { eSignature: sig, eSignedAt: new Date(), eSigner: signer, eSignerTin: tin, eVerified: !!v?.verified } });
    await audit(tx, userId, "UPDATE", "HrDocument", docId, { eSigned: !!doc.eSignature }, { eSigned: true, signer, tin, verified: !!v?.verified, note: v?.note ?? "E-IMZO server sozlanmagan — tekshirilmadi" });
  });
  return { ok: true as const, note: v ? v.note : "Imzo saqlandi (E-IMZO server sozlanmagan — tekshirilmadi)", employeeId: doc.employeeId };
}
