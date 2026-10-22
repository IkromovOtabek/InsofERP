"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { HIRING_DOCS, HR_DOC_BY_KIND, isDismissalDoc } from "@/lib/hr-docs";
import { orderNoProblem } from "@/lib/hr/order-no";
import { saveEmployeeFile, removeEmployeeFile } from "@/lib/uploads";
import { parseForm, zOpt, type ActionState } from "@/lib/action";
import type { HrDocKind, Prisma } from "@/generated/prisma";

/**
 * Otdel kadr hujjatlari (ariza, anketa, mehnat shartnomasi, tilxat, moddiy javobgarlik,
 * buyruq, bo'shatish arizasi): tayyorlash, imzolangan nusxani yuklash, o'chirish.
 * Matn va ro'yxat — `lib/hr-docs.ts`.
 */

// Rol (HR) + direktor bergan "employees" moduli ruxsati (yo'q/ko'rish — yozolmaydi)
const hr = () => requireAction("employees", "edit", ["HR"]);

/** "2026-09-10" → Date; bo'sh bo'lsa null. Noto'g'ri sana — forma xatosi (jim null bo'lib, muddat yo'qolmasin). */
const zDate = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900 || d.getUTCFullYear() > 2100) { ctx.addIssue({ code: "custom", message: `Sana noto'g'ri: «${v}»` }); return z.NEVER; }
  return d;
});

const KINDS = HIRING_DOCS.map((d) => d.kind).concat("BOSHATISH", "BOSHATISH_BUYRUQ") as [HrDocKind, ...HrDocKind[]];

const docSchema = z.object({
  docId: zOpt,
  kind: z.enum(KINDS),
  docDate: zDate,
  effectiveAt: zDate,
  position: zOpt,
  salary: z.string().trim().optional().transform((v) => {
    const n = Number(String(v ?? "").replace(/\s/g, ""));
    return v && Number.isFinite(n) && n > 0 ? n : null;
  }),
  fixedTerm: z.string().optional().transform((v) => v === "on"),
  termUntil: zDate,
  no: zOpt,
  reason: zOpt,
  article: zOpt,
});

/** Hujjat tayyorlash yoki tayyorlangan hujjatning maydonlarini tuzatish. */
export async function saveHrDoc(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const r = parseForm(docSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (!d.docDate) return { error: "Hujjat sanasini kiriting" };

  const spec = HR_DOC_BY_KIND.get(d.kind);
  if (!spec) return { error: "Hujjat turi noma'lum" };
  if (spec.fields.includes("effectiveAt") && !d.effectiveAt) {
    return { error: isDismissalDoc(d.kind) ? "Bo'shatish sanasini kiriting" : "Ishga qabul sanasini kiriting" };
  }
  if (d.fixedTerm && d.termUntil && d.effectiveAt && d.termUntil < d.effectiveAt) {
    return { error: "Shartnoma muddati boshlanish sanasidan oldin tugay olmaydi" };
  }

  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { position: true } });
  if (!employee) return { error: "Xodim topilmadi" };

  const data = {
    kind: d.kind,
    docDate: d.docDate,
    effectiveAt: spec.fields.includes("effectiveAt") ? d.effectiveAt : null,
    position: spec.fields.includes("position") ? (d.position ?? employee.position) : null,
    salary: spec.fields.includes("salary") ? d.salary : null,
    fixedTerm: spec.fields.includes("term") ? d.fixedTerm : false,
    termUntil: spec.fields.includes("term") && d.fixedTerm ? d.termUntil : null,
    no: spec.fields.includes("no") ? d.no : null,
    reason: spec.fields.includes("reason") ? d.reason : null,
    article: spec.fields.includes("article") ? d.article : null,
  } satisfies Omit<Prisma.HrDocumentUncheckedCreateInput, "employeeId">;

  const err = await db.$transaction(async (tx) => {
    const dup = await orderNoProblem(tx, d.kind, data.no, data.docDate, d.docId ?? undefined);
    if (dup) return dup;
    if (d.docId) {
      const before = await tx.hrDocument.findUniqueOrThrow({ where: { id: d.docId } });
      if (before.employeeId !== employeeId) throw new Error("FORBIDDEN");
      const after = await tx.hrDocument.update({ where: { id: d.docId }, data });
      await audit(tx, s.userId, "UPDATE", "HrDocument", d.docId, before, after);
    } else {
      const created = await tx.hrDocument.create({ data: { ...data, employeeId, createdById: s.userId } });
      await audit(tx, s.userId, "CREATE", "HrDocument", created.id, undefined, created);
    }
    return null;
  });
  if (err) return { error: err };

  revalidatePath(`/employees/${employeeId}`);
  return { ok: true };
}

const bundleSchema = z.object({
  docDate: zDate,
  effectiveAt: zDate,
  position: zOpt,
  salary: z.string().trim().optional().transform((v) => {
    const n = Number(String(v ?? "").replace(/\s/g, ""));
    return v && Number.isFinite(n) && n > 0 ? n : null;
  }),
  fixedTerm: z.string().optional().transform((v) => v === "on"),
  termUntil: zDate,
  no: zOpt,
});

/**
 * Ishga qabul to'plami — bitta bosishda oltala hujjat (ariza, anketa, shartnoma, tilxat,
 * moddiy javobgarlik, buyruq) bir xil sana va lavozim bilan tayyorlanadi.
 * Allaqachon tayyorlangan turlar qayta yaratilmaydi — tegilmay qoladi.
 */
export async function prepareHiringSet(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const r = parseForm(bundleSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (!d.docDate) return { error: "Hujjat sanasini kiriting" };
  if (!d.effectiveAt) return { error: "Ishga qabul sanasini kiriting" };

  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { position: true } });
  if (!employee) return { error: "Xodim topilmadi" };
  const position = d.position ?? employee.position;

  const res = await db.$transaction(async (tx) => {
    // Ikki marta bosilsa (yoki ikki kadr birga) to'plam ikki barobar yaratilmasin: tekshiruv qulf ostida
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"hrdoc-set:" + employeeId}))`;
    const exists = new Set((await tx.hrDocument.findMany({ where: { employeeId }, select: { kind: true } })).map((x) => x.kind));
    const todo = HIRING_DOCS.filter((spec) => !exists.has(spec.kind));
    if (todo.length === 0) return { error: "Ishga qabul hujjatlari allaqachon tayyorlangan" };
    if (todo.some((spec) => spec.fields.includes("no"))) {
      const dup = await orderNoProblem(tx, "BUYRUQ", d.no, d.docDate!);
      if (dup) return { error: dup };
    }
    for (const spec of todo) {
      const created = await tx.hrDocument.create({
        data: {
          employeeId,
          kind: spec.kind,
          docDate: d.docDate!,
          effectiveAt: spec.fields.includes("effectiveAt") ? d.effectiveAt : null,
          position: spec.fields.includes("position") ? position : null,
          salary: spec.fields.includes("salary") ? d.salary : null,
          fixedTerm: spec.fields.includes("term") ? d.fixedTerm : false,
          termUntil: spec.fields.includes("term") && d.fixedTerm ? d.termUntil : null,
          no: spec.fields.includes("no") ? d.no : null,
          createdById: s.userId,
        },
      });
      await audit(tx, s.userId, "CREATE", "HrDocument", created.id, undefined, created);
    }
    return { count: todo.length };
  });
  if ("error" in res) return { error: res.error };

  revalidatePath(`/employees/${employeeId}`);
  return { ok: true, note: `${res.count} ta hujjat tayyorlandi` };
}

/** Imzolangan nusxani (skaner yoki telefon surati) hujjatga biriktirish. Eski nusxa almashadi. */
export async function uploadHrDocScan(docId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await hr();
  const before = await db.hrDocument.findUnique({ where: { id: docId } });
  if (!before) return { error: "Hujjat topilmadi" };

  const saved = await saveEmployeeFile(before.employeeId, fd.get("file"));
  if (!saved) return { error: "Fayl tanlanmagan" };
  if ("error" in saved) return { error: saved.error };

  try {
    // Almashtirilgan eski imzolangan nusxa diskda qoladi (hujjatlar o'chirilmaydi) — nomi auditda (`before.file`)
    await db.$transaction(async (tx) => {
      const x = await tx.hrDocument.update({
        where: { id: docId },
        data: { file: saved.stored, fileName: saved.name, fileType: saved.type, signedAt: new Date() },
      });
      await audit(tx, s.userId, "UPDATE", "HrDocument", docId, before, x);
    });
  } catch (err) {
    await removeEmployeeFile(saved.stored);
    throw err;
  }

  revalidatePath(`/employees/${before.employeeId}`);
  return { ok: true };
}

/**
 * Imzolangan nusxani hujjatdan ajratish — hujjat yozuvi qoladi, fayl diskda saqlanadi (hujjatlar o'chirilmaydi):
 * nomi auditda turadi, kerak bo'lsa qaytariladi.
 */
export async function deleteHrDocScan(docId: string): Promise<ActionState> {
  const s = await hr();
  const before = await db.hrDocument.findUnique({ where: { id: docId } });
  if (!before) return { error: "Hujjat topilmadi" };
  if (!before.file) return { error: "Bu hujjatda imzolangan nusxa yo'q" };
  await db.$transaction(async (tx) => {
    const after = await tx.hrDocument.update({
      where: { id: docId },
      data: { file: null, fileName: null, fileType: null, signedAt: null },
    });
    await audit(tx, s.userId, "UPDATE", "HrDocument", docId, before, after);
  });
  revalidatePath(`/employees/${before.employeeId}`);
  return { ok: true, note: "Nusxa olib tashlandi" };
}

/**
 * Tayyorlangan, hali imzolanmagan hujjat qoralamasini o'chirish. Imzolangan hujjat (shartnoma, buyruq) o'chirilmaydi —
 * u kuchga kirgan hujjat; xato bo'lsa yangisi tayyorlanadi.
 */
export async function deleteHrDoc(docId: string): Promise<ActionState> {
  const s = await hr();
  const before = await db.hrDocument.findUnique({ where: { id: docId } });
  if (!before) return { error: "Hujjat topilmadi" };
  if (before.file || before.signedAt) return { error: "Imzolangan hujjat o'chirilmaydi — xato bo'lsa yangisini tayyorlang" };
  const n = await db.$transaction(async (tx) => {
    // Shu orada imzolangan nusxa yuklangan bo'lsa — o'chirilmaydi
    const del = await tx.hrDocument.deleteMany({ where: { id: docId, file: null, signedAt: null } });
    if (del.count) await audit(tx, s.userId, "DELETE", "HrDocument", docId, before, undefined);
    return del.count;
  });
  if (!n) return { error: "Imzolangan hujjat o'chirilmaydi — xato bo'lsa yangisini tayyorlang" };
  revalidatePath(`/employees/${before.employeeId}`);
  return { ok: true };
}
