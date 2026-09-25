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

/** Marshrut: xaritada chiziladigan chiziq + yo'l uzunligi va taxminiy vaqti. */
export type RouteLine = {
  /** Chiziq nuqtalari — kamida ikkita (boshi va oxiri). */
  points: { lat: number; lng: number }[];
  meters: number;
  seconds: number;
  source: "ROUTE" | "LINE";
};

/** Yo'l topilmaganda to'g'ri chiziq necha km/soat deb hisoblanadi — shahar ichi o'rtachasi. */
const LINE_KMH = 30;

/**
 * Ikki nuqta orasidagi marshrut — haydovchi ilovasidagi xarita shuni chizadi.
 *
 * `routeDistance` dan farqi: bu yerda chiziqning O'ZI kerak, chunki ilova qolgan masofani
 * shu chiziq bo'ylab hisoblaydi (har soniyada serverga murojaat qilmaslik uchun).
 *
 * Geometriya `full` — haqiqiy ko'chalar bo'ylab. `simplified` da 27 km yo'l 17 ta
 * nuqtaga siqiladi va xaritada kvartallarni kesib o'tadigan siniq chiziq chiqadi,
 * haydovchi esa "yo'l noto'g'ri" deb o'ylaydi. To'liq geometriya taxminan 17 KB —
 * ilova uni har safar emas, faqat marshrut o'zgarganda so'raydi (`lib/mobile/route.ts`).
 *
 * OSRM javob bermasa to'g'ri chiziq qaytadi va `source` shuni aytadi: ilova
 * "taxminiy" deb ko'rsatadi, lekin xarita baribir bo'sh qolmaydi.
 */
export async function routeLine(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteLine> {
  const straight = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  const line: RouteLine = {
    points: [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }],
    meters: Math.round(straight),
    seconds: Math.round((straight / 1000 / LINE_KMH) * 3600),
    source: "LINE",
  };
  try {
    const url = `${OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return line;
    const j = (await res.json()) as {
      code?: string;
      routes?: { distance: number; duration: number; geometry?: { coordinates?: [number, number][] } }[];
    };
    const r = j.code === "Ok" ? j.routes?.[0] : undefined;
    const coords = r?.geometry?.coordinates ?? [];
    if (!r || coords.length < 2) return line;
    return {
      points: coords.map(([lng, lat]) => ({ lat, lng })),
      meters: Math.round(r.distance),
      seconds: Math.round(r.duration),
      source: "ROUTE",
    };
  } catch {
    return line;
  }
}
