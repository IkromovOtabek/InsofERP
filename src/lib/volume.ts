import { fmtNum } from "./format";
import { refWeight } from "./trip-plan";

/**
 * Mahsulotning 1 birligidan necha kub (m³) beton chiqadi — ishlab chiqarish samaradorligi m³ da o'lchanadi
 * (plita, blok, ustun bir xil o'lchovga keladi). Mahsulot tanlagichida «Kod» o'rnida shu ko'rinadi.
 *
 * Manba tartibi: beton (m³) — 1; kartadagi `volumeM3` (Sozlamalar → Mahsulotlar); kovak plita (PK) — nomidagi
 * o'lchamdan; bo'lmasa og'irlik (kartadagi yoki GOST jadvali) ÷ 2500 kg/m³ — temir-beton zichligi. Oxirgi ikkisi
 * taxminiy («≈»). Yengil bloklar (gazoblok, keramzit) zichligi boshqa — ular uchun taxmin qilinmaydi.
 */
const DENSITY = 2500;
const LIGHT = /gazoblok|keramzit|D\s?[3-6]00\b/i;
/** PK 71-12-8: uzunligi 71 dm, eni 12 dm. 220 mm kovak plita — 1 m² ga ≈ 0,12 m³ beton (PK 60.12 ≈ 0,86 m³). */
const PK = /\bPK\s*(\d{2})[.\s-]*(\d{2})/i;
const PK_M3_PER_M2 = 0.12;

export type UnitVolume = { m3: number; approx: boolean };

export function unitVolume(p: { unit: string; code: string; name: string; volumeM3?: unknown; weightKg?: unknown }): UnitVolume | null {
  if (p.unit === "m3") return { m3: 1, approx: false };
  const own = p.volumeM3 != null ? Number(p.volumeM3) : 0;
  if (own > 0) return { m3: own, approx: false };
  if (p.unit === "t" || LIGHT.test(p.name)) return null;
  const pk = p.unit === "dona" ? PK.exec(p.name) : null;
  if (pk) return { m3: Math.round((Number(pk[1]) / 10) * (Number(pk[2]) / 10) * PK_M3_PER_M2 * 1000) / 1000, approx: true };
  const kg = p.weightKg != null && Number(p.weightKg) > 0 ? Number(p.weightKg) : refWeight(p.code, p.name)?.kg;
  return kg ? { m3: Math.round((kg / DENSITY) * 1000) / 1000, approx: true } : null;
}

/** "1,05" / "≈0,96"; noma'lum — null. */
export const fmtVolume = (v: UnitVolume | null) => (v ? `${v.approx ? "≈" : ""}${fmtNum(v.m3, 3)}` : null);
