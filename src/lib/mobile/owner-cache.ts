import { ownerDashboard } from "@/lib/owner-dashboard";

/**
 * Direktor bosh sahifasi — vebdagi Egasi dashbordi (`ownerDashboard()`). Og'ir (o'nlab so'rov), ilova
 * esa bosh ekranni 30 s da yangilaydi — shuning uchun bir daqiqa keshda turadi (hamma direktorlar uchun bitta).
 * Bosh ekran (`home.ts`) ham, direktor kartalarining batafsil kartochkalari (`dash-detail.ts`) ham shundan oladi.
 */
let ownerCache: { at: number; data: Promise<Awaited<ReturnType<typeof ownerDashboard>>> } | null = null;
export function ownerCached() {
  if (!ownerCache || Date.now() - ownerCache.at > 60_000) {
    const data = ownerDashboard();
    ownerCache = { at: Date.now(), data };
    data.catch(() => { ownerCache = null; });
  }
  return ownerCache.data;
}
