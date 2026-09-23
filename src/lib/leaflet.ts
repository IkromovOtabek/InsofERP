/**
 * Leaflet'ni CDN'dan bir marta yuklaydi — xarita ishlatadigan barcha komponentlar shu yerdan oladi.
 * npm paketi qo'shilmagan: xarita bir necha sahifada, lekin har birida kichik qism ishlatiladi.
 *
 * Tayl manbai: Yandex Tiles API (kalit bo'lsa), aks holda OpenStreetMap.
 * Yandex litsenziyasi xaritada uning nomi turishini talab qiladi — `attribution` olib tashlanmaydi.
 */

const JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
const CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";

const YANDEX_KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_KEY ?? "";

/** `projection=web_mercator` — Leaflet'ning standart proyeksiyasi, CRS'ni o'zgartirish shart emas. */
const YANDEX_TILES = {
  url: `https://tiles.api-maps.yandex.ru/v1/tiles/?x={x}&y={y}&z={z}&lang=ru_RU&l=map&projection=web_mercator&apikey=${encodeURIComponent(YANDEX_KEY)}`,
  attribution: "© Яндекс Карты",
  maxZoom: 21,
};

const OSM_TILES = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap",
  maxZoom: 19,
};

export const TILES = YANDEX_KEY ? YANDEX_TILES : OSM_TILES;

/** Toshkent markazi — nuqta hali yo'q bo'lganda xarita shu yerdan boshlanadi. */
export const TASHKENT: [number, number] = [41.2995, 69.2401];

export type LMap = {
  setView: (c: [number, number], z?: number) => LMap;
  removeLayer: (l: unknown) => void;
  fitBounds: (b: unknown, o?: unknown) => void;
  on: (ev: string, fn: (e: { latlng: { lat: number; lng: number } }) => void) => void;
  invalidateSize: () => void;
};
export type LMarker = {
  addTo: (m: LMap) => LMarker;
  bindPopup: (html: string) => LMarker;
  setLatLng: (c: [number, number]) => LMarker;
  on: (ev: string, fn: () => void) => LMarker;
};
export type LLayer = { addTo: (m: LMap) => LLayer; on: (ev: string, fn: () => void) => LLayer; bindTooltip: (html: string, o?: unknown) => LLayer };
export type LTileLayer = { addTo: (m: LMap) => LTileLayer; on: (ev: string, fn: () => void) => LTileLayer };
export type Leaflet = {
  map: (el: HTMLElement, o?: unknown) => LMap;
  tileLayer: (url: string, o?: unknown) => LTileLayer;
  marker: (c: [number, number], o?: unknown) => LMarker;
  polyline: (cs: [number, number][], o?: unknown) => LLayer;
  circleMarker: (c: [number, number], o?: unknown) => LLayer;
  divIcon: (o: unknown) => unknown;
  latLngBounds: (cs: [number, number][]) => unknown;
};

declare global {
  interface Window { L?: Leaflet }
}

let promise: Promise<Leaflet | null> | null = null;

/** Internet yoki CDN yetib bormasa `null` — chaqiruvchi xaritasiz ishlashga tayyor bo'lishi kerak. */
export function loadLeaflet(): Promise<Leaflet | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.L) return Promise.resolve(window.L);
  promise ??= new Promise<Leaflet | null>((resolve) => {
    if (!document.querySelector(`link[href="${CSS}"]`)) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = CSS;
      document.head.appendChild(css);
    }
    const s = document.createElement("script");
    s.src = JS;
    s.async = true;
    s.onload = () => resolve(window.L ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return promise;
}

/**
 * Xaritaga tayl qatlamini qo'yadi.
 *
 * Yandex kaliti bor bo'lsa avval o'sha ishlatiladi. Kalit yaroqsiz yoki muddati
 * o'tgan bo'lsa taylar 403 qaytaradi va xarita bo'm-bo'sh kulrang bo'lib qoladi —
 * shuning uchun birinchi xatodayoq OpenStreetMap'ga o'tamiz. Aks holda kalit
 * "bor, lekin ishlamaydi" holatida ilovadagi hamma xarita jim o'ladi.
 */
export function addTiles(L: Leaflet, map: LMap) {
  const layer = L.tileLayer(TILES.url, { attribution: TILES.attribution, maxZoom: TILES.maxZoom });
  layer.addTo(map);
  if (TILES === OSM_TILES) return;

  let swapped = false;
  layer.on("tileerror", () => {
    if (swapped) return;
    swapped = true;
    map.removeLayer(layer);
    L.tileLayer(OSM_TILES.url, { attribution: OSM_TILES.attribution, maxZoom: OSM_TILES.maxZoom }).addTo(map);
  });
}
