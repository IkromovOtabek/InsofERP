/**
 * Manzil qidiruvi va masofa — zayavkadagi obyekt nuqtasi uchun.
 *
 * Qidiruv: 2GIS Catalog API (Toshkent va viloyatlar bo'yicha binolargacha batafsil).
 * Masofa: OSRM — haqiqiy yo'l bo'yicha; javob bermasa to'g'ri chiziqqa tushadi va
 * shunday belgilanadi, ya'ni zayavka hech qachon masofasiz qolmaydi.
 *
 * Ikkala xizmat ham serverdan chaqiriladi: kalit brauzerga chiqmaydi va
 * so'rovlar limiti bitta joydan boshqariladi.
 */

const DGIS_KEY = process.env.DGIS_API_KEY ?? "";
const OSRM_URL = (process.env.OSRM_URL ?? "https://router.project-osrm.org").replace(/\/+$/, "");
/** Toshkent markazi — qidiruvni shahar atrofiga tortadi. */
const CITY: [number, number] = [69.2401, 41.2995];

export function geoSearchEnabled() {
  return !!DGIS_KEY;
}

export type Place = {
  /** Ko'rsatiladigan to'liq manzil */
  address: string;
  /** Qisqa nom — bino yoki obyekt nomi */
  name: string;
  lat: number;
  lng: number;
};

type DgisItem = {
  name?: string;
  full_name?: string;
  address_name?: string;
  point?: { lat: number; lon: number };
};

/**
 * Manzil bo'yicha takliflar. Kalit yo'q yoki 2GIS javob bermasa — bo'sh ro'yxat
 * (forma ishlayveradi, foydalanuvchi nuqtani xaritadan qo'yadi).
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  // Bitta harfdan boshlab qidiramiz — zayavka formasi yozgan sayin so'raydi.
  if (!DGIS_KEY || q.length < 1) return [];
  const url = new URL("https://catalog.api.2gis.com/3.0/items/geocode");
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "items.point,items.address,items.full_name");
  url.searchParams.set("location", CITY.join(","));
  // Manzillar o'zbekcha lotinda qaytsin ("Toshkent, Bunyodkor prospekt"), sukut bo'yicha rus tilida keladi
  url.searchParams.set("locale", "uz_UZ");
  url.searchParams.set("page_size", "8");
  url.searchParams.set("key", DGIS_KEY);
  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as { result?: { items?: DgisItem[] } };
    return (j.result?.items ?? [])
      .filter((i) => i.point)
      .map((i) => ({
        name: i.name ?? i.address_name ?? i.full_name ?? q,
        address: i.full_name ?? i.address_name ?? i.name ?? q,
        lat: i.point!.lat,
        lng: i.point!.lon,
      }));
  } catch {
    return [];
  }
}

/** Ikki nuqta orasidagi to'g'ri masofa, metr. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371e3, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type Distance = { km: number; source: "ROUTE" | "LINE" };

/**
 * Zavoddan obyektgacha masofa. Avval yo'l bo'yicha (OSRM), bo'lmasa to'g'ri chiziq.
 *
 * Diqqat: `OSRM_URL` sozlanmagan bo'lsa jamoat demo serveri ishlatiladi — u ishlab chiqish
 * uchun mo'ljallangan, sekin va kafolatsiz. Doimiy ish uchun o'z OSRM'ingizni ko'tarib
 * `OSRM_URL` ga yozing.
 */
export async function routeDistance(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<Distance> {
  const line = { km: Math.round(haversineMeters(from.lat, from.lng, to.lat, to.lng) / 10) / 100, source: "LINE" as const };
  try {
    const url = `${OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return line;
    const j = (await res.json()) as { code?: string; routes?: { distance: number }[] };
    const m = j.code === "Ok" ? j.routes?.[0]?.distance : undefined;
    return m ? { km: Math.round(m / 10) / 100, source: "ROUTE" } : line;
  } catch {
    return line;
  }
}
