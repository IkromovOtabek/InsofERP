"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ROW_FLAGS_SELECT, orderRowFlags, type OrderRowFlags } from "./row-flags";

/**
 * «Excel ko'rinish» varag'idagi olingan (kulrang) zayavkalar uchun: qaysi qatorda qalam va «Bekor qilish» chiqadi.
 * Varaq klient komponent — sessiya va zames/reys holati shu yerda o'qiladi (qoida `row-flags.ts`, kartadagi bilan bir xil).
 */
export async function loadOrderRowFlags(ids: string[]): Promise<Record<string, OrderRowFlags>> {
  const s = await getSession();
  if (!s || !Array.isArray(ids)) return {};
  const list = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, 500);
  if (!list.length) return {};
  const orders = await db.order.findMany({ where: { id: { in: list } }, select: { id: true, ...ROW_FLAGS_SELECT } });
  return Object.fromEntries(orders.map((o) => [o.id, orderRowFlags(s, o)]));
}
