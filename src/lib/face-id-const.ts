/**
 * Face ID davomat — klient (skaner) va server (`lib/face-id.ts`) uchun umumiy qiymatlar.
 * Bu fayl brauzerga ham tushadi — baza importi bo'lmasin.
 */

/** Yuz vektori uzunligi (face-api, ResNet-34). */
export const FACE_DIM = 128;

/** Skaner bir urinishda shuncha vektor yuboradi (ketma-ket kadrlar) — server o'rtachasini oladi. */
export const SCAN_PROBES = 3;

/** Ro'yxatga olishda olinadigan namunalar: to'g'ri, bir yon, ikkinchi yon, yana to'g'ri. */
export const ENROLL_MIN_SAMPLES = 3;
export const ENROLL_MAX_SAMPLES = 8;

/** Kadr (data-URL) chegarasi — skaner yuzni kichik JPEG qilib yuboradi (~30–60 KB). */
export const SNAPSHOT_MAX_CHARS = 600_000;

/**
 * Mobil yuz skaneri kadri (data-URL) chegarasi — "Keldim/Ketdim" (`lib/self-attendance.ts`) va rahbarning `att.face`.
 * Ilova (ECO `face-scan.tsx`) base64'ni ≤ 2 000 000 belgida ushlaydi (oshsa past sifat bilan qayta oladi);
 * `data:image/jpeg;base64,` prefiksi va zaxira bilan 2,1 M. Kattarog'i — rad (sharp'ga yetib bormaydi).
 */
export const MAX_FACE_PHOTO_CHARS = 2_100_000;

/**
 * Skaner rejimi: "auto" — bugun kelmagan bo'lsa "Keldi", kelgan bo'lsa (AUTO_OUT_AFTER_MIN dan keyin) "Ketdi";
 * "in" / "out" — faqat kelish yoki faqat ketish (smena boshida/oxirida navbat bo'lganda qulay).
 */
export type FaceMode = "auto" | "in" | "out";
export const FACE_MODES: { value: FaceMode; label: string }[] = [
  { value: "auto", label: "Avto" },
  { value: "in", label: "Keldi" },
  { value: "out", label: "Ketdi" },
];

/** "Avto" rejimda kelgandan keyin shuncha daqiqa o'tmaguncha qayta skaner "Ketdi" qilmaydi (adashib qayta turish). */
export const AUTO_OUT_AFTER_MIN = 30;

export type FaceScanOk = {
  ok: true;
  /** in — keldi yozildi; out — ketdi yozildi; already — bugun allaqachon (hech narsa o'zgarmadi). */
  kind: "in" | "out" | "already";
  employee: { id: string; fullName: string; position: string };
  /** Yozilgan (yoki avval yozilgan) vaqt "HH:MM". */
  time: string | null;
  /** Katta yozuv: "Keldi 08:12", "Ketdi 18:05 · 9,5 soat", "Bugun allaqachon kelgan 08:12". */
  text: string;
  /** Kichik yozuv: "12 daq kechikdi", "O'z vaqtida". */
  hint: string | null;
  /** O'xshashlik, % (taxminiy, ko'rsatish uchun). */
  similarity: number;
  /** Bugungi jurnal qatori uchun yozuv id (kadrni ko'rish). */
  attendanceId: string | null;
};
export type FaceScanFail = {
  ok: false;
  code: "NO_MATCH" | "AMBIGUOUS" | "PHOTO_MISMATCH" | "NO_TEMPLATES" | "OUT_OF_SCOPE" | "MARKED_OTHER" | "NO_CHECKIN" | "SHIFT_TOO_LONG" | "RATE_LIMITED" | "BAD_REQUEST" | "FORBIDDEN";
  error: string;
  employee?: { id: string; fullName: string; position: string };
};
export type FaceScanResult = FaceScanOk | FaceScanFail;
