"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { requireAdmin } from "@/lib/control/auth";
import { control } from "@/lib/control/db";
import { logEvent } from "@/lib/control/events";
import { provisionTenant, setDirector, setSuspended } from "@/lib/control/provision";
import { collectAll, collectStats } from "@/lib/control/stats";
import { passwordProblem } from "@/lib/password-policy";
import { clientIp } from "@/lib/login-guard";
import { verifyReauth } from "@/lib/control/reauth";
import type { ActionState } from "@/lib/action";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;

async function tenantBySlug(slug: string) {
  const t = await control.tenant.findUnique({ where: { slug } });
  if (!t) throw new Error("Korxona topilmadi");
  return t;
}

/** 1-talab: yangi korxona + uning direktoriga login/parol. */
export async function createTenantAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await requireAdmin();
  let slug = "";
  try {
    const r = await provisionTenant({
      slug: str(fd, "slug").toLowerCase(), name: str(fd, "name"), domain: opt(fd, "domain")?.toLowerCase() ?? null,
      plan: str(fd, "plan") || "standard", contactName: opt(fd, "contactName"), contactPhone: opt(fd, "contactPhone"),
      note: opt(fd, "note"), ecoApiUrl: opt(fd, "ecoApiUrl"),
      director: { fullName: str(fd, "directorName"), login: str(fd, "directorLogin"), password: String(fd.get("directorPassword") ?? "") },
    });
    slug = r.tenant.slug;
    await logEvent(a.id, "TENANT_CREATE", r.tenant.id, { slug, name: r.tenant.name, port: r.tenant.port, db: r.tenant.dbName, director: r.tenant.directorLogin, envFile: r.envFile });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/superadmin");
  redirect(`/superadmin/korxonalar/${slug}?yangi=1`);
}

export async function updateTenantAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await requireAdmin();
  const t = await tenantBySlug(slug);
  const domain = opt(fd, "domain")?.toLowerCase() ?? null;
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { error: "Domen noto'g'ri" };
  const data = {
    name: str(fd, "name") || t.name, domain, plan: str(fd, "plan") || t.plan,
    contactName: opt(fd, "contactName"), contactPhone: opt(fd, "contactPhone"), note: opt(fd, "note"), ecoApiUrl: opt(fd, "ecoApiUrl"),
  };
  try {
    await control.tenant.update({ where: { id: t.id }, data });
  } catch (e) {
    return { error: String(e).includes("Unique") ? "Bu domen boshqa korxonaga ulangan" : (e as Error).message };
  }
  await logEvent(a.id, "TENANT_UPDATE", t.id, { before: { name: t.name, domain: t.domain, plan: t.plan, ecoApiUrl: t.ecoApiUrl }, after: data });
  revalidatePath(`/superadmin/korxonalar/${slug}`);
  return { ok: true };
}

/** Direktorga login/parol berish yoki tiklash (eski sessiyalari kuyadi). Parol jurnalga yozilmaydi. */
export async function setDirectorAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await requireAdmin();
  const t = await tenantBySlug(slug);
  const d = { fullName: str(fd, "fullName"), login: str(fd, "login"), password: String(fd.get("password") ?? "") };
  if (d.fullName.length < 3) return { error: "F.I.O. kerak" };
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(d.login)) return { error: "Login: 3–40 belgi, lotin harf, raqam, nuqta, chiziqcha" };
  try {
    const r = await setDirector(t.dbName, d);
    await control.tenant.update({ where: { id: t.id }, data: { directorLogin: d.login } });
    await logEvent(a.id, "DIRECTOR_SET", t.id, { login: d.login, fullName: d.fullName, created: r.created });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/superadmin/korxonalar/${slug}`);
  return { ok: true, note: "Direktor login/paroli saqlandi. Uni direktorga xavfsiz yo'l bilan bering." };
}

export async function suspendTenantAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await requireAdmin();
  const t = await tenantBySlug(slug);
  const reason = str(fd, "reason");
  if (reason.length < 3) return { error: "Sababini yozing (korxona xodimlari shuni ko'rmaydi, jurnal uchun)" };
  try { await setSuspended(t.dbName, true, reason); } catch (e) { return { error: `Korxona bazasiga yozilmadi: ${(e as Error).message}` }; }
  await control.tenant.update({ where: { id: t.id }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendReason: reason } });
  await logEvent(a.id, "TENANT_SUSPEND", t.id, { reason });
  revalidatePath(`/superadmin/korxonalar/${slug}`); revalidatePath("/superadmin");
  return { ok: true };
}

export async function resumeTenantAction(slug: string): Promise<void> {
  const a = await requireAdmin();
  const t = await tenantBySlug(slug);
  await setSuspended(t.dbName, false);
  await control.tenant.update({ where: { id: t.id }, data: { status: "ACTIVE", suspendedAt: null, suspendReason: null } });
  await logEvent(a.id, "TENANT_RESUME", t.id);
  revalidatePath(`/superadmin/korxonalar/${slug}`); revalidatePath("/superadmin");
}

export async function refreshStatsAction(slug?: string): Promise<void> {
  await requireAdmin();
  if (slug) await collectStats(await tenantBySlug(slug));
  else await collectAll();
  revalidatePath("/superadmin");
  if (slug) revalidatePath(`/superadmin/korxonalar/${slug}`);
}

/* ───────── IT jamoasi (superadminlar) ───────── */

export async function createAdminAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await requireAdmin();
  const login = str(fd, "login").toLowerCase();
  const fullName = str(fd, "fullName");
  const password = String(fd.get("password") ?? "");
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) return { error: "Login: 3–40 belgi, lotin kichik harf, raqam, nuqta, chiziqcha" };
  if (fullName.length < 3) return { error: "F.I.O. kerak" };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  try {
    const n = await control.superAdmin.create({ data: { login, fullName, passwordHash: await bcrypt.hash(password, 10) } });
    await logEvent(a.id, "ADMIN_CREATE", null, { login, fullName, id: n.id });
  } catch (e) {
    return { error: String(e).includes("Unique") ? "Bu login band" : (e as Error).message };
  }
  revalidatePath("/superadmin/adminlar");
  return { ok: true };
}

export async function toggleAdminAction(id: string): Promise<void> {
  const a = await requireAdmin();
  if (id === a.id) return; // o'zini bloklab, panelsiz qolmasin
  const t = await control.superAdmin.findUniqueOrThrow({ where: { id } });
  if (t.isActive && (await control.superAdmin.count({ where: { isActive: true } })) <= 1) return;
  await control.superAdmin.update({ where: { id }, data: { isActive: !t.isActive, sessionVersion: { increment: 1 } } });
  await logEvent(a.id, "ADMIN_TOGGLE", null, { login: t.login, isActive: !t.isActive });
  revalidatePath("/superadmin/adminlar");
}

export async function changeOwnPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await requireAdmin();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("password") ?? "");
  const me = await control.superAdmin.findUniqueOrThrow({ where: { id: a.id } });
  // Joriy parol — qayta parol qulfi bilan (reauth:<adminId>): ochiq qolgan sessiyadan parolni taxmin qilib bo'lmasin
  let ip = "unknown";
  try { ip = await clientIp(); } catch { /* so'rov yo'q */ }
  const bad = await verifyReauth({ adminId: me.id, hash: me.isActive ? me.passwordHash : null, password: current, ip });
  if (bad) return { error: bad === "Parol noto'g'ri" ? "Joriy parol noto'g'ri" : bad };
  const problem = passwordProblem(next);
  if (problem) return { error: problem };
  const u = await control.superAdmin.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(next, 10), sessionVersion: { increment: 1 } } });
  const { issueAdminSession } = await import("@/lib/control/auth");
  await issueAdminSession(u);
  await logEvent(a.id, "ADMIN_PASSWORD", null);
  return { ok: true };
}

/**
 * 3-talab: IT korxona ichiga to'liq huquq bilan kiradi. Token 60 soniya, bir martalik, faqat shu korxona uchun;
 * brauzer uni POST bilan korxona domeniga olib boradi (`/api/control/sso`).
 */
export async function ssoAction(slug: string): Promise<{ error?: string; url?: string; token?: string }> {
  const a = await requireAdmin();
  const t = await tenantBySlug(slug);
  if (!t.domain) return { error: "Korxonaga domen ulanmagan — avval domenni kiriting" };
  if (t.status === "ARCHIVED") return { error: "Arxivdagi korxonaga kirib bo'lmaydi" };
  const { signSso, controlSecretSet } = await import("@/lib/control/token");
  if (!controlSecretSet()) return { error: "CONTROL_SECRET sozlanmagan (panel .env)" };
  const token = await signSso(t.slug, { adminId: a.id, adminLogin: a.login, adminName: a.fullName });
  await logEvent(a.id, "SSO", t.id, { domain: t.domain });
  const scheme = t.domain.endsWith(".localhost") || t.domain.startsWith("localhost") ? "http" : "https";
  return { url: `${scheme}://${t.domain}/api/control/sso`, token };
}
