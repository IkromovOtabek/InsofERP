import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { itemTasks } from "@/lib/production";
import { notifyAfter, notifyEmployees } from "@/lib/notify";

/**
 * Zayavka qatorlarini brigadalarga taqsimlash — yagona joy (veb «Ishlab chiqarish» → «Tayinlash» va matritsa,
 * mobil ilovadagi zayavka kartochkasi ham shuni chaqiradi).
 *
 * Qatorning hammasini yoki bir qismini bir brigadaga berish mumkin; qolgani keyin boshqa brigadaga beriladi
 * (har biriga alohida topshiriq). Jami berilgani qator miqdoridan oshmaydi — tekshiruv qator qulfi ostida,
 * ikki kishi bir vaqtda bossa ham ortiqcha topshiriq ochilmaydi. Brigada tanlanmagan qatorlar keyinga qoladi.
 * Sessiya/ruxsat tekshiruvi (`production` → `assign`) va `revalidatePath` — chaqiruvchida.
 */
class AssignError extends Error {}

/**
 * `picks` — qator id → brigada id yoki { brigada, miqdor }. Miqdor berilmasa — qatorning hali berilmagan hammasi
 * (eski mobil ilova faqat brigada yuboradi). Bo'sh brigada — shu qator hozir tayinlanmaydi.
 */
export type AssignPick = string | { brigadeId: string; qty?: number | null };
export type AssignResult = { error: string } | { ok: true; made: { taskId: string; taskNo: string; brigadeId: string; qty: number }[] };

export async function assignOrderBrigades(orderId: string, picks: Record<string, AssignPick>, userId: string): Promise<AssignResult> {
  const o = await db.order.findUnique({ where: { id: orderId }, include: { items: { include: { product: { select: { name: true, unit: true } } } } } });
  if (!o) return { error: "Zayavka topilmadi" };
  // Faqat tasdiqlangan zayavka ishga tushadi: qoralama (DRAFT) hali sotuv/limit tekshiruvidan o'tmagan.
  // Sklad zaxirasi (STOCK) zayavkasi ham shu tasdiqdan o'tadi.
  if (o.status === "DRAFT") return { error: "Zayavka hali tasdiqlanmagan (qoralama) — avval sotuv bo'limi tasdiqlasin, keyin brigadaga beriladi" };
  if (!["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return { error: "Bu zayavkaga brigada tayinlab bo'lmaydi (bloklangan, bekor yoki yakunlangan)" };

  const chosen = o.items
    .map((item) => {
      const p = picks[item.id];
      const brigadeId = String((typeof p === "string" ? p : p?.brigadeId) ?? "").trim();
      const raw = typeof p === "object" && p ? p.qty : null;
      return { item, brigadeId, qty: raw == null || !Number.isFinite(raw) ? null : Number(raw) };
    })
    .filter((x) => x.brigadeId);
  if (chosen.length === 0) return { error: "Kamida bitta qator uchun brigada tanlang" };
  for (const c of chosen) {
    if (c.qty === null) continue;
    if (!(c.qty > 0)) return { error: `${c.item.product.name}: miqdor 0 dan katta bo'lsin` };
    if (c.item.product.unit !== "m3" && !Number.isInteger(c.qty)) return { error: `${c.item.product.name}: dona mahsulot miqdori butun son bo'lsin` };
  }
  // Brigada mavjud va faol bo'lsin: soxta/eskirgan id bazada FK xatosi (500) berardi, yopilgan brigadaga topshiriq ketardi
  const ids = [...new Set(chosen.map((p) => p.brigadeId))];
  const active = await db.brigade.count({ where: { id: { in: ids }, isActive: true } });
  if (active !== ids.length) return { error: "Tanlangan brigada topilmadi yoki yopilgan — sahifani yangilab, qayta tanlang" };

  const made = await db.$transaction(async (tx) => {
    // Qatorlar qulflanadi: berilgan miqdor qulf ostida qayta o'qiladi
    const itemIds = chosen.map((c) => c.item.id);
    await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE id = ANY(${itemIds}::text[]) FOR UPDATE`;
    const fresh = await tx.brigadeTask.findMany({ where: { orderItemId: { in: itemIds } }, select: { orderItemId: true, status: true, qty: true, doneQty: true } });
    const rows: { taskId: string; taskNo: string; brigadeId: string; qty: number }[] = [];
    for (const { item, brigadeId, qty } of chosen) {
      const st = itemTasks(item.qtyM3, fresh.filter((t) => t.orderItemId === item.id));
      if (st.left <= 0.0005) throw new AssignError(`${item.product.name}: hammasi allaqachon brigadalarga berilgan`);
      const give = qty ?? st.left;
      if (give > st.left + 0.0005) throw new AssignError(`${item.product.name}: brigadaga berilmagan qismi ${+st.left.toFixed(3)} — undan ko'p berib bo'lmaydi`);
      // Qatordagi brigada — oxirgi tayinlangani (eski ko'rinishlar uchun); to'liq ro'yxat topshiriqlarda
      await tx.orderItem.update({ where: { id: item.id }, data: { brigadeId } });
      const t = await tx.brigadeTask.create({
        data: { taskNo: await nextNo(tx, "brigadeTask", "T"), orderId, orderItemId: item.id, brigadeId, qty: give, dueDate: o.deliveryDate, createdById: userId },
      });
      await audit(tx, userId, "CREATE", "BrigadeTask", t.id, undefined, { ...t, itemQty: Number(item.qtyM3), givenBefore: st.given });
      rows.push({ taskId: t.id, taskNo: t.taskNo, brigadeId, qty: give });
    }
    return rows;
  }).catch((e: Error) => {
    if (e instanceof AssignError) return { error: e.message };
    throw e;
  });
  if ("error" in made) return { error: made.error };

  // Brigadir topshiriq berilganini bilishi kerak — u sexda, ekran oldida emas
  notifyAfter(async () => {
    const brigades = await db.brigade.findMany({ where: { id: { in: made.map((r) => r.brigadeId) } }, select: { id: true, name: true, leaderId: true } });
    const byId = new Map(brigades.map((b) => [b.id, b]));
    for (const r of made) {
      const b = byId.get(r.brigadeId);
      if (!b?.leaderId) continue;
      await notifyEmployees([b.leaderId], {
        type: "TASK_ASSIGNED",
        title: `${o.isUrgent ? "Shoshilinch topshiriq" : "Yangi topshiriq"} — ${r.taskNo}`,
        body: `${b.name} · ${r.qty} · muddat ${o.deliveryDate.toLocaleDateString("ru-RU")}`,
        link: { key: "tasks", id: r.taskId },
      });
    }
  });
  return { ok: true, made };
}
