import { z } from "zod";
import { DEPLOY_REF_RE, LOG_FILTER_MAX, LOG_MAX_LINES, cleanFilter, isLogPriority, isLogSource } from "./contract";

/**
 * Panel tomoni (monitor-actions.ts → enqueueAction): DevOps amallari parametrlari. Hammasi satr (AgentAction.params
 * takrorni tekshirishda aynan solishtiriladi); agent validateDevops bilan qayta tekshiradi.
 */
export const DEVOPS_PARAMS = {
  DEPLOY: z.object({ ref: z.string().regex(DEPLOY_REF_RE, "ref: faqat \"main\" yoki 7–40 belgili hex sha") }).strict(),
  ROLLBACK: z.object({}).strict(),
  LOG_TAIL: z.object({
    source: z.string().refine(isLogSource, "Log manbai oq ro'yxatda emas"),
    lines: z.string().regex(/^\d{1,3}$/, "Qatorlar soni noto'g'ri").refine((v) => Number(v) >= 1 && Number(v) <= LOG_MAX_LINES, `Qatorlar 1–${LOG_MAX_LINES}`),
    filter: z.string().refine((v) => cleanFilter(v) !== null, `Filtr: oddiy matn, ≤ ${LOG_FILTER_MAX} belgi`),
    priority: z.string().refine((v) => v === "" || isLogPriority(v), "Daraja noto'g'ri"),
  }).strict(),
} satisfies Record<string, z.ZodType<Record<string, string>>>;
