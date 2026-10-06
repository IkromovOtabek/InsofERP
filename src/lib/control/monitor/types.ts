/**
 * insof-agent ↔ kiberxavfsizlik moduli (src/lib/control/security/**) barqaror interfeysi.
 *
 * Agent (scripts/insof-agent.ts) xavfsizlik modulini faqat shu turlar orqali chaqiradi:
 *   - `runSecurityChecks(ctx)` — har 5 daqiqada; har `Finding` → Incident (source "security", kalit "security:<key>").
 *     Avvalgi skanerda bo'lgan, endi ketma-ket 2 skanerda yo'q topilma avtomatik RESOLVED bo'ladi.
 *   - `runAiAnalysis(trigger, requestedById?)` — har 6 soatda ("scheduled") va panel so'rovi bilan ("manual");
 *     natijani o'zi SecurityReport ga yozadi.
 * Modul hali bo'lmasa agent buni sezadi va tekshiruvni UNKNOWN deb belgilaydi (yiqilmaydi).
 */
import type { ActionType } from "./contract";

/** Prisma `Severity` enum bilan bir xil qiymatlar (control sxemasi). */
export type FindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Tavsiya etilgan tuzatish — Incident.suggestedActions elementi; panel bosilganda AgentAction qo'yadi. */
export type SuggestedAction = {
  type: ActionType;
  params?: Record<string, string>;
  /** Tugmadagi matn ("Qayta ishga tushirish", "IP ni bloklash") */
  label: string;
};

export type Finding = {
  /** Barqaror kalit (masalan "ssh-password-auth", "env-perms:tenants/sharq.env"). Bir xil muammo — bir xil kalit. */
  key: string;
  /** availability | performance | security | backup | certificate | config | update */
  category: string;
  severity: FindingSeverity;
  /** Qisqa, sirsiz sarlavha (Telegram xabariga ham shu ketadi) */
  title: string;
  /** Qo'shimcha tafsilot (sirsiz!) — Incident.detail ga yoziladi */
  detail?: Record<string, unknown>;
  suggestedActions?: SuggestedAction[];
};

/** Korxona haqida xavfsizlik tekshiruvlariga kerakli minimal ma'lumot (control bazadan). */
export type TenantRef = {
  id: string;
  slug: string;
  port: number;
  domain: string | null;
  dbName: string;
  status: string;
};

export type SecurityCtx = {
  /** Repo/sozlama ildizi (/var/www/insof-erp): control.env, build.env, tenants/*.env shu yerda */
  appDir: string;
  /** Faol (ACTIVE) va boshqa korxonalar ro'yxati */
  tenants: TenantRef[];
  hostname: string;
  /** /proc mavjud (Linux) — false bo'lsa Linux'ga xos tekshiruvlar o'tkazib yuborilsin */
  linux: boolean;
  /** systemctl ishlaydi */
  systemd: boolean;
  /** Test rejimi (INSOF_ENV=test) — tashqi tarmoqqa chiqmaslik */
  testMode: boolean;
  now: Date;
  /** Agent jurnaliga yozish (journald) */
  log: (msg: string) => void;
};

export type AiTrigger = "scheduled" | "manual";

/** src/lib/control/security moduli eksport qilishi kerak bo'lgan funksiyalar. */
export type SecurityModule = {
  runSecurityChecks: (ctx: SecurityCtx) => Promise<Finding[]>;
  runAiAnalysis: (trigger: AiTrigger, requestedById?: string) => Promise<unknown>;
};

/** Agentning bitta tekshiruv natijasi → ServiceCheck (+ kerak bo'lsa Incident). */
export type CheckStatusT = "OK" | "WARN" | "CRIT" | "UNKNOWN";

export type CheckResult = {
  key: string;
  kind: string;
  target: string;
  tenantId?: string | null;
  status: CheckStatusT;
  message?: string;
  latencyMs?: number | null;
  data?: Record<string, unknown>;
  /** WARN/CRIT bo'lsa ochiladigan hodisa tavsifi */
  incident?: {
    category: string;
    title: string;
    /** CRIT uchun og'irlik (standart HIGH); WARN har doim MEDIUM */
    critSeverity?: FindingSeverity;
    suggestedActions?: SuggestedAction[];
  };
};
