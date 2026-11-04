import { db } from "./db";
import { brigadeLabel } from "./issue-target";
import { cardHref } from "./recipient-card";

/**
 * «Kimda nima bor» — Sklad oynasi, Yangi kirim va Yangi chiqim formalari uchun (kimga berayotganini ko'rib turib berish):
 *  · brigada — qo'lidagi haqiqiy qoldiq (BrigadeMove yig'indisi: berilgan − sarflangan − qaytarilgan);
 *  · xodim / oluvchi — berilgan narsa sarf hisoblanadi (qaytarish yo'q), shuning uchun barcha vaqt olgani jami
 *    (StockMove ISSUE, kirimdagi «Kimga» avto chiqimi va stornolar ishorasi bilan netlanadi).
 * Bo'sh (hech narsa olmagan) oluvchilar ro'yxatga kirmaydi.
 */

export type HoldingItem = { materialId: string; name: string; unit: string; /** brigadada — qo'lida; xodim/oluvchida — barcha vaqt jami */ qty: number };
export type Holding = { key: string; kind: "brigade" | "employee" | "recipient"; name: string; sub: string | null; href: string; items: HoldingItem[] };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const EPS = 0.0005;

export async function holdingsOverview(): Promise<Holding[]> {
  const [brigades, employees, recipients, brSums, issued, materials] = await Promise.all([
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leader: { select: { fullName: true } } } }),
    db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true, position: true } }),
    db.stockRecipient.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.brigadeMove.groupBy({ by: ["brigadeId", "materialId"], _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["employeeId", "recipientId", "materialId"], where: { type: "ISSUE", materialId: { not: null }, OR: [{ employeeId: { not: null } }, { recipientId: { not: null } }] }, _sum: { qty: true } }),
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
    l.push({ materialId: m.id, name: m.name, unit: m.unit, qty: q });
    hand.set(s.brigadeId, l);
  }

  // Xodim / oluvchi: kalit "e:<id>" | "r:<id>" → xomashyo → barcha vaqt jami (chiqim musbat)
  const got = new Map<string, Map<string, number>>();
  const keyOf = (x: { employeeId: string | null; recipientId: string | null }) => (x.employeeId ? `e:${x.employeeId}` : `r:${x.recipientId}`);
  for (const s of issued) {
    if (!s.materialId) continue;
    const k = keyOf(s);
    const byMat = got.get(k) ?? new Map<string, number>();
    byMat.set(s.materialId, r3(-Number(s._sum.qty ?? 0)));
    got.set(k, byMat);
  }
  const issuedItems = (k: string): HoldingItem[] => {
    const out: HoldingItem[] = [];
    for (const [id, q] of got.get(k) ?? []) {
      const m = mat.get(id);
      if (m && q > EPS) out.push({ materialId: id, name: m.name, unit: m.unit, qty: q });
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
