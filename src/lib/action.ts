import { z } from "zod";

/** `note` — amal bajarildi, lekin yonidagi ish haqida aytadigan gap bor
 *  (masalan: parol almashdi — uni xodimga kadr o'zi yetkazadi). */
export type ActionState = { error?: string; ok?: boolean; note?: string } | undefined;

/** Zod'ning standart (inglizcha) xabarlari — bular uchun maydon kaliti ko'rsatiladi. */
const ZOD_DEFAULT = /^(required|invalid|expected|too (small|big)|string must|number must|array must|unrecognized)/i;

/** FormData → zod. Xatoni o'zbekcha bitta satrda qaytaradi. */
export function parseForm<T extends z.ZodTypeAny>(schema: T, fd: FormData): { data: z.infer<T> } | { error: string } {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      if (Array.isArray(obj[key])) (obj[key] as unknown[]).push(v);
      else obj[key] = [v];
    } else obj[k] = v;
  }
  const r = schema.safeParse(obj);
  if (!r.success) {
    const i = r.error.issues[0];
    // O'zbekcha (biz yozgan) xabar foydalanuvchiga o'zicha ko'rinadi — "price:", "qtyM3.0:" kabi texnik kalitsiz.
    // Zod'ning standart inglizcha xabarida esa qaysi maydon ekanini bilish uchun kalit qoladi.
    if (!ZOD_DEFAULT.test(i.message)) return { error: i.message.charAt(0).toUpperCase() + i.message.slice(1) };
    return { error: `${i.path.join(".") || "Forma"}: ${i.message}` };
  }
  return { data: r.data };
}

/** Bazadagi Decimal(18,2) ustunlariga sig'adigan eng katta qiymat — undan kattasi 500 xato bermasin, forma xatosi bo'lsin. */
export const MAX_AMOUNT = 1e15;

export const zDec = (min = 0) =>
  z.coerce.number({ message: "raqam bo'lishi kerak" }).min(min, `kamida ${min}`).max(MAX_AMOUNT, "qiymat juda katta");
export const zStr = (msg = "to'ldirilishi shart") => z.string().trim().min(1, msg);
export const zOpt = z.string().trim().optional().transform((v) => (v ? v : null));

/** Forma sanasi (yyyy-mm-dd / datetime-local): o'qiladigan va 2000-yildan ertaga qadar oralig'ida bo'lsin. */
export function validDate(v: string): boolean {
  const t = new Date(v).getTime();
  return Number.isFinite(t) && t >= Date.UTC(2000, 0, 1) && t <= Date.now() + 2 * 86_400_000;
}
