/**
 * SMS matnlari — BITTA joyda.
 *
 * Sabab: Eskiz har bir matnni oldindan moderatsiyadan o'tkazadi. Tasdiqlanmagan matn
 * jo'natilsa rad etiladi. Shuning uchun matnni kod ichida tarqatib yuborish mumkin emas —
 * o'zgartirsangiz, shu faylni ochib, o'zgarganini moderatsiyaga qayta berasiz.
 *
 * `secret` — jurnalga yozishdan oldin yashiriladigan qismlar (parol, kod).
 * SmsLog'ni ko'rgan odam begonaning parolini o'qiy olmasligi kerak.
 */

export type TemplateKey = keyof typeof TEMPLATES;

export const TEMPLATES = {
  /** Xodimga tizimga kirish berildi (yangi xodim yoki mavjud xodimga login). */
  login_granted: {
    label: "Tizimga kirish berildi",
    text: (v: { login: string; password: string; url?: string | null }) =>
      `Insof ERP: tizimga kirish. Login: ${v.login} Parol: ${v.password}${v.url ? ` ${v.url}` : ""}`,
    secret: (v: { password: string }) => [v.password],
  },

  /** Otdel kadr xodimning parolini yangiladi. */
  password_changed: {
    label: "Parol yangilandi",
    text: (v: { login: string; password: string }) =>
      `Insof ERP: parolingiz yangilandi. Login: ${v.login} Yangi parol: ${v.password}`,
    secret: (v: { password: string }) => [v.password],
  },

  /** Xodim parolni o'zi tiklayapti — bir martalik kod. */
  reset_code: {
    label: "Parolni tiklash kodi",
    text: (v: { code: string }) => `Insof ERP: parolni tiklash kodi ${v.code}. Hech kimga bermang.`,
    secret: (v: { code: string }) => [v.code],
  },
} as const;

/** Maxfiy qismlari yashirilgan matn — SmsLog uchun. */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  return secrets.reduce((acc, s) => (s ? acc.split(s).join("•••") : acc), text);
}

/**
 * Moderatsiyaga beriladigan matn: o'zgaruvchi qism `#nom#` bilan belgilanadi.
 * Eskiz boshqa belgi so'rasa (masalan `%w` yoki `{nom}`) — faqat SHU ikki qatorni o'zgartirasiz,
 * yuboriladigan SMS matni bunga bog'liq emas.
 */
export const TEMPLATES_FOR_MODERATION: { key: TemplateKey; text: string }[] = [
  { key: "login_granted", text: TEMPLATES.login_granted.text({ login: "#login#", password: "#parol#", url: "#havola#" }) },
  { key: "password_changed", text: TEMPLATES.password_changed.text({ login: "#login#", password: "#parol#" }) },
  { key: "reset_code", text: TEMPLATES.reset_code.text({ code: "#kod#" }) },
];

/** Barcha shablonlarning namunaviy matni — moderatsiyaga berish va sozlamalar sahifasi uchun. */
export const TEMPLATE_SAMPLES: { key: TemplateKey; label: string; sample: string }[] = [
  { key: "login_granted", label: TEMPLATES.login_granted.label, sample: TEMPLATES.login_granted.text({ login: "sotuv1", password: "4821xk", url: "https://erp.insof.uz" }) },
  { key: "password_changed", label: TEMPLATES.password_changed.label, sample: TEMPLATES.password_changed.text({ login: "sotuv1", password: "4821xk" }) },
  { key: "reset_code", label: TEMPLATES.reset_code.label, sample: TEMPLATES.reset_code.text({ code: "482174" }) },
];
