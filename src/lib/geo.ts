/**
 * Manzil qidiruvi va masofa — zayavkadagi obyekt nuqtasi uchun.
 *
 * Qidiruv: Yandex Geosadjest + Geokoder (kalitlar bo'lsa), aks holda 2GIS Catalog API.
 * Yandex javob bermasa yoki hech narsa topmasa — 2GIS'ga tushadi (kaliti bo'lsa).
 * Marshrut va masofa: Yandex Router (kalit bo'lsa, tirbandlik bilan), keyin OSRM; ikkalasi javob bermasa to'g'ri chiziqqa tushadi va
 * shunday belgilanadi, ya'ni zayavka hech qachon masofasiz qolmaydi.
 *
 * Barcha xizmatlar serverdan chaqiriladi: kalit brauzerga chiqmaydi va
 * so'rovlar limiti bitta joydan boshqariladi.
 */

const DGIS_KEY = process.env.DGIS_API_KEY ?? "";
const YANDEX_SUGGEST_KEY = process.env.YANDEX_SUGGEST_KEY ?? "";
const YANDEX_GEOCODER_KEY = process.env.YANDEX_GEOCODER_KEY ?? "";
const YANDEX_ROUTER_KEY = process.env.YANDEX_ROUTER_KEY ?? "";
const OSRM_URL = (process.env.OSRM_URL ?? "https://router.project-osrm.org").replace(/\/+$/, "");
/** Toshkent markazi — qidiruvni shahar atrofiga tortadi. */
const CITY: [number, number] = [69.2401, 41.2995];

/**
 * Yandex ikkala kalit bilan ishlaydi: Geosadjest faqat nom va `uri` beradi,
 * koordinatani esa Geokoder shu `uri` bo'yicha qaytaradi. Bittasi bo'lmasa nuqta olib bo'lmaydi.
 */
const yandexSearch = () => !!YANDEX_SUGGEST_KEY && !!YANDEX_GEOCODER_KEY;

export function geoSearchEnabled() {
  return yandexSearch() || !!DGIS_KEY;
}

export type Place = {
  /** Ko'rsatiladigan to'liq manzil */
  address: string;
  /** Qisqa nom — bino yoki obyekt nomi */
  name: string;
  /**
   * Koordinata. Yandex takliflarida bo'sh keladi — har harfda 8 ta Geokoder so'rovi
   * limitni tez yeydi, shuning uchun nuqta faqat tanlanganda `resolvePlace` bilan olinadi.
   */
  lat: number | null;
  lng: number | null;
  /** Yandex obyekt identifikatori — `resolvePlace` uchun. */
  uri?: string;
};

type DgisItem = {
  name?: string;
  full_name?: string;
  address_name?: string;
  point?: { lat: number; lon: number };
};

type YandexSuggest = {
  title?: { text?: string };
  subtitle?: { text?: string };
  address?: { formatted_address?: string };
  uri?: string;
};

/**
 * Manzil bo'yicha takliflar. Kalit yo'q yoki xizmatlar javob bermasa — bo'sh ro'yxat
 * (forma ishlayveradi, foydalanuvchi nuqtani xaritadan qo'yadi).
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  // Bitta harfdan boshlab qidiramiz — zayavka formasi yozgan sayin so'raydi.
  if (q.length < 1) return [];
  if (yandexSearch()) {
    const found = await yandexSuggest(q, signal);
    if (found.length || !DGIS_KEY) return found;
  }
  return dgisSearch(q, signal);
}

async function yandexSuggest(q: string, signal?: AbortSignal): Promise<Place[]> {
  const url = new URL("https://suggest-maps.yandex.ru/v1/suggest");
  url.searchParams.set("apikey", YANDEX_SUGGEST_KEY);
  url.searchParams.set("text", q);
  // Takliflar o'zbekcha lotinda ("Amir Temur xiyoboni"); Geokoder esa uz'ni bilmaydi — u faqat nuqta beradi
  url.searchParams.set("lang", "uz");
  // Toshkent atrofi birinchi, lekin viloyatdagi obyektlar ham chiqadi (strict_bounds yo'q)
  url.searchParams.set("ll", CITY.join(","));
  url.searchParams.set("spn", "1,1");
  url.searchParams.set("countries", "uz");
  url.searchParams.set("results", "8");
  url.searchParams.set("attrs", "uri");
  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as { results?: YandexSuggest[] };
    return (j.results ?? [])
      .filter((r) => r.uri)
      .map((r) => {
        const name = r.title?.text ?? q;
        return { name, address: r.address?.formatted_address ?? r.subtitle?.text ?? name, lat: null, lng: null, uri: r.uri };
      });
  } catch {
    return [];
  }
}

async function dgisSearch(q: string, signal?: AbortSignal): Promise<Place[]> {
  if (!DGIS_KEY) return [];
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

type GeocoderResponse = {
  response?: { GeoObjectCollection?: { featureMember?: { GeoObject?: { Point?: { pos?: string } } }[] } };
};

/**
 * Tanlangan Yandex taklifining nuqtasi. Avval `uri` bo'yicha (aniq o'sha obyekt),
 * topilmasa manzil matni bo'yicha. Hech biri bo'lmasa `null` — forma "xaritadan belgilang" deydi.
 */
export async function resolvePlace(uri: string, text: string): Promise<{ lat: number; lng: number } | null> {
  if (!YANDEX_GEOCODER_KEY) return null;
  const ask = async (param: "uri" | "geocode", value: string) => {
    const url = new URL("https://geocode-maps.yandex.ru/v1/");
    url.searchParams.set("apikey", YANDEX_GEOCODER_KEY);
    url.searchParams.set(param, value);
    url.searchParams.set("lang", "ru_RU");
    url.searchParams.set("format", "json");
    url.searchParams.set("results", "1");
    if (param === "geocode") url.searchParams.set("ll", CITY.join(","));
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const j = (await res.json()) as GeocoderResponse;
      // Yandex tartibi: "uzunlik kenglik"
      const pos = j.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
      const [lng, lat] = (pos ?? "").split(" ").map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) && pos ? { lat: lat!, lng: lng! } : null;
    } catch {
      return null;
    }
  };
  return (uri ? await ask("uri", uri) : null) ?? (text.trim() ? await ask("geocode", text.trim()) : null);
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
 * Zavoddan obyektgacha masofa. Avval yo'l bo'yicha (Yandex, keyin OSRM), bo'lmasa to'g'ri chiziq.
 *
 * Diqqat: Yandex kaliti yo'q va `OSRM_URL` sozlanmagan bo'lsa jamoat demo serveri
 * ishlatiladi — u ishlab chiqish uchun mo'ljallangan, sekin va kafolatsiz.
 */
export async function routeDistance(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<Distance> {
  const r = await routeLine(from, to);
  return { km: Math.round(r.meters / 10) / 100, source: r.source };
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
 * Yandex ham, OSRM ham javob bermasa to'g'ri chiziq qaytadi va `source` shuni aytadi: ilova
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
  return (await yandexRoute(from, to)) ?? (await osrmRoute(from, to)) ?? line;
}

type YandexRouteResponse = {
  route?: {
    legs?: {
      status?: string;
      steps?: { length?: number; duration?: number; polyline?: { points?: [number, number][] } }[];
    }[];
  };
};

/**
 * Yandex Router — Toshkent ko'chalarini OSRM'dan yaxshi biladi va vaqtni joriy tirbandlik
 * bilan hisoblaydi. Kalit yo'q, xato yoki yo'l topilmasa `null` — chaqiruvchi OSRM'ga o'tadi.
 */
async function yandexRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteLine | null> {
  if (!YANDEX_ROUTER_KEY) return null;
  const url = new URL("https://api.routing.yandex.net/v2/route");
  url.searchParams.set("apikey", YANDEX_ROUTER_KEY);
  // Yandex tartibi: "kenglik,uzunlik"
  url.searchParams.set("waypoints", `${from.lat},${from.lng}|${to.lat},${to.lng}`);
  url.searchParams.set("mode", "driving");
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = (await res.json()) as YandexRouteResponse;
    const legs = j.route?.legs ?? [];
    if (legs.length === 0 || legs.some((l) => l.status !== "OK")) return null;
    const points: { lat: number; lng: number }[] = [];
    let meters = 0, seconds = 0;
    for (const step of legs.flatMap((l) => l.steps ?? [])) {
      meters += step.length ?? 0;
      seconds += step.duration ?? 0;
      for (const [lat, lng] of step.polyline?.points ?? []) {
        // Qadamlar chegarasida nuqta takrorlanadi — chiziq va ilovaga ketadigan hajm uchun bir marta
        const last = points[points.length - 1];
        if (last && last.lat === lat && last.lng === lng) continue;
        points.push({ lat, lng });
      }
    }
    if (points.length < 2 || meters <= 0) return null;
    return { points, meters: Math.round(meters), seconds: Math.round(seconds), source: "ROUTE" };
  } catch {
    return null;
  }
}

async function osrmRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteLine | null> {
  try {
    const url = `${OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      code?: string;
      routes?: { distance: number; duration: number; geometry?: { coordinates?: [number, number][] } }[];
    };
    const r = j.code === "Ok" ? j.routes?.[0] : undefined;
    const coords = r?.geometry?.coordinates ?? [];
    if (!r || coords.length < 2) return null;
    return {
      points: coords.map(([lng, lat]) => ({ lat, lng })),
      meters: Math.round(r.distance),
      seconds: Math.round(r.duration),
      source: "ROUTE",
    };
  } catch {
    return null;
  }
}
