/**
 * Zavod vaqti — Asia/Tashkent. Kod "bugun", "shu oy", `setHours(0,0,0,0)` va `datetime-local`
 * qiymatlarini server mahalliy vaqtida hisoblaydi. VPS UTC da bo'lsa kun chegarasi 05:00 ga siljib,
 * 00:00–05:00 dagi to'lov/zayavka kechagi kunga (1-sanada — o'tgan oyga) tushar, kiritilgan 10:00
 * esa 15:00 bo'lib saqlanardi. Serverda TZ berilmagan bo'lsa shu yerda o'rnatiladi (Node uni darhol qo'llaydi).
 * Alohida skriptlar (bot, eco:sync) uchun systemd/.env da ham `TZ=Asia/Tashkent` bo'lishi kerak.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.TZ) process.env.TZ = "Asia/Tashkent";
}
