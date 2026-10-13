import { Prisma, type Role } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { lockStock, STOCK_EPS } from "./stock-lock";
import { issuePrices } from "./stock-price";
import { writeBrigadeIssue } from "./brigade-stock";
import { MAX_AMOUNT } from "./action";
import { fmtNum, isoDate } from "./format";
import { unitLabelRu } from "./unit";
import { companyVatPayer } from "./receipt-vat";

/**
 * Sklad → «Расход»: skladdan xomashyo berish (oluvchiga yoki brigadaga) va Расход jurnali.
 *
 * Berish — BITTA tranzaksiya, `lockStock` ostida, qoldiq AYNAN tanlangan sklad bo'yicha tekshiriladi:
 *  · oluvchi (StockRecipient — shafyorlar, svarchiklar…) → StockMove ISSUE (−), sarf deb hisoblanadi;
 *  · brigada → mavjud brigada qoldig'i mantig'i: StockMove BRIGADE_ISSUE (−) + BrigadeMove ISSUE (+).
 * Narx — «Дона сўм» snapshot (`issuePrices`): Snabjeniye narxni keyin o'zgartirsa ham o'tgan qatorlar o'zgarmaydi.
 * Bitta berish hujjati — `refType "Issue"`, `refId = ref`. Veb (Sklad → Расход) va mobil/ECO shu funksiyadan o'tadi;
 * ruxsat (`stock` → `issue`) chaqiruvchida. Xato matnlari ruscha (ekran tili) — `IssueError`.
 * Bekor qilish — `cancelIssue` (storno): teskari harakatlar `refType "IssueStorno"`, `refId = ref`.
 */

/** Foydalanuvchiga ko'rinadigan xato (ruscha). Kutilmagan (baza) xatolari oddiy `Error` bo'lib qoladi. */
export class IssueError extends Error {}

export type IssueTarget = { kind: "recipient" | "brigade"; id: string };

export type IssueInput = {
  warehouseId: string;
  /** YYYY-MM-DD: bugundan 31 kungacha orqaga, kelajak emas. Bo'sh — hozir */
  date?: string | null;
  to: IssueTarget;
  items: { materialId: string; qty: number }[];
  note?: string | null;
  /** Formadagi bir martalik kalit: takror yuborilsa yangi harakat yozilmaydi, mavjud `ref` qaytadi */
  clientToken?: string | null;
};

export type IssueStockResult = { ref: string; count: number; existed: boolean };

/** Orqaga necha kungacha yozish mumkin (Расход sanasi). */
export const ISSUE_BACK_DAYS = 31;
const MAX_ROWS = 200;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Bir martalik kalit: bo'sh yoki g'alati bo'lsa — e'tiborga olinmaydi (kirim formasidagi qoida). */
export const issueToken = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return /^[A-Za-z0-9-]{16,64}$/.test(t) ? t : null;
};

/** Forma qiymati «Кому»: "r:<id>" — oluvchi, "b:<id>" — brigada. Noto'g'ri bo'lsa null. */
export function parseIssueTarget(v: unknown): IssueTarget | null {
  const s = typeof v === "string" ? v.trim() : "";
  const m = /^([rb]):(.+)$/.exec(s);
  if (!m) return null;
  return { kind: m[1] === "r" ? "recipient" : "brigade", id: m[2] };
}

/**
 * Расход sanasi: "YYYY-MM-DD" → harakat vaqti. Bugun (yoki bo'sh) — hozirgi vaqt; o'tgan kun — o'sha kun 12:00
 * (server vaqti Asia/Tashkent; davr chegaralari `stockPeriod` da mahalliy yarim tun). Kelajak va 31 kundan eski — rad.
 */
export function issueDate(s?: string | null, now = new Date()): Date {
  const v = (s ?? "").trim();
  if (!v) return now;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new IssueError("Неверная дата расхода");
  const day = new Date(`${v}T00:00:00`);
  if (!Number.isFinite(day.getTime()) || isoDate(day) !== v) throw new IssueError("Неверная дата расхода");
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  if (day > today) throw new IssueError("Дата расхода не может быть в будущем");
  const min = new Date(today); min.setDate(min.getDate() - ISSUE_BACK_DAYS);
  if (day < min) throw new IssueError(`Дата расхода — не раньше чем ${ISSUE_BACK_DAYS} дн. назад`);
  if (day.getTime() === today.getTime()) return now;
  const d = new Date(day); d.setHours(12, 0, 0, 0);
  return d;
}

/** Kalit bilan allaqachon yozilgan berish — o'sha hujjat (takror yuborilgan forma). */
async function byToken(token: string): Promise<IssueStockResult | null> {
  const m = await db.stockMove.findUnique({ where: { clientToken: token }, select: { id: true, refType: true, refId: true } });
  if (!m) return null;
  const ref = m.refId ?? m.id;
  const count = m.refType === "Issue" && m.refId ? await db.stockMove.count({ where: { refType: "Issue", refId: m.refId } }) : 1;
  return { ref, count, existed: true };
}

/** «Кому» — faol oluvchi yoki faol brigada. */
async function resolveTarget(to: IssueTarget | null | undefined): Promise<{ kind: "recipient" | "brigade"; id: string; name: string }> {
  if (!to?.id) throw new IssueError("Выберите, кому выдаётся (Кому)");
  if (to.kind === "recipient") {
    const r = await db.stockRecipient.findUnique({ where: { id: to.id }, select: { id: true, name: true, isActive: true } });
    if (!r || !r.isActive) throw new IssueError("Получатель не найден или неактивен — обновите страницу");
    return { kind: "recipient", id: r.id, name: r.name };
  }
  if (to.kind === "brigade") {
    const b = await db.brigade.findUnique({ where: { id: to.id }, select: { id: true, name: true, isActive: true } });
    if (!b || !b.isActive) throw new IssueError("Бригада не найдена или неактивна — обновите страницу");
    return { kind: "brigade", id: b.id, name: b.name };
  }
  throw new IssueError("Выберите, кому выдаётся (Кому)");
}

/**
 * Skladdan berish (Расход). Bir xomashyo bir necha qatorda kelsa — bitta qatorga qo'shiladi va yig'indisi tekshiriladi.
 * Skladda yetmasa — hech narsa yozilmaydi, `IssueError`: qaysi xomashyo, skladda qancha bor, qancha so'ralgan.
 */
export async function issueStock(input: IssueInput, actor: { userId: string; role: Role }): Promise<IssueStockResult> {
  const token = issueToken(input.clientToken);
  if (token) {
    const dup = await byToken(token);
    if (dup) return dup;
  }
  const date = issueDate(input.date);
  const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;

  const wanted = new Map<string, number>();
  for (const it of input.items ?? []) {
    const id = String(it?.materialId ?? "").trim();
    if (!id) continue;
    const q = Number(it.qty);
    if (!Number.isFinite(q) || q <= 0 || q > MAX_AMOUNT) throw new IssueError("Количество должно быть числом больше 0");
    wanted.set(id, (wanted.get(id) ?? 0) + q);
  }
  if (!wanted.size) throw new IssueError("Добавьте хотя бы одну строку: наименование и количество");
  if (wanted.size > MAX_ROWS) throw new IssueError(`Слишком много строк (до ${MAX_ROWS})`);
  const rows = [...wanted.entries()].map(([materialId, q]) => ({ materialId, qty: r3(q) }));
  if (rows.some((r) => r.qty <= 0 || r.qty > MAX_AMOUNT)) throw new IssueError("Количество должно быть не меньше 0,001");

  const ids = rows.map((r) => r.materialId);
  const [wh, mats, target] = await Promise.all([
    db.warehouse.findFirst({ where: { id: String(input.warehouseId ?? ""), isActive: true }, select: { id: true, name: true } }),
    db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } }),
    resolveTarget(input.to),
  ]);
  if (!wh) throw new IssueError("Склад не выбран или закрыт");
  if (mats.length !== ids.length) throw new IssueError("Наименование не найдено — обновите страницу");
  const meta = new Map(mats.map((m) => [m.id, m]));
  const ref = crypto.randomUUID();

  try {
    await db.$transaction(async (tx) => {
      // Qoldiq qulf ostida va AYNAN tanlangan sklad bo'yicha (chiqim ham shu skladdan)
      await lockStock(tx);
      const sums = await tx.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: wh.id, materialId: { in: ids } }, _sum: { qty: true } });
      const bal = new Map(sums.map((s) => [s.materialId!, Number(s._sum.qty ?? 0)]));
      const short = rows
        .filter((r) => (bal.get(r.materialId) ?? 0) < r.qty - STOCK_EPS)
        .map((r) => {
          const m = meta.get(r.materialId)!;
          const u = unitLabelRu(m.unit);
          return `${m.name} — есть ${fmtNum(Math.max(0, bal.get(r.materialId) ?? 0), 3)} ${u}, нужно ${fmtNum(r.qty, 3)} ${u}`;
        });
      if (short.length) throw new IssueError(`Недостаточно на складе «${wh.name}»: ${short.join("; ")}`);

      let sum = 0;
      if (target.kind === "recipient") {
        const prices = await issuePrices(ids, tx);
        for (const [i, r] of rows.entries()) {
          const cost = prices.get(r.materialId) ?? null;
          await tx.stockMove.create({
            data: {
              type: "ISSUE", date, warehouseId: wh.id, materialId: r.materialId, recipientId: target.id,
              qty: -r.qty, unitCost: cost, refType: "Issue", refId: ref, note,
              clientToken: i === 0 ? token : null, createdById: actor.userId,
            },
          });
          sum += r.qty * (cost ?? 0);
        }
      } else {
        sum = (await writeBrigadeIssue(tx, {
          brigade: target, warehouseId: wh.id, rows, userId: actor.userId, note, refType: "Issue", refId: ref, date, clientToken: token,
        })).sum;
      }
      await audit(tx, actor.userId, "CREATE", "StockMove", ref, undefined, {
        via: "rasxod", role: actor.role, date, warehouse: wh.name,
        to: { kind: target.kind, id: target.id, name: target.name }, rows, sum: Math.round(sum * 100) / 100, note,
      });
    });
  } catch (e) {
    // Bir vaqtda kelgan ikki bir xil yuborish: ikkinchisi unique kalitga urildi — birinchisining hujjati qaytadi
    if (token && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await byToken(token);
      if (dup) return dup;
    }
    throw e;
  }
  return { ref, count: rows.length, existed: false };
}

// ───────────────────────── Storno (bekor qilish) ─────────────────────────

/** Расход stornosi teskari harakatlarining `refType` i; `refId` — asl berish hujjati (`ref`). */
export const ISSUE_STORNO = "IssueStorno";

/**
 * Расход hujjatini storno qilish (`refType "Issue"`, `refId = ref`). Yozuvlar o'chirilmaydi: har harakatga teskari StockMove
 * (o'sha tur, sklad, narx, oluvchi / brigada; qty teskari; `refType "IssueStorno"`, `refId = ref`, izoh «Сторно: <sabab>»).
 * Brigadaga berilgan qatorlarda BrigadeMove ham teskari yoziladi (ISSUE, −, o'sha narx) — brigada qo'lida shuncha xomashyo
 * qolmagan bo'lsa (sarflangan / qaytarilgan) rad etiladi. Takror storno — rad. Bitta tranzaksiya, `lockStock` ostida.
 * Sabab majburiy (3+ belgi). Ruxsat (`stock` → `issue_storno`: direktor yoki u ruxsat bergan xodim) — chaqiruvchida.
 */
export async function cancelIssue(ref: string, reason: string, actor: { userId: string; role: Role }): Promise<{ ref: string; count: number }> {
  const id = String(ref ?? "").trim();
  const why = String(reason ?? "").trim().slice(0, 300);
  if (!id) throw new IssueError("Расход не найден — обновите страницу");
  if (why.length < 3) throw new IssueError("Укажите причину сторно (не короче 3 символов)");

  return db.$transaction(async (tx) => {
    // Qulf: ikki storno (yoki storno + brigada sarfi) bir vaqtda kelsa, ikkinchisi birinchisining natijasini ko'radi
    await lockStock(tx);
    if (await tx.stockMove.count({ where: { refType: ISSUE_STORNO, refId: id } })) throw new IssueError("Этот расход уже отменён (сторно)");
    const moves = await tx.stockMove.findMany({
      where: { refType: "Issue", refId: id },
      orderBy: { createdAt: "asc" },
      select: {
        type: true, warehouseId: true, materialId: true, recipientId: true, brigadeId: true, qty: true, unitCost: true,
        material: { select: { name: true, unit: true } },
      },
    });
    if (!moves.length) throw new IssueError("Расход не найден — обновите страницу");

    // Brigadaga berilgani: brigada qo'lida hali shuncha bormi (sarflangan / qaytarilgan bo'lsa storno qoldiqni minusga tushiradi)
    const toBrigade = moves.filter((m) => m.type === "BRIGADE_ISSUE" && m.brigadeId && m.materialId);
    if (toBrigade.length) {
      const need = new Map<string, { brigadeId: string; materialId: string; qty: number; name: string; unit: string }>();
      for (const m of toBrigade) {
        const k = `${m.brigadeId}|${m.materialId}`;
        const cur = need.get(k) ?? { brigadeId: m.brigadeId!, materialId: m.materialId!, qty: 0, name: m.material?.name ?? "?", unit: m.material?.unit ?? "" };
        cur.qty += -Number(m.qty);
        need.set(k, cur);
      }
      const brIds = [...new Set(toBrigade.map((m) => m.brigadeId!))];
      const [sums, brigades] = await Promise.all([
        tx.brigadeMove.groupBy({
          by: ["brigadeId", "materialId"],
          where: { brigadeId: { in: brIds }, materialId: { in: [...new Set(toBrigade.map((m) => m.materialId!))] } },
          _sum: { qty: true },
        }),
        tx.brigade.findMany({ where: { id: { in: brIds } }, select: { id: true, name: true } }),
      ]);
      const held = new Map(sums.map((s) => [`${s.brigadeId}|${s.materialId}`, Number(s._sum.qty ?? 0)]));
      const brName = new Map(brigades.map((b) => [b.id, b.name]));
      const short = [...need.entries()]
        .filter(([k, n]) => (held.get(k) ?? 0) < n.qty - STOCK_EPS)
        .map(([k, n]) => {
          const u = unitLabelRu(n.unit);
          return `${n.name} — у бригады «${brName.get(n.brigadeId) ?? "?"}» ${fmtNum(Math.max(0, held.get(k) ?? 0), 3)} ${u}, нужно вернуть ${fmtNum(n.qty, 3)} ${u}`;
        });
      if (short.length) throw new IssueError(`Сторно невозможно: бригада уже израсходовала или вернула часть сырья (${short.join("; ")})`);
    }

    const note = `Сторно: ${why}`;
    let sum = 0;
    for (const m of moves) {
      const back = await tx.stockMove.create({
        data: {
          type: m.type, warehouseId: m.warehouseId, materialId: m.materialId, recipientId: m.recipientId, brigadeId: m.brigadeId,
          qty: m.qty.negated(), unitCost: m.unitCost, refType: ISSUE_STORNO, refId: id, note, createdById: actor.userId,
        },
      });
      if (m.type === "BRIGADE_ISSUE" && m.brigadeId && m.materialId) {
        // Brigada qoldig'idan o'sha miqdor o'sha narxda ayiriladi (asl BrigadeMove ISSUE + ning teskarisi)
        await tx.brigadeMove.create({
          data: {
            type: "ISSUE", brigadeId: m.brigadeId, materialId: m.materialId, qty: m.qty, unitCost: m.unitCost,
            refType: "StockMove", refId: back.id, note, createdById: actor.userId,
          },
        });
      }
      sum += -Number(m.qty) * Number(m.unitCost ?? 0);
    }
    await audit(tx, actor.userId, "STATUS_CHANGE", "StockMove", id, { status: "ACTIVE" }, {
      status: "CANCELLED", via: "rasxod", role: actor.role, reason: why, reversedMoves: moves.length,
      rows: moves.map((m) => ({ materialId: m.materialId, type: m.type, qty: -Number(m.qty), recipientId: m.recipientId, brigadeId: m.brigadeId })),
      sum: Math.round(sum * 100) / 100,
    });
    return { ref: id, count: moves.length };
  });
}

// ───────────────────────── «Деньги» / «НДС» — oxirgi kirimdan ─────────────────────────

export type ReceiptTerms = { date: Date; payment: "BANK" | "CASH" | null; vatRate: number };

/**
 * Har xomashyo bo'yicha storno qilinmagan kirim qatorlari (sana bo'yicha o'sish tartibida): to'lov turi va QQS stavkasi.
 * To'lov turi: kirimdagi «Деньги» (П-р/Н-к); bo'sh bo'lsa — bog'langan to'lov hisobining turi
 * (BANK → П-р, CASH → Н-к; kirimning o'zi yoki ta'minot zayavkasi orqali to'langan), bo'lmasa null («—»).
 */
export async function receiptTermsByMaterial(materialIds: string[]): Promise<Map<string, ReceiptTerms[]>> {
  const ids = [...new Set(materialIds)];
  const out = new Map<string, ReceiptTerms[]>();
  if (!ids.length) return out;
  const items = await db.goodsReceiptItem.findMany({
    where: { materialId: { in: ids }, receipt: { cancelledAt: null } },
    select: { materialId: true, vatRate: true, receipt: { select: { id: true, date: true, createdAt: true, payment: true, supply: { select: { id: true } } } } },
  });
  const unpaid = items.filter((i) => !i.receipt.payment);
  const rids = [...new Set(unpaid.map((i) => i.receipt.id))];
  const sids = [...new Set(unpaid.map((i) => i.receipt.supply?.id).filter((x): x is string => !!x))];
  const txs = rids.length || sids.length
    ? await db.cashTransaction.findMany({
        where: { type: "EXPENSE", OR: [{ refType: "GoodsReceipt", refId: { in: rids } }, ...(sids.length ? [{ refType: "SupplyRequest", refId: { in: sids } }] : [])] },
        orderBy: { date: "asc" },
        select: { refType: true, refId: true, cashAccount: { select: { type: true } } },
      })
    : [];
  const acc = new Map<string, "BANK" | "CASH">();
  for (const t of txs) {
    const k = `${t.refType}:${t.refId}`;
    if (!acc.has(k)) acc.set(k, t.cashAccount.type);
  }
  const sorted = [...items].sort((a, b) => a.receipt.date.getTime() - b.receipt.date.getTime() || a.receipt.createdAt.getTime() - b.receipt.createdAt.getTime());
  for (const i of sorted) {
    const payment = i.receipt.payment
      ?? acc.get(`GoodsReceipt:${i.receipt.id}`)
      ?? (i.receipt.supply ? acc.get(`SupplyRequest:${i.receipt.supply.id}`) : undefined)
      ?? null;
    const list = out.get(i.materialId) ?? [];
    list.push({ date: i.receipt.date, payment, vatRate: i.vatRate });
    out.set(i.materialId, list);
  }
  return out;
}

/** `at` gacha (shu payt ham) bo'lgan oxirgi kirim; undan oldin kirim bo'lmasa — eng oxirgi kirim; umuman yo'q — null. */
export function termsAt(list: ReceiptTerms[] | undefined, at: Date): ReceiptTerms | null {
  if (!list?.length) return null;
  let pick: ReceiptTerms | null = null;
  for (const t of list) {
    if (t.date.getTime() <= at.getTime()) pick = t;
    else break;
  }
  return pick ?? list[list.length - 1];
}

// ───────────────────────── Расход jurnali ─────────────────────────

export type RasxodKind = "issue" | "brigade" | "return" | "storno" | "prod" | "writeoff" | "inventory";

export type RasxodRow = {
  id: string;
  date: Date;
  material: string;
  materialId: string;
  /** Birlik kodi (kg, t, dona…) — ekranda `unitLabelRu` */
  unit: string;
  /** Chiqim musbat; brigadadan qaytish, Расход stornosi (va shu kunning zames stornosi ko'p bo'lsa) — manfiy */
  qty: number;
  /** «От Кого» — sklad nomi */
  from: string;
  /** «Кому» */
  to: string;
  kind: RasxodKind;
  /** «Деньги» — oxirgi kirimdan: BANK (П-р), CASH (Н-к), null («—») */
  payment: "BANK" | "CASH" | null;
  /** «Доставка» — chiqimda yo'q (0); ustun Excel'dagidek turadi */
  delivery: number;
  /** «Цена» — harakatdagi narx (snapshot); yozilmagan bo'lsa joriy «Дона сўм» (`priceApprox`), u ham yo'q — null */
  price: number | null;
  /** «Общие Сумма» = К-во × Цена (+ Доставка) */
  sum: number;
  /**
   * «НДС» = Общие × oxirgi kirim qatorining QQS stavkasi / 100 — faqat korxona QQS to'lovchisi bo'lsa. To'lovchi bo'lmasa 0:
   * sklad tannarxi va o'rtacha narx QQS ICHIDA (`lib/receipt-vat` stockUnitCost), ustiga yana QQS qo'shilmaydi.
   */
  vat: number;
  /** «Итого Сумма» = Общие + НДС */
  total: number;
  priceApprox: boolean;
  /** Brigadaga avtomatik berilgan (topshiriq sarfi uchun yetmagan qism) */
  auto?: boolean;
  /** «Кому» filtri kaliti: "r:<id>" | "b:<id>" | "prod" | "writeoff" | "inventory" */
  toKey: string;
  warehouseId: string;
  /** Расход (ISSUE) izohi; storno qatorida — «Сторно: <sabab>» */
  note?: string | null;
  /** Расход hujjati (`refType "Issue"` → `refId`): oluvchi / brigada qatorlarida (storno tugmasi), storno qatorida — asl hujjat */
  ref?: string | null;
  /** Shu Расход hujjati storno qilingan («отменён») — asl qatorlarda */
  cancelled?: boolean;
};

/** Spisanie sabablari (`stock/adjust-const.ts` WRITE_OFF_REASONS) — ruscha jurnal uchun. */
const WRITE_OFF_RU: Record<string, string> = {
  "Brak (sifatsiz)": "брак",
  "Yo'qotish / tabiiy kamayish": "потеря / естественная убыль",
  "Muddati o'tgan": "истёк срок",
  "Shikastlangan (tashishda, saqlashda)": "повреждение",
  "Boshqa": "прочее",
};
function writeOffReason(note: string | null): string {
  const body = (note ?? "").replace(/^Hisobdan chiqarildi:\s*/, "");
  const kind = body.split(" · ")[0]?.trim() ?? "";
  return WRITE_OFF_RU[kind] ?? (kind || "—");
}

const INVENTORY_SHORT: Prisma.StockMoveWhereInput = { type: "ADJUSTMENT", refType: "Inventory", qty: { lt: 0 } };
const ALL_TYPES = ["ISSUE", "BRIGADE_ISSUE", "BRIGADE_RETURN", "PRODUCTION_CONSUME", "WRITE_OFF"] as const;

/** «Кому» filtri → so'rov sharti. "r"/"b" — barcha oluvchilar / barcha brigadalar. */
function filterWhere(f: string | null | undefined): Prisma.StockMoveWhereInput[] {
  const v = (f ?? "").trim();
  if (v.startsWith("r:") && v.length > 2) return [{ type: "ISSUE", recipientId: v.slice(2) }];
  if (v.startsWith("b:") && v.length > 2) return [{ type: { in: ["BRIGADE_ISSUE", "BRIGADE_RETURN"] }, brigadeId: v.slice(2) }];
  if (v === "r") return [{ type: "ISSUE" }];
  if (v === "b") return [{ type: { in: ["BRIGADE_ISSUE", "BRIGADE_RETURN"] } }];
  if (v === "prod") return [{ type: "PRODUCTION_CONSUME" }];
  if (v === "writeoff") return [{ type: "WRITE_OFF" }];
  if (v === "inventory") return [INVENTORY_SHORT];
  return [{ type: { in: [...ALL_TYPES] } }, INVENTORY_SHORT];
}

const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayEnd = (d: Date) => { const x = dayStart(d); x.setDate(x.getDate() + 1); return new Date(x.getTime() - 1); };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Расход jurnali (Sklad → «Расход»), manba — StockMove (xomashyo, davr `[from, to)`):
 *  · ISSUE — oluvchiga (Кому = oluvchi);
 *  · BRIGADE_ISSUE — brigadaga (Кому = brigada; topshiriq uchun avtomatik berilgani `auto`);
 *  · BRIGADE_RETURN — brigadadan qaytdi: manfiy qator («— возврат»);
 *  · Расход stornosi (`refType "IssueStorno"`, ISSUE / BRIGADE_ISSUE teskarisi) — manfiy qator «Сторно: <Кому>», Деньги/НДС
 *    asl berish sanasidagi kirimdan (asl qatorni aynan yo'qqa chiqaradi); asl qatorlar `cancelled` («отменён»);
 *  · PRODUCTION_CONSUME — zames: KUN + XOMASHYO + SKLAD bo'yicha bitta qator («Производство (замес)», ko'k);
 *    storno teskari qatorlari ishorasi bilan qo'shiladi (ayiriladi), to'liq storno bo'lgan kun qatori chiqmaydi;
 *  · WRITE_OFF — «Списание: <sabab>»; ADJUSTMENT (qty < 0, Inventory) — «Инвентаризация (недостача)».
 * Tartib: sana bo'yicha, kun ichida zames qatorlari oxirida (Excel'dagidek).
 */
export async function rasxodJournal(p: { from: Date; to: Date; warehouseId?: string | null; to_?: string | null }): Promise<RasxodRow[]> {
  const moves = await db.stockMove.findMany({
    where: {
      materialId: { not: null },
      date: { gte: p.from, lt: p.to },
      ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}),
      OR: filterWhere(p.to_),
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, date: true, type: true, warehouseId: true, materialId: true, recipientId: true, brigadeId: true,
      qty: true, unitCost: true, refType: true, refId: true, note: true,
    },
  });
  if (!moves.length) return [];

  const uniq = <T,>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => x != null))];
  const matIds = uniq(moves.map((m) => m.materialId));
  const noCost = uniq(moves.filter((m) => m.unitCost == null).map((m) => m.materialId));
  const issueRefs = uniq(moves.filter((m) => m.refType === "Issue").map((m) => m.refId));
  const stornoRefs = uniq(moves.filter((m) => m.refType === ISSUE_STORNO).map((m) => m.refId));
  const [materials, warehouses, recipients, brigades, prices, terms, vatPayer, cancelledRefs, originals] = await Promise.all([
    db.material.findMany({ where: { id: { in: matIds } }, select: { id: true, name: true, unit: true } }),
    db.warehouse.findMany({ where: { id: { in: uniq(moves.map((m) => m.warehouseId)) } }, select: { id: true, name: true } }),
    db.stockRecipient.findMany({ where: { id: { in: uniq(moves.map((m) => m.recipientId)) } }, select: { id: true, name: true } }),
    db.brigade.findMany({ where: { id: { in: uniq(moves.map((m) => m.brigadeId)) } }, select: { id: true, name: true } }),
    issuePrices(noCost),
    receiptTermsByMaterial(matIds),
    companyVatPayer(),
    // Davrdagi Расход hujjatlaridan qaysilari storno qilingan (storno davrdan keyin bo'lsa ham)
    issueRefs.length
      ? db.stockMove.findMany({ where: { refType: ISSUE_STORNO, refId: { in: issueRefs } }, distinct: ["refId"], select: { refId: true } })
      : Promise.resolve([] as { refId: string | null }[]),
    // Storno qatorlari uchun asl berish sanasi — Деньги / НДС asl qator bilan bir xil chiqsin
    stornoRefs.length
      ? db.stockMove.findMany({ where: { refType: "Issue", refId: { in: stornoRefs } }, select: { refId: true, materialId: true, date: true } })
      : Promise.resolve([] as { refId: string | null; materialId: string | null; date: Date }[]),
  ]);
  const mat = new Map(materials.map((m) => [m.id, m]));
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const recName = new Map(recipients.map((r) => [r.id, r.name]));
  const brName = new Map(brigades.map((b) => [b.id, b.name]));
  const cancelled = new Set(cancelledRefs.map((x) => x.refId));
  const origDate = new Map(originals.map((o) => [`${o.refId}|${o.materialId}`, o.date]));

  // Qator + narx hisobi uchun yordamchi: `known` — narxi yozilgan qism summasi, `unknownQty` — narxsiz miqdor,
  // `termsDate` — Деньги / НДС qaysi sanadagi kirimdan (storno — asl berish sanasi)
  type Draft = { row: Omit<RasxodRow, "payment" | "vat" | "total" | "sum" | "price" | "priceApprox">; known: number; unknownQty: number; prod: boolean; termsDate?: Date };
  const drafts: Draft[] = [];
  const prodBy = new Map<string, Draft>();

  for (const m of moves) {
    const materialId = m.materialId!;
    const meta = mat.get(materialId);
    const out = -Number(m.qty); // chiqim musbat (qaytish va storno — manfiy)
    const cost = m.unitCost == null ? null : Number(m.unitCost);
    const known = cost == null ? 0 : out * cost;
    const unknownQty = cost == null ? out : 0;
    const base = {
      materialId, material: meta?.name ?? "?", unit: meta?.unit ?? "", warehouseId: m.warehouseId,
      from: whName.get(m.warehouseId) ?? "—", delivery: 0, qty: out,
    };
    if (m.type === "PRODUCTION_CONSUME") {
      const day = dayStart(m.date);
      const key = `${isoDate(day)}|${materialId}|${m.warehouseId}`;
      const cur = prodBy.get(key);
      if (cur) { cur.row.qty += out; cur.known += known; cur.unknownQty += unknownQty; continue; }
      const d: Draft = { row: { ...base, id: `prod:${key}`, date: day, to: "Производство (замес)", kind: "prod", toKey: "prod" }, known, unknownQty, prod: true };
      prodBy.set(key, d);
      drafts.push(d);
      continue;
    }
    const brigade = (m.brigadeId && brName.get(m.brigadeId)) || "Бригада";
    const brKey = m.brigadeId ? `b:${m.brigadeId}` : "b";
    const recipient = (m.recipientId && recName.get(m.recipientId)) || "—";
    const recKey = m.recipientId ? `r:${m.recipientId}` : "r";
    // Расход hujjati: asl qatorlar — `ref` + «отменён» belgisi; storno qatorlari — alohida tur (manfiy)
    const doc = m.refType === "Issue" && m.refId ? { ref: m.refId, cancelled: cancelled.has(m.refId) } : {};
    let row: Draft["row"] | null = null;
    let termsDate: Date | undefined;
    if (m.refType === ISSUE_STORNO && (m.type === "ISSUE" || m.type === "BRIGADE_ISSUE")) {
      const isRec = m.type === "ISSUE";
      row = { ...base, id: m.id, date: m.date, to: `Сторно: ${isRec ? recipient : brigade}`, kind: "storno", toKey: isRec ? recKey : brKey, note: m.note, ref: m.refId };
      termsDate = origDate.get(`${m.refId}|${materialId}`);
    } else if (m.type === "ISSUE") row = { ...base, id: m.id, date: m.date, to: recipient, kind: "issue", toKey: recKey, note: m.note, ...doc };
    else if (m.type === "BRIGADE_ISSUE") row = { ...base, id: m.id, date: m.date, to: brigade, kind: "brigade", toKey: brKey, auto: m.refType === "BrigadeTask", ...doc };
    else if (m.type === "BRIGADE_RETURN") row = { ...base, id: m.id, date: m.date, to: `${brigade} — возврат`, kind: "return", toKey: brKey };
    else if (m.type === "WRITE_OFF") row = { ...base, id: m.id, date: m.date, to: `Списание: ${writeOffReason(m.note)}`, kind: "writeoff", toKey: "writeoff" };
    else if (m.type === "ADJUSTMENT") row = { ...base, id: m.id, date: m.date, to: "Инвентаризация (недостача)", kind: "inventory", toKey: "inventory" };
    if (row) drafts.push({ row, known, unknownQty, prod: false, termsDate });
  }

  const out: { row: RasxodRow; prod: boolean }[] = [];
  for (const d of drafts) {
    // To'liq storno qilingan kun (zames + teskarisi bir kunda) — qator chiqmaydi
    if (d.prod && Math.abs(d.row.qty) < STOCK_EPS) continue;
    const approx = Math.abs(d.unknownQty) > STOCK_EPS;
    const cur = prices.get(d.row.materialId);
    const goods = d.known + (approx && cur != null ? d.unknownQty * cur : 0);
    const sum = r2(goods + d.row.delivery);
    const price = Math.abs(d.row.qty) > STOCK_EPS && !(approx && cur == null && Math.abs(d.known) < 0.005) ? r2(goods / d.row.qty) : null;
    const t = termsAt(terms.get(d.row.materialId), dayEnd(d.termsDate ?? d.row.date));
    // QQS dostavkaga hisoblanmaydi. Korxona QQS to'lovchisi bo'lmasa narx (tannarx / «Дона сўм») QQS ichida — НДС 0
    const vat = vatPayer ? r2(goods * (t?.vatRate ?? 0) / 100) : 0;
    out.push({ row: { ...d.row, qty: r3(d.row.qty), payment: t?.payment ?? null, price, sum, vat, total: r2(sum + vat), priceApprox: approx }, prod: d.prod });
  }
  out.sort((a, b) => {
    const da = isoDate(a.row.date), dbb = isoDate(b.row.date);
    if (da !== dbb) return da < dbb ? -1 : 1;
    if (a.prod !== b.prod) return a.prod ? 1 : -1;
    if (a.prod) return a.row.material.localeCompare(b.row.material) || a.row.from.localeCompare(b.row.from);
    return a.row.date.getTime() - b.row.date.getTime();
  });
  return out.map((x) => x.row);
}

/** Jurnal yig'indilari — StatCard'lar va «Итого» qatori. */
export function rasxodTotals(rows: RasxodRow[]) {
  let sum = 0, vat = 0, total = 0, delivery = 0;
  for (const r of rows) { sum += r.sum; vat += r.vat; total += r.total; delivery += r.delivery; }
  return { count: rows.length, sum: r2(sum), vat: r2(vat), total: r2(total), delivery: r2(delivery) };
}
