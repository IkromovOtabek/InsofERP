import type { PayMethod, Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { defaultCreditLimit } from "@/lib/finance";
import { parseInn } from "@/lib/inn";
import { money } from "@/lib/format";
import { flatName } from "@/lib/excel";
import { customerNameKey, findSameNameCustomer, lockCustomerName, NameTaken, sameNameError } from "@/lib/customer-name";

/**
 * Mijoz kartasini saqlash va agentga biriktirish — veb (`customers/actions.ts`, `employees/agent-actions.ts`)
 * va mobil ilova (`lib/mobile/sotuv-extra.ts`) uchun bitta qoida. Ruxsat chaqiruvchida tekshiriladi.
 */

/** Kredit limitini kim o'zgartira oladi — veb bilan bir xil (sotuvchi emas). */
export const LIMIT_ROLES: readonly Role[] = ["FINANCE", "ACCOUNTING", "DIRECTOR"];
export const canSetCreditLimit = (role: Role) => LIMIT_ROLES.includes(role);

export type CustomerInput = {
  name: string;
  inn: string | null;
  phone: string | null;
  address: string | null;
  contactPerson: string | null;
  creditLimit: number;
  isActive: boolean;
  /** Boshqa nomlari; berilmasa (mobil forma) o'zgarmaydi */
  aliases?: string[];
};

/** Boshqa nomlari: bo'shliqlar tozalanadi, asosiy nom va takrorlar tashlanadi. */
export function cleanAliases(list: string[], name: string): string[] {
  const seen = new Set([flatName(name)]);
  const out: string[] = [];
  for (const raw of list) {
    const a = raw.replace(/\s+/g, " ").trim().slice(0, 160);
    const k = flatName(a);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(a);
  }
  return out.slice(0, 200);
}

export type SaveCustomerResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * `creditLimitWas` — forma ochilgandagi limit. Xodim limitga tegmagan bo'lsa, u umuman yozilmaydi: shu orada direktor
 * (Sozlamalar → Limitlar) yoki buxgalteriya o'zgartirgan limit eski forma bilan orqaga qaytib ketmasin.
 */
export async function saveCustomerLib(id: string | null, input: CustomerInput, who: { userId: string; role: Role }, creditLimitWas: string | null): Promise<SaveCustomerResult> {
  const d = { ...input };
  if (d.aliases) d.aliases = cleanAliases(d.aliases, d.name);
  const cur = id ? await db.customer.findUnique({ where: { id } }) : null;
  if (id && !cur) return { ok: false, error: "Mijoz topilmadi" };

  // Bir xil nomli mijoz bo'lmasin: yangi karta ham, nomi o'zgargan karta ham boshqa mijoz nomini (yoki boshqa nomini) olmaydi.
  // Bu yerda tez javob; tranzaksiya ichida qulf ostida qayta tekshiriladi (ikki oyna bir vaqtda bir xil nomni ochmasin)
  const nameChanged = !cur || customerNameKey(cur.name) !== customerNameKey(d.name);
  if (nameChanged) {
    const same = await findSameNameCustomer(d.name, id);
    if (same) return { ok: false, error: sameNameError(same, d.name, !!id) };
  }

  // INN: 9 (STIR) yoki 14 (JSHSHIR) raqam. Tahrirda o'zgartirilmagan eski qiymat qayta tekshirilmaydi
  if (!(cur && d.inn === cur.inn)) {
    const inn = parseInn(d.inn);
    if (inn.error !== undefined) return { ok: false, error: inn.error };
    d.inn = inn.inn;
  }

  const wasRaw = String(creditLimitWas ?? "").trim();
  const was = cur && wasRaw !== "" && Number.isFinite(Number(wasRaw)) ? Number(wasRaw) : null;
  const limitTouched = !(cur && was !== null && Math.abs(d.creditLimit - was) < 0.005);
  if (!limitTouched) d.creditLimit = Number(cur!.creditLimit);
  else if (cur && was !== null && Math.abs(Number(cur.creditLimit) - was) >= 0.005) {
    return { ok: false, error: `Kredit limiti shu orada boshqa joyda o'zgartirilgan (hozir ${money(Number(cur.creditLimit))}). Sahifani yangilab, qayta kiriting` };
  }

  // Kredit limitni faqat buxgalteriya/finance/direktor o'zgartira oladi. Yangi mijozda ham: aks holda sotuvchi
  // mijozni 10 mlrd limit bilan ochib, qora ro'yxat tekshiruvini chetlab o'tardi. Yangi mijozga — standart limit
  // (direktor Sozlamalar → Limitlar'da belgilaydi), formadan kelgan qiymat hisobga olinmaydi.
  if (!canSetCreditLimit(who.role)) {
    if (cur) {
      if (Number(cur.creditLimit) !== d.creditLimit) return { ok: false, error: "Kredit limitni faqat Buxgalteriya, Finance yoki Direktor o'zgartira oladi" };
    } else {
      d.creditLimit = await defaultCreditLimit();
    }
  }

  let savedId = id;
  try {
    await db.$transaction(async (tx) => {
      if (nameChanged) {
        await lockCustomerName(tx, d.name);
        const same = await findSameNameCustomer(d.name, id, tx);
        if (same) throw new NameTaken(sameNameError(same, d.name, !!id));
      }
      if (id) {
        // Limit o'zgarsa — zayavka qabul qilish va Limitlar jadvali bilan bir xil `credit:` navbati; limitga tegilmagan bo'lsa
        // uni yozmaymiz (o'qish va yozish orasida boshqa joyda o'zgargan limit saqlanib qolsin)
        if (limitTouched) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"credit:" + id}))`;
        const before = await tx.customer.findUniqueOrThrow({ where: { id } });
        if (limitTouched && was !== null && Math.abs(Number(before.creditLimit) - was) >= 0.005) throw new Error("LIMIT_CONFLICT");
        const { creditLimit, ...rest } = d;
        const after = await tx.customer.update({ where: { id }, data: limitTouched ? { ...rest, creditLimit } : rest });
        await audit(tx, who.userId, "UPDATE", "Customer", id, before, after);
        // Limit o'zgarishi alohida yozuv: kim, qachon, qanchadan qanchaga — tekshiruvda tez topilsin
        if (Number(before.creditLimit) !== Number(after.creditLimit)) {
          await audit(tx, who.userId, "UPDATE", "CustomerCreditLimit", id, { creditLimit: before.creditLimit, role: who.role }, { creditLimit: after.creditLimit, role: who.role });
        }
      } else {
        const c = await tx.customer.create({ data: d });
        await audit(tx, who.userId, "CREATE", "Customer", c.id, undefined, c);
        savedId = c.id;
      }
    });
  } catch (e) {
    if (e instanceof NameTaken) return { ok: false, error: e.message };
    if (String(e).includes("Unique constraint")) return { ok: false, error: "Bu INN bilan mijoz allaqachon bor" };
    if (String(e).includes("LIMIT_CONFLICT")) return { ok: false, error: "Kredit limiti shu orada boshqa joyda o'zgartirilgan. Sahifani yangilab, qayta kiriting" };
    throw e;
  }
  return { ok: true, id: savedId! };
}

/**
 * Qarz varag'idagi qalam (Tahlil → Mijoz debitorka): mijoz nomi va turi (naqd / perechisleniye, `Customer.payKind`;
 * null — oxirgi zayavka, bo'lmasa Realizatsiya qatori bo'yicha, `customerKinds`). Nom boshqa mijoznikiga (yoki uning boshqa nomiga) to'g'ri kelsa — rad etiladi, birlashtirish
 * mijoz kartasida. Eski nom «boshqa nomlari»ga o'tadi: Realizatsiya, kassa «Kimdan» va importlar eski yozilishni ham taniydi.
 */
export async function updateCustomerNameKind(id: string, input: { name: string; payKind: PayMethod | null }, userId: string): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!customerNameKey(name)) return { ok: false, error: "Nomi to'ldirilishi shart" };
  const cur = await db.customer.findUnique({ where: { id }, select: { name: true, isInternal: true } });
  if (!cur || cur.isInternal) return { ok: false, error: "Mijoz topilmadi" };
  const nameChanged = customerNameKey(cur.name) !== customerNameKey(name);
  if (nameChanged) {
    const same = await findSameNameCustomer(name, id);
    if (same) return { ok: false, error: sameNameError(same, name, true) };
  }
  try {
    const note = await db.$transaction(async (tx) => {
      if (nameChanged) {
        await lockCustomerName(tx, name);
        const same = await findSameNameCustomer(name, id, tx);
        if (same) throw new NameTaken(sameNameError(same, name, true));
      }
      const before = await tx.customer.findUniqueOrThrow({ where: { id } });
      const aliases = before.name !== name ? cleanAliases([...before.aliases, before.name], name) : before.aliases;
      if (before.name === name && before.payKind === input.payKind) return "O'zgarish yo'q";
      const after = await tx.customer.update({ where: { id }, data: { name, payKind: input.payKind, aliases } });
      await audit(tx, userId, "UPDATE", "Customer", id, { name: before.name, payKind: before.payKind, aliases: before.aliases }, { name: after.name, payKind: after.payKind, aliases: after.aliases, via: "debt-sheet" });
      return "Saqlandi";
    });
    return { ok: true, note };
  } catch (e) {
    if (e instanceof NameTaken) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * Mijozni sotuv agentiga biriktirish / biriktirishni bekor qilish (Customer.agentId).
 * `agentId` bo'sh ("") — biriktirish uziladi. Tanlangan agent aynan AGENT rolli faol foydalanuvchi bo'lishi shart.
 */
export async function assignCustomerAgentLib(customerId: string, agentId: string, userId: string): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  if (!customerId) return { ok: false, error: "Mijoz tanlanmagan" };
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, agentId: true } });
  if (!customer) return { ok: false, error: "Mijoz topilmadi" };

  let newAgentId: string | null = null;
  if (agentId) {
    const agent = await db.user.findUnique({ where: { id: agentId }, select: { id: true, role: true, isActive: true, fullName: true } });
    if (!agent || !agent.isActive) return { ok: false, error: "Agent topilmadi yoki nofaol" };
    if (agent.role !== "AGENT") return { ok: false, error: "Tanlangan foydalanuvchi sotuv agenti emas" };
    newAgentId = agent.id;
  }
  if (customer.agentId === newAgentId) return { ok: true, note: "O'zgarish yo'q" };

  await db.customer.update({ where: { id: customerId }, data: { agentId: newAgentId } });
  await audit(db, userId, "UPDATE", "Customer", customerId, { agentId: customer.agentId }, { agentId: newAgentId, mijoz: customer.name });
  return { ok: true, note: newAgentId ? `${customer.name} agentga biriktirildi` : `${customer.name} agentdan uzildi` };
}
