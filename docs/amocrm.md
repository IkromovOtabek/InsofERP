# amoCRM integratsiyasi

Savdo voronkasi (lid, taklif, kelishuv) **amoCRM**'da, zayavka, ishlab chiqarish va pul **ERP**'da yuritiladi.
Kod: `src/lib/amocrm/`, sahifa: **Sotuv → amoCRM** (`/amocrm`), test: `scripts/qa/c-amocrm.ts`.

## Oqim

| Hodisa | Natija |
|---|---|
| Saytda ariza qoldirildi | amoCRM'da kontakt va sdelka ochiladi («Sayt» tegi, tafsilotlar va UTM eslatmada). Telefon bo'yicha kontakt bo'lsa, mavjudiga bog'lanadi |
| Menejer sdelkani **«ERP'ga» bosqichiga** o'tkazdi | ERP'da mijoz topiladi (INN, keyin telefon bo'yicha) yoki yangisi ochiladi. Kelishuv «Zayavka kutmoqda» ro'yxatiga tushadi, sotuvga bildirishnoma ketadi |
| Sotuvchi «Zayavka ochish» tugmasini bosdi | Mijoz va manzil to'ldirilgan zayavka formasi ochiladi, zayavka sdelkaga bog'lanadi |
| Zayavka qabul qilindi, yetkazildi, to'landi yoki bekor qilindi | Sdelka moslangan bosqichga o'tadi, byudjeti zayavka summasiga tenglashadi, eslatma yoziladi |

- amoCRM ishlamay qolsa ERP to'xtamaydi. Yuborilmagan arizalar navbatda turadi va qayta yuboriladi: 1, 5, 15, 60 daqiqadan keyin, so'ng har 6 soatda.
- Webhook kelmay qolsa ham har 5 daqiqada «ERP'ga» bosqichi tekshiriladi.
- Menejer sdelkani amoCRM'da qo'lda boshqa bosqichga o'tkazsa, ERP uni qaytarmaydi. Sdelka faqat zayavka holati o'zgarganda siljiydi.
- Bir kelishuvdan bir nechta zayavka ochish mumkin. Bosqichni eng orqada qolgan zayavka belgilaydi.
- INN kompaniya kartasidagi «ИНН», «INN» yoki «STIR» nomli maydondan olinadi. Manzil sdelkaning «Адрес», «Manzil» yoki «Obyekt» maydonidan olinadi.

## Ulash (direktor yoki «amoCRM'ni ulash» ruxsati berilgan xodim)

1. amoCRM'ga admin sifatida kiring: **Sozlamalar → Integratsiyalar → «Integratsiya yaratish»**. Shaxsiy (tashqi) integratsiyani tanlang.
   - Ruxsatlar: sdelkalar, kontaktlar, kompaniyalar, eslatmalar.
   - Redirect URI: `https://<korxona domeni>/api/amocrm/oauth`.
2. ERP: **Sotuv → amoCRM → Sozlamalar**. Ikki usuldan birini tanlang:
   - **Uzoq muddatli token** (oddiyroq): integratsiyaning «Kalitlar va ruxsatlar» bo'limidan tokenni nusxalab qo'ying.
   - **OAuth**: «Integratsiya ID» va «Maxfiy kalit»ni kiriting, keyin «amoCRM orqali ruxsat berish» tugmasini bosing.
3. Voronkani va bosqichlarni tanlang. «ERP'ga tushadigan» bosqich majburiy (masalan «Kelishildi»).
   Qolganlari ixtiyoriy: bo'sh qolsa, o'sha hodisada sdelka siljimaydi.

Tokenlar bazada shifrlangan holda saqlanadi (`AUTH_SECRET` dan olingan alohida kalit bilan). `AUTH_SECRET` almashtirilsa, amoCRM'ni qayta ulash kerak bo'ladi.
Ulangach webhook o'zi o'rnatiladi: `https://<domen>/api/amocrm/webhook/<maxfiy kalit>`. U uchun `APP_URL` internetdan ochiq bo'lishi kerak.

## Muhit

- `AMOCRM_WATCH=off` — davriy sinxronni o'chiradi (standart holatda yoqiq; test rejimida o'chiq).
- Yangi muhit o'zgaruvchisi talab qilinmaydi. Har korxona o'z amoCRM hisobini o'zi ulaydi, sozlama korxona bazasida (`AmoConnection`) turadi.
