/**
 * AI xavfsizlik tahlilchisi: ochiq hodisalar + so'nggi tekshiruv natijalari → Claude → SecurityReport.
 *
 *  - Kirish: sirlarsiz, shaxsiy ma'lumotsiz (IP'lardan tashqari) qisqa JSON, ~20 000 belgigacha.
 *  - Javob: qat'iy JSON (structured outputs) { grade, summary, items[] } → zod bilan tekshiriladi.
 *  - HIGH/CRITICAL tavsiyalar uchun (agar xuddi shunday ochiq hodisa bo'lmasa) source "ai" hodisa ochiladi.
 *  - Kalit: ANTHROPIC_API_KEY (control.env). Yo'q bo'lsa — null. Model: CONTROL_AI_MODEL (standart claude-sonnet-5-5).
 *  - Test rejimi (INSOF_ENV=test): haqiqiy API HECH QACHON chaqirilmaydi — deterministik stub.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { control } from "../db";
import { ACTION_TYPES, isActionType, type ActionType } from "../monitor/contract";
import { isTestMode } from "../../test-mode";
import { parseEnv } from "./parsers";
import { errMsg } from "./util";

export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";
export const STUB_MODEL = "stub-test";
const MAX_INPUT_CHARS = 20_000;
const GRADES = ["A", "B", "C", "D", "E", "F"] as const;
const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
/** Parametrsiz bajariladigan amallar — AI hodisasiga faqat shular biriktiriladi (BLOCK_IP/RESTART_UNIT parametr talab qiladi). */
const PARAMLESS: ReadonlySet<ActionType> = new Set(["RELOAD_NGINX", "RUN_BACKUP", "RENEW_CERT", "FIX_SECRET_PERMS", "RUN_HEALTH_CHECK", "RUN_SECURITY_SCAN"]);

const log = (m: string) => console.log(`[security-ai] ${m}`);

/* ───────────────────────── Javob sxemasi ───────────────────────── */

export const AiItem = z.object({
  title: z.string().min(1).transform((s) => s.slice(0, 200)),
  severity: z.enum(SEVERITIES),
  why: z.string().transform((s) => s.slice(0, 800)),
  fix: z.string().transform((s) => s.slice(0, 800)),
  actionType: z.string().optional().nullable().transform((s) => (s && isActionType(s) ? s : undefined)),
});
export const AiReport = z.object({
  grade: z.enum(GRADES),
  summary: z.string().min(1).transform((s) => s.slice(0, 600)),
  items: z.array(AiItem).max(25),
});
export type AiReportT = z.infer<typeof AiReport>;

/** Structured outputs uchun JSON Schema (ixtiyoriy maydon o'rniga "NONE" — sxema qat'iy bo'lsin). */
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["grade", "summary", "items"],
  properties: {
    grade: { type: "string", enum: [...GRADES], description: "A — juda yaxshi … F — xavfli" },
    summary: { type: "string", description: "O'zbek tilida (lotin), 600 belgigacha" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "severity", "why", "fix", "actionType"],
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: [...SEVERITIES] },
          why: { type: "string" },
          fix: { type: "string" },
          actionType: { type: "string", enum: [...ACTION_TYPES, "NONE"] },
        },
      },
    },
  },
} as const;

/* ───────────────────────── Kirishni yig'ish (sirlarsiz) ───────────────────────── */

/** Sir yoki shaxsiy ma'lumot bo'lishi mumkin bo'lgan narsalarni yashirish (IP'lar qoladi). */
export function redact(s: string): string {
  return s
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@"]+:[^\s/@"]+@/gi, "$1***:***@") // URL ichidagi login:parol
    .replace(/\b(AUTH_SECRET|CONTROL_SECRET|CONTROL_SSO_KEY|[A-Z_]*(?:TOKEN|KEY|PASSWORD|SECRET))\s*[=:]\s*("?)[^\s",}]+\2/g, "$1=***")
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***")
    .replace(/\b[A-Za-z0-9+_-]{32,}={0,2}/g, "***") // uzun tokenlar (base64/hex)
    .replace(/\+?998[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, "+998*********") // telefon
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "***@***"); // e-pochta
}

function clip(v: unknown, max: number): unknown {
  if (v == null) return undefined;
  const s = redact(typeof v === "string" ? v : JSON.stringify(v));
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

export type AiInput = {
  incidents: { key: string; source: string; category: string; severity: string; status: string; title: string; count: number; lastSeenAt: string; detail?: unknown }[];
  checks: { key: string; kind: string; status: string; message?: string; data?: unknown }[];
  host: Record<string, unknown> | null;
  tenants: number;
};

export async function gatherInput(): Promise<{ input: AiInput; text: string; truncated: boolean }> {
  const [incidents, checks, snap, tenants] = await Promise.all([
    control.incident.findMany({ where: { status: { in: ["OPEN", "ACKED"] } }, orderBy: { lastSeenAt: "desc" }, take: 100 }),
    control.serviceCheck.findMany({ where: { OR: [{ kind: "security" }, { status: { in: ["WARN", "CRIT", "UNKNOWN"] } }] }, orderBy: { checkedAt: "desc" }, take: 150 }),
    control.hostSnapshot.findFirst({ orderBy: { takenAt: "desc" } }),
    control.tenant.count({ where: { status: "ACTIVE" } }),
  ]);
  const pct = (a: bigint, b: bigint) => (b > BigInt(0) ? Math.round(Number((a * BigInt(1000)) / b)) / 10 : null);
  const input: AiInput = {
    incidents: incidents
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
      .map((i) => ({
        key: i.key, source: i.source, category: i.category, severity: i.severity, status: i.status,
        title: String(clip(i.title, 200)), count: i.count, lastSeenAt: i.lastSeenAt.toISOString(), detail: clip(i.detail, 500),
      })),
    checks: checks.map((c) => ({ key: c.key, kind: c.kind, status: c.status, message: clip(c.message, 200) as string | undefined, data: clip(c.data, 400) })),
    host: snap ? { cpuPct: Math.round(snap.cpuPct), load1: snap.load1, memPct: pct(snap.memUsed, snap.memTotal), diskPct: pct(snap.diskUsed, snap.diskTotal), uptimeDays: Math.round(snap.uptimeSec / 864) / 100 } : null,
    tenants,
  };
  // Hajm chegarasi: avval data/detail qisqaradi, keyin past darajali yozuvlar tashlanadi
  let truncated = false;
  let text = JSON.stringify(input);
  if (text.length > MAX_INPUT_CHARS) {
    truncated = true;
    for (const c of input.checks) delete c.data;
    text = JSON.stringify(input);
  }
  while (text.length > MAX_INPUT_CHARS && (input.checks.length || input.incidents.length)) {
    if (input.checks.length > 20) input.checks.pop();
    else if (input.incidents.length > 10) { const last = input.incidents.pop()!; if (last.detail) truncated = true; }
    else { for (const i of input.incidents) delete i.detail; input.checks.pop(); }
    text = JSON.stringify(input);
  }
  return { input, text, truncated };
}

/* ───────────────────────── Stub (test rejimi) ───────────────────────── */

export function stubReport(input: AiInput): AiReportT {
  const worst = input.incidents.reduce((w, i) => Math.min(w, SEV_ORDER[i.severity] ?? 4), 4);
  const grade = (["F", "D", "C", "B", "A"] as const)[worst];
  const items = input.incidents
    .filter((i) => i.severity !== "INFO")
    .slice(0, 5)
    .map((i) => ({ title: i.title, severity: i.severity as (typeof SEVERITIES)[number], why: `Ochiq hodisa (${i.category}), ${i.count} marta qayd etildi.`, fix: "Hodisa tafsilotini ko'rib, tavsiya etilgan amalni bajaring.", actionType: undefined }));
  return AiReport.parse({
    grade,
    summary: `Test tahlili: ${input.incidents.length} ta ochiq hodisa, ${input.checks.length} ta tekshiruv natijasi. Eng og'ir daraja: ${SEVERITIES[4 - worst]}.`,
    items,
  });
}

/* ───────────────────────── Claude chaqiruvi ───────────────────────── */

const SYSTEM = `Siz Insof ERP platformasining kiberxavfsizlik tahlilchisisiz (Ubuntu 22.04 server, nginx, Next.js ilovalar, PostgreSQL; har korxona alohida jarayon va baza).
Sizga monitoring agentining ochiq hodisalari va tekshiruv natijalari JSON ko'rinishida beriladi (sirlar va shaxsiy ma'lumotlar yashirilgan).
Vazifa: serverning umumiy xavfsizlik holatini baholash va ustuvor, amaliy tavsiyalar berish.
Qoidalar:
- Faqat berilgan ma'lumotga tayaning; taxminni taxmin deb ayting. Ma'lumot yetarli bo'lmasa, buni ham tavsiya sifatida yozing.
- grade: A (juda yaxshi) … F (jiddiy xavf, darhol choralar kerak).
- summary: o'zbek tilida (lotin yozuvi), 600 belgidan oshmasin, eng muhim 2–3 xulosa.
- items: eng muhimidan boshlab, ko'pi bilan 10 ta. title qisqa; why — nega xavfli; fix — aniq qadamlar (buyruqlar bo'lsa qisqa). Hammasi o'zbek tilida (lotin).
- actionType: faqat panel avtomatik bajara oladigan amal mos kelsa (${ACTION_TYPES.join(", ")}), aks holda "NONE".
- Bir xil muammoni takrorlamang; INFO darajadagi "hammasi joyida" natijalarni tavsiyaga aylantirmang.`;

function apiKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  if (k) return k;
  const file = process.env.CONTROL_ENV_FILE;
  if (!file) return null;
  try { return parseEnv(readFileSync(file, "utf8")).get("ANTHROPIC_API_KEY")?.trim() || null; } catch { return null; }
}

/** Server tomonidagi zaxira model (refusal bo'lsa) — faqat buni qo'llaydigan modellarda. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

async function callClaude(model: string, key: string, inputText: string): Promise<{ report: AiReportT; usage: Record<string, number> } | null> {
  const client = new Anthropic({ apiKey: key, timeout: 180_000, maxRetries: 2 });
  const useFallback = FALLBACK_MODELS.has(model) && process.env.CONTROL_AI_FALLBACK !== "0";
  const res = await client.beta.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    messages: [{ role: "user", content: `Monitoring ma'lumotlari (JSON):\n${inputText}` }],
  });
  if (res.stop_reason === "refusal") { log(`model rad etdi (${res.stop_details?.category ?? "?"})`); return null; }
  if (res.stop_reason === "max_tokens") { log("javob max_tokens da kesildi"); return null; }
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { log("javob JSON emas"); return null; }
  const parsed = AiReport.safeParse(raw);
  if (!parsed.success) { log(`javob sxemaga mos emas: ${parsed.error.issues[0]?.message ?? ""}`); return null; }
  return { report: parsed.data, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
}

/* ───────────────────────── Saqlash ───────────────────────── */

export const aiIncidentKey = (title: string) => `ai:${createHash("sha1").update(title.trim().toLowerCase()).digest("hex").slice(0, 12)}`;

export async function saveReport(trigger: "scheduled" | "manual", model: string, report: AiReportT, inputMeta: Record<string, unknown>, requestedById?: string) {
  const row = await control.securityReport.create({
    data: {
      trigger, model, grade: report.grade, summary: report.summary,
      items: report.items.map((i) => ({ title: i.title, severity: i.severity, why: i.why, fix: i.fix, ...(i.actionType ? { actionType: i.actionType } : {}) })),
      inputMeta: inputMeta as object, requestedById: requestedById ?? null,
    },
  });
  // HIGH/CRITICAL → hodisa (xuddi shu kalit yoki sarlavha bilan ochiq hodisa bo'lmasa)
  const serious = report.items.filter((i) => i.severity === "HIGH" || i.severity === "CRITICAL");
  if (serious.length) {
    const open = await control.incident.findMany({ where: { status: { in: ["OPEN", "ACKED"] } }, select: { key: true, title: true } });
    const keys = new Set(open.map((o) => o.key));
    const titles = new Set(open.map((o) => o.title.trim().toLowerCase()));
    for (const i of serious) {
      const key = aiIncidentKey(i.title);
      if (keys.has(key) || titles.has(i.title.trim().toLowerCase())) continue;
      keys.add(key);
      const act = i.actionType && PARAMLESS.has(i.actionType) ? [{ type: i.actionType, params: {}, label: i.fix.slice(0, 80) }] : undefined;
      await control.incident.create({
        data: { key, source: "ai", category: "security", severity: i.severity, title: i.title, detail: { why: i.why, fix: i.fix, reportId: row.id }, ...(act ? { suggestedActions: act } : {}) },
      });
    }
  }
  return row;
}

export async function runAiAnalysis(trigger: "scheduled" | "manual", requestedById?: string): Promise<{ id: string } | null> {
  try {
    const { input, text, truncated } = await gatherInput();
    const inputMeta: Record<string, unknown> = { incidents: input.incidents.length, checks: input.checks.length, tenants: input.tenants, chars: text.length, truncated };

    if (isTestMode()) {
      // Test rejimida tashqi API yo'q — natija kirishdan deterministik
      const row = await saveReport(trigger, STUB_MODEL, stubReport(input), { ...inputMeta, stub: true }, requestedById);
      return { id: row.id };
    }
    const key = apiKey();
    if (!key) { log("ANTHROPIC_API_KEY yo'q (control.env) — AI tahlil o'tkazilmadi"); return null; }
    const model = process.env.CONTROL_AI_MODEL?.trim() || DEFAULT_AI_MODEL;
    const r = await callClaude(model, key, text);
    if (!r) return null;
    const row = await saveReport(trigger, model, r.report, { ...inputMeta, usage: r.usage }, requestedById);
    log(`hisobot ${row.id}: baho ${r.report.grade}, ${r.report.items.length} tavsiya`);
    return { id: row.id };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) log("ANTHROPIC_API_KEY noto'g'ri");
    else if (e instanceof Anthropic.RateLimitError) log("API chegarasi (429) — keyinroq");
    else if (e instanceof Anthropic.APIError) log(`API xatosi ${e.status}: ${e.message.slice(0, 200)}`);
    else log(`xato: ${errMsg(e, 200)}`);
    return null;
  }
}
