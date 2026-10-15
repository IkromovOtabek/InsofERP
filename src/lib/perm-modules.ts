import type { Role } from "@/generated/prisma";
import { MODULES, NAV, canView } from "./nav";
import { delegableActions, roleDefaultActions } from "./permissions";

/**
 * Ruxsatlar matritsasining qatorlari (Sozlamalar → Ruxsatlar, lavozim login shabloni, bir nechta xodimga birdan).
 * Bazaga tegmaydi — klientda ham ishlatiladi (shablonda asosiy bo'lim almashsa "rol bo'yicha" izohi o'zi yangilanadi).
 */
export type PermModule = {
  key: string;
  label: string;
  group: string;
  actions: { key: string; label: string; hint?: string; explicit?: boolean }[];
  /** Rol bo'yicha (direktor bermagan holatda): ko'radimi va qaysi amallarni bajaradi. `null` — rol noma'lum (bir nechta xodim). */
  role: { view: boolean; actions: string[] } | null;
};

/** Modul qaysi menyu guruhiga tegishli (Sotuv, Sklad...) — forma shu bo'yicha bo'linadi. */
const groupOf = (m: (typeof MODULES)[number]) => NAV.find((i) => m.prefixes.some((p) => i.href.startsWith(p)))?.group ?? "Boshqa";

/** `role` berilmasa (har xil roldagi bir nechta xodim) — "rol bo'yicha" izohisiz. */
export function permModules(role: Role | null): PermModule[] {
  return MODULES.map((m) => ({
    key: m.key, label: m.label, group: groupOf(m),
    actions: delegableActions(m.key).map((a) => ({ key: a.key, label: a.label, hint: a.hint, explicit: a.explicit })),
    role: role ? { view: canView({ role }, m.key), actions: canView({ role }, m.key) ? roleDefaultActions(role, m.key) : [] } : null,
  }));
}

/** Ruxsatlar ro'yxatidagi xodim belgilari shu formaga tegishli (`form="bulk-perms"`) — bir nechta xodimga birdan. */
export const BULK_FORM_ID = "bulk-perms";
