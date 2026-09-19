import type { EcoStatus } from "./client";

type Color = "slate" | "blue" | "amber" | "red" | "green" | "violet";

/** ECO reys holatlari — ERP ekranida o'zbekcha. */
export const ECO_STATUS: Record<EcoStatus, { label: string; color: Color; hint: string }> = {
  ASSIGNED:  { label: "Haydovchiga yuborildi", color: "slate",  hint: "Ilovada ko'rinadi, hali qabul qilinmadi" },
  ACCEPTED:  { label: "Haydovchi qabul qildi", color: "blue",   hint: "Haydovchi reysni oldi" },
  DECLINED:  { label: "Haydovchi rad etdi",    color: "red",    hint: "Boshqa haydovchi bering yoki reysni bekor qiling" },
  LOADING:   { label: "Yuklanmoqda",           color: "blue",   hint: "Zavodda yuklash boshlandi" },
  EN_ROUTE:  { label: "Yo'lda",                color: "amber",  hint: "GPS kuzatuv yoqiq, 90 daqiqa SLA" },
  ARRIVED:   { label: "Obyektga keldi",        color: "amber",  hint: "Geofence yoki haydovchi tasdig'i" },
  UNLOADING: { label: "Tushirilmoqda",         color: "violet", hint: "Mijoz imzosi kutilmoqda" },
  COMPLETED: { label: "Yakunlandi",            color: "green",  hint: "Mijoz imzoladi yoki SMS-kod bilan qabul qildi" },
  DISPUTED:  { label: "E'tiroz",               color: "red",    hint: "Mijoz hajm/sifat bo'yicha e'tiroz bildirdi" },
  FAILED:    { label: "Muvaffaqiyatsiz",       color: "red",    hint: "Reys yo'lda to'xtatildi" },
  CANCELLED: { label: "Bekor",                 color: "red",    hint: "" },
};

export const ecoLabel = (s: string | null | undefined) => (s && s in ECO_STATUS ? ECO_STATUS[s as EcoStatus] : null);
