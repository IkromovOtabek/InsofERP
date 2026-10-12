import { db } from "./db";
import { audit } from "./audit";
import { parsePerms, revokeSessions, type Perms } from "./auth";
import { MODULES } from "./nav";
import { actionDef, delegableActions } from "./permissions";
import { notifyAfter, notifyUsers } from "./notify";
import { LOGIN_ROLE_OPTIONS, POSITIONS, roleForPosition } from "./positions";
import { Prisma, type Role } from "@/generated/prisma";

/**
 * Ruxsat shablonlari — direktor xodim(lar)ga modul ruxsatlarini (va kerak bo'lsa asosiy bo'limni) beradi.
 * Shablon = ishchi lavozimning login sozlamasi (`WorkPosition.loginRole` + `perms`) yoki "rol bo'yicha" (qo'shimcha
 * ruxsatsiz). Bitta xodim (Ruxsatlar), bir nechta xodim birdan va lavozim shablonini saqlash — hammasi shu yerdan.
 *
 * Qoidalar: DIRECTOR/SUPERADMIN hisobiga tegilmaydi va hech kimga DIRECTOR roli berilmaydi; rol o'zgarsa
 * xodimning sessiyalari tugaydi (token ichida rol bor — middleware yo'l ruxsatini shundan oladi), faqat
 * ruxsat o'zgarsa qayta kirish shart emas (perms har so'rovda bazadan o'qiladi). Har o'zgarish AuditLog'da.
 */

/** Shablon bera oladigan asosiy bo'limlar — login bo'limlari, direktordan tashqari. */
export const TEMPLATE_ROLE_OPTIONS = LOGIN_ROLE_OPTIONS.filter((o) => o.value !== "DIRECTOR");
export const isTemplateRole = (v: unknown): v is Role => typeof v === "string" && TEMPLATE_ROLE_OPTIONS.some((o) => o.value === v);
export const templateRoleLabel = (r: Role) => TEMPLATE_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

const MODULE_KEYS = new Set(MODULES.map((m) => m.key));

/** Ruxsatlarni o'qiladigan matnga — audit va bildirishnoma uchun ("Zayavkalar: ochish, qabul qilish"). */
export function describePerms(p: Perms): string[] {
  return Object.entries(p).map(([m, v]) => {
    const label = MODULES.find((x) => x.key === m)?.label ?? m;
    if (Array.isArray(v)) {
      const names = v.map((a) => actionDef(m, a)?.label ?? a);
      return `${label}: ko'rish${names.length ? " + " + names.join(", ") : ""}`;
    }
    return `${label}: ${v === "none" ? "yopiq" : v === "view" ? "faqat ko'rish" : "to'liq"}`;
  });
}

/**
 * Ruxsatlar matritsasi formasi (`PermsMatrix`): har modul uchun `perm.<modul>` = "" (rol bo'yicha) | none | view | custom | write;
 * "custom" bo'lsa `act.<modul>` — belgilangan amallar (faqat katalogdagi, topshiriladiganlari qabul qilinadi).
 */
export function permsFromForm(fd: FormData): Perms {
  const perms: Perms = {};
  for (const m of MODULES) {
    if (!MODULE_KEYS.has(m.key)) continue;
    const v = String(fd.get(`perm.${m.key}`) ?? "").trim();
    if (v === "none" || v === "view" || v === "write") perms[m.key] = v;
    else if (v === "custom") {
      const allowed = new Set(delegableActions(m.key).map((a) => a.key));
      const acts = [...new Set(fd.getAll(`act.${m.key}`).map(String).filter((a) => allowed.has(a)))];
      // Birorta amal belgilanmagan "tanlangan amallar" — amalda "faqat ko'rish"
      perms[m.key] = acts.length ? acts : "view";
    }
  }
  return perms;
}

/** Taqqoslash kaliti: bazadagi jsonb kalitlar tartibini o'zgartiradi — tartibsiz solishtiriladi. */
const permsKey = (p: Perms) => JSON.stringify(Object.keys(p).sort().map((k) => [k, Array.isArray(p[k]) ? [...(p[k] as string[])].sort() : p[k]]));

export type AccessTarget = { id: string; fullName: string; role: Role; perms: unknown };
export type AccessResult = "changed" | "same" | "skipped";

/**
 * Bitta foydalanuvchiga ruxsat (va ixtiyoriy asosiy bo'lim) beradi. `next.perms` bo'sh — "rol bo'yicha" (ustun tozalanadi).
 * `next.role` berilsa va farq qilsa — rol almashadi, sessiyalar tugaydi; xodim kartasidagi lavozim bo'lim lavozimi
 * bo'lsa (Sotuv, Sklad…) u ham yangi bo'lim nomiga o'tadi ("Bo'limni almashtirish" bilan bir xil qoida).
 */
export async function applyAccess(actorId: string, target: AccessTarget, next: { perms: Perms; role?: Role | null }, via: string): Promise<AccessResult> {
  if (target.role === "DIRECTOR" || target.role === "SUPERADMIN") return "skipped";
  const role = next.role && isTemplateRole(next.role) ? next.role : target.role;
  const before = parsePerms(target.perms) ?? {};
  const after = Object.keys(next.perms).length ? next.perms : null;
  const permsChanged = permsKey(before) !== permsKey(after ?? {});
  const roleChanged = role !== target.role;
  if (!permsChanged && !roleChanged) return "same";

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { ...(permsChanged ? { perms: after ?? Prisma.DbNull } : {}), ...(roleChanged ? { role } : {}) },
    });
    let position: { from: string; to: string } | undefined;
    if (roleChanged) {
      await revokeSessions(tx, target.id);
      const emp = await tx.employee.findFirst({ where: { userId: target.id }, select: { id: true, position: true } });
      const dept = POSITIONS.find((p) => p.role === role);
      if (emp && dept && roleForPosition(emp.position) && emp.position !== dept.label) {
        await tx.employee.update({ where: { id: emp.id }, data: { position: dept.label } });
        position = { from: emp.position, to: dept.label };
      }
    }
    await audit(tx, actorId, "UPDATE", "User", target.id,
      { ...(roleChanged ? { role: target.role } : {}), perms: before, ruxsat: describePerms(before), ...(position ? { position: position.from } : {}) },
      { ...(roleChanged ? { role } : {}), perms: after ?? {}, ruxsat: describePerms(after ?? {}), ...(position ? { position: position.to } : {}), xodim: target.fullName, via },
    );
  });
  notifyAfter(() => notifyUsers([target.id], {
    type: "PERMS_CHANGED",
    title: roleChanged ? "Bo'limingiz va ruxsatlaringiz yangilandi" : "Ruxsatlaringiz yangilandi",
    body: [
      roleChanged ? `Asosiy bo'lim: ${templateRoleLabel(role)} — tizimga qayta kiring` : "",
      after ? describePerms(after).join(" · ") : "Ruxsatlar rol bo'yicha holatga qaytarildi",
    ].filter(Boolean).join(" · ").slice(0, 300),
  }));
  return "changed";
}

/** Bir nechta foydalanuvchiga birdan. Direktor/superadmin o'tkazib yuboriladi (ismi `skipped` da). */
export async function applyAccessMany(actorId: string, ids: string[], next: { perms: Perms; role?: Role | null }, via: string) {
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true, role: true, perms: true } });
  let changed = 0, same = 0;
  const skipped: string[] = [];
  for (const u of users) {
    const r = await applyAccess(actorId, u, next, via);
    if (r === "changed") changed++;
    else if (r === "same") same++;
    else skipped.push(u.fullName);
  }
  return { found: users.length, changed, same, skipped };
}

/** Lavozim shabloni — formaga va bulk tanloviga: login roli va ruxsatlari bor ishchi lavozimlar. */
export async function positionTemplates() {
  const rows = await db.workPosition.findMany({
    where: { isActive: true, OR: [{ loginRole: { not: null } }, { perms: { not: Prisma.DbNull } }] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, loginRole: true, perms: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, loginRole: r.loginRole && isTemplateRole(r.loginRole) ? r.loginRole : null, perms: parsePerms(r.perms) ?? {} }));
}

/**
 * Lavozim nomi bo'yicha login shabloni (login ochishda): lavozim tizimga kiradigan ishchi lavozim bo'lsa
 * uning asosiy bo'limi va ruxsatlari, aks holda `null`.
 */
export async function loginTemplateFor(position: string): Promise<{ role: Role; perms: Perms | undefined } | null> {
  const name = position.trim();
  if (!name) return null;
  const p = await db.workPosition.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, isActive: true, loginRole: { not: null } },
    select: { loginRole: true, perms: true },
  });
  if (!p?.loginRole || !isTemplateRole(p.loginRole)) return null;
  return { role: p.loginRole, perms: parsePerms(p.perms) };
}
