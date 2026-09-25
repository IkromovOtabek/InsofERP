import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { consumeForTask } from "@/lib/brigade-stock";
import { qty as fq } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { notifyAfter, notifyRoles } from "@/lib/notify";

/**
 * Brigada topshiriqlari — yagona joy (veb "Topshiriqlar" sahifasi ham, mobil ilova ham).
 * Sessiya/ruxsat tekshiruvi va `revalidatePath` — chaqiruvchida.
 */
export type TaskResult = { changed: boolean; orderId: string; status?: string; error?: string; /** Xomashyo bilan bog'liq ogohlantirish (brigadada yetmadi). */ note?: string };

/**
 * Brigada bajargan miqdorni qayd qilish. doneQty oshadi; to'liq bo'lsa DONE.
 *
 * Bir qaydda uch ish bajariladi:
 *  1) brigada qo'lidagi xomashyo retsept normasi bo'yicha kamayadi;
 *  2) tayyor DONA mahsulot hovliga kirim bo'ladi (PRODUCTION_OUTPUT) — brigada chiqargani
 *     shu zahoti sklad qoldig'ida ko'rinadi. Beton (m³) bunga kirmaydi: u zames orqali
 *     kirim qilinadi, aks holda bir hajm ikki marta hisoblanib ketadi;
 *  3) zayavka holati suriladi: birinchi qayddan keyin "Ishlab chiqarilmoqda", sklad
 *     zaxirasi zayavkasining hamma topshirig'i bajarilsa — "Zaxira tayyor" (CLOSED).
 */
export async function taskProgress(taskId: string, qty: number, userId: string, note?: string | null): Promise<TaskResult> {
  const t = await db.brigadeTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { orderItem: { include: { product: { select: { id: true, name: true, unit: true } } } }, order: { select: { kind: true, status: true } } },
  });
  if (["DONE", "CANCELLED"].includes(t.status)) return { changed: false, orderId: t.orderId, error: "Topshiriq yopilgan" };
  const remaining = Number(t.qty) - Number(t.doneQty);
  if (qty > remaining + 0.0005) return { changed: false, orderId: t.orderId, error: `Qoldiqdan ko'p: qoldiq ${remaining}` };

  const done = Number(t.doneQty) + qty;
  const status = done >= Number(t.qty) - 0.0005 ? "DONE" : "IN_PROGRESS";
  const product = t.orderItem.product;
  const toYard = product.unit !== "m3"; // dona mahsulot hovliga qo'yiladi
  const wh = toYard ? await db.warehouse.findFirst({ where: { isActive: true }, select: { id: true } }) : null;

  const res = await db.$transaction(async (tx) => {
    await tx.taskProgress.create({ data: { taskId, qty, note: note ?? undefined, createdById: userId } });
    await tx.brigadeTask.update({ where: { id: taskId }, data: { doneQty: done, status } });
    const used = await consumeForTask(tx, { id: t.id, brigadeId: t.brigadeId, orderItemId: t.orderItemId }, qty, userId);

    // ── Tayyor mahsulot hovliga ──
    if (toYard && wh) {
      await tx.stockMove.create({
        data: {
          type: "PRODUCTION_OUTPUT", warehouseId: wh.id, productId: product.id, brigadeId: t.brigadeId, qty,
          refType: "BrigadeTask", refId: taskId, note: `Brigada chiqardi · ${t.taskNo}`, createdById: userId,
        },
      });
    }

    // ── Zayavka holati ──
    // Ish boshlandi: qabul qilingan zayavka "Ishlab chiqarilmoqda" ga o'tadi (zames qilgani kabi)
    if (t.order.status === "CONFIRMED") await tx.order.update({ where: { id: t.orderId }, data: { status: "IN_PRODUCTION" } });
    // Sklad zaxirasi: hamma qatorga topshiriq berilgan va hammasi bajarilgan bo'lsa — zayavka yopiladi
    let closed = false;
    if (t.order.kind === "STOCK" && status === "DONE") {
      const items = await tx.orderItem.findMany({ where: { orderId: t.orderId }, select: { task: { select: { status: true } } } });
      if (items.length > 0 && items.every((i) => i.task?.status === "DONE")) {
        await tx.order.update({ where: { id: t.orderId }, data: { status: "CLOSED" } });
        closed = true;
      }
    }
    await audit(tx, userId, "UPDATE", "BrigadeTask", taskId, { doneQty: t.doneQty, status: t.status }, { doneQty: done, status, added: qty, consumed: used.rows, output: toYard ? qty : 0, orderClosed: closed });
    return { used, closed };
  });

  const hints = [
    toYard && wh ? `${fq(qty)} ${unitLabel(product.unit)} hovliga kirim qilindi (erkin qoldiq)` : null,
    toYard && !wh ? "Sklad ochilmagan — tayyor mahsulot kirim qilinmadi" : null,
    res.closed ? "Zaxira to'liq tayyor — zayavka yopildi" : null,
    res.used.deficit.length ? `Brigadada xomashyo yetmadi (qarzga yozildi): ${res.used.deficit.join(", ")} — skladdan bering` : null,
  ].filter(Boolean);
  // Topshiriq bajarilgani — keyingi qadamni (qabul qilish, yuklash) boshlaydigan xabar
  if (status === "DONE") {
    notifyAfter(() => notifyRoles(["PRODUCTION", "SUPERVISOR"], {
      type: "TASK_DONE",
      title: `Topshiriq bajarildi — ${t.taskNo}`,
      body: `${fq(Number(t.qty))} ${unitLabel(product.unit)} ${product.name}${res.closed ? " · zaxira zayavkasi yopildi" : ""}`,
      link: { key: "tasks", id: taskId },
    }, { except: userId }));
  }
  return { changed: true, orderId: t.orderId, status, note: hints.length ? hints.join(" · ") : undefined };
}

export async function taskCancel(taskId: string, userId: string): Promise<TaskResult> {
  const t = await db.brigadeTask.findUniqueOrThrow({ where: { id: taskId } });
  if (t.status === "DONE" || t.status === "CANCELLED") return { changed: false, orderId: t.orderId, error: "Topshiriq allaqachon yopilgan" };
  await db.$transaction(async (tx) => {
    await tx.brigadeTask.update({ where: { id: taskId }, data: { status: "CANCELLED" } });
    await audit(tx, userId, "STATUS_CHANGE", "BrigadeTask", taskId, { status: t.status }, { status: "CANCELLED" });
  });
  return { changed: true, orderId: t.orderId, status: "CANCELLED" };
}
