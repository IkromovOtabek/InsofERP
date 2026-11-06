"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { canDo } from "@/lib/permissions";
import { parseInn } from "@/lib/inn";
import { upsertRecipient } from "@/lib/stock-recipients";
import { createCashCategory } from "@/lib/fin-report/categories";
import { validDate } from "@/lib/action";
import { isoDate } from "@/lib/format";

/** PNL qatorlari (`PnlLine`) — yangi manba uchun tanlov; klient ro'yxati `PNL_LINE_LABEL` dan. */
const PNL_LINES = ["OTHER_INCOME", "MATERIALS", "PRODUCTION", "PAYROLL", "TRANSPORT", "ADMIN", "COMMERCIAL", "TAX", "INTEREST", "DIVIDEND", "NONE"] as const;

/**
 * Formadagi tanlash maydoni ichidagi «+» tugmasi (`components/quick-add.tsx`): ro'yxatda yo'q yozuvni
 * forma ichidan qo'shish. Natija — yangi tanlov (`id`, `name`), forma uni darhol tanlab qo'yadi.
 */
export type QuickAddResult = { error: string } | { id: string; name: string; vatPayer?: boolean };

const text = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const NO_RIGHT = "Bu amal uchun sizda ruxsat yo'q — direktordan ruxsat so'rang";

/**
 * Yangi yetkazuvchi («Kimdan», Kirim-Chiqim → «Yetkazuvchi»): nomi, ixtiyoriy INN, QQS to'lovchisimi.
 * Huquq — Yetkazuvchilar bo'limi yoki kirim-chiqim yozish (kassada to'lanadigan yetkazuvchi ro'yxatda bo'lmasa).
 */
export async function quickAddSupplier(fd: FormData): Promise<QuickAddResult> {
  const s = await getSession();
  if (!s || !(canDo(s, "stock", "suppliers") || canDo(s, "cashflow", "create"))) return { error: NO_RIGHT };
  const name = text(fd, "name", 200);
  if (!name) return { error: "Yetkazuvchi nomini kiriting" };
  const inn = parseInn(fd.get("inn"));
  if (inn.error !== undefined) return { error: inn.error };
  const dup = await db.supplier.findFirst({
    where: inn.inn ? { OR: [{ inn: inn.inn }, { name: { equals: name, mode: "insensitive" } }] } : { name: { equals: name, mode: "insensitive" } },
    select: { name: true, inn: true, isActive: true },
  });
  if (dup) return { error: `«${dup.name}» yetkazuvchisi allaqachon bor${dup.isActive ? " — ro'yxatdan tanlang" : " (yopilgan — Yetkazuvchilar bo'limida faollashtiring)"}` };
  try {
    const sup = await db.supplier.create({ data: { name, inn: inn.inn, vatPayer: fd.get("vatPayer") !== "0" } });
    await audit(db, s.userId, "CREATE", "Supplier", sup.id, undefined, { ...sup, via: "quick-add" });
    revalidatePath("/suppliers"); revalidatePath("/cashflow");
    return { id: sup.id, name: sup.name, vatPayer: sup.vatPayer };
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan yetkazuvchi bor" };
    throw e;
  }
}

/**
 * Yangi oluvchi («Kimga» ro'yxati — kirimda ham, chiqimda ham bitta ro'yxat). Kirim yoki chiqim yozuvchi qo'sha oladi.
 * Qoida `lib/stock-recipients.ts#upsertRecipient` da (nom takrorlanmaydi).
 */
export async function quickAddRecipient(fd: FormData): Promise<QuickAddResult> {
  const s = await getSession();
  if (!s || !(canDo(s, "stock", "issue") || canDo(s, "stock", "receipt"))) return { error: NO_RIGHT };
  const name = text(fd, "name", 80);
  const res = await upsertRecipient({ name, note: text(fd, "note", 200) || null }, s.userId);
  if ("error" in res) return { error: res.error };
  revalidatePath("/stock/rasxod");
  return { id: res.id, name };
}

const canCashAdd = (s: Awaited<ReturnType<typeof getSession>>) => !!s && (canDo(s, "cashflow", "create") || canDo(s, "moliya", "categories"));

/**
 * Kirim-Chiqim formasidagi «+»: yangi manba (`type` va PNL qatori bilan) yoki tanlangan manba ostiga sub manba (`parent` — manba nomi).
 * Qoida — Moliya → Kategoriyalardagi bilan bitta (`createCashCategory`); oqim turi «Joriy faoliyat», keyin o'sha sahifada o'zgartiriladi.
 */
export async function quickAddCashCategory(fd: FormData): Promise<QuickAddResult> {
  const s = await getSession();
  if (!s || !canCashAdd(s)) return { error: NO_RIGHT };
  const parentName = text(fd, "parent", 80);
  let parentId: string | null = null;
  if (parentName) {
    const p = await db.cashCategory.findFirst({ where: { name: parentName, parentId: null }, select: { id: true } });
    if (!p) return { error: "Manba topilmadi — sahifani yangilang" };
    parentId = p.id;
  }
  const type = fd.get("type") === "INCOME" ? "INCOME" : "EXPENSE";
  const line = String(fd.get("pnlLine") ?? "");
  const pnlLine = (PNL_LINES as readonly string[]).includes(line) ? (line as (typeof PNL_LINES)[number]) : type === "INCOME" ? "OTHER_INCOME" : "PRODUCTION";
  const res = await createCashCategory({ name: text(fd, "name", 80), parentId, type, flow: "OPERATING", pnlLine, via: "kirim-chiqim" }, s.userId);
  if ("error" in res) return res;
  revalidatePath("/cashflow"); revalidatePath("/moliya/kategoriyalar"); revalidatePath("/payments/import");
  return res;
}

const LOAN_KINDS = ["BANK", "BORROWED", "LENT"] as const;

/**
 * «Kredit / qarz» ichidagi «+»: yangi kredit yoki qarz (Moliya → Kreditlar va qarzlardagi kabi). Qoldiq 0 dan, sanasi — kassa
 * yozuvining sanasi: qarzni shu kirim/chiqimning o'zi ochadi (boshlang'ich qoldiq kiritilsa, summa ikki marta hisoblanardi).
 */
export async function quickAddLoan(fd: FormData): Promise<QuickAddResult> {
  const s = await getSession();
  if (!s || !(canDo(s, "moliya", "loans") || canDo(s, "cashflow", "create"))) return { error: NO_RIGHT };
  const kind = LOAN_KINDS.find((k) => k === fd.get("kind"));
  if (!kind) return { error: "Turi tanlanmagan" };
  const counterparty = text(fd, "counterparty", 160);
  if (!counterparty) return { error: kind === "LENT" ? "Kimga berilganini yozing" : "Bank yoki kimdan olinganini yozing" };
  const name = text(fd, "name", 160) || counterparty;
  if (await db.loan.findFirst({ where: { kind, name: { equals: name, mode: "insensitive" }, cancelledAt: null, closedAt: null }, select: { id: true } })) return { error: "Bunday qarz bor — ro'yxatdan tanlang" };
  const date = String(fd.get("date") ?? "");
  const l = await db.$transaction(async (tx) => {
    const l = await tx.loan.create({ data: { kind, name, counterparty, openingBalance: 0, openingDate: new Date(validDate(date) ? date : isoDate()), note: text(fd, "note", 300) || null, createdById: s.userId } });
    await audit(tx, s.userId, "CREATE", "Loan", l.id, undefined, { ...l, via: "kirim-chiqim" });
    return l;
  });
  revalidatePath("/cashflow"); revalidatePath("/moliya/kreditlar"); revalidatePath("/moliya");
  return { id: l.id, name: l.name };
}

/** «Loyiha» ichidagi «+»: yangi loyiha (Moliya → Kategoriyalar → Loyihalardagi kabi). */
export async function quickAddProject(fd: FormData): Promise<QuickAddResult> {
  const s = await getSession();
  if (!s || !canCashAdd(s)) return { error: NO_RIGHT };
  const name = text(fd, "name", 120);
  if (!name) return { error: "Loyiha nomini kiriting" };
  if (await db.project.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } })) return { error: "Bunday loyiha bor — ro'yxatdan tanlang" };
  try {
    const p = await db.$transaction(async (tx) => {
      const p = await tx.project.create({ data: { name, note: text(fd, "note", 300) || null, createdById: s.userId } });
      await audit(tx, s.userId, "CREATE", "Project", p.id, undefined, { ...p, via: "kirim-chiqim" });
      return p;
    });
    revalidatePath("/cashflow"); revalidatePath("/moliya/kategoriyalar");
    return { id: p.id, name: p.name };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { error: "Bunday loyiha bor" };
    throw e;
  }
}
