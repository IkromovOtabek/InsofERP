import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { DEFAULT_SHIFT, dayUtc, markOf, shiftProblem, toMinutes, today } from "@/lib/davomat";
import type { AttendanceStatus } from "@/generated/prisma";

/**
 * Sex (ishlab chiqarish) tarkibi va uning davomati — veb bosh sahifa, kunlik hisobot va
 * mobil "Sex" ekrani shu bitta joydan o'qiydi.
 *
 * Kim sex xodimi:
 *   · direktor biror ishlab chiqarish brigadasiga taqsimlagan xodim (`Employee.brigadeId`);
 *   · brigadir (brigadaning `leaderId` si);
 *   · lavozimi ishlab chiqarish bo'limiga tegishli — "Ishlab chiqarish", "Ish boshqaruvchi",
 *     "Brigadir" yoki `WorkPosition.department` = PRODUCTION/SUPERVISOR (Operator, Betonchi...).
 * Oxirgi guruhdan brigadaga biriktirilmaganlari — "taqsimlanmagan": direktor ularni brigadaga beradi.
 */

const DEPT_LABELS = ["ishlab chiqarish", "ish boshqaruvchi", "brigadir"];
const PROD_DEPTS = ["PRODUCTION", "SUPERVISOR", "BRIGADIER"];
export const UNASSIGNED = "Taqsimlanmagan";

export type StaffMember = {
  id: string; fullName: string; position: string; phone: string | null;
  brigadeId: string | null; brigade: string | null; leads: boolean;
  status: AttendanceStatus | null; checkIn: string | null; checkOut: string | null; note: string | null;
};

const norm = (s: string) => s.trim().toLowerCase();

/** Ishlab chiqarish bo'limiga tegishli lavozim nomlari (kichik harfda). */
async function productionPositions() {
  const work = await db.workPosition.findMany({ where: { department: { in: PROD_DEPTS } }, select: { name: true } });
  return new Set([...DEPT_LABELS, ...work.map((w) => norm(w.name))]);
}

/** Sex xodimlari va tanlangan kundagi davomati (standart — bugun). Tartib: brigada, keyin ism. */
export async function productionStaff(iso = today()) {
  const [positions, employees, brigades, attendance] = await Promise.all([
    productionPositions(),
    db.employee.findMany({
      where: { isActive: true, firedAt: null },
      select: { id: true, fullName: true, position: true, phone: true, brigadeId: true, brigades: { where: { isActive: true }, select: { id: true } } },
      orderBy: { fullName: "asc" },
    }),
    db.brigade.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.attendance.findMany({ where: { date: dayUtc(iso) }, select: { employeeId: true, status: true, checkIn: true, checkOut: true, note: true } }),
  ]);
  const brigadeName = new Map(brigades.map((b) => [b.id, b.name]));
  const att = new Map(attendance.map((a) => [a.employeeId, a]));

  const members: StaffMember[] = employees
    .filter((e) => (e.brigadeId && brigadeName.has(e.brigadeId)) || e.brigades.length > 0 || positions.has(norm(e.position)))
    .map((e) => {
      // Brigadir o'zi boshqaradigan brigadada sanaladi, agar direktor boshqasiga bermagan bo'lsa
      const bid = e.brigadeId && brigadeName.has(e.brigadeId) ? e.brigadeId : e.brigades[0]?.id ?? null;
      const a = att.get(e.id);
      return {
        id: e.id, fullName: e.fullName, position: e.position, phone: e.phone,
        brigadeId: bid, brigade: bid ? brigadeName.get(bid)! : null, leads: e.brigades.length > 0,
        status: a?.status ?? null, checkIn: a?.checkIn ?? null, checkOut: a?.checkOut ?? null, note: a?.note ?? null,
      };
    })
    .sort((a, b) => (a.brigade ?? "￿").localeCompare(b.brigade ?? "￿") || Number(b.leads) - Number(a.leads) || a.fullName.localeCompare(b.fullName));

  const cnt = (st: AttendanceStatus) => members.filter((m) => m.status === st).length;
  const groups = [...brigades.map((b) => ({ id: b.id as string | null, name: b.name })), { id: null, name: UNASSIGNED }]
    .map((g) => {
      const list = members.filter((m) => m.brigadeId === g.id);
      return { ...g, members: list, total: list.length, present: list.filter((m) => m.status === "PRESENT").length };
    })
    .filter((g) => g.total > 0 || g.id !== null);

  return {
    iso,
    members,
    groups,
    brigades,
    total: members.length,
    present: cnt("PRESENT"),
    absent: cnt("ABSENT"),
    sick: cnt("SICK"),
    leave: cnt("LEAVE"),
    dayoff: cnt("DAYOFF"),
    notMarked: members.filter((m) => !m.status).length,
    unassigned: members.filter((m) => !m.brigadeId).length,
  };
}
export type ProductionStaff = Awaited<ReturnType<typeof productionStaff>>;

/** Hozirgi soat "HH:MM" (server mahalliy vaqti). */
export const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

type Mark = {
  status: AttendanceStatus; checkIn?: string | null; checkOut?: string | null; note?: string | null;
  /** "Keldi" yuz bilan tasdiqlangan — kadr fayli (`uploads/employees/`). Qo'lda belgilashda berilmaydi va o'zgarmaydi. */
  facePhoto?: string;
};

/**
 * Sex davomatini belgilash — ishlab chiqarish boshlig'i faqat o'z sexining xodimini belgilaydi
 * (otdel kadr tabelidagi yozuvning aynan o'zi: `employeeId + date`).
 * Soat faqat "Keldi" da saqlanadi; kelgan soati berilmasa — hozirgi vaqt.
 */
export async function markProductionAttendance(userId: string, employeeId: string, m: Mark, iso = today()): Promise<{ error: string } | { ok: true; text: string }> {
  const staff = await productionStaff(iso);
  const e = staff.members.find((x) => x.id === employeeId);
  if (!e) return { error: "Xodim sex tarkibida emas — direktor avval brigadaga taqsimlashi kerak" };
  const present = m.status === "PRESENT";
  const checkIn = present ? (m.checkIn?.trim() || e.checkIn || nowHHMM()) : null;
  const checkOut = present ? (m.checkOut === undefined ? e.checkOut : m.checkOut?.trim() || null) : null;
  if (checkIn && toMinutes(checkIn) === null) return { error: "Kelgan vaqt noto'g'ri — SS:DD ko'rinishida yozing" };
  if (checkOut && toMinutes(checkOut) === null) return { error: "Ketgan vaqt noto'g'ri — SS:DD ko'rinishida yozing" };
  const tooLong = shiftProblem(checkIn, checkOut);
  if (tooLong) return { error: `${e.fullName}: ${tooLong}` };
  const date = dayUtc(iso);
  const data = {
    status: m.status, checkIn, checkOut, note: m.note === undefined ? e.note : m.note?.trim() || null, markedById: userId,
    ...(m.facePhoto ? { facePhoto: m.facePhoto, faceVerifiedAt: new Date() } : {}),
  };
  await db.$transaction(async (tx) => {
    const a = await tx.attendance.upsert({ where: { employeeId_date: { employeeId, date } }, create: { employeeId, date, ...data }, update: data });
    await audit(tx, userId, "UPDATE", "Attendance", a.id, e.status ? { status: e.status, checkIn: e.checkIn, checkOut: e.checkOut } : undefined, { xodim: e.fullName, ...data, ...(m.facePhoto ? { yuz: "tasdiqlandi" } : {}) });
  });
  return { ok: true, text: `${e.fullName} — ${markOf(m.status).label.toLowerCase()}${checkIn ? ` ${checkIn}` : ""}${checkOut ? `–${checkOut}` : ""}` };
}

/**
 * "Keldi" — yuz bilan (mobil `att.face`). Kamera kadri xodimning profil surati bilan solishtiriladi
 * (`lib/ai/face.ts`); mos kelsa kadr saqlanib davomat yoziladi, aks holda hech narsa yozilmaydi —
 * faqat auditda urinish qoladi (kim, kimni, nima sababdan o'tmadi).
 */
export async function markAttendanceByFace(userId: string, employeeId: string, photo: File, iso = today()): Promise<{ error: string } | { ok: true; text: string; confidence: number }> {
  const { faceCheckEnabled, compareFaces } = await import("@/lib/ai/face");
  const { employeeFilePath, saveEmployeeFile } = await import("@/lib/uploads");
  const { readFile } = await import("fs/promises");
  if (!faceCheckEnabled()) return { error: "Yuz tekshiruvi sozlanmagan (AI kaliti yo'q) — davomatni sex boshlig'i qo'lda belgilaydi" };
  const staff = await productionStaff(iso);
  const e = staff.members.find((x) => x.id === employeeId);
  if (!e) return { error: "Xodim sex tarkibida emas — direktor avval brigadaga taqsimlashi kerak" };
  if (e.status === "PRESENT") return { error: `${e.fullName} bugun allaqachon "Keldi" deb belgilangan` };
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { photo: true } });
  const refPath = emp?.photo ? employeeFilePath(emp.photo) : null;
  if (!refPath) return { error: `${e.fullName} ning profil surati yo'q — otdel kadr avval kartasiga rasm yuklaydi` };
  let reference: Buffer;
  try { reference = await readFile(refPath); } catch { return { error: "Profil surati diskda topilmadi — otdel kadr qayta yuklasin" }; }
  const probe = Buffer.from(await photo.arrayBuffer());

  let r: Awaited<ReturnType<typeof compareFaces>>;
  try { r = await compareFaces(reference, probe); } catch (err) {
    // Provayder xatosi (limit, tarmoq) — ichki matn (org id, URL) ilovaga chiqmasin
    const msg = (err as Error).message ?? "";
    console.error("[face] tekshiruv xatosi:", msg);
    return { error: /rate limit/i.test(msg) ? "AI tekshiruvi band (bepul tarif limiti) — bir daqiqadan keyin qayta urining" : "Yuz tekshiruvi vaqtincha ishlamadi — qayta urining yoki sex boshlig'i qo'lda belgilasin" };
  }
  if (!r.match) {
    await audit(db, userId, "UPDATE", "Attendance", employeeId, undefined, { xodim: e.fullName, yuz: "tasdiqlanmadi", ishonch: r.confidence, sabab: r.reason });
    return { error: `Yuz tasdiqlanmadi (${r.confidence}%): ${r.reason}` };
  }
  const saved = await saveEmployeeFile(employeeId, photo, { imageOnly: true });
  if (!saved || "error" in saved) return { error: saved?.error ?? "Kadr saqlanmadi" };
  const m = await markProductionAttendance(userId, employeeId, { status: "PRESENT", facePhoto: saved.stored }, iso);
  if ("error" in m) return m;
  return { ok: true, text: `${m.text} · yuz tasdiqlandi (${r.confidence}%)`, confidence: r.confidence };
}

/** Ketgan vaqtini qo'yish (faqat kelgan xodimga). */
export async function markProductionCheckout(userId: string, employeeId: string, at = nowHHMM(), iso = today()) {
  const staff = await productionStaff(iso);
  const e = staff.members.find((x) => x.id === employeeId);
  if (!e) return { error: "Xodim sex tarkibida emas" } as const;
  if (e.status !== "PRESENT") return { error: "Avval \"Keldi\" deb belgilang" } as const;
  return markProductionAttendance(userId, employeeId, { status: "PRESENT", checkIn: e.checkIn, checkOut: at }, iso);
}

/** Belgilanmagan sex xodimlarini (yoki faqat berilgan brigadalarnikini) "Keldi" qilish — kelgan vaqti hozir (yoki smena boshi, agar undan oldin bo'lsa). */
export async function markAllPresent(userId: string, iso = today(), brigadeIds?: string[]) {
  const staff = await productionStaff(iso);
  // Brigadir faqat o'z brigadasini belgilaydi
  const left = staff.members.filter((m) => !m.status && (!brigadeIds || (m.brigadeId != null && brigadeIds.includes(m.brigadeId))));
  if (!left.length) return { ok: true, count: 0 } as const;
  const now = nowHHMM();
  const checkIn = iso === today() ? ((toMinutes(now) ?? 0) < (toMinutes(DEFAULT_SHIFT.checkIn) ?? 0) ? DEFAULT_SHIFT.checkIn : now) : DEFAULT_SHIFT.checkIn;
  const date = dayUtc(iso);
  await db.$transaction(async (tx) => {
    for (const m of left) {
      await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: m.id, date } },
        create: { employeeId: m.id, date, status: "PRESENT", checkIn, markedById: userId },
        update: { status: "PRESENT", checkIn, markedById: userId },
      });
    }
    await audit(tx, userId, "UPDATE", "Attendance", iso, undefined, { sex: "hammasi keldi", soni: left.length, checkIn });
  });
  return { ok: true, count: left.length } as const;
}

/** Direktor: xodimni sex brigadasiga biriktiradi (null — sexdan chiqaradi / taqsimlanmagan). */
export async function assignEmployeeBrigade(userId: string, employeeId: string, brigadeId: string | null) {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, brigadeId: true, isActive: true } });
  if (!e || !e.isActive) return { error: "Xodim topilmadi" } as const;
  if (brigadeId && !(await db.brigade.findFirst({ where: { id: brigadeId, isActive: true }, select: { id: true } }))) return { error: "Brigada topilmadi" } as const;
  if (e.brigadeId === brigadeId) return { ok: true } as const;
  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data: { brigadeId } });
    await audit(tx, userId, "UPDATE", "Employee", employeeId, { brigadeId: e.brigadeId }, { brigadeId, xodim: e.fullName });
  });
  return { ok: true } as const;
}
