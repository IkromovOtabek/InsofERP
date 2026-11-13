"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { IssueError } from "@/lib/stock-issue";
import { cancelVehicleIssue, issueToVehicle, returnFromDispatcher, takeToDispatcher } from "@/lib/dispatcher-stock";

/**
 * Dispetcher ombori amallari (`lib/dispatcher-stock.ts`): o'ziga olish, skladga qaytarish, mashinaga berish, bekor qilish.
 * Ruxsat — `stock` → `dispatch` (dispetcher; direktor har doim). Kutilgan xatolar (`IssueError`) foydalanuvchiga matn bilan qaytadi.
 */
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const fail = (e: unknown): ActionState => {
  if (e instanceof IssueError) return { error: e.message };
  throw e;
};
const refresh = () => {
  revalidatePath("/stock/dispetcher");
  revalidatePath("/stock");
  revalidatePath("/logistika/tabel");
};
const items = (fd: FormData): unknown => { try { return JSON.parse(s(fd, "rows") || "[]"); } catch { return []; } };

export async function takeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireAction("stock", "dispatch");
  try {
    const r = await takeToDispatcher({ warehouseId: s(fd, "warehouseId"), items: items(fd), note: s(fd, "note"), clientToken: s(fd, "clientToken") }, me);
    refresh();
    return { ok: true, note: r.existed ? "Allaqachon olingan" : `${r.count} ta mahsulot dispetcher omboriga olindi` };
  } catch (e) { return fail(e); }
}

export async function returnAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireAction("stock", "dispatch");
  try {
    const r = await returnFromDispatcher({ warehouseId: s(fd, "warehouseId"), items: items(fd), note: s(fd, "note"), clientToken: s(fd, "clientToken") }, me);
    refresh();
    return { ok: true, note: r.existed ? "Allaqachon qaytarilgan" : `${r.count} ta mahsulot skladga qaytarildi` };
  } catch (e) { return fail(e); }
}

export async function issueAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireAction("stock", "dispatch");
  try {
    const r = await issueToVehicle({
      vehicleId: s(fd, "vehicleId"), materialId: s(fd, "materialId"), qty: Number(s(fd, "qty").replace(",", ".")), date: s(fd, "date") || null,
      driverId: s(fd, "driverId") || null, note: s(fd, "note"), clientToken: s(fd, "clientToken"),
    }, me);
    refresh();
    return { ok: true, note: r.existed ? "Allaqachon yozilgan" : "Mashinaga berildi" };
  } catch (e) { return fail(e); }
}

export async function cancelIssueAction(refId: string, reason: string): Promise<ActionState> {
  const me = await requireAction("stock", "dispatch");
  try {
    await cancelVehicleIssue(refId, reason, me);
    refresh();
    return { ok: true, note: "Bekor qilindi — mol dispetcher omboriga qaytdi" };
  } catch (e) { return fail(e); }
}
