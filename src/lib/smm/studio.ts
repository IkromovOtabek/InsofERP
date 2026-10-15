/**
 * AI studiya yordamchilari: sahnaga media kutubxonadan mos kadr topish va tavsiya etilgan chiqish vaqti.
 */
import { db } from "@/lib/db";

export const aiRateText = "AI so'rovlari chegarasi — birozdan keyin qayta urinib ko'ring";

export type MediaPick = { id: string; kind: "IMAGE" | "VIDEO"; title: string };

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ'`‘’]/g, "").replace(/[^a-z0-9а-яё]+/gi, " ").trim();

/**
 * Har sahna uchun 4 tagacha nomzod: teg yoki nom mos kelgani yuqorida; Reels'da video kadr afzal.
 * Bitta kadr ketma-ket sahnalarda takrorlanmasligi uchun birinchi nomzod imkon qadar har xil.
 */
export async function matchMedia(sceneTags: string[][], format: "REELS" | "POST" | "STORIES"): Promise<MediaPick[][]> {
  const all = await db.smmMedia.findMany({ orderBy: { createdAt: "desc" }, take: 400, select: { id: true, kind: true, title: true, tags: true } });
  const used = new Set<string>();
  return sceneTags.map((tags) => {
    const want = tags.map(norm).filter(Boolean);
    const scored = all.map((m) => {
      const hay = [...m.tags.map(norm), norm(m.title)];
      let score = 0;
      for (const w of want) for (const h of hay) if (h === w) score += 3; else if (h.includes(w) || w.includes(h)) score += 1;
      if (format === "REELS" && m.kind === "VIDEO") score += 0.5;
      if (format !== "REELS" && m.kind === "IMAGE") score += 0.5;
      if (used.has(m.id)) score -= 2;
      return { m, score };
    }).filter((x) => x.score > 0.5).sort((a, b) => b.score - a.score).slice(0, 4).map((x) => ({ id: x.m.id, kind: x.m.kind, title: x.m.title }));
    if (scored[0]) used.add(scored[0].id);
    return scored;
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Hafta kuni (0 — yakshanba) va HH:MM → kamida 3 soatdan keyingi eng yaqin sana (datetime-local, Toshkent) */
export function nextSlot(weekday: number, time: string, now = new Date()): string {
  const [h, m] = /^\d{1,2}:\d{2}$/.test(time) ? time.split(":").map(Number) as [number, number] : [18, 30];
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(23, h), Math.min(59, m));
  const wd = Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 2;
  let add = (wd - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() - now.getTime() < 3 * 3600_000) add = 7;
  d.setDate(d.getDate() + add);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
