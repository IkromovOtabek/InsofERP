import type { Role } from "@/generated/prisma";
import { MODULES, NAV, canView, roleSeesButton, type NavItem } from "./nav";
import { NAV_GROUPS } from "./nav-groups";
import { MODULE_ACTIONS, delegableActions, roleDefaultActions } from "./permissions";
import { buttonsOf, hasWindow } from "./perm-buttons";

/**
 * Ruxsatlar daraxtining ma'lumoti (Sozlamalar → Ruxsatlar, lavozim login shabloni, bir nechta xodimga birdan):
 * bo'lim (menyu guruhi) → tugma (oyna) → amal. Tugmalar direktor sidebar'idagi tartibda: bo'limi va o'rni shu oyna
 * ochiladigan menyu bandidan olinadi, modul (perms kaliti) esa faqat saqlash birligi. Bazaga tegmaydi — klientda ham ishlatiladi
 * (shablonda asosiy bo'lim almashsa "rol bo'yicha" belgilari o'zi yangilanadi).
 */
export type PermModule = {
  key: string;
  label: string;
  /** Modulning sidebar'dagi birinchi oynasi turgan bo'lim */
  group: string;
  actions: { key: string; label: string; hint?: string; explicit?: boolean }[];
  /** Hech kimga berilmaydigan amallar (faqat direktor) — daraxtda qulf bilan ko'rinadi */
  locked: { key: string; label: string; hint?: string }[];
  /** `window` — alohida oyna (ko'rish huquqi `@kalit`), aks holda boshqa oynadagi amallar guruhi.
   *  `group`, `order` — daraxtda qaysi bo'limda va qaysi o'rinda (sidebar ketma-ketligi) */
  buttons: { key: string; label: string; window: boolean; actions: string[]; group: string; order: number }[];
  /** Rol bo'yicha (direktor bermagan holatda): ko'radimi, qaysi oynalar va amallar. `null` — rol noma'lum (bir nechta xodim). */
  role: { view: boolean; actions: string[]; buttons: string[] } | null;
};

type Slot = { item: NavItem; i: number };
const ALL: Slot[] = NAV.map((item, i) => ({ item, i }));
/** Direktor sidebar'i: yashirin va faqat boshqa rollarga atalgan bandlarsiz */
const MENU = ALL.filter(({ item }) => !item.hidden && (!item.menuFor || item.menuFor.includes("DIRECTOR")));
const bare = (p: string) => p.split("?")[0];

/** Oyna yo'li menyuning qaysi bandida: aynan mos band, bo'lmasa eng uzun ota band (/stock/prixod → Sklad). */
function slotOf(paths: string[], list: Slot[]): Slot | undefined {
  let best: (Slot & { score: number }) | undefined;
  for (const raw of paths) {
    const p = bare(raw);
    for (const x of list) {
      const href = bare(x.item.href);
      if (p !== href && !p.startsWith(href + "/")) continue;
      const score = (p === href ? 10_000 : 0) + href.length;
      if (!best || score > best.score) best = { ...x, score };
    }
  }
  return best;
}

/**
 * Modul tugmalarining daraxtdagi o'rni. Menyuda bandi yo'q oyna (sahifa ichidagi, boshqa oynadagi amallar, menyudan olingan
 * sahifa) modulning oldingi tugmasi yonida turadi: Sklad holati — Sklad ostida, Yoqilg'i — Transport ostida.
 */
function buttonSlots(mi: number, m: (typeof MODULES)[number]) {
  const found = buttonsOf(m.key).map((b) => slotOf(b.paths ?? [], MENU));
  let prev = found.find(Boolean) ?? slotOf(m.prefixes, ALL);
  return found.map((f, bi) => {
    const s = f ?? prev;
    prev = s;
    const g = s ? NAV_GROUPS.indexOf(s.item.group) : -1;
    return { group: s?.item.group ?? "Boshqa", order: ((g < 0 ? NAV_GROUPS.length : g) * 1000 + (s?.i ?? 999)) * 1000 + mi * 20 + bi };
  });
}

/** `role` berilmasa (har xil roldagi bir nechta xodim) — "rol bo'yicha" belgilarisiz. */
export function permModules(role: Role | null): PermModule[] {
  return MODULES.map((m, mi) => {
    const slots = buttonSlots(mi, m);
    const first = slots.reduce<(typeof slots)[number] | undefined>((a, s) => (!a || s.order < a.order ? s : a), undefined);
    const view = role ? canView({ role }, m.key) : false;
    // Rol bajaradigan amallar — modulni menyuda ko'rmasa ham (Sklad xodimi → «Sklad zayavkasi», `canDo` rol bo'yicha)
    const defaults = role ? roleDefaultActions(role, m.key) : [];
    return {
      key: m.key, label: m.label, group: first?.group ?? "Boshqa",
      actions: delegableActions(m.key).map((a) => ({ key: a.key, label: a.label, hint: a.hint, explicit: a.explicit })),
      locked: (MODULE_ACTIONS[m.key] ?? []).filter((a) => a.delegable === false).map((a) => ({ key: a.key, label: a.label, hint: a.hint })),
      buttons: buttonsOf(m.key).map((b, bi) => ({ key: b.key, label: b.label, window: hasWindow(b), actions: b.actions, ...slots[bi] })),
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
