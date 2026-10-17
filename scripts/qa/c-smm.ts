/**
 * QA (C): Marketing / SMM — kutubxona darajasida (serversiz), faqat insof_test… bazasida.
 *   · tokenlar seyfi (shifrlash, buzilgan shifr);
 *   · kalitlar: bazadagi asosiy profil env'dan ustun, uzilgan profil hisobga olinmaydi;
 *   · nashr: bekor qilingan post chiqmaydi, xato postlar navbatni to'smaydi, sinov rejimi SIMULATED;
 *   · AI studiya: tavsiya vaqti, kutubxonadan kadr tanlash;
 *   · statistika tahlili (format, kun, eng yaxshi postlar);
 *   · video montaj (ffmpeg bo'lsa): 1080×1920, H.264 + AAC.
 *
 *   ENV_FILE=.env.test.example npx tsx scripts/qa/c-smm.ts
 */
import { check, done, section } from "./c-lib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { seal, unseal } from "@/lib/smm/vault";
import { resetSmmCreds, smmCreds, smmDryRun } from "@/lib/smm/config";
import { publishContent, publishDue } from "@/lib/smm/publish";
import { matchMedia, nextSlot } from "@/lib/smm/studio";
import { analytics } from "@/lib/smm/insights";
import { assemble, ffmpegReady, renderScene, safeArt, sceneSchema } from "@/lib/smm/video";

const TAG = `qa-smm-${Date.now()}`;

async function main() {
  section("Tokenlar seyfi");
  const s1 = seal("EAAG-test-token");
  check("seal → unseal", unseal(s1) === "EAAG-test-token");
  check("har safar boshqa shifr (tasodifiy iv)", seal("x") !== seal("x"));
  check("buzilgan shifr → null", unseal(s1.slice(0, -2) + (s1.endsWith("A") ? "BB" : "AA")) === null);
  check("bo'sh → null", unseal(null) === null && unseal("v1.x") === null);

  section("Kalitlar manbai");
  process.env.SMM_TELEGRAM_CHAT_ID = "@env_kanal";
  process.env.TELEGRAM_BOT_TOKEN = "111:env";
  await db.smmAccount.deleteMany({ where: { externalId: { startsWith: "qa-" } } });
  resetSmmCreds();
  check("profil yo'q — env ishlatiladi", (await smmCreds()).tgChat === "@env_kanal");
  const acc = await db.smmAccount.create({ data: { channel: "TELEGRAM", externalId: "qa-@db_kanal", name: "QA kanal", tokenEnc: seal("222:db"), isPrimary: true } });
  resetSmmCreds();
  const c1 = await smmCreds();
  check("asosiy profil env'dan ustun", c1.tgChat === "qa-@db_kanal" && c1.tgToken === "222:db", c1.tgChat);
  await db.smmAccount.update({ where: { id: acc.id }, data: { status: "DISCONNECTED", tokenEnc: null, isPrimary: false } });
  resetSmmCreds();
  check("uzilgan profil hisobga olinmaydi", (await smmCreds()).tgChat === "@env_kanal");
  await db.smmAccount.delete({ where: { id: acc.id } });

  section("Nashr dvigateli");
  check("test rejimida sinov (dry-run) yoqiq", smmDryRun());
  const base = { type: "POST" as const, channels: ["TELEGRAM" as const], caption: "QA matn", approval: "APPROVED" as const, createdBy: TAG };
  const cancelled = await db.marketingContent.create({ data: { ...base, title: `${TAG} bekor`, status: "CANCELLED" } });
  const err = await publishContent(cancelled.id, null).then(() => null, (e: Error) => e.message);
  check("bekor qilingan post chiqmaydi", err === "Post bekor qilingan", err);
  check("bekor qilinganda nashr yozuvi yaratilmadi", (await db.smmPublication.count({ where: { contentId: cancelled.id } })) === 0);

  // 22 ta «xato bilan to'xtagan» eski post + 1 ta yangi: yangisi baribir chiqishi kerak (navbat tiqilmasin)
  const old = new Date(Date.now() - 3 * 86_400_000);
  for (let i = 0; i < 22; i++) {
    const c = await db.marketingContent.create({ data: { ...base, title: `${TAG} xato ${i}`, status: "EDITING", scheduledAt: old } });
    await db.smmPublication.create({ data: { contentId: c.id, channel: "TELEGRAM", status: "FAILED", error: "QA" } });
  }
  const fresh = await db.marketingContent.create({ data: { ...base, title: `${TAG} yangi`, status: "EDITING", scheduledAt: new Date(Date.now() - 60_000) } });
  await publishDue(new Date());
  const pub = await db.smmPublication.findUnique({ where: { contentId_channel: { contentId: fresh.id, channel: "TELEGRAM" } } });
  check("xato postlar navbatni to'smaydi — yangi post chiqdi (sinov)", pub?.status === "SIMULATED", pub?.status);
  check("post holati «Chiqdi»", (await db.marketingContent.findUnique({ where: { id: fresh.id } }))?.status === "PUBLISHED");
  const again = await publishContent(fresh.id, null);
  check("ikkinchi marta chiqmaydi", again.every((o) => o.status === "SKIPPED"), again);

  section("AI studiya yordamchilari");
  const mon = new Date(2026, 9, 12, 10, 0); // dushanba 10:00
  check("seshanba 18:30 → ertaga", nextSlot(2, "18:30", mon) === "2026-10-13T18:30");
  check("bugungi kun, 3 soatdan kam qolgan → keyingi hafta", nextSlot(1, "12:00", mon) === "2026-10-19T12:00");
  check("noto'g'ri vaqt → 18:30", nextSlot(5, "xx", mon) === "2026-10-16T18:30");
  const m1 = await db.smmMedia.create({ data: { id: `qa${Date.now()}a1b2c3d4`, kind: "VIDEO", fileName: "qa-yoq.mp4", mime: "video/mp4", size: 1, title: `${TAG} FBS blok quyish`, tags: ["fbs", "zavod"] } });
  const m2 = await db.smmMedia.create({ data: { id: `qa${Date.now()}e5f6a7b8`, kind: "IMAGE", fileName: "qa-yoq.jpg", mime: "image/jpeg", size: 1, title: `${TAG} mikser`, tags: ["mikser", "yetkazish"] } });
  const picks = await matchMedia([["fbs"], ["mikser"], ["kosmos"]], "REELS");
  check("teg bo'yicha kadr topildi", picks[0]?.[0]?.id === m1.id && picks[1]?.[0]?.id === m2.id, picks.map((p) => p[0]?.title));
  check("mos kelmagan sahna — bo'sh", !picks[2]?.some((p) => p.id === m1.id || p.id === m2.id));
  await db.smmMedia.deleteMany({ where: { id: { in: [m1.id, m2.id] } } });

  section("Statistika tahlili");
  const ig = await db.smmAccount.create({ data: { channel: "INSTAGRAM", externalId: "qa-ig", name: "QA IG", username: "qa_ig", isPrimary: true, followers: 1200 } });
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  for (let i = 1; i <= 10; i++) {
    const d = day(i);
    await db.smmAccountDaily.create({ data: { accountId: ig.id, date: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), views: 100 * i, reach: 50 * i, followers: 1200 - i } });
  }
  const posts = [["REELS", 5000, 2], ["REELS", 3000, 4], ["IMAGE", 400, 3], ["IMAGE", 600, 6]] as const;
  for (const [i, [t, v, n]] of posts.entries()) {
    await db.smmPost.create({ data: { accountId: ig.id, externalId: `qa-p${i}`, mediaType: t, postedAt: day(n), views: v, reach: v / 2, likes: v / 50, saves: v / 100, statsAt: new Date(), caption: `${TAG} post ${i}` } });
  }
  const a = await analytics(30);
  check("hisob — asosiy Instagram", a.account?.username === "qa_ig");
  check("ko'rishlar yig'indisi", a.totals.views === 5500, a.totals.views);
  check("obunachi o'sishi", a.totals.followersDelta === 9, a.totals.followersDelta);
  check("Reels birinchi o'rinda", a.byFormat[0]?.type === "REELS" && a.byFormat[0].avgViews === 4000, a.byFormat);
  check("eng ko'p ko'rilgan post", a.top[0]?.views === 5000);
  await db.smmAccount.delete({ where: { id: ig.id } });

  section("Video montaj");
  if (!(await ffmpegReady())) {
    check("ffmpeg yo'q — montaj testi o'tkazib yuborildi", true);
  } else {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-smm-"));
    try {
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:d=4:r=25", "-pix_fmt", "yuv420p", `${dir}/clip.mp4`]);
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "smptebars=s=1200x1600", "-frames:v", "1", `${dir}/img.jpg`]);
      const sa = sceneSchema.parse({ text: "Sifat nazorati — har partiya", kicker: "01", durationSec: 2, transition: "smoothleft" });
      const sb = sceneSchema.parse({ text: "Buyurtma bering", sub: "+998 90 000 00 00", durationSec: 2, layout: "center", anim: "slide-left" });
      const sg = sceneSchema.parse({ text: "Grafik fon", durationSec: 2, art: '<circle cx="540" cy="700" r="200" fill="#fff" fill-opacity="0.3"/>' });
      check("xavfli SVG tashlanadi", safeArt('<image href="file:///etc/passwd"/>') === null && safeArt('<rect fill="url(http://x)"/>') === null && safeArt(sg.art) !== null);
      const la = await renderScene(sa, { file: `${dir}/clip.mp4`, kind: "VIDEO" }, `${dir}/a.mp4`, dir, 0, { accent: "#f59e0b", lead: 0 });
      const lb = await renderScene(sb, { file: `${dir}/img.jpg`, kind: "IMAGE" }, `${dir}/b.mp4`, dir, 1, { accent: "#f59e0b", lead: 0.45 });
      const lg = await renderScene(sg, null, `${dir}/g.mp4`, dir, 2, { accent: "#f59e0b", lead: 0.45 });
      await assemble([{ file: `${dir}/a.mp4`, len: la, transition: sa.transition }, { file: `${dir}/b.mp4`, len: lb, transition: sb.transition }, { file: `${dir}/g.mp4`, len: lg, transition: sg.transition }], `${dir}/f.mp4`);
      const info = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", `${dir}/f.mp4`]).toString();
      const j = JSON.parse(info) as { streams: { codec_name: string; width?: number; height?: number }[]; format: { duration: string } };
      const v = j.streams.find((s) => s.codec_name === "h264");
      check("9:16 H.264", v?.width === 1080 && v?.height === 1920, v);
      check("AAC ovoz yo'lagi bor", j.streams.some((s) => s.codec_name === "aac"));
      check("davomiylik ≈ 6 s (o'tishlar sahna vaqtini yemaydi)", Math.abs(Number(j.format.duration) - 6) < 0.3, j.format.duration);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Tozalash
  await db.marketingContent.deleteMany({ where: { createdBy: TAG } });
  done();
}

main().catch(async (e) => {
  console.error(e);
  await db.marketingContent.deleteMany({ where: { createdBy: TAG } }).catch(() => undefined);
  process.exit(1);
});
