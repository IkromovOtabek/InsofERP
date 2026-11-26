/**
 * Eski reyslarni BRU brigadasiga bog'lash — bir martalik. BRU ilgari Logistika sozlamalarida operator ismi bilan yozilgan
 * («HUSAN AKA BRU YANGI ZOVOD», «BEGZOD AKA JBI»…); endi BRU — Otdel kadr komandasidan o'tgan BRU brigadasi (BRU-1, BRU-2).
 * `Trip.bru` matni (nakladnoyda ko'rinadi) o'zgarmaydi, faqat `Trip.bruId` yoziladi — yetkazilgan m³ BRU varag'iga tushadi.
 * Olinadi: BRU si bo'sh reys yoki eski nomdan ochilib yopilgan BRU ga (migratsiya bru_komanda) bog'langan reys / zayavka qatori.
 * Shu reyslar zayavkasining BRU si bo'sh beton qatori ham shu BRU ga bog'lanadi (keyingi reys o'zi tushsin).
 *
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/bru-reys-boglash.ts          (faqat ro'yxat)
 *   ENV_FILE=/var/www/insof-erp/tenants/<slug>.env npx tsx scripts/bru-reys-boglash.ts --yes    (yozish)
 *   ... --map "ELBEK AKA MIXALIFKA BRU=BRU-2"   — qo'shimcha / boshqa moslik (bir necha marta berish mumkin)
 *
 * Sukut moslik — BRU komandalari a'zolari bo'yicha (2026-11-26): Kuchkarov Bekzod, Teshabaev Tohirjon — BRU-1; Mirxidoyatov Xusan — BRU-2.
 * Tegilmaydi: faol BRU ga bog'langan reys/qator. Har o'zgarish AuditLog'ga yoziladi. Oldin pg_dump zaxira oling.
 */
import { loadEnv } from "./env";
loadEnv();

const DEFAULT_MAP: Record<string, string> = {
  "BEGZOD AKA JBI": "BRU-1",
  "TOXIR AKA JBI": "BRU-1",
  "HUSAN AKA BRU YANGI ZOVOD": "BRU-2",
};
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  const { db } = await import("@/lib/db");
  const { auditMany } = await import("@/lib/audit");
  const { dbLabel } = await import("./demo-guard");
  const confirmed = process.argv.includes("--yes");

  const map = new Map(Object.entries(DEFAULT_MAP).map(([k, v]) => [key(k), v]));
  process.argv.forEach((a, i) => {
    if (a !== "--map") return;
    const [from, to] = String(process.argv[i + 1] ?? "").split("=");
    if (!from?.trim() || !to?.trim()) throw new Error(`--map "ESKI NOM=BRU-1" ko'rinishida bering: ${process.argv[i + 1]}`);
    map.set(key(from), to.trim());
  });

  const brus = await db.brigade.findMany({ where: { isBru: true }, select: { id: true, name: true, isActive: true } });
  const bruOf = new Map(brus.filter((b) => b.isActive).map((b) => [key(b.name), b]));
  // Eski nomdan ochilib yopilgan BRU lar (masalan «HUSAN AKA BRU YANGI ZOVOD») — id → yangi BRU
  const oldBru = new Map<string, { id: string; name: string }>();
  const target = new Map<string, { id: string; name: string }>();
  for (const [from, to] of map) {
    const b = bruOf.get(key(to));
    if (!b) { console.log(`! «${to}» BRU brigadasi topilmadi (Brigadalar → Turi: BRU) — «${from}» o'tkazib yuborildi`); continue; }
    target.set(from, b);
  }
  for (const b of brus) if (!b.isActive && target.has(key(b.name))) oldBru.set(b.id, target.get(key(b.name))!);

  const trips = await db.trip.findMany({
    where: { OR: [{ bruId: null, bru: { not: null } }, { bruId: { in: [...oldBru.keys()] } }] },
    select: { id: true, bru: true, bruId: true, orderId: true, status: true },
  });
  const hits = trips.flatMap((t) => { const b = (t.bruId && oldBru.get(t.bruId)) || (t.bru ? target.get(key(t.bru)) : undefined); return b ? [{ t, b }] : []; });
  const oldItems = await db.orderItem.findMany({ where: { bruId: { in: [...oldBru.keys()] } }, select: { id: true, bruId: true } });
  const rest = new Map<string, number>();
  for (const t of trips) if (!hits.some((h) => h.t.id === t.id)) rest.set(t.bru ?? "(nomsiz)", (rest.get(t.bru ?? "(nomsiz)") ?? 0) + 1);

  console.log(`Baza: ${dbLabel()}. BRU si bo'sh yoki eski BRU dagi reys: ${trips.length}, moslik topilgani: ${hits.length}; eski BRU dagi zayavka qatori: ${oldItems.length}\n`);
  const groups = new Map<string, number>();
  for (const h of hits) groups.set(`«${h.t.bru}» → ${h.b.name}`, (groups.get(`«${h.t.bru}» → ${h.b.name}`) ?? 0) + 1);
  for (const [g, n] of groups) console.log(`  ${g} — ${n} ta`);
  if (rest.size) {
    console.log("\nMoslik yo'q (tegilmaydi — kerak bo'lsa --map bilan bering):");
    for (const [n, c] of rest) console.log(`  «${n}» — ${c} ta`);
  }
  if (!hits.length && !oldItems.length) return;
  if (!confirmed) { console.log("\nYozish uchun --yes bilan qayta ishga tushiring."); return; }

  const director = await db.user.findFirst({ where: { role: "DIRECTOR", isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!director) throw new Error("Faol direktor topilmadi — AuditLog uchun foydalanuvchi kerak");
  const res = await db.$transaction(async (tx) => {
    const changed: { id: string; before: unknown; after: unknown }[] = [];
    const orderBru = new Map<string, string>();
    for (const { t, b } of hits) {
      // Shartli: oraliqda qo'lda bog'langan bo'lsa — tegilmaydi
      const r = await tx.trip.updateMany({ where: { id: t.id, bruId: t.bruId }, data: { bruId: b.id } });
      if (!r.count) continue;
      changed.push({ id: t.id, before: { bruId: t.bruId }, after: { bruId: b.id, bru: t.bru, via: "bru-reys-boglash" } });
      if (t.status !== "CANCELLED") orderBru.set(t.orderId, b.id);
    }
    await auditMany(tx, director.id, "UPDATE", "Trip", changed);
    // Zayavkaning BRU si bo'sh beton qatori — shu BRU
    const items = await tx.orderItem.findMany({ where: { orderId: { in: [...orderBru.keys()] }, bruId: null, product: { unit: "m3" } }, select: { id: true, orderId: true } });
    const itemChanged: { id: string; before: unknown; after: unknown }[] = [];
    for (const i of oldItems) {
      const bruId = oldBru.get(i.bruId!)!.id;
      const r = await tx.orderItem.updateMany({ where: { id: i.id, bruId: i.bruId }, data: { bruId } });
      if (r.count) itemChanged.push({ id: i.id, before: { bruId: i.bruId }, after: { bruId, via: "bru-reys-boglash" } });
    }
    for (const i of items) {
      const bruId = orderBru.get(i.orderId)!;
      const r = await tx.orderItem.updateMany({ where: { id: i.id, bruId: null }, data: { bruId } });
      if (r.count) itemChanged.push({ id: i.id, before: { bruId: null }, after: { bruId, via: "bru-reys-boglash" } });
    }
    await auditMany(tx, director.id, "UPDATE", "OrderItem", itemChanged);
    return { trips: changed.length, items: itemChanged.length };
  }, { timeout: 60_000 });
  console.log(`\nYozildi: ${res.trips} ta reys, ${res.items} ta zayavka beton qatori BRU ga bog'landi.`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
