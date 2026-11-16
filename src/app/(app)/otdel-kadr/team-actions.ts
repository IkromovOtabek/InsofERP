"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zOpt, zStr, type ActionState } from "@/lib/action";

/*
 * Otdel kadr → «Komanda va brigadalar»: komanda (svarshiklar va h.k.) — ishlab chiqarish brigadasidan alohida,
 * faqat tarkib, brigadir va kassa hisob-kitobi (Kirim-Chiqim → «Hodimlar bilan hisob-kitob»). Har amal AuditLog'da.
 */

const teamSchema = z.object({
  name: zStr("Komanda nomini yozing").pipe(z.string().max(80, "Nom 80 belgidan oshmasin")),
  leaderId: zOpt,
  phone: zOpt.pipe(z.string().max(40).nullable()),
  note: zOpt.pipe(z.string().max(300, "Izoh 300 belgidan oshmasin").nullable()),
});

export async function saveTeam(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "teams", ["HR"]);
  const r = parseForm(teamSchema, fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const memberIds = [...new Set(fd.getAll("memberIds").map(String).filter(Boolean))];
  const leaderId = r.data.leaderId;
  // Brigadir ham komanda a'zosi bo'ladi
  if (leaderId && !memberIds.includes(leaderId)) memberIds.push(leaderId);
  const dup = await db.team.findFirst({ where: { name: { equals: r.data.name, mode: "insensitive" }, ...(id && { id: { not: id } }) }, select: { id: true } });
  if (dup) return { error: `«${r.data.name}» nomli komanda bor`, field: "name" };
  if (memberIds.length) {
    const n = await db.employee.count({ where: { id: { in: memberIds } } });
    if (n !== memberIds.length) return { error: "Tanlangan xodimlardan biri topilmadi" };
  }
  await db.$transaction(async (tx) => {
    const before = id ? await tx.team.findUnique({ where: { id }, include: { members: { select: { id: true } } } }) : null;
    if (id && !before) throw new Error("Komanda topilmadi");
    const data = { name: r.data.name, leaderId, phone: r.data.phone, note: r.data.note };
    const t = id ? await tx.team.update({ where: { id }, data }) : await tx.team.create({ data });
    await tx.employee.updateMany({ where: { teamId: t.id, id: { notIn: memberIds } }, data: { teamId: null } });
    if (memberIds.length) await tx.employee.updateMany({ where: { id: { in: memberIds } }, data: { teamId: t.id } });
    await audit(tx, s.userId, id ? "UPDATE" : "CREATE", "Team", t.id, before ?? undefined, { ...t, memberIds });
  });
  revalidatePath("/otdel-kadr");
  return { ok: true, note: id ? "Komanda saqlandi" : `«${r.data.name}» komandasi ochildi` };
}

/** Komandani yopish / qayta ochish (o'chirilmaydi — kassa yozuvlari unga bog'langan bo'lishi mumkin). */
export async function setTeamActive(id: string, isActive: boolean): Promise<ActionState> {
  const s = await requireAction("employees", "teams", ["HR"]);
  const r = await db.team.updateMany({ where: { id, isActive: !isActive }, data: { isActive } });
  if (!r.count) return { error: "Komanda topilmadi yoki holati allaqachon o'zgargan" };
  await audit(db, s.userId, "STATUS_CHANGE", "Team", id, { isActive: !isActive }, { isActive });
  revalidatePath("/otdel-kadr");
  return { ok: true };
}
