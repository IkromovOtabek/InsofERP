/**
 * Infratuzilma (zaxira, server tizimi, korxonani serverda ishga tushirish) — panel ↔ insof-agent shartnomasi.
 * Bu fayl brauzerda ham ishlatiladi: Prisma/Node moduli YO'Q. Amal turlari monitor/contract.ts dagi ACTION_TYPES ga
 * qo'shiladi; parametrlar shu yerdagi qat'iy regex/oq ro'yxat bilan tekshiriladi (panel ham, agent ham).
 */

export const INFRA_ACTION_TYPES = [
  "RUN_RESTORE_TEST",    // {} — scripts/restore-test.sh (deploy, sudo'siz)
  "REBOOT",              // { at?: "now" | "HH:MM" } — sudo shutdown -r (+1 | HH:MM)
  "REBOOT_CANCEL",       // {} — sudo shutdown -c
  "CLEAN_RELEASES",      // {} — releases/: oxirgi 3 tadan eskisi (current'ga tegilmaydi), deploy, sudo'siz
  "JOURNAL_VACUUM",      // {} — sudo journalctl --vacuum-time=14d
  "TENANT_UP",           // { slug, domain? } — sudo /usr/local/sbin/insof-tenant-up <slug> [domain]
] as const;
export type InfraActionType = (typeof INFRA_ACTION_TYPES)[number];

/** Sudo yoki tizimga ta'sir qiladigan amallar — test rejimida (INSOF_ENV=test) agent bajarmaydi. */
export const INFRA_PRIVILEGED: readonly InfraActionType[] = ["RUN_RESTORE_TEST", "REBOOT", "REBOOT_CANCEL", "CLEAN_RELEASES", "JOURNAL_VACUUM", "TENANT_UP"];

export function isInfraActionType(t: string): t is InfraActionType {
  return (INFRA_ACTION_TYPES as readonly string[]).includes(t);
}

/** provision.ts SLUG_RE bilan bir xil (korxona qisqa nomi). */
export const TENANT_SLUG_RE = /^[a-z][a-z0-9-]{1,29}$/;
/** Domen: kichik harf, har yorliq 1–63 belgi (chiziqcha bilan boshlanmaydi/tugamaydi), TLD 2–24 harf, jami ≤ 253. */
export const TENANT_DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
/** Qayta yuklash vaqti: "now" yoki 24 soatlik HH:MM. */
export const REBOOT_AT_RE = /^(now|([01]\d|2[0-3]):[0-5]\d)$/;
/** Releases: shuncha eng yangisi saqlanadi (+ current, agar u ular orasida bo'lmasa). deploy.sh KEEP_RELEASES bilan bir xil. */
export const KEEP_RELEASES = 3;
export const JOURNAL_KEEP = "14d";

/** Xavfli amallarda yoziladigan so'z (server action ham tekshiradi). */
export const CONFIRM_WORD = "TASDIQLAYMAN";

/**
 * Infra amallari uchun tasdiqlash matni: undefined — infra amali emas (monitor/shared.ts davom etadi),
 * null — oddiy tasdiq, satr — aynan shuni yozish kerak.
 */
export function infraConfirmPhrase(type: string, params: Record<string, unknown>): string | null | undefined {
  if (!isInfraActionType(type)) return undefined;
  if (type === "REBOOT" || type === "CLEAN_RELEASES" || type === "JOURNAL_VACUUM") return CONFIRM_WORD;
  if (type === "TENANT_UP") return typeof params.slug === "string" ? params.slug : "";
  return null;
}

/**
 * Domen siyosati: faqat TENANT_BASE_DOMAIN ostida (yoki o'zi) yoki TENANT_DOMAINS (vergul bilan) ro'yxatida.
 * Ikkalasi ham bo'sh bo'lsa — hech qanday domen ruxsat etilmaydi (korxona domensiz ishga tushadi).
 */
export function domainAllowed(domain: string, base: string | undefined | null, list: string | undefined | null): boolean {
  if (!TENANT_DOMAIN_RE.test(domain)) return false;
  const b = (base ?? "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (b && TENANT_DOMAIN_RE.test(b) && (domain === b || domain.endsWith(`.${b}`))) return true;
  const allowed = (list ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(domain);
}

export const domainPolicyFromEnv = (env: Record<string, string | undefined> = process.env) =>
  ({ base: env.TENANT_BASE_DOMAIN ?? "", list: env.TENANT_DOMAINS ?? "" });

export type InfraValid = { ok: true; params: Record<string, string> } | { ok: false; reason: string };

/**
 * Infra amali parametrlarini oq ro'yxat bo'yicha tekshirish. Faqat ma'lum kalitlar olinadi, qolgani tashlanadi.
 * `policy` — domen siyosati (panelda ham, agentda ham control.env dan).
 */
export function validateInfraParams(type: InfraActionType, raw: Record<string, unknown>, policy = domainPolicyFromEnv()): InfraValid {
  if (type === "REBOOT") {
    const at = raw.at ?? "now";
    if (typeof at !== "string" || !REBOOT_AT_RE.test(at)) return { ok: false, reason: "at noto'g'ri (faqat \"now\" yoki HH:MM)" };
    return { ok: true, params: { at } };
  }
  if (type === "TENANT_UP") {
    const slug = raw.slug;
    if (typeof slug !== "string" || !TENANT_SLUG_RE.test(slug)) return { ok: false, reason: "slug noto'g'ri (lotin kichik harf, raqam, chiziqcha; 2–30)" };
    const domain = raw.domain;
    if (domain === undefined || domain === null || domain === "") return { ok: true, params: { slug } };
    if (typeof domain !== "string" || !TENANT_DOMAIN_RE.test(domain)) return { ok: false, reason: "domen noto'g'ri" };
    if (!domainAllowed(domain, policy.base, policy.list)) {
      return { ok: false, reason: `domen ${domain} ruxsat etilmagan: faqat ${policy.base ? `*.${policy.base}` : "TENANT_BASE_DOMAIN"} yoki TENANT_DOMAINS ro'yxati (control.env)` };
    }
    return { ok: true, params: { slug, domain } };
  }
  return { ok: true, params: {} };
}

/** "HH:MM" — bugunmi yoki ertagami (shutdown(8) o'tib ketgan vaqtni ertaga deb oladi). */
export function rebootWhen(at: string, now = new Date()): { label: string; date: Date } {
  if (at === "now") return { label: "1 daqiqadan keyin", date: new Date(now.getTime() + 60_000) };
  const [h, m] = at.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now.getTime()) { d.setDate(d.getDate() + 1); return { label: `ertaga ${at}`, date: d }; }
  return { label: `bugun ${at}`, date: d };
}

/* ───────────────────────── ServiceCheck kalitlari va data shakli ───────────────────────── */

export const infraKey = {
  backup: () => "backup:inventory",
  system: () => "host:system",
};

export type BackupCopy = {
  name: string;               // 2026-10-06_0230
  at: string | null;          // nomdan (ISO)
  bytes: number;
  files: { name: string; bytes: number }[];
  sha256sums: boolean;
  remote: boolean | null;     // masofada bormi (null — masofa tekshirilmagan)
};
export type RunLog = {
  status: "OK" | "FAILED" | "UNKNOWN";
  at: string | null;          // oxirgi qatordagi vaqt
  summary: string | null;     // yakuniy qator
  tail: string[];             // shu ishga tushishning oxirgi qatorlari (≤ 40)
};
export type RemoteInfo = {
  kind: string;               // rclone | restic | local | none
  target: string | null;      // gdrive:insof-backup/prod
  ok: boolean | null;         // null — tekshirilmadi
  error: string | null;
  checkedAt: string | null;
  copies: string[];           // masofadagi nusxa papkalari (yangisi oxirida, ≤ 60)
  latest: string | null;
  quota: { total: number | null; used: number | null; free: number | null; trashed: number | null } | null;
};
export type DiskForecast = {
  mount: string;
  total: number; used: number; avail: number; pct: number | null;
  backupsBytes: number;           // hozirgi mahalliy nusxalar jami
  avgCopyBytes: number | null;    // oxirgi 7 nusxaning o'rtachasi
  keepDays: number;               // KEEP_DAYS
  steadyStateBytes: number | null; // keepDays × o'rtacha — saqlash muddati to'lganda nusxalar egallaydigan joy
  growthPerDay: number | null;    // disk bandligi o'sishi (HostSnapshot, ≤ 7 kun)
  daysToFull: number | null;
  sampleDays: number | null;
};
export type BackupInventory = {
  dir: string;
  copies: BackupCopy[];           // yangisi birinchi
  partial: string[];              // tugallanmagan (*.partial)
  lastBackup: RunLog;
  lastRestoreTest: RunLog;
  remote: RemoteInfo;
  disk: DiskForecast | null;
  problems: string[];
};

export type DirUsage = { label: string; path: string; bytes: number | null; note?: string };
export type ReleaseInfo = { name: string; mtime: string; current: boolean; bytes: number | null };
export type SystemInfo = {
  os: string | null;
  kernel: string;
  pendingKernel: string | null;   // /boot dagi eng yangi yadro (ishlayotgandan farq qilsa)
  rebootRequired: boolean;
  rebootPkgs: string[];
  scheduledShutdown: { at: string; mode: string } | null;
  uptimeSec: number;
  bootedAt: string;
  updates: { total: number; security: number; securityPkgs: string[]; checkedAt: string | null; error: string | null } | null;
  aptListsAt: string | null;      // apt ro'yxati oxirgi yangilangan (apt update)
  unattended: { installed: boolean; enabled: boolean | null; active: string | null; periodic: boolean | null; lastRun: string | null; lastLine: string | null } | null;
  dirs: DirUsage[];
  releases: ReleaseInfo[];
  journalBytes: number | null;
  problems: string[];
};

/* ───────────────────────── Yorliqlar (brauzer uchun) ───────────────────────── */

export const INFRA_ACTION_LABEL: Record<InfraActionType, string> = {
  RUN_RESTORE_TEST: "Tiklash sinovi",
  REBOOT: "Serverni qayta yuklash",
  REBOOT_CANCEL: "Qayta yuklashni bekor qilish",
  CLEAN_RELEASES: "Eski relizlarni o'chirish",
  JOURNAL_VACUUM: "Jurnalni tozalash (14 kun)",
  TENANT_UP: "Korxonani serverda ishga tushirish",
};

export const INFRA_ACTION_DESCR: Record<InfraActionType, string> = {
  RUN_RESTORE_TEST: "Oxirgi nusxadagi har dump vaqtinchalik bazaga tiklanadi, jadval va qatorlar tekshiriladi, baza o'chiriladi (bir necha daqiqa).",
  REBOOT: "Server qayta yuklanadi: barcha korxonalar 1–3 daqiqa ishlamaydi. Telegram'ga oldindan xabar yuboriladi.",
  REBOOT_CANCEL: "Rejalashtirilgan qayta yuklash bekor qilinadi (shutdown -c).",
  CLEAN_RELEASES: `releases/ dagi eng yangi ${KEEP_RELEASES} ta va joriy (current) relizdan boshqalari o'chiriladi. Ulardan orqaga qaytib bo'lmaydi.`,
  JOURNAL_VACUUM: `systemd jurnalidan ${JOURNAL_KEEP.replace("d", " kun")}dan eski yozuvlar o'chiriladi.`,
  TENANT_UP: "systemd xizmati (insof-erp@<slug>), /api/health, nginx sayti va SSL sertifikati sozlanadi. Qayta bajarilsa zarari yo'q.",
};
