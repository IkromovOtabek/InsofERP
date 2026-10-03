"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireModuleWrite, requireSession } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import {
  createSupplyRequest, editSupplyItems, priceSupplyRequest, approveSupplyRequest,
  fundSupplyRequest, saveSupplyFact, receiveSupplyRequest, rejectSupplyRequest,
  type FactRow, type NewItem,
} from "@/lib/supply";
import {
  addSupplyDocument, addSupplyQuote, chooseSupplyQuote, createSupplyIncident, deleteSupplyQuote, directorApproveSupply,
  removeSupplyDocument, resolveSupplyIncident, updateSupplyDelivery, updateSupplyMeta,
} from "@/lib/procurement";

/**
 * Ta'minot zanjirining server amallari. `lib` da turadi, chunki ularni ham route sahifalari,
 * ham umumiy `components/` dagi tasdiq panellari chaqiradi — modul bitta bo'lsa
 * action identifikatorlari ham bitta bo'ladi. Har bosqichni o'z bo'limi bajaradi:
 * qoida `lib/supply.ts` da, bu yerda — kim bosishi mumkinligi va qaysi sahifalar yangilanishi.
 *
 * Eslatma: zavodda alohida snabjeniye logini bo'lmasligi mumkin (PROCUREMENT roli sklad bilan
 * qo'shilgan) — shuning uchun snabjeniye amallarini WAREHOUSE ham bajara oladi.
 */
const PROCUREMENT = ["PROCUREMENT", "WAREHOUSE"] as const;
const APPROVERS = ["SALES"] as const; // "Zayavkalar" ochilgan ma'sul xodim (direktor har doim)
const FINANCE = ["FINANCE", "ACCOUNTING", "CASHIER"] as const;

/** Zanjirdagi barcha bo'lim sahifalari — bosqich o'zgarganda hammasi yangilanadi. */
function refresh(id?: string) {
  revalidatePath("/taminot"); revalidatePath("/snabjeniye"); revalidatePath("/stock"); revalidatePath("/orders");
  revalidatePath("/cashflow"); revalidatePath("/receipts"); revalidatePath("/dashboard");
  if (id) revalidatePath(`/taminot/${id}`);
}

const num = (fd: FormData, key: string) => {
  const v = String(fd.get(key) ?? "").replace(/\s+/g, "").replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
/** `prefix_<itemId>` ko'rinishidagi maydonlardan qator id'larini yig'adi. */
const itemIds = (fd: FormData, prefix: string) =>
  [...fd.keys()].filter((k) => k.startsWith(`${prefix}_`)).map((k) => k.slice(prefix.length + 1));

// ───────────── 1. Sklad: kerakli mahsulotlar jadvali ─────────────

export async function createRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"]);
  let items: NewItem[];
  try { items = JSON.parse(String(fd.get("rows") ?? "[]")); } catch { return { error: "Jadval o'qilmadi" }; }
  const pr = text(fd, "priority");
  const r = await createSupplyRequest(
    {
      warehouseId: text(fd, "warehouseId"), needBy: text(fd, "needBy") || null, note: text(fd, "note") || null, items,
      department: text(fd, "department") || null, priority: pr === "HIGH" || pr === "CRITICAL" ? pr : "NORMAL",
    },
    s.userId,
  );
  if (r.error) return { error: r.error };
  refresh(r.id);
  redirect(`/taminot/${r.id}?ok=created`);
}

export async function editItems(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"]);
  const rows = itemIds(fd, "qty").map((itemId) => ({ itemId, qty: num(fd, `qty_${itemId}`), note: text(fd, `note_${itemId}`) || null }));
  const r = await editSupplyItems(id, rows, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: "Jadval saqlandi" };
}

// ───────────── 2. Snabjeniye: narx ─────────────

export async function setPrices(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...PROCUREMENT]);
  const rows = itemIds(fd, "price").map((itemId) => ({ itemId, price: num(fd, `price_${itemId}`), qty: num(fd, `qty_${itemId}`) }));
  const r = await priceSupplyRequest(id, {
    supplierId: text(fd, "supplierId") || null, note: text(fd, "note") || null, rows,
    delivery: { kind: text(fd, "deliveryKind") || null, provider: text(fd, "deliveryProvider") || null, cost: num(fd, "deliveryCost"), note: text(fd, "deliveryNote") || null },
  }, s.userId, s.role);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: "Zayavka tasdiqlashga yuborildi" };
}

// ───────────── 3. Ma'sul xodim: tasdiqlash ─────────────

export async function approve(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...APPROVERS]);
  const r = await approveSupplyRequest(id, s.userId, text(fd, "note") || null);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

// ───────────── 4. Moliya: pul ajratish ─────────────

export async function fund(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...FINANCE]);
  const r = await fundSupplyRequest(id, { cashAccountId: text(fd, "cashAccountId"), note: text(fd, "note") || null }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

// ───────────── 5. Snabjeniye: tekshirish va qabul ─────────────

const factRows = (fd: FormData): FactRow[] =>
  itemIds(fd, "factQty").map((itemId) => ({ itemId, factQty: num(fd, `factQty_${itemId}`), factPrice: num(fd, `factPrice_${itemId}`) }));

export async function saveFact(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...PROCUREMENT]);
  const r = await saveSupplyFact(id, factRows(fd), s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

export async function receive(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...PROCUREMENT]);
  const r = await receiveSupplyRequest(id, {
    supplierId: text(fd, "supplierId") || null, rows: factRows(fd), note: text(fd, "note") || null,
    deliveryFactCost: fd.has("deliveryFactCost") ? num(fd, "deliveryFactCost") : null,
  }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id); revalidatePath("/brigades"); revalidatePath("/orders");
  return { ok: true, note: r.note };
}

/**
 * Bitta formada ikki tugma: «Faktni saqlash» va «Qabul qildim» (bosilgan tugmaning
 * `mode` qiymati FormData'ga tushadi — brauzerning o'z qoidasi).
 */
export async function checkIn(id: string, prev: ActionState, fd: FormData): Promise<ActionState> {
  return String(fd.get("mode")) === "receive" ? receive(id, prev, fd) : saveFact(id, prev, fd);
}

/** Ma'sul xodim paneli: tasdiqlash yoki bekor qilish. */
export async function decide(id: string, prev: ActionState, fd: FormData): Promise<ActionState> {
  return String(fd.get("mode")) === "reject" ? reject(id, prev, fd) : approve(id, prev, fd);
}

/** Moliya paneli: pul ajratish yoki bekor qilish. */
export async function financeDecide(id: string, prev: ActionState, fd: FormData): Promise<ActionState> {
  return String(fd.get("mode")) === "reject" ? reject(id, prev, fd) : fund(id, prev, fd);
}

// ───────────── Bekor qilish (har bosqichda, o'z bo'limi) ─────────────
// Kim qaysi bosqichda bekor qila olishi — `canRejectSupply` (lib/supply.ts): pul bosqichida faqat moliya/direktor.

export async function reject(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", ...APPROVERS, ...FINANCE]);
  const r = await rejectSupplyRequest(id, { id: s.userId, role: s.role }, text(fd, "reason"));
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

// ───────────── Snabjeniye TZ: rekvizitlar, takliflar, direktor, yetkazish, muammo, hujjat ─────────────
// Qoida `lib/procurement.ts` da — mobil ilova ham o'shani chaqiradi.

export async function saveMeta(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...PROCUREMENT]);
  const r = await updateSupplyMeta(id, {
    department: text(fd, "department") || null, priority: text(fd, "priority") || null,
    responsibleId: text(fd, "responsibleId") || null, needBy: text(fd, "needBy") || null, contractNo: text(fd, "contractNo") || null,
  }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

export async function addQuote(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...PROCUREMENT]);
  const r = await addSupplyQuote(id, {
    supplierId: text(fd, "supplierId") || null, supplierName: text(fd, "supplierName") || null, amount: num(fd, "amount"),
    deliveryDays: text(fd, "deliveryDays") ? num(fd, "deliveryDays") : null, paymentTerms: text(fd, "paymentTerms") || null,
    validUntil: text(fd, "validUntil") || null, note: text(fd, "note") || null,
  }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

export async function chooseQuote(quoteId: string): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...PROCUREMENT]);
  const r = await chooseSupplyQuote(quoteId, s.userId);
  if (r.error) return { error: r.error };
  refresh(r.id);
  return { ok: true, note: r.note };
}

export async function dropQuote(quoteId: string): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...PROCUREMENT]);
  const r = await deleteSupplyQuote(quoteId, s.userId);
  if (r.error) return { error: r.error };
  refresh(r.id);
  return { ok: true, note: r.note };
}

/** Katta xarid — faqat direktor (requireSession DIRECTOR'ni har doim o'tkazadi). */
export async function directorApprove(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([]);
  if (s.role !== "DIRECTOR") return { error: "Katta xaridni faqat direktor tasdiqlaydi" };
  const r = await directorApproveSupply(id, s.userId, text(fd, "note") || null);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

/** Katta xaridni direktor rad etadi (sabab majburiy) — zayavka bekor qilinadi. */
export async function directorReject(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([]);
  if (s.role !== "DIRECTOR") return { error: "Katta xaridni faqat direktor rad etadi" };
  const reason = text(fd, "reason");
  if (!reason) return { error: "Rad etish sababini yozing" };
  const r = await rejectSupplyRequest(id, { id: s.userId, role: s.role }, `Direktor rad etdi: ${reason}`);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: "Katta xarid rad etildi — zayavka bekor qilindi" };
}

/** Direktor paneli: tasdiqlash yoki rad etish (bosilgan tugmaning `mode` qiymati). */
export async function directorDecide(id: string, prev: ActionState, fd: FormData): Promise<ActionState> {
  return String(fd.get("mode")) === "reject" ? directorReject(id, prev, fd) : directorApprove(id, prev, fd);
}

export async function saveDelivery(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...PROCUREMENT]);
  const r = await updateSupplyDelivery(id, {
    status: text(fd, "deliveryStatus"), shippedAt: text(fd, "shippedAt") || null, eta: text(fd, "eta") || null,
    provider: text(fd, "deliveryProvider") || null, note: text(fd, "note") || null,
  }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

export async function addIncident(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", ["PROCUREMENT", "WAREHOUSE", "PRODUCTION"]);
  const r = await createSupplyIncident(id, { kind: text(fd, "kind"), note: text(fd, "note") }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

export async function closeIncident(incidentId: string, requestId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", [...PROCUREMENT]);
  const r = await resolveSupplyIncident(incidentId, text(fd, "resolution"), s.userId);
  if (r.error) return { error: r.error };
  refresh(requestId);
  return { ok: true, note: r.note };
}

export async function attachDoc(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", ["PROCUREMENT", "WAREHOUSE", "ACCOUNTING", "FINANCE"]);
  const f = fd.get("file");
  const r = await addSupplyDocument(id, text(fd, "kind"), f instanceof File ? f : null, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

export async function dropDoc(docId: string): Promise<ActionState> {
  const s = await requireModuleWrite("taminot", ["PROCUREMENT", "WAREHOUSE", "ACCOUNTING", "FINANCE"]);
  const r = await removeSupplyDocument(docId, s.userId, s.role);
  if (r.error) return { error: r.error };
  refresh(r.id);
  return { ok: true, note: r.note };
}
