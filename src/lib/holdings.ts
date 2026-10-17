import { db } from "./db";
import { brigadeLabel } from "./issue-target";
import { cardHref } from "./recipient-card";

/**
 * «Kimda nima bor» — Sklad oynasi, Yangi kirim va Yangi chiqim formalari uchun (kimga berayotganini ko'rib turib berish):
 *  · brigada — qo'lidagi haqiqiy qoldiq (BrigadeMove yig'indisi: berilgan − sarflangan − qaytarilgan);
 *  · xodim / oluvchi — berilgan narsa sarf hisoblanadi (qaytarish yo'q), shuning uchun shu oyda olgani va barcha vaqt jami
 *    (StockMove ISSUE, kirimdagi «Kimga» avto chiqimi va stornolar ishorasi bilan netlanadi).
 * Bo'sh (hech narsa olmagan) oluvchilar ro'yxatga kirmaydi.
 */

export type HoldingItem = { materialId: string; name: string; unit: string; /** brigadada — qo'lida; xodim/oluvchida — shu oy */ qty: number; /** xodim/oluvchi: barcha vaqt */ total: number };
export type Holding = { key: string; kind: "brigade" | "employee" | "recipient"; name: string; sub: string | null; href: string; items: HoldingItem[] };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;

export async function holdingsOverview(now = new Date()): Promise<Holding[]> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [brigades, employees, recipients, brSums, issuedAll, issuedMonth, materials] = await Promise.all([
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leader: { select: { fullName: true } } } }),
    db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true, position: true } }),
    db.stockRecipient.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.brigadeMove.groupBy({ by: ["brigadeId", "materialId"], _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["employeeId", "recipientId", "materialId"], where: { type: "ISSUE", materialId: { not: null }, OR: [{ employeeId: { not: null } }, { recipientId: { not: null } }] }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["employeeId", "recipientId", "materialId"], where: { type: "ISSUE", materialId: { not: null }, date: { gte: monthStart }, OR: [{ employeeId: { not: null } }, { recipientId: { not: null } }] }, _sum: { qty: true } }),
    db.material.findMany({ select: { id: true, name: true, unit: true } }),
  ]);
  const mat = new Map(materials.map((m) => [m.id, m]));
  const sortItems = (xs: HoldingItem[]) => xs.sort((a, b) => a.name.localeCompare(b.name));

  // Brigada qo'lidagi qoldiq
  const hand = new Map<string, HoldingItem[]>();
  for (const s of brSums) {
    const q = r3(Number(s._sum.qty ?? 0));
    const m = mat.get(s.materialId);
    if (!m || q <= EPS) continue;
    const l = hand.get(s.brigadeId) ?? [];
    l.push({ materialId: m.id, name: m.name, unit: m.unit, qty: q, total: q });
    hand.set(s.brigadeId, l);
  }

  // Xodim / oluvchi: kalit "e:<id>" | "r:<id>" → xomashyo → { oy, jami } (chiqim musbat)
  const got = new Map<string, Map<string, { qty: number; total: number }>>();
  const keyOf = (x: { employeeId: string | null; recipientId: string | null }) => (x.employeeId ? `e:${x.employeeId}` : `r:${x.recipientId}`);
  for (const [rows, field] of [[issuedAll, "total"], [issuedMonth, "qty"]] as const) {
    for (const s of rows) {
      if (!s.materialId) continue;
      const k = keyOf(s);
      const byMat = got.get(k) ?? new Map<string, { qty: number; total: number }>();
      const cur = byMat.get(s.materialId) ?? { qty: 0, total: 0 };
      cur[field] = r3(-Number(s._sum.qty ?? 0));
      byMat.set(s.materialId, cur);
      got.set(k, byMat);
    }
  }
  const issuedItems = (k: string): HoldingItem[] => {
    const out: HoldingItem[] = [];
    for (const [id, v] of got.get(k) ?? []) {
      const m = mat.get(id);
      if (m && (v.qty > EPS || v.total > EPS)) out.push({ materialId: id, name: m.name, unit: m.unit, qty: Math.max(0, v.qty), total: Math.max(0, v.total) });
    }
    return sortItems(out);
  };

  const out: Holding[] = [];
  for (const b of brigades) {
    out.push({ key: `b:${b.id}`, kind: "brigade", name: brigadeLabel({ name: b.name, leader: b.leader?.fullName ?? null }), sub: null, href: cardHref("b", b.id), items: sortItems(hand.get(b.id) ?? []) });
  }
  for (const e of employees.sort((a, b) => a.fullName.localeCompare(b.fullName))) {
    const items = issuedItems(`e:${e.id}`);
    if (items.length) out.push({ key: `e:${e.id}`, kind: "employee", name: e.fullName, sub: e.position, href: cardHref("e", e.id), items });
  }
  for (const r of recipients.sort((a, b) => a.name.localeCompare(b.name))) {
    const items = issuedItems(`r:${r.id}`);
    if (items.length) out.push({ key: `r:${r.id}`, kind: "recipient", name: r.name, sub: null, href: cardHref("r", r.id), items });
  }
  return out;
}
