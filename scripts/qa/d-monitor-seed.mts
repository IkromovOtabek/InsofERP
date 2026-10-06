/**
 * QA: IT panel monitoringi uchun soxta, lekin real ko'rinishdagi ma'lumot — FAQAT test control bazasiga.
 *   CONTROL_DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_ctl_ui npx tsx scripts/qa/d-monitor-seed.mts
 *   --empty  — monitoring jadvallarini tozalab qo'yadi (bo'sh holat / "agent o'rnatilmagan" sinovi uchun)
 *
 * Nima yoziladi: 2 korxona (alfa, beta), 1 soatlik HostSnapshot (har 15 s), OK/WARN/CRIT tekshiruvlar,
 * har manbadan (monitor/security/ai) hodisalar, har holatdagi AgentAction, 2 ta SecurityReport, agent heartbeat.
 * Har ishga tushishda monitoring jadvallari va seed korxonalari qaytadan yoziladi (superadminlarga tegilmaydi).
 */
import { PrismaClient } from "../../src/generated/control/index.js";

const url = process.env.CONTROL_DATABASE_URL ?? "";
const dbName = (() => { try { return new URL(url).pathname.slice(1); } catch { return ""; } })();
if (!/^insof_test(_[a-z0-9]+)+$/.test(dbName) || dbName === "insof_test_golden") {
  console.error(`[seed] CONTROL_DATABASE_URL test bazasi emas (insof_test_…): "${dbName}"`);
  process.exit(2);
}
const db = new PrismaClient({ datasourceUrl: url });
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);
const MIN = 60_000, H = 60 * MIN, GB = 1024 ** 3;

async function wipe() {
  await db.agentAction.deleteMany();
  await db.incident.deleteMany();
  await db.serviceCheck.deleteMany();
  await db.hostSnapshot.deleteMany();
  await db.agentHeartbeat.deleteMany();
  await db.securityReport.deleteMany();
}

async function main() {
  await wipe();
  if (process.argv.includes("--empty")) { console.log("[seed] monitoring jadvallari bo'sh"); return; }

  const admin = await db.superAdmin.findFirst({ orderBy: { createdAt: "asc" } });
  const tenants = [];
  for (const [i, slug, name, status] of [[0, "alfa", "Alfa Beton MChJ", "ACTIVE"], [1, "beta", "Beta Qurilish", "ACTIVE"]] as const) {
    tenants.push(await db.tenant.upsert({
      where: { slug },
      update: { name, status, lastError: slug === "beta" ? "Veb: javob yo'q (4s)" : null },
      create: { slug, name, status, domain: `${slug}.insof.test`, internalUrl: `http://127.0.0.1:${3271 + i}`, port: 3271 + i, dbName: `${dbName}_${slug}`, lastError: slug === "beta" ? "Veb: javob yo'q (4s)" : null },
    }));
  }
  const [alfa, beta] = tenants;

  // ── 1 soatlik server surati (har 15 s = 240 nuqta), sekin o'suvchi disk va to'lqinli CPU ──
  const pts = 240;
  await db.hostSnapshot.createMany({
    data: Array.from({ length: pts }, (_, k) => {
      const t = ago((pts - 1 - k) * 15_000);
      const cpu = 18 + 14 * Math.sin(k / 9) + (k % 17 === 0 ? 45 : 0) + Math.random() * 6;
      return {
        hostname: "insof-vps", takenAt: t, cpuPct: Math.min(99, Math.max(1, cpu)),
        load1: 0.4 + cpu / 40, load5: 0.5 + cpu / 60, load15: 0.6 + cpu / 90,
        memTotal: BigInt(8 * GB), memUsed: BigInt(Math.round((4.6 + Math.sin(k / 20) * 0.6) * GB)),
        swapTotal: BigInt(2 * GB), swapUsed: BigInt(Math.round(0.1 * GB)),
        diskTotal: BigInt(160 * GB), diskUsed: BigInt(Math.round((131 + k * 0.004) * GB)),
        uptimeSec: 12 * 86400 + k * 15,
        netRxBps: BigInt(Math.round(180_000 + 90_000 * Math.sin(k / 6) + Math.random() * 40_000)),
        netTxBps: BigInt(Math.round(420_000 + 150_000 * Math.cos(k / 7) + Math.random() * 60_000)),
        extra: { cpus: 4, procs: 212 },
      };
    }),
  });
  await db.agentHeartbeat.create({ data: { id: "main", hostname: "insof-vps", version: "1.0.0", startedAt: ago(3 * H), lastSeenAt: ago(5_000), info: { node: "v22.11.0" } } });

  // ── Tekshiruvlar ──
  const chk = (key: string, kind: string, target: string, status: "OK" | "WARN" | "CRIT" | "UNKNOWN", o: { message?: string; latencyMs?: number; data?: object; tenantId?: string; since?: number } = {}) => ({
    key, kind, target, status, message: o.message ?? null, latencyMs: o.latencyMs ?? null, data: o.data, tenantId: o.tenantId ?? null,
    checkedAt: ago(8_000), changedAt: ago(o.since ?? 26 * H),
  });
  await db.serviceCheck.createMany({
    data: [
      chk("unit:insof-erp@alfa", "unit", "insof-erp@alfa", "OK", { message: "active (running)", tenantId: alfa.id }),
      chk("unit:insof-erp@beta", "unit", "insof-erp@beta", "CRIT", { message: "failed (Result: exit-code)", tenantId: beta.id, since: 14 * MIN }),
      chk("unit:insof-control", "unit", "insof-control", "OK", { message: "active (running)" }),
      chk("unit:insof-eco", "unit", "insof-eco", "OK", { message: "active (running)" }),
      chk("unit:nginx", "unit", "nginx", "OK", { message: "active (running)" }),
      chk("db:postgres", "db", "PostgreSQL 16", "OK", { latencyMs: 3, message: "42 ulanish / 100" }),
      chk("http:eco", "http", "ECO API", "WARN", { latencyMs: 2350, message: "sekin javob (>2 s)", since: 40 * MIN }),
      chk("http:tenant:alfa", "http", "alfa.insof.test", "OK", { latencyMs: 84, tenantId: alfa.id, data: { version: "d12a016" } }),
      chk("http:tenant:beta", "http", "beta.insof.test", "CRIT", { message: "javob yo'q (4s)", tenantId: beta.id, since: 14 * MIN, data: { version: "5b81afa" } }),
      chk("db:tenant:alfa", "db", "insof_t_alfa", "OK", { latencyMs: 4, tenantId: alfa.id }),
      chk("db:tenant:beta", "db", "insof_t_beta", "OK", { latencyMs: 6, tenantId: beta.id }),
      chk("ssl:insof-erp.uz", "ssl", "insof-erp.uz", "OK", { data: { daysLeft: 54 } }),
      chk("ssl:admin.insof-erp.uz", "ssl", "admin.insof-erp.uz", "WARN", { data: { daysLeft: 9 }, message: "9 kunda tugaydi" }),
      chk("backup:latest", "backup", "Kunlik zaxira", "OK", { data: { ageHours: 5.5, sizeBytes: 734_003_200 }, message: "insof-2026-10-06.tar.zst" }),
      chk("host:disk", "disk", "Disk /", "WARN", { message: "Disk 82% band" }),
      chk("host:memory", "memory", "Xotira", "OK"),
      chk("security:ssh", "security", "SSH sozlamasi", "WARN", { message: "PasswordAuthentication yes" }),
      chk("agent:heartbeat", "agent", "insof-agent", "OK"),
    ],
  });

  // ── Hodisalar (har manba va holat) ──
  const inc = (o: Record<string, unknown>) => db.incident.create({ data: o as never });
  const iBeta = await inc({ key: "http:tenant:beta", source: "monitor", category: "availability", severity: "CRITICAL", title: "Beta Qurilish: veb javob bermayapti", tenantId: beta.id, count: 57, firstSeenAt: ago(14 * MIN), lastSeenAt: ago(10_000), detail: { url: "http://127.0.0.1:3272/login", error: "javob yo'q (4s)", unit: "failed" }, suggestedActions: [{ type: "RESTART_UNIT", params: { unit: "insof-erp@beta" }, label: "insof-erp@beta ni qayta ishga tushirish" }] });
  await inc({ key: "http:eco", source: "monitor", category: "performance", severity: "MEDIUM", title: "ECO API sekin javob bermoqda (2.3 s)", count: 12, firstSeenAt: ago(40 * MIN), lastSeenAt: ago(30_000), detail: { p95: 2350 } });
  await inc({ key: "ssl:admin.insof-erp.uz", source: "monitor", category: "certificate", severity: "HIGH", title: "admin.insof-erp.uz sertifikati 9 kunda tugaydi", status: "ACKED", ackedById: admin?.id, ackedAt: ago(2 * H), firstSeenAt: ago(26 * H), lastSeenAt: ago(MIN), suggestedActions: [{ type: "RENEW_CERT", params: {}, label: "Sertifikatni yangilash" }] });
  await inc({ key: "security:ssh-bruteforce", source: "security", category: "security", severity: "HIGH", title: "SSH: 203.0.113.45 dan 1200 ta muvaffaqiyatsiz urinish", count: 3, firstSeenAt: ago(50 * MIN), lastSeenAt: ago(4 * MIN), detail: { ip: "203.0.113.45", attempts: 1200, window: "1h" }, suggestedActions: [{ type: "BLOCK_IP", params: { ip: "203.0.113.45" }, label: "203.0.113.45 ni bloklash" }] });
  await inc({ key: "security:secret-perms", source: "security", category: "config", severity: "MEDIUM", title: "tenants/beta.env boshqalar o'qiy oladi (644)", firstSeenAt: ago(3 * H), lastSeenAt: ago(5 * MIN), detail: { file: "tenants/beta.env", mode: "644" }, suggestedActions: [{ type: "FIX_SECRET_PERMS", params: {} }] });
  await inc({ key: "ai:ssh-password", source: "ai", category: "security", severity: "LOW", title: "SSH parol bilan kirish yoqilgan — kalitga o'tish tavsiya etiladi", firstSeenAt: ago(5 * H), lastSeenAt: ago(5 * H), detail: { reportGrade: "B" } });
  await inc({ key: "backup:latest", source: "monitor", category: "backup", severity: "HIGH", title: "Zaxira 30 soatdan beri olinmagan", status: "RESOLVED", firstSeenAt: ago(30 * H), lastSeenAt: ago(7 * H), resolvedAt: ago(6 * H), detail: { ageHours: 30 } });
  await inc({ key: "update:packages", source: "security", category: "update", severity: "INFO", title: "14 ta paket yangilanishi mavjud (2 tasi xavfsizlik)", firstSeenAt: ago(8 * H), lastSeenAt: ago(H) });

  // ── Amallar (har holat) ──
  const act = (o: Record<string, unknown>) => db.agentAction.create({ data: { requestedById: admin?.id ?? null, ...o } as never });
  await act({ type: "RUN_SECURITY_SCAN", status: "PENDING", requestedAt: ago(2 * MIN) });
  await act({ type: "RUN_BACKUP", status: "RUNNING", requestedAt: ago(2 * MIN), startedAt: ago(110_000) });
  await act({ type: "BLOCK_IP", params: { ip: "198.51.100.7" }, status: "DONE", requestedAt: ago(5 * H), startedAt: ago(5 * H - 3000), finishedAt: ago(5 * H - 4000), output: "ufw insert 1 deny from 198.51.100.7\nRule inserted" });
  await act({ type: "BLOCK_IP", params: { ip: "198.51.100.8" }, status: "DONE", requestedAt: ago(4 * H), startedAt: ago(4 * H - 2000), finishedAt: ago(4 * H - 2500), output: "Rule inserted" });
  await act({ type: "UNBLOCK_IP", params: { ip: "198.51.100.8" }, status: "DONE", requestedAt: ago(3 * H), startedAt: ago(3 * H - 2000), finishedAt: ago(3 * H - 2400), output: "Rule deleted" });
  await act({ type: "RENEW_CERT", status: "FAILED", requestedAt: ago(26 * H), startedAt: ago(26 * H - 1000), finishedAt: ago(26 * H - 21000), output: "certbot renew\nChallenge failed for domain admin.insof-erp.uz\nexit code 1" });
  await act({ type: "RESTART_UNIT", params: { unit: "insof-erp@beta" }, status: "DONE", incidentId: iBeta.id, requestedAt: ago(10 * MIN), startedAt: ago(10 * MIN - 2000), finishedAt: ago(10 * MIN - 9000), output: "systemctl restart insof-erp@beta\nJob failed: see journalctl -u insof-erp@beta" });
  await act({ type: "RESTART_UNIT", params: { unit: "sshd" }, status: "REJECTED", requestedAt: ago(30 * H), finishedAt: ago(30 * H - 500), output: "unit oq ro'yxatda yo'q", requestedById: null });

  // ── AI hisobotlar ──
  await db.securityReport.create({ data: { createdAt: ago(7 * 24 * H), trigger: "scheduled", model: "claude-sonnet-4-5", grade: "C", summary: "Zaxira eskirgan, SSH parol bilan ochiq, 3 ta maxfiy fayl huquqi keng.", items: [{ title: "Zaxira 30 soat", severity: "HIGH", why: "Ma'lumot yo'qolishi", fix: "Zaxirani tiklang", actionType: "RUN_BACKUP" }] } });
  await db.securityReport.create({
    data: {
      createdAt: ago(5 * H), trigger: "manual", model: "claude-sonnet-4-5", grade: "B", requestedById: admin?.id,
      summary: "Umumiy holat yaxshi. Asosiy xavf — SSH'ga parol tanlash hujumi (203.0.113.45) va beta.env fayli huquqi. Sertifikat 9 kunda tugaydi.",
      items: [
        { title: "203.0.113.45 dan SSH parol tanlash", severity: "HIGH", why: "1 soatda 1200 urinish — avtomatlashtirilgan hujum", fix: "IP ni bloklang va SSH'da parolni o'chiring", actionType: "BLOCK_IP", params: { ip: "203.0.113.45" } },
        { title: "tenants/beta.env 644", severity: "MEDIUM", why: "Serverdagi boshqa foydalanuvchilar baza parolini o'qiy oladi", fix: "chmod 600", actionType: "FIX_SECRET_PERMS" },
        { title: "SSH PasswordAuthentication yes", severity: "LOW", why: "Parol tanlashga ochiq", fix: "/etc/ssh/sshd_config: PasswordAuthentication no (qo'lda)" },
      ],
      inputMeta: { findings: 7, bytes: 5120 },
    },
  });
  console.log(`[seed] tayyor: ${pts} surat, 18 tekshiruv, 8 hodisa, 8 amal, 2 hisobot (${dbName})`);
}

main().then(() => db.$disconnect(), async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
