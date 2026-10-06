import { z } from "zod";
import { control } from "../db";
import {
  REBOOT_AT_RE, TENANT_DOMAIN_RE, TENANT_SLUG_RE, domainAllowed, domainPolicyFromEnv, isInfraActionType,
  type InfraActionType,
} from "./contract";

/**
 * Panel tomoni: infra amallarining zod sxemalari (monitor-actions.ts PARAMS ga qo'shiladi) va navbatga qo'yishdan
 * oldingi qo'shimcha tekshiruv (baza bo'yicha). Agent bularni o'zi ham qayta tekshiradi.
 */
type Params = z.ZodType<Record<string, string>>;
const EMPTY = z.object({}).strict();
const dropEmpty = (o: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;

export const INFRA_PARAMS: Record<InfraActionType, Params> = {
  RUN_RESTORE_TEST: EMPTY,
  REBOOT: z.object({ at: z.string().regex(REBOOT_AT_RE, "Vaqt noto'g'ri: «now» yoki HH:MM").optional() }).strict().transform(dropEmpty) as unknown as Params,
  REBOOT_CANCEL: EMPTY,
  CLEAN_RELEASES: EMPTY,
  JOURNAL_VACUUM: EMPTY,
  TENANT_UP: z.object({
    slug: z.string().regex(TENANT_SLUG_RE, "Korxona qisqa nomi noto'g'ri"),
    domain: z.union([z.literal(""), z.string().regex(TENANT_DOMAIN_RE, "Domen noto'g'ri")]).optional(),
  }).strict().transform(dropEmpty) as unknown as Params,
};

/** Navbatga qo'yishdan oldin: null — davom etish, satr — xato matni. */
export async function infraPreflight(type: string, p: Record<string, string>): Promise<string | null> {
  if (!isInfraActionType(type)) return null;
  if (type === "TENANT_UP") {
    const t = await control.tenant.findUnique({ where: { slug: p.slug }, select: { status: true, domain: true } });
    if (!t) return "Korxona topilmadi";
    if (t.status !== "PROVISIONING" && t.status !== "ACTIVE") return "Faqat «Ishga tushirilmoqda» yoki «Faol» korxonani serverda sozlash mumkin";
    if ((p.domain ?? null) !== (t.domain ?? null)) return "Domen korxona ma'lumotidagi bilan bir xil bo'lishi kerak";
    if (p.domain) {
      const pol = domainPolicyFromEnv();
      if (!domainAllowed(p.domain, pol.base, pol.list)) {
        return `Domen ${p.domain} ruxsat etilmagan: faqat ${pol.base ? `*.${pol.base}` : "TENANT_BASE_DOMAIN ostida"} yoki control.env dagi TENANT_DOMAINS ro'yxatida`;
      }
    }
  }
  return null;
}
