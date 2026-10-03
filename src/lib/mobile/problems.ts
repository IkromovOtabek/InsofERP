import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ROLE_LABELS } from "@/lib/nav";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import type { Role } from "@/generated/prisma";
import type { MobileUser } from "./auth";
import type { MobileDetail } from "./detail";
import type { HomeRow, HomeSection, Tone } from "./home";
import { money, short } from "./fmt";
import { ownerCached } from "./owner-cache";
import { ListError } from "./list";

/**
 * Direktor "Muammolar" — Egasi dashbordidagi qaror talab qiladigan masalalar (`ownerDashboard().decisions`).
 *
 * Masala bazada alohida yozuv emas — har safar raqamlardan hisoblanadi (kassa uzilishi, muddati o'tgan qarz,
 * byudjet oshishi...). Shuning uchun "hal qilindi" tugmasi yo'q: sababi bartaraf etilsa masala o'zi yo'qoladi.
 * Direktor qila oladigan ish — mas'ul bo'limga topshirish (bildirishnoma) va qarorini qayd etish; ikkalasi
 * auditga `OwnerDecision` bo'lib yoziladi va kartochkadagi "Tarix"da ko'rinadi.
 */

const ENTITY = "OwnerDecision";
const tone = (l: string): Tone => (l === "crit" ? "danger" : l === "warn" ? "warning" : "success");
const LEVEL: Record<string, string> = { crit: "Jiddiy", warn: "Ogohlantirish", ok: "Joyida" };

/**
 * Vebdagi havola → ilovadagi joy: `{ key, id }` — kartochka, `{ list }` — ro'yxat. Mos joy bo'lmasa null.
 * Egasi dashbordi, direktor nazorati va muammolar bitta xaritadan foydalanadi (`home.ts` `taskList` ham).
 */
export function webTarget(href: string): { key: string; id: string } | { list: string } | null {
  const [path] = href.split("?");
  const m = /^\/(customers|orders|trips|invoices|receipts|drivers|stock)\/([^/]+)$/.exec(path);
  if (m && m[2] !== "new") return { key: m[1] === "drivers" ? "employees" : m[1], id: m[2] };
  if (path.startsWith("/receipts")) return { list: "receipts" };
  if (path.startsWith("/invoices")) return { list: "invoices" };
  if (path.startsWith("/orders") || path.startsWith("/sales")) return { list: "orders" };
  if (path.startsWith("/trips") || path.startsWith("/logistika")) return { list: "trips" };
  if (path.startsWith("/drivers")) return { list: "drivers" };
  if (path.startsWith("/stock")) return { list: "stock" };
  if (path.startsWith("/taminot") || path.startsWith("/supply")) return { list: "supply" };
  if (path.startsWith("/cashflow") || path.startsWith("/dashboard/byudjet")) return { list: "cashflow" };
  if (path.startsWith("/tasks")) return { list: "tasks" };
  if (path.startsWith("/customers") || path.includes("mijozlar")) return { list: "customers" };
  if (path.startsWith("/dashboard") && href.includes("production")) return { list: "production" };
  return null;
}

/** Ro'yxat kaliti (qator `open` maydoni uchun): kartochka havolasi bo'lsa — uning ro'yxati. */
export const webList = (href: string): string | undefined => {
  const t = webTarget(href);
  return !t ? undefined : "list" in t ? t.list : t.key === "employees" ? "drivers" : t.key;
};

/** Mas'ul bo'lim nomi (ROLE_LABELS) → rol. Topilmasa — direktorning o'zi. */
const ownerRoles = (owner: string): Role[] => {
  const r = (Object.keys(ROLE_LABELS) as Role[]).filter((k) => ROLE_LABELS[k] === owner && k !== "SUPERADMIN" && k !== "DIRECTOR");
  return r;
};

async function findDecision(key: string) {
  const d = await ownerCached();
  const x = d.decisions.find((y) => y.key === key);
  if (!x) throw new ListError("NOT_FOUND", "Bu masala endi ro'yxatda yo'q — sababi bartaraf etilgan bo'lishi mumkin", 404);
  return x;
}

export async function problemDetail(user: MobileUser, key: string): Promise<MobileDetail> {
  if (user.role !== "DIRECTOR") throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const x = await findDecision(key);
  const log = await db.auditLog.findMany({
    where: { entity: ENTITY, entityId: key }, orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, createdAt: true, after: true, user: { select: { fullName: true } } },
  });
  const target = webTarget(x.href);
  const roles = ownerRoles(x.owner);
  const related: HomeRow[] = [];
  if (target && "id" in target) {
    // Mijoz qarzi va h.k. — bevosita kartochka
    if (target.key === "customers") {
      const c = await db.customer.findUnique({ where: { id: target.id }, select: { name: true, phone: true } });
      if (c) related.push({ id: target.id, title: c.name, subtitle: c.phone ?? "Mijoz kartochkasi", tone: tone(x.level) });
    }
  }
  const sections: HomeSection[] = [];
  if (related.length && target && "id" in target) sections.push({ title: "Bog'liq hujjat", empty: "", target: target.key, icon: "file-text", rows: related });
  else if (target) {
    const list = "list" in target ? target.list : target.key;
    sections.push({ title: "Bog'liq bo'lim", empty: "", icon: "folder", rows: [{ id: `open-${list}`, title: "Batafsil ro'yxatni ochish", subtitle: x.href.split("?")[0], open: list }] });
  }
  sections.push({
    title: "Tarix", empty: "Hali hech narsa qayd etilmagan — mas'ulga topshiring yoki qaroringizni yozing", icon: "clock",
    rows: log.map((l) => {
      const a = (l.after ?? {}) as { kind?: string; note?: string; to?: string };
      return {
        id: l.id,
        title: a.kind === "assign" ? `Topshirildi: ${a.to ?? "mas'ul bo'lim"}` : "Qaror qayd etildi",
        subtitle: [a.note, l.user.fullName].filter(Boolean).join(" · "),
        right: `${String(l.createdAt.getDate()).padStart(2, "0")}.${String(l.createdAt.getMonth() + 1).padStart(2, "0")} ${String(l.createdAt.getHours()).padStart(2, "0")}:${String(l.createdAt.getMinutes()).padStart(2, "0")}`,
        tone: (a.kind === "assign" ? "info" : "brand") as Tone,
      };
    }),
  });
  const roleOptions = (Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== "SUPERADMIN" && r !== "DIRECTOR" && r !== "AGENT").map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  return {
    key: "problem", id: key, title: x.problem, subtitle: `Mas'ul: ${x.owner} · muddat ${x.due}`, status: LEVEL[x.level] ?? x.level,
    fields: [
      { label: "Daraja", value: LEVEL[x.level] ?? x.level, tone: tone(x.level) },
      ...(x.amount ? [{ label: "Summa", value: money(Math.abs(x.amount)), tone: tone(x.level) }] : []),
      ...(x.effect ? [{ label: "Ta'siri", value: x.effect }] : []),
      { label: "Tavsiya etilgan qaror", value: x.decision },
      { label: "Mas'ul bo'lim", value: x.owner },
      { label: "Muddat", value: x.due },
      ...(log[0] ? [{ label: "Oxirgi harakat", value: `${log[0].user.fullName}` }] : []),
    ],
    sections,
    actions: [
      {
        id: "problem.assign", label: "Mas'ulga topshirish", tone: "brand",
        form: [
          { name: "role", label: "Kimga", type: "select", required: true, options: roleOptions, value: roles[0] ?? roleOptions[0]?.value },
          { name: "note", label: "Topshiriq matni", type: "text", required: true, value: x.decision, hint: "Bo'lim xodimlariga bildirishnoma (push) boradi" },
        ],
      },
      { id: "problem.note", label: "Qarorni qayd etish", tone: "success", form: [{ name: "note", label: "Qaror", type: "text", required: true, placeholder: "Masalan: kredit liniyasi olinadi, 15-gacha" }] },
    ],
  };
}

/** `problem.assign` / `problem.note` — `actions.ts` dan chaqiriladi (ruxsat u yerda tekshirilgan). */
export async function problemAction(user: MobileUser, action: string, key: string, payload: Record<string, unknown>): Promise<string> {
  const x = await findDecision(key);
  const note = String(payload.note ?? "").trim().slice(0, 500);
  if (!note) throw new ListError("ACTION_FAILED", action === "problem.assign" ? "Topshiriq matnini yozing" : "Qaroringizni yozing", 400);
  if (action === "problem.assign") {
    const role = String(payload.role ?? "") as Role;
    if (!Object.hasOwn(ROLE_LABELS, role) || role === "SUPERADMIN" || role === "DIRECTOR") throw new ListError("ACTION_FAILED", "Bo'lim tanlanmagan", 400);
    await audit(db, user.id, "UPDATE", ENTITY, key, undefined, { kind: "assign", to: ROLE_LABELS[role], role, note, problem: x.problem });
    notifyAfter(() => notifyRoles([role], {
      type: "OWNER_DECISION", title: `Direktor topshirig'i: ${x.problem}`.slice(0, 120),
      body: `${note}${x.amount ? ` · ${short(Math.abs(x.amount))} so'm` : ""} · muddat ${x.due}`,
    }));
    return `${ROLE_LABELS[role]} bo'limiga topshirildi`;
  }
  await audit(db, user.id, "UPDATE", ENTITY, key, undefined, { kind: "note", note, problem: x.problem });
  return "Qaror qayd etildi";
}
