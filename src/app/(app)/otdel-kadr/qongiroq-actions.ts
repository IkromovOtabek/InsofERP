"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit, auditMany } from "@/lib/audit";
import { parseForm, validDate, zOpt, zStr, type ActionState } from "@/lib/action";
import { dayUtc, isoDay, validDay } from "@/lib/davomat";
import { num, parseDateCell, str } from "@/lib/excel";
import { normalizePhone } from "@/lib/phone";
import { CALL_STATUSES } from "@/lib/hr/labels";
import type { HrCallStatus } from "@/generated/prisma";

/*
 * Otdel kadr → «Qo'ng'iroqlar jurnali»: ishga so'rab telefon qilganlar bilan gaplashuv daftari.
 * Hujjat emas (pul/sklad yo'q) — xato yozuv o'chiriladi, har amal AuditLog'da qoladi.
 */

const refresh = () => revalidatePath("/otdel-kadr");

/** Telefon: O'zbekiston raqami bo'lsa +998… ko'rinishida, aks holda kiritilgandek (faqat raqamlari). */
const phoneOf = (raw: string) => normalizePhone(raw) ?? (raw.replace(/\D+/g, "") || null);

const callSchema = z.object({
  date: zStr("Sanani kiriting"),
  position: zStr("Lavozimni yozing").pipe(z.string().max(80, "Lavozim 80 belgidan oshmasin")),
  phone: zStr("Telefon raqamini yozing"),
  fullName: zOpt.pipe(z.string().max(120, "Ism 120 belgidan oshmasin").nullable()),
  address: zOpt.pipe(z.string().max(160, "Manzil 160 belgidan oshmasin").nullable()),
  age: zOpt,
  status: z.enum(CALL_STATUSES as [HrCallStatus, ...HrCallStatus[]], { message: "Suhbat holatini tanlang" }),
  visitDate: zOpt,
  reason: zOpt.pipe(z.string().max(300, "Izoh 300 belgidan oshmasin").nullable()),
});

export async function saveCallLog(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "calls", ["HR"]);
  const r = parseForm(callSchema, fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const d = r.data;
  if (!validDay(d.date) || !validDate(d.date)) return { error: "Sana noto'g'ri (ertadan keyingi kun bo'lmasin)", field: "date" };
  if (d.visitDate && !validDay(d.visitDate)) return { error: "Suhbat kuni noto'g'ri", field: "visitDate" };
  const phone = normalizePhone(d.phone);
  if (!phone) return { error: "Telefon raqami noto'g'ri — 9 xonali raqam yozing (90 123 45 67)", field: "phone" };
  let age: number | null = null;
  if (d.age) {
    age = Math.trunc(num(d.age));
    if (!Number.isFinite(age) || age < 14 || age > 90) return { error: "Yoshi 14 dan 90 gacha bo'lsin", field: "age" };
  }
  const data = {
    date: dayUtc(d.date), position: d.position, phone, fullName: d.fullName, address: d.address, age,
    status: d.status, visitDate: d.visitDate ? dayUtc(d.visitDate) : null, reason: d.reason,
  };
  await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.hrCallLog.findUniqueOrThrow({ where: { id } });
      const after = await tx.hrCallLog.update({ where: { id }, data });
      await audit(tx, s.userId, "UPDATE", "HrCallLog", id, before, after);
    } else {
      const x = await tx.hrCallLog.create({ data: { ...data, createdById: s.userId } });
      await audit(tx, s.userId, "CREATE", "HrCallLog", x.id, undefined, x);
    }
  });
  refresh();
  return { ok: true, note: id ? "Saqlandi" : "Jurnalga yozildi" };
}

/** Qatordagi tanlovdan holatni tez almashtirish (keladi → keldi → ishga olindi). */
export async function setCallStatus(id: string, status: HrCallStatus): Promise<ActionState> {
  const s = await requireAction("employees", "calls", ["HR"]);
  if (!CALL_STATUSES.includes(status)) return { error: "Holat noto'g'ri" };
  const cur = await db.hrCallLog.findUnique({ where: { id }, select: { status: true } });
  if (!cur) return { error: "Yozuv topilmadi" };
  if (cur.status === status) return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.hrCallLog.update({ where: { id }, data: { status } });
    await audit(tx, s.userId, "STATUS_CHANGE", "HrCallLog", id, { status: cur.status }, { status });
  });
  refresh();
  return { ok: true };
}

export async function deleteCallLog(id: string): Promise<ActionState> {
  const s = await requireAction("employees", "calls", ["HR"]);
  const cur = await db.hrCallLog.findUnique({ where: { id } });
  if (!cur) return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.hrCallLog.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "HrCallLog", id, cur, undefined);
  });
  refresh();
  return { ok: true };
}

/** Telefon bo'yicha oldingi qo'ng'iroqlar — formada «oldin qo'ng'iroq qilgan» eslatmasi va bo'sh maydonlarni to'ldirish uchun. */
export async function lookupCallPhone(raw: string) {
  await requireAction("employees", "calls", ["HR"]);
  const phone = normalizePhone(raw);
  if (!phone) return [];
  const list = await db.hrCallLog.findMany({
    where: { phone }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 5,
    select: { id: true, date: true, position: true, fullName: true, address: true, age: true, status: true, reason: true },
  });
  return list.map((x) => ({ ...x, date: isoDay(x.date) }));
}

// ───────────────────────── Excel import ─────────────────────────

/** Apostrofsiz kichik harf: «Ko'tarmadi», «kotarmadi», «ko‘tarmadi» bir xil o'qilsin. */
const plain = (v: string) => v.toLowerCase().replace(/[ʻʼ‘’`´']/g, "").replace(/\s+/g, " ").trim();

/**
 * Excel'dagi «Suhbatga keldi yoki kelmadi» matni → holat. «dushanba keladi», «ertaga keladi» kabi matn holatga
 * sig'maydi — u izohga ko'chiriladi (`keep`), shunda jurnaldagi yozuv yo'qolmaydi.
 */
function statusOf(raw: string, reason: string): { status: HrCallStatus; keep: boolean } {
  const t = plain(raw), why = plain(reason);
  const keep = !!t && !["keldi", "kelmadi", "keladi"].includes(t);
  if (/ishga ol|qabul qil|ishga kirdi|ishlayapti/.test(t)) return { status: "HIRED", keep };
  if (/kotarmadi|javob bermadi|ochirilgan/.test(t) || (/kotarmadi/.test(why) && (!t || /kelmadi/.test(t)))) return { status: "NO_ANSWER", keep };
  if (/kelmadi|kelmaydi|rad etdi/.test(t)) return { status: "NO_SHOW", keep };
  if (/keldi/.test(t)) return { status: "CAME", keep };
  return { status: "WAITING", keep };
}

const importSchema = z.object({ rows: zStr("Excel ma'lumotlari kelmadi") });
type ImportRow = Record<string, unknown>;

/**
 * Excel jurnal → bazaga. Birlashtirilgan (merge) Sana va Lavozim kataklari faqat guruhning birinchi qatorida
 * bo'ladi — bo'sh katak yuqoridagi qatordan olinadi. Telefon ham, ism ham yo'q qator o'tkaziladi;
 * shu kun va shu telefon bazada bo'lsa (qayta import) — takror yozilmaydi.
 */
export async function importCallLogs(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "calls", ["HR"]);
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  let rows: ImportRow[];
  try { rows = JSON.parse(r.data.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows) || !rows.length) return { error: "Faylda qator yo'q" };
  if (rows.length > 5000) return { error: "Bir martada ko'pi bilan 5000 qator" };

  const items: { date: string; position: string; phone: string | null; fullName: string | null; address: string | null; age: number | null; status: HrCallStatus; reason: string | null }[] = [];
  let lastDate = "", lastPos = "", empty = 0, noDate = 0;
  const badDates: string[] = [];
  for (const row of rows) {
    const rawDate = str(row.date), rawPos = str(row.position);
    if (rawDate) {
      // Excel sana katagi brauzerda ISO ga aylanib keladi, matn sana («25.07.2025») — shu yerda o'qiladi
      const iso = validDay(rawDate) ?? parseDateCell(row.date);
      if (validDay(iso) && validDate(iso)) lastDate = iso;
      else { lastDate = ""; if (badDates.length < 3) badDates.push(rawDate); }
    }
    if (rawPos) lastPos = rawPos.slice(0, 80);
    const phone = phoneOf(str(row.phone));
    const fullName = str(row.fullName).slice(0, 120) || null;
    if (!phone && !fullName) { empty++; continue; }
    if (!lastDate) { noDate++; continue; }
    const ageN = Math.trunc(num(row.age));
    const reasonRaw = str(row.reason);
    const st = statusOf(str(row.status), reasonRaw);
    const reason = [st.keep ? str(row.status) : "", reasonRaw].filter(Boolean).join("; ").slice(0, 300) || null;
    items.push({
      date: lastDate, position: lastPos || "Ko'rsatilmagan", phone, fullName,
      address: str(row.address).slice(0, 160) || null,
      age: Number.isFinite(ageN) && ageN >= 14 && ageN <= 90 ? ageN : null,
      status: st.status, reason,
    });
  }
  if (!items.length) {
    return { error: noDate ? `Sanasi o'qilmagan qatorlar: ${noDate} ta${badDates.length ? ` (${badDates.join(", ")})` : ""} — sana ustunini tekshiring` : "Faylda telefon yoki ismi bor qator topilmadi" };
  }

  // Qayta import: shu kun + shu telefon (telefonsiz bo'lsa — ism) bazada yoki faylda oldinroq bo'lsa, o'tkaziladi
  const keyOf = (x: { date: string; phone: string | null; fullName: string | null }) => `${x.date}|${x.phone ?? `n:${(x.fullName ?? "").toLowerCase()}`}`;
  const dates = [...new Set(items.map((x) => x.date))].map(dayUtc);
  const existing = await db.hrCallLog.findMany({ where: { date: { in: dates } }, select: { date: true, phone: true, fullName: true } });
  const seen = new Set(existing.map((x) => keyOf({ ...x, date: isoDay(x.date) })));
  const fresh = items.filter((x) => { const k = keyOf(x); if (seen.has(k)) return false; seen.add(k); return true; });
  const dup = items.length - fresh.length;

  if (fresh.length) {
    // Bitta INSERT da hammasi bir xil vaqt olardi — kun ichidagi tartib (№) fayldagidek qolsin
    const base = Date.now();
    await db.$transaction(async (tx) => {
      const created = await tx.hrCallLog.createManyAndReturn({
        data: fresh.map((x, i) => ({ ...x, date: dayUtc(x.date), createdById: s.userId, createdAt: new Date(base + i) })),
      });
      await auditMany(tx, s.userId, "CREATE", "HrCallLog", created.map((x) => ({ id: x.id, after: x })));
    }, { timeout: 60_000 });
  }
  refresh();
  return {
    ok: true,
    note: [
      `${fresh.length} ta qo'ng'iroq jurnalga yozildi`,
      dup ? `${dup} tasi jurnalda bor — qayta yozilmadi` : "",
      noDate ? `${noDate} ta qatorning sanasi o'qilmadi${badDates.length ? ` (${badDates.join(", ")})` : ""}` : "",
      empty ? `${empty} ta bo'sh qator o'tkazildi` : "",
    ].filter(Boolean).join(" · "),
  };
}
