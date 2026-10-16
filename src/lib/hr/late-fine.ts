import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { money } from "@/lib/format";
import { lateText } from "@/lib/attendance-time";

/**
 * Kechikish jarimasi — Sozlamalar → Davomat (`/settings/davomat`), otdel kadr va direktor belgilaydi.
 *
 * Saqlanadigan joy — `PayRule` (kind PENALTY, trigger LATE, lavozimsiz = hamma uchun bir xil): ish haqi hisobi
 * (`lib/hr/payroll`) jarimani shu qoidadan oladi, bu yerda esa tabel va xodimning o'z davomatida ko'rsatiladi.
 * Hisob: `graceMinutes` gacha kechikish jarimasiz; `perMinute` bo'lsa summa × (daqiqa − imtiyoz), aks holda har
 * kechikkan kun uchun bitta summa; `maxPerMonth` — oy bo'yicha eng ko'pi.
 */

export const LATE_FINE_ROLES = ["HR", "DIRECTOR"] as const;

export type LateFine = {
  id: string | null;
  amount: number;
  perMinute: boolean;
  graceMinutes: number;
  maxPerMonth: number | null;
  isActive: boolean;
  note: string | null;
};

const GLOBAL = { kind: "PENALTY", trigger: "LATE", position: null } as const;
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v));

/** Joriy qoida (o'chirilgani ham qaytadi — forma uni ko'rsatib tursin); hali belgilanmagan bo'lsa null. */
export async function getLateFine(): Promise<LateFine | null> {
  const r = await db.payRule.findFirst({ where: GLOBAL, orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] });
  if (!r) return null;
  return { id: r.id, amount: Number(r.amount), perMinute: r.perMinute, graceMinutes: r.graceMinutes, maxPerMonth: num(r.maxPerMonth), isActive: r.isActive, note: r.note };
}

/** Faol qoida bo'lsa — shu, aks holda null (hisob va ko'rsatish uchun). */
export const activeFine = (f: LateFine | null) => (f && f.isActive && f.amount > 0 ? f : null);

/** Bir kunlik kechikish uchun jarima, so'm (qoida yo'q / kechikmagan — 0). */
export function fineFor(lateMin: number | null | undefined, rule: LateFine | null): number {
  const f = activeFine(rule);
  if (!f || !lateMin || lateMin <= f.graceMinutes) return 0;
  return f.perMinute ? Math.round(f.amount * (lateMin - f.graceMinutes)) : f.amount;
}

/** Oy bo'yicha jami jarima — kunlik summalar yig'indisi, `maxPerMonth` dan oshmaydi. */
export function monthFine(lateMins: (number | null | undefined)[], rule: LateFine | null): { total: number; capped: boolean } {
  const f = activeFine(rule);
  if (!f) return { total: 0, capped: false };
  const sum = lateMins.reduce<number>((s, m) => s + fineFor(m, f), 0);
  const capped = f.maxPerMonth != null && sum > f.maxPerMonth;
  return { total: capped ? f.maxPerMonth! : sum, capped };
}

/** Qoida matni: "15 daqiqadan keyin har daqiqa 2 000 so'm (oyiga ko'pi bilan 300 000 so'm)". */
export function fineText(rule: LateFine | null): string {
  const f = activeFine(rule);
  if (!f) return "belgilanmagan";
  const grace = f.graceMinutes > 0 ? `${lateText(f.graceMinutes)}dan keyin ` : "";
  const unit = f.perMinute ? `har daqiqa ${money(f.amount)}` : `har kechikish ${money(f.amount)}`;
  const cap = f.maxPerMonth != null ? ` (oyiga ko'pi bilan ${money(f.maxPerMonth)})` : "";
  return `${grace}${unit}${cap}`;
}

export type LateFineInput = { amount: number; perMinute: boolean; graceMinutes: number; maxPerMonth: number | null; isActive: boolean; note: string | null };

/** Qoidani saqlash — bitta global yozuv yangilanadi (yo'q bo'lsa ochiladi), o'zgarish auditga tushadi. */
export async function saveLateFine(userId: string, v: LateFineInput): Promise<{ ok: true; changed: boolean } | { error: string }> {
  if (v.maxPerMonth != null && v.maxPerMonth < v.amount) return { error: "Oylik chegara bir kunlik summadan kam bo'lmasin" };
  const cur = await getLateFine();
  const data = { name: "Kechikish jarimasi", ...GLOBAL, amount: v.amount, perMinute: v.perMinute, graceMinutes: v.graceMinutes, maxPerMonth: v.maxPerMonth, isActive: v.isActive, note: v.note };
  const same = cur && cur.amount === v.amount && cur.perMinute === v.perMinute && cur.graceMinutes === v.graceMinutes
    && cur.maxPerMonth === v.maxPerMonth && cur.isActive === v.isActive && (cur.note ?? null) === (v.note ?? null);
  if (same) return { ok: true, changed: false };
  await db.$transaction(async (tx) => {
    const r = cur?.id
      ? await tx.payRule.update({ where: { id: cur.id }, data })
      : await tx.payRule.create({ data: { ...data, createdById: userId } });
    const before = cur ? { amount: cur.amount, perMinute: cur.perMinute, graceMinutes: cur.graceMinutes, maxPerMonth: cur.maxPerMonth, isActive: cur.isActive, note: cur.note } : undefined;
    await audit(tx, userId, cur ? "UPDATE" : "CREATE", "PayRule", r.id, before, v);
  });
  return { ok: true, changed: true };
}
