/**
 * Target auditoriya shablonlari. Joylashuv — koordinata + radius (Meta'da shahar/viloyat kalitlari
 * mamlakatga qarab o'zgaradi, radius esa ishonchli). Qiziqishlar qo'yilmaydi: Meta'ning Advantage+
 * auditoriyasi kengaytiradi; kerak bo'lsa keyin shu yerda qo'shiladi.
 */
export type Audience = { key: string; label: string; hint: string; targeting: Record<string, unknown> };

const circle = (latitude: number, longitude: number, radius: number) => ({ latitude, longitude, radius, distance_unit: "kilometer" });
const TASHKENT = circle(41.3111, 69.2797, 60);
const GULISTON = circle(40.4897, 68.7842, 40);
const JIZZAX = circle(40.1158, 67.8422, 40);

export const AUDIENCES: Audience[] = [
  {
    key: "toshkent",
    label: "Toshkent va viloyat",
    hint: "Toshkent markazidan 60 km, 25–60 yosh",
    targeting: { geo_locations: { custom_locations: [TASHKENT] }, age_min: 25, age_max: 60 },
  },
  {
    key: "yetkazish",
    label: "Yetkazish hududi",
    hint: "Toshkent (60 km), Sirdaryo va Jizzax (40 km), 25–60 yosh",
    targeting: { geo_locations: { custom_locations: [TASHKENT, GULISTON, JIZZAX] }, age_min: 25, age_max: 60 },
  },
  {
    key: "quruvchi",
    label: "Quruvchilar va ustalar",
    hint: "Yetkazish hududi, 28–55 yosh, faqat erkaklar",
    targeting: { geo_locations: { custom_locations: [TASHKENT, GULISTON, JIZZAX] }, age_min: 28, age_max: 55, genders: [1] },
  },
  {
    key: "ozbekiston",
    label: "Butun O'zbekiston",
    hint: "Keng qamrov, 25–60 yosh",
    targeting: { geo_locations: { countries: ["UZ"] }, age_min: 25, age_max: 60 },
  },
];

export const audienceByKey = (k: string) => AUDIENCES.find((a) => a.key === k);
