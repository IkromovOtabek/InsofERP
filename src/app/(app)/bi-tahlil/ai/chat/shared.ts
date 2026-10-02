import type { Answer } from "@/lib/bi/ai";
import type { ChatMessage } from "@/lib/bi/ai-chat";

/** Klient tomon uchun serializatsiya qilingan xabar (Date → ISO, boy javob maydonlari ochilgan). */
export type StoredMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  bullets?: string[];
  href?: { label: string; href: string };
  createdAt: string;
};

/** Assistant javobini (matn + bullets + href) content ustuniga JSON bo'lib yoziladi — qayta ochilganda boy ko'rinish saqlansin. */
export function encodeAnswer(a: Answer): string {
  return JSON.stringify({ text: a.text, bullets: a.bullets ?? null, href: a.href ?? null });
}

/** Saqlangan content'ni klient xabariga qaytaradi (eski/oddiy matn ham ishlaydi). */
export function decode(m: ChatMessage): StoredMsg {
  if (m.role === "user") return { id: m.id, role: "user", text: m.content, createdAt: m.createdAt.toISOString() };
  try {
    const p = JSON.parse(m.content) as { text?: unknown; bullets?: unknown; href?: unknown };
    if (p && typeof p.text === "string") {
      return {
        id: m.id,
        role: "assistant",
        text: p.text,
        bullets: Array.isArray(p.bullets) ? (p.bullets as string[]) : undefined,
        href: p.href && typeof p.href === "object" ? (p.href as { label: string; href: string }) : undefined,
        createdAt: m.createdAt.toISOString(),
      };
    }
  } catch {
    /* oddiy matn */
  }
  return { id: m.id, role: "assistant", text: m.content, createdAt: m.createdAt.toISOString() };
}

/** Suhbat ro'yxati elementi (sana ISO bo'lib klientga uzatiladi). */
export type ChatListItem = { id: string; title: string; updatedAt: string };
