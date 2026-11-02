import type { Role } from "@/generated/prisma";
import { MODULES, NAV, canView, roleSeesButton } from "./nav";
import { MODULE_ACTIONS, delegableActions, roleDefaultActions } from "./permissions";
import { buttonsOf, hasWindow } from "./perm-buttons";

/**
 * Ruxsatlar daraxtining ma'lumoti (Sozlamalar → Ruxsatlar, lavozim login shabloni, bir nechta xodimga birdan):
 * bo'lim (menyu guruhi) → modul → tugma (oyna) → amal. Bazaga tegmaydi — klientda ham ishlatiladi
 * (shablonda asosiy bo'lim almashsa "rol bo'yicha" belgilari o'zi yangilanadi).
 */
export type PermModule = {
  key: string;
  label: string;
  group: string;
  actions: { key: string; label: string; hint?: string; explicit?: boolean }[];
  /** Hech kimga berilmaydigan amallar (faqat direktor) — daraxtda qulf bilan ko'rinadi */
  locked: { key: string; label: string; hint?: string }[];
  /** `window` — alohida oyna (ko'rish huquqi `@kalit`), aks holda boshqa oynadagi amallar guruhi */
  buttons: { key: string; label: string; window: boolean; actions: string[] }[];
  /** Rol bo'yicha (direktor bermagan holatda): ko'radimi, qaysi oynalar va amallar. `null` — rol noma'lum (bir nechta xodim). */
  role: { view: boolean; actions: string[]; buttons: string[] } | null;
};

/** Modul qaysi menyu guruhiga tegishli (Sotuv, Sklad...) — daraxt shu bo'yicha bo'linadi. */
const groupOf = (m: (typeof MODULES)[number]) => NAV.find((i) => m.prefixes.some((p) => i.href.startsWith(p)))?.group ?? "Boshqa";

/** `role` berilmasa (har xil roldagi bir nechta xodim) — "rol bo'yicha" belgilarisiz. */
export function permModules(role: Role | null): PermModule[] {
  return MODULES.map((m) => {
    const view = role ? canView({ role }, m.key) : false;
    // Rol bajaradigan amallar — modulni menyuda ko'rmasa ham (Sklad xodimi → «Sklad zayavkasi», `canDo` rol bo'yicha)
    const defaults = role ? roleDefaultActions(role, m.key) : [];
    return {
      key: m.key, label: m.label, group: groupOf(m),
      actions: delegableActions(m.key).map((a) => ({ key: a.key, label: a.label, hint: a.hint, explicit: a.explicit })),
      locked: (MODULE_ACTIONS[m.key] ?? []).filter((a) => a.delegable === false).map((a) => ({ key: a.key, label: a.label, hint: a.hint })),
      buttons: buttonsOf(m.key).map((b) => ({ key: b.key, label: b.label, window: hasWindow(b), actions: b.actions })),
      role: role ? {
        view,
        actions: defaults,
        // Rol odatda bajaradigan amalning oynasi ham (Sklad xodimi → Zayavkalar oynasidagi «Sklad zayavkasi»)
        buttons: buttonsOf(m.key).filter((b) => hasWindow(b) && ((view && roleSeesButton(role, m.key, b)) || b.actions.some((a) => defaults.includes(a)))).map((b) => b.key),
      } : null,
    };
  });
}

/** Ruxsatlar ro'yxatidagi xodim belgilari shu formaga tegishli (`form="bulk-perms"`) — bir nechta xodimga birdan. */
export const BULK_FORM_ID = "bulk-perms";
