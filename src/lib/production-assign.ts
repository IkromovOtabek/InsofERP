import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { itemTasks } from "@/lib/production";
import { notifyAfter, notifyEmployees } from "@/lib/notify";
import { postToProductionChannel } from "@/lib/telegram/channel";
import { date, qty } from "@/lib/format";
import { unitLabel } from "@/lib/unit";

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
 * `picks` — qator id → brigada id yoki { brigada, miqdor }, yoki ularning ro'yxati: bitta qatorni bir yuborishda bir nechta
 * brigadaga bo'lish («Qator qo'shish»: 10 tadan 8 tasi bir brigadaga, 2 tasi boshqasiga). Miqdor berilmasa — qatorning
 * hali berilmagan hammasi (eski mobil ilova faqat brigada yuboradi). Bo'sh brigada — shu qism hozir tayinlanmaydi.
 */
export type AssignPick = string | { brigadeId: string; qty?: number | null };
export type AssignResult = { error: string } | { ok: true; made: { taskId: string; taskNo: string; brigadeId: string; qty: number; product: string; unit: string }[] };

export async function assignOrderBrigades(orderId: string, picks: Record<string, AssignPick | AssignPick[]>, userId: string): Promise<AssignResult> {
  const o = await db.order.findUnique({ where: { id: orderId }, include: { items: { include: { product: { select: { name: true, unit: true } } } } } });
  if (!o) return { error: "Zayavka topilmadi" };
  // Faqat tasdiqlangan zayavka ishga tushadi: qoralama (DRAFT) hali sotuv/limit tekshiruvidan o'tmagan.
  // Sklad zaxirasi (STOCK) zayavkasi ham shu tasdiqdan o'tadi.
  if (o.status === "DRAFT") return { error: "Zayavka hali tasdiqlanmagan (qoralama) — avval sotuv bo'limi tasdiqlasin, keyin brigadaga beriladi" };
  if (!["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return { error: "Bu zayavkaga brigada tayinlab bo'lmaydi (bloklangan, bekor yoki yakunlangan)" };

  const chosen = o.items
    .flatMap((item) => {
      const v = picks[item.id];
      return (Array.isArray(v) ? v : v == null ? [] : [v]).map((p) => {
        const brigadeId = String((typeof p === "string" ? p : p?.brigadeId) ?? "").trim();
        const raw = typeof p === "object" && p ? p.qty : null;
        return { item, brigadeId, qty: raw == null || !Number.isFinite(raw) ? null : Number(raw) };
      });
    })
    .filter((x) => x.brigadeId);
  if (chosen.length === 0) return { error: "Kamida bitta qator uchun brigada tanlang" };
  // Bir qatorda bir brigada ikki marta — ikkita topshiriq ochilib qolardi; miqdori bitta qismga yoziladi
  const twice = chosen.find((c, k) => chosen.findIndex((x) => x.item.id === c.item.id && x.brigadeId === c.brigadeId) !== k);
  if (twice) return { error: `${twice.item.product.name}: bitta brigada ikki marta tanlangan — miqdorini bitta qatorga yozing` };
  // Beton ishlab chiqarishga tushmaydi — mikserga yuklash paytida quyiladi, reysni logistika ochadi
  const beton = chosen.find((c) => c.item.product.unit === "m3");
  if (beton) return { error: `${beton.item.product.name}: beton brigadaga berilmaydi — u to'g'ridan-to'g'ri logistikaga (reys) o'tadi` };
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
    const rows: { taskId: string; taskNo: string; brigadeId: string; qty: number; product: string; unit: string }[] = [];
    // Shu yuborishda qatorga allaqachon berilgani — bir qator bir nechta brigadaga bo'linganda qolgani shundan hisoblanadi
    const givenNow = new Map<string, number>();
    for (const { item, brigadeId, qty } of chosen) {
      const st = itemTasks(item.qtyM3, fresh.filter((t) => t.orderItemId === item.id));
      const before = givenNow.get(item.id) ?? 0;
      const left = st.left - before;
      const parts = chosen.filter((c) => c.item.id === item.id);
      const asked = parts.reduce((s, c) => s + (c.qty ?? 0), 0);
      if (st.left <= 0.0005) throw new AssignError(`${item.product.name}: hammasi allaqachon brigadalarga berilgan`);
      if (left <= 0.0005) throw new AssignError(`${item.product.name}: brigadalarga bo'lingan miqdor tayinlanmagan qismidan (${+st.left.toFixed(3)}) oshib ketdi`);
      const give = qty ?? left;
      if (give > left + 0.0005) {
        throw new AssignError(parts.length > 1
          ? `${item.product.name}: brigadalarga jami ${+asked.toFixed(3)} berilyapti — tayinlanmagan qismi ${+st.left.toFixed(3)}, undan ko'p berib bo'lmaydi`
          : `${item.product.name}: brigadaga berilmagan qismi ${+st.left.toFixed(3)} — undan ko'p berib bo'lmaydi`);
      }
      givenNow.set(item.id, before + give);
      // Qatordagi brigada — oxirgi tayinlangani (eski ko'rinishlar uchun); to'liq ro'yxat topshiriqlarda
      await tx.orderItem.update({ where: { id: item.id }, data: { brigadeId } });
      const t = await tx.brigadeTask.create({
        data: { taskNo: await nextNo(tx, "brigadeTask", "T"), orderId, orderItemId: item.id, brigadeId, qty: give, dueDate: o.deliveryDate, createdById: userId },
      });
      await audit(tx, userId, "CREATE", "BrigadeTask", t.id, undefined, { ...t, itemQty: Number(item.qtyM3), givenBefore: st.given + before });
      rows.push({ taskId: t.id, taskNo: t.taskNo, brigadeId, qty: give, product: item.product.name, unit: unitLabel(item.product.unit) });
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
        title: `${o.isUrgent ? "Shoshilinch topshiriq" : "Yangi topshiriq"} — ${b.name}`,
        body: `${r.product} · ${qty(r.qty)} ${r.unit} · muddat ${date(o.deliveryDate)}`,
        link: { key: "tasks", id: r.taskId },
      });
    }
  });
  // Ishlab chiqarish Telegram kanali (Sozlamalar → Zavod rekvizitlari): sex rahbarlari bitta joyda ko'radi.
  // Kanal ulanmagan bo'lsa jim o'tadi; Telegram xatosi tayinlashni buzmaydi (`notifyAfter` jurnalga yozadi).
  notifyAfter(async () => {
    const [tasks, by] = await Promise.all([
      db.brigadeTask.findMany({
        where: { id: { in: made.map((r) => r.taskId) } }, orderBy: { taskNo: "asc" },
        select: { qty: true, brigade: { select: { name: true } }, orderItem: { select: { product: { select: { name: true, unit: true } } } } },
      }),
      db.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
    ]);
    const customer = o.kind === "STOCK" ? "Sklad zaxirasi" : (await db.customer.findUnique({ where: { id: o.customerId }, select: { name: true } }))?.name ?? "—";
    await postToProductionChannel([
      `${o.isUrgent ? "SHOSHILINCH — " : ""}Brigadaga topshiriq berildi`,
      "",
      `Mijoz: ${customer}`,
      ...(o.kind === "STOCK" ? [] : [`Obyekt: ${o.deliveryAddress}`]),
      `Muddat: ${date(o.deliveryDate)}${o.deliveryTime ? ` · ${o.deliveryTime}` : ""}`,
      "",
      ...tasks.map((t) => `${t.brigade.name}: ${t.orderItem.product.name} — ${qty(t.qty)} ${unitLabel(t.orderItem.product.unit)}`),
      "",
      `Tayinladi: ${by?.fullName ?? "—"}`,
    ].join("\n"));
  });
  return { ok: true, made };
}
