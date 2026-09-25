"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { POSITIONS, roleForPosition, isDriverPosition } from "@/lib/positions";
import { flatName } from "@/lib/excel";
import { guessDepartment } from "@/lib/orgchart";
import { pushEmployeeSilently } from "@/lib/eco/people";
import { isAssignableDept } from "@/lib/orgchart";
import { kindFromField, OTHER_DOC_KIND } from "@/lib/kadr";
import { importEmployees, type ImportEmployeeRow } from "@/lib/import-employees";
import { saveEmployeeFile, removeEmployeeFile, photoEntry } from "@/lib/uploads";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

/** Ishchi lavozimlarni faqat otdel kadr (va direktor) yuritadi. */
const hr = () => requireSession(["HR"]);

const schema = z.object({
  name: zStr("Lavozim nomi kerak"),
  note: zOpt,
  // Tuzilma diagrammasida qaysi bo'lim tagida turadi. Bo'sh bo'lsa kod nom bo'yicha taxmin qiladi.
  department: z.string().trim().optional().transform((v) => (v && isAssignableDept(v) ? v : null)),
  isDriver: z.string().optional().transform((v) => v === "on"),
  sortOrder: z.coerce.number().int().min(0).default(0),
});


/* ───────── Lavozimlarni tartibga solish ───────── */

/** "FORMOVSHIK" → "Formovshik", "formovshik" → "Formovshik". Aralash yozilgan nom tegilmaydi. */
function prettyPosition(name: string) {
  const t = name.trim().replace(/\s+/g, " ");
  if (!t) return t;
  const body = t === t.toUpperCase() && t.length > 3 ? t.toLowerCase() : t;
  return body.charAt(0).toUpperCase() + body.slice(1);
}

/**
 * Xodimlarda yozilgan lavozimlarni ro'yxat bilan moslaydi — Excel importdan keyin ishlatiladi.
 *
 * Nom harf-raqamlargacha solishtiriladi (bo'sh joy, tire, katta-kichik harf farqi hisobga olinmaydi):
 *  · "sotuv", "SOTUV" → bo'lim lavozimi «Sotuv» (login beradigan);
 *  · ro'yxatdagi lavozimning boshqa yozilishi → ro'yxatdagi yozilishiga keltiriladi;
 *  · ro'yxatda umuman yo'q lavozim → yangi ishchi lavozim bo'lib ochiladi (nomi tartibga solinadi,
 *    bo'limi nomdan taxmin qilinadi).
 * Natijada bir ish bitta nom bilan yuradi va hamma sahifada (Xodimlar, Otdel kadr, filtrlar,
 * tuzilma diagrammasi) bir xil ko'rinadi.
 */
export async function syncEmployeePositions(): Promise<ActionState> {
  const s = await hr();
  const [used, work] = await Promise.all([
    db.employee.groupBy({ by: ["position"], _count: { _all: true } }),
    db.workPosition.findMany({ select: { id: true, name: true, isActive: true } }),
  ]);

  // Kanonik nom: bo'lim lavozimi > ro'yxatdagi lavozim > xodimlarda eng ko'p uchragan yozilish
  const canon = new Map<string, string>();
  for (const p of POSITIONS) canon.set(flatName(p.label), p.label);
  for (const w of work) if (!canon.has(flatName(w.name))) canon.set(flatName(w.name), w.name);

  // Bir lavozimning hamma yozilishi: `raw` — bazadagi aynan qiymat (yangilashda shu bo'yicha topiladi)
  const byKey = new Map<string, { raw: string; count: number }[]>();
  for (const u of used) {
    const name = u.position.trim();
    if (!name) continue;
    // "Snabjeniye", "Finance" kabi eski bo'lim nomlari ishchi lavozim emas — tegilmaydi
    if (!canon.has(flatName(name)) && roleForPosition(name)) continue;
    const k = flatName(name);
    byKey.set(k, [...(byKey.get(k) ?? []), { raw: u.position, count: u._count._all }]);
  }

  let renamed = 0, movedEmployees = 0;
  const created: string[] = [];
  await db.$transaction(async (tx) => {
    const last = await tx.workPosition.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    let order = (last?.sortOrder ?? 0) + 10;

    for (const [key, spellings] of byKey) {
      let target = canon.get(key);
      if (!target) {
        // Eng ko'p uchragan yozilish olinadi va chiroyli ko'rinishga keltiriladi
        const top = [...spellings].sort((a, b) => b.count - a.count)[0].raw;
        target = prettyPosition(top);
        const wp = await tx.workPosition.create({
          data: { name: target, sortOrder: order, department: guessDepartment(target), note: "Xodimlar ro'yxatidan olindi" },
        });
        await audit(tx, s.userId, "CREATE", "WorkPosition", wp.id, undefined, wp);
        created.push(target);
        canon.set(key, target);
        order += 10;
      }
      // Turli yozilishlarni kanonik nomga keltiramiz (bazadagi aynan qiymat bo'yicha)
      for (const sp of spellings) {
        if (sp.raw === target) continue;
        const res = await tx.employee.updateMany({ where: { position: sp.raw }, data: { position: target } });
        movedEmployees += res.count;
        renamed++;
      }
    }

    // Bir xil lavozimning ikkita yozuvi qolgan bo'lsa — kanonik bo'lmaganini yashiramiz
    for (const w of work) {
      const target = canon.get(flatName(w.name));
      if (target && target !== w.name && w.isActive) {
        const after = await tx.workPosition.update({ where: { id: w.id }, data: { isActive: false, note: `«${target}» bilan bir xil — yashirildi` } });
        await audit(tx, s.userId, "UPDATE", "WorkPosition", w.id, w, after);
      }
    }
  }, { timeout: 120_000, maxWait: 20_000 });

  refresh();
  revalidatePath("/employees");
  const parts = [
    created.length ? `${created.length} ta yangi lavozim ro'yxatga olindi (${created.slice(0, 6).join(", ")}${created.length > 6 ? "…" : ""})` : "",
    renamed ? `${renamed} xil yozilish birlashtirildi, ${movedEmployees} xodim kartasi yangilandi` : "",
  ].filter(Boolean);
  return { ok: true, note: parts.length ? `${parts.join("; ")}.` : "Hammasi joyida — lavozimlar allaqachon bir xil." };
}

function refresh() {
  revalidatePath("/otdel-kadr");
  revalidatePath("/employees");
}

/** Bo'lim lavozimi bilan bir xil nom ishchi lavozimga berilmasin — aks holda login mantig'i chalkashadi. */
function clashesWithDepartment(name: string) {
  return POSITIONS.some((p) => p.label.toLowerCase() === name.trim().toLowerCase());
}

export async function saveWorkPosition(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (clashesWithDepartment(d.name)) return { error: `"${d.name}" — bo'lim lavozimi, ishchi lavozim sifatida qo'shib bo'lmaydi` };

  try {
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.workPosition.findUniqueOrThrow({ where: { id } });
        const after = await tx.workPosition.update({ where: { id }, data: d });
        // Nom o'zgarsa — shu lavozimdagi xodimlar kartasi ham yangilanadi (Employee.position matn bilan bog'langan)
        if (before.name !== after.name) {
          await tx.employee.updateMany({ where: { position: before.name }, data: { position: after.name } });
        }
        await audit(tx, s.userId, "UPDATE", "WorkPosition", id, before, after);
      } else {
        const created = await tx.workPosition.create({ data: d });
        await audit(tx, s.userId, "CREATE", "WorkPosition", created.id, undefined, created);
      }
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bunday lavozim allaqachon bor" };
    throw e;
  }
  refresh();
  return { ok: true };
}

/** Lavozimni yoqish/o'chirish. O'chirilgan lavozim yangi xodimga tanlanmaydi, eskilari joyida qoladi. */
export async function toggleWorkPosition(id: string) {
  const s = await hr();
  const cur = await db.workPosition.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.workPosition.update({ where: { id }, data: { isActive: !cur.isActive } });
    await audit(tx, s.userId, "UPDATE", "WorkPosition", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  });
  refresh();
}

/** Hech kimga berilmagan lavozimni butunlay o'chirish. */
export async function deleteWorkPosition(id: string) {
  const s = await hr();
  const cur = await db.workPosition.findUniqueOrThrow({ where: { id } });
  const used = await db.employee.count({ where: { position: cur.name } });
  if (used > 0) return; // bandi bor — faqat o'chirib qo'yish mumkin
  await db.$transaction(async (tx) => {
    await tx.workPosition.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "WorkPosition", id, cur, undefined);
  });
  refresh();
}

// ───────────────────────── Xodim kartasi (hujjatlari bilan) ─────────────────────────

const zDate = z.string().trim().optional().transform((v) => (v ? new Date(v) : null));

const cardSchema = z.object({
  fullName: zStr("F.I.O. kerak"),
  position: zStr("Lavozim kerak"),
  phone: zOpt,
  birthDate: zDate,
  hiredAt: zDate,
  passportSeries: zOpt,
  pinfl: zOpt,
  passportIssuedBy: zOpt,
  passportIssuedAt: zDate,
  address: zOpt,
  education: zOpt,
  maritalStatus: zOpt,
  note: zOpt,
});

/** Formadagi barcha `doc:<tur>` fayllari — bo'shlari tashlab ketiladi. */
function documentEntries(fd: FormData) {
  const out: { kind: string; file: File }[] = [];
  for (const [key, value] of fd.entries()) {
    const kind = kindFromField(key);
    if (!kind || !(value instanceof File) || value.size === 0) continue;
    out.push({ kind: kind === OTHER_DOC_KIND ? OTHER_DOC_KIND : kind, file: value });
  }
  return out;
}

/** Tanlangan fayllarni diskka yozadi; birortasi xato bo'lsa yozilganlarini qaytarib o'chiradi. */
async function saveDocuments(employeeId: string, entries: { kind: string; file: File }[]) {
  const saved: { kind: string; file: string; fileName: string; fileType: string }[] = [];
  for (const e of entries) {
    const r = await saveEmployeeFile(employeeId, e.file);
    if (r && "error" in r) {
      await Promise.all(saved.map((x) => removeEmployeeFile(x.file)));
      return { error: r.error };
    }
    if (r) saved.push({ kind: e.kind, file: r.stored, fileName: r.name, fileType: r.type });
  }
  return { saved };
}

/**
 * Otdel kadr: yangi xodim kartasi — shaxsiy ma'lumotlar, 3x4 surat va hujjat nusxalari.
 * Saqlangach shaxsiy varaqa chop etish sahifasiga o'tadi.
 */
export async function createEmployeeCard(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const r = parseForm(cardSchema.strip(), fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  // Bo'lim lavozimi login talab qiladi — u "Xodimlar" sahifasidagi tezkor formada beriladi
  if (roleForPosition(d.position)) {
    return { error: `"${d.position}" — tizimga kiradigan bo'lim. Uni Xodimlar sahifasidan login bilan qo'shing` };
  }

  // Fayllar xodim id'si bo'yicha nomlanadi — shuning uchun id oldindan beriladi
  const id = crypto.randomUUID();
  const photo = await saveEmployeeFile(id, photoEntry(fd), { imageOnly: true });
  if (photo && "error" in photo) return { error: photo.error };
  const docs = await saveDocuments(id, documentEntries(fd));
  if ("error" in docs) {
    await removeEmployeeFile(photo?.stored);
    return { error: docs.error };
  }

  try {
    await db.$transaction(async (tx) => {
      const e = await tx.employee.create({
        data: {
          id, fullName: d.fullName, position: d.position, phone: d.phone,
          birthDate: d.birthDate, hiredAt: d.hiredAt, note: d.note,
          photo: photo?.stored, passportSeries: d.passportSeries, pinfl: d.pinfl,
          passportIssuedBy: d.passportIssuedBy, passportIssuedAt: d.passportIssuedAt,
          address: d.address, education: d.education, maritalStatus: d.maritalStatus,
          documents: { create: docs.saved },
        },
      });
      await audit(tx, s.userId, "CREATE", "Employee", e.id, undefined, { ...e, documents: docs.saved.length });
    });
  } catch (e) {
    await removeEmployeeFile(photo?.stored);
    await Promise.all(docs.saved.map((x) => removeEmployeeFile(x.file)));
    throw e;
  }

  if (await isDriverPosition(d.position)) pushEmployeeSilently(id);
  refresh();
  revalidatePath("/drivers");
  // Saqlandi → shaxsiy varaqa darhol chop etish oynasi bilan ochiladi
  redirect(`/employees/${id}/varaqa?print=1`);
}

/** Mavjud kartaga hujjat nusxasi qo'shish. */
export async function addEmployeeDocument(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const kind = String(fd.get("kind") ?? "").trim() || OTHER_DOC_KIND;
  const entries = [...fd.getAll("file")].filter((f): f is File => f instanceof File && f.size > 0).map((file) => ({ kind, file }));
  if (entries.length === 0) return { error: "Fayl tanlanmagan" };
  const docs = await saveDocuments(employeeId, entries);
  if ("error" in docs) return { error: docs.error };
  await db.$transaction(async (tx) => {
    await tx.employeeDocument.createMany({ data: docs.saved.map((x) => ({ ...x, employeeId })) });
    await audit(tx, s.userId, "CREATE", "EmployeeDocument", employeeId, undefined, { kind, count: docs.saved.length });
  });
  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
}

/**
 * Kartadagi 3x4 suratni yuklash yoki almashtirish — fayldan ham, kamerada olingan
 * kadrdan ham keladi (`photoEntry` ikkalasini birdek qabul qiladi). Eski surat diskdan ketadi.
 */
export async function updateEmployeePhoto(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const file = photoEntry(fd);
  if (!file) return { error: "Surat tanlanmagan" };
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { photo: true } });
  const saved = await saveEmployeeFile(employeeId, file, { imageOnly: true });
  if (!saved) return { error: "Surat tanlanmagan" };
  if ("error" in saved) return { error: saved.error };
  try {
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: employeeId }, data: { photo: saved.stored } });
      await audit(tx, s.userId, "UPDATE", "Employee", employeeId, { photo: e.photo }, { photo: saved.stored });
    });
  } catch (err) {
    await removeEmployeeFile(saved.stored);
    throw err;
  }
  await removeEmployeeFile(e.photo);
  refresh();
  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
}

/** Suratni kartadan olib tashlash — fayl ham diskdan ketadi. */
export async function deleteEmployeePhoto(employeeId: string): Promise<void> {
  const s = await hr();
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { photo: true } });
  if (!e.photo) return;
  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data: { photo: null } });
    await audit(tx, s.userId, "DELETE", "Employee", employeeId, { photo: e.photo }, undefined);
  });
  await removeEmployeeFile(e.photo);
  refresh();
  revalidatePath(`/employees/${employeeId}`);
}

/** Hujjat nusxasini o'chirish — fayl ham diskdan ketadi. */
export async function deleteEmployeeDocument(docId: string) {
  const s = await hr();
  const doc = await db.employeeDocument.findUniqueOrThrow({ where: { id: docId } });
  await db.$transaction(async (tx) => {
    await tx.employeeDocument.delete({ where: { id: docId } });
    await audit(tx, s.userId, "DELETE", "EmployeeDocument", docId, doc, undefined);
  });
  await removeEmployeeFile(doc.file);
  revalidatePath(`/employees/${doc.employeeId}`);
}


// ───────────────────────── Excel'dan xodimlar ro'yxati ─────────────────────────

const importSchema = z.object({
  rows: z.string(),
  defaultPosition: zOpt,
  groupRows: z.string().optional().transform((v) => v === "on"),
  createPositions: z.string().optional().transform((v) => v === "on"),
  updateExisting: z.string().optional().transform((v) => v === "on"),
});

/**
 * Otdel kadr → Xodimlar ro'yxati → "Excel orqali qo'shish": buxgalteriya tabeli jadvali
 * (Сотрудник, Табельный номер, Должность, Тарифная ставка, Дата приема/увольнения, Дата рождения)
 * kartalarga tushadi. Bo'lim sarlavhalari ("Бригада 1") xodim emas — keyingi qatorlarning bo'limi bo'ladi.
 */
export async function importEmployeesFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  let rows: ImportEmployeeRow[];
  try { rows = JSON.parse(d.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows) || !rows.length) return { error: "Faylda qator yo'q" };

  let res;
  try {
    res = await importEmployees({
      rows,
      groupRows: d.groupRows,
      defaultPosition: d.defaultPosition,
      createPositions: d.createPositions,
      updateExisting: d.updateExisting,
    }, s.userId);
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Haydovchi lavozimidagilar haydovchi ilovasida ham ko'rinsin (ECO o'chiq bo'lsa jim o'tadi)
  for (const id of res.driverIds) pushEmployeeSilently(id);
  refresh();
  revalidatePath("/drivers");

  // E'tibor beriladigan joyi bo'lmasa — ro'yxatga qaytadi; bo'lsa sahifada qolib tushuntiradi
  if (!res.createdPositions.length && !res.skipped) {
    redirect(`/otdel-kadr?tab=xodimlar&qoshildi=${res.created}&yangilandi=${res.updated}`);
  }
  const list = (l: string[], n = 5) => `${l.slice(0, n).join(", ")}${l.length > n ? "…" : ""}`;
  return {
    ok: true,
    note: [
      `${res.created} ta xodim qo'shildi, ${res.updated} tasi yangilandi`,
      res.createdPositions.length ? `yangi lavozim ochildi: ${list(res.createdPositions)}` : "",
      res.skipped ? `${res.skipped} ta qator o'tkazib yuborildi — bunday xodim bazada bor ("mavjud xodimlar yangilansin"ni belgilang)` : "",
      res.fired ? `${res.fired} tasi nofaol qilindi (ishdan bo'shagan sanasi bor)` : "",
    ].filter(Boolean).join(" · "),
  };
}
