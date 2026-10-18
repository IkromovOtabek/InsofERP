import { db } from "@/lib/db";
import { reassignable } from "@/lib/tasks";
import { brigadeStocks } from "@/lib/brigade-stock";
import { assignOrderBrigades } from "@/lib/production-assign";
import { batchSchema, createProductionBatch } from "@/lib/production-batch";
import { cancelBatch } from "@/lib/storno";
import { createRecipeVersion, type RecipeRowInput } from "@/lib/recipes";
import { saveBrigade } from "@/lib/brigades";
import { addProductDefect, canDeleteDefect, deleteProductDefect } from "@/lib/defects";
import { DEFECT_REASONS, todayLoad } from "@/lib/production-day";
import { productCatalog } from "@/lib/product-catalog";
import { customerMarks, markedName } from "@/lib/finance";
import { ingredientOf } from "@/lib/recipe";
import { today } from "@/lib/davomat";
import { unitLabel } from "@/lib/unit";
import { fmtNum } from "@/lib/format";
import type { Prisma, TaskStatus } from "@/generated/prisma";
import { day, inUnit, num, sum } from "./fmt";
import { can, type DetailAction, type FormField, type FormOption, type MobileDetail } from "./detail";
import { ListError, type ListFilter, type MobileList } from "./list";
import { repDetail } from "./report-detail";
import { clearDashCache } from "./dashboard";
import type { CreateForm, CreateResult } from "./create";
import type { MobileUser } from "./auth";
import type { HomeSection, Tone } from "./home";

/**
 * Ishlab chiqarish / ish boshqaruvchi kabinetidagi veb amallarning mobil nusxasi (ERP → ilova paritet):
 *   · zayavka kartochkasi — «Brigada tayinlash» (`order.assign`, veb `/production` → «Tayinlash»);
 *   · «Yangi zames» formasi (`create` kaliti `production`, veb `/production/new`);
 *   · zames kartochkasi — «Storno» (`batch.storno`, veb `/production/[id]`);
 *   · retsept kartochkasi — «Yangi versiya» / «Retsept tuzish» (`recipe.version`, veb `/recipes/[productId]`);
 *   · brigada kartochkasi — «Tahrirlash» (`brigade.edit`, veb `brigades/actions.ts → saveBrigade`);
 *   · sex «Brak» kartochkasi — «Brak yozish» (`defect.add`) va brak yozuvi kartochkasi (`defect`) — «O'chirish» (`defect.delete`);
 *   · «Topshiriqlar» ro'yxati — veb `/tasks` dagi holat tablari va brigada filtri;
 *   · bosh ekran — «Bugun yuklanadigan mahsulot» (veb ishlab chiqarish bosh sahifasi, 5-bo'lim).
 * Qoidalar `lib/*` da (veb ham shularni chaqiradi) — bu yerda faqat forma, ruxsat va natija matni.
 */

/** Shu fayl ijro qiladigan amallar — `actions.ts` dan bitta qator bilan yo'naltiriladi. */
export const SEX_EXTRA_ACTIONS: ReadonlySet<string> = new Set(["order.assign", "batch.storno", "recipe.version", "brigade.edit", "defect.add", "defect.delete"]);

const fail = (m: string, status = 400): never => { throw new ListError("ACTION_FAILED", m, status); };
const textOf = (p: Record<string, unknown>, key: string) => String(p[key] ?? "").trim();
/** Forma raqami ilovadan satr bo'lib keladi ("12 500", "12,5") — `actions.ts` dagi `numOf` bilan bir xil o'qiladi. */
const parseNum = (v: unknown): number | null => {
  const t = String(v ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const NONE = "__none__";

// ───────────────────────── Zayavka: brigada tayinlash ─────────────────────────

/**
 * Zayavka kartochkasiga «Brigada tayinlash» tugmasi — veb `/production` dagi forma bilan bir xil: topshirig'i yo'q
 * (yoki bajarilmay bekor qilingan) har qator uchun brigada tanlovi, brigadalar qo'lidagi xomashyo bilan qanchasini
 * chiqara olishi bo'yicha tartiblangan. Tanlanmagan qatorlar keyinga qoladi.
 */
export async function withOrderActions(user: MobileUser, d: MobileDetail): Promise<MobileDetail> {
  if (!can(user, "order.assign")) return d;
  const o = await db.order.findUnique({ where: { id: d.id }, select: { status: true, items: { select: { id: true, productId: true, qtyM3: true, product: { select: { name: true, unit: true } }, task: { select: { status: true, doneQty: true } } } } } });
  if (!o) return d;
  const open = o.items.filter((i) => !i.task || reassignable(i.task));
  if (!open.length || !["DRAFT", "CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return d;
  const base = { id: "order.assign", label: "Brigada tayinlash", tone: "brand" as const };
  if (o.status === "DRAFT") return { ...d, actions: [{ ...base, disabled: true, hint: "Zayavka hali tasdiqlanmagan (qoralama) — sotuv bo'limi qabul qilgach brigada tayinlanadi" }, ...d.actions] };
  const [brigades, stocks] = await Promise.all([
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leader: { select: { fullName: true } } } }),
    brigadeStocks(),
  ]);
  if (!brigades.length) return { ...d, actions: [{ ...base, disabled: true, hint: "Faol brigada yo'q — avval «Brigadalar» bo'limida brigada oching" }, ...d.actions] };
  // Mahsulot → brigada → shu brigada qo'lidagi xomashyo bilan qancha chiqara oladi (veb «Brigadalar imkoni»)
  const cap = new Map<string, Map<string, number>>();
  for (const b of stocks) for (const m of b.makes) (cap.get(m.productId) ?? cap.set(m.productId, new Map()).get(m.productId)!).set(b.id, m.canMake);
  const form: FormField[] = open.map((i, n) => {
    const unit = unitLabel(i.product.unit);
    const capOf = (bid: string) => cap.get(i.productId)?.get(bid) ?? 0;
    const options: FormOption[] = [...brigades].sort((a, b) => capOf(b.id) - capOf(a.id)).map((b) => {
      const c = capOf(b.id), need = sum(i.qtyM3);
      return {
        value: b.id, label: `${b.name}${b.leader ? ` · ${b.leader.fullName}` : ""}`,
        hint: c > 0 ? `${fmtNum(c, 2)} ${unit} chiqara oladi${c >= need - 0.0005 ? " — yetadi" : ` — ${fmtNum(Math.max(0, need - c), 2)} ${unit} yetmaydi`}` : "xomashyosi yo'q",
      };
    });
    return {
      name: `brigade_${i.id}`, label: `${i.product.name} — ${inUnit(sum(i.qtyM3), i.product.unit)}`, type: "select", options,
      ...(n === 0 ? { hint: "Tanlanmagan qatorlar keyinga qoladi. Xomashyo yetmasa ham tayinlash mumkin — skladdan brigadaga berasiz" } : {}),
    };
  });
  return { ...d, actions: [{ ...base, form }, ...d.actions] };
}

// ───────────────────────── Zames: yangi va storno ─────────────────────────

/** «Yangi zames» formasi — veb `/production/new` bilan bir xil variantlar (zayavkaning har beton qatori alohida). */
export async function batchForm(): Promise<CreateForm> {
  const [orders, catalog, warehouses, tasks] = await Promise.all([
    db.order.findMany({
      where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } },
      orderBy: { deliveryDate: "asc" },
      include: { customer: true, items: { include: { product: true } }, batches: { where: { cancelledAt: null } } },
    }),
    productCatalog(),
    db.warehouse.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    // Ochiq brigada topshiriqlari — faqat DONA mahsulot bo'yicha: brigada qayd qilganda shunday mahsulot hovliga o'zi
    // kirim bo'ladi, ustiga zames yozilsa ikki marta hisoblanadi (veb formadagi ogohlantirish)
    db.brigadeTask.findMany({
      where: { status: { in: ["NEW", "IN_PROGRESS"] }, orderItem: { product: { unit: { not: "m3" } } } },
      select: { taskNo: true, brigade: { select: { name: true } }, orderItem: { select: { productId: true } } },
    }),
  ]);
  const marks = await customerMarks(orders.map((o) => o.customerId));
  const busy = new Map<string, string[]>();
  for (const t of tasks) busy.set(t.orderItem.productId, [...(busy.get(t.orderItem.productId) ?? []), `${t.brigade.name} ${t.taskNo}`]);
  // Zames `orderItemId` saqlamaydi — qoldiq (zayavka, mahsulot) juftligi bo'yicha; zames faqat beton (m³) uchun
  const orderOpts: FormOption[] = orders.flatMap((o) => {
    const byProduct = new Map<string, { name: string; total: number }>();
    for (const i of o.items) {
      if (i.product.unit !== "m3") continue;
      const cur = byProduct.get(i.productId) ?? { name: i.product.name, total: 0 };
      cur.total += Number(i.qtyM3);
      byProduct.set(i.productId, cur);
    }
    return [...byProduct].map(([productId, x]) => {
      const done = o.batches.filter((b) => b.productId === productId).reduce((s, b) => s + Number(b.qtyM3), 0);
      const left = Math.max(0, Math.round((x.total - done) * 1000) / 1000);
      return { left, opt: { value: `${o.id}~${productId}`, label: `${o.orderNo} · ${markedName(o.customer.name, o.customerId, marks)} · ${x.name}`, hint: `qoldi ${fmtNum(left, 3)} m³ · ${day(o.deliveryDate)}`, extra: { productId, qtyM3: String(left) } } };
    });
  }).filter((x) => x.left > 0).map((x) => x.opt);
  return {
    key: "production", title: "Yangi zames", submitLabel: "Zamesni qayd etish",
    fields: [
      { name: "orderKey", label: "Zayavka", type: "select", options: orderOpts, hint: "Ixtiyoriy — zayavkasiz zames (sklad uchun) ham bo'ladi. Zayavka tanlansa marka va qolgan miqdor o'zi qo'yiladi" },
      {
        name: "productId", label: "Marka", type: "select", hint: "Zayavka tanlangan bo'lsa — zayavkadagi marka olinadi",
        options: catalog.products.map((p) => {
          const b = busy.get(p.id);
          return { value: p.id, label: `${p.code} · ${p.name} (${p.unit})`, hint: !p.hasRecipe ? "retsept yo'q — zames yozilmaydi" : b && p.rawUnit !== "m3" ? `brigada ham chiqaryapti: ${b.slice(0, 3).join(", ")} — ikki marta hisoblanmasin` : undefined };
        }),
      },
      { name: "qtyM3", label: "Miqdor", type: "number", required: true, hint: "Marka birligida (beton — m³)" },
      { name: "shift", label: "Smena", type: "select", required: true, value: "1", options: [1, 2, 3].map((n) => ({ value: String(n), label: `${n}-smena` })) },
      { name: "warehouseId", label: "Sklad", type: "select", required: true, value: warehouses[0]?.id, options: warehouses.map((w) => ({ value: w.id, label: w.name })) },
      { name: "note", label: "Izoh", type: "text" },
    ],
  };
}

/** Zamesni yozish — `createProductionBatch` (veb «Zamesni qayd etish» bilan bitta qoida). Xato — `Error` (create.ts o'giradi). */
export async function createBatchMobile(user: MobileUser, payload: unknown): Promise<CreateResult> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const key = textOf(p, "orderKey");
  const [orderId, orderProduct] = key ? key.split("~") : [];
  if (key && (!orderId || !orderProduct)) throw new Error("Zayavka qatori noto'g'ri — qayta tanlang");
  const qty = parseNum(p.qtyM3);
  const r = batchSchema.safeParse({
    orderId: orderId || undefined,
    productId: orderProduct || textOf(p, "productId"),
    warehouseId: textOf(p, "warehouseId"),
    qtyM3: qty ?? "",
    shift: textOf(p, "shift") || "1",
    note: textOf(p, "note") || undefined,
  });
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
  const res = await createProductionBatch(r.data, user.id);
  if ("error" in res) throw new Error(res.error);
  clearDashCache();
  return { key: "production", id: res.id, message: `${res.batchNo} qayd etildi — xomashyo skladdan yozib olindi` };
}

/** Zames kartochkasiga «Storno» — veb bilan bir xil: faqat direktor yoki u «Zamesni storno qilish» amalini bergan xodim. */
export async function withBatchActions(user: MobileUser, d: MobileDetail): Promise<MobileDetail> {
  if (!can(user, "batch.storno")) return d;
  const b = await db.productionBatch.findUnique({ where: { id: d.id }, select: { batchNo: true, cancelledAt: true, qtyM3: true, product: { select: { unit: true } } } });
  if (!b || b.cancelledAt) return d;
  return {
    ...d,
    actions: [...d.actions, {
      id: "batch.storno", label: "Bekor qilish", tone: "danger",
      confirm: `${b.batchNo} bekor qilinsinmi? Xomashyo skladga qaytadi, ${inUnit(sum(b.qtyM3), b.product.unit)} mahsulot qoldiqdan chiqariladi`,
      form: [{ name: "reason", label: "Bekor qilish sababi", type: "text", required: true, placeholder: "Nega bekor qilinyapti" }],
    }],
  };
}

// ───────────────────────── Retsept: yangi versiya ─────────────────────────

/**
 * Retsept kartochkasiga (id — mahsulot) «Yangi versiya» — joriy tarkib oldindan to'ldirilgan: har ingredientning
 * normasi (0 yoki bo'sh — tarkibdan chiqariladi), yangi qatorlar va izoh. Retsepti yo'q mahsulotga — «Retsept tuzish» (1-versiya).
 */
export async function withRecipeActions(user: MobileUser, d: MobileDetail): Promise<MobileDetail> {
  if (!can(user, "recipe.version")) return d;
  const [p, materials, products] = await Promise.all([
    db.product.findUnique({ where: { id: d.id }, select: { unit: true, recipes: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1, include: { items: { include: { material: true, product: true } } } } } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, unit: true } }),
    db.product.findMany({ where: { isActive: true, id: { not: d.id } }, orderBy: [{ name: "asc" }, { code: "asc" }], select: { id: true, code: true, name: true, unit: true } }),
  ]);
  if (!p) return d;
  const active = p.recipes[0];
  const per = `1 ${unitLabel(p.unit)}`;
  const current: FormField[] = (active?.items ?? []).map((i) => {
    const ing = ingredientOf(i);
    return { name: `q_${ing.kind}_${ing.key}`, label: `${ing.name} (${ing.unit}) — ${per} ga`, type: "number", value: String(ing.qtyPerM3), hint: "0 yoki bo'sh — tarkibdan chiqariladi" };
  });
  const refOptions: FormOption[] = [
    ...materials.map((m) => ({ value: `material:${m.id}`, label: `${m.name} (${m.unit})`, hint: `xomashyo · ${m.code}` })),
    ...products.map((x) => ({ value: `product:${x.id}`, label: `${x.name} (${unitLabel(x.unit)})`, hint: `mahsulot · ${x.code}` })),
  ];
  return {
    ...d,
    actions: [...d.actions, {
      id: "recipe.version", label: active ? "Yangi versiya" : "Retsept tuzish", tone: "brand",
      form: [
        ...current,
        {
          name: "add", label: active ? "Yangi tarkib qo'shish" : "Tarkib", type: "items", required: !active,
          hint: active ? "Kerak bo'lmasa bo'sh qoldiring" : "Har qator — xomashyo yoki yarim tayyor mahsulot",
          columns: [
            { name: "ref", label: "Xomashyo / mahsulot", type: "select", required: true, options: refOptions },
            { name: "qty", label: `Miqdor (${per} ga)`, type: "number", required: true },
          ],
        },
        { name: "note", label: "Izoh", type: "text", placeholder: "Nima o'zgardi" },
      ],
    }],
  };
}

function recipeRows(payload: Record<string, unknown>): RecipeRowInput[] {
  const rows: RecipeRowInput[] = [];
  const push = (kind: string, refId: string, raw: unknown, name: string) => {
    if (kind !== "material" && kind !== "product") fail("Tarkib qatori noto'g'ri — qayta tanlang");
    const q = parseNum(raw);
    if (q === null) return; // bo'sh — tarkibdan chiqariladi
    if (Number.isNaN(q)) fail(`${name}: miqdorni raqam bilan yozing`);
    if (q! < 0) fail("Miqdor manfiy bo'lmasin");
    if (q! > 1_000_000) fail("Miqdor juda katta");
    rows.push({ kind, refId, qtyPerM3: q! });
  };
  for (const [k, v] of Object.entries(payload)) {
    if (!k.startsWith("q_")) continue;
    const rest = k.slice(2), cut = rest.indexOf("_");
    if (cut > 0) push(rest.slice(0, cut), rest.slice(cut + 1), v, "Tarkib");
  }
  const add = Array.isArray(payload.add) ? payload.add : [];
  for (const [n, row] of add.entries()) {
    const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const ref = textOf(r, "ref");
    if (!ref) continue;
    const [kind, refId] = ref.split(":");
    if (parseNum(r.qty) === null) fail(`${n + 1}-qator: miqdorni yozing`);
    push(kind ?? "", refId ?? "", r.qty, `${n + 1}-qator`);
  }
  return rows;
}

// ───────────────────────── Brigada: tahrirlash ─────────────────────────

/** Brigada kartochkasiga «Tahrirlash» — nomi, brigadiri, telefoni, izohi (veb `saveBrigade(id)`). */
export async function withBrigadeActions(user: MobileUser, d: MobileDetail): Promise<MobileDetail> {
  if (!can(user, "brigade.edit")) return d;
  const [b, employees] = await Promise.all([
    db.brigade.findUnique({ where: { id: d.id }, select: { name: true, leaderId: true, phone: true, note: true } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } }),
  ]);
  if (!b) return d;
  return {
    ...d,
    actions: [{
      id: "brigade.edit", label: "Tahrirlash", tone: "brand",
      form: [
        { name: "name", label: "Brigada nomi", type: "text", required: true, value: b.name },
        { name: "leaderId", label: "Brigadir", type: "select", value: b.leaderId ?? NONE, options: [{ value: NONE, label: "— brigadirsiz —" }, ...employees.map((e) => ({ value: e.id, label: e.fullName, hint: e.position }))] },
        { name: "phone", label: "Telefon", type: "text", value: b.phone ?? undefined },
        { name: "note", label: "Izoh", type: "text", value: b.note ?? undefined },
      ],
    }, ...d.actions],
  };
}

// ───────────────────────── Brak: yozish va o'chirish ─────────────────────────

/** Sex «Brak» kartochkasi: «Brak yozish» tugmasi (veb bosh sahifadagi forma) va qaydlar bosilsa — brak yozuvi kartochkasi. */
export async function withDefectActions(user: MobileUser, d: MobileDetail): Promise<MobileDetail> {
  const sections = d.sections.map((s) => (s.title === "Qaydlar" ? { ...s, target: "defect" } : s));
  if (!can(user, "defect.add")) return { ...d, sections };
  const [products, brigades] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, unit: true }, orderBy: { code: "asc" } }),
    db.brigade.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const add: DetailAction = {
    id: "defect.add", label: "Brak yozish", tone: "danger",
    form: [
      { name: "productId", label: "Mahsulot", type: "select", required: true, options: products.map((p) => ({ value: p.id, label: `${p.code} · ${p.name} (${unitLabel(p.unit)})` })) },
      { name: "qty", label: "Miqdor", type: "number", required: true, hint: "Mahsulot birligida — hovli qoldig'idan hisobdan chiqariladi" },
      { name: "reason", label: "Sabab", type: "select", required: true, value: DEFECT_REASONS[0], options: DEFECT_REASONS.map((r) => ({ value: r, label: r })) },
      { name: "brigadeId", label: "Brigada", type: "select", value: NONE, options: [{ value: NONE, label: "— ko'rsatilmagan —" }, ...brigades.map((b) => ({ value: b.id, label: b.name }))] },
      { name: "note", label: "Izoh", type: "text", placeholder: "ixtiyoriy" },
    ],
  };
  return { ...d, sections, actions: [...d.actions, add] };
}

/** Bitta brak yozuvi (`defect/<id>`): hisobotdagi kartochka + «O'chirish» (direktor yoki bugun o'zi yozgan xodim). */
export async function defectCard(user: MobileUser, id: string): Promise<MobileDetail> {
  const base = await repDetail(user, `d~${id}`);
  const def = await db.productDefect.findUnique({ where: { id }, select: { createdById: true, createdAt: true } });
  const actions: DetailAction[] = def && can(user, "defect.delete") && canDeleteDefect(def, { userId: user.id, role: user.role })
    ? [{ id: "defect.delete", label: "Brak yozuvini o'chirish", tone: "danger", confirm: "Brak yozuvi bekor qilinsinmi? Qoldiq qaytariladi." }]
    : [];
  return { ...base, key: "defect", id, actions };
}

// ───────────────────────── Amallar ijrosi ─────────────────────────

export async function sexExtraAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<string> {
  switch (action) {
    case "order.assign": {
      const picks: Record<string, string> = {};
      for (const [k, v] of Object.entries(payload)) if (k.startsWith("brigade_") && typeof v === "string") picks[k.slice(8)] = v;
      const r = await assignOrderBrigades(id, picks, user.id);
      if ("error" in r) fail(r.error);
      clearDashCache();
      const made = (r as { made: { taskNo: string }[] }).made;
      return `${made.length} ta topshiriq brigadalarga yuborildi: ${made.map((m) => m.taskNo).join(", ")}`;
    }
    case "batch.storno": {
      const r = await cancelBatch(id, textOf(payload, "reason").slice(0, 300), user.id);
      if ("error" in r) fail(r.error);
      clearDashCache();
      return (r as { note?: string }).note ?? "Bekor qilindi";
    }
    case "recipe.version": {
      const r = await createRecipeVersion(id, recipeRows(payload), textOf(payload, "note") || null, user.id);
      if ("error" in r) fail(r.error);
      return `Retsept v${(r as { version: number }).version} saqlandi — zames va brigada sarfi endi shu tarkib bo'yicha`;
    }
    case "brigade.edit": {
      const name = textOf(payload, "name");
      if (!name) fail("Brigada nomi kerak");
      if (!(await db.brigade.count({ where: { id } }))) fail("Brigada topilmadi", 404);
      const leader = textOf(payload, "leaderId");
      const r = await saveBrigade(id, { name, leaderId: leader && leader !== NONE ? leader : null, phone: textOf(payload, "phone") || null, note: textOf(payload, "note") || null }, user.id);
      if ("error" in r) fail(r.error);
      return "Brigada saqlandi";
    }
    case "defect.add": {
      const qty = parseNum(payload.qty);
      if (qty === null || Number.isNaN(qty) || qty < 0.001) fail("Miqdor 0 dan katta raqam bo'lsin");
      const brigade = textOf(payload, "brigadeId");
      const r = await addProductDefect({
        productId: textOf(payload, "productId"), qty: qty!, reason: textOf(payload, "reason"),
        brigadeId: brigade && brigade !== NONE ? brigade : null, note: textOf(payload, "note") || null,
      }, user.id);
      if ("error" in r) fail(r.error);
      clearDashCache();
      return `Brak qayd qilindi — ${(r as { text: string }).text}`;
    }
    case "defect.delete": {
      const r = await deleteProductDefect(id, { userId: user.id, role: user.role });
      if ("error" in r) fail(r.error);
      clearDashCache();
      return "Brak yozuvi o'chirildi — hovli qoldig'i qaytarildi";
    }
    default:
      return fail("Bunday amal yo'q", 404);
  }
}

// ───────────────────────── «Topshiriqlar» ro'yxati (veb `/tasks`) ─────────────────────────

const TASK_LABEL: Record<TaskStatus, string> = { NEW: "Yuborildi", IN_PROGRESS: "Bajarilmoqda", DONE: "Bajarildi", CANCELLED: "Bekor" };
const STATUS_TABS: { key: string; label: string; where: Prisma.BrigadeTaskWhereInput }[] = [
  { key: "open", label: "Ochiq", where: { status: { in: ["NEW", "IN_PROGRESS"] } } },
  ...(Object.keys(TASK_LABEL) as TaskStatus[]).map((s) => ({ key: s, label: TASK_LABEL[s], where: { status: s } })),
];

/**
 * Ishlab chiqarish / ish boshqaruvchi (va vebda /tasks ochiq boshqa rollar) uchun topshiriqlar — veb tablari bilan bir xil:
 * «Ochiq» + holatlar, ustiga brigada filtri. Filtr kaliti: `<holat>` yoki `<holat>~b:<brigadaId>` (chip bosilganda ilova
 * kalitni o'zgarmasdan qaytaradi). Tanlangan brigada sarlavhada; «Barcha brigadalar» chipi filtrni olib tashlaydi.
 */
export async function tasksList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const parts = (filter ?? "").split("~");
  const tab = STATUS_TABS.find((t) => t.key === parts[0]) ?? STATUS_TABS[0]!;
  const brigadeId = parts.find((x) => x.startsWith("b:"))?.slice(2) || null;
  const search: Prisma.BrigadeTaskWhereInput = q ? { OR: [{ taskNo: { contains: q, mode: "insensitive" } }, { brigade: { name: { contains: q, mode: "insensitive" } } }, { orderItem: { product: { name: { contains: q, mode: "insensitive" } } } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : {};
  const byBrigade: Prisma.BrigadeTaskWhereInput = brigadeId ? { brigadeId } : {};
  const [list, statusCounts, brigadeCounts, brigades] = await Promise.all([
    db.brigadeTask.findMany({
      where: { AND: [tab.where, byBrigade, search] },
      orderBy: [{ order: { isUrgent: "desc" } }, { dueDate: "asc" }], take: 60,
      include: { brigade: { select: { name: true } }, order: { select: { orderNo: true, isUrgent: true, customer: { select: { name: true } } } }, orderItem: { select: { product: { select: { name: true, unit: true } } } } },
    }),
    db.brigadeTask.groupBy({ by: ["status"], where: { AND: [byBrigade, search] }, _count: { _all: true } }),
    db.brigadeTask.groupBy({ by: ["brigadeId"], where: { AND: [tab.where, search] }, _count: { _all: true } }),
    db.brigade.findMany({ where: { OR: [{ isActive: true }, ...(brigadeId ? [{ id: brigadeId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const sc = (s: TaskStatus) => statusCounts.find((c) => c.status === s)?._count._all ?? 0;
  const bc = new Map(brigadeCounts.map((c) => [c.brigadeId, c._count._all]));
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const suffix = brigadeId ? `~b:${brigadeId}` : "";
  const filters: ListFilter[] = [
    ...STATUS_TABS.map((t) => ({ key: `${t.key}${suffix}`, label: t.label, count: t.key === "open" ? sc("NEW") + sc("IN_PROGRESS") : sc(t.key as TaskStatus), active: t.key === tab.key })),
    ...(brigadeId ? [{ key: tab.key, label: "Barcha brigadalar", active: false }] : []),
    ...brigades.filter((b) => b.id !== brigadeId).map((b) => ({ key: `${tab.key}~b:${b.id}`, label: b.name, count: bc.get(b.id) ?? 0, active: false })),
  ];
  const picked = brigadeId ? brigades.find((b) => b.id === brigadeId) : null;
  return {
    key: "tasks", title: picked ? `${title} · ${picked.name}` : title,
    rows: list.map((t) => ({
      id: t.id,
      title: `${t.taskNo} · ${t.brigade.name}`,
      subtitle: `${t.order.customer.name} · ${t.orderItem.product.name} · muddat ${day(t.dueDate)}${t.order.isUrgent ? " · zarur" : ""}`,
      right: `${num(Math.max(0, sum(t.qty) - sum(t.doneQty)))} / ${num(sum(t.qty))} ${unitLabel(t.orderItem.product.unit)}`,
      status: TASK_LABEL[t.status],
      tone: (t.status === "DONE" ? "success" : t.status === "CANCELLED" ? "info" : t.dueDate < now ? "danger" : "warning") as Tone,
    })),
    filters,
  };
}

// ───────────────────────── Bosh ekran: bugungi yuklash ─────────────────────────

/** «Bugun yuklanadigan mahsulot» — veb ishlab chiqarish bosh sahifasidagi 5-bo'lim (`todayLoad`, bir manba). */
export async function todayLoadSections(): Promise<HomeSection[]> {
  const load = await todayLoad(today());
  return [
    {
      title: "Bugun yuklanadigan mahsulot", icon: "truck",
      empty: "Bugunga yetkazish sanasi qo'yilgan qabul qilingan zayavka yo'q",
      rows: load.products.map((p) => ({ id: p.id, title: `${p.code} · ${p.name}`, subtitle: `${p.orders} ta zayavka`, right: inUnit(p.need, p.unit) })),
    },
    ...(load.orders.length ? [{
      title: "Bugungi yuklash — zayavkalar", icon: "clipboard-list", empty: "", target: "orders",
      rows: load.orders.map((o) => {
        const one = o.items.length === 1 ? o.items[0]!.unit : null;
        return {
          id: o.id, title: `${o.orderNo} · ${o.customer}`,
          subtitle: `${o.time ?? "vaqtsiz"} · ${o.items.map((i) => `${i.code} ${inUnit(i.qty, i.unit)}`).join(", ")}${o.pickup ? " · o'zi oladi" : ""}`,
          right: o.left > 0 ? `qoldi ${inUnit(o.left, one)}` : "jo'natildi",
          tone: (o.left > 0 ? "warning" : "success") as Tone,
        };
      }),
    }] : []),
  ];
}
