import { z } from "zod";

/** `note` — amal bajarildi, lekin yonidagi ish haqida aytadigan gap bor
 *  (masalan: parol almashdi, ammo SMS ketmadi — telefon yo'q). */
export type ActionState = { error?: string; ok?: boolean; note?: string } | undefined;

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
    return { error: `${i.path.join(".") || "Forma"}: ${i.message}` };
  }
  return { data: r.data };
}

export const zDec = (min = 0) =>
  z.coerce.number({ message: "raqam bo'lishi kerak" }).min(min, `kamida ${min}`);
export const zStr = (msg = "to'ldirilishi shart") => z.string().trim().min(1, msg);
export const zOpt = z.string().trim().optional().transform((v) => (v ? v : null));
