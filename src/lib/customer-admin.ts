import type { Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { defaultCreditLimit } from "@/lib/finance";
import { parseInn } from "@/lib/inn";
import { money } from "@/lib/format";

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
};

export type SaveCustomerResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * `creditLimitWas` — forma ochilgandagi limit. Xodim limitga tegmagan bo'lsa, u umuman yozilmaydi: shu orada direktor
 * (Sozlamalar → Limitlar) yoki buxgalteriya o'zgartirgan limit eski forma bilan orqaga qaytib ketmasin.
 */
export async function saveCustomerLib(id: string | null, input: CustomerInput, who: { userId: string; role: Role }, creditLimitWas: string | null): Promise<SaveCustomerResult> {
  const d = { ...input };
  const cur = id ? await db.customer.findUnique({ where: { id } }) : null;
  if (id && !cur) return { ok: false, error: "Mijoz topilmadi" };

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
    if (String(e).includes("Unique constraint")) return { ok: false, error: "Bu INN bilan mijoz allaqachon bor" };
    if (String(e).includes("LIMIT_CONFLICT")) return { ok: false, error: "Kredit limiti shu orada boshqa joyda o'zgartirilgan. Sahifani yangilab, qayta kiriting" };
    throw e;
  }
  return { ok: true, id: savedId! };
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
