"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import {
  RENT_AREA_MAX, RENT_ELEC_CATEGORY, RENT_EXPENSE_CATEGORIES, RENT_INCOME_CATEGORY, RENT_MAX_MONTHS, cancelRentTx, createRentTx, endRentLease, monthKey, monthLabel, openMonth, parseMonth,
  saveRentChargeData, saveRentShopData, startRentLease, toggleRentShopActive,
} from "@/lib/rent";
import { addPriceChange, addPriceChangeBulk, addRentFiles, cancelPriceChange, removeRentFile } from "@/lib/rent-contract";
import { saveElecBill, saveRentElecData } from "@/lib/rent-elec";
import { saveRentLessor } from "@/lib/rent-lessor";
import { RentImportError, importRentSheet, type RentImportRow } from "@/lib/rent-import";
import { canDo } from "@/lib/permissions";
import type { ValueMaps } from "@/lib/excel";
import { normalizePhone } from "@/lib/phone";
import { sendRentReminder, shopLinkUrl, unlinkShopTelegram } from "@/lib/rent-tenant";

const done = () => revalidatePath("/arenda");
const shopDone = (id: string) => { revalidatePath(`/arenda/dokon/${id}`); done(); };
const token = (v: string | null) => (v && /^[A-Za-z0-9-]{16,64}$/.test(v) ? v : null);

const txSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  method: z.enum(["CASH", "BANK"], { message: "To'lov usulini tanlang" }),
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  month: zOpt,
  // Kunlik ijarali do'kon kirimi — qaysi kun uchun
  day: zOpt.refine((v) => !v || validDate(v), "kun noto'g'ri"),
  shopId: zOpt,
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "summa juda katta"),
  category: zOpt,
  note: zOpt,
  clientToken: zOpt,
  // Sobiq ijarachi qarzi uchun kirim (do'kon kartasidan); bo'sh — joriy shartnoma
  leaseId: zOpt,
  // Oylik ijarada bir necha oyga oldindan to'lov
  months: z.coerce.number().int().min(1).max(RENT_MAX_MONTHS).optional().catch(1),
  // Kirim turi: ijara yoki svet to'lovi
  incomeKind: z.enum(["rent", "elec"]).optional().catch("rent"),
});

/** Kirim saqlangach forma «Kvitansiyani chop etish» havolasini ko'rsatadi. */
export type RentTxState = (NonNullable<ActionState> & { receiptId?: string }) | undefined;

/** Arenda kassasiga kirim (ijarachidan, qaysi oy uchun) yoki chiqim. */
export async function saveRentTx(_prev: RentTxState, fd: FormData): Promise<RentTxState> {
  const s = await requireAction("arenda", "create");
  const r = parseForm(txSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const month = d.month ? parseMonth(d.month) : null;
  if (d.month && !month) return { error: "Oy noto'g'ri" };
  if (d.type === "INCOME" && !d.shopId) return { error: "Do'konni tanlang" };
  const day = d.type === "INCOME" && d.day && d.incomeKind !== "elec" ? new Date(d.day) : null;
  if (d.type === "INCOME" && !month && !day) return { error: "Qaysi oy uchun to'lov — oyni tanlang" };
  const elec = d.type === "INCOME" && d.incomeKind === "elec";
  const category = d.type === "INCOME" ? (elec ? RENT_ELEC_CATEGORY : RENT_INCOME_CATEGORY) : d.category;
  if (d.type === "EXPENSE" && !(RENT_EXPENSE_CATEGORIES as readonly string[]).includes(category ?? "")) return { error: "Chiqim turini tanlang" };
  if (d.type === "EXPENSE" && category === "Boshqa" && !d.note) return { error: "«Boshqa» chiqim uchun izoh yozing" };
  const res = await createRentTx({
    type: d.type, method: d.method, date: new Date(d.date), month, shopId: d.shopId, amount: d.amount,
    category: category!, note: d.note, clientToken: token(d.clientToken), day,
    leaseId: d.type === "INCOME" ? d.leaseId : null, months: d.type === "INCOME" && !elec ? d.months : 1,
  }, s.userId);
  if (res.error) return { error: res.error };
  if (d.shopId) shopDone(d.shopId); else done();
  const note = res.duplicate ? "Allaqachon saqlangan (qayta bosildi)"
    : d.type === "EXPENSE" ? "Chiqim saqlandi"
    : elec ? "Svet to'lovi saqlandi"
    : res.sameDay ? `Kirim saqlandi. Diqqat: bu kun uchun avval ham ${res.sameDay} ta kirim bor — ikki marta yozilmaganini tekshiring`
    : (d.months ?? 1) > 1 ? `Kirim saqlandi — ${d.months} oyga bo'lindi, kvitansiya bitta`
    : "Kirim saqlandi";
  return { ok: true, note, receiptId: d.type === "INCOME" ? res.id : undefined };
}

export async function stornoRentTx(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("arenda", "storno");
  const res = await cancelRentTx(id, reason, s.userId);
  if (res.error) return { error: res.error };
  done();
  return { ok: true, note: "Bekor qilindi" };
}

/** Oyni ochish — faol do'konlarga o'tgan oy hisobidan (bo'lmasa andozadan) nusxa. */
export async function openRentMonth(key: string): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const month = parseMonth(key);
  if (!month) return { error: "Oy noto'g'ri" };
  const { created, priced } = await openMonth(month, s.userId);
  done();
  return { ok: true, note: created ? `${created} ta do'kon hisobi ochildi${priced ? `, ${priced} tasida yangi narx qo'llandi` : ""}` : "Yangi do'kon yo'q — hisob avvaldan ochilgan" };
}

const optNum = (max: number, msg: string) => z.string().optional().transform((v) => (v?.trim() ? Number(v.replace(",", ".")) : null))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= max), msg);

const chargeSchema = z.object({
  bankDue: zDec(), cashDue: zDec(), electricity: zDec(), tax: zDec(), note: zOpt,
  // Kunlik ijarada — hisoblangan kunlar (bozor yopiq kunlar ayiriladi)
  days: z.string().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 31), "kunlar 0–31 oralig'ida bo'lsin"),
});

/** Oy varag'idagi qatorni tahrirlash (shartnomaning shu oy hisobi). Hisob bo'lmasa — ochiladi. Qoida — `saveRentChargeData`. */
export async function saveRentCharge(leaseId: string, key: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const month = parseMonth(key);
  if (!month) return { error: "Oy noto'g'ri" };
  const r = parseForm(chargeSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await saveRentChargeData(leaseId, month, r.data, s.userId);
  if (res.error) return { error: res.error };
  done();
  return { ok: true };
}

const optDate = zOpt.refine((v) => !v || !Number.isNaN(new Date(v).getTime()), "sana noto'g'ri").transform((v) => (v ? new Date(v) : null));
/** Shartnoma maydonlari (do'kon formasi va «Ijaraga berish / ijarachini almashtirish» formasi). */
const leaseShape = {
  contractNo: zOpt,
  tenantRep: zOpt, tenantAddress: zOpt, tenantAccount: zOpt, tenantMfo: zOpt,
  startDate: optDate,
  endDate: optDate,
  deposit: optNum(MAX_AMOUNT, "zaklad summasi noto'g'ri"),
};

/** Telefon va INN tekshiruvi — do'kon va shartnoma formalari uchun bitta qoida. */
function tenantCheck<T extends { phone: string | null; inn: string | null }>(d: T): { error: string; field: string } | T {
  if (d.phone) {
    const p = normalizePhone(d.phone);
    if (!p) return { error: "Telefon raqami noto'g'ri — masalan +998 90 123 45 67", field: "phone" };
    d.phone = p;
  }
  if (d.inn && !/^\d{9}$|^\d{14}$/.test(d.inn.replace(/\s+/g, ""))) return { error: "INN 9 xonali (JShShIR — 14 xonali) bo'lsin", field: "inn" };
  if (d.inn) d.inn = d.inn.replace(/\s+/g, "");
  return d;
}

const shopSchema = z.object({
  id: zOpt,
  name: zStr("Do'kon nomini yozing").max(200, "nom juda uzun"),
  location: zStr("Joy (bozor) ni yozing").max(120, "nom juda uzun"),
  period: z.enum(["MONTHLY", "DAILY"]).default("MONTHLY"),
  payDay: z.string().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 31), "to'lov kuni 1–31 oralig'ida bo'lsin"),
  bankAmount: zDec(), cashAmount: zDec(), electricity: zDec(), tax: zDec(),
  area: z.string().optional().transform((v) => (v?.trim() ? Number(v.replace(",", ".")) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0 && v <= RENT_AREA_MAX), "maydon (m²) noto'g'ri"),
  note: zOpt,
  tenantName: zOpt,
  phone: zOpt,
  inn: zOpt,
  ...leaseShape,
  electricityBilled: z.string().optional().transform((v) => v === "on"),
  // «Svet hisobida» belgilanmasa maydon formada yo'q — 0 deb olinadi («Raqam bo'lishi kerak» chiqmasin)
  elecFixed: zDec().default(0),
  address: zOpt, cadastre: zOpt,
  // Qo'shilganda shu oy hisobi ochilgan bo'lsa — yangi do'kon ham shu oyga tushadi
  month: zOpt,
  // Yangi joy: «Bo'sh» — hali ijaraga berilmagan, oy hisobiga tushmaydi
  vacant: z.string().optional().transform((v) => v === "on"),
});

export async function saveRentShop(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(shopSchema, fd);
  if ("error" in r) return r;
  const { id, month: key, vacant, contractNo, ...rest } = r.data;
  const data = { ...(id ? rest : { ...rest, isActive: !vacant }), no: contractNo };
  if (data.period === "DAILY") data.payDay = null; // kunlikda har kuni to'lanadi
  if (!id && !data.area) return { error: "Do'kon maydonini (m²) kiriting", field: "area" };
  // Ijaradagi joyda telefon va (oylikda) to'lov kuni shart — eslatma va «Bugun / Muddati o'tgan» filtrlari shunga tayanadi
  const active = id ? ((await db.rentShop.findUnique({ where: { id }, select: { isActive: true } }))?.isActive ?? true) : !vacant;
  if (active && !data.phone) return { error: "Ijaradagi joy uchun ijarachi telefonini kiriting", field: "phone" };
  if (active && data.period === "MONTHLY" && !data.payDay) return { error: "To'lov kunini tanlang — har oyning nechanchi sanasigacha to'laydi", field: "payDay" };
  const chk = tenantCheck(data);
  if ("error" in chk) return chk;
  // Qoida `lib/rent.ts` da — mobil do'kon kartochkasi ham shuni chaqiradi
  const res = await saveRentShopData(id, data, id ? null : parseMonth(key), s.userId);
  if (res.error) return { error: res.error };
  done();
  return { ok: true, note: id ? "Do'kon saqlandi" : vacant ? "Bo'sh joy qo'shildi" : "Do'kon qo'shildi" };
}

/* ───────────────────────── Shartnoma: ijaraga berish, almashtirish, bo'shatish ───────────────────────── */

const leaseSchema = z.object({
  tenantName: zStr("Ijarachi F.I.O. sini yozing").max(200, "juda uzun"),
  phone: zStr("Ijarachi telefonini kiriting"),
  inn: zOpt,
  ...leaseShape,
  startDate: zStr("Ijara boshlanish sanasini tanlang").refine(validDate, "sana noto'g'ri").transform((v) => new Date(v)),
  bankAmount: zDec(), cashAmount: zDec(),
  payDay: z.string().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 31), "to'lov kuni 1–31 oralig'ida bo'lsin"),
  leaseNote: zOpt,
});

/**
 * «Ijaraga berish» (bo'sh joy) yoki «Ijarachini almashtirish»: amaldagi shartnoma yangi ijara boshlanishidan bir kun oldin
 * yopiladi (eski ijarachi qarzi o'zida qoladi), yangi shartnoma ochiladi, Telegram ulanishi yangilanadi.
 */
export async function startRentLeaseAction(shopId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(leaseSchema, fd);
  if ("error" in r) return { error: r.error };
  const chk = tenantCheck(r.data);
  if ("error" in chk) return { error: chk.error };
  const d = chk;
  const shop = await db.rentShop.findUnique({ where: { id: shopId }, select: { period: true } });
  if (shop?.period === "MONTHLY" && !d.payDay) return { error: "To'lov kunini tanlang — har oyning nechanchi sanasigacha to'laydi" };
  const res = await startRentLease(shopId, {
    tenantName: d.tenantName, phone: d.phone, inn: d.inn, no: d.contractNo, startDate: d.startDate, endDate: d.endDate, deposit: d.deposit, leaseNote: d.leaseNote,
    tenantRep: d.tenantRep, tenantAddress: d.tenantAddress, tenantAccount: d.tenantAccount, tenantMfo: d.tenantMfo,
    bankAmount: d.bankAmount, cashAmount: d.cashAmount, payDay: d.payDay,
  }, s.userId);
  if (res.error) return { error: res.error };
  shopDone(shopId);
  return { ok: true, note: `${res.replaced ? "Ijarachi almashtirildi" : "Ijaraga berildi"}${res.charged ? " — shu oy jadvaliga qo'shildi, summani tekshiring" : ""}${res.replaced ? ". Eski ijarachining shu oy hisobini jadvalda tuzating" : ""}` };
}

const endLeaseSchema = z.object({
  endedAt: zStr("Chiqish sanasini tanlang").refine(validDate, "sana noto'g'ri").transform((v) => new Date(v)),
  reason: zOpt,
});

/** Joyni bo'shatish: amaldagi shartnoma yopiladi, joy keyingi oylar hisobiga tushmaydi, tarix va qarz joyida qoladi. */
export async function endRentLeaseAction(shopId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(endLeaseSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await endRentLease(shopId, { endedAt: r.data.endedAt, reason: r.data.reason }, s.userId);
  if (res.error) return { error: res.error };
  shopDone(shopId);
  return { ok: true, note: "Joy bo'shatildi — qarzi bo'lsa «Qarzdorlar» da sobiq ijarachi sifatida qoladi" };
}

/** Do'konlar ro'yxatidagi tugma: ijaradagi joyni bugungi sana bilan bo'shatish. */
export async function toggleRentShop(id: string): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = await toggleRentShopActive(id, s.userId);
  if (r.error) return { error: r.error };
  shopDone(id);
  return { ok: true, note: r.active ? `Ijaraga berildi${r.charged ? " — shu oy jadvaliga qo'shildi, summani tekshiring" : ""}` : "Bo'sh joy deb belgilandi" };
}

/* ───────────────────────── Narx o'zgarishi ───────────────────────── */

const priceSchema = z.object({
  fromMonth: zStr("Qaysi oydan — oyni tanlang"),
  bankAmount: zDec(), cashAmount: zDec(),
  note: zOpt,
});

export async function addRentPriceChange(shopId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(priceSchema, fd);
  if ("error" in r) return { error: r.error };
  const fromMonth = parseMonth(r.data.fromMonth);
  if (!fromMonth) return { error: "Oy noto'g'ri" };
  const res = await addPriceChange(shopId, { fromMonth, bankAmount: r.data.bankAmount, cashAmount: r.data.cashAmount, note: r.data.note }, s.userId);
  if (res.error) return { error: res.error };
  shopDone(shopId);
  return { ok: true, note: `${monthLabel(fromMonth)} hisobi ochilganda yangi narx qo'llanadi` };
}

const bulkPriceSchema = z.object({
  location: zStr("Joyni (bozorni) tanlang"),
  fromMonth: zStr("Qaysi oydan — oyni tanlang"),
  percent: z.coerce.number({ message: "foiz raqam bo'lsin" }).min(-90, "foiz −90 dan kichik bo'lmasin").max(500, "foiz juda katta"),
  note: zOpt,
});

export async function addRentPriceChangeBulk(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(bulkPriceSchema, fd);
  if ("error" in r) return { error: r.error };
  const fromMonth = parseMonth(r.data.fromMonth);
  if (!fromMonth) return { error: "Oy noto'g'ri" };
  const res = await addPriceChangeBulk(r.data.location, { fromMonth, percent: r.data.percent, note: r.data.note }, s.userId);
  if (res.error) return { error: res.error };
  done();
  return { ok: true, note: `${res.created} ta do'konga ${monthLabel(fromMonth)} dan yangi narx rejalashtirildi${res.skipped ? `; ${res.skipped} tasida shu oy hisobi ochilgan — o'tkazib yuborildi` : ""}` };
}

export async function cancelRentPriceChange(id: string): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = await cancelPriceChange(id, s.userId);
  if (r.error) return { error: r.error };
  shopDone(r.shopId!);
  return { ok: true, note: "Narx o'zgarishi bekor qilindi" };
}

/* ───────────────────────── Hujjat va suratlar ───────────────────────── */

export async function uploadRentFiles(shopId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File);
  const r = await addRentFiles(shopId, String(fd.get("kind") ?? ""), files, s.userId);
  if (r.count) shopDone(shopId);
  if (r.error) return { error: r.count ? `${r.count} ta fayl saqlandi, keyingisi: ${r.error}` : r.error };
  return { ok: true, note: `${r.count} ta fayl saqlandi` };
}

export async function removeRentFileAction(id: string): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = await removeRentFile(id, s.userId);
  if (r.error) return { error: r.error };
  shopDone(r.shopId!);
  return { ok: true, note: "Fayl olib tashlandi" };
}

/* ───────────────────────── Ijaraga beruvchi rekvizitlari (shartnoma uchun) ───────────────────────── */

const lessorSchema = z.object({
  kind: z.enum(["person", "company"]).default("company"),
  name: zStr("Ijaraga beruvchi F.I.O. yoki nomini yozing").max(200, "juda uzun"),
  basis: zOpt, basisUz: zOpt, address: zOpt, inn: zOpt, bank: zOpt, mfo: zOpt, account: zOpt, card: zOpt, phone: zOpt, city: zOpt,
  taxPercent: z.coerce.number({ message: "soliq foizi raqam bo'lsin" }).min(0, "0–100").max(100, "0–100").default(0),
});

export async function saveRentLessorAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(lessorSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  await saveRentLessor({
    kind: d.kind, name: d.name, basis: d.basis ?? "", basisUz: d.basisUz ?? "", address: d.address ?? "", inn: d.inn ?? "", bank: d.bank ?? "",
    mfo: d.mfo ?? "", account: d.account ?? "", card: d.card ?? "", phone: d.phone ?? "", city: d.city ?? "", taxPercent: d.kind === "person" ? d.taxPercent : 0,
  }, s.userId);
  done();
  return { ok: true, note: "Ijaraga beruvchi rekvizitlari saqlandi — shartnomalarda shu ma'lumot chiqadi" };
}

/* ───────────────────────── Svet tarifi ───────────────────────── */

const kwhSchema = z.object({ price: zDec(), markup: z.coerce.number({ message: "ustama raqam bo'lsin" }).min(0, "ustama manfiy bo'lmasin").max(100, "ustama 100% dan oshmasin") });

/** 1 kVt·soat narxi va ustama (%) — hisoblagich ko'rsatkichidan svet summasi: farq × narx + %. */
export async function saveRentKwhPrice(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(kwhSchema, fd);
  if ("error" in r) return { error: r.error };
  const data = { rentKwhPrice: r.data.price, rentElecMarkup: r.data.markup };
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { rentKwhPrice: true, rentElecMarkup: true } });
  await db.companySettings.upsert({ where: { id: "main" }, update: data, create: { id: "main", ...data } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before ?? undefined, data);
  done();
  return { ok: true, note: `1 kVt·soat — ${r.data.price} so'm, ustama ${r.data.markup}%. Keyingi kiritilgan ko'rsatkichlar shu tarifda hisoblanadi` };
}

/* ───────────────────────── Svet varag'i (`lib/rent-elec.ts`) ───────────────────────── */

const elecSchema = z.object({
  meterStart: optNum(1e9, "ko'rsatkich noto'g'ri"), meterEnd: optNum(1e9, "ko'rsatkich noto'g'ri"),
  amount: zDec(), paidDirect: zDec(), note: zOpt,
});

/** Svet qatori: ko'rsatkichlar, (hisoblagichsiz bo'lsa) summa, litsevoyga to'langan, izoh. */
export async function saveRentElec(leaseId: string, key: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const month = parseMonth(key);
  if (!month) return { error: "Oy noto'g'ri" };
  const r = parseForm(elecSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await saveRentElecData(leaseId, month, r.data, s.userId);
  if (res.error) return { error: res.error };
  done();
  return { ok: true };
}

const billSchema = z.object({ amount: zDec(), note: zOpt });

/** Joy bo'yicha «To'lashimiz kerak» — elektr kompaniyasiga oylik to'lov (0 — o'chiriladi). */
export async function saveRentElecBill(location: string, key: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const month = parseMonth(key);
  if (!month) return { error: "Oy noto'g'ri" };
  const r = parseForm(billSchema, fd);
  if ("error" in r) return { error: r.error };
  await saveElecBill(location, month, r.data.amount, r.data.note, s.userId);
  done();
  return { ok: true, note: "Saqlandi" };
}

const importSchema = z.object({
  month: zStr("Oyni tanlang"),
  rows: zStr("Excel ma'lumotlari yo'q"),
  valueMaps: zOpt,
  groupRows: z.string().optional().transform((v) => v === "on"),
  withPayments: z.string().optional().transform((v) => v === "on"),
});

/** Excel'dagi oy varag'ini import: do'konlar, shu oy hisobi va (belgilansa) tushgan pul — `lib/rent-import.ts`. */
export async function importRentFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const month = parseMonth(d.month);
  if (!month) return { error: "Oy noto'g'ri" };
  if (d.withPayments && !canDo(s, "arenda", "create")) return { error: "Tushgan pulni kirim qilishga ruxsatingiz yo'q — «To'langan summalarni kirim qilish» belgisini olib tashlang" };
  let rows: unknown;
  let valueMaps: ValueMaps = {};
  try {
    rows = JSON.parse(d.rows);
    const raw: unknown = d.valueMaps ? JSON.parse(d.valueMaps) : {};
    const loc = (raw as Record<string, unknown>)?.location;
    if (loc && typeof loc === "object") valueMaps = { location: Object.fromEntries(Object.entries(loc).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== "")) };
  } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows) || !rows.length) return { error: "Faylda qator yo'q" };
  let res;
  try {
    res = await importRentSheet({ month, rows: rows as RentImportRow[], groupRows: d.groupRows, withPayments: d.withPayments, valueMaps }, s.userId);
  } catch (e) {
    if (e instanceof RentImportError) return { error: e.message };
    throw e;
  }
  done();
  redirect(`/arenda?oy=${monthKey(month)}&import=${res.shops}-${res.newShops}-${res.payments}-${res.replaced}-${res.skipped}`);
}

/* ───────────────────────── Ijarachi: Telegram va qarz eslatmasi (`lib/rent-tenant.ts`) ───────────────────────── */


/** Ulash havolasi (QR) — kalit yaratiladi; ijarachi botda «Start» bossa chati do'konga ulanadi. */
export async function createRentTgLink(shopId: string): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const url = await shopLinkUrl(shopId, s.userId);
  if (!url) return { error: "Telegram bot sozlanmagan — TELEGRAM_BOT_TOKEN kerak" };
  shopDone(shopId);
  return { ok: true };
}

export async function unlinkRentTg(shopId: string): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  await unlinkShopTelegram(shopId, s.userId);
  shopDone(shopId);
  return { ok: true, note: "Telegram uzildi — eski QR endi ishlamaydi" };
}

/** Qo'lda eslatma — ijarachining ulangan Telegram chatiga (jurnalga yoziladi). */
export async function sendRentReminderNow(shopId: string): Promise<ActionState> {
  const s = await requireAction("arenda", "create");
  const r = await sendRentReminder(shopId, { auto: false, userId: s.userId });
  shopDone(shopId);
  return r.ok ? { ok: true, note: "Eslatma yuborildi" } : { error: r.error };
}

const remindSchema = z.object({ day: z.coerce.number().int("butun son bo'lsin").min(0, "0–28 oralig'ida").max(28, "0–28 oralig'ida") });

/** Avtomatik eslatma kuni (0 — o'chiq). */
export async function saveRentRemindDay(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("arenda", "shops");
  const r = parseForm(remindSchema, fd);
  if ("error" in r) return { error: r.error };
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { rentRemindDay: true } });
  await db.companySettings.upsert({ where: { id: "main" }, update: { rentRemindDay: r.data.day }, create: { id: "main", rentRemindDay: r.data.day } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before ?? undefined, { rentRemindDay: r.data.day });
  done();
  return { ok: true, note: r.data.day ? `Har oyning ${r.data.day}-sanasida eslatma yuboriladi` : "Avtomatik eslatma o'chirildi" };
}
