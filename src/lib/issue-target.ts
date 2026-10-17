/**
 * «Kimga» (chiqim oluvchisi) — klient va serverda umumiy, bazaga tegmaydigan qism.
 * Kalit: "b:<id>" — brigada, "e:<id>" — xodim, "r:<id>" — erkin oluvchi (`lib/stock-issue.ts#parseIssueTarget`).
 * Ro'yxat tartibi hamma joyda bir xil: bizning brigadalar → barcha xodimlar → tizimda yo'q nomlar.
 */

export type TargetGroups = {
  /** Faol brigadalar (brigadir ismi bilan) — ro'yxatda birinchi */
  brigades: { id: string; name: string; leader: string | null }[];
  /** Ishlayotgan xodimlar — ikkinchi */
  employees: { id: string; name: string; position: string }[];
  /** Tizimda yo'q nomlar (shofyorlar, Traktor, Mexanik…) — oxirida */
  recipients: { id: string; name: string }[];
};

/** Select'dagi eng pastki band — «Qo'lda kiritish»: yangi oluvchi oynasini ochadi, qiymat sifatida yuborilmaydi. */
export const NEW_RECIPIENT = "__new__";

/** Brigada yorlig'i «Kimga» ro'yxatida: «1-brigada — Ilxom» (brigadir bo'lsa). */
export const brigadeLabel = (b: { name: string; leader: string | null }) => (b.leader ? `${b.name} — ${b.leader}` : b.name);

/** Kalit bo'yicha ko'rinadigan nom; ro'yxatda yo'q (nofaol) bo'lsa null. */
export function targetName(g: TargetGroups, key: string): string | null {
  const m = /^([ber]):(.+)$/.exec(key);
  if (!m) return null;
  if (m[1] === "b") { const b = g.brigades.find((x) => x.id === m[2]); return b ? brigadeLabel(b) : null; }
  if (m[1] === "e") return g.employees.find((x) => x.id === m[2])?.name ?? null;
  return g.recipients.find((x) => x.id === m[2])?.name ?? null;
}
