import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Brigadir biriktirish — yagona joy (veb "Brigadalar" sahifasi ham, mobil "Xodimlar" ham).
 *
 * Qoida: brigadir — Xodimlar ro'yxatidagi odam; bitta xodim bir vaqtda bitta brigadaga
 * brigadir bo'ladi (yangisiga biriktirilsa eskisidan olinadi), bitta brigadaning esa
 * bitta brigadiri bo'ladi (boshqasi turgan bo'lsa almashtiriladi — javobda aytiladi).
 *
 * Sessiya/ruxsat tekshiruvi va `revalidatePath` — chaqiruvchida.
 */
export type LeaderResult = {
  brigadeId?: string;
  /** Biriktirilgan brigada nomi. */
  brigadeName?: string;
  /** Brigada shu amalda yangi ochildimi. */
  created?: boolean;
  /** Almashtirilgan eski brigadir (bo'lsa). */
  replaced?: string | null;
  /** Xodim brigadirlikdan olingan eski brigada (bo'lsa). */
  freed?: string | null;
  error?: string;
};

type Assign = {
  employeeId: string;
  /** Mavjud brigada — yoki `newBrigade` beriladi. */
  brigadeId?: string;
  newBrigade?: { name: string; phone?: string | null; note?: string | null };
};

export async function setBrigadeLeader(input: Assign, userId: string): Promise<LeaderResult> {
  const emp = await db.employee.findUnique({ where: { id: input.employeeId }, include: { brigades: true } });
  if (!emp) return { error: "Xodim topilmadi" };
  if (!emp.isActive) return { error: "Nofaol xodim brigadir bo'lmaydi" };

  const name = input.newBrigade?.name?.trim();
  if (!input.brigadeId && !name) return { error: "Brigada tanlanmagan" };

  // Mavjud brigada — faol bo'lsin; yangisi — nomi takrorlanmasin
  const target = input.brigadeId
    ? await db.brigade.findUnique({ where: { id: input.brigadeId }, include: { leader: true } })
    : null;
  if (input.brigadeId && !target) return { error: "Brigada topilmadi" };
  if (target && !target.isActive) return { error: "Brigada nofaol — avval yoqing" };
  if (!target) {
    const dup = await db.brigade.findFirst({ where: { name: { equals: name!, mode: "insensitive" } } });
    if (dup) return { error: `"${dup.name}" nomli brigada allaqachon bor — ro'yxatdan tanlang` };
  }
  if (target?.leaderId === emp.id) return { error: `${emp.fullName} allaqachon ${target.name} brigadiri` };

  // Xodim boshqa brigadada brigadir bo'lsa — o'sha bo'shaydi (bitta odam bitta brigadaga)
  const old = emp.brigades.filter((b) => b.id !== target?.id);

  const res = await db.$transaction(async (tx) => {
    const brigade = target
      ? await tx.brigade.update({ where: { id: target.id }, data: { leaderId: emp.id } })
      : await tx.brigade.create({
          data: {
            name: name!,
            leaderId: emp.id,
            phone: input.newBrigade?.phone?.trim() || emp.phone || undefined,
            note: input.newBrigade?.note?.trim() || undefined,
          },
        });
    if (target) await audit(tx, userId, "UPDATE", "Brigade", brigade.id, { leaderId: target.leaderId }, { leaderId: emp.id });
    else await audit(tx, userId, "CREATE", "Brigade", brigade.id, undefined, brigade);

    for (const b of old) {
      await tx.brigade.update({ where: { id: b.id }, data: { leaderId: null } });
      await audit(tx, userId, "UPDATE", "Brigade", b.id, { leaderId: emp.id }, { leaderId: null });
    }
    return brigade;
  });

  return {
    brigadeId: res.id,
    brigadeName: res.name,
    created: !target,
    replaced: target?.leader && target.leader.id !== emp.id ? target.leader.fullName : null,
    freed: old.map((b) => b.name).join(", ") || null,
  };
}

/** Xodimni brigadirlikdan olish — brigada o'chmaydi, faqat brigadirsiz qoladi. */
export async function clearBrigadeLeader(employeeId: string, userId: string, brigadeId?: string): Promise<LeaderResult> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, include: { brigades: true } });
  if (!emp) return { error: "Xodim topilmadi" };
  const list = brigadeId ? emp.brigades.filter((b) => b.id === brigadeId) : emp.brigades;
  if (list.length === 0) return { error: "Bu xodim brigadir emas" };

  await db.$transaction(async (tx) => {
    for (const b of list) {
      await tx.brigade.update({ where: { id: b.id }, data: { leaderId: null } });
      await audit(tx, userId, "UPDATE", "Brigade", b.id, { leaderId: emp.id }, { leaderId: null });
    }
  });
  return { freed: list.map((b) => b.name).join(", ") };
}

/** Brigadir tanlash ro'yxati uchun — faol brigadalar, brigadiri bilan. */
export const activeBrigades = () =>
  db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { leader: true } });
