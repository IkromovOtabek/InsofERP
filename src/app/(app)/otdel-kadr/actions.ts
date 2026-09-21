"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { POSITIONS, roleForPosition, isDriverPosition } from "@/lib/positions";
import { pushEmployeeSilently } from "@/lib/eco/people";
import { kindFromField, OTHER_DOC_KIND } from "@/lib/kadr";
import { saveEmployeeFile, removeEmployeeFile } from "@/lib/uploads";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

/** Ishchi lavozimlarni faqat otdel kadr (va direktor) yuritadi. */
const hr = () => requireSession(["HR"]);

const schema = z.object({
  name: zStr("Lavozim nomi kerak"),
  note: zOpt,
  isDriver: z.string().optional().transform((v) => v === "on"),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

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
  const photo = await saveEmployeeFile(id, fd.get("photo"), { imageOnly: true });
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
