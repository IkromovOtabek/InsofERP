"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import {
  createSupplyRequest, editSupplyItems, priceSupplyRequest, approveSupplyRequest,
  fundSupplyRequest, saveSupplyFact, receiveSupplyRequest, rejectSupplyRequest,
  type FactRow, type NewItem,
} from "@/lib/supply";

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
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION"]);
  let items: NewItem[];
  try { items = JSON.parse(String(fd.get("rows") ?? "[]")); } catch { return { error: "Jadval o'qilmadi" }; }
  const r = await createSupplyRequest(
    { warehouseId: text(fd, "warehouseId"), needBy: text(fd, "needBy") || null, note: text(fd, "note") || null, items },
    s.userId,
  );
  if (r.error) return { error: r.error };
  refresh(r.id);
  redirect(`/taminot/${r.id}?ok=created`);
}

export async function editItems(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION"]);
  const rows = itemIds(fd, "qty").map((itemId) => ({ itemId, qty: num(fd, `qty_${itemId}`), note: text(fd, `note_${itemId}`) || null }));
  const r = await editSupplyItems(id, rows, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: "Jadval saqlandi" };
}

// ───────────── 2. Snabjeniye: narx ─────────────

export async function setPrices(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...PROCUREMENT]);
  const rows = itemIds(fd, "price").map((itemId) => ({ itemId, price: num(fd, `price_${itemId}`), qty: num(fd, `qty_${itemId}`) }));
  const r = await priceSupplyRequest(id, {
    supplierId: text(fd, "supplierId") || null, note: text(fd, "note") || null, rows,
    delivery: { kind: text(fd, "deliveryKind") || null, provider: text(fd, "deliveryProvider") || null, cost: num(fd, "deliveryCost"), note: text(fd, "deliveryNote") || null },
  }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: "Zayavka tasdiqlashga yuborildi" };
}

// ───────────── 3. Ma'sul xodim: tasdiqlash ─────────────

export async function approve(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...APPROVERS]);
  const r = await approveSupplyRequest(id, s.userId, text(fd, "note") || null);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

// ───────────── 4. Moliya: pul ajratish ─────────────

export async function fund(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...FINANCE]);
  const r = await fundSupplyRequest(id, { cashAccountId: text(fd, "cashAccountId"), note: text(fd, "note") || null }, s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

// ───────────── 5. Snabjeniye: tekshirish va qabul ─────────────

const factRows = (fd: FormData): FactRow[] =>
  itemIds(fd, "factQty").map((itemId) => ({ itemId, factQty: num(fd, `factQty_${itemId}`), factPrice: num(fd, `factPrice_${itemId}`) }));

export async function saveFact(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...PROCUREMENT]);
  const r = await saveSupplyFact(id, factRows(fd), s.userId);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

export async function receive(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...PROCUREMENT]);
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

export async function reject(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["WAREHOUSE", "PROCUREMENT", "PRODUCTION", ...APPROVERS, ...FINANCE]);
  const r = await rejectSupplyRequest(id, s.userId, text(fd, "reason"));
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}
