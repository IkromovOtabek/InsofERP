/**
 * Marketing boshlang'ich ma'lumoti: docs/marketing/03-kontent-reja.md (Reels + postlar) va
 * docs/marketing/04-seo-semantik-yadro.md (semantik yadro) → MarketingContent / SeoKeyword.
 * Qayta ishga tushirish xavfsiz — mavjud yozuvlar takrorlanmaydi va o'zgartirilmaydi.
 *   npm run marketing:seed
 *   ENV_FILE=tenants/<slug>.env npm run marketing:seed   — boshqa korxona bazasiga
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "./env";
loadEnv();

const DIR = resolve(process.cwd(), "docs/marketing");
const read = (f: string) => (existsSync(resolve(DIR, f)) ? readFileSync(resolve(DIR, f), "utf8") : null);
const cells = (line: string) => line.split("|").slice(1, -1).map((c) => c.trim());

async function main() {
  const { db } = await import("@/lib/db");

  // ── Kontent reja ──
  const plan = read("03-kontent-reja.md");
  let content = 0;
  if (plan) {
    // Kalendar qatori: | 1 | 2026-10-20 | Seshanba | 01 Завод изнутри | Sarlavha | … |
    const cal = new Map<number, { date: string; rubric: string }>();
    for (const line of plan.split("\n")) {
      const c = cells(line);
      if (c.length >= 5 && /^\d+$/.test(c[0]!) && /^\d{4}-\d{2}-\d{2}$/.test(c[1]!)) cal.set(Number(c[0]), { date: c[1]!, rubric: c[3]! });
    }
    // Ssenariy bo'limi: ## Reels N — «Sarlavha» (rubrika)
    for (const sec of plan.split(/\n(?=## )/)) {
      const m = sec.match(/^## Reels (\d+) — «(.+?)»/);
      if (!m) continue;
      const title = m[2]!;
      if (await db.marketingContent.findFirst({ where: { title } })) continue;
      const body = sec.split("\n").slice(1).join("\n").trim();
      const meta = cal.get(Number(m[1]));
      await db.marketingContent.create({
        data: {
          title, type: "REELS", status: "SCRIPT", rubric: meta?.rubric ?? null,
          publishDate: meta ? new Date(`${meta.date}T00:00:00Z`) : null,
          hook: body.match(/\*\*Hook[^*]*\*\*\s*(.+)/)?.[1]?.trim() ?? null,
          caption: body.match(/\*\*Izoh \(RU\):\*\*\s*(.+)/)?.[1]?.trim() ?? null,
          script: body, createdBy: "Agentlik rejasi",
        },
      });
      content++;
    }
    // Postlar: | 2026-10-21 | «Sarlavha» — izoh | tavsif |
    for (const line of plan.split("\n")) {
      const c = cells(line);
      if (c.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(c[0]!) || !c[1]!.startsWith("«")) continue;
      const title = c[1]!.replace(/^«/, "").replace(/».*$/, "");
      if (await db.marketingContent.findFirst({ where: { title } })) continue;
      await db.marketingContent.create({ data: { title, type: "POST", status: "IDEA", publishDate: new Date(`${c[0]}T00:00:00Z`), script: c[2]!, createdBy: "Agentlik rejasi" } });
      content++;
    }
  }

  // ── Semantik yadro ──
  const seo = read("04-seo-semantik-yadro.md");
  let kw = 0;
  if (seo) {
    let cluster = "";
    for (const line of seo.split("\n")) {
      const h = line.match(/^### (K\d+\.\s*[^→]+?)\s*(?:→.*)?$/);
      if (h) { cluster = h[1]!.trim(); continue; }
      if (line.startsWith("## ")) { cluster = ""; continue; }
      if (!cluster) continue;
      const c = cells(line);
      const lang = /^uz/i.test(c[1] ?? "") ? "uz" : /^ru/i.test(c[1] ?? "") ? "ru" : null;
      if (c.length < 3 || !lang || !c[0] || c[0] === "So'rov") continue;
      const phrase = c[0].toLowerCase();
      const exists = await db.seoKeyword.findUnique({ where: { phrase_lang: { phrase, lang } } });
      if (exists) continue;
      // Sahifa yo'li saytga ko'chirilganda Marketing → SEO da qo'lda belgilanadi
      await db.seoKeyword.create({ data: { phrase, lang, cluster, intent: c[2] ?? null } });
      kw++;
    }
  }

  console.log(`Kontent: +${content}, kalit so'zlar: +${kw}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
