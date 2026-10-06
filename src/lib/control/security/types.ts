import type { ActionType } from "../monitor/contract";

/**
 * Kiberxavfsizlik moduli ↔ insof-agent shartnomasi (agent tomonidagi src/lib/control/monitor/types.ts bilan AYNAN bir xil shakl).
 *
 * Shu modulning kelishuvlari:
 *  - `key` — `security:<nom>` (contract.ts → checkKey.security). Bir tekshiruv — bitta kalit; holat yaxshi bo'lsa ham
 *    shu kalit bilan INFO topilma qaytadi (`detail.status: "OK"`) — agent ochiq hodisani yopa olsin.
 *  - `detail.status` — "OK" | "WARN" | "UNKNOWN". UNKNOWN — vosita/fayl yo'q yoki huquq yetmadi (`detail.reason` da sabab).
 *  - `detail` da hech qachon sir qiymati bo'lmaydi (faqat fayl nomi, chegara, son, IP).
 */
export type Finding = {
  key: string;
  category: "security" | "config" | "update" | "certificate";
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  detail?: Record<string, unknown>;
  suggestedActions?: { type: ActionType; params?: Record<string, string>; label: string }[];
};

export type SecurityCtx = {
  appDir: string;
  tenants: { slug: string; port: number; domain: string | null; dbName: string; status: string }[];
  now: Date;
  log: (msg: string) => void;
};

export type Severity = Finding["severity"];
export type SuggestedAction = NonNullable<Finding["suggestedActions"]>[number];
