"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zOpt, zStr, type ActionState } from "@/lib/action";
import { today, validDay, validMonth } from "@/lib/davomat";
import { assignEmployeeBrigade, markAllPresent, markProductionAttendance, markProductionCheckout } from "@/lib/production-staff";
import { submitReport } from "@/lib/production-report";
import { addProductDefect } from "@/lib/defects";

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

/** Brak yozuvi — qoida `lib/defects.ts` da (brigadir ilovasi ham shuni chaqiradi). */
export async function addDefect(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION", "SUPERVISOR"]);
  const r = parseForm(DefectSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await addProductDefect(r.data, s.userId);
  if ("error" in res) return { error: res.error };
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

/* ───────────────────────── Sex davomati (ishlab chiqarish boshlig'i) ───────────────────────── */

const MarkSchema = z.object({
  employeeId: zStr("xodim tanlanmagan"),
  status: z.enum(["PRESENT", "ABSENT", "LEAVE", "SICK", "DAYOFF", "CHECKOUT"]),
  checkIn: zOpt,
  note: zOpt,
});

/** Bitta sex xodimining bugungi davomati. `CHECKOUT` — ketgan vaqtini hozir qilib qo'yadi. */
export async function markStaff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION", "SUPERVISOR"]);
  const r = parseForm(MarkSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const res = d.status === "CHECKOUT"
    ? await markProductionCheckout(s.userId, d.employeeId)
    : await markProductionAttendance(s.userId, d.employeeId, { status: d.status, checkIn: d.checkIn, note: d.note });
  if ("error" in res) return { error: res.error };
  revalidatePath("/otdel-kadr");
  return done();
}

/** Belgilanmagan hamma sex xodimi — "Keldi". */
export async function markAllStaff(): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION", "SUPERVISOR"]);
  const r = await markAllPresent(s.userId);
  revalidatePath("/otdel-kadr");
  revalidatePath("/dashboard");
  return { ok: true, note: r.count ? `${r.count} kishi "Keldi" deb belgilandi` : "Hamma belgilangan" };
}

/* ───────────────────────── Xodimlarni taqsimlash (faqat direktor) ───────────────────────── */

export async function assignStaff(employeeId: string, brigadeId: string): Promise<ActionState> {
  const s = await requireSession([]);
  const r = await assignEmployeeBrigade(s.userId, employeeId, brigadeId || null);
  if ("error" in r) return { error: r.error };
  revalidatePath("/dashboard/xodimlar");
  return done();
}

/* ───────────────────────── Kunlik hisobot: "Qayd etish" ───────────────────────── */

export async function saveReport(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["PRODUCTION", "SUPERVISOR"]);
  const iso = validDay(String(fd.get("iso") ?? "")) ?? today();
  const note = String(fd.get("note") ?? "").trim() || null;
  const r = await submitReport(s.userId, iso, note);
  if ("error" in r) return { error: r.error };
  revalidatePath("/dashboard/hisobot");
  return { ok: true, note: "Hisobot saqlandi va direktorga yuborildi" };
}
