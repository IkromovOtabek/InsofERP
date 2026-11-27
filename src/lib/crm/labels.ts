import type { CrmClientStatus, CrmResultGroup } from "@/generated/prisma";
import type { BadgeColor } from "@/components/ui";

/**
 * Sotuv CRM interfeysi matnlari — bitta joyda (docs/CRM_SPEC.md 2.5: keyin rus tili qo'shilishi mumkin).
 * So'zlar spetsifikatsiyadagi bilan aynan bir xil. Fayl brauzerda ham ishlatiladi — baza importi bo'lmasin.
 */
export const T = {
  module: "Sotuv CRM",
  nav: { today: "Bugun", clients: "Mijozlar", funnel: "Voronka", contacts: "Aloqalar" },

  field: {
    name: "Mijoz nomi",
    inn: "STIR",
    contactPerson: "Aloqa shaxsi",
    phone: "Telefon",
    region: "Viloyat / shahar",
    district: "Tuman",
    objectType: "Nima qurilmoqda",
    foremanName: "Prorab",
    foremanPhone: "Prorab telefoni",
    clientType: "Mijoz turi",
    source: "Manba",
    status: "Holat",
    owner: "Mas'ul xodim",
    link: "Havola",
    note: "Izoh",
    nextContact: "Keyingi aloqa",
    lastContact: "Oxirgi aloqa",
    activity: "Faollik",
  },

  clients: {
    title: "Mijozlar",
    search: "Qidirish: nom, telefon, STIR, viloyat, prorab",
    add: "Yangi mijoz",
    empty: "Mijoz topilmadi",
    emptyCrm: "CRM'da hali mijoz yo'q — «Yangi mijoz» tugmasi bilan qo'shing",
    allSources: "Barcha manbalar",
    allOwners: "Barcha xodimlar",
    notCrm: "ERP mijozi (CRM'da emas)",
    searchAllHint: "Qidiruv ERP'dagi barcha mijozlar bo'yicha",
    more: (n: number) => `Yana ${n} ta — qidiruvni aniqlashtiring`,
  },
  filter: { all: "Hammasi", new: "Yangi", active: "Ishlayotgan", waiting: "Kutilayotgan", refusal: "Otkaz" },

  form: {
    newTitle: "Yangi mijoz",
    editTitle: "Mijozni tahrirlash",
    save: "Saqlash",
    cancel: "Bekor qilish",
    choose: "— tanlang —",
    statusAuto: "Avtomatik (aloqalar bo'yicha)",
    more: "Qo'shimcha ma'lumotlar",
    dupTitle: "Bu mijoz bazada bor bo'lishi mumkin",
    dupOpen: "Shu mijozni ochish",
    dupForce: "Baribir yangi mijoz sifatida saqlash",
    phoneInvalid: "Telefon raqami noto'g'ri — +998 XX XXX XX XX",
    foremanPhoneInvalid: "Prorab telefoni noto'g'ri — +998 XX XXX XX XX",
    sourceRequired: "Manbani tanlang",
    linkInvalid: "Havola http:// yoki https:// bilan boshlansin",
  },

  card: {
    call: "Qo'ng'iroq",
    telegram: "Telegram",
    writeContact: "Aloqa yozish",
    order: "Zayafka",
    edit: "Tahrirlash",
    funnel: "Voronkadagi joyi",
    next: "Keyingisi",
    funnelDone: "Voronka oxiriga yetdi",
    info: "Ma'lumotlar",
    history: "Aloqalar tarixi",
    noHistory: "Hali aloqa yozilmagan",
    orders: "Zayafkalar",
    noOrders: "Zayafka yo'q",
    erpCard: "ERP kartasi (qarz, limit)",
    cancelled: "Bekor qilingan",
    noResult: "Natija yozilmagan",
    soon: "Keyingi bosqichda",
  },
} as const;

export const STATUS_LABEL: Record<CrmClientStatus, string> = {
  NEW: "Yangi",
  CONTACTED: "Aloqa qilindi",
  NEGOTIATION: "Muzokara",
  ACTIVE: "Ishlayotgan",
  OLD: "Eski mijoz",
  LOST: "Yo'qotilgan",
};
export const STATUS_COLOR: Record<CrmClientStatus, BadgeColor> = {
  NEW: "slate",
  CONTACTED: "blue",
  NEGOTIATION: "amber",
  ACTIVE: "green",
  OLD: "violet",
  LOST: "red",
};
export const CRM_STATUSES = Object.keys(STATUS_LABEL) as CrmClientStatus[];

export const GROUP_LABEL: Record<CrmResultGroup, string> = {
  CONTINUE: "Davom",
  WAITING: "Kutilayotgan",
  REFUSAL: "Otkaz",
  NO_ANSWER: "Javob yo'q",
  LOSS: "Yo'qotish",
  WIN: "Yutuq",
};
export const GROUP_COLOR: Record<CrmResultGroup, BadgeColor> = {
  CONTINUE: "blue",
  WAITING: "violet",
  REFUSAL: "red",
  NO_ANSWER: "slate",
  LOSS: "red",
  WIN: "green",
};

/** Voronka bosqichlari (CRM_SPEC 4.1) — tartib raqami = bosqich */
export const FUNNEL_STAGES = ["Lid / aloqa", "Javob berdi", "Ehtiyoji bor", "Taklif yuborildi", "Muzokara", "Zayafka", "Yetkazildi"] as const;

/** Faollik (CRM_SPEC 4.4) */
export type Activity = "NONE" | "ACTIVE" | "COOLING" | "OLD";
export const ACTIVITY_LABEL: Record<Activity, string> = {
  NONE: "Zayafka yo'q",
  ACTIVE: "Faol",
  COOLING: "Sovib qoldi",
  OLD: "Eski: qayta aloqa kerak",
};
export const ACTIVITY_COLOR: Record<Activity, BadgeColor> = { NONE: "slate", ACTIVE: "green", COOLING: "amber", OLD: "red" };
