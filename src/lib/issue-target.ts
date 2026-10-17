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

/** Nomni solishtirish uchun: kichik harf, bitta probel, tire turlari bir xil («Brigada 1 — Ilxom» = «brigada 1 - ilxom»). */
export const normTargetName = (s: string) => s.toLowerCase().replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();

/**
 * Excel'dagi «Kimga» matni → kalit, shu tartibda: brigada (nomi, «nomi — brigadir» yoki brigadir ismi) → xodim → oluvchi.
 * Topilmasa null (server yangi oluvchi yaratadi).
 */
export function matchTarget(g: TargetGroups, name: string): { key: string; kind: "brigade" | "employee" | "recipient"; label: string } | null {
  const k = normTargetName(name);
  if (!k) return null;
  const b = g.brigades.find((x) => normTargetName(x.name) === k || normTargetName(brigadeLabel(x)) === k || (!!x.leader && normTargetName(x.leader) === k));
  if (b) return { key: `b:${b.id}`, kind: "brigade", label: brigadeLabel(b) };
  const e = g.employees.find((x) => normTargetName(x.name) === k);
  if (e) return { key: `e:${e.id}`, kind: "employee", label: e.name };
  const r = g.recipients.find((x) => normTargetName(x.name) === k);
  if (r) return { key: `r:${r.id}`, kind: "recipient", label: r.name };
  return null;
}
