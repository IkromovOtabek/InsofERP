import { randomInt } from "node:crypto";
import type { FaceAnalysis } from "@/lib/face-descriptor";
import { distance } from "@/lib/face-id";

/**
 * Mobil yuz skaneri uchun "jonlilik" (liveness) tekshiruvi — qotgan surat, ekrandagi rasm yoki bir kadr nusxasini
 * ushlash. Challenge (`GET /api/mobile/attendance/challenge`, `lib/face-replay.ts`) nonce bilan birga tasodifiy
 * topshiriq beradi; ilova topshiriqni ko'rsatib 3 kadr oladi va `frames` qilib yuboradi:
 *   [0] — topshiriqdan oldin (yuz to'g'ri, ko'z ochiq) — dalil sifatida SHU kadr saqlanadi;
 *   [1] — topshiriq paytida (bosh burilgan / ko'z yumuq);
 *   [2] — topshiriqdan keyin.
 * Server har kadrdan yuz vektori va 68 nuqtani oladi (`faceAnalyses`, bitta navbat o'rnida) va tekshiradi:
 *   · har kadr xodimning yuzi (`lib/face-verify.ts`);
 *   · kadrlar bir xil emas — xesh, vektor va nuqtalar farqi (`staticReason`);
 *   · topshiriq bajarilgan (`taskReason`).
 *
 * Bayroq `MOBILE_FACE_LIVENESS_REQUIRED` (sukut false): true — `frames` + topshiriq majburiy (eski bitta kadrli ilova
 * "Ilovani yangilang" oladi); false — `frames` kelsa tekshiriladi, kelmasa eski oqim.
 *
 * ───────── Chegaralar qanday tanlangan (face-api demo suratlari + sintetik kadrlar, `scripts/qa/c-liveness.ts`) ─────────
 * Bosh burish (TURN): o'lchov — burun uchi (30-nuqta) ning yuz kengligi bo'yicha o'rni: (burun.x − jag'0.x) / (jag'16.x −
 * jag'0.x); to'g'ri qaragan yuzda ~0,5. Yuz qutisi detektor qutisidan emas, jag' chizig'idan olinadi — detektor qutisi
 * kadrdan kadrga ko'proq "sakraydi". Bir suratning o'zgartirilgan nusxalari (JPEG sifati 95→40, 10–30 px siljitish,
 * 0,7× kichraytirish, yorqinlik/kontrast) da bu nisbat to'g'ri qaragan yuzlarda ko'pi bilan 0,044 ga, pastga qaragan
 * (qiyshiq) yuzda 0,075 ga o'zgardi. Yuzning yarmini siqib burilish taqlid qilinganda: 0,85× → 0,02–0,06;
 * 0,7× → 0,05–0,15; 0,55× → 0,10–0,20. Haqiqiy burilishda burun yuz tekisligidan oldinda turgani uchun siljish
 * taxminan 0,7·sin(burchak): 10° → ~0,12, 15° → ~0,18, 25° → ~0,3. Chegara `TURN_MIN_SHIFT = 0,12` — statik
 * shovqindan (≤ 0,075) aniq yuqori, odam "biroz" (≥ 10–15°) burganda ham o'tadi. Juda katta burilishda (≳ 45°) yuz
 * topilmay qolishi mumkin — ilova "biroz" burishni so'raydi. Detektor ba'zan bir kadrda boshqa sohani "yuz" deb
 * oladi (nuqtalar keskin sakraydi) — bunday kadr vektori asosiy kadrdan uzoq (> `SEQ_MAX_DISTANCE`) bo'lgani uchun
 * shaxs tekshiruvida rad bo'ladi va topshiriqni "soxta bajarilgan" qilib ko'rsata olmaydi.
 * Yo'nalish: kadr ko'zgu-aks EMAS deb olinadi (expo-camera `mirror=false` sukuti; orqa kamera ham shunday) — odam o'z
 * chapiga bursa burni kadrning O'NG tomoniga siljiydi (nisbat oshadi). Biror telefonda kadr ko'zgu-aks bo'lib chiqsa,
 * `MOBILE_FACE_LIVENESS_ANY_SIDE=true` yo'nalishni tekshirmaydi (faqat siljish kattaligi) — haqiqiy odam rad etilmasin.
 *
 * Ko'z yumib-ochish (BLINK): face-api 68 nuqta modeli qovoqni deyarli kuzatmaydi — sinovda ko'z ustiga qovoq chizilgan
 * kadrda ko'z nisbati (EAR) atigi 3–10% kamaydi (statik shovqin ham ~7%); suratdagi yarim yumuq ko'z EAR ≈ 0,26,
 * ochiq ko'zlar 0,30–0,34. Shuning uchun ikki belgi BIRGA talab qilinadi va ikkalasi ham AYNAN bir kadrda:
 * EAR kamida `BLINK_MIN_EAR_DROP` (15%) va ko'z sohasi kontrasti (`eyeContrast`, piksellardan) kamida
 * `BLINK_MIN_CONTRAST_DROP` (30%) pasaygan. Bu belgilar namunaviy suratlarda shovqinli (bir suratning siljitilgan
 * nusxasida kontrast 25–65% "pasaygan" holatlar bor — u holda detektor xato sohani olgan va vektor masofasi bilan
 * rad bo'ladi, lekin chegarani ishonchli deb bo'lmaydi), shu sababli BLINK sukut bo'yicha topshiriqlar ro'yxatida YO'Q — telefonlarda
 * haqiqiy kadrlar bilan sinab, keyin `MOBILE_FACE_LIVENESS_TASKS=BLINK,TURN_LEFT,TURN_RIGHT` bilan yoqiladi
 * (muvaffaqiyatsiz urinishlar o'lchovlari auditda — chegarani moslash uchun).
 *
 * Qotgan surat / nusxa: (a) uchta xesh har xil (`face-verify`); (b) kadrlar juftlari orasida yuz nuqtalari (ko'zlar
 * orasidagi masofaga normallashtirilgan) o'rtacha `STATIC_MIN_MOTION` (0,015) dan kam siljigan va vektorlar
 * `STATIC_MAX_DESCRIPTOR` (0,02) dan yaqin bo'lsa — bir kadr nusxasi. Qayta kodlangan nusxada vektor farqi 0,05–0,15,
 * shuning uchun (b) faqat aniq nusxani ushlaydi; asosiy himoya — topshiriq.
 *
 * Cheklovlar (hali o'tishi mumkin bo'lgan hujumlar): xodimning bosh burayotgan VIDEOsi ekrandan ko'rsatilsa; qog'ozdagi
 * suratni vertikal o'q atrofida keskin (≳ 50°) qiyshaytirish burilishga o'xshashi mumkin; 3D niqob. 2D kamera va
 * 3 kadr bilan bularni to'liq ajratib bo'lmaydi — maqsad oddiy "suratni kameraga tutish" ni to'xtatish.
 */

export type LivenessTask = "BLINK" | "TURN_LEFT" | "TURN_RIGHT";
export const LIVENESS_TASKS: readonly LivenessTask[] = ["BLINK", "TURN_LEFT", "TURN_RIGHT"];

/** Ilovaga ko'rsatiladigan matnlar. `steps` — kadrlar orasidagi ko'rsatmalar ([1] va [2] kadrdan oldin). */
export const TASK_INFO: Record<LivenessTask, { text: string; hint: string; icon: string; steps: [string, string] }> = {
  BLINK: { text: "Ko'zingizni yumib oching", hint: "Kameraga qarab turing, so'ralganda ko'zingizni yuming", icon: "eye-off", steps: ["Ko'zingizni yuming", "Ko'zingizni oching"] },
  TURN_LEFT: { text: "Boshingizni chapga buring", hint: "Biroz chapga buring, keyin yana kameraga qarang", icon: "arrow-left", steps: ["Boshingizni chapga buring", "Kameraga qarang"] },
  TURN_RIGHT: { text: "Boshingizni o'ngga buring", hint: "Biroz o'ngga buring, keyin yana kameraga qarang", icon: "arrow-right", steps: ["Boshingizni o'ngga buring", "Kameraga qarang"] },
};

/** Ketma-ketlikdagi kadrlar soni. */
export const LIVENESS_FRAMES = 3;
/** Barcha kadrlar (data-URL) jami belgilari — har biri `MAX_FACE_PHOTO_CHARS` ichida, jami ~2 ta katta kadr. */
export const MAX_FACE_FRAMES_TOTAL_CHARS = 4_500_000;

export const TURN_MIN_SHIFT = 0.12;
export const BLINK_MIN_EAR_DROP = 0.15;
export const BLINK_MIN_CONTRAST_DROP = 0.3;
export const STATIC_MIN_MOTION = 0.015;
export const STATIC_MAX_DESCRIPTOR = 0.02;
/**
 * Topshiriq kadrlari ([1], [2]) asosiy kadrga ([0]) shuncha yaqin bo'lishi shart — bir odam. Sintetik burilishda o'z
 * kadri 0,20–0,54 (kuchli siqishda), demo suratlardagi turli odamlar orasida 0,57–0,77. Konservativ: 0,55 — burilgan
 * yuz rad etilmasin; asosiy kadr baribir qat'iy chegara (`MATCH_MAX_DISTANCE`) bilan tekshiriladi.
 */
export const SEQ_MAX_DISTANCE = 0.55;
/** Topshiriq kadrining Face ID namunasidan masofasi: `MATCH_MAX_DISTANCE` + shu (bosh burilganda vektor uzoqlashadi). */
export const POSE_SLACK = 0.12;

const flag = (k: string) => (process.env[k] ?? "false").trim().toLowerCase() === "true";
export const livenessRequired = () => flag("MOBILE_FACE_LIVENESS_REQUIRED");
const anySide = () => flag("MOBILE_FACE_LIVENESS_ANY_SIDE");

/** Challenge'da beriladigan topshiriqlar (`MOBILE_FACE_LIVENESS_TASKS`, vergul bilan; sukut — faqat bosh burish). */
export function enabledTasks(): LivenessTask[] {
  const raw = (process.env.MOBILE_FACE_LIVENESS_TASKS ?? "").split(",").map((s) => s.trim().toUpperCase());
  const list = LIVENESS_TASKS.filter((t) => raw.includes(t));
  return list.length ? list : ["TURN_LEFT", "TURN_RIGHT"];
}
export const pickTask = (): LivenessTask => { const l = enabledTasks(); return l[randomInt(l.length)]!; };
export const isTask = (v: unknown): v is LivenessTask => typeof v === "string" && (LIVENESS_TASKS as readonly string[]).includes(v);
/** Challenge javobidagi `task` obyekti. */
export const taskPayload = (t: LivenessTask) => ({ code: t, ...TASK_INFO[t], frames: LIVENESS_FRAMES });

// ───────────────────────── O'lchovlar ─────────────────────────

type P = [number, number];
const dist2 = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Ko'z nisbati (EAR, Soukupová–Čech): (|p2−p6| + |p3−p5|) / (2·|p1−p4|), ikki ko'z o'rtachasi. */
export function eyeAspect(lm: P[]): number {
  const one = (s: number) => (dist2(lm[s + 1]!, lm[s + 5]!) + dist2(lm[s + 2]!, lm[s + 4]!)) / (2 * dist2(lm[s]!, lm[s + 3]!) || 1);
  return (one(36) + one(42)) / 2;
}
/** Burun uchining yuz kengligidagi o'rni (jag' chizig'i bo'yicha): 0 — kadrdagi chap chet, 1 — o'ng chet. */
export function noseOffset(lm: P[]): number {
  const l = lm[0]![0], r = lm[16]![0];
  return (lm[30]![0] - l) / (r - l || 1);
}
/** Ikki kadr yuz nuqtalarining o'rtacha siljishi (har kadr o'z markazi va ko'zlar orasidagi masofasiga normallashtirilgan). */
export function landmarkMotion(a: P[], b: P[]): number {
  const norm = (lm: P[]) => {
    const cx = lm.reduce((s, p) => s + p[0], 0) / lm.length, cy = lm.reduce((s, p) => s + p[1], 0) / lm.length;
    const io = dist2(lm[36]!, lm[45]!) || 1;
    return lm.map((p) => [(p[0] - cx) / io, (p[1] - cy) / io] as P);
  };
  const x = norm(a), y = norm(b);
  return x.reduce((s, p, i) => s + dist2(p, y[i]!), 0) / x.length;
}

export type LivenessCheck = { ok: true; detail: string } | { ok: false; reason: string; detail: string };

/** Bir kadrning nusxalari (qotgan surat) — har juftda nuqtalar deyarli qimirlamagan va vektor deyarli bir xil. */
function staticReason(f: FaceAnalysis[]): string | null {
  let moved = 0;
  for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) {
    moved = Math.max(moved, landmarkMotion(f[i]!.landmarks, f[j]!.landmarks));
    if (moved >= STATIC_MIN_MOTION) return null;
  }
  const descSame = f.every((x, i) => i === 0 || distance(x.descriptor, f[0]!.descriptor) < STATIC_MAX_DESCRIPTOR);
  return descSame ? `kadrlar bir xil (siljish ${moved.toFixed(3)})` : null;
}

/** Topshiriq bajarilganmi. `detail` — o'lchovlar (audit va chegarani moslash uchun). */
export function checkLiveness(task: LivenessTask, f: FaceAnalysis[]): LivenessCheck {
  const st = staticReason(f);
  if (st) return { ok: false, reason: st, detail: st };
  if (task === "BLINK") {
    const ear = f.map((x) => eyeAspect(x.landmarks));
    const con = f.map((x) => x.eyeContrast);
    const detail = `EAR ${ear.map((v) => v.toFixed(3)).join("/")}, kontrast ${con.map((v) => (v == null ? "—" : v.toFixed(3))).join("/")}`;
    const iEar = ear.indexOf(Math.min(...ear));
    const earDrop = 1 - ear[iEar]! / Math.max(...ear);
    const cs = con.filter((v): v is number => v != null);
    const conDrop = cs.length === con.length ? 1 - con[iEar]! / Math.max(...cs) : 0;
    if (earDrop >= BLINK_MIN_EAR_DROP && conDrop >= BLINK_MIN_CONTRAST_DROP) return { ok: true, detail };
    return { ok: false, reason: `ko'z yumilmadi (EAR −${Math.round(earDrop * 100)}%, kontrast −${Math.round(conDrop * 100)}%)`, detail };
  }
  // Bosh burish: [0] kadrga nisbatan topshiriq kadrlarida burun kerakli tomonga siljishi
  const pos = f.map((x) => noseOffset(x.landmarks));
  const detail = `burun ${pos.map((v) => v.toFixed(3)).join("/")}`;
  const dir = task === "TURN_LEFT" ? 1 : -1;
  const shifts = pos.slice(1).map((v) => v - pos[0]!);
  const best = anySide() ? Math.max(...shifts.map(Math.abs)) : Math.max(...shifts.map((s) => s * dir));
  if (best >= TURN_MIN_SHIFT) return { ok: true, detail };
  return { ok: false, reason: `bosh ${task === "TURN_LEFT" ? "chapga" : "o'ngga"} burilmadi (siljish ${best.toFixed(3)} < ${TURN_MIN_SHIFT})`, detail };
}
