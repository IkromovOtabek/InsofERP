"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zOpt, zStr, type ActionState } from "@/lib/action";
import { validMonth } from "@/lib/davomat";
import { qty as fq } from "@/lib/format";
import { unitLabel } from "@/lib/unit";

const done = () => { revalidatePath("/dashboard"); return { ok: true } as const; };

/* ───────────────────────── Plan (faqat direktor) ───────────────────────── */

const PlanSchema = z.object({
  month: zStr(),
  productId: zStr("mahsulot tanlang"),
  monthQty: zDec(0.001),
  dayQty: z.string().trim().optional().transform((v) => (v ? Number(v.replace(",", ".")) : null)).refine((v) => v === null || (Number.isFinite(v) && v > 0), "kunlik plan musbat son bo'lsin"),
  note: zOpt,
});

/** Mahsulotning oylik (va ixtiyoriy kunlik) plani — shu oy uchun bor bo'lsa yangilanadi. */
export async function savePlan(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([]); // requireSession direktorni doim o'tkazadi, bo'sh ro'yxat — boshqa hech kim
  const r = parseForm(PlanSchema, fd);
  if ("error" in r) return { error: r.error };
  const ym = validMonth(r.data.month);
  if (!ym) return { error: "Oy noto'g'ri" };
  const [year, month] = ym.split("-").map(Number);
  const data = { monthQty: r.data.monthQty, dayQty: r.data.dayQty, note: r.data.note, setById: s.userId };
  await db.$transaction(async (tx) => {
    const before = await tx.productionPlan.findUnique({ where: { year_month_productId: { year, month, productId: r.data.productId } } });
    const p = await tx.productionPlan.upsert({
      where: { year_month_productId: { year, month, productId: r.data.productId } },
      create: { year, month, productId: r.data.productId, ...data },
      update: data,
    });
    await audit(tx, s.userId, before ? "UPDATE" : "CREATE", "ProductionPlan", p.id, before ?? undefined, p);
  });
  return done();
}

export async function deletePlan(id: string): Promise<ActionState> {
  const s = await requireSession([]);
  const p = await db.productionPlan.findUnique({ where: { id } });
  if (!p) return { error: "Plan topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.productionPlan.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "ProductionPlan", id, p);
  });
  return done();
}

/* ───────────────────────── Brak ───────────────────────── */

const DefectSchema = z.object({
  productId: zStr("mahsulot tanlang"),
  qty: zDec(0.001),
  reason: zStr("sababini tanlang"),
  brigadeId: zOpt,
  note: zOpt,
});

/**
 * Brak yozuvi. Mahsulot hovli qoldig'idan WRITE_OFF bilan ayriladi — shuning uchun
 * qoldiqdan ko'p brak yozib bo'lmaydi (u holda mahsulot hali kirim qilinmagan bo'ladi).
 */
export async function addDefect(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION", "SUPERVISOR"]);
  const r = parseForm(DefectSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const product = await db.product.findUnique({ where: { id: d.productId }, select: { id: true, name: true, unit: true } });
  if (!product) return { error: "Mahsulot topilmadi" };
  const wh = await db.warehouse.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!wh) return { error: "Sklad ochilmagan" };
  const bal = await db.stockMove.aggregate({ where: { productId: product.id }, _sum: { qty: true } });
  const balance = Number(bal._sum.qty ?? 0);
  if (d.qty > balance + 0.0005) {
    return { error: `Hovlida ${product.name} faqat ${fq(Math.max(0, balance))} ${unitLabel(product.unit)} — brak undan ko'p bo'lolmaydi. Avval ishlab chiqarilgani qayd qilinsin.` };
  }

  await db.$transaction(async (tx) => {
    const def = await tx.productDefect.create({
      data: { productId: product.id, qty: d.qty, reason: d.reason, brigadeId: d.brigadeId, note: d.note, createdById: s.userId },
    });
    await tx.stockMove.create({
      data: {
        type: "WRITE_OFF", warehouseId: wh.id, productId: product.id, brigadeId: d.brigadeId, qty: -d.qty,
        refType: "ProductDefect", refId: def.id, note: `Brak: ${d.reason}${d.note ? ` · ${d.note}` : ""}`, createdById: s.userId,
      },
    });
    await audit(tx, s.userId, "CREATE", "ProductDefect", def.id, undefined, def);
  });
  revalidatePath("/stock");
  return done();
}

/** Xato yozilgan brakni o'chirish: direktor yoki shu kuni o'zi yozgan xodim. Hovli qoldig'i qaytadi. */
export async function deleteDefect(id: string): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION", "SUPERVISOR"]);
  const def = await db.productDefect.findUnique({ where: { id } });
  if (!def) return { error: "Yozuv topilmadi" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (s.role !== "DIRECTOR" && (def.createdById !== s.userId || def.createdAt < today)) {
    return { error: "Faqat bugun o'zingiz yozgan brakni o'chira olasiz — qolganini direktor o'chiradi" };
  }
  // StockMove o'zgarmas jurnal — brak harakati o'chirilmaydi, teskari yozuv bilan qoldiq qaytariladi
  const moves = await db.stockMove.findMany({ where: { refType: "ProductDefect", refId: id, type: "WRITE_OFF" } });
  await db.$transaction(async (tx) => {
    for (const m of moves) {
      await tx.stockMove.create({
        data: {
          type: "ADJUSTMENT", warehouseId: m.warehouseId, productId: m.productId, brigadeId: m.brigadeId, qty: m.qty.negated(),
          refType: "ProductDefect", refId: id, note: "Brak yozuvi bekor qilindi", createdById: s.userId,
        },
      });
    }
    await tx.productDefect.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "ProductDefect", id, def);
  });
  revalidatePath("/stock");
  return done();
}
