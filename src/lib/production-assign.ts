import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { reassignable } from "@/lib/tasks";
import { notifyAfter, notifyEmployees } from "@/lib/notify";

/**
 * Zayavka qatorlarini brigadalarga taqsimlash — yagona joy (veb «Ishlab chiqarish» → «Tayinlash» ham,
 * mobil ilovadagi zayavka kartochkasi ham shuni chaqiradi).
 *
 * Tanlangan brigada qatorga yoziladi va har qator uchun topshiriq yaratiladi. Brigada tanlanmagan
 * qatorlar keyinga qoladi. Sessiya/ruxsat tekshiruvi (`production` → `assign`) va `revalidatePath` — chaqiruvchida.
 */
class AssignError extends Error {}

/** `picks` — qator id → brigada id (bo'sh qiymat — shu qator hozir tayinlanmaydi). */
export type AssignResult = { error: string } | { ok: true; made: { taskId: string; taskNo: string; brigadeId: string; qty: number }[] };

export async function assignOrderBrigades(orderId: string, picks: Record<string, string>, userId: string): Promise<AssignResult> {
  const o = await db.order.findUnique({ where: { id: orderId }, include: { items: { include: { task: true } } } });
  if (!o) return { error: "Zayavka topilmadi" };
  // Faqat tasdiqlangan zayavka ishga tushadi: qoralama (DRAFT) hali sotuv/limit tekshiruvidan o'tmagan.
  // Sklad zaxirasi (STOCK) zayavkasi ham shu tasdiqdan o'tadi.
  if (o.status === "DRAFT") return { error: "Zayavka hali tasdiqlanmagan (qoralama) — avval sotuv bo'limi tasdiqlasin, keyin brigadaga beriladi" };
  if (!["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return { error: "Bu zayavkaga brigada tayinlab bo'lmaydi (bloklangan, bekor yoki yakunlangan)" };

  const chosen = o.items
    .filter((i) => !i.task || reassignable(i.task))
    .map((i) => ({ item: i, brigadeId: String(picks[i.id] ?? "").trim() }))
    .filter((x) => x.brigadeId);
  if (chosen.length === 0) return { error: "Kamida bitta qator uchun brigada tanlang" };
  // Brigada mavjud va faol bo'lsin: soxta/eskirgan id bazada FK xatosi (500) berardi, yopilgan brigadaga topshiriq ketardi
  const ids = [...new Set(chosen.map((p) => p.brigadeId))];
  const active = await db.brigade.count({ where: { id: { in: ids }, isActive: true } });
  if (active !== ids.length) return { error: "Tanlangan brigada topilmadi yoki yopilgan — sahifani yangilab, qayta tanlang" };

  const made = await db.$transaction(async (tx) => {
    const rows: { taskId: string; taskNo: string; brigadeId: string; qty: number }[] = [];
    for (const { item, brigadeId } of chosen) {
      // Bekor qilingan (bajarilmagan) topshiriq qatorni band qilib turmasin — o'rniga yangisi ochiladi.
      // Bajarilganlik qaydi (TaskProgress) bo'lsa o'chirilmaydi (FK Restrict) — tarix yo'qolmasin
      if (item.task) {
        const progress = await tx.taskProgress.count({ where: { taskId: item.task.id } });
        if (progress) throw new AssignError(`${item.task.taskNo}: bajarilganlik qaydi bor — topshiriqni qayta tayinlab bo'lmaydi`);
        await tx.brigadeTask.delete({ where: { id: item.task.id } });
      }
      await tx.orderItem.update({ where: { id: item.id }, data: { brigadeId } });
      const t = await tx.brigadeTask.create({
        data: { taskNo: await nextNo(tx, "brigadeTask", "T"), orderId, orderItemId: item.id, brigadeId, qty: item.qtyM3, dueDate: o.deliveryDate, createdById: userId },
      });
      await audit(tx, userId, "CREATE", "BrigadeTask", t.id, undefined, t);
      rows.push({ taskId: t.id, taskNo: t.taskNo, brigadeId, qty: Number(item.qtyM3) });
    }
    return rows;
  }).catch((e: Error) => {
    if (e instanceof AssignError) return { error: e.message };
    // Shu qatorga bir vaqtda boshqa joydan topshiriq ochildi (orderItemId yagona) — 500 emas, tushunarli xabar
    if ((e as { code?: string }).code === "P2002") return { error: "Shu qatorga hozirgina boshqa joydan topshiriq berildi — sahifani yangilang" };
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
