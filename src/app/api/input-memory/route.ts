import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { MEMORY_KEY_MAX, MEMORY_SUGGEST_LIMIT, memoryValue } from "@/lib/input-memory";

/** Bitta so'rovda nechta maydon (GET) yoki qiymat (POST). */
const MAX_KEYS = 30;

const validKey = (k: unknown): k is string => typeof k === "string" && k.length > 0 && k.length <= MEMORY_KEY_MAX && k.includes(":");

/**
 * Maydon takliflari. Ikki ro'yxat birlashtiriladi: eng ko'p ishlatilganlar va eng oxirgilari —
 * aks holda yangi qiymat (1 marta) hech qachon eski ko'p ishlatilganlar orasiga chiqmasdi.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Tizimga kiring" }, { status: 401 });
  const keys = [...new Set(new URL(req.url).searchParams.getAll("key"))].filter(validKey).slice(0, MAX_KEYS);
  const half = MEMORY_SUGGEST_LIMIT / 2;
  const out: Record<string, string[]> = {};
  await Promise.all(keys.map(async (key) => {
    const [top, recent] = await Promise.all([
      db.inputMemory.findMany({ where: { key }, orderBy: [{ count: "desc" }, { lastUsedAt: "desc" }], take: half, select: { value: true } }),
      db.inputMemory.findMany({ where: { key }, orderBy: { lastUsedAt: "desc" }, take: half, select: { value: true } }),
    ]);
    out[key] = [...new Set([...recent, ...top].map((r) => r.value))];
  }));
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}

/** Forma saqlanganda brauzer yuboradi: `{ items: [{ key, value }] }`. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Tizimga kiring" }, { status: 401 });
  let body: { items?: { key?: unknown; value?: unknown }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "So'rov o'qilmadi" }, { status: 400 }); }
  const items = new Map<string, { key: string; value: string }>();
  for (const it of (Array.isArray(body.items) ? body.items : []).slice(0, MAX_KEYS)) {
    const value = typeof it?.value === "string" ? memoryValue(it.value) : null;
    if (!validKey(it?.key) || !value) continue;
    items.set(`${it.key}\n${value}`, { key: it.key, value });
  }
  // Bir vaqtda ikki xodim bir xil qiymatni saqlasa ham poyga bo'lmaydi — ON CONFLICT
  for (const { key, value } of items.values()) {
    await db.$executeRaw`
      INSERT INTO "InputMemory" ("id", "key", "value") VALUES (${"im" + crypto.randomUUID().replace(/-/g, "")}, ${key}, ${value})
      ON CONFLICT ("key", "value") DO UPDATE SET "count" = "InputMemory"."count" + 1, "lastUsedAt" = now()`;
  }
  return NextResponse.json({ ok: true, saved: items.size });
}
