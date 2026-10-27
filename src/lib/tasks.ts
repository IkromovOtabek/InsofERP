import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { consumeForTask } from "@/lib/brigade-stock";
import { orderLabel, qty as fq } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { notifyAfter, notifyEmployees, notifyRoles } from "@/lib/notify";
import type { Role } from "@/generated/prisma";
import { defaultWarehouse } from "@/lib/warehouse";
import { itemTasks } from "@/lib/production";
import { nextNo } from "@/lib/numbering";

/**
 * Topshiriq va brigada amallari — yagona rol matritsasi (veb sahifa, server action va mobil
 * `ACTION_ROLES` shu ro'yxatdan oladi, aks holda tugma chiqib, server rad etadigan holat bo'ladi).
 *  - progress: bajarilgan miqdorni qayd qilish — ishlab chiqarish natijasini faqat ishlab chiqarish yozadi
 *    (logistika emas). Brigadir mobil ilovada o'z topshirig'ini qo'shimcha ravishda qayd qiladi.
 *  - cancel: topshiriqni bekor qilish — ishlab chiqarish rejasi, sotuv emas.
 *  - brigadeEdit: brigada ochish/tahrirlash/yopish, brigadir tayinlash.
 * Veb'da direktor har doim ruxsatli (`requireSession`), mobil ilovada esa faqat ro'yxatdagilar.
 */
export const TASK_ROLES = {
  progress: ["PRODUCTION", "SUPERVISOR"],
  cancel: ["PRODUCTION", "SUPERVISOR"],
  brigadeEdit: ["PRODUCTION", "SUPERVISOR", "HR"],
} as const satisfies Record<string, readonly Role[]>;

export type TaskPermission = keyof typeof TASK_ROLES;

/** Veb uchun: rol shu amalni bajara oladimi (direktor — har doim). */
export function canTask(role: Role, what: TaskPermission): boolean {
  return role === "DIRECTOR" || (TASK_ROLES[what] as readonly Role[]).includes(role);
}

/** `requireSession` ga uzatish uchun o'zgaruvchan nusxa. */
export const taskRoles = (what: TaskPermission): Role[] => [...TASK_ROLES[what]];

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
const TASK_STALE = "Topshiriq shu payt boshqa joyda yangilandi — sahifani yangilab, qoldiqni qayta tekshiring";

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
  // Tayyor dona mahsulot asosiy skladga (hovliga) kirim qilinadi. Sklad bo'lmasa — qayd ham yozilmaydi:
  // aks holda topshiriq "bajarildi" bo'lib, mahsulot hech qayerda ko'rinmay qolardi
  const wh = toYard ? await defaultWarehouse() : null;
  if (toYard && !wh) return { changed: false, orderId: t.orderId, error: "Faol sklad yo'q — avval Sozlamalar → Skladlar bo'limida sklad oching, keyin bajarilganini qayd qiling" };

  const res = await db.$transaction(async (tx) => {
    // O'qilgan doneQty hali o'zgarmagan bo'lsagina yoziladi: ikki marta bosilsa (yoki brigadir va
    // ishlab chiqarish bir vaqtda qayd qilsa) ikkinchisi xomashyo va hovli kirimini qayta yozmaydi
    const claimed = await tx.brigadeTask.updateMany({
      where: { id: taskId, doneQty: t.doneQty, status: { notIn: ["DONE", "CANCELLED"] } },
      data: { doneQty: done, status },
    });
    if (claimed.count !== 1) throw new Error(TASK_STALE);
    await tx.taskProgress.create({ data: { taskId, qty, note: note ?? undefined, createdById: userId } });
    // Beton (m³) xomashyosi faqat zamesda yechiladi (skladdan) — bu yerda ham yechilsa bir hajm
    // uchun sement ikki marta hisobdan chiqardi. Dona mahsulot esa brigada qo'lidagidan sarflanadi.
    const used = toYard
      ? await consumeForTask(tx, { id: t.id, brigadeId: t.brigadeId, orderItemId: t.orderItemId }, qty, userId)
      : { rows: 0, deficit: [] as string[], issued: [] as string[] };

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
      const items = await tx.orderItem.findMany({ where: { orderId: t.orderId }, select: { qtyM3: true, tasks: { select: { status: true, qty: true, doneQty: true } } } });
      if (items.length > 0 && items.every((i) => itemTasks(i.qtyM3, i.tasks).done)) {
        await tx.order.update({ where: { id: t.orderId }, data: { status: "CLOSED" } });
        closed = true;
      }
    }
    await audit(tx, userId, "UPDATE", "BrigadeTask", taskId, { doneQty: t.doneQty, status: t.status }, { doneQty: done, status, added: qty, consumed: used.rows, output: toYard ? qty : 0, orderClosed: closed });
    return { used, closed };
  }).catch((e: Error) => { if (e.message === TASK_STALE) return null; throw e; });
  if (!res) return { changed: false, orderId: t.orderId, error: TASK_STALE };

  const hints = [
    toYard && wh ? `${fq(qty)} ${unitLabel(product.unit)} hovliga kirim qilindi (${wh.name}, erkin qoldiq)` : null,
    res.closed ? "Zaxira to'liq tayyor — zayavka yopildi" : null,
    res.used.issued.length ? `Brigadada yetmagani skladdan avtomatik berildi: ${res.used.issued.join(", ")}` : null,
    res.used.deficit.length ? `DIQQAT: skladda ham yetmadi — brigada qoldig'i minusda: ${res.used.deficit.join(", ")}. Sklad va ishlab chiqarishga xabar ketdi` : null,
  ].filter(Boolean);
  // Topshiriq bajarilgani — keyingi qadamni (qabul qilish, yuklash) boshlaydigan xabar
  if (status === "DONE") {
    notifyAfter(() => notifyRoles(["PRODUCTION", "SUPERVISOR"], {
      type: "TASK_DONE",
      title: `Topshiriq bajarildi — ${t.taskNo}`,
      body: `${fq(Number(t.qty))} ${unitLabel(product.unit)} ${product.name}${res.closed ? " · zaxira zayavkasi yopildi" : ""}`,
      link: { key: "tasks", id: taskId },
    }, { except: userId }));
    // Mijoz zayavkasi tayyor — reysni logistika ochadi; xabarsiz tayyor mahsulot reyssiz turib qolardi
    notifyAfter(async () => {
      const o = await db.order.findUnique({ where: { id: t.orderId }, select: { kind: true, deliveryDate: true, status: true, customer: { select: { name: true } } } });
      if (!o || o.kind !== "SALE" || o.status === "CANCELLED" || o.status === "CLOSED") return;
      await notifyRoles(["LOGISTICS"], {
        type: "TASK_DONE",
        title: `Mahsulot tayyor — ${orderLabel(o.customer?.name, o.deliveryDate)}`,
        body: `${fq(Number(t.qty))} ${unitLabel(product.unit)} ${product.name} · reys ochish mumkin`,
        link: { key: "orders", id: t.orderId },
      }, { except: userId });
    });
  }
  return { changed: true, orderId: t.orderId, status, note: hints.length ? hints.join(" · ") : undefined };
}


export async function taskCancel(taskId: string, userId: string): Promise<TaskResult> {
  const t = await db.brigadeTask.findUniqueOrThrow({ where: { id: taskId } });
  if (t.status === "DONE" || t.status === "CANCELLED") return { changed: false, orderId: t.orderId, error: "Topshiriq allaqachon yopilgan" };
  await db.$transaction(async (tx) => {
    const r = await tx.brigadeTask.updateMany({ where: { id: taskId, status: { notIn: ["DONE", "CANCELLED"] } }, data: { status: "CANCELLED" } });
    if (r.count !== 1) return;
    await audit(tx, userId, "STATUS_CHANGE", "BrigadeTask", taskId, { status: t.status }, { status: "CANCELLED" });
  });
  // Brigadir sexda ishni davom ettirmasin
  notifyAfter(async () => {
    const b = await db.brigade.findUnique({ where: { id: t.brigadeId }, select: { leaderId: true } });
    await notifyEmployees([b?.leaderId], { type: "TASK_CANCELLED", title: `Topshiriq bekor qilindi — ${t.taskNo}`, body: "Ishni to'xtating", link: { key: "tasks", id: taskId } });
  });
  return { changed: true, orderId: t.orderId, status: "CANCELLED" };
}

/**
 * Qoldiqni boshqa o'lchamga o'tkazish («Qolganini boshqa o'lchamda bajardim»): masalan ПК 59 × 60 topshirig'ida
 * 58 tasi quyilib, ПК 59 qolmasa — qolgan 2 tasi ПК 60 dan. Bitta tranzaksiyada:
 *  1) topshiriq miqdori o'tkazilgancha kamayadi (bajarilgani yetsa — DONE, hech narsa bajarilmagan bo'lsa — CANCELLED);
 *  2) zayavkadagi asl qator shuncha kamayadi, o'rinbosar mahsulotga yangi qator qo'shiladi — ASL NARXDA
 *     (mijoz 59 so'ragan: zayavka summasi, limit va schyot o'zgarmaydi);
 *  3) yangi qatorga topshiriq ochiladi (tanlangan brigada).
 * `done` — o'rinbosar allaqachon quyilgan: yangi topshiriq darhol qayd qilinadi (`taskProgress` — hovliga kirim,
 * xomashyo o'rinbosar retsepti bo'yicha yechiladi). Faqat dona mahsulot; beton (m³) zames orqali yuritiladi.
 */
export type SubstituteInput = { productId: string; qty: number; brigadeId?: string | null; done: boolean; reason?: string | null };
class SubstituteError extends Error {}

export async function taskSubstitute(taskId: string, input: SubstituteInput, userId: string): Promise<TaskResult & { newTaskNo?: string }> {
  const t = await db.brigadeTask.findUnique({ where: { id: taskId }, include: { orderItem: { include: { product: true } }, order: { select: { status: true } } } });
  if (!t) return { changed: false, orderId: "", error: "Topshiriq topilmadi" };
  if (!["NEW", "IN_PROGRESS"].includes(t.status)) return { changed: false, orderId: t.orderId, error: "Topshiriq yopilgan" };
  if (!["CONFIRMED", "IN_PRODUCTION"].includes(t.order.status)) return { changed: false, orderId: t.orderId, error: "Zayavka ishlab chiqarishda emas — o'lchamni almashtirib bo'lmaydi" };
  const from = t.orderItem.product;
  if (from.unit === "m3") return { changed: false, orderId: t.orderId, error: "Beton topshirig'ida o'lcham almashtirilmaydi" };
  const qty = input.qty;
  if (!Number.isInteger(qty) || qty <= 0) return { changed: false, orderId: t.orderId, error: "Miqdor butun son va 0 dan katta bo'lsin" };
  const to = await db.product.findFirst({ where: { id: input.productId, isActive: true } });
  if (!to) return { changed: false, orderId: t.orderId, error: "O'rinbosar mahsulot topilmadi" };
  if (to.id === from.id) return { changed: false, orderId: t.orderId, error: "O'rinbosar asl mahsulotdan farq qilsin" };
  if (to.unit !== from.unit) return { changed: false, orderId: t.orderId, error: `O'rinbosar ham ${unitLabel(from.unit)} bilan o'lchansin` };
  const brigadeId = input.brigadeId || t.brigadeId;
  if (!(await db.brigade.count({ where: { id: brigadeId, isActive: true } }))) return { changed: false, orderId: t.orderId, error: "Brigada topilmadi yoki yopilgan" };
  const reason = input.reason?.trim().slice(0, 200) || null;

  const res = await db.$transaction(async (tx) => {
    // Topshiriq va qator qulflanadi: qoldiq qulf ostida qayta o'qiladi (bir vaqtda qayd yoki ikkinchi o'tkazish)
    await tx.$queryRaw`SELECT id FROM "BrigadeTask" WHERE id = ${taskId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE id = ${t.orderItemId} FOR UPDATE`;
    const cur = await tx.brigadeTask.findUniqueOrThrow({ where: { id: taskId } });
    if (!["NEW", "IN_PROGRESS"].includes(cur.status)) throw new SubstituteError("Topshiriq shu payt yopildi — sahifani yangilang");
    const rest = Number(cur.qty) - Number(cur.doneQty);
    if (qty > rest + 0.0005) throw new SubstituteError(`Topshiriqda qolgani ${fq(rest)} ${unitLabel(from.unit)} — undan ko'p o'tkazib bo'lmaydi`);
    const item = await tx.orderItem.findUniqueOrThrow({ where: { id: t.orderItemId } });
    const newQty = Number(cur.qty) - qty, done = Number(cur.doneQty);
    const status = done >= newQty - 0.0005 ? (done > 0 ? "DONE" : "CANCELLED") : cur.status;
    await tx.brigadeTask.update({ where: { id: taskId }, data: { qty: newQty, status } });
    await tx.orderItem.update({ where: { id: item.id }, data: { qtyM3: Number(item.qtyM3) - qty } });
    const ni = await tx.orderItem.create({ data: { orderId: t.orderId, productId: to.id, qtyM3: qty, price: item.price, nds: item.nds, brigadeId } });
    const nt = await tx.brigadeTask.create({
      data: { taskNo: await nextNo(tx, "brigadeTask", "T"), orderId: t.orderId, orderItemId: ni.id, brigadeId, qty, dueDate: cur.dueDate, note: `${cur.taskNo} dan o'tkazildi: ${from.name} o'rniga${reason ? ` · ${reason}` : ""}`, createdById: userId },
    });
    const meta = { from: from.code, to: to.code, qty, reason, fromTask: cur.taskNo, toTask: nt.taskNo, price: Number(item.price) };
    await audit(tx, userId, "UPDATE", "BrigadeTask", taskId, { qty: Number(cur.qty), status: cur.status }, { qty: newQty, status, substitute: meta });
    await audit(tx, userId, "UPDATE", "OrderItem", item.id, { qtyM3: Number(item.qtyM3) }, { qtyM3: Number(item.qtyM3) - qty, substitute: meta });
    await audit(tx, userId, "CREATE", "OrderItem", ni.id, undefined, { ...ni, substitute: meta });
    await audit(tx, userId, "CREATE", "BrigadeTask", nt.id, undefined, { ...nt, substitute: meta });
    return { newTaskId: nt.id, newTaskNo: nt.taskNo, status };
  }).catch((e: Error) => { if (e instanceof SubstituteError) return { error: e.message }; throw e; });
  if ("error" in res) return { changed: false, orderId: t.orderId, error: res.error };

  // Allaqachon quyilgan bo'lsa — oddiy qayd: hovliga kirim va xomashyo yechish bir joyda (`taskProgress`)
  let note = `${qty} ${unitLabel(from.unit)} ${to.name} ga o'tkazildi · ${res.newTaskNo}`;
  if (input.done) {
    const p = await taskProgress(res.newTaskId, qty, userId, reason ? `O'rinbosar: ${reason}` : "O'rinbosar o'lcham");
    note = p.error ? `${note} · qayd qilinmadi: ${p.error}` : `${note} · bajarildi${p.note ? ` · ${p.note}` : ""}`;
  }
  // Mijozga boshqa o'lcham ketadi — sotuv bilishi kerak (narx o'zgarmaydi)
  notifyAfter(() => notifyRoles(["SALES", "PRODUCTION", "SUPERVISOR"], {
    type: "TASK_DONE",
    title: `O'lcham almashtirildi — ${t.taskNo}`,
    body: `${qty} ${unitLabel(from.unit)}: ${from.name} o'rniga ${to.name} (narx o'zgarmaydi)${reason ? ` · ${reason}` : ""}`,
    link: { key: "orders", id: t.orderId },
  }, { except: userId }));
  return { changed: true, orderId: t.orderId, status: res.status, note, newTaskNo: res.newTaskNo };
}
