/** `insof-world.js` — dizayndan deyarli o'zgarishsiz ko'chirilgan three.js sahnasi (zavod bo'ylab 7 bekat). */

export const CYCLE: number;
export const STATIONS: { t: [number, number, number]; s: number; az: number; el?: number }[];

export type World = {
  /** Bekat o'rni, 0…6 (kasr — bekatlar orasida). */
  setProgress(f: number): void;
  /** Ofis ichiga kirish, 0…1 (qavatlar birma-bir ochiladi). */
  setOffice(u: number): void;
  /** Takrorlanuvchi 4 qadamli animatsiyaning joriy qadami. */
  getPhase(): { step: number; frac: number };
  /** Faol qadamning 3D nuqtasiga har kadr ko'chiriladigan DOM belgi. */
  setMarker(el: HTMLElement | null): void;
  setAccent(hex: string): void;
  setMood(mood: "day" | "night"): void;
  step(n?: number, dt?: number): void;
  getDebug(): Record<string, unknown>;
  dispose(): void;
};

export function mountWorld(el: HTMLElement, opts?: { lite?: boolean; font?: string }): World;
