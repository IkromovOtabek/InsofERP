import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { consumeForTask } from "@/lib/brigade-stock";
import { orderLabel, qty as fq } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { notifyAfter, notifyEmployees, notifyRoles } from "@/lib/notify";
import type { Role, TaskStatus } from "@/generated/prisma";
import { defaultWarehouse } from "@/lib/warehouse";
import { itemTasks } from "@/lib/production";
import { nextNo } from "@/lib/numbering";
import { lockStock, STOCK_EPS } from "@/lib/stock-lock";
import { ownerBalances } from "@/lib/brigade-products";

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
    include: { orderItem: { include: { product: { select: { id: true, name: true, unit: true } } } }, order: { select: { kind: true, status: true } }, brigade: { select: { name: true } } },
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
          // Brigada chiqargani o'z omborida turadi (javobgarligida) — reys yuklanganda shu ombordan yechiladi
          type: "PRODUCTION_OUTPUT", warehouseId: wh.id, productId: product.id, brigadeId: t.brigadeId, ownerBrigadeId: t.brigadeId, qty,
          refType: "BrigadeTask", refId: taskId, note: `Brigada chiqardi · ${t.brigade.name}`, createdById: userId,
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
    toYard && wh ? `${fq(qty)} ${unitLabel(product.unit)} ${t.brigade.name} omboriga kirim qilindi (${wh.name})` : null,
    res.closed ? "Zaxira to'liq tayyor — zayavka yopildi" : null,
    res.used.issued.length ? `Brigadada yetmagani skladdan avtomatik berildi: ${res.used.issued.join(", ")}` : null,
    res.used.deficit.length ? `DIQQAT: skladda ham yetmadi — brigada qoldig'i minusda: ${res.used.deficit.join(", ")}. Sklad va ishlab chiqarishga xabar ketdi` : null,
  ].filter(Boolean);
  // Topshiriq bajarilgani — keyingi qadamni (qabul qilish, yuklash) boshlaydigan xabar
  if (status === "DONE") {
    notifyAfter(() => notifyRoles(["PRODUCTION", "SUPERVISOR"], {
      type: "TASK_DONE",
      title: `Topshiriq bajarildi — ${t.brigade.name}`,
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
  const ok = await db.$transaction(async (tx) => {
    const r = await tx.brigadeTask.updateMany({ where: { id: taskId, status: { notIn: ["DONE", "CANCELLED"] } }, data: { status: "CANCELLED" } });
    if (r.count !== 1) return false;
    await audit(tx, userId, "STATUS_CHANGE", "BrigadeTask", taskId, { status: t.status }, { status: "CANCELLED" });
    return true;
  });
  // Shu payt boshqa joyda yopilgan bo'lsa — «bekor qilindi» deb aldamaymiz va brigadirga ortiqcha xabar ketmaydi
  if (!ok) return { changed: false, orderId: t.orderId, error: "Topshiriq shu payt boshqa joyda yopildi — sahifani yangilang" };
  // Brigadir sexda ishni davom ettirmasin
  notifyAfter(async () => {
    const b = await db.brigade.findUnique({ where: { id: t.brigadeId }, select: { name: true, leaderId: true } });
    await notifyEmployees([b?.leaderId], { type: "TASK_CANCELLED", title: `Topshiriq bekor qilindi — ${b?.name ?? "brigada"}`, body: "Ishni to'xtating", link: { key: "tasks", id: taskId } });
  });
  return { changed: true, orderId: t.orderId, status: "CANCELLED" };
}

/**
 * Bajarilgan hajm qaydini bekor qilish («60 o'rniga 600 yozildi»). Faqat topshiriqda YAGONA qayd bo'lsa:
 * `taskProgress` yozgan harakatlar qaydga emas, topshiriqqa bog'langan (`refType "BrigadeTask"`, `refId` = topshiriq) —
 * qayd bir nechta bo'lsa qaysi harakat qaysi qaydniki ekanini aniq ajratib bo'lmaydi, shuning uchun rad etiladi.
 *
 * Bitta tranzaksiyada (avval topshiriq qatori, keyin sklad qulfi — `taskProgress` bilan bir tartib):
 *  1) topshiriq belgisidagi harakatlar kalit bo'yicha jamlanadi va qoldig'iga teskari harakat yoziladi — o'sha tur,
 *     o'sha sklad/ombor/tannarx, ishorasi teskari (`storno.ts` qoidasi), belgisi ham o'sha. Jamlash sababi: avval
 *     bekor qilingan qaydning harakati va teskarisi ham shu belgida qoladi — ularning yig'indisi 0:
 *      · tayyor mahsulot (PRODUCTION_OUTPUT) o'sha brigada omboridan chiqariladi — hovlida yetmasa rad;
 *      · retsept sarfi (BrigadeMove CONSUME) brigadaga qaytadi;
 *      · yetmagani uchun skladdan avtomatik berilgani (BRIGADE_ISSUE + BrigadeMove ISSUE) skladga qaytadi;
 *  2) doneQty kamayadi; bajarilgani qolmasa holat NEW (bekor qilingan topshiriq CANCELLED qoladi);
 *  3) zaxira zayavkasi shu qayd bilan yopilgan bo'lsa qayta ochiladi; zayavkada boshqa ish qolmasa — "Tasdiqlangan"
 *     (`cancelBatch` qoidasi);
 *  4) qayd o'chiriladi — sdelka fondi (`brigade-pay.ts`) `TaskProgress` yig'indisidan; oldingi holati va sabab auditda.
 * Topshiriqqa brak yozilgan bo'lsa rad etiladi — avval brak o'chiriladi (`deleteProductDefect`, hovli qoldig'i qaytadi).
 */
class ProgressCancelError extends Error {}
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const key = (...p: (string | null | undefined)[]) => p.map((x) => x ?? "").join("|");
const addTo = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

export async function taskProgressCancel(progressId: string, reason: string, userId: string): Promise<TaskResult> {
  const why = reason.trim().slice(0, 300);
  const first = await db.taskProgress.findUnique({ where: { id: progressId }, select: { taskId: true, task: { select: { orderId: true } } } });
  if (!first) return { changed: false, orderId: "", error: "Qayd topilmadi — sahifani yangilang" };
  if (why.length < 3) return { changed: false, orderId: first.task.orderId, error: "Bekor qilish sababini yozing" };
  const taskId = first.taskId;

  const res = await db.$transaction(async (tx) => {
    // Qatorni qulflash: shu payt yangi qayd (`taskProgress`) yoki brak kelsa — navbat bilan
    await tx.$queryRaw`SELECT id FROM "BrigadeTask" WHERE id = ${taskId} FOR UPDATE`;
    await lockStock(tx);
    const t = await tx.brigadeTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { orderItem: { include: { product: { select: { name: true, unit: true } } } }, order: { select: { kind: true, status: true } }, brigade: { select: { name: true, leaderId: true } } },
    });
    const unit = unitLabel(t.orderItem.product.unit);
    const p = await tx.taskProgress.findUnique({ where: { id: progressId } });
    if (!p) throw new ProgressCancelError("Qayd shu payt bekor qilindi — sahifani yangilang");
    // Sdelka fondi qayd sanasining oyidan hisoblanadi (`brigadeOutput`): shu oy vedomosti tasdiqlangan / to'langan bo'lsa,
    // bekor qilish yopilgan oylikni orqaga qarab o'zgartirib yuborardi
    const ym = `${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, "0")}`;
    const run = await tx.payrollRun.findFirst({ where: { month: ym, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] }, cancelledAt: null }, select: { docNo: true } });
    if (run) throw new ProgressCancelError(`${ym} oyining ish haqi vedomosti (${run.docNo}) tasdiqqa yuborilgan yoki tasdiqlangan — sdelka fondi o'zgarib qoladi. Qaydni bekor qilish uchun avval vedomost qoralamaga qaytarilsin`);
    const count = await tx.taskProgress.count({ where: { taskId } });
    if (count !== 1) throw new ProgressCancelError(`Topshiriqda ${count} ta qayd bor — sklad harakatlari topshiriqqa umumiy yozilgan, bittasini aniq ajratib bekor qilib bo'lmaydi`);
    const def = await tx.productDefect.aggregate({ where: { taskId }, _sum: { qty: true }, _count: { _all: true } });
    if (def._count._all > 0) throw new ProgressCancelError(`Bu topshiriqqa brak yozilgan (${def._count._all} ta, ${fq(Number(def._sum.qty ?? 0))} ${unit}) — avval brakni o'chiring, keyin qaydni bekor qiling`);
    const pq = Number(p.qty);
    const left = Number(t.doneQty) - pq;
    if (left < -STOCK_EPS) throw new ProgressCancelError("Topshiriqdagi bajarilgan miqdor qayddan kam — ma'lumot mos emas, bekor qilinmadi");

    const [moves, consumes] = await Promise.all([
      tx.stockMove.findMany({ where: { refType: "BrigadeTask", refId: taskId }, include: { product: { select: { name: true } } } }),
      tx.brigadeMove.findMany({ where: { refType: "BrigadeTask", refId: taskId } }),
    ]);
    // Bu belgini faqat `taskProgress` (tayyor mahsulot) va `consumeForTask` (sarf, avtomatik berish) yozadi — boshqasi chiqsa to'xtaymiz
    const odd = moves.some((m) => m.type === "PRODUCTION_OUTPUT" ? !m.productId : m.type === "BRIGADE_ISSUE" ? !m.materialId || !m.brigadeId : true)
      || consumes.some((m) => m.type !== "CONSUME");
    if (odd) throw new ProgressCancelError("Topshiriqda kutilmagan sklad harakati bor — qaydni avtomatik bekor qilib bo'lmaydi");
    const issueIds = moves.filter((m) => m.type === "BRIGADE_ISSUE").map((m) => m.id);
    const issueLinks = issueIds.length ? await tx.brigadeMove.findMany({ where: { refType: "StockMove", refId: { in: issueIds } } }) : [];

    // ── Jamlash: kalit bo'yicha qoldiq (avval bekor qilingan qaydlar va teskarisi 0 beradi) ──
    type Net = { qty: number; m: (typeof moves)[number] };
    const outNet = new Map<string, Net>(), issueNet = new Map<string, Net>();
    for (const m of moves) {
      const isOut = m.type === "PRODUCTION_OUTPUT";
      const kk = isOut ? key(m.warehouseId, m.productId, m.ownerBrigadeId, m.brigadeId) : key(m.warehouseId, m.materialId, m.brigadeId, m.unitCost?.toString());
      const map = isOut ? outNet : issueNet;
      const cur = map.get(kk) ?? { qty: 0, m };
      cur.qty = r3(cur.qty + Number(m.qty));
      map.set(kk, cur);
    }
    const consumeNet = new Map<string, { qty: number; brigadeId: string; materialId: string }>();
    for (const m of consumes) {
      const kk = key(m.brigadeId, m.materialId);
      const cur = consumeNet.get(kk) ?? { qty: 0, brigadeId: m.brigadeId, materialId: m.materialId };
      cur.qty = r3(cur.qty + Number(m.qty));
      consumeNet.set(kk, cur);
    }
    // Ishorasi kutilganidek bo'lmasa (kirim manfiy, sarf musbat) yoki avtomatik berishning sklad va brigada tomoni
    // bir-biriga teng bo'lmasa — harakatlar shu qaydga mos emas, taxmin qilmaymiz
    const issueSide = new Map<string, number>(), linkSide = new Map<string, number>();
    for (const n of issueNet.values()) addTo(issueSide, key(n.m.brigadeId, n.m.materialId), -n.qty);
    for (const l of issueLinks) addTo(linkSide, key(l.brigadeId, l.materialId), Number(l.qty));
    const outTotal = r3([...outNet.values()].reduce((s, n) => s + n.qty, 0));
    const mismatch = [...outNet.values()].some((n) => n.qty < -STOCK_EPS)
      || [...issueNet.values()].some((n) => n.qty > STOCK_EPS)
      || [...consumeNet.values()].some((n) => n.qty > STOCK_EPS)
      || [...new Set([...issueSide.keys(), ...linkSide.keys()])].some((kk) => Math.abs((issueSide.get(kk) ?? 0) - (linkSide.get(kk) ?? 0)) > STOCK_EPS)
      || (Math.abs(outTotal) > STOCK_EPS && Math.abs(outTotal - pq) > STOCK_EPS);
    if (mismatch) throw new ProgressCancelError(`Sklad harakatlari qaydga mos kelmadi (hovliga kirim ${fq(outTotal)}, qayd ${fq(pq)} ${unit}) — avtomatik bekor qilinmadi, sklad bilan qo'lda tekshiring`);

    // ── Hovli qoldig'i: tayyor mahsulot hali o'sha omborda bo'lishi shart ──
    const needOwner = new Map<string, number>(), needTotal = new Map<string, number>();
    for (const n of outNet.values()) {
      if (n.qty <= STOCK_EPS) continue;
      addTo(needOwner, key(n.m.warehouseId, n.m.productId, n.m.ownerBrigadeId), n.qty);
      addTo(needTotal, key(n.m.warehouseId, n.m.productId), n.qty);
    }
    const short: string[] = [];
    const checked = new Set<string>();
    for (const n of outNet.values()) {
      const tk = key(n.m.warehouseId, n.m.productId), ownKey = key(n.m.warehouseId, n.m.productId, n.m.ownerBrigadeId);
      if (n.qty <= STOCK_EPS || checked.has(ownKey)) continue;
      checked.add(ownKey);
      const bal = await ownerBalances(tx, n.m.warehouseId, n.m.productId!);
      const total = [...bal.values()].reduce((s, v) => s + v, 0);
      const own = bal.get(n.m.ownerBrigadeId) ?? 0;
      const name = n.m.product?.name ?? t.orderItem.product.name;
      const owner = n.m.ownerBrigadeId === t.brigadeId ? `${t.brigade.name} omborida` : n.m.ownerBrigadeId ? "brigada omborida" : "umumiy hovlida";
      if (total < needTotal.get(tk)! - STOCK_EPS) short.push(`${name}: hovlida ${fq(Math.max(0, total))} ${unit}, chiqarish kerak ${fq(needTotal.get(tk)!)} — jo'natilgan yoki hisobdan chiqarilgan`);
      else if (own < needOwner.get(ownKey)! - STOCK_EPS) short.push(`${name}: ${owner} ${fq(Math.max(0, own))} ${unit}, chiqarish kerak ${fq(needOwner.get(ownKey)!)} — qolgani boshqa omborga ko'chirilgan, avval qaytarib ko'chiring`);
    }
    if (short.length) throw new ProgressCancelError(`Bekor qilib bo'lmaydi — tayyor mahsulot qoldig'i minusga tushadi: ${short.join("; ")}`);

    // ── Teskari harakatlar (o'sha belgi bilan — keyingi jamlashda 0 bo'lib qoladi) ──
    const note = `Qayd bekor qilindi: ${why}`;
    let reversed = 0, consumed = 0, issued = 0;
    for (const n of outNet.values()) {
      if (n.qty <= STOCK_EPS) continue;
      await tx.stockMove.create({
        data: { type: "PRODUCTION_OUTPUT", warehouseId: n.m.warehouseId, productId: n.m.productId, brigadeId: n.m.brigadeId, ownerBrigadeId: n.m.ownerBrigadeId, qty: -n.qty, refType: "BrigadeTask", refId: taskId, note, createdById: userId },
      });
      reversed++;
    }
    for (const n of issueNet.values()) {
      if (n.qty >= -STOCK_EPS) continue;
      const back = await tx.stockMove.create({
        data: { type: "BRIGADE_ISSUE", warehouseId: n.m.warehouseId, materialId: n.m.materialId, brigadeId: n.m.brigadeId, qty: -n.qty, unitCost: n.m.unitCost, refType: "BrigadeTask", refId: taskId, note, createdById: userId },
      });
      await tx.brigadeMove.create({
        data: { type: "ISSUE", brigadeId: n.m.brigadeId!, materialId: n.m.materialId!, qty: n.qty, unitCost: n.m.unitCost, refType: "StockMove", refId: back.id, note, createdById: userId },
      });
      reversed += 2; issued++;
    }
    for (const n of consumeNet.values()) {
      if (n.qty >= -STOCK_EPS) continue;
      await tx.brigadeMove.create({ data: { type: "CONSUME", brigadeId: n.brigadeId, materialId: n.materialId, qty: -n.qty, refType: "BrigadeTask", refId: taskId, note, createdById: userId } });
      reversed++; consumed++;
    }

    // ── Topshiriq ──
    const done = left > STOCK_EPS ? r3(left) : 0;
    const status: TaskStatus = t.status === "CANCELLED" ? "CANCELLED" : done <= 0 ? "NEW" : done >= Number(t.qty) - 0.0005 ? "DONE" : "IN_PROGRESS";
    const u = await tx.brigadeTask.updateMany({ where: { id: taskId, doneQty: t.doneQty, status: t.status }, data: { doneQty: done, status } });
    if (u.count !== 1) throw new ProgressCancelError(TASK_STALE);

    // ── Zayavka holati ──
    // Zaxira zayavkasi shu topshiriq bajarilgani bilan yopilgan bo'lsa (`taskProgress`) — qayta ochiladi
    let reopened = false, unconfirmed = false;
    if (t.order.kind === "STOCK" && t.order.status === "CLOSED" && status !== "DONE") {
      const o = await tx.order.updateMany({ where: { id: t.orderId, status: "CLOSED" }, data: { status: "IN_PRODUCTION" } });
      if (o.count) { reopened = true; await audit(tx, userId, "STATUS_CHANGE", "Order", t.orderId, { status: "CLOSED" }, { status: "IN_PRODUCTION", by: "progress-cancel", progressId }); }
    }
    // Zayavkada boshqa ish (zames, reys, qayd) qolmasa — "Tasdiqlangan" ga qaytadi (zames storno qoidasi)
    if (t.order.status === "IN_PRODUCTION" || reopened) {
      const [batches, trips, progress] = await Promise.all([
        tx.productionBatch.count({ where: { orderId: t.orderId, cancelledAt: null } }),
        tx.trip.count({ where: { orderId: t.orderId, status: { not: "CANCELLED" } } }),
        tx.brigadeTask.count({ where: { orderId: t.orderId, doneQty: { gt: 0 } } }),
      ]);
      if (!batches && !trips && !progress) {
        const o = await tx.order.updateMany({ where: { id: t.orderId, status: "IN_PRODUCTION" }, data: { status: "CONFIRMED" } });
        if (o.count) { unconfirmed = true; await audit(tx, userId, "STATUS_CHANGE", "Order", t.orderId, { status: "IN_PRODUCTION" }, { status: "CONFIRMED", by: "progress-cancel", progressId }); }
      }
    }

    // ── Qayd o'chiriladi (teskari harakatlardan keyin) — to'liq nusxasi va sababi auditda ──
    await tx.taskProgress.delete({ where: { id: progressId } });
    await audit(tx, userId, "DELETE", "TaskProgress", progressId, p, { cancelled: true, reason: why, taskNo: t.taskNo, reversedMoves: reversed });
    await audit(tx, userId, "UPDATE", "BrigadeTask", taskId, { doneQty: t.doneQty, status: t.status }, {
      doneQty: done, status, progressCancelled: progressId, removed: pq, reason: why, output: -outTotal, reversedMoves: reversed, orderReopened: reopened, orderConfirmed: unconfirmed,
    });
    return { status, pq, unit, outTotal, consumed, issued, reopened, unconfirmed, product: t.orderItem.product.name, brigade: t.brigade.name, leaderId: t.brigade.leaderId };
  }).catch((e: Error) => { if (e instanceof ProgressCancelError) return { error: e.message }; throw e; });
  if ("error" in res) return { changed: false, orderId: first.task.orderId, error: res.error };

  const hints = [
    `${fq(res.pq)} ${res.unit} qayd bekor qilindi`,
    res.outTotal > STOCK_EPS ? `hovlidan ${fq(res.outTotal)} ${res.unit} chiqarildi` : null,
    res.consumed ? "sarflangan xomashyo brigadaga qaytdi" : null,
    res.issued ? "avtomatik berilgan xomashyo skladga qaytdi" : null,
    res.reopened ? "zaxira zayavkasi qayta ochildi" : null,
    res.unconfirmed ? "zayavka «Tasdiqlangan» ga qaytdi" : null,
  ].filter(Boolean);
  // Brigadir ilovadagi bajarilgan miqdor kamayganini bilsin
  notifyAfter(() => notifyEmployees([res.leaderId], {
    type: "TASK_CANCELLED",
    title: `Bajarilgan qayd bekor qilindi — ${res.brigade}`,
    body: `${fq(res.pq)} ${res.unit} ${res.product} · ${why}`,
    link: { key: "tasks", id: taskId },
  }));
  return { changed: true, orderId: first.task.orderId, status: res.status, note: hints.join(" · ") };
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
  const t = await db.brigadeTask.findUnique({ where: { id: taskId }, include: { orderItem: { include: { product: true } }, order: { select: { status: true } }, brigade: { select: { name: true } } } });
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
      data: { taskNo: await nextNo(tx, "brigadeTask", "T"), orderId: t.orderId, orderItemId: ni.id, brigadeId, qty, dueDate: cur.dueDate, note: `${t.brigade.name} topshirig'idan o'tkazildi: ${from.name} o'rniga${reason ? ` · ${reason}` : ""}`, createdById: userId },
      include: { brigade: { select: { name: true } } },
    });
    const meta = { from: from.code, to: to.code, qty, reason, fromTask: cur.taskNo, toTask: nt.taskNo, price: Number(item.price) };
    await audit(tx, userId, "UPDATE", "BrigadeTask", taskId, { qty: Number(cur.qty), status: cur.status }, { qty: newQty, status, substitute: meta });
    await audit(tx, userId, "UPDATE", "OrderItem", item.id, { qtyM3: Number(item.qtyM3) }, { qtyM3: Number(item.qtyM3) - qty, substitute: meta });
    await audit(tx, userId, "CREATE", "OrderItem", ni.id, undefined, { ...ni, substitute: meta });
    await audit(tx, userId, "CREATE", "BrigadeTask", nt.id, undefined, { ...nt, substitute: meta });
    return { newTaskId: nt.id, newTaskNo: nt.taskNo, newBrigade: nt.brigade.name, status };
  }).catch((e: Error) => { if (e instanceof SubstituteError) return { error: e.message }; throw e; });
  if ("error" in res) return { changed: false, orderId: t.orderId, error: res.error };

  // Allaqachon quyilgan bo'lsa — oddiy qayd: hovliga kirim va xomashyo yechish bir joyda (`taskProgress`)
  let note = `${qty} ${unitLabel(from.unit)} ${to.name} ga o'tkazildi · ${res.newBrigade}`;
  if (input.done) {
    const p = await taskProgress(res.newTaskId, qty, userId, reason ? `O'rinbosar: ${reason}` : "O'rinbosar o'lcham");
    note = p.error ? `${note} · qayd qilinmadi: ${p.error}` : `${note} · bajarildi${p.note ? ` · ${p.note}` : ""}`;
  }
  // Mijozga boshqa o'lcham ketadi — sotuv bilishi kerak (narx o'zgarmaydi)
  notifyAfter(() => notifyRoles(["SALES", "PRODUCTION", "SUPERVISOR"], {
    type: "TASK_DONE",
    title: `O'lcham almashtirildi — ${t.brigade.name}`,
    body: `${qty} ${unitLabel(from.unit)}: ${from.name} o'rniga ${to.name} (narx o'zgarmaydi)${reason ? ` · ${reason}` : ""}`,
    link: { key: "orders", id: t.orderId },
  }, { except: userId }));
  return { changed: true, orderId: t.orderId, status: res.status, note, newTaskNo: res.newTaskNo };
}
